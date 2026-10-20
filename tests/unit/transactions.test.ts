import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSameApproval, type TransactionPreview } from '../../packages/trade-planner/approval';
import {
  requestTransaction,
  readSubmission,
  submissionKey,
  evidenceMatches,
  type Provider,
} from '../../apps/web/src/transaction';
import { orderOutcome } from '../../packages/trade-planner/evidence';
const account = '0x' + '1'.repeat(40),
  pool = '0x' + '2'.repeat(40),
  hash = '0x' + 'a'.repeat(64);
const preview = (): TransactionPreview => ({
  chainId: 50383,
  account,
  to: pool,
  data: '0x1234',
  value: '0',
  gas: '100000',
  gasPrice: '1000',
  expiresAt: Date.now() + 30000,
  market: 'TEST-PERP',
  rawPrice: '100',
  rawQuantity: '10',
  orderType: 'limit',
});
function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
function provider(send: () => Promise<unknown> = async () => hash) {
  const request = vi.fn(async ({ method }: { method: string }) =>
    method === 'eth_accounts' ? [account] : method === 'eth_chainId' ? '0xc4cf' : send(),
  );
  return { request } satisfies Provider;
}
afterEach(() => vi.useRealTimers());
describe('reviewed transaction approval', () => {
  it.each([
    'chainId',
    'account',
    'to',
    'data',
    'value',
    'gas',
    'gasPrice',
    'rawPrice',
    'rawQuantity',
    'orderType',
    'orderId',
    'market',
  ] as const)('requires review again if %s changes', (key) => {
    const a = preview(),
      b = {
        ...a,
        [key]:
          key === 'chainId'
            ? 1
            : key === 'account' || key === 'to'
              ? '0x' + '3'.repeat(40)
              : key === 'data'
                ? '0x5678'
                : key === 'gas' || key === 'gasPrice'
                  ? '999999'
                  : 'changed',
      };
    expect(() => assertSameApproval(a, b)).toThrow();
  });
  it('permits only a new validation lease for the identical transaction', () => {
    const a = preview();
    expect(() => assertSameApproval(a, { ...a, expiresAt: a.expiresAt + 1000 })).not.toThrow();
  });
});
describe('wallet dispatch and persisted recovery', () => {
  it('stores intent before dispatch and pins the reviewed transaction', async () => {
    const s = memory(),
      p = provider(async () => {
        expect(readSubmission(s)?.data).toBe('0x1234');
        return hash;
      });
    expect(await requestTransaction(preview(), p, s, () => {})).toBe(hash);
    expect(readSubmission(s)?.hash).toBe(hash);
    const call = p.request.mock.calls.find(
      ([v]) => v.method === 'eth_sendTransaction',
    )![0] as unknown as { params: unknown[] };
    expect(call.params[0]).toMatchObject({
      from: account,
      to: pool,
      data: '0x1234',
      chainId: '0xc4cf',
      value: '0x0',
      gas: '0x186a0',
      gasPrice: '0x3e8',
    });
  });
  it.each([
    ['eth_chainId', '0x1'],
    ['eth_accounts', ['0x' + '4'.repeat(40)]],
  ] as const)('blocks changed identity from %s before dispatch', async (method, value) => {
    const s = memory(),
      p = provider();
    p.request.mockImplementation(async (q) =>
      q.method === method ? value : q.method === 'eth_accounts' ? [account] : '0xc4cf',
    );
    await expect(requestTransaction(preview(), p, s, () => {})).rejects.toThrow(/changed/i);
    expect(p.request.mock.calls.some(([q]) => q.method === 'eth_sendTransaction')).toBe(false);
    expect(readSubmission(s)).toBeUndefined();
  });
  it('blocks an account/chain event between identity reads', async () => {
    const s = memory();
    let revision = 0;
    const p = provider();
    p.request.mockImplementation(async (q) => {
      if (q.method === 'eth_chainId') {
        revision++;
        return '0xc4cf';
      }
      return [account];
    });
    await expect(
      requestTransaction(
        preview(),
        p,
        s,
        () => {},
        () => revision,
      ),
    ).rejects.toThrow(/changed/i);
    expect(readSubmission(s)).toBeUndefined();
  });
  it('releases only an explicitly rejected request', async () => {
    const s = memory();
    await expect(
      requestTransaction(
        preview(),
        provider(async () => {
          throw { code: 4001 };
        }),
        s,
        () => {},
      ),
    ).rejects.toMatchObject({ outcome: 'rejected' });
    expect(readSubmission(s)).toBeUndefined();
  });
  it('retains transport failures and prevents duplicates, including after reload or account changes', async () => {
    const s = memory();
    await expect(
      requestTransaction(
        preview(),
        provider(async () => {
          throw Error('lost');
        }),
        s,
        () => {},
      ),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    const p = provider();
    await expect(requestTransaction(preview(), p, s, () => {})).rejects.toThrow(/unresolved/);
    expect(p.request.mock.calls.some(([q]) => q.method === 'eth_sendTransaction')).toBe(false);
    expect(readSubmission(s)?.data).toBe('0x1234');
  });
  it('times out conservatively and captures a late wallet hash', async () => {
    vi.useFakeTimers();
    const s = memory();
    let resolve!: (hash: string) => void;
    const promise = requestTransaction(
      preview(),
      provider(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
      s,
      () => {},
      () => 0,
      100,
    );
    const result = expect(promise).rejects.toMatchObject({ outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(101);
    await result;
    expect(readSubmission(s)?.hash).toBeUndefined();
    resolve(hash);
    await vi.advanceTimersByTimeAsync(0);
    expect(readSubmission(s)?.hash).toBe(hash);
  });
  it('retains evidence when identity changes during a pending wallet prompt', async () => {
    let revision = 0;
    const s = memory();
    await expect(
      requestTransaction(
        preview(),
        provider(async () => {
          revision++;
          return hash;
        }),
        s,
        () => {},
        () => revision,
      ),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(readSubmission(s)?.hash).toBe(hash);
  });
  it('does not unlock corrupt saved intent', async () => {
    const s = memory();
    s.setItem(submissionKey, 'not-json');
    await expect(requestTransaction(preview(), provider(), s, () => {})).rejects.toThrow(
      /unresolved/,
    );
    expect(readSubmission(s)?.invalid).toBe(true);
  });
  it('requires chain, calldata and a mined receipt before unlocking a known hash', () => {
    const record = { account, to: pool, data: '0x1234', createdAt: Date.now(), hash };
    const e = {
      hash,
      network: 50383,
      market: 'TEST',
      pool,
      account,
      input: '0x1234',
      state: 'resting',
      checkedAt: Date.now(),
      receipt: { status: 'success', blockNumber: '1', gasUsed: '1' },
      events: [],
    };
    expect(evidenceMatches(record, e)).toBe(true);
    for (const bad of [
      { ...e, network: 1 },
      { ...e, input: '0x5678' },
      { ...e, receipt: { ...e.receipt, status: 'pending' } },
    ])
      expect(evidenceMatches(record, bad)).toBe(false);
    expect(evidenceMatches({ ...record, hash: undefined }, e)).toBe(false);
    expect(
      evidenceMatches({ ...record, hash: undefined }, { ...e, transactionTimestamp: Date.now() }),
    ).toBe(true);
  });
});
describe('receipt is not a fill', () => {
  const base = {
    reverted: false,
    cancellation: false,
    cancelled: false,
    rested: false,
    fillCount: 0,
    order: null,
  };
  it('keeps a successful receipt without order evidence syncing', () =>
    expect(orderOutcome(base)).toBe('syncing'));
  it('distinguishes a reverted receipt', () =>
    expect(orderOutcome({ ...base, reverted: true })).toBe('reverted'));
  it('recognizes resting, partial, fully filled and cancelled evidence', () => {
    expect(orderOutcome({ ...base, rested: true })).toBe('resting');
    expect(orderOutcome({ ...base, rested: true, fillCount: 1, remaining: 5n })).toBe('partial');
    expect(
      orderOutcome({
        ...base,
        fillCount: 1,
        remaining: 0n,
        order: { status: 'Open', quantityRemaining: '10', fullQuantity: '10' },
      }),
    ).toBe('filled');
    expect(orderOutcome({ ...base, cancellation: true, cancelled: true })).toBe('cancelled');
  });
});
