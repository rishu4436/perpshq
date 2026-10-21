import Decimal from 'decimal.js';
import { analyze } from '../opportunity-scoring';
import { ema } from '../indicator-engine';
import { zones } from '../market-structure';
import { intervals } from '../shared-types';
import { assessRisk, sizeProposal } from '../agent-risk';
import { agentConfigSchema, type AgentConfig } from './config';
import type { AgentDecision, AgentObservation, AgentRuntime, ProposedOrder } from './types';
export * from './config';
export type * from './types';

export function evaluateAgent(
  input: AgentConfig,
  o: AgentObservation,
  r: AgentRuntime,
  now: number,
): AgentDecision {
  const config = agentConfigSchema.parse(input),
    d = o.detail,
    c = d?.candles ?? [],
    last = c.at(-1),
    previous = c.at(-2);
  const matched: string[] = [],
    failed: string[] = [];
  const condition = (name: string, pass: boolean) => {
    (pass ? matched : failed).push(name);
    return pass;
  };
  const decision: AgentDecision = {
    id: `${config.id}:${config.revision}:${now}`,
    agentId: config.id,
    configRevision: config.revision,
    schemaVersion: 1,
    marketId: config.marketId,
    strategy: config.strategy,
    type: 'NO_ACTION',
    evaluatedAt: now,
    sourceTimestamps: {
      fetchedAt: d?.quality.fetchedAt,
      markUpdatedAt: d?.market.markUpdatedAt,
      candleTime: last?.time,
      accountAt: o.account?.observedAt,
      block: o.block,
    },
    matched,
    failed,
    indicators: {},
    rationale: 'No complete strategy condition is active.',
    risk: { allowed: false, pause: false, checks: [], limitations: [] },
    evidenceKind: o.historical
      ? 'historical'
      : config.mode === 'DRY_RUN'
        ? 'paper-observation'
        : 'assisted-proposal',
  };
  const unavailable = (message: string, type: AgentDecision['type'] = 'DATA_UNAVAILABLE') => ({
    ...decision,
    type,
    rationale: message,
    failed: [...failed, message],
  });
  if (!r.leaseValid || !r.controlAvailable || r.unknownIntent)
    return unavailable(
      'Durable worker ownership/control or transaction outcome is unresolved.',
      'PAUSE_REQUIRED',
    );
  if (o.chainId !== 50383 || !o.indexerReliable)
    return unavailable('Hideki chain/indexer synchronization is unavailable.', 'PAUSE_REQUIRED');
  if (o.error || !d || d.market.id.toLowerCase() !== config.marketId.toLowerCase())
    return unavailable(o.error ?? 'Selected market data is unavailable.');
  const maxAge = config.risk.maxDataAgeSeconds * 1000;
  if (
    d.quality.stale ||
    now - d.quality.fetchedAt > maxAge ||
    d.quality.fetchedAt > now + 1000 ||
    !d.market.markPrice ||
    d.market.error ||
    now - (d.market.markUpdatedAt ?? 0) > maxAge ||
    (d.market.markUpdatedAt ?? 0) > now + 1000
  )
    return unavailable(
      'Completed history or current oracle mark is stale/invalid.',
      'PAUSE_REQUIRED',
    );
  if (last && now / 1000 - (last.time + intervals[last.timeframe]) > 2 * intervals[last.timeframe])
    return unavailable(
      'Completed candle history is too old despite its fetch timestamp.',
      'PAUSE_REQUIRED',
    );
  if (
    c.some(
      (v) =>
        ![v.time, v.open, v.high, v.low, v.close].every(Number.isFinite) ||
        v.timeframe !== config.timeframes[0] ||
        v.time % intervals[v.timeframe] !== 0 ||
        v.low <= 0 ||
        v.high < Math.max(v.open, v.close) ||
        v.low > Math.min(v.open, v.close) ||
        !v.complete ||
        v.market.toLowerCase() !== config.marketId.toLowerCase() ||
        v.time + intervals[v.timeframe] > now / 1000,
    ) ||
    c.some((v, i) => i > 0 && v.time - c[i - 1].time !== intervals[v.timeframe])
  )
    return unavailable('Candle order, completion timing or market identity is invalid.');
  if (last && last.time < r.cursor)
    return unavailable('The completed-candle cursor moved backwards.', 'PAUSE_REQUIRED');
  if (!last || !previous || c.length < Math.max(50, config.conditions.emaSlow))
    return unavailable('Insufficient completed history for the configured indicators.');
  const a = analyze(c, false),
    v = a.values;
  decision.indicators = { ...v };
  const fast = ema(
      c.map((v) => v.close),
      config.conditions.emaFast,
    ).at(-1),
    slow = ema(
      c.map((v) => v.close),
      config.conditions.emaSlow,
    ).at(-1);
  decision.indicators.configuredFastEMA = fast ?? null;
  decision.indicators.configuredSlowEMA = slow ?? null;
  if (
    o.account?.source === 'chain' &&
    (o.account.exposureComplete !== true || o.account.errors.length)
  )
    return unavailable(
      'Authoritative account exposure is incomplete or unreconciled.',
      'PAUSE_REQUIRED',
    );
  if (
    config.strategy === 'risk-guardian' &&
    o.account?.source === 'chain' &&
    (o.account.gasSTT === null || new Decimal(o.account.gasSTT).lt(config.risk.minGasReserveSTT))
  )
    return unavailable(
      'Risk Guardian cannot rely on an unavailable/insufficient operator gas reserve.',
      'PAUSE_REQUIRED',
    );
  if (
    config.strategy !== 'risk-guardian' &&
    o.account &&
    ((o.account.sessionPnl !== null &&
      new Decimal(o.account.sessionPnl).lte(new Decimal(config.risk.maxSessionLoss).neg())) ||
      (o.account.dailyPnl !== null &&
        new Decimal(o.account.dailyPnl).lte(new Decimal(config.risk.maxDailyLoss).neg())) ||
      new Decimal(o.account.totalExposure).gt(config.risk.maxTotalExposure))
  )
    return unavailable(
      'Observed account loss/exposure circuit breaker requires a pause.',
      'PAUSE_REQUIRED',
    );
  const position = o.account?.positions.find(
    (p) => p.marketId.toLowerCase() === config.marketId.toLowerCase(),
  );
  let proposal: ProposedOrder | undefined;
  try {
    if (position) {
      const mark = new Decimal(d.market.markPrice),
        entry = new Decimal(position.entryPrice),
        long = position.side === 'long';
      const stop = position.stopPrice
        ? new Decimal(position.stopPrice)
        : entry.mul(
            new Decimal(1).plus(
              new Decimal(config.execution.stopLossPct).div(100).mul(long ? -1 : 1),
            ),
          );
      const target = position.targetPrice
        ? new Decimal(position.targetPrice)
        : entry.mul(
            new Decimal(1).plus(
              new Decimal(config.execution.takeProfitPct).div(100).mul(long ? 1 : -1),
            ),
          );
      const stopHit = long ? mark.lte(stop) : mark.gte(stop),
        targetHit = long ? mark.gte(target) : mark.lte(target);
      const opposite =
        config.execution.exitOnSignal &&
        fast != null &&
        slow != null &&
        (long ? fast < slow : fast > slow);
      const guardian = config.strategy === 'risk-guardian',
        health = o.account?.health;
      const healthClose = guardian && health != null && health < config.conditions.flattenHealth;
      const healthReduce = guardian && health != null && health < config.conditions.reduceHealth;
      const lossHit =
        guardian &&
        new Decimal(position.unrealizedPnl).lte(
          new Decimal(config.conditions.maxUnrealizedLoss).neg(),
        );
      const exposureHit =
        guardian && new Decimal(position.notional).gt(config.risk.maxMarketExposure);
      if (
        stopHit ||
        targetHit ||
        healthClose ||
        healthReduce ||
        lossHit ||
        exposureHit ||
        opposite
      ) {
        matched.push(
          stopHit
            ? 'Watched stop reached'
            : targetHit
              ? 'Watched target reached'
              : healthClose
                ? 'Flatten health threshold'
                : healthReduce
                  ? 'Reduce health threshold'
                  : lossHit
                    ? 'Unrealized loss guard'
                    : exposureHit
                      ? 'Exposure guard'
                      : 'Trend reversal exit',
        );
        const partial = healthReduce && !healthClose && !stopHit && !targetHit && !lossHit;
        proposal = sizeProposal(
          config,
          d.market,
          long ? 'short' : 'long',
          new Decimal(position.quantity).mul(partial ? 0.25 : 1).toFixed(),
          partial ? 'reduce-position' : 'close-position',
        );
        decision.type = partial ? 'REDUCE_CANDIDATE' : 'EXIT_CANDIDATE';
      } else
        return unavailable(
          'Existing position is within watched exit/guardian conditions.',
          'NO_ACTION',
        );
    } else if (config.strategy === 'risk-guardian') {
      const a = o.account;
      if (!a) return unavailable('Risk Guardian requires an observed account or paper ledger.');
      if (a.orders.length > config.risk.maxOpenOrders) {
        decision.type = 'CANCEL_CANDIDATE';
        decision.rationale =
          'Review attributable resting orders above the configured order cap; cancellation remains separately gated.';
        decision.failed = ['Open order count exceeds policy'];
        return decision;
      }
      if (
        (a.health !== null && a.health < config.risk.minHealth) ||
        (a.gasSTT !== null && new Decimal(a.gasSTT).lt(config.risk.minGasReserveSTT))
      )
        return unavailable(
          'Account health or operator gas guard requires a pause.',
          'PAUSE_REQUIRED',
        );
      return unavailable(
        'No position is present in the selected market; Guardian never seeks entries.',
        'NO_ACTION',
      );
    } else {
      const side: 'long' | 'short' =
        config.strategy === 'mean-reversion'
          ? last.close > previous.close
            ? 'long'
            : 'short'
          : config.strategy === 'support-resistance-breakout'
            ? last.close > previous.close
              ? 'long'
              : 'short'
            : fast != null && slow != null && fast > slow
              ? 'long'
              : 'short';
      condition(
        'Configured side policy',
        config.sidePolicy === 'both' ||
          config.sidePolicy === (side === 'long' ? 'long-only' : 'short-only'),
      );
      condition('Minimum indicator coverage', a.coverage >= config.conditions.minCoverage);
      condition(
        'Volatility range',
        v.atrPct !== null &&
          v.atrPct >= config.conditions.atrMinPct &&
          v.atrPct <= config.conditions.atrMaxPct,
      );
      if (config.strategy === 'multi-timeframe-trend') {
        if (config.conditions.requireEMA)
          condition(
            'EMA alignment',
            fast != null &&
              slow != null &&
              (side === 'long'
                ? last.close > fast && fast > slow
                : last.close < fast && fast < slow),
          );
        if (config.conditions.requireMACD)
          condition(
            'MACD momentum agreement',
            v.macdHistogram !== null &&
              (side === 'long' ? v.macdHistogram > 0 : v.macdHistogram < 0),
          );
        if (config.conditions.requireRSI)
          condition(
            'RSI entry range',
            v.rsi !== null &&
              (side === 'long'
                ? v.rsi >= config.conditions.rsiLongMin && v.rsi <= config.conditions.rsiLongMax
                : v.rsi >= config.conditions.rsiShortMin && v.rsi <= config.conditions.rsiShortMax),
          );
        condition('ADX trend strength', v.adx !== null && v.adx >= config.conditions.adxMin);
        let agreement = 0;
        for (const tf of config.timeframes) {
          const frame = tf === last.timeframe ? d : o.frames?.[tf];
          if (
            !frame ||
            frame.quality.stale ||
            now - frame.quality.fetchedAt > maxAge ||
            frame.quality.fetchedAt > now + 1000 ||
            frame.market.id.toLowerCase() !== config.marketId.toLowerCase() ||
            frame.candles.length < Math.max(50, config.conditions.emaSlow) ||
            now / 1000 - ((frame.candles.at(-1)?.time ?? 0) + intervals[tf]) > 2 * intervals[tf] ||
            frame.candles.some(
              (c, i) =>
                !c.complete ||
                c.timeframe !== tf ||
                c.market.toLowerCase() !== config.marketId.toLowerCase() ||
                ![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) ||
                c.time % intervals[tf] !== 0 ||
                c.low <= 0 ||
                c.high < Math.max(c.open, c.close) ||
                c.low > Math.min(c.open, c.close) ||
                c.time + intervals[tf] > now / 1000 ||
                (i > 0 && c.time - frame.candles[i - 1].time !== intervals[tf]),
            )
          )
            continue;
          const close = frame.candles.map((c) => c.close),
            f = ema(close, config.conditions.emaFast).at(-1),
            s = ema(close, config.conditions.emaSlow).at(-1);
          if (f != null && s != null && (side === 'long' ? f > s : f < s)) agreement++;
        }
        decision.indicators.timeframeAgreement = agreement;
        condition(
          'Multi-timeframe agreement',
          agreement >= config.conditions.minTimeframeAgreement,
        );
      } else if (config.strategy === 'support-resistance-breakout') {
        const prior = zones(c.slice(0, -1));
        const crossed = prior.find(
          (z) =>
            z.lastSeen <= previous.time &&
            (side === 'long'
              ? z.kind === 'resistance' && previous.close <= z.high && last.close > z.high
              : z.kind === 'support' && previous.close >= z.low && last.close < z.low),
        );
        condition('Confirmed completed-candle breakout', !!crossed);
        if (config.conditions.requireVolume) {
          const before = c.slice(-21, -1),
            average = before.every((v) => v.volume !== undefined)
              ? before.reduce((sum, v) => sum + v.volume!, 0) / before.length
              : 0;
          condition(
            'Observed volume confirmation',
            last.volume !== undefined &&
              average > 0 &&
              last.volume / average >= config.conditions.volumeRatioMin,
          );
        }
        if (config.conditions.requireLiquidity) {
          const book = d.book,
            levels = side === 'long' ? book?.asks : book?.bids;
          condition(
            'Fresh opposite-side liquidity',
            !!levels?.length &&
              !!book &&
              now - book.fetchedAt <= maxAge &&
              book.fetchedAt <= now + 1000,
          );
        }
      } else {
        const prev = analyze(c.slice(0, -1), false).values;
        condition(
          'RSI extreme/recovery',
          v.rsi !== null &&
            prev.rsi !== null &&
            (side === 'long'
              ? Math.min(v.rsi, prev.rsi) <= config.conditions.rsiOversold
              : Math.max(v.rsi, prev.rsi) >= config.conditions.rsiOverbought),
        );
        condition(
          'Bollinger extreme',
          v.bbPosition !== null &&
            prev.bbPosition !== null &&
            (side === 'long'
              ? Math.min(v.bbPosition, prev.bbPosition) <= config.conditions.bandLower
              : Math.max(v.bbPosition, prev.bbPosition) >= config.conditions.bandUpper),
        );
        condition(
          'Distance from moving average',
          fast != null && Math.abs(last.close / fast - 1) * 100 >= config.conditions.maDistancePct,
        );
        condition('Ranging ADX filter', v.adx !== null && v.adx <= config.conditions.adxMax);
        if (config.conditions.requireRecovery)
          condition(
            'Price recovery confirmation',
            v.rsi !== null &&
              prev.rsi !== null &&
              (side === 'long'
                ? last.close > previous.close && v.rsi > prev.rsi
                : last.close < previous.close && v.rsi < prev.rsi),
          );
      }
      if (failed.length) return decision;
      proposal = sizeProposal(config, d.market, side);
      decision.type = 'ENTRY_CANDIDATE';
    }
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : 'Sizing unavailable', 'BLOCKED');
  }
  if (!proposal) return decision;
  const signalKey = [config.id, config.revision, last.time, proposal.action, proposal.side].join(
    ':',
  );
  if (signalKey === r.lastSignalKey)
    return unavailable('This completed-candle decision was already processed.', 'NO_ACTION');
  decision.signalKey = signalKey;
  decision.proposal = proposal;
  decision.risk = assessRisk(config, o, r, proposal, now);
  decision.type = decision.risk.allowed
    ? decision.type
    : decision.risk.pause
      ? 'PAUSE_REQUIRED'
      : 'BLOCKED';
  decision.failed.push(...decision.risk.checks.filter((c) => !c.passed).map((c) => c.name));
  decision.rationale = decision.risk.allowed
    ? 'All enabled signal conditions and central risk checks passed. This is a proposal, not a transaction.'
    : decision.risk.checks
        .filter((c) => !c.passed)
        .map((c) => c.name + ': ' + c.detail)
        .join(' ');
  return decision;
}
