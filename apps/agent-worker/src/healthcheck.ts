import { existsSync } from 'node:fs';
import { AgentStore } from '../../../packages/agent-store';
import { loadWorkerEnv } from './config';
try {
  const env = loadWorkerEnv();
  if (!existsSync(env.AGENT_STORE_PATH)) throw new Error('No worker state');
  const store = new AgentStore(env.AGENT_STORE_PATH);
  try {
    const h = store.health();
    if (
      !h ||
      Date.now() - h.at > 30000 ||
      h.state === 'stopped' ||
      h.network !== 50383 ||
      h.broadcastEnabled !== false
    )
      throw new Error('Worker heartbeat is unavailable');
    console.log(JSON.stringify({ ok: true, mode: 'DRY_RUN', at: h.at, state: h.state }));
  } finally {
    store.close();
  }
} catch {
  console.error('Worker health unavailable; inspect local worker logs/state.');
  process.exitCode = 1;
}
