import { normalizeCandles } from '../packages/market-data';
import { normalizeMarket } from '../packages/dreamdex-adapter';
import { analyze } from '../packages/opportunity-scoring';
import { defaultAgentConfig } from '../packages/agent-engine/config';
import { initialLedger, paperAccount } from '../packages/agent-engine/paper';
import type { AgentObservation, AgentRuntime } from '../packages/agent-engine/types';
import type { MarketDetail } from '../packages/shared-types';
import type { PerpMarket } from '@somnia-chain/markets-sdk';
import probe from '../docs/probe-results.json' with { type: 'json' };
export const agentNow = 1800000000000;
export function agentFixture() {
  const original = Date.parse(probe.checkedAt),
    shift = Math.floor((agentNow - original) / 900000) * 900;
  const m = normalizeMarket(probe.markets.data.find((m) => m.baseSymbol === 'BTC')! as PerpMarket);
  const h = normalizeCandles(
    probe.candles900.data.map((c) => ({
      market: m.id,
      time: Number(c.bucketStart) + shift,
      open: Number(c.openPrice) / 1e18,
      high: Number(c.high) / 1e18,
      low: Number(c.low) / 1e18,
      close: Number(c.closePrice) / 1e18,
      volume: Number(c.baseVolume) / 1e8,
      timeframe: '15m' as const,
      source: 'CAPTURED PERP FILLS — TEST FIXTURE WITH SHIFTED CLOCK',
      fetchedAt: agentNow,
      complete: Number(c.bucketStart) + 900 <= original / 1000,
    })),
    '15m',
    agentNow,
  );
  const mark = h.candles.at(-1)!.close;
  const detail: MarketDetail = {
    market: { ...m, markPrice: mark, markUpdatedAt: agentNow },
    candles: h.candles,
    quality: { ...h.quality, stale: false },
    analysis: analyze(h.candles),
    book: {
      bids: [{ price: mark * 0.9999, quantity: 1 }],
      asks: [{ price: mark * 1.0001, quantity: 1 }],
      fetchedAt: agentNow,
      source: 'TEST ONLY depth',
    },
    timeframes: {},
  };
  const config = defaultAgentConfig(m.id, '11111111-1111-4111-8111-111111111111');
  config.conditions = {
    ...config.conditions,
    requireEMA: false,
    requireMACD: false,
    requireRSI: false,
    adxMin: 0,
    minCoverage: 0,
    atrMaxPct: 50,
  };
  const ledger = initialLedger(config, agentNow),
    account = paperAccount(config, ledger, agentNow);
  const runtime: AgentRuntime = {
    status: 'simulating',
    cursor: 0,
    leaseValid: true,
    controlAvailable: true,
    unknownIntent: false,
    consecutiveFailures: 0,
    transactionTimes: [],
  };
  const observation: AgentObservation = {
    detail,
    frames: { '15m': detail },
    account,
    chainId: 50383,
    block: '100',
    indexerReliable: true,
    observedAt: agentNow,
  };
  return { config, ledger, runtime, detail, observation, account };
}
