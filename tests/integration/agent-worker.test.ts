import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { AgentStore } from '../../packages/agent-store';
import { AgentWorker } from '../../apps/agent-worker/src/worker';
import { loadWorkerEnv } from '../../apps/agent-worker/src/config';
import { agentFixture, agentNow } from '../agent-fixtures';
const stores: AgentStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.useRealTimers();
});
function setup() {
  const f = agentFixture(),
    s = new AgentStore(':memory:');
  stores.push(s);
  s.save(f.config, undefined, agentNow);
  let now = agentNow;
  const observe = vi.fn(async () => structuredClone(f.observation));
  const w = new AgentWorker(s, observe, { workerId: 'worker-one', clock: () => now });
  return {
    ...f,
    s,
    w,
    observe,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe('worker environment boundary', () => {
  it('needs no wallet key and cannot be made live with an env toggle', () => {
    expect(loadWorkerEnv({}).AGENT_MODE).toBe('DRY_RUN');
    for (const env of [
      { AGENT_MODE: 'AUTONOMOUS_TESTNET' },
      { AGENT_NETWORK: 'mainnet' },
      { DRY_RUN: 'false' },
      { AGENT_LIVE_ENABLED: 'true' },
      { PRIVATE_KEY: 'TEST ONLY NOT A KEY' },
    ])
      expect(() => loadWorkerEnv(env)).toThrow();
  });
});
describe('durable local control plane', () => {
  it('configured is not running; only a worker acknowledges start/pause/resume/stop', async () => {
    const f = setup();
    expect(f.s.get(f.config.id).runtime.status).toBe('configured');
    const request = f.s.command(f.config.id, 'start', 1, agentNow);
    expect(request.acknowledgedAt).toBeUndefined();
    f.w.start();
    expect(f.s.get(f.config.id).runtime.status).toBe('simulating');
    await f.w.cycle();
    expect(f.s.decisions(f.config.id)).toHaveLength(1);
    f.s.command(f.config.id, 'pause', 1, agentNow);
    expect(f.s.get(f.config.id).runtime.status).toBe('simulating');
    f.s.acknowledge(f.w.lease!, agentNow);
    expect(f.s.get(f.config.id).runtime.status).toBe('paused');
    f.s.command(f.config.id, 'resume', 1, agentNow);
    f.s.acknowledge(f.w.lease!, agentNow);
    expect(f.s.get(f.config.id).runtime.status).toBe('simulating');
    f.s.command(f.config.id, 'stop', 1, agentNow);
    f.s.acknowledge(f.w.lease!, agentNow);
    expect(f.s.get(f.config.id).runtime.status).toBe('paused');
    f.w.shutdown();
    expect(f.s.health()?.state).toBe('stopped');
  });
  it('uses optimistic versions and does not accept replayed commands with changed meaning', () => {
    const f = setup(),
      request = '22222222-2222-4222-8222-222222222222';
    const one = f.s.command(f.config.id, 'start', 1, agentNow, request);
    expect(f.s.command(f.config.id, 'start', 1, agentNow + 1, request).id).toBe(one.id);
    expect(f.s.commands(f.config.id)).toHaveLength(1);
    expect(() => f.s.command(f.config.id, 'pause', 1, agentNow, request)).toThrow('reused');
    expect(() => f.s.save({ ...f.config, revision: 2 }, 0, agentNow)).toThrow('conflict');
    const changed = f.s.save(
      { ...f.config, revision: 2, name: 'Reviewed second revision' },
      1,
      agentNow,
    );
    expect(changed.config.revision).toBe(2);
  });
  it('latches emergency stop and does not confuse stop with closing exposure', async () => {
    const f = setup();
    f.s.command(f.config.id, 'start', 1, agentNow);
    f.w.start();
    await f.w.cycle();
    const before = f.s.get(f.config.id).ledger;
    f.s.command(f.config.id, 'emergency-stop', 1, agentNow);
    f.s.acknowledge(f.w.lease!, agentNow);
    const stopped = f.s.get(f.config.id);
    expect(stopped.runtime.status).toBe('emergency-stopped');
    expect(stopped.ledger.position).toEqual(before.position);
    expect(() => f.s.command(f.config.id, 'resume', 1, agentNow)).toThrow('latched');
    expect(() => f.s.save({ ...f.config, revision: 2 }, 1, agentNow)).toThrow('Pause');
    f.w.shutdown();
  });
  it('does not activate autonomous configuration even when it is otherwise schema-valid', () => {
    const f = setup(),
      c = {
        ...f.config,
        id: '33333333-3333-4333-8333-333333333333',
        mode: 'AUTONOMOUS_TESTNET' as const,
        ownerAddress: '0x' + '1'.repeat(40),
        operatorAddress: '0x' + '2'.repeat(40),
      };
    f.s.save(c, undefined, agentNow);
    expect(() => f.s.command(c.id, 'start', 1, agentNow)).toThrow('disabled in source');
  });
  it('persists real records across database close/reopen without replaying a signal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'perpshq-agent-test-')),
      path = join(dir, 'worker.sqlite'),
      f = agentFixture();
    let s: AgentStore | undefined;
    try {
      s = new AgentStore(path);
      s.save(f.config, undefined, agentNow);
      s.command(f.config.id, 'start', 1, agentNow);
      const w = new AgentWorker(s, async () => structuredClone(f.observation), {
        workerId: 'first',
        clock: () => agentNow,
      });
      w.start();
      await w.cycle();
      const old = s.get(f.config.id);
      w.shutdown();
      s.close();
      s = new AgentStore(path);
      const restarted = new AgentWorker(s, async () => structuredClone(f.observation), {
        workerId: 'second',
        clock: () => agentNow + 1000,
      });
      restarted.start();
      await restarted.cycle();
      const restored = s.get(f.config.id);
      expect(restored.ledger.fills).toHaveLength(old.ledger.fills.length);
      expect(restored.runtime.cursor).toBe(old.runtime.cursor);
      expect(s.decisions(f.config.id)[0].type).toBe('NO_ACTION');
      restarted.shutdown();
    } finally {
      s?.close();
      const absolute = resolve(dir);
      const safe =
        dirname(absolute) === resolve(tmpdir()) &&
        basename(absolute).startsWith('perpshq-agent-test-');
      if (safe) rmSync(absolute, { recursive: true, force: true });
      else console.error('Unsafe test cleanup path; refusing recursive removal');
    }
  });
  it('refuses corrupted financial state instead of treating it as zero', () => {
    const f = setup(),
      bad = f.s.get(f.config.id);
    bad.ledger.cash = 'corrupt';
    f.s.db.prepare('UPDATE agents SET record=? WHERE id=?').run(JSON.stringify(bad), f.config.id);
    expect(() => f.s.get(f.config.id)).toThrow();
    expect(() => f.w.start()).toThrow();
    f.w.shutdown();
  });
});
describe('worker fencing and outages', () => {
  it('runs an idle cycle with no configured agents and reports a genuine heartbeat', async () => {
    const s = new AgentStore(':memory:');
    stores.push(s);
    const observe = vi.fn();
    const worker = new AgentWorker(s, observe, { clock: () => agentNow });
    worker.start();
    await worker.cycle();
    expect(observe).not.toHaveBeenCalled();
    expect(s.health()?.state).toBe('idle');
    worker.shutdown();
  });
  it('evaluates multiple active agents without starting paused configurations', async () => {
    const f = setup(),
      other = { ...f.config, id: '22222222-2222-4222-8222-222222222222', name: 'Second dry run' },
      paused = { ...f.config, id: '33333333-3333-4333-8333-333333333333', name: 'Configured only' };
    f.s.save(other, undefined, agentNow);
    f.s.save(paused, undefined, agentNow);
    f.s.command(f.config.id, 'start', 1, agentNow);
    f.s.command(other.id, 'start', 1, agentNow);
    f.w.start();
    await f.w.cycle();
    expect(f.observe).toHaveBeenCalledTimes(2);
    expect(f.s.decisions(other.id)).toHaveLength(1);
    expect(f.s.decisions(paused.id)).toHaveLength(0);
    f.w.shutdown();
  });
  it('rejects overlapping cycles in a single process', async () => {
    const f = setup();
    let release!: (o: typeof f.observation) => void;
    const waiting = new Promise<typeof f.observation>((r) => {
      release = r;
    });
    const worker = new AgentWorker(f.s, () => waiting, { clock: () => agentNow });
    f.s.command(f.config.id, 'start', 1, agentNow);
    worker.start();
    const cycle = worker.cycle();
    await expect(worker.cycle()).rejects.toThrow('already in flight');
    release(f.observation);
    await cycle;
    expect(f.s.decisions(f.config.id)).toHaveLength(1);
    worker.shutdown();
  });
  it('rejects two processes even when configured with the same worker identity', () => {
    const f = setup();
    f.w.start();
    const duplicate = new AgentWorker(f.s, f.observe, {
      workerId: 'worker-one',
      clock: () => agentNow,
    });
    expect(() => duplicate.start()).toThrow('Another worker');
    f.w.shutdown();
  });
  it('restores an unresolved intent as a pause and rejects resume without reconciliation', async () => {
    const f = setup();
    const lease = f.s.acquire('pre-crash', agentNow)!;
    f.s.reserveIntent(
      lease,
      {
        key: 'test-only-unknown',
        agentId: f.config.id,
        revision: 1,
        owner: '0x' + '1'.repeat(40),
        operator: '0x' + '2'.repeat(40),
        marketId: f.config.marketId,
        decisionId: 'test-only',
        data: '0x',
        createdAt: agentNow,
        kind: 'MOCK',
      },
      0,
      agentNow,
    );
    f.s.release(lease, agentNow);
    f.s.command(f.config.id, 'start', 1, agentNow);
    f.w.start();
    expect(f.s.get(f.config.id).runtime.status).toBe('paused');
    f.s.command(f.config.id, 'resume', 1, agentNow);
    await f.w.cycle();
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.s.commands(f.config.id).some((c) => c.result?.includes('unresolved'))).toBe(true);
    f.w.shutdown();
  });
  it('pauses on a regressing chain head without changing the ledger or cursor', async () => {
    const f = setup();
    f.s.command(f.config.id, 'start', 1, agentNow);
    f.w.start();
    await f.w.cycle();
    const before = f.s.get(f.config.id);
    f.observe.mockResolvedValueOnce({ ...f.observation, block: '99' });
    await f.w.cycle();
    const after = f.s.get(f.config.id);
    expect(after.runtime.status).toBe('paused');
    expect(after.runtime.blockCursor).toBe('100');
    expect(after.ledger).toEqual(before.ledger);
    expect(f.s.decisions(f.config.id)).toHaveLength(1);
    f.w.shutdown();
  });
  it('times out a hanging observation and discards any eventual result', async () => {
    const f = setup();
    let resolveObservation!: (value: typeof f.observation) => void;
    const pending = new Promise<typeof f.observation>((resolve) => {
      resolveObservation = resolve;
    });
    const worker = new AgentWorker(f.s, () => pending, {
      workerId: 'bounded-worker',
      clock: () => agentNow,
      dataTimeoutMs: 5,
    });
    f.s.command(f.config.id, 'start', 1, agentNow);
    worker.start();
    await worker.cycle();
    expect(f.s.get(f.config.id).runtime.status).toBe('paused');
    resolveObservation(f.observation);
    await pending;
    expect(f.s.decisions(f.config.id)).toHaveLength(0);
    expect(f.s.get(f.config.id).ledger.fills).toHaveLength(0);
    worker.shutdown();
  });
  it('rejects a duplicate worker and increments the fence after lease expiry', () => {
    const f = setup();
    f.w.start();
    const other = new AgentWorker(f.s, f.observe, { workerId: 'other', clock: () => agentNow });
    expect(() => other.start()).toThrow('Another worker');
    const fence = f.w.lease!.fence;
    f.advance(50000);
    const next = f.s.acquire('other', agentNow + 50000)!;
    expect(next.fence).toBeGreaterThan(fence);
    expect(f.s.owns(f.w.lease!, agentNow + 50000)).toBe(false);
  });
  it('discards in-flight work after lease loss', async () => {
    const f = setup();
    let release!: (v: typeof f.observation) => void;
    const waiting = new Promise<typeof f.observation>((r) => {
      release = r;
    });
    const old = new AgentWorker(f.s, () => waiting, {
      workerId: 'old',
      clock: () => agentNow + 50000,
    });
    f.s.command(f.config.id, 'start', 1, agentNow);
    old.start();
    const pending = old.cycle();
    f.s.acquire('replacement', agentNow + 100000);
    release(f.observation);
    await pending;
    expect(f.s.decisions(f.config.id)).toHaveLength(0);
    expect(f.s.get(f.config.id).ledger.fills).toHaveLength(0);
  });
  it('honors pause acknowledged during network I/O before persisting any fill', async () => {
    const f = setup();
    let release!: (v: typeof f.observation) => void;
    const promise = new Promise<typeof f.observation>((r) => {
      release = r;
    });
    const w = new AgentWorker(f.s, () => promise, { clock: () => agentNow });
    f.s.command(f.config.id, 'start', 1, agentNow);
    w.start();
    const pending = w.cycle();
    f.s.command(f.config.id, 'pause', 1, agentNow);
    f.s.acknowledge(w.lease!, agentNow);
    release(f.observation);
    await pending;
    expect(f.s.get(f.config.id).runtime.status).toBe('paused');
    expect(f.s.get(f.config.id).ledger.fills).toHaveLength(0);
    w.shutdown();
  });
  it.each(['RPC outage', 'WebSocket disconnect', 'Indexer outage'] as const)(
    'pauses on %s; a safe explicit resume fetches observations again',
    async (message) => {
      const f = setup();
      f.observe.mockRejectedValueOnce(new Error(message));
      f.s.command(f.config.id, 'start', 1, agentNow);
      f.w.start();
      await f.w.cycle();
      expect(f.s.get(f.config.id).runtime.status).toBe('paused');
      expect(f.s.get(f.config.id).ledger.fills).toHaveLength(0);
      f.s.command(f.config.id, 'resume', 1, agentNow);
      await f.w.cycle();
      expect(f.observe).toHaveBeenCalledTimes(2);
      f.w.shutdown();
    },
  );
  it('invalid oracle data cannot update paper balances', async () => {
    const f = setup();
    f.observation.detail!.market.error = 'Invalid oracle';
    f.s.command(f.config.id, 'start', 1, agentNow);
    f.w.start();
    await f.w.cycle();
    expect(f.s.get(f.config.id).runtime.status).toBe('paused');
    expect(f.s.get(f.config.id).ledger.fills).toHaveLength(0);
    f.w.shutdown();
  });
  it('a lost control-store connection cannot produce another decision', async () => {
    const f = setup();
    f.w.start();
    f.s.close();
    stores.splice(stores.indexOf(f.s), 1);
    await expect(f.w.cycle()).rejects.toThrow();
    expect(f.observe).not.toHaveBeenCalled();
  });
});
