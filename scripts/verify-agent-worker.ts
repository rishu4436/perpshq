/** Isolated, read-only real-process verification. No key, grant, signer or broadcast. */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { markets, sdk, rpc } from '../packages/dreamdex-adapter';
import { defaultAgentConfig } from '../packages/agent-engine/config';
import { AgentStore } from '../packages/agent-store';
import { readPermissions } from '../packages/agent-execution';
const checks: { name: string; ok: boolean; details?: unknown; error?: string }[] = [];
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(test: () => boolean, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (test()) return;
    await pause(200);
  }
  throw new Error('Verification deadline exceeded');
}
function launch(path: string, configFile: string, workerId: string, cycles: number) {
  let stdout = '',
    stderr = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/agent-worker/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_STORE_PATH: path,
      AGENT_CONFIG_FILE: configFile,
      AGENT_WORKER_ID: workerId,
      AGENT_POLL_MS: '10000',
      AGENT_MAX_CYCLES: String(cycles),
      AGENT_NETWORK: 'hideki',
      AGENT_MODE: 'DRY_RUN',
      AGENT_LEASE_TTL_MS: '30000',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => {
    stdout += String(b);
  });
  child.stderr.on('data', (b) => {
    stderr += String(b);
  });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  return { child, done, output: () => stdout, error: () => stderr };
}
async function check(name: string, work: () => Promise<unknown>) {
  try {
    checks.push({ name, ok: true, details: await work() });
    console.log('PASS', name);
  } catch {
    checks.push({
      name,
      ok: false,
      error: 'Verification failed; no signing or deployment was attempted.',
    });
    console.log('FAIL', name);
  }
}
async function main() {
  const chainId = await rpc.getChainId();
  if (chainId !== 50383) throw new Error('Wrong chain');
  const m = (await markets()).find((m) => m.baseSymbol === 'BTC');
  if (!m) throw new Error('BTC perp is not discovered');
  const dir = await mkdtemp(resolve('data/agent-worker-verification-')),
    path = join(dir, 'state.sqlite'),
    configFile = join(dir, 'agent.json'),
    config = defaultAgentConfig(m.id, randomUUID());
  config.name = 'Read-only worker verification';
  await writeFile(configFile, JSON.stringify(config, null, 2));
  const first = launch(path, configFile, 'verification-primary', 5);
  let observer: AgentStore | undefined;
  try {
    await check('real read-only startup and heartbeat', async () => {
      await waitFor(() => first.output().includes('worker-started'), 45000);
      observer = new AgentStore(path);
      const h = observer.health();
      if (!h || h.network !== 50383 || h.broadcastEnabled !== false)
        throw new Error('No valid heartbeat');
      return { workerId: h.workerId, heartbeat: h.at, broadcastEnabled: false };
    });
    if (!observer) throw new Error('First worker did not start');
    const s = observer;
    await check('duplicate process cannot own the same durable volume', async () => {
      const duplicate = launch(path, configFile, 'verification-duplicate', 1);
      const code = await duplicate.done;
      if (code === 0) throw new Error('Duplicate unexpectedly started');
      if (s.health()?.workerId !== 'verification-primary') throw new Error('Lease owner changed');
      return { duplicateExitCode: code, leaseOwner: s.health()?.workerId };
    });
    await check('process health command reads actual heartbeat', async () => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'apps/agent-worker/src/healthcheck.ts'],
        {
          cwd: process.cwd(),
          env: { ...process.env, AGENT_STORE_PATH: path },
          windowsHide: true,
          stdio: 'ignore',
        },
      );
      const code = await new Promise<number | null>((r) => child.once('exit', r));
      if (code !== 0) throw new Error('Health command failed');
      return { exitCode: code };
    });
    await check('pause and resume receive actual worker acknowledgements', async () => {
      const requested = s.command(config.id, 'pause', 1);
      await waitFor(
        () => s.commands(config.id).some((c) => c.id === requested.id && !!c.acknowledgedAt),
        12000,
      );
      if (s.get(config.id).runtime.status !== 'paused') throw new Error('Pause not acknowledged');
      const resumed = s.command(config.id, 'resume', 1);
      await waitFor(
        () => s.commands(config.id).some((c) => c.id === resumed.id && !!c.acknowledgedAt),
        12000,
      );
      if (s.get(config.id).runtime.status !== 'simulating')
        throw new Error('Resume not acknowledged');
      return {
        pauseRequestedAt: requested.requestedAt,
        resumeRequestedAt: resumed.requestedAt,
        acknowledged: true,
      };
    });
    await check('graceful bounded process shutdown persists state', async () => {
      const code = await first.done;
      if (code !== 0 || !first.output().includes('"persistenceAcknowledged":true'))
        throw new Error('Shutdown did not complete');
      return {
        exitCode: code,
        heartbeatState: s.health()?.state,
        decisions: s.decisions(config.id).length,
        paperFills: s.get(config.id).ledger.fills.length,
      };
    });
    const before = s.get(config.id);
    await check('restart restores cursor, ledger and unique decision records', async () => {
      const restarted = launch(path, configFile, 'verification-restart', 1);
      const code = await restarted.done;
      if (code !== 0) throw new Error('Restart failed');
      const after = s.get(config.id),
        decisions = s.decisions(config.id),
        fills = after.ledger.fills;
      if (
        after.runtime.cursor < before.runtime.cursor ||
        new Set(fills.map((f) => f.id)).size !== fills.length ||
        decisions.length === 0
      )
        throw new Error('Recovery invariants failed');
      return {
        exitCode: code,
        previousCursor: before.runtime.cursor,
        restoredCursor: after.runtime.cursor,
        decisions: decisions.length,
        simulatedFills: fills.length,
        realTransactions: 0,
      };
    });
    await check(
      'forced termination preserves state and blocks takeover until lease expiry',
      async () => {
        const crashed = launch(path, configFile, 'verification-crash', 100);
        try {
          await waitFor(() => crashed.output().includes('cycle-complete'), 45000);
          const previous = s.get(config.id),
            health = s.health()!;
          crashed.child.kill('SIGKILL');
          const crashCode = await crashed.done;
          const tooEarly = launch(path, configFile, 'verification-too-early', 1);
          if ((await tooEarly.done) === 0) throw new Error('Unexpired crash lease was stolen');
          await waitFor(
            () =>
              !s.owns({ workerId: health.workerId, fence: health.fence, expiresAt: 0 }, Date.now()),
            35000,
          );
          const recovered = launch(path, configFile, 'verification-after-crash', 1);
          if ((await recovered.done) !== 0) throw new Error('Crash recovery failed');
          const next = s.get(config.id),
            fills = next.ledger.fills;
          if (
            next.runtime.cursor < previous.runtime.cursor ||
            new Set(fills.map((f) => f.id)).size !== fills.length ||
            s.health()!.fence <= health.fence
          )
            throw new Error('Crash recovery invariants failed');
          return {
            crashExitCode: crashCode,
            previousFence: health.fence,
            recoveredFence: s.health()!.fence,
            previousCursor: previous.runtime.cursor,
            recoveredCursor: next.runtime.cursor,
            realTransactions: 0,
          };
        } finally {
          if (crashed.child.exitCode === null) crashed.child.kill('SIGKILL');
        }
      },
    );
    await check('actual pool operator read ABI with synthetic public addresses', async () => {
      const snapshot = await readPermissions(
        { ...config, ownerAddress: '0x' + '1'.repeat(40), operatorAddress: '0x' + '2'.repeat(40) },
        m,
      );
      return {
        chainId: snapshot.chainId,
        pool: snapshot.marketId,
        block: snapshot.block,
        place: snapshot.place,
        cancel: snapshot.cancel,
        reduce: snapshot.reduce,
        accountKind: snapshot.accountKind,
        checkedAt: snapshot.checkedAt,
        scope: 'Synthetic public addresses, not user authorization or an actual linked wallet',
      };
    });
    await writeFile(
      'docs/agent-worker-verification.json',
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          mode: 'READ_ONLY / ISOLATED DRY_RUN',
          chainId,
          pool: m.poolAddress,
          configId: config.id,
          keysRequired: false,
          signed: false,
          broadcast: false,
          cloudDeployed: false,
          checks,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    observer?.close();
    if (first.child.exitCode === null) first.child.kill();
    await sdk.close();
  }
  if (checks.some((c) => !c.ok)) throw new Error('Some worker verification checks failed');
}
main()
  .then(() => process.exit(0))
  .catch(async () => {
    console.error(
      'Read-only worker verification did not complete; do not infer deployment or execution success.',
    );
    await sdk.close();
    process.exit(1);
  });
