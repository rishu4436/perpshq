import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AgentStore } from '../../packages/agent-store';
import { AgentWorker } from '../../apps/agent-worker/src/worker';
import { agentFixture, agentNow } from '../agent-fixtures';
import { evaluateHistory } from '../../packages/agent-engine/history';
import { exportWorkspace, restoreWorkspace } from '../../packages/workspace';
const stores: AgentStore[] = [],
  dirs: string[] = [];
const make = (path = ':memory:') => {
  const s = new AgentStore(path);
  stores.push(s);
  return s;
};
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  for (const dir of dirs.splice(0)) {
    if (
      !resolve(dir).startsWith(resolve(tmpdir()) + '\\perpshq-regression-') &&
      !resolve(dir).startsWith(resolve(tmpdir()) + '/perpshq-regression-')
    )
      throw new Error('Unexpected test cleanup path');
    rmSync(dir, { recursive: true, force: true });
  }
});
describe('26 October audit regressions', () => {
  for (const intermediate of ['pause', 'stop'] as const)
    it('keeps emergency stop latched through ' + intermediate + ' and backup restore', () => {
      const f = agentFixture(),
        s = make();
      s.save(f.config, undefined, agentNow);
      const lease = s.acquire('one', agentNow)!;
      s.command(f.config.id, 'emergency-stop', 1, agentNow);
      s.acknowledge(lease, agentNow);
      s.command(f.config.id, intermediate, 1, agentNow);
      s.acknowledge(lease, agentNow);
      expect(s.get(f.config.id).runtime.status).toBe('emergency-stopped');
      expect(() => s.command(f.config.id, 'resume', 1, agentNow)).toThrow('latched');
      const target = make();
      restoreWorkspace(target, exportWorkspace(s), agentNow);
      expect(() => target.command(f.config.id, 'start', 1, agentNow)).toThrow('latched');
    });
  it('an emergency request blocks earlier queued activation before acknowledgement', () => {
    const f = agentFixture(),
      s = make();
    s.save(f.config, undefined, agentNow);
    const lease = s.acquire('one', agentNow)!;
    s.command(f.config.id, 'start', 1, agentNow);
    s.command(f.config.id, 'emergency-stop', 1, agentNow + 1);
    expect(() => s.command(f.config.id, 'resume', 1, agentNow + 2)).toThrow('latched');
    s.acknowledge(lease, agentNow + 3);
    expect(s.get(f.config.id).runtime.status).toBe('emergency-stopped');
    expect(s.commands(f.config.id).find((c) => c.type === 'start')?.result).toContain('latched');
  });
  for (const reject of [false, true])
    it(
      'discards pre-pause ' +
        (reject ? 'errors' : 'fills') +
        ' after resume from a second DB connection',
      async () => {
        const dir = mkdtempSync(join(tmpdir(), 'perpshq-regression-'));
        dirs.push(dir);
        const path = join(dir, 'state.sqlite'),
          s = make(path),
          control = make(path),
          f = agentFixture();
        s.save(f.config, undefined, agentNow);
        let resolveRead!: (o: typeof f.observation) => void,
          rejectRead!: (e: Error) => void,
          calls = 0;
        const pending = new Promise<typeof f.observation>((resolve, reject) => {
          resolveRead = resolve;
          rejectRead = reject;
        });
        const w = new AgentWorker(
          s,
          async () => (++calls === 1 ? pending : structuredClone(f.observation)),
          { clock: () => agentNow },
        );
        s.command(f.config.id, 'start', 1, agentNow);
        w.start();
        const cycle = w.cycle();
        control.command(f.config.id, 'pause', 1, agentNow);
        control.acknowledge(w.lease!, agentNow);
        control.command(f.config.id, 'resume', 1, agentNow);
        control.acknowledge(w.lease!, agentNow);
        if (reject) rejectRead(new Error('outdated RPC error'));
        else resolveRead(f.observation);
        await cycle;
        expect(s.get(f.config.id).runtime.status).toBe('simulating');
        expect(s.get(f.config.id).runtime.consecutiveFailures).toBe(0);
        expect(s.get(f.config.id).ledger.fills).toHaveLength(0);
        expect(s.decisions(f.config.id)).toHaveLength(0);
        await w.cycle();
        expect(calls).toBe(2);
        expect(s.decisions(f.config.id)).toHaveLength(1);
        expect(s.get(f.config.id).ledger.fills).toHaveLength(1);
        w.shutdown();
      },
    );
  it('resets a transient failure streak only after a healthy read while keeping unknown intents separate', async () => {
    const f = agentFixture(),
      s = make();
    let now = agentNow,
      fail = true;
    s.save(f.config, undefined, now);
    const w = new AgentWorker(
      s,
      async () => {
        if (fail) throw new Error('test outage');
        const o = structuredClone(f.observation);
        o.observedAt = now;
        o.detail!.quality.fetchedAt = now;
        o.detail!.market.markUpdatedAt = now;
        o.detail!.book!.fetchedAt = now;
        o.account!.observedAt = now;
        return o;
      },
      { clock: () => now, ttl: 10000000 },
    );
    s.command(f.config.id, 'start', 1, now);
    w.start();
    for (let i = 0; i < 3; i++) {
      fail = true;
      await w.cycle();
      expect(s.get(f.config.id).runtime.consecutiveFailures).toBe(1);
      now += 61000;
      s.command(f.config.id, 'resume', 1, now);
      s.acknowledge(w.lease!, now);
      fail = false;
      await w.cycle();
      expect(s.get(f.config.id).runtime.consecutiveFailures).toBe(0);
    }
    w.shutdown();
  });
  it('persists assisted PAUSE_REQUIRED as paused and does not keep polling', async () => {
    const f = agentFixture(),
      s = make();
    f.config.mode = 'ASSISTED';
    f.config.ownerAddress = '0x' + '1'.repeat(40);
    f.config.operatorAddress = '0x' + '2'.repeat(40);
    f.observation.chainId = 1;
    s.save(f.config, undefined, agentNow);
    let reads = 0;
    const w = new AgentWorker(
      s,
      async () => {
        reads++;
        return f.observation;
      },
      { clock: () => agentNow },
    );
    s.command(f.config.id, 'start', 1, agentNow);
    w.start();
    await w.cycle();
    await w.cycle();
    expect(s.get(f.config.id).runtime.status).toBe('paused');
    expect(s.decisions(f.config.id)[0].type).toBe('PAUSE_REQUIRED');
    expect(reads).toBe(1);
    w.shutdown();
  });
  it('historical hourly cap changes actual outcomes and includes unfilled attempts', () => {
    const f = agentFixture();
    Object.assign(f.config.risk, {
      cooldownSeconds: 1,
      maxSlippageBps: 500,
      maxSessionLoss: '1000',
      maxDailyLoss: '1000',
    });
    Object.assign(f.config.execution, { stopLossPct: 0.1, takeProfitPct: 0.1 });
    Object.assign(f.config.paper, {
      slippageBps: 0,
      feeBps: 0,
      fundingBpsPerHour: 0,
      maxVolumeParticipationPct: 5,
    });
    const run = (cap: number) =>
      evaluateHistory(
        { ...f.config, risk: { ...f.config.risk, maxTransactionsPerHour: cap } },
        f.detail.market,
        f.detail.candles,
        agentNow,
      );
    const low = run(1),
      high = run(100),
      actions = low.decisions.filter((d) =>
        ['ENTRY_CANDIDATE', 'EXIT_CANDIDATE', 'REDUCE_CANDIDATE'].includes(d.type),
      );
    // Each partition starts a separate portfolio and independent policy runtime.
    for (const p of low.partitions) {
      const local = actions.filter(
        (d) => d.at >= (p.from ?? 0) * 1000 && d.at <= (p.to ?? 0) * 1000,
      );
      for (const d of local)
        expect(local.filter((a) => a.at <= d.at && a.at > d.at - 3600000)).toHaveLength(1);
    }
    expect(low.partitions.reduce((n, p) => n + p.simulatedFills, 0)).toBeLessThan(
      high.partitions.reduce((n, p) => n + p.simulatedFills, 0),
    );
  });
});
