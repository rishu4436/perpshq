import { expect, it } from 'vitest';
import { evaluateAlert, type AlertRule } from '../../packages/alert-engine';
import type { MarketDetail } from '../../packages/shared-types';
import { analyze } from '../../packages/opportunity-scoring';
import { normalizeMarket } from '../../packages/dreamdex-adapter';
import probe from '../../docs/probe-results.json';
import type { PerpMarket } from '@somnia-chain/markets-sdk';
const now = 1800000000000;
const rule: AlertRule = {
  id: 'btc-rule',
  marketId: 'btc',
  symbol: 'BTC',
  type: 'price-above',
  threshold: 100,
  enabled: true,
};
const detail = (id = 'btc', price = 120): MarketDetail =>
  ({
    market: {
      ...normalizeMarket(probe.markets.data[0] as PerpMarket),
      id,
      markPrice: price,
      markUpdatedAt: now,
    },
    quality: {
      source: 'TEST',
      fetchedAt: now,
      stale: false,
      count: 100,
      gaps: 0,
      discarded: 0,
      notes: [],
    },
    analysis: { ...analyze([]), values: { rsi: 80, atrPct: 4 } },
    candles: [],
    book: null,
    timeframes: {},
  }) as MarketDetail;
it('uses each rule’s own market and refuses another market’s observation', () => {
  expect(evaluateAlert(rule, { detail: detail('eth') }, now).event).toBeUndefined();
  expect(evaluateAlert(rule, { detail: detail() }, now).event?.ruleId).toBe(rule.id);
  const eth = { ...rule, id: 'eth-rule', marketId: 'eth', symbol: 'ETH' };
  expect(evaluateAlert(eth, { detail: detail('eth', 200) }, now).event?.text).toContain('ETH');
});
it('survives persistence and does not spam an unchanged threshold condition', () => {
  const first = evaluateAlert(rule, { detail: detail() }, now);
  const persisted = JSON.parse(JSON.stringify(first.rule));
  expect(evaluateAlert(persisted, { detail: detail() }, now + 1).event).toBeUndefined();
  expect(persisted.checkedAt).toBe(now);
  expect(persisted.triggered).toBe(true);
});
it('rearms only after a usable inactive observation', () => {
  const active = evaluateAlert(rule, { detail: detail() }, now).rule;
  const missing = evaluateAlert(active, {}, now + 1);
  expect(missing.rule.triggered).toBe(true);
  expect(evaluateAlert(missing.rule, { detail: detail() }, now + 2).event).toBeUndefined();
  const inactive = evaluateAlert(active, { detail: detail('btc', 90) }, now + 1).rule;
  expect(evaluateAlert(inactive, { detail: detail() }, now + 2).event).toBeDefined();
});
it('suppresses missing, stale, erroneous, future and nonfinite observations', () => {
  for (const d of [
    { ...detail(), market: { ...detail().market, error: 'feed failed' } },
    { ...detail(), quality: { ...detail().quality, fetchedAt: now - 90001 } },
    { ...detail(), market: { ...detail().market, markPrice: NaN } },
    { ...detail(), market: { ...detail().market, markUpdatedAt: undefined } },
  ])
    expect(evaluateAlert(rule, { detail: d }, now).event).toBeUndefined();
  const r = { ...rule, type: 'rsi-above' as const };
  expect(
    evaluateAlert(
      r,
      { detail: { ...detail(), quality: { ...detail().quality, stale: true } } },
      now,
    ).rule.status,
  ).toBe('stale');
  expect(
    evaluateAlert({ ...rule, enabled: false }, { detail: detail() }, now).event,
  ).toBeUndefined();
});
it('evaluates margin from its own fresh account and binds legacy rules once', () => {
  const r = { ...rule, type: 'margin-below' as const, threshold: 20 };
  const account = {
    address: 'wallet-A',
    fetchedAt: now,
    quoteDecimals: 18,
    margin: { equity: '10000000000000000000', mmReq: '5000000000000000000' },
  };
  const result = evaluateAlert(r, { account }, now);
  expect(result.event?.text).toContain('Account wallet-A');
  expect(result.rule.account).toBe('wallet-A');
  expect(
    evaluateAlert(result.rule, { account: { ...account, address: 'wallet-B' } }, now).rule.status,
  ).toBe('unavailable');
  expect(
    evaluateAlert(r, { account: { ...account, fetchedAt: now - 90001 } }, now).event,
  ).toBeUndefined();
});
