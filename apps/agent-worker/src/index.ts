import { readFileSync } from 'node:fs';
import { loadWorkerEnv } from './config';
import { AgentWorker } from './worker';
import { AgentStore } from '../../../packages/agent-store';
import { agentConfigSchema } from '../../../packages/agent-engine/config';
import { observeAgent, verifyWorkerNetwork } from './live-data';
import { sdk, marketById } from '../../../packages/dreamdex-adapter';
async function main() {
  const env = loadWorkerEnv();
  const version = JSON.parse(
    readFileSync(
      new URL('../../../node_modules/@somnia-chain/markets-sdk/package.json', import.meta.url),
      'utf8',
    ),
  ).version;
  if (version !== '0.32.1')
    throw new Error('Worker SDK compatibility requires reviewed version 0.32.1');
  if (process.argv.includes('--check-config')) {
    console.log(
      JSON.stringify({
        ok: true,
        network: 'hideki',
        chainId: 50383,
        mode: 'DRY_RUN',
        sdk: version,
        broadcastEnabled: false,
      }),
    );
    return;
  }
  const store = new AgentStore(env.AGENT_STORE_PATH),
    worker = new AgentWorker(store, (c) => observeAgent(c, store.get(c.id).createdAt), {
      workerId: env.AGENT_WORKER_ID,
      ttl: env.AGENT_LEASE_TTL_MS,
      dataTimeoutMs: env.AGENT_DATA_TIMEOUT_MS,
    });
  let stop = false;
  const shutdown = () => {
    stop = true;
    worker.shutdown();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    if (env.AGENT_CONFIG_FILE) {
      const parsed = JSON.parse(readFileSync(env.AGENT_CONFIG_FILE, 'utf8'));
      const configs = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.agents)
          ? parsed.agents
          : [parsed.config ?? parsed];
      for (const input of configs) {
        const c = agentConfigSchema.parse(input);
        if (c.mode !== 'DRY_RUN')
          throw new Error('Configuration file activation is restricted to DRY_RUN');
        const old = store.list().find((a) => a.config.id === c.id);
        if (old && JSON.stringify(old.config) !== JSON.stringify(c))
          throw new Error(
            'Imported configuration conflicts with durable state; update it through reviewed versioning',
          );
        if (!old) store.save(c);
        if (!old) store.command(c.id, 'start', c.revision);
      }
    }
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        verifyWorkerNetwork(),
        new Promise<never>((_, reject) => {
          startupTimer = setTimeout(
            () => reject(new Error('Worker startup network deadline exceeded')),
            env.AGENT_DATA_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (startupTimer) clearTimeout(startupTimer);
    }
    for (const a of store.list()) await marketById(a.config.marketId);
    if (stop) return;
    worker.start();
    worker.startHeartbeat();
    console.log(
      JSON.stringify({
        event: 'worker-started',
        workerId: worker.lease?.workerId,
        chainId: 50383,
        mode: 'DRY_RUN',
        broadcastEnabled: false,
        control: 'local-sqlite',
      }),
    );
    let cycle = 0,
      backoff = env.AGENT_POLL_MS;
    while (!stop && !worker.stopped) {
      try {
        await worker.cycle();
        backoff = env.AGENT_POLL_MS;
        cycle++;
        console.log(
          JSON.stringify({
            event: 'cycle-complete',
            at: Date.now(),
            cycle,
            activeAgents: store
              .list()
              .filter((a) => ['simulating', 'awaiting-authorization'].includes(a.runtime.status))
              .length,
            broadcastEnabled: false,
          }),
        );
        if (env.AGENT_MAX_CYCLES && cycle >= env.AGENT_MAX_CYCLES) break;
      } catch {
        backoff = Math.min(300000, backoff * 2);
        console.error(
          JSON.stringify({ event: 'cycle-unavailable', broadcastEnabled: false, retryMs: backoff }),
        );
        if (worker.stopped) break;
      }
      const until = Date.now() + backoff;
      while (!stop && !worker.stopped && Date.now() < until)
        await new Promise((r) => setTimeout(r, Math.min(250, until - Date.now())));
    }
  } finally {
    const persistenceAcknowledged = worker.shutdown();
    store.close();
    await closeSdk();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    console.log(
      JSON.stringify({
        event: 'worker-stopped',
        broadcastEnabled: false,
        positionsClosed: false,
        persistenceAcknowledged,
      }),
    );
  }
}
async function closeSdk() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sdk.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
main()
  .then(() => process.exit(0))
  .catch(async () => {
    console.error(
      'Agent worker could not start safely. Check validated configuration, Hideki connectivity, persistent state and lease ownership. Secret values are never logged.',
    );
    await closeSdk();
    process.exit(1);
  });
