import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { evaluateAgent } from '../../../packages/agent-engine';
import { markPaper, advancePaper, paperAccount } from '../../../packages/agent-engine/paper';
import type { AgentConfig } from '../../../packages/agent-engine/config';
import type { AgentObservation } from '../../../packages/agent-engine/types';
import { AgentStore, type WorkerLease } from '../../../packages/agent-store';
import { sharedAccount, monitorWorkspace } from '../../../packages/workspace';
import { recordAction } from '../../../packages/agent-engine/runtime';
export class AgentWorker {
  lease?: WorkerLease;
  stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  private evaluating = false;
  constructor(
    readonly store: AgentStore,
    readonly observe: (config: AgentConfig) => Promise<AgentObservation>,
    readonly options: {
      workerId?: string;
      ttl?: number;
      dataTimeoutMs?: number;
      clock?: () => number;
    } = {},
  ) {}
  now() {
    return this.options.clock?.() ?? Date.now();
  }
  start() {
    this.lease =
      this.store.acquire(
        this.options.workerId ?? randomUUID(),
        this.now(),
        this.options.ttl ?? 45000,
      ) ?? undefined;
    if (!this.lease)
      throw new Error(
        'Another worker owns the durable lease; this process will not evaluate or execute',
      );
    this.store.heartbeat(this.lease, this.now(), 'recovering');
    const pending = this.store.unresolved();
    for (const a of this.store.list())
      if (pending.some((i) => i.agentId === a.config.id))
        this.store.fail(
          this.lease,
          a.config.id,
          'Unresolved execution intent restored; manual reconciliation is required',
          this.now(),
        );
    this.store.acknowledge(this.lease, this.now());
    this.store.heartbeat(this.lease, this.now(), 'idle');
  }
  startHeartbeat() {
    this.timer = setInterval(() => {
      try {
        if (!this.lease || !this.store.renew(this.lease, this.now(), this.options.ttl ?? 45000))
          throw new Error('Worker lease lost');
        this.store.acknowledge(this.lease, this.now());
        this.store.heartbeat(this.lease, this.now(), this.evaluating ? 'observing' : 'idle');
      } catch {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
      }
    }, 5000);
  }
  async cycle() {
    if (this.evaluating) throw new Error('An agent observation is already in flight');
    if (this.stopped || !this.lease || !this.store.owns(this.lease, this.now()))
      throw new Error('Worker stopped or lease unavailable');
    this.store.acknowledge(this.lease, this.now());
    for (const record of this.store
      .list()
      .filter((a) => ['simulating', 'awaiting-authorization'].includes(a.runtime.status))) {
      if (this.stopped) break;
      const config = record.config;
      if (config.mode === 'AUTONOMOUS_TESTNET') {
        this.store.fail(
          this.lease,
          config.id,
          'Live/assisted activation is disabled for this read-only worker',
          this.now(),
        );
        continue;
      }
      this.evaluating = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const observation = await Promise.race([
          this.observe(config),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Market/account observation timed out; agent paused')),
              this.options.dataTimeoutMs ?? 20000,
            );
          }),
        ]);
        if (this.stopped || !this.store.owns(this.lease, this.now()))
          throw new Error('Worker lease lost during observation');
        const now = this.now();
        if (!observation.detail) throw new Error('Market detail unavailable');
        if (
          !/^\d+$/.test(observation.block) ||
          (record.runtime.blockCursor &&
            BigInt(observation.block) < BigInt(record.runtime.blockCursor))
        )
          throw new Error('Chain cursor moved backwards or became unavailable');
        if (!observation.indexerReliable || this.store.unresolved(config.id).length)
          throw new Error('Unreliable indexer or unresolved submission prevents paper execution');
        let ledger = markPaper(config, record.ledger, observation.detail, now);
        // Fill previously resting paper orders before evaluating fresh exposure and risk.
        const preRisk = paperAccount(config, ledger, now);
        const paperWithinGuards =
          new Decimal(preRisk.totalExposure).lte(config.risk.maxTotalExposure) &&
          new Decimal(preRisk.sessionPnl ?? '-Infinity').gt(
            new Decimal(config.risk.maxSessionLoss).neg(),
          ) &&
          new Decimal(preRisk.dailyPnl ?? '-Infinity').gt(
            new Decimal(config.risk.maxDailyLoss).neg(),
          );
        if (paperWithinGuards)
          ledger = advancePaper(config, ledger, observation.detail, undefined, now).ledger;
        const account =
          config.mode === 'ASSISTED' || (config.strategy === 'risk-guardian' && config.ownerAddress)
            ? observation.account
            : sharedAccount(this.store, { ...record, ledger }, now);
        const runtime = {
          ...record.runtime,
          leaseValid: true,
          controlAvailable: true,
          unknownIntent: this.store.unresolved(config.id).length > 0,
        };
        // A healthy observation breaks a streak of transient read failures. Unknown intents,
        // failure cooldown and every market/account guard remain independently enforced.
        const decision = evaluateAgent(
          config,
          { ...observation, account },
          { ...runtime, consecutiveFailures: 0 },
          now,
        );
        if (
          !['DATA_UNAVAILABLE', 'PAUSE_REQUIRED'].includes(decision.type) &&
          Object.keys(decision.indicators).length
        )
          runtime.consecutiveFailures = 0;
        const previousFill = ledger.lastFillAt;
        const simulation =
          config.mode === 'DRY_RUN'
            ? advancePaper(config, ledger, observation.detail, decision, now)
            : { ledger, notes: ['Assisted observation only; per-order signing remains locked.'] };
        ledger = simulation.ledger;
        if (decision.signalKey) runtime.lastSignalKey = decision.signalKey;
        if (
          ledger.lastFillAt !== previousFill ||
          (config.mode === 'DRY_RUN' && decision.proposal && decision.risk.allowed)
        ) {
          recordAction(runtime, now);
        }
        if (config.mode === 'DRY_RUN')
          decision.paperOutcome = {
            equity: ledger.equity,
            cash: ledger.cash,
            drawdown: ledger.maxDrawdown,
            fillCount: ledger.fills.length,
            fees: ledger.fees,
            funding: ledger.funding,
          };
        const candle = observation.detail.candles.at(-1)?.time ?? runtime.cursor;
        runtime.cursor = Math.max(runtime.cursor, candle);
        runtime.blockCursor = observation.block;
        if (decision.type === 'PAUSE_REQUIRED') runtime.status = 'paused';
        if (simulation.notes.length)
          decision.rationale += ' Paper model: ' + simulation.notes.join(' ');
        const updated = {
          ...record,
          runtime,
          ledger,
          lastAccount: observation.account,
          updatedAt: now,
          lastEvaluationAt: now,
          lastError: decision.type === 'PAUSE_REQUIRED' ? decision.rationale : undefined,
        };
        this.store.commitEvaluation(this.lease, config.revision, updated, decision, now, {
          ...observation,
          account,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Observation failed';
        if (!message.includes('Control/configuration changed'))
          this.store.fail(
            this.lease,
            config.id,
            message,
            this.now(),
            record.runtime.controlGeneration ?? 0,
          );
      } finally {
        if (timer) clearTimeout(timer);
        this.evaluating = false;
      }
    }
    if (!this.stopped && this.lease && this.store.owns(this.lease, this.now()))
      this.store.heartbeat(this.lease, this.now(), 'idle');
    monitorWorkspace(this.store, this.now());
  }
  shutdown() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    try {
      if (this.lease && this.store.owns(this.lease, this.now())) {
        this.store.heartbeat(this.lease, this.now(), 'stopped');
        this.store.release(this.lease, this.now());
      }
      return true;
    } catch {
      return false;
    }
  }
}
