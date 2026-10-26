import type { Analysis, Candle } from '../shared-types';
import {
  ema,
  sma,
  rsi,
  macd,
  bollinger,
  atr,
  adx,
  stochasticRsi,
  vwap,
  last,
} from '../indicator-engine';
import { zones, structure } from '../market-structure';
export const defaultWeights = {
  trend: 25,
  momentum: 20,
  volume: 10,
  structure: 15,
  volatility: 10,
  location: 10,
  timeframes: 10,
};
export function reweight(a: Analysis, weights: typeof defaultWeights): Analysis {
  const keys = Object.keys(defaultWeights) as (keyof typeof defaultWeights)[],
    factors = a.factors.map((f, i) => ({ ...f, weight: Math.max(0, weights[keys[i]]) })),
    total = factors.reduce((s, f) => s + f.weight, 0) || 1;
  return {
    ...a,
    factors,
    score: Math.round((factors.reduce((s, f) => s + (f.value ?? 0) * f.weight, 0) / total) * 100),
    coverage: Math.round(
      (factors.filter((f) => f.value !== null).reduce((s, f) => s + f.weight, 0) / total) * 100,
    ),
  };
}
export function analyze(
  c: Candle[],
  stale = false,
  agreement: number | null = null,
  weights = defaultWeights,
): Analysis {
  const x = c.map((v) => v.close),
    price = x.at(-1),
    values: Record<string, number | null> = {};
  for (const p of [9, 20, 50, 100, 200]) values['ema' + p] = last(ema(x, p));
  for (const p of [20, 50, 200]) values['sma' + p] = last(sma(x, p));
  const m = macd(x),
    bb = bollinger(x),
    a = atr(c);
  values.close = price ?? null;
  values.change5 = x.length >= 6 ? (x.at(-1)! / x.at(-6)! - 1) * 100 : null;
  const earlierAtr = a.at(-6),
    earlierWidth = bb.width.at(-6);
  values.atrExpansion = earlierAtr && last(a) !== null ? (last(a)! / earlierAtr - 1) * 100 : null;
  values.bbExpansion =
    earlierWidth && last(bb.width) !== null ? (last(bb.width)! / earlierWidth - 1) * 100 : null;
  for (const p of [9, 20, 50, 100, 200]) {
    const e = ema(x, p);
    values['ema' + p + 'Slope'] =
      e.at(-2) !== null && e.at(-2) !== undefined && last(e) !== null ? last(e)! - e.at(-2)! : null;
    values['ema' + p + 'DistancePct'] =
      price && last(e) !== null ? (price / last(e)! - 1) * 100 : null;
  }
  values.rsi = last(rsi(x));
  values.macd = last(m.line);
  values.macdSignal = last(m.signal);
  values.macdHistogram = last(m.histogram);
  values.adx = last(adx(c));
  values.atr = last(a);
  values.atrPct = price && values.atr !== null ? (values.atr / price) * 100 : null;
  values.bbUpper = last(bb.upper);
  values.bbMiddle = last(bb.middle);
  values.bbLower = last(bb.lower);
  values.bbWidth = last(bb.width);
  values.bbPosition = last(bb.position);
  values.stochRsi = last(stochasticRsi(x).k);
  values.vwap = c.every((v) => v.volume !== undefined) ? last(vwap(c)) : null;
  const vols = c.map((v) => v.volume);
  const vm = vols.every((v) => v !== undefined) ? last(sma(vols as number[], 20)) : null;
  values.relativeVolume = vm && vols.at(-1)! >= 0 ? vols.at(-1)! / vm : null;
  const levelsAvailable = !stale && c.length >= 50;
  const unavailableReason = stale
    ? 'history is stale or missing'
    : '50 completed contiguous candles are required';
  const z = levelsAvailable ? zones(c) : [],
    s = levelsAvailable ? structure(c) : 'Structure unavailable: ' + unavailableReason,
    support = z.find((v) => v.kind === 'support'),
    resistance = z.find((v) => v.kind === 'resistance');
  let trend: Analysis['trend'] = 'Unavailable';
  if (values.ema20 !== null && values.ema50 !== null && price !== undefined)
    trend =
      price > values.ema20 && values.ema20 > values.ema50
        ? 'Bullish'
        : price < values.ema20 && values.ema20 < values.ema50
          ? 'Bearish'
          : 'Mixed';
  const directional = trend === 'Bullish' || trend === 'Bearish',
    momentum =
      values.macdHistogram === null
        ? null
        : trend === 'Bullish'
          ? +(values.macdHistogram > 0)
          : trend === 'Bearish'
            ? +(values.macdHistogram < 0)
            : 0.3;
  const factors: Analysis['factors'] = [
    {
      name: 'Trend alignment',
      weight: weights.trend,
      value: trend === 'Unavailable' ? null : directional ? 1 : 0.3,
      reason:
        trend === 'Unavailable'
          ? 'EMA 50 needs 50 completed contiguous candles'
          : `${trend} price / EMA 20 / EMA 50 alignment`,
    },
    {
      name: 'Momentum agreement',
      weight: weights.momentum,
      value: momentum,
      reason:
        values.macdHistogram === null
          ? 'MACD signal warming up'
          : 'MACD histogram relative to EMA trend',
    },
    {
      name: 'Volume participation',
      weight: weights.volume,
      value: values.relativeVolume === null ? null : Math.min(1, values.relativeVolume / 2),
      reason: 'Last completed volume / 20-candle average, capped at 2×',
    },
    {
      name: 'Confirmed structure',
      weight: weights.structure,
      value:
        !levelsAvailable || s.includes('Insufficient')
          ? null
          : s.includes('Consolidation')
            ? 0.3
            : 1,
      reason: s,
    },
    {
      name: 'Trend / volatility context',
      weight: weights.volatility,
      value: values.adx === null ? null : Math.min(1, values.adx / 40),
      reason: 'ADX / 40, capped; measures strength, not direction',
    },
    {
      name: 'Level evidence',
      weight: weights.location,
      value: z.length ? Math.min(1, z[0].touches / 4) : null,
      reason: z.length ? 'Nearest confirmed zone touch count / 4' : 'No confirmed zone',
    },
    {
      name: 'Timeframe agreement',
      weight: weights.timeframes,
      value: agreement,
      reason:
        agreement === null
          ? 'Additional timeframes unavailable'
          : 'Available timeframe direction agreement',
    },
  ];
  const total = factors.reduce((s, f) => s + Math.max(0, f.weight), 0) || 1;
  const score = stale
    ? 0
    : Math.round(
        (factors.reduce((s, f) => s + Math.max(0, f.weight) * (f.value ?? 0), 0) / total) * 100,
      );
  const coverage = Math.round(
    (factors.filter((f) => f.value !== null).reduce((s, f) => s + Math.max(0, f.weight), 0) /
      total) *
      100,
  );
  const regime = stale
    ? 'Data unavailable'
    : c.length < 50 || values.adx === null
      ? 'Warming up'
      : values.adx >= 25
        ? 'Directional conditions'
        : 'Range / weak trend';
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 5 });
  const explanations = stale
    ? [
        'Current completed history is missing or stale; indicator interpretations and ranking are disabled.',
        'RSI unavailable: history is stale or missing.',
        'MACD unavailable: history is stale or missing.',
        'ATR unavailable: history is stale or missing.',
        'Support unavailable: history is stale or missing.',
        'Resistance unavailable: history is stale or missing.',
      ]
    : [
        `${trend === 'Unavailable' ? 'Trend analysis is warming up' : trend + ' EMA alignment'} in the completed candle history.`,
        values.rsi === null
          ? 'RSI needs 15 completed observations.'
          : `RSI (14) is ${values.rsi.toFixed(1)}: ${values.rsi > 70 ? 'elevated; this alone is not a sell signal' : values.rsi < 30 ? 'low; this alone is not a buy signal' : 'between the 30 / 70 thresholds'}.`,
        values.macdHistogram === null
          ? 'MACD needs 34 completed observations.'
          : `MACD histogram is ${values.macdHistogram > 0 ? 'positive' : 'negative'}${momentum === 0 ? ' and conflicts with the EMA trend' : ''}.`,
        values.atrPct === null
          ? 'ATR is warming up.'
          : `ATR is ${values.atrPct.toFixed(2)}% of price. Volatility measures movement, not direction.`,
        support
          ? `Nearest support zone: ${fmt(support.low)}–${fmt(support.high)} (${support.touches} confirmed pivots).`
          : 'No validated support zone in this history.',
        resistance
          ? `Nearest resistance zone: ${fmt(resistance.low)}–${fmt(resistance.high)} (${resistance.touches} confirmed pivots).`
          : 'No validated resistance zone in this history.',
      ];
  return {
    values: stale ? Object.fromEntries(Object.keys(values).map((k) => [k, null])) : values,
    trend: stale ? 'Unavailable' : trend,
    regime,
    structure: s,
    zones: stale ? [] : z,
    score,
    coverage: stale ? 0 : coverage,
    factors: stale ? factors.map((f) => ({ ...f, value: null, reason: 'Stale history' })) : factors,
    explanations,
    scenarios: {
      bullish: !levelsAvailable
        ? 'Bullish scenario unavailable: ' + unavailableReason + '.'
        : resistance
          ? `If a completed candle closes above ${fmt(resistance.high)}, reassess momentum and available liquidity before planning a long.`
          : 'Wait for a confirmed resistance zone and adequate history before evaluating a breakout.',
      bearish: !levelsAvailable
        ? 'Bearish scenario unavailable: ' + unavailableReason + '.'
        : support
          ? `If support below ${fmt(support.low)} fails on a completed candle, reassess downside exposure.`
          : 'No validated support breakdown level is available.',
      neutral:
        'If timeframes disagree, history is stale, or the risk budget cannot meet market minimums, keeping a plan unexecuted is a valid outcome.',
    },
  };
}
export function matchesPreset(a: Analysis, preset: string) {
  if (preset === 'All markets') return true;
  if (a.coverage === 0) return false;
  const v = a.values;
  switch (preset) {
    case 'Trending markets':
      return a.trend !== 'Mixed' && a.trend !== 'Unavailable' && (v.adx ?? 0) >= 25;
    case 'Possible breakouts':
      return (
        v.close !== null &&
        a.zones.some(
          (z) =>
            Math.abs((z.kind === 'resistance' ? z.low : z.high) - v.close!) / v.close! <=
            Math.max(0.003, (v.atrPct ?? 0) / 100),
        ) &&
        v.bbPosition !== null &&
        (v.bbPosition > 0.9 || v.bbPosition < 0.1) &&
        (v.relativeVolume ?? 0) > 1 &&
        (v.atrExpansion ?? 0) > 0
      );
    case 'Oversold / overbought':
      return v.rsi !== null && (v.rsi > 70 || v.rsi < 30);
    case 'Trend pullbacks':
      return (
        v.close !== null &&
        v.ema20 !== null &&
        v.atr !== null &&
        Math.abs(v.close - v.ema20) <= v.atr &&
        ((a.trend === 'Bullish' && (v.change5 ?? 0) < 0) ||
          (a.trend === 'Bearish' && (v.change5 ?? 0) > 0))
      );
    case 'Volatility expansion':
      return (v.atrExpansion ?? 0) > 10 || (v.bbExpansion ?? 0) > 10;
    case 'Mixed signals':
      return (
        a.trend === 'Mixed' ||
        (a.trend === 'Bullish' && (v.macdHistogram ?? 0) < 0) ||
        (a.trend === 'Bearish' && (v.macdHistogram ?? 0) > 0)
      );
    default:
      return true;
  }
}
