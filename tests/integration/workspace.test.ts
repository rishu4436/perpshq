import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AgentStore } from '../../packages/agent-store';
import { AgentWorker } from '../../apps/agent-worker/src/worker';
import { agentFixture, agentNow } from '../agent-fixtures';
import {
  recovery,
  lifecycle,
  exportWorkspace,
  restoreWorkspace,
  savePortfolio,
  sharedAccount,
  assertSharedCapital,
  condition,
  inbox,
  acknowledgeAlert,
  monitorWorkspace,
  replays,
  compareReplay,
  putRecord,
  records,
} from '../../packages/workspace';
const stores: AgentStore[] = [];
const make = () => {
  const s = new AgentStore(':memory:');
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));
describe('local workspace features', () => {
  it('shows failed checks, unresolved state and heartbeat without implying recovery', async () => {
    const f = agentFixture(),
      s = make();
    s.save(f.config, undefined, agentNow);
    s.command(f.config.id, 'start', 1, agentNow);
    const w = new AgentWorker(
      s,
      async () => {
        throw new Error('RPC unavailable');
      },
      { clock: () => agentNow },
    );
    w.start();
    await w.cycle();
    const view = recovery(s, agentNow);
    expect(view.connected).toBe(true);
    expect(view.agents[0].stopReason).toBe('RPC unavailable');
    expect(view.agents[0].requirements.join()).toContain('fresh');
    w.shutdown();
  });
  it('archives flat stopped agents without erasing history and clones a new dry-run draft', () => {
    const f = agentFixture(),
      s = make();
    s.save(f.config, undefined, agentNow);
    const draft = lifecycle(s, f.config.id, 'clone', agentNow);
    expect(draft).toMatchObject({ mode: 'DRY_RUN', revision: 1 });
    expect(draft).toHaveProperty('id');
    expect((draft as { id: string }).id).not.toBe(f.config.id);
    lifecycle(s, f.config.id, 'archive', agentNow);
    expect(s.list()).toHaveLength(0);
    expect(s.list(true)).toHaveLength(1);
    expect(s.versions(f.config.id)).toHaveLength(1);
    expect(() => s.command(f.config.id, 'start', 1, agentNow)).toThrow('archived');
    lifecycle(s, f.config.id, 'restore', agentNow);
    expect(s.list()).toHaveLength(1);
    s.command(f.config.id, 'start', 1, agentNow);
    expect(() => lifecycle(s, f.config.id, 'archive', agentNow)).toThrow('pending');
  });
  it('restores a checksummed full snapshot paused and retains unknown intents and auxiliary data', () => {
    const f = agentFixture(),
      s = make(),
      target = make();
    s.save(f.config, undefined, agentNow);
    const lease = s.acquire('source', agentNow)!;
    s.reserveIntent(
      lease,
      {
        key: 'test-intent',
        agentId: f.config.id,
        revision: 1,
        owner: '0x' + '1'.repeat(40),
        operator: '0x' + '2'.repeat(40),
        marketId: f.config.marketId,
        decisionId: 'test',
        data: '0x1234',
        createdAt: agentNow,
        kind: 'MOCK',
      },
      0,
      agentNow,
    );
    s.updateIntent('test-intent', 'unknown');
    const activityId = randomUUID();
    putRecord(s, 'activity', activityId, {
      id: activityId,
      flowId: randomUUID(),
      account: '0x' + '1'.repeat(40),
      marketId: f.config.marketId,
      at: agentNow,
      state: 'unknown',
      detail: 'Transport interrupted',
      source: 'browser-reported',
    });
    const result = restoreWorkspace(target, exportWorkspace(s), agentNow);
    expect(result).toMatchObject({ restored: 1, paused: true, unresolved: 1 });
    expect(target.get(f.config.id).runtime.status).toBe('paused');
    expect(records(target, 'activity')).toHaveLength(1);
    expect(() => restoreWorkspace(target, exportWorkspace(s), agentNow)).toThrow('empty');
  });
  it('rejects tampering and rolls back an invalid relational backup', () => {
    const f = agentFixture(),
      s = make(),
      target = make();
    s.save(f.config, undefined, agentNow);
    const b = exportWorkspace(s);
    b.tables.agents[0].id = 'tampered';
    expect(() => restoreWorkspace(target, b, agentNow)).toThrow('checksum');
    expect(target.list()).toHaveLength(0);
  });
  it('rejects restore while a worker lease is alive', () => {
    const s = make(),
      t = make();
    t.acquire('busy', agentNow);
    expect(() => restoreWorkspace(t, exportWorkspace(s), agentNow)).toThrow('Stop');
  });
  it('rejects malformed auxiliary records and rolls the entire restore back', () => {
    const f = agentFixture(),
      s = make(),
      target = make();
    s.save(f.config, undefined, agentNow);
    putRecord(s, 'accounting', 'invalid', { complete: true, netPnl: '1000' });
    expect(() => restoreWorkspace(target, exportWorkspace(s), agentNow)).toThrow();
    expect(target.list()).toHaveLength(0);
    expect(records(target, 'accounting')).toEqual([]);
  });
  it('counts shared bankroll only once and rejects a second allocation that exceeds it', () => {
    const f = agentFixture(),
      s = make(),
      other = structuredClone(f.config);
    other.id = randomUUID();
    s.save(f.config, undefined, agentNow);
    s.save(other, undefined, agentNow);
    savePortfolio(s, {
      id: randomUUID(),
      name: 'Pool',
      capital: '10',
      agentIds: [f.config.id, other.id],
    });
    expect(sharedAccount(s, s.get(f.config.id), agentNow).equity).toBe('10');
    const next = s.get(f.config.id);
    next.ledger.orders.push({
      id: 'order',
      decisionId: 'decision',
      createdAt: agentNow,
      expiresAt: agentNow + 60000,
      remaining: '1',
      proposal: {
        action: 'entry',
        side: 'long',
        quantity: '1',
        rawQuantity: '1',
        price: '1000',
        rawPrice: '1000',
        notional: '1000',
        estimatedLoss: '1',
        orderType: 'LIMIT',
      },
    });
    expect(() => assertSharedCapital(s, next, s.get(f.config.id), agentNow)).toThrow(
      'Shared paper',
    );
    expect(() =>
      savePortfolio(s, {
        id: randomUUID(),
        name: 'Other',
        capital: '100',
        agentIds: [f.config.id],
      }),
    ).toThrow('another');
  });
  it('stores exact observation/config evidence and compares one immutable dataset', async () => {
    const f = agentFixture(),
      s = make();
    s.save(f.config, undefined, agentNow);
    s.command(f.config.id, 'start', 1, agentNow);
    const w = new AgentWorker(s, async () => structuredClone(f.observation), {
      clock: () => agentNow,
    });
    w.start();
    await w.cycle();
    const saved = replays(s, f.config.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].observation.detail?.candles).toEqual(f.detail.candles);
    expect(saved[0].config).toEqual(f.config);
    const report = compareReplay(s, f.config.id, saved[0].decision.id);
    expect(report.scenarios).toHaveLength(2);
    expect(report.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.scenarios[0].report.sample).toEqual(report.scenarios[1].report.sample);
    w.shutdown();
  });
  it('isolates strategy positions while aggregating shared risk and rejecting stale member marks', () => {
    const f = agentFixture(),
      s = make(),
      other = structuredClone(f.config);
    other.id = randomUUID();
    s.save(f.config, undefined, agentNow);
    s.save(other, undefined, agentNow);
    savePortfolio(s, {
      id: randomUUID(),
      name: 'Shared',
      capital: '1000',
      agentIds: [f.config.id, other.id],
    });
    const held = s.get(other.id);
    held.ledger.position = {
      marketId: other.marketId,
      side: 'long',
      quantity: '1',
      entryPrice: '100',
      notional: '100',
      unrealizedPnl: '0',
      source: 'paper',
      entryFees: '0',
      fundingPaid: '0',
      realizedNet: '0',
    };
    held.ledger.updatedAt = agentNow - 600000;
    held.ledger.startedAt = held.ledger.updatedAt;
    s.db.prepare('UPDATE agents SET record=? WHERE id=?').run(JSON.stringify(held), other.id);
    const own = s.get(f.config.id),
      account = sharedAccount(s, own, agentNow);
    expect(account.positions).toEqual([]);
    expect(account.positionCount).toBe(1);
    expect(account.totalExposure).toBe('100');
    expect(account.errors.join()).toContain('valuation is stale');
    expect(sharedAccount(s, own, agentNow, true).positions).toHaveLength(1);
    const next = structuredClone(own);
    next.ledger.position = structuredClone(held.ledger.position);
    next.ledger.updatedAt = agentNow;
    expect(() => assertSharedCapital(s, next, own, agentNow)).toThrow('valuation is stale');
  });
  it('deduplicates continuous alerts, preserves acknowledgment, and alerts again after recovery', () => {
    const s = make(),
      input = { severity: 'warning' as const, title: 'Stale', detail: 'Refresh data' };
    condition(s, 'stale', true, input, agentNow);
    condition(s, 'stale', true, input, agentNow + 1);
    expect(inbox(s)).toHaveLength(1);
    acknowledgeAlert(s, inbox(s)[0].id, agentNow + 2);
    expect(inbox(s)[0].acknowledgedAt).toBe(agentNow + 2);
    condition(s, 'stale', false, input, agentNow + 3);
    condition(s, 'stale', true, input, agentNow + 4);
    expect(inbox(s)).toHaveLength(2);
  });
  it('detects a disconnected worker without requiring a browser', () => {
    const f = agentFixture(),
      s = make();
    s.save(f.config, undefined, agentNow);
    s.command(f.config.id, 'start', 1, agentNow);
    const lease = s.acquire('gone', agentNow)!;
    s.acknowledge(lease, agentNow);
    monitorWorkspace(s, agentNow + 60000);
    expect(inbox(s).some((a) => a.key === 'worker-disconnected')).toBe(true);
  });
});
