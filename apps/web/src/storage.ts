import { z } from 'zod';
const text = z.string().max(100000),
  number = z.number().finite(),
  strings = z.array(text).max(10000);
const tf = z.enum(['1m', '5m', '15m', '1h', '4h', '1d']);
const context = z
  .object({
    marketId: text,
    symbol: text,
    timeframe: tf,
    capturedAt: number,
    markPrice: number.optional(),
    markUpdatedAt: number.optional(),
    quality: z
      .object({
        source: text,
        fetchedAt: number,
        count: number,
        gaps: number,
        discarded: number,
        stale: z.boolean(),
        notes: strings,
      })
      .passthrough(),
    analysis: z
      .object({
        values: z.record(z.string(), number.nullable()),
        trend: text,
        regime: text,
        structure: text,
        zones: z.array(
          z.object({
            low: number,
            high: number,
            touches: number,
            lastSeen: number,
            strength: number,
            kind: z.enum(['support', 'resistance']),
          }),
        ),
        score: number,
        coverage: number,
        factors: z.array(
          z.object({ name: text, weight: number, value: number.nullable(), reason: text }),
        ),
        explanations: strings,
        scenarios: z.object({ bullish: text, bearish: text, neutral: text }),
      })
      .passthrough(),
    timeframes: z.record(
      z.string(),
      z
        .object({ trend: text, rsi: number.nullable(), macd: number.nullable(), count: number })
        .passthrough(),
    ),
  })
  .passthrough();
const reference = z.object({
  field: z.enum(['entry', 'stop', 'target']),
  source: z.enum(['mark', 'support', 'resistance']),
  value: text,
  selectedAt: number,
  observedAt: number,
  timeframe: tf,
});
const input = z
  .object({
    marketId: text,
    side: z.enum(['long', 'short']),
    type: z.enum(['limit', 'market']),
    entry: text,
    stop: text,
    target: text,
    riskBudget: text,
    collateral: text,
    leverage: text,
    slippageBps: text,
    quantity: text.optional(),
  })
  .passthrough();
const plan = z
  .object({
    input,
    quantity: text,
    rawQuantity: text,
    rawPrice: text,
    notional: text,
    margin: text,
    loss: text,
    gain: text,
    rr: text,
    warnings: strings,
    errors: strings,
    context: context.optional(),
    references: z.array(reference).optional(),
  })
  .passthrough();
const journal = z
  .object({
    id: text,
    createdAt: number,
    market: text,
    wallet: text.optional(),
    thesis: text,
    tags: strings,
    emotion: text,
    review: text,
    plan: plan.optional(),
    context: context.optional(),
    transactionHash: text.optional(),
  })
  .passthrough();
const schemas: Record<string, z.ZodType> = {
  'perpshq.market': text,
  'perpshq.timeframe': tf,
  'perpshq.readAddress': text,
  'perpshq.orderFlows': z.record(z.string(), z.string().uuid()),
  'perpshq.watchlist': strings,
  'perpshq.overlays': strings,
  'perpshq.arenaChecklist': strings,
  'perpshq.journal': z.array(journal).max(10000),
  'perpshq.plans': z.array(plan).max(1000),
  'perpshq.transactions': z
    .array(z.object({ hash: text, marketId: text, account: text, state: text }))
    .max(10000),
  'perpshq.alertRules': z
    .array(
      z
        .object({
          id: text,
          marketId: text,
          symbol: text,
          type: z.enum(['price-above', 'price-below', 'rsi-above', 'atr-above', 'margin-below']),
          threshold: number,
          enabled: z.boolean(),
          triggered: z.boolean().optional(),
          checkedAt: number.optional(),
          observedAt: number.optional(),
          account: text.optional(),
          timeframe: tf.optional(),
          status: z.enum(['ok', 'unavailable', 'stale', 'disabled']).optional(),
          message: text.optional(),
          lastValue: number.optional(),
        })
        .passthrough(),
    )
    .max(1000),
  'perpshq.alertHistory': z
    .array(
      z.object({
        id: text,
        text,
        time: number,
        ruleId: text.optional(),
        observedAt: number.optional(),
      }),
    )
    .max(10000),
  'perpshq.equitySnapshots': z
    .array(z.object({ account: text, time: number, equity: number }))
    .max(10000),
  'perpshq.activityOutbox': z
    .array(
      z.object({
        id: text,
        flowId: text,
        account: text,
        marketId: text,
        at: number,
        state: z.enum([
          'draft',
          'reviewed',
          'signature',
          'pending',
          'unknown',
          'rejected',
          'confirmed',
          'reverted',
          'syncing',
          'resting',
          'partial',
          'filled',
          'cancelled',
          'journaled',
        ]),
        hash: text.optional(),
        detail: text,
      }),
    )
    .max(1000),
  'perpshq.weights': z.object({
    trend: number.min(0).max(100),
    momentum: number.min(0).max(100),
    volume: number.min(0).max(100),
    structure: number.min(0).max(100),
    volatility: number.min(0).max(100),
    location: number.min(0).max(100),
    timeframes: number.min(0).max(100),
  }),
};
function schema(key: string, initial: unknown): z.ZodType {
  if (key.startsWith('perpshq.planner.context.'))
    return z.object({ context: context.optional(), references: z.array(reference) });
  if (key.startsWith('perpshq.planner.')) return input;
  return (
    schemas[key] ??
    (typeof initial === 'string'
      ? text
      : typeof initial === 'number'
        ? number
        : typeof initial === 'boolean'
          ? z.boolean()
          : z.custom((v) =>
              Array.isArray(initial)
                ? Array.isArray(v)
                : v !== null && typeof v === 'object' && !Array.isArray(v),
            ))
  );
}
const recovered = new Map<string, string>(),
  pending = new Map<string, string>(),
  notices = new Set<string>();
function markVersion(store: Pick<Storage, 'getItem' | 'setItem'>, key: string) {
  try {
    const raw = JSON.parse(store.getItem('perpshq.schemaVersions') ?? '{}');
    const versions = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (versions[key] !== 1) {
      versions[key] = 1;
      store.setItem('perpshq.schemaVersions', JSON.stringify(versions));
    }
  } catch {
    /* Value validation is independent of optional migration metadata. */
  }
}
export function storageNotice(message: string) {
  notices.add(message);
  if (typeof window !== 'undefined')
    queueMicrotask(() => window.dispatchEvent(new Event('perpshq-storage-notice')));
}
export function storageNotices() {
  return [...notices];
}
export function recoveredStorage() {
  return Object.fromEntries(recovered);
}
export function exportBrowserStorage(store: Storage): Record<string, string> {
  const data: Record<string, string> = {};
  try {
    for (const key of Object.keys(store)) {
      if (!key.startsWith('perpshq.')) continue;
      const value = store.getItem(key);
      if (value !== null) data[key] = value;
    }
  } catch {
    // Quota/permission failures must not prevent export of unsaved in-memory changes.
  }
  for (const [key, value] of recovered)
    data['perpshq.recovery.' + encodeURIComponent(key)] ??= value;
  for (const [key, value] of pending) data[key] = value;
  return data;
}
export function loadStored<T>(
  store: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  initial: T,
): T {
  let raw: string | null = null;
  try {
    raw = pending.get(key) ?? store.getItem(key);
    if (raw === null) return initial;
    const decoded = JSON.parse(raw);
    // Accept legacy raw values and the explicitly versioned v1 envelope; reject future formats.
    if (
      decoded &&
      typeof decoded === 'object' &&
      '_perpshqVersion' in decoded &&
      decoded._perpshqVersion !== 1
    )
      throw new Error('Unsupported storage version');
    const value =
      decoded && typeof decoded === 'object' && decoded._perpshqVersion === 1
        ? decoded.value
        : decoded;
    const parsed = schema(key, initial).safeParse(value);
    if (parsed.success) {
      markVersion(store, key);
      return parsed.data as T;
    }
    throw new Error('Saved value has an unsupported shape');
  } catch {
    if (raw !== null) {
      recovered.set(key, raw);
      try {
        const recoveryKey = 'perpshq.recovery.' + encodeURIComponent(key);
        if (store.getItem(recoveryKey) === null) store.setItem(recoveryKey, raw);
      } catch {
        /* The original remains in place and is also available for recovery export. */
      }
      storageNotice(
        'Recovered ' +
          key.replace('perpshq.', '') +
          ' with safe defaults. Original data is preserved for export.',
      );
    } else
      storageNotice(
        'Browser storage is unavailable. Changes remain in memory until you export them.',
      );
    return initial;
  }
}
export function saveStored<T>(
  store: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  value: T,
  initial: T,
) {
  const checked = schema(key, initial).safeParse(value);
  if (!checked.success) {
    storageNotice(
      'Could not persist invalid ' +
        key.replace('perpshq.', '') +
        ' data. Export your workspace before leaving.',
    );
    return false;
  }
  try {
    if (recovered.has(key) && store.getItem('perpshq.recovery.' + encodeURIComponent(key)) === null)
      throw new Error('Original damaged data has not been backed up');
    store.setItem(key, JSON.stringify(checked.data));
    pending.delete(key);
    markVersion(store, key);
    return true;
  } catch {
    pending.set(key, JSON.stringify(checked.data));
    storageNotice(
      'Browser storage could not save ' +
        key.replace('perpshq.', '') +
        '. Your latest changes remain in memory; export them before leaving.',
    );
    return false;
  }
}
export function parsePage(hash: string, valid: readonly string[]): string {
  try {
    const page = decodeURIComponent(hash.replace(/^#/, ''));
    return valid.includes(page) ? page : 'Command Center';
  } catch {
    return 'Command Center';
  }
}
