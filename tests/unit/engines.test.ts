import { describe, it, expect } from 'vitest';
import {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  adx,
  stochasticRsi,
  vwap,
  last,
} from '../../packages/indicator-engine';
import { pivots, zones, structure } from '../../packages/market-structure';
import { normalizeCandles, aggregateCandles, AsyncCache } from '../../packages/market-data';
import { analyze, matchesPreset } from '../../packages/opportunity-scoring';
import { planTrade, toRaw, fromRaw, estimateFill } from '../../packages/risk-engine';
import { transition } from '../../packages/trade-planner/lifecycle';
import type { Candle, Market, PlanInput } from '../../packages/shared-types';
// Analytical fixtures are test-only. Production never imports these observations.
const fixture = (x: number[], step = 60): Candle[] =>
  x.map((v, i) => ({
    market: 'test',
    time: 1700000040 + i * step,
    open: v,
    high: v + 1,
    low: v - 1,
    close: v,
    volume: i + 1,
    timeframe: '1m',
    source: 'analytical test fixture',
    fetchedAt: 1700100000000,
    complete: true,
  }));
describe('indicators: independently calculable vectors', () => {
  it('SMA has exact warm-up and rolling arithmetic', () =>
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]));
  it('EMA seeds with a full SMA and uses alpha 2/(p+1)', () =>
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]));
  it('rejects invalid periods', () => expect(() => ema([1], 0)).toThrow());
  it('does not invent EMA 200 with 199 observations', () =>
    expect(last(ema(Array(199).fill(10), 200))).toBeNull());
  it('Wilder RSI matches the published 14-change worksheet example', () => {
    const prices = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21,
    ];
    const actual = rsi(prices);
    expect(actual[13]).toBeNull();
    expect(actual[14]).toBeCloseTo(70.464135, 5);
    expect(actual[15]).toBeCloseTo(66.249619, 5);
    expect(actual[20]).toBeCloseTo(62.880718, 5);
  });
  it('RSI handles flat, one-way gains and one-way losses', () => {
    expect(last(rsi(Array(30).fill(10)))).toBe(50);
    expect(last(rsi(Array.from({ length: 30 }, (_, i) => i + 1)))).toBe(100);
    expect(last(rsi(Array.from({ length: 30 }, (_, i) => 40 - i)))).toBe(0);
  });
  it('MACD on a linear ramp has 7-unit EMA spread and zero steady histogram', () => {
    const m = macd(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(m.signal[32]).toBeNull();
    expect(m.line[25]).toBeCloseTo(7);
    expect(m.signal[33]).toBeCloseTo(7);
    expect(last(m.histogram)).toBeCloseTo(0);
  });
  it('Bollinger uses population deviation (sqrt(2) for 1…5)', () => {
    const b = bollinger([1, 2, 3, 4, 5], 5);
    expect(last(b.middle)).toBe(3);
    expect(last(b.upper)).toBeCloseTo(3 + 2 * Math.sqrt(2));
    expect(last(b.lower)).toBeCloseTo(3 - 2 * Math.sqrt(2));
  });
  it('constant Bollinger bands avoid a zero denominator', () => {
    const b = bollinger(Array(20).fill(5));
    expect(last(b.width)).toBe(0);
    expect(last(b.position)).toBe(0.5);
  });
  it('ATR uses gaps against the previous close and Wilder smoothing', () => {
    const c = fixture([12, 16, 14, 18]);
    c[0] = { ...c[0], high: 14, low: 10 };
    c[1] = { ...c[1], high: 17, low: 15 };
    c[2] = { ...c[2], high: 16, low: 13 };
    c[3] = { ...c[3], high: 20, low: 17 };
    expect(atr(c, 2)).toEqual([null, null, 4, 5]);
  });
  it('ADX needs 2p bars and reaches 100 on a monotonic trend', () => {
    const a = adx(fixture(Array.from({ length: 40 }, (_, i) => i + 10)));
    expect(a[26]).toBeNull();
    expect(a[27]).toBeCloseTo(100);
    expect(last(a)).toBeCloseTo(100);
  });
  it('Stoch RSI warm-up and flat-market behavior', () => {
    const s = stochasticRsi(Array(40).fill(5));
    expect(s.k[28]).toBeNull();
    expect(s.k[29]).toBe(50);
    expect(s.d[30]).toBeNull();
    expect(s.d[31]).toBe(50);
  });
  it('VWAP uses verified volume and resets on UTC day boundaries', () => {
    const c = fixture([10, 20]);
    c[0].volume = 1;
    c[1].volume = 3;
    expect(last(vwap(c))).toBe(17.5);
    delete c[1].volume;
    expect(last(vwap(c))).toBeNull();
  });
  it('calculations are prefix-invariant, preventing future-bar lookahead', () => {
    const x = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i) * 10 + i / 5);
    for (const calc of [
      (x: number[]) => ema(x, 20),
      (x: number[]) => rsi(x),
      (x: number[]) => macd(x).histogram,
      (x: number[]) => bollinger(x).upper,
    ])
      expect(calc(x).slice(0, 70)).toEqual(calc(x.slice(0, 70)));
  });
});
describe('candle quality and compatible aggregation', () => {
  it('sorts, deduplicates and excludes unfinished candles', () => {
    const c = fixture([10, 11, 12]);
    c[2].complete = false;
    const r = normalizeCandles([c[1], c[0], c[0], c[2]], '1m', 1700000300000);
    expect(r.candles.map((c) => c.close)).toEqual([10, 11]);
    expect(r.quality.discarded).toBe(2);
  });
  it('does not bridge missing intervals in indicator input', () => {
    const c = fixture([10, 11, 12, 13]);
    const r = normalizeCandles([c[0], c[2], c[3]], '1m', 1700000340000);
    expect(r.quality.gaps).toBe(1);
    expect(r.candles.map((c) => c.close)).toEqual([12, 13]);
  });
  it('rejects negative volume, bad OHLC and misaligned timestamps', () => {
    const c = fixture([10, 11, 12]);
    c[0].volume = -1;
    c[1].high = 5;
    c[2].time++;
    expect(normalizeCandles(c, '1m').candles).toHaveLength(0);
  });
  it('never treats the current bucket as completed history', () => {
    const c = fixture([10, 11]);
    const now = (c[1].time + 10) * 1000;
    expect(normalizeCandles(c, '1m', now).candles).toHaveLength(1);
  });
  it('aggregates only whole UTC-aligned buckets', () => {
    const c = fixture([10, 11, 12, 13, 14]);
    c.forEach((v, i) => (v.time = 1700000100 + i * 60));
    const a = aggregateCandles(c, '5m');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      open: 10,
      close: 14,
      high: 15,
      low: 9,
      volume: 15,
      timeframe: '5m',
    });
    expect(aggregateCandles(c.slice(1), '5m')).toHaveLength(0);
  });
  it('rejects mixed source/market aggregation', () => {
    const c = fixture([10, 11]);
    c[1].source = 'other';
    expect(() => aggregateCandles(c, '5m')).toThrow();
  });
  it('marks stale history explicitly', () =>
    expect(normalizeCandles(fixture([10]), '1m', 1701000000000).quality.stale).toBe(true));
  it('coalesces concurrent cache fetches', async () => {
    let calls = 0;
    const cache = new AsyncCache<number>();
    const fetcher = async () => ++calls;
    expect(await Promise.all([cache.get('x', fetcher), cache.get('x', fetcher)])).toEqual([1, 1]);
    expect(calls).toBe(1);
  });
});
describe('confirmed market structure and scoring', () => {
  it('waits for the pivot right-side confirmation window', () => {
    const c = fixture([10, 12, 15, 12, 10]);
    expect(pivots(c.slice(0, 4), 2)).toHaveLength(0);
    expect(pivots(c, 2)[0]).toMatchObject({ type: 'high', price: 16, confirmedAt: c[4].time });
  });
  it('does not create pivots from a flat plateau', () =>
    expect(pivots(fixture(Array(30).fill(10)))).toHaveLength(0));
  it('produces zones with bounds and historical evidence', () => {
    const c = fixture([10, 11, 14, 11, 10, 11, 14.01, 11, 10, 11, 12]);
    const z = zones(c, 1, 0.01);
    expect(z.length).toBeGreaterThan(0);
    for (const v of z) {
      expect(v.high).toBeGreaterThan(v.low);
      expect(v.touches).toBeGreaterThan(0);
      expect(v.lastSeen).toBeLessThanOrEqual(c.at(-1)!.time);
    }
  });
  it('has an honest missing-pivot structure state', () =>
    expect(structure(fixture([10, 11, 12]))).toContain('Insufficient'));
  it('does not reward missing evidence or stale observations', () => {
    const c = fixture(Array.from({ length: 100 }, (_, i) => 100 + i));
    const full = analyze(c),
      missing = analyze(c.map((v) => ({ ...v, volume: undefined })));
    expect(missing.score).toBeLessThanOrEqual(full.score);
    expect(analyze(c, true).score).toBe(0);
    expect(analyze(c, true).values.rsi).toBeNull();
    expect(analyze([]).score).toBe(0);
  });
  it('score contribution equals the documented fixed weighted sum', () => {
    const a = analyze(fixture(Array.from({ length: 100 }, (_, i) => 100 + i)));
    expect(a.score).toBe(Math.round(a.factors.reduce((s, f) => s + (f.value ?? 0) * f.weight, 0)));
    expect(a.factors.reduce((s, f) => s + f.weight, 0)).toBe(100);
  });
  it('unavailable markets cannot pass technical presets', () =>
    expect(matchesPreset(analyze([], true), 'Trending markets')).toBe(false));
});
const m: Market = {
  id: '0x1111111111111111111111111111111111111111',
  poolAddress: '0x1111111111111111111111111111111111111111',
  marginBank: '0x2222222222222222222222222222222222222222',
  quoteToken: '0x3333333333333333333333333333333333333333',
  symbol: 'TEST-PERP',
  baseSymbol: 'TEST',
  baseDecimals: 8,
  quoteDecimals: 18,
  tickSize: '100000000000000000',
  lotSize: '10000',
  minQuantity: '10000',
  maxLeverage: 20,
};
const input: PlanInput = {
  marketId: m.id,
  side: 'long',
  type: 'limit',
  entry: '100',
  stop: '95',
  target: '110',
  riskBudget: '10',
  collateral: '100',
  leverage: '5',
  slippageBps: '10',
};
describe('risk, raw precision and order lifecycle', () => {
  it('converts 24-decimal amounts without precision loss', () => {
    const value = '0.000000000000000000000001';
    expect(toRaw(value, 24)).toBe(1n);
    expect(fromRaw(1n, 24)).toBe(value);
  });
  it('rejects scientific notation, excess precision and negative amounts', () => {
    for (const v of ['1e6', '-1', '0.000000001', 'NaN']) expect(() => toRaw(v, 8)).toThrow();
  });
  it('rounds risk-based size down to lots and includes adverse slippage', () => {
    const p = planTrade(input, m);
    expect(p.errors).toEqual([]);
    expect(BigInt(p.rawQuantity) % BigInt(m.lotSize)).toBe(0n);
    expect(Number(p.quantity)).toBeCloseTo(10 / 5.195, 3);
    expect(Number(p.loss)).toBeLessThanOrEqual(10);
    expect(Number(p.rr)).toBeGreaterThan(1);
  });
  it('blocks invalid long/short stops and targets', () => {
    expect(planTrade({ ...input, stop: '101' }, m).errors.join()).toContain('Stop');
    expect(planTrade({ ...input, side: 'short' }, m).errors.join()).toContain('Stop');
    expect(planTrade({ ...input, target: '90' }, m).errors.join()).toContain('Target');
  });
  it('enforces tick, minimum size, margin, leverage and explicit risk', () => {
    expect(planTrade({ ...input, entry: '100.01' }, m).errors.join()).toContain('tick');
    expect(planTrade({ ...input, riskBudget: '0.0001' }, m).errors.join()).toContain('minimum');
    expect(planTrade({ ...input, collateral: '1' }, m).errors.join()).toContain('margin');
    expect(planTrade({ ...input, leverage: '21' }, m).errors.join()).toContain('leverage');
    expect(planTrade({ ...input, quantity: '10' }, m).errors.join()).toContain('loss budget');
  });
  it('prevents planning against a different pool', () =>
    expect(planTrade({ ...input, marketId: 'other' }, m).errors.join()).toContain('match'));
  it('estimates visible depth without implying full execution', () => {
    const e = estimateFill(
      {
        bids: [],
        asks: [
          { price: 100, quantity: 1 },
          { price: 110, quantity: 1 },
        ],
        source: 'test',
        fetchedAt: 0,
      },
      'long',
      3,
    );
    expect(e).toEqual({ average: 105, filled: 2, unfilled: 1, depthLimited: true });
  });
  it('never turns a confirmed transaction directly into an assumed fill', () => {
    expect(transition('pending', 'confirmed')).toBe('confirmed');
    expect(() => transition('pending', 'filled')).toThrow();
    expect(transition('confirmed', 'syncing')).toBe('syncing');
  });
});
