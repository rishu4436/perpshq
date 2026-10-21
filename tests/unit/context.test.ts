import { expect, it } from 'vitest';
import {
  contextStatus,
  entryReference,
  planningCandidates,
  referenceValue,
  snapshotContext,
} from '../../packages/trade-planner/context';
import { analyze } from '../../packages/opportunity-scoring';
import { normalizeMarket } from '../../packages/dreamdex-adapter';
import probe from '../../docs/probe-results.json';
import type { PerpMarket } from '@somnia-chain/markets-sdk';
import type { MarketDetail } from '../../packages/shared-types';
const now = 1800000000000;
const detail: MarketDetail = {
  market: {
    ...normalizeMarket(probe.markets.data[0] as PerpMarket),
    markPrice: 100,
    markUpdatedAt: now,
  },
  candles: [],
  quality: {
    source: 'TEST ONLY',
    fetchedAt: now,
    count: 100,
    stale: false,
    gaps: 0,
    discarded: 0,
    notes: [],
  },
  analysis: {
    ...analyze([]),
    zones: [
      { low: 89, high: 90, kind: 'support', touches: 3, strength: 1, lastSeen: now / 1000 - 900 },
      {
        low: 110,
        high: 111,
        kind: 'resistance',
        touches: 3,
        strength: 1,
        lastSeen: now / 1000 - 900,
      },
    ],
  },
  book: null,
  timeframes: {},
};
it('offers confirmed levels on the correct side of entry for long and short drafts', () => {
  const long = planningCandidates(detail, { side: 'long', entry: '100' }, now),
    short = planningCandidates(detail, { side: 'short', entry: '100' }, now);
  expect(long.stops[0].kind).toBe('support');
  expect(long.targets[0].kind).toBe('resistance');
  expect(short.stops[0].kind).toBe('resistance');
  expect(short.targets[0].kind).toBe('support');
  expect(referenceValue(long.stops[0], 'long')).toBe('89');
  expect(referenceValue(short.stops[0], 'short')).toBe('111');
  expect(planningCandidates(detail, { side: 'long', entry: '85' }, now).stops).toHaveLength(0);
});
it('withholds stale, insufficient, future and missing context shortcuts', () => {
  for (const d of [
    undefined,
    { ...detail, quality: { ...detail.quality, stale: true } },
    { ...detail, quality: { ...detail.quality, count: 49 } },
    { ...detail, quality: { ...detail.quality, fetchedAt: now - 90001 } },
  ])
    expect(planningCandidates(d, { side: 'long', entry: '100' }, now).stops).toEqual([]);
  expect(
    contextStatus({ ...detail, market: { ...detail.market, markUpdatedAt: now + 60001 } }, now)
      .markFresh,
  ).toBe(false);
  expect(() =>
    entryReference({ ...detail, market: { ...detail.market, markUpdatedAt: now - 90001 } }, now),
  ).toThrow('stale');
});
it('captures provenance without silently replacing the saved analysis', () => {
  const captured = snapshotContext(detail, now),
    stored = JSON.parse(JSON.stringify(captured));
  const later = snapshotContext(
    { ...detail, quality: { ...detail.quality, stale: true } },
    now + 1,
  );
  expect(stored.capturedAt).toBe(now);
  expect(stored.analysis.zones).toHaveLength(2);
  expect(later.analysis.zones).toHaveLength(0);
  expect(later.quality.stale).toBe(true);
  expect(entryReference(detail, now)).toBe('100');
});
