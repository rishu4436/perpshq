import Decimal from 'decimal.js';
import type { MarketDetail, MarketContextSnapshot, PlanInput, Zone } from '../shared-types';
import { analyze } from '../opportunity-scoring';
export function contextStatus(d: MarketDetail | undefined, now = Date.now()) {
  const fresh =
    !!d &&
    !d.quality.stale &&
    d.quality.count >= 50 &&
    now - d.quality.fetchedAt <= 90000 &&
    d.quality.fetchedAt <= now + 60000;
  const markFresh =
    !!d &&
    !d.market.error &&
    Number.isFinite(d.market.markPrice) &&
    d.market.markPrice! > 0 &&
    !!d.market.markUpdatedAt &&
    now - d.market.markUpdatedAt <= 90000 &&
    d.market.markUpdatedAt <= now + 60000 &&
    now - d.quality.fetchedAt <= 90000 &&
    d.quality.fetchedAt <= now + 60000;
  return { fresh, markFresh };
}
export function snapshotContext(d: MarketDetail, now = Date.now()): MarketContextSnapshot {
  const { fresh, markFresh } = contextStatus(d, now);
  return {
    marketId: d.market.id,
    symbol: d.market.symbol,
    timeframe: d.candles[0]?.timeframe ?? '15m',
    capturedAt: now,
    markPrice: markFresh ? d.market.markPrice : undefined,
    markUpdatedAt: d.market.markUpdatedAt,
    quality: {
      ...d.quality,
      stale: d.quality.stale || !fresh,
      notes: [
        ...d.quality.notes,
        ...(!fresh
          ? ['Actionable context is unavailable until fresh, sufficient history is present.']
          : []),
      ],
    },
    analysis: fresh ? d.analysis : analyze(d.candles, true),
    timeframes: fresh ? d.timeframes : {},
  };
}
export function planningCandidates(
  d: MarketDetail | undefined,
  input: Pick<PlanInput, 'side' | 'entry'>,
  now = Date.now(),
) {
  const { fresh } = contextStatus(d, now),
    entry = Number(input.entry || d?.market.markPrice);
  const zones = fresh
    ? d!.analysis.zones.filter(
        (z) =>
          Number.isFinite(z.low) &&
          Number.isFinite(z.high) &&
          z.low > 0 &&
          z.high >= z.low &&
          Number.isFinite(z.lastSeen) &&
          z.lastSeen > 0 &&
          z.touches >= 1 &&
          z.lastSeen * 1000 <= now,
      )
    : [];
  const supports = zones
    .filter((z) => z.kind === 'support' && z.high < entry)
    .sort((a, b) => b.high - a.high);
  const resistances = zones
    .filter((z) => z.kind === 'resistance' && z.low > entry)
    .sort((a, b) => a.low - b.low);
  return {
    supports,
    resistances,
    stops: input.side === 'long' ? supports : resistances,
    targets: input.side === 'long' ? resistances : supports,
  };
}
export function referenceValue(zone: Zone, side: 'long' | 'short') {
  return new Decimal(side === 'long' ? zone.low : zone.high).toFixed();
}
export function entryReference(d: MarketDetail, now = Date.now()) {
  if (!contextStatus(d, now).markFresh) throw new Error('Current mark is unavailable or stale.');
  const tick = new Decimal(d.market.tickSize).div(new Decimal(10).pow(d.market.quoteDecimals));
  return new Decimal(d.market.markPrice!).div(tick).floor().mul(tick).toFixed();
}
