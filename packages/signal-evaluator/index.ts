import type { Candle } from '../shared-types';
import { ema } from '../indicator-engine';
export interface Observation {
  time: number;
  direction: 'long' | 'short';
  netMovePct: number;
  favorablePct: number;
  adversePct: number;
  partition: 'exploration' | 'holdout';
}
export function evaluateCrossovers(c: Candle[], horizon: number, costBps: number): Observation[] {
  if (
    !Number.isInteger(horizon) ||
    horizon < 1 ||
    horizon > 48 ||
    !Number.isFinite(costBps) ||
    costBps < 0 ||
    costBps > 1000
  )
    throw new Error('Horizon must be 1–48 candles; round-trip cost must be 0–1000 bps');
  const e = ema(
      c.map((v) => v.close),
      20,
    ),
    split = Math.floor(c.length * 0.7),
    result: Observation[] = [];
  for (let i = 20; i < c.length - horizon - 1; i++) {
    const prev = c[i - 1].close - e[i - 1]!,
      now = c[i].close - e[i]!;
    const direction = prev <= 0 && now > 0 ? 'long' : prev >= 0 && now < 0 ? 'short' : null;
    if (!direction) continue;
    const entry = c[i + 1].open,
      exit = c[i + horizon].close,
      future = c.slice(i + 1, i + horizon + 1),
      mult = direction === 'long' ? 1 : -1;
    if (i < split && i + horizon >= split) continue;
    const favorable =
        direction === 'long'
          ? Math.max(...future.map((v) => v.high)) / entry - 1
          : 1 - Math.min(...future.map((v) => v.low)) / entry,
      adverse =
        direction === 'long'
          ? 1 - Math.min(...future.map((v) => v.low)) / entry
          : Math.max(...future.map((v) => v.high)) / entry - 1;
    result.push({
      time: c[i].time,
      direction,
      netMovePct: (exit / entry - 1) * 100 * mult - costBps / 100,
      favorablePct: Math.max(0, favorable * 100),
      adversePct: Math.max(0, adverse * 100),
      partition: i < split ? 'exploration' : 'holdout',
    });
  }
  return result;
}
