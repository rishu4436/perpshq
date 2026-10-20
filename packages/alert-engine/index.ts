import type { MarketDetail, Timeframe } from '../shared-types';
export type AlertRule = {
  id: string;
  marketId: string;
  symbol: string;
  type: 'price-above' | 'price-below' | 'rsi-above' | 'atr-above' | 'margin-below';
  threshold: number;
  enabled: boolean;
  triggered?: boolean;
  checkedAt?: number;
  observedAt?: number;
  account?: string;
  timeframe?: Timeframe;
  status?: 'ok' | 'unavailable' | 'stale' | 'disabled';
  message?: string;
  lastValue?: number;
};
export type AlertEvent = {
  id: string;
  text: string;
  time: number;
  ruleId?: string;
  observedAt?: number;
};
export interface AlertAccount {
  address: string;
  fetchedAt: number;
  quoteDecimals: number;
  margin: null | { equity: string; mmReq: string };
}
export function evaluateAlert(
  rule: AlertRule,
  source: { detail?: MarketDetail; account?: AlertAccount; error?: string },
  now: number,
) {
  const unavailable = (status: 'stale' | 'unavailable' | 'disabled', message: string) => ({
    rule: { ...rule, status, message, checkedAt: now },
    event: undefined as AlertEvent | undefined,
  });
  if (!rule.enabled) return unavailable('disabled', 'Monitoring paused for this rule.');
  if (!Number.isFinite(rule.threshold))
    return unavailable('unavailable', 'Invalid threshold; recreate this rule.');
  if (source.error) return unavailable('unavailable', source.error);
  let value: number | null | undefined,
    observedAt: number,
    scope = rule.symbol,
    account = rule.account;
  if (rule.type === 'margin-below') {
    const a = source.account;
    if (!a?.margin) return unavailable('unavailable', 'A fresh margin account read is required.');
    if (account && account.toLowerCase() !== a.address.toLowerCase())
      return unavailable('unavailable', 'Switch to the account bound to this rule.');
    account ??= a.address;
    observedAt = a.fetchedAt;
    scope = 'Account ' + a.address.slice(0, 8);
    try {
      value = Number(BigInt(a.margin.equity) - BigInt(a.margin.mmReq)) / 10 ** a.quoteDecimals;
    } catch {
      value = null;
    }
  } else {
    const d = source.detail;
    if (!d || d.market.id.toLowerCase() !== rule.marketId.toLowerCase())
      return unavailable('unavailable', 'This rule is waiting for its own market data.');
    observedAt = d.quality.fetchedAt;
    if (rule.type === 'price-above' || rule.type === 'price-below') {
      if (d.market.error) return unavailable('unavailable', d.market.error);
      observedAt = Math.min(observedAt, d.market.markUpdatedAt ?? 0);
      value = d.market.markPrice;
    } else {
      if (d.quality.stale)
        return unavailable(
          'stale',
          'Completed candle history is stale; threshold evaluation is withheld.',
        );
      value = rule.type === 'rsi-above' ? d.analysis.values.rsi : d.analysis.values.atrPct;
    }
  }
  if (
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    now - observedAt > 90000 ||
    observedAt > now + 60000
  )
    return unavailable(
      'stale',
      'Last usable observation is older than 90 seconds or has an invalid timestamp.',
    );
  if (value == null || !Number.isFinite(value))
    return unavailable(
      'unavailable',
      'Required observation is unavailable; previous trigger state is preserved.',
    );
  const active =
    rule.type === 'price-below' || rule.type === 'margin-below'
      ? value < rule.threshold
      : value > rule.threshold;
  const next: AlertRule = {
    ...rule,
    account,
    triggered: active,
    checkedAt: now,
    observedAt,
    status: 'ok',
    message: active ? 'Threshold condition active.' : 'Threshold condition inactive.',
    lastValue: value,
  };
  const event: AlertEvent | undefined =
    active && !rule.triggered
      ? {
          id: rule.id + ':' + observedAt,
          ruleId: rule.id,
          observedAt,
          time: now,
          text:
            scope +
            ' · ' +
            rule.type.replaceAll('-', ' ') +
            ' ' +
            rule.threshold +
            ' (observed ' +
            value.toLocaleString('en-US', { maximumFractionDigits: 5 }) +
            ')',
        }
      : undefined;
  return { rule: next, event };
}
