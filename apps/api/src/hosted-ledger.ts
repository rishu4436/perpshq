import { randomUUID } from 'node:crypto';
import type { AgentConfig, AgentDecision, AgentRuntime } from '../../../packages/agent-engine';
import type { Ticket } from './owner-review';
import type { DocumentStore } from './hosted-store';
import { sameConfig } from './config-equality';
export type HostedTicket = {
  ticket: Ticket;
  state: 'reviewed' | 'unknown' | 'rejected' | 'confirmed' | 'reverted';
  attemptedAt?: number;
  hash?: string;
  evidence?: unknown;
};
export interface OwnerDocument {
  configs: Record<string, { config: AgentConfig; versions: AgentConfig[] }>;
  tickets: Record<string, HostedTicket>;
  decisions: AgentDecision[];
  attempts: number[];
  failureStreak: number;
  lastFailureAt?: number;
  lastActionAt?: number;
  executed: Record<string, number>;
  lock?: { token: string; expiresAt: number };
}
const empty = (): OwnerDocument => ({
  configs: {},
  tickets: {},
  decisions: [],
  attempts: [],
  failureStreak: 0,
  executed: {},
});
export class HostedLedger {
  constructor(readonly store: DocumentStore) {}
  key(owner: string) {
    return 'owner:' + owner.toLowerCase();
  }
  async read(owner: string) {
    const key = this.key(owner);
    let row = await this.store.get<OwnerDocument>(key);
    if (!row) {
      await this.store.create(key, empty());
      row = await this.store.get<OwnerDocument>(key);
    }
    if (!row) throw new Error('Strategy ledger unavailable');
    return row;
  }
  async mutate<T>(owner: string, change: (document: OwnerDocument) => T) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.read(owner),
        value = structuredClone(row.value),
        result = change(value);
      if (await this.store.swap(this.key(owner), row.revision, value)) return result;
    }
    throw new Error('Concurrent strategy update. Refresh and try again.');
  }
  async acquire(owner: string) {
    const token = randomUUID();
    const document = await this.mutate(owner, (d) => {
      if (d.lock && d.lock.expiresAt > Date.now())
        throw new Error('Another strategy review is in progress');
      if (Object.values(d.tickets).some((t) => t.state === 'unknown'))
        throw new Error('Reconcile the unresolved wallet request first');
      d.lock = { token, expiresAt: Date.now() + 350000 };
      return d;
    });
    return { token, document };
  }
  assertLease(document: OwnerDocument, token: string) {
    if (document.lock?.token !== token || document.lock.expiresAt <= Date.now())
      throw new Error('Strategy review ownership expired');
  }
  async release(owner: string, token: string) {
    await this.mutate(owner, (d) => {
      if (d.lock?.token === token) delete d.lock;
    });
  }
  runtime(document: OwnerDocument, token: string): AgentRuntime {
    return {
      consecutiveFailures: document.failureStreak,
      lastFailureAt: document.lastFailureAt,
      lastActionAt: document.lastActionAt,
      transactionTimes: document.attempts,
      unknownIntent: Object.values(document.tickets).some((t) => t.state === 'unknown'),
      leaseValid: document.lock?.token === token && document.lock.expiresAt > Date.now(),
      controlAvailable: true,
      cursor: 0,
      status: 'configured',
    };
  }
  async saveReview(owner: string, token: string, decision: AgentDecision, ticket?: Ticket) {
    await this.mutate(owner, (d) => {
      this.assertLease(d, token);
      d.decisions = [...d.decisions, decision].slice(-100);
      for (const [id, row] of Object.entries(d.tickets))
        if (row.state === 'reviewed' && row.ticket.expiresAt < Date.now()) delete d.tickets[id];
      const closed = Object.values(d.tickets)
        .filter((row) => ['confirmed', 'reverted', 'rejected'].includes(row.state))
        .sort((a, b) => (b.attemptedAt ?? 0) - (a.attemptedAt ?? 0));
      for (const row of closed.slice(50)) delete d.tickets[row.ticket.id];
      for (const [signal, at] of Object.entries(d.executed))
        if (at < Date.now() - 7 * 86400000) delete d.executed[signal];
      if (ticket) {
        if (!d.tickets[ticket.id] && Object.keys(d.tickets).length >= 200)
          throw new Error('Too many active reviews. Wait for old reviews to expire.');
        d.tickets[ticket.id] = { ticket, state: 'reviewed' };
      }
      delete d.lock;
    });
  }
  async begin(owner: string, id: string) {
    await this.mutate(owner, (d) => {
      if (d.lock && d.lock.expiresAt > Date.now())
        throw new Error('Wait for the current review to finish');
      const row = d.tickets[id];
      if (!row || row.state !== 'reviewed' || row.ticket.expiresAt < Date.now())
        throw new Error('Review expired or request already consumed');
      if (Object.values(d.tickets).some((t) => t.state === 'unknown'))
        throw new Error('Reconcile the unresolved wallet request first');
      const c = row.ticket.config,
        signal = row.ticket.decision.signalKey;
      const current = d.configs[c.id]?.config;
      if (current && !sameConfig(current, c))
        throw new Error(
          'Saved configuration changed after this review. Review the current revision.',
        );
      if (signal && d.executed[signal]) throw new Error('This strategy signal already executed');
      d.attempts = d.attempts.filter((t) => t > Date.now() - 3600000);
      if (
        d.attempts.length >= c.risk.maxTransactionsPerHour ||
        (d.lastActionAt && Date.now() - d.lastActionAt < c.risk.cooldownSeconds * 1000)
      )
        throw new Error('Owner transaction rate or cooldown limit reached');
      if (
        d.failureStreak >= c.risk.maxRepeatedFailures ||
        (d.lastFailureAt && Date.now() - d.lastFailureAt < c.risk.failureCooldownSeconds * 1000)
      )
        throw new Error('Failure breaker or cooldown requires a pause');
      row.state = 'unknown';
      row.attemptedAt = Date.now();
      d.attempts.push(row.attemptedAt);
      d.lastActionAt = row.attemptedAt;
    });
  }
}
