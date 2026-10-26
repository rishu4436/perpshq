import { useEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { evaluateAlert, type AlertRule, type AlertEvent } from '../../../packages/alert-engine';
import type { MarketDetail } from '../../../packages/shared-types';
import { api, errorMessage, type AccountData } from './lib';
// Bound newly requested market reads; QueryClient deduplicates an already open market/timeframe.
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(work: () => Promise<T>) {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
export function useAlertMonitoring(options: {
  rules: AlertRule[];
  setRules: (rules: AlertRule[]) => void;
  setHistory: (fn: (history: AlertEvent[]) => AlertEvent[]) => void;
  account?: AccountData;
  accountError?: unknown;
  notify: (text: string) => void;
}) {
  const [clock, setClock] = useState(Date.now());
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const keys = [
    ...new Set(
      options.rules
        .filter((r) => r.enabled && r.type !== 'margin-below')
        .map((r) => r.marketId + '|' + (r.timeframe ?? '15m')),
    ),
  ].sort();
  const reads = useQueries({
    queries: keys.map((key) => {
      const [id, tf] = key.split('|');
      return {
        queryKey: ['detail', id, tf],
        queryFn: () => limited(() => api<MarketDetail>(`/markets/${id}?timeframe=${tf}`)),
        staleTime: 30000,
        refetchInterval: 60000,
        retry: 1,
      };
    }),
  });
  const signature = reads
    .map((r) => r.dataUpdatedAt + ':' + r.errorUpdatedAt + ':' + r.isError)
    .join('|');
  const spec = JSON.stringify(
    options.rules.map((r) => [
      r.id,
      r.marketId,
      r.type,
      r.threshold,
      r.enabled,
      r.account,
      r.timeframe,
    ]),
  );
  const sources = useRef(reads);
  sources.current = reads;
  useEffect(() => {
    const o = current.current,
      now = Date.now();
    const events: AlertEvent[] = [];
    const next = o.rules.map((rule) => {
      const index = keys.indexOf(rule.marketId + '|' + (rule.timeframe ?? '15m')),
        q = sources.current[index];
      const result = evaluateAlert(
        rule,
        rule.type === 'margin-below'
          ? { account: o.account, error: o.accountError ? errorMessage(o.accountError) : undefined }
          : { detail: q?.data, error: q?.isError ? errorMessage(q.error) : undefined },
        now,
      );
      if (result.event) events.push(result.event);
      return result.rule;
    });
    // No side effects inside a React state updater: StrictMode may call updaters twice.
    current.current = { ...o, rules: next };
    if (JSON.stringify(next) !== JSON.stringify(o.rules)) o.setRules(next);
    if (events.length) {
      o.setHistory((old) =>
        [...events.filter((e) => !old.some((v) => v.id === e.id)), ...old].slice(0, 100),
      );
      o.notify(events[0].text);
    }
  }, [
    signature,
    spec,
    options.account?.fetchedAt,
    options.account?.address,
    options.accountError,
    clock,
  ]);
}
