import Decimal from 'decimal.js';
import type { Candle, Market, MarketDetail, Timeframe } from '../shared-types';
import { intervals } from '../shared-types';
import { normalizeCandles, aggregateCandles } from '../market-data';
import { analyze } from '../opportunity-scoring';
import { agentConfigSchema, type AgentConfig } from './config';
import { evaluateAgent } from './index';
import { initialLedger, markPaper, paperAccount, applyPaperFill } from './paper';
import type { AgentRuntime } from './types';
export interface HistoryPartition {
  name: 'exploration' | 'chronological-validation';
  from: number | null;
  to: number | null;
  evaluatedCandles: number;
  candidates: number;
  simulatedFills: number;
  closedTrades: number;
  averageClosedNetOutcome: string | null;
  wins: number;
  losses: number;
  winLossRatio: number | null;
  maxAdverseExcursion: string;
  maxDrawdown: string;
  netEquityChange: string;
  fees: string;
  funding: string;
  blocked: number;
  unfilled: number;
}
export interface HistoricalReport {
  schemaVersion: 1;
  agentId: string;
  configRevision: number;
  generatedAt: number;
  kind: 'HISTORICAL_SIMULATION';
  source: string;
  sample: {
    from: number | null;
    to: number | null;
    availableCandles: number;
    usableCandles: number;
    timeframe: Timeframe;
  };
  partitions: HistoryPartition[];
  assumptions: AgentConfig['paper'];
  limitations: string[];
  decisions: { at: number; type: string; rationale: string; signalKey?: string }[];
}
export function evaluateHistory(
  input: AgentConfig,
  market: Market,
  inputCandles: Candle[],
  now = Date.now(),
): HistoricalReport {
  const config = agentConfigSchema.parse(input),
    tf = config.timeframes[0];
  if (
    inputCandles.some(
      (c) => c.market.toLowerCase() !== config.marketId.toLowerCase() || c.timeframe !== tf,
    )
  )
    throw new Error('Historical input must belong to the configured perp market/timeframe');
  const normalized = normalizeCandles(inputCandles, tf, now),
    candles = normalized.candles;
  const warmup = Math.max(50, config.conditions.emaSlow),
    split = Math.max(warmup, Math.floor(candles.length * 0.7));
  const decisions: HistoricalReport['decisions'] = [];
  const historicalDetail = (
    prefix: Candle[],
    at: number,
    _timeframe: Timeframe = tf,
  ): MarketDetail => ({
    market: { ...market, markPrice: prefix.at(-1)?.close, markUpdatedAt: at, error: undefined },
    candles: prefix,
    quality: {
      ...normalized.quality,
      source: 'HISTORICAL perp-fill candles; candle-close reference, not an oracle read',
      fetchedAt: at,
      stale: !prefix.length,
      count: prefix.length,
      lastCandle: prefix.at(-1)?.time,
    },
    analysis: analyze(prefix),
    book: null,
    timeframes: {},
  });
  function run(start: number, end: number, name: HistoryPartition['name']): HistoryPartition {
    const begin = candles[start]?.time ? candles[start].time * 1000 : now;
    let ledger = initialLedger(config, begin),
      candidates = 0,
      blocked = 0,
      unfilled = 0,
      evaluated = 0,
      maxAdverse = new Decimal(0);
    const runtime: AgentRuntime = {
      status: 'simulating',
      cursor: 0,
      leaseValid: true,
      controlAvailable: true,
      unknownIntent: false,
      consecutiveFailures: 0,
      transactionTimes: [],
    };
    for (let i = start; i + 1 < end && i + 1 < candles.length; i++) {
      const prefix = candles.slice(0, i + 1),
        bar = candles[i],
        next = candles[i + 1],
        at = (bar.time + intervals[tf]) * 1000;
      const d = historicalDetail(prefix, at);
      ledger = markPaper(config, ledger, d, at);
      if (ledger.position) {
        const adverse = new Decimal(ledger.position.entryPrice)
          .minus(ledger.position.side === 'long' ? bar.low : bar.high)
          .mul(ledger.position.side === 'long' ? 1 : -1)
          .mul(ledger.position.quantity);
        maxAdverse = Decimal.max(maxAdverse, adverse, 0);
      }
      const frames: Partial<Record<Timeframe, MarketDetail>> = { [tf]: d };
      for (const frame of config.timeframes.slice(1)) {
        if (intervals[frame] < intervals[tf] || intervals[frame] % intervals[tf] !== 0) continue;
        const closed = aggregateCandles(prefix, frame).filter(
          (c) => (c.time + intervals[frame]) * 1000 <= at,
        );
        frames[frame] = historicalDetail(closed, at, frame);
      }
      const decision = evaluateAgent(
        { ...config, mode: 'DRY_RUN' },
        {
          detail: d,
          frames,
          account: paperAccount(config, ledger, at),
          chainId: 50383,
          block: 'HISTORICAL — no chain block asserted',
          indexerReliable: true,
          observedAt: at,
          historical: true,
        },
        runtime,
        at,
      );
      evaluated++;
      if (
        decision.type === 'BLOCKED' ||
        decision.type === 'PAUSE_REQUIRED' ||
        decision.type === 'DATA_UNAVAILABLE'
      )
        blocked++;
      decisions.push({
        at,
        type: decision.type,
        rationale: decision.rationale,
        signalKey: decision.signalKey,
      });
      const p = decision.proposal;
      if (
        !p ||
        !decision.risk.allowed ||
        !['ENTRY_CANDIDATE', 'EXIT_CANDIDATE', 'REDUCE_CANDIDATE'].includes(decision.type)
      )
        continue;
      candidates++;
      runtime.lastSignalKey = decision.signalKey;
      // No future bar volume or high/low chooses a fill. Only next open and the prior known volume.
      if (next.time !== bar.time + intervals[tf] || bar.volume === undefined || bar.volume <= 0) {
        unfilled++;
        continue;
      }
      const price = new Decimal(next.open).mul(
        new Decimal(1).plus(
          new Decimal(config.paper.slippageBps).div(10000).mul(p.side === 'long' ? 1 : -1),
        ),
      );
      if (p.side === 'long' ? price.gt(p.price) : price.lt(p.price)) {
        unfilled++;
        continue;
      }
      const lot = new Decimal(market.lotSize).div(new Decimal(10).pow(market.baseDecimals));
      const quantity = Decimal.min(
        p.quantity,
        new Decimal(bar.volume).mul(config.paper.maxVolumeParticipationPct).div(100),
      )
        .div(lot)
        .floor()
        .mul(lot);
      if (
        quantity.lt(new Decimal(market.minQuantity).div(new Decimal(10).pow(market.baseDecimals)))
      ) {
        unfilled++;
        continue;
      }
      applyPaperFill(
        config,
        ledger,
        p,
        quantity.toFixed(),
        price.toFixed(),
        decision.id,
        next.time * 1000,
      );
      runtime.lastActionAt = next.time * 1000;
      runtime.cursor = bar.time;
    }
    const last = start < end ? candles[Math.min(end - 1, candles.length - 1)] : undefined;
    if (last)
      ledger = markPaper(
        config,
        ledger,
        historicalDetail(
          candles.slice(0, candles.indexOf(last) + 1),
          (last.time + intervals[tf]) * 1000,
        ),
        (last.time + intervals[tf]) * 1000,
      );
    return {
      name,
      from: candles[start]?.time ?? null,
      to: last?.time ?? null,
      evaluatedCandles: evaluated,
      candidates,
      simulatedFills: ledger.fills.length,
      closedTrades: ledger.closedTrades,
      averageClosedNetOutcome: ledger.closedTrades
        ? new Decimal(ledger.closedNetPnl).div(ledger.closedTrades).toFixed()
        : null,
      wins: ledger.wins,
      losses: ledger.losses,
      winLossRatio: ledger.losses ? ledger.wins / ledger.losses : null,
      maxAdverseExcursion: maxAdverse.toFixed(),
      maxDrawdown: ledger.maxDrawdown,
      netEquityChange: new Decimal(ledger.equity).minus(ledger.initialEquity).toFixed(),
      fees: ledger.fees,
      funding: ledger.funding,
      blocked,
      unfilled,
    };
  }
  return {
    schemaVersion: 1,
    agentId: config.id,
    configRevision: config.revision,
    generatedAt: now,
    kind: 'HISTORICAL_SIMULATION',
    source: normalized.quality.source,
    sample: {
      from: candles[0]?.time ?? null,
      to: candles.at(-1)?.time ?? null,
      availableCandles: inputCandles.length,
      usableCandles: candles.length,
      timeframe: tf,
    },
    partitions: [
      run(warmup, split, 'exploration'),
      run(Math.max(warmup, split), candles.length, 'chronological-validation'),
    ],
    assumptions: { ...config.paper },
    limitations: [
      ...normalized.quality.notes,
      'Exploration and chronological validation use separate paper ledgers and fixed user parameters; no predictive accuracy or expected return is established.',
      'Entries/exits use the next actual bar open plus adverse configured slippage, only within the reviewed bound. The prior completed bar volume caps participation; it does not prove liquidity at the next open.',
      'No historical order book/queue is available. Liquidity-required breakout signals remain unavailable, and unfilled limit proposals are not given favorable intrabar or maker fills.',
      'Stops/targets are watched at completed-candle observations and are not native protective orders. Gaps can exceed planned losses.',
      'Funding is a constant user assumption, not reconstructed historical settlement. Network gas and liquidation are not simulated.',
      'Guardian historical evaluation observes its paper ledger, not a reconstructed historical real account. Insufficient warm-up or compatible higher-timeframe history withholds candidates.',
    ],
    decisions: decisions.slice(-1000),
  };
}
