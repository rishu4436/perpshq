import type { Candle, Zone } from '../shared-types';
export interface Pivot {
  price: number;
  time: number;
  confirmedAt: number;
  type: 'high' | 'low';
  index: number;
}
export function pivots(c: Candle[], lookback = 3): Pivot[] {
  if (lookback < 1 || !Number.isInteger(lookback)) throw new Error('Invalid pivot lookback');
  const result: Pivot[] = [];
  for (let i = lookback; i < c.length - lookback; i++) {
    const w = c.slice(i - lookback, i + lookback + 1);
    if (w.every((v, j) => j === lookback || v.high < c[i].high))
      result.push({
        price: c[i].high,
        time: c[i].time,
        confirmedAt: c[i + lookback].time,
        type: 'high',
        index: i,
      });
    if (w.every((v, j) => j === lookback || v.low > c[i].low))
      result.push({
        price: c[i].low,
        time: c[i].time,
        confirmedAt: c[i + lookback].time,
        type: 'low',
        index: i,
      });
  }
  return result;
}
export function structure(c: Candle[], lookback = 3) {
  const p = pivots(c, lookback),
    h = p.filter((v) => v.type === 'high').slice(-2),
    l = p.filter((v) => v.type === 'low').slice(-2);
  if (h.length < 2 || l.length < 2) return 'Insufficient confirmed pivots';
  if (h[1].price > h[0].price && l[1].price > l[0].price) return 'Higher highs / higher lows';
  if (h[1].price < h[0].price && l[1].price < l[0].price) return 'Lower highs / lower lows';
  return 'Consolidation / transition';
}
export function zones(c: Candle[], lookback = 3, tolerance = 0.003): Zone[] {
  if (!c.length) return [];
  const price = c.at(-1)!.close,
    groups: Pivot[][] = [];
  for (const p of pivots(c, lookback).filter((v) => v.index >= c.length - 250)) {
    const g = groups.find(
      (g) =>
        Math.abs(p.price - g.reduce((s, v) => s + v.price, 0) / g.length) / p.price <= tolerance,
    );
    if (g) g.push(p);
    else groups.push([p]);
  }
  return groups
    .flatMap((g) => {
      const lo = Math.min(...g.map((v) => v.price)) * (1 - tolerance / 2),
        hi = Math.max(...g.map((v) => v.price)) * (1 + tolerance / 2),
        lastSeen = Math.max(...g.map((v) => v.confirmedAt));
      if (lo <= price && hi >= price) return [];
      const kind = hi < price ? 'support' : 'resistance'; // Invalidation: two completed closes through the far edge after the latest confirmation.
      const after = c.filter((v) => v.time > lastSeen);
      for (let i = 1; i < after.length; i++) {
        if (
          (kind === 'support' && after[i - 1].close < lo && after[i].close < lo) ||
          (kind === 'resistance' && after[i - 1].close > hi && after[i].close > hi)
        )
          return [];
      }
      return [
        {
          low: lo,
          high: hi,
          touches: g.length,
          lastSeen,
          strength: Math.min(
            100,
            g.length * 18 +
              Math.max(
                0,
                30 - ((c.at(-1)!.time - lastSeen) / (c.at(-1)!.time - c[0].time || 1)) * 30,
              ),
          ),
          kind,
        } as Zone,
      ];
    })
    .sort(
      (a, b) => Math.abs((a.low + a.high) / 2 - price) - Math.abs((b.low + b.high) / 2 - price),
    );
}
