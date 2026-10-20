import type { Candle } from '../shared-types';
export type Series = (number | null)[];
const blank = (n: number): Series => Array(n).fill(null);
function period(p: number) {
  if (!Number.isInteger(p) || p < 1) throw new Error('Period must be a positive integer');
}
export function sma(x: number[], p: number): Series {
  period(p);
  const o = blank(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= p) s -= x[i - p];
    if (i >= p - 1) o[i] = s / p;
  }
  return o;
}
export function ema(x: number[], p: number): Series {
  period(p);
  const o = blank(x.length);
  if (x.length < p) return o;
  let v = x.slice(0, p).reduce((a, b) => a + b, 0) / p;
  o[p - 1] = v;
  for (let i = p; i < x.length; i++) {
    v += ((x[i] - v) * 2) / (p + 1);
    o[i] = v;
  }
  return o;
}
export function rma(x: number[], p: number): Series {
  period(p);
  const o = blank(x.length);
  if (x.length < p) return o;
  let v = x.slice(0, p).reduce((a, b) => a + b, 0) / p;
  o[p - 1] = v;
  for (let i = p; i < x.length; i++) {
    v = (v * (p - 1) + x[i]) / p;
    o[i] = v;
  }
  return o;
}
export function rsi(x: number[], p = 14): Series {
  period(p);
  const o = blank(x.length);
  const gains: number[] = [],
    losses: number[] = [];
  for (let i = 1; i < x.length; i++) {
    gains.push(Math.max(0, x[i] - x[i - 1]));
    losses.push(Math.max(0, x[i - 1] - x[i]));
  }
  const g = rma(gains, p),
    l = rma(losses, p);
  for (let i = p; i < x.length; i++) {
    const a = g[i - 1]!,
      b = l[i - 1]!;
    o[i] = a === 0 && b === 0 ? 50 : b === 0 ? 100 : 100 - 100 / (1 + a / b);
  }
  return o;
}
export function macd(x: number[], fast = 12, slow = 26, sig = 9) {
  if (fast >= slow) throw new Error('Fast period must be below slow');
  const f = ema(x, fast),
    s = ema(x, slow);
  const line = x.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const seed = line.findIndex((v) => v !== null);
  const signal = blank(x.length);
  if (seed >= 0) {
    const e = ema(line.slice(seed) as number[], sig);
    e.forEach((v, i) => (signal[seed + i] = v));
  }
  return {
    line,
    signal,
    histogram: line.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i]! : null)),
  };
}
export function bollinger(x: number[], p = 20, m = 2) {
  const middle = sma(x, p),
    upper = blank(x.length),
    lower = blank(x.length),
    width = blank(x.length),
    position = blank(x.length);
  for (let i = p - 1; i < x.length; i++) {
    const mean = middle[i]!;
    const sd = Math.sqrt(x.slice(i - p + 1, i + 1).reduce((s, v) => s + (v - mean) ** 2, 0) / p);
    upper[i] = mean + m * sd;
    lower[i] = mean - m * sd;
    width[i] = mean === 0 ? null : ((2 * m * sd) / mean) * 100;
    position[i] = sd === 0 ? 0.5 : (x[i] - lower[i]!) / (upper[i]! - lower[i]!);
  }
  return { middle, upper, lower, width, position };
}
export function trueRange(c: Candle[]): number[] {
  return c
    .slice(1)
    .map((v, i) =>
      Math.max(v.high - v.low, Math.abs(v.high - c[i].close), Math.abs(v.low - c[i].close)),
    );
}
export function atr(c: Candle[], p = 14): Series {
  return [null, ...rma(trueRange(c), p)].slice(0, c.length);
}
export function adx(c: Candle[], p = 14): Series {
  period(p);
  const tr = trueRange(c),
    plus: number[] = [],
    minus: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high,
      down = c[i - 1].low - c[i].low;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
  }
  const t = rma(tr, p),
    a = rma(plus, p),
    b = rma(minus, p),
    dx: number[] = [];
  for (let i = p - 1; i < tr.length; i++) {
    const pd = t[i] === 0 ? 0 : (100 * a[i]!) / t[i]!,
      md = t[i] === 0 ? 0 : (100 * b[i]!) / t[i]!;
    dx.push(pd + md === 0 ? 0 : (100 * Math.abs(pd - md)) / (pd + md));
  }
  const result = blank(c.length);
  rma(dx, p).forEach((v, i) => {
    result[i + p] = v;
  });
  return result;
}
export function stochasticRsi(x: number[], p = 14, window = 14, k = 3, d = 3) {
  const rs = rsi(x, p),
    raw: number[] = [];
  for (let i = p + window - 1; i < x.length; i++) {
    const w = rs.slice(i - window + 1, i + 1) as number[],
      min = Math.min(...w),
      max = Math.max(...w);
    raw.push(max === min ? 50 : (100 * (rs[i]! - min)) / (max - min));
  }
  const ks = blank(x.length),
    ds = blank(x.length),
    start = p + window - 1;
  const sm = sma(raw, k);
  sm.forEach((v, i) => (ks[start + i] = v));
  const smooth = sma(sm.slice(k - 1) as number[], d);
  smooth.forEach((v, i) => (ds[start + k - 1 + i] = v));
  return { k: ks, d: ds };
}
export function vwap(c: Candle[]): Series {
  let pv = 0,
    vol = 0,
    day = -1;
  return c.map((v) => {
    if (v.volume === undefined) return null;
    const current = Math.floor(v.time / 86400);
    if (current !== day) {
      pv = 0;
      vol = 0;
      day = current;
    }
    pv += ((v.high + v.low + v.close) / 3) * v.volume;
    vol += v.volume;
    return vol > 0 ? pv / vol : null;
  });
}
export const last = (s: Series): number | null => (s.length ? s[s.length - 1] : null);
