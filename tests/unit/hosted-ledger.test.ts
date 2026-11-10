import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HostedLedger } from '../../apps/api/src/hosted-ledger';
import { defaultAgentConfig, type AgentDecision } from '../../packages/agent-engine';
import type { Ticket } from '../../apps/api/src/owner-review';
import { MemoryDocuments } from '../hosted-fixtures';
const owner = '0x' + '1'.repeat(40),
  other = '0x' + '2'.repeat(40),
  pool = '0x' + '3'.repeat(40);
function ticket(): Ticket {
  const config = defaultAgentConfig(pool, randomUUID());
  config.ownerAddress = owner;
  config.mode = 'ASSISTED';
  config.execution.signer = 'owner-wallet';
  const decision = {
    id: randomUUID(),
    agentId: config.id,
    strategy: config.strategy,
    type: 'ENTRY_CANDIDATE',
    signalKey: randomUUID(),
    evaluatedAt: Date.now(),
  } as AgentDecision;
  return {
    id: randomUUID(),
    config,
    decision,
    expiresAt: Date.now() + 60000,
    preview: {
      chainId: 50383,
      account: owner,
      to: pool,
      data: '0x1234',
      value: '0',
      gas: '100000',
      market: 'TEST FIXTURE',
      expiresAt: Date.now() + 60000,
    },
  };
}
async function review(ledger: HostedLedger, t: Ticket) {
  const lease = await ledger.acquire(owner);
  await ledger.saveReview(owner, lease.token, t.decision, t);
}
it('persists owner isolation and allows only one concurrent begin across independent ledger instances', async () => {
  const store = new MemoryDocuments(),
    a = new HostedLedger(store),
    b = new HostedLedger(store),
    t = ticket();
  await review(a, t);
  const results = await Promise.allSettled([a.begin(owner, t.id), b.begin(owner, t.id)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await b.read(owner)).value.tickets[t.id].state).toBe('unknown');
  expect((await b.read(other)).value.tickets[t.id]).toBeUndefined();
  await expect(a.acquire(owner)).rejects.toThrow('unresolved');
});
it('fences an old review lease and blocks begin while a review owns the wallet', async () => {
  const ledger = new HostedLedger(new MemoryDocuments()),
    t = ticket();
  await review(ledger, t);
  const lease = await ledger.acquire(owner);
  await expect(ledger.begin(owner, t.id)).rejects.toThrow('current review');
  await ledger.release(owner, lease.token);
  const next = await ledger.acquire(owner);
  await expect(ledger.saveReview(owner, lease.token, t.decision, t)).rejects.toThrow(
    'ownership expired',
  );
  await ledger.saveReview(owner, next.token, t.decision, t);
});
it('blocks expired reviews, consumed signals, rate limits and failure breakers', async () => {
  for (const mode of ['expired', 'signal', 'rate', 'failures'] as const) {
    const ledger = new HostedLedger(new MemoryDocuments()),
      t = ticket();
    await review(ledger, t);
    await ledger.mutate(owner, (d) => {
      if (mode === 'expired') d.tickets[t.id].ticket.expiresAt = Date.now() - 1;
      if (mode === 'signal') d.executed[t.decision.signalKey!] = Date.now();
      if (mode === 'rate')
        d.attempts = Array(t.config.risk.maxTransactionsPerHour).fill(Date.now());
      if (mode === 'failures') d.failureStreak = t.config.risk.maxRepeatedFailures;
    });
    await expect(ledger.begin(owner, t.id)).rejects.toThrow();
    expect((await ledger.read(owner)).value.tickets[t.id].state).toBe('reviewed');
  }
});
it('retains consumed-signal protection while bounding closed-ticket history', async () => {
  const ledger = new HostedLedger(new MemoryDocuments()),
    t = ticket();
  await ledger.mutate(owner, (d) => {
    for (let i = 0; i < 205; i++) {
      const old = ticket();
      d.tickets[old.id] = { ticket: old, state: 'confirmed', attemptedAt: Date.now() - i };
      d.executed[old.decision.signalKey!] = Date.now();
    }
  });
  await review(ledger, t);
  const d = (await ledger.read(owner)).value;
  expect(Object.keys(d.tickets)).toHaveLength(51);
  expect(Object.keys(d.executed)).toHaveLength(205);
});
