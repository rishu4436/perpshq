import { useState } from 'react';
import type { JournalEntry, Plan, Market } from '../../../packages/shared-types';
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001)
    return 'User rejected the wallet signature.';
  return typeof error === 'string'
    ? error
    : 'The provider returned an error without a message. Check wallet activity before retrying.';
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data;
}
export function useStored<T>(key: string, initial: T) {
  const [v, set] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? initial;
    } catch {
      return initial;
    }
  });
  function update(next: T | ((old: T) => T)) {
    set((old) => {
      const n = typeof next === 'function' ? (next as (old: T) => T)(old) : next;
      localStorage.setItem(key, JSON.stringify(n));
      return n;
    });
  }
  return [v, update] as const;
}
export const fmt = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const price = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : '$' + fmt(v, v < 1 ? 5 : 2);
export const compact = (v: number | undefined) =>
  v === undefined
    ? '—'
    : Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
export const short = (v: string) => v.slice(0, 6) + '…' + v.slice(-4);
export const raw = (v: string | null | undefined, dp = 18) =>
  v === undefined || v === null ? undefined : Number(v) / 10 ** dp;
export function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function journalEntry(m: Market, plan?: Plan, wallet?: string, hash?: string): JournalEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    market: m.symbol,
    wallet,
    thesis: '',
    tags: [],
    emotion: 'Neutral',
    review: '',
    plan,
    context: plan?.context,
    transactionHash: hash,
  };
}
export interface AccountData {
  address: string;
  fetchedAt: number;
  quoteDecimals: number;
  gas?: string;
  errors: string[];
  margin: null | {
    equity: string;
    unlockedCollateralBalance: string;
    lockedCollateral: string;
    imReq: string;
    mmReq: string;
    marginStatus: string;
    asOfBlock: string;
  };
  positions:
    | null
    | {
        pool: string;
        size: string;
        isLong: boolean;
        entryPriceX18: string;
        realizedPnl: string;
        updatedAt: string;
      }[];
  orders:
    | null
    | {
        orderId: string;
        pool: string;
        owner: string;
        isBid: boolean;
        price: string;
        fullQuantity: string;
        quantityRemaining: string;
        status: string;
      }[];
  fills:
    | null
    | {
        id: string;
        txHash: string;
        pool: string;
        fillPrice: string;
        quantity: string;
        timestamp: string;
      }[];
  changes:
    | null
    | {
        kind: string;
        pool: string;
        closedSize: string;
        realizedPnl: string;
        timestamp: string;
        txHash: string;
      }[];
  voucher: unknown;
}
export type Preview = import('../../../packages/trade-planner/approval').TransactionPreview;
export interface AccountData {
  analytics?:
    | null
    | {
        pool: string;
        priceable: boolean;
        size: string;
        markPrice?: string;
        unrealizedPnl?: string;
        accruedFunding?: string;
        notional?: string;
        asOfBlock: string;
      }[];
  fundingPayments?: null | { id: string; amount: string; timestamp: string; txHash: string }[];
}
export interface Evidence {
  hash: string;
  network: number;
  market: string;
  pool: string;
  account: string;
  input?: string;
  state: string;
  checkedAt: number;
  orderId?: string;
  order?: unknown;
  receipt: { status: string; blockNumber: string; gasUsed: string };
  events: unknown[];
  transactionStatus?: 'confirmed' | 'reverted';
  transactionTimestamp?: number;
  indexerStatus?: string;
}
