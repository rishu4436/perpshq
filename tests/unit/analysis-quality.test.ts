import { it, expect } from 'vitest';
import { analyze } from '../../packages/opportunity-scoring';
import type { Candle } from '../../packages/shared-types';
const history: Candle[] = Array.from({ length: 120 }, (_, i) => {
  const close = 100 + 5 * Math.sin((i * Math.PI) / 10);
  return {
    market: 'test',
    time: 1700000040 + i * 60,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
    timeframe: '1m',
    source: 'ANALYTICAL TEST ONLY',
    fetchedAt: 1700010000000,
    complete: true,
  };
});
it('does not leak stale confirmed levels through scenario or assistant explanations', () => {
  expect(analyze(history).zones.length).toBeGreaterThan(0);
  const a = analyze(history, true);
  expect(a.scenarios.bullish).toMatch(/unavailable.*stale/i);
  expect(a.scenarios.bearish).toMatch(/unavailable.*stale/i);
  expect(a.structure).toMatch(/unavailable/i);
  expect(a.zones).toEqual([]);
  expect(a.explanations).toHaveLength(6);
  expect(a.explanations.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
});
it('withholds actionable levels until the core trend has 50 completed observations', () => {
  const a = analyze(history.slice(0, 40));
  expect(a.zones).toEqual([]);
  expect(a.scenarios.bullish).toMatch(/unavailable.*50/i);
  expect(a.scenarios.bearish).toMatch(/unavailable.*50/i);
});
it('preserves fresh, sufficiently evidenced conditional scenarios', () => {
  const a = analyze(history);
  expect(a.scenarios.bullish).toContain('completed candle');
  expect(a.scenarios.bearish).toContain('completed candle');
  expect(a.trend).not.toBe('Unavailable');
});
