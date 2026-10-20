import { intervals, type Candle, type Timeframe, type Quality } from '../shared-types';
export function normalizeCandles(
  input: Candle[],
  timeframe: Timeframe,
  now = Date.now(),
): { candles: Candle[]; quality: Quality } {
  const byTime = new Map<number, Candle>();
  let discarded = 0;
  const step = intervals[timeframe];
  for (const c of input) {
    if (
      c.timeframe !== timeframe ||
      ![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) ||
      !Number.isInteger(c.time) ||
      c.time % step !== 0 ||
      c.low <= 0 ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close) ||
      (c.volume !== undefined && (!Number.isFinite(c.volume) || c.volume < 0)) ||
      !c.complete ||
      c.time + step > now / 1000
    ) {
      discarded++;
      continue;
    }
    if (byTime.has(c.time)) discarded++;
    byTime.set(c.time, c);
  }
  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  let gaps = 0;
  for (let i = 1; i < candles.length; i++)
    gaps += Math.max(0, (candles[i].time - candles[i - 1].time) / step - 1);
  const tail = candles.at(-1);
  const stale = !tail || now / 1000 - (tail.time + step) > step * 2;
  const notes: string[] = [];
  if (discarded) notes.push(`${discarded} duplicate, invalid or unfinished observations excluded.`);
  if (gaps) notes.push(`${gaps} missing intervals; no interpolation applied.`);
  if (stale) notes.push('History is missing or stale. Analysis is disabled.');
  // A contiguous suffix prevents gaps from being treated as equally spaced observations.
  let start = 0;
  for (let i = 1; i < candles.length; i++)
    if (candles[i].time - candles[i - 1].time !== step) start = i;
  if (start)
    notes.push(`Indicators use the contiguous suffix of ${candles.length - start} candles.`);
  return {
    candles: candles.slice(start),
    quality: {
      source: tail?.source ?? 'dreamDEX Hideki perpetual indexer',
      fetchedAt: now,
      lastCandle: tail?.time,
      count: candles.length - start,
      gaps,
      discarded,
      stale,
      notes,
    },
  };
}
export function aggregateCandles(c: Candle[], target: Timeframe): Candle[] {
  if (!c.length) return [];
  const source = c[0].timeframe,
    step = intervals[source],
    dest = intervals[target];
  if (dest < step || dest % step !== 0) throw new Error('Incompatible candle intervals');
  if (c.some((v) => v.timeframe !== source || v.market !== c[0].market || v.source !== c[0].source))
    throw new Error('Cannot aggregate mixed markets, sources or intervals');
  const buckets = new Map<number, Candle[]>();
  for (const v of c) {
    const t = Math.floor(v.time / dest) * dest;
    const b = buckets.get(t) ?? [];
    b.push(v);
    buckets.set(t, b);
  }
  return [...buckets]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([time, b]) => {
      b.sort((a, z) => a.time - z.time);
      if (b.length !== dest / step || b.some((v, i) => !v.complete || v.time !== time + i * step))
        return [];
      return [
        {
          ...b[0],
          time,
          timeframe: target,
          open: b[0].open,
          close: b.at(-1)!.close,
          high: Math.max(...b.map((v) => v.high)),
          low: Math.min(...b.map((v) => v.low)),
          volume: b.every((v) => v.volume !== undefined)
            ? b.reduce((s, v) => s + v.volume!, 0)
            : undefined,
        },
      ];
    });
}
export class AsyncCache<T> {
  private values = new Map<string, { data: T; at: number }>();
  private pending = new Map<string, Promise<T>>();
  constructor(private ttl = 15000) {}
  async get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && Date.now() - cached.at < this.ttl) return cached.data;
    let p = this.pending.get(key);
    if (!p) {
      p = fetcher()
        .then((data) => {
          this.values.set(key, { data, at: Date.now() });
          return data;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }
}
export async function retry<T>(f: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
}
