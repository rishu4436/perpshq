import { it, expect } from 'vitest';
import { evaluateCrossovers } from '../../packages/signal-evaluator';
import {
  reweight,
  analyze,
  defaultWeights,
  matchesPreset,
} from '../../packages/opportunity-scoring';
import type { Candle } from '../../packages/shared-types';
const c: Candle[] = Array.from({ length: 250 }, (_, i) => {
  const p = 100 + Math.sin(i / 5) * 10;
  return {
    market: 'test',
    time: 1700000100 + i * 900,
    open: p,
    high: p + 2,
    low: p - 2,
    close: p,
    complete: true,
    source: 'TEST ONLY',
    timeframe: '15m',
    fetchedAt: 0,
  };
});
it('historical evaluator produces only fully observed outcomes', () => {
  const result = evaluateCrossovers(c, 6, 20);
  expect(result.length).toBeGreaterThan(0);
  expect(result.every((r) => r.time < c.at(-7)!.time)).toBe(true);
  expect(result.some((r) => r.partition === 'holdout')).toBe(true);
});
it('round-trip cost is explicit and deducted in percentage points', () => {
  const zero = evaluateCrossovers(c, 6, 0),
    cost = evaluateCrossovers(c, 6, 20);
  expect(zero.length).toBe(cost.length);
  for (let i = 0; i < zero.length; i++)
    expect(zero[i].netMovePct - cost[i].netMovePct).toBeCloseTo(0.2);
});
it('constant closes produce no invented crossover signals', () =>
  expect(
    evaluateCrossovers(
      c.map((v) => ({ ...v, open: 100, close: 100, high: 101, low: 99 })),
      6,
      20,
    ),
  ).toHaveLength(0));
it('history horizon/cost validation refuses invalid inputs', () => {
  expect(() => evaluateCrossovers(c, 0, 20)).toThrow();
  expect(() => evaluateCrossovers(c, 6, -1)).toThrow();
});
it('no outcome crosses the exploration / holdout partition', () => {
  const split = c[Math.floor(c.length * 0.7)].time;
  const r = evaluateCrossovers(c, 6, 20);
  expect(
    r.filter((r) => r.partition === 'exploration').every((r) => r.time + 6 * 900 < split),
  ).toBe(true);
});
it('custom score weights keep missing evidence at zero', () => {
  const a = analyze(c);
  const weights = {
    ...defaultWeights,
    trend: 0,
    momentum: 0,
    volume: 100,
    structure: 0,
    volatility: 0,
    location: 0,
    timeframes: 0,
  };
  const r = reweight(a, weights);
  expect(r.score).toBe(0);
  expect(r.coverage).toBe(0);
});
it('volatility expansion requires a measured increase, not merely a high ATR level', () => {
  const a = analyze(c);
  a.values.atrPct = 9;
  a.values.bbWidth = 20;
  a.values.atrExpansion = 0;
  a.values.bbExpansion = -5;
  expect(matchesPreset(a, 'Volatility expansion')).toBe(false);
  a.values.atrExpansion = 11;
  expect(matchesPreset(a, 'Volatility expansion')).toBe(true);
});
