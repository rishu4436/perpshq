import {
  assertPreview,
  SubmissionFailure,
  type TransactionPreview,
} from '../../../packages/trade-planner/approval';
import type { Evidence } from './lib';
export interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(name: string, handler: (v: unknown) => void): void;
  removeListener?(name: string, handler: (v: unknown) => void): void;
}
export interface Submission {
  account: string;
  to: string;
  data: string;
  createdAt: number;
  hash?: string;
  id?: string;
  network?: number;
  value?: string;
  gas?: string;
  gasPrice?: string;
  invalid?: boolean;
}
export const submissionKey = 'perpshq.unresolvedSubmission';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function readSubmission(storage: Store): Submission | undefined {
  const text = storage.getItem(submissionKey);
  if (!text) return;
  try {
    const r = JSON.parse(text);
    if (
      r &&
      typeof r.account === 'string' &&
      typeof r.to === 'string' &&
      typeof r.data === 'string' &&
      Number.isFinite(r.createdAt)
    )
      return r;
  } catch {
    /* Corrupt intent must fail closed, not unlock signing. */
  }
  return { account: '', to: '', data: '', createdAt: 0, invalid: true };
}
export function evidenceMatches(record: Submission, e: Evidence) {
  if (
    record.invalid ||
    e.network !== 50383 ||
    !['success', 'reverted'].includes(e.receipt.status) ||
    !/^\d+$/.test(e.receipt.blockNumber) ||
    BigInt(e.receipt.blockNumber) <= 0n ||
    e.account.toLowerCase() !== record.account.toLowerCase() ||
    e.pool.toLowerCase() !== record.to.toLowerCase() ||
    e.input?.toLowerCase() !== record.data.toLowerCase()
  )
    return false;
  return record.hash
    ? record.hash.toLowerCase() === e.hash.toLowerCase()
    : e.transactionTimestamp !== undefined &&
        e.transactionTimestamp >= record.createdAt - 60000 &&
        e.transactionTimestamp <= Date.now() + 60000;
}
/** Caller holds the browser Web Lock when available; persisted intent outlives the request and page. */
export async function requestTransaction(
  preview: TransactionPreview,
  p: Provider,
  storage: Store,
  onChange: (s: Submission | undefined) => void,
  revision: () => number = () => 0,
  timeoutMs = 120000,
) {
  const version = revision();
  const accounts = (await p.request({ method: 'eth_accounts' })) as string[];
  const chain = Number(await p.request({ method: 'eth_chainId' }));
  if (
    version !== revision() ||
    chain !== 50383 ||
    accounts[0]?.toLowerCase() !== preview.account.toLowerCase()
  )
    throw new SubmissionFailure(
      'Wallet account or network changed. Review a new preview.',
      'blocked',
    );
  assertPreview(preview, accounts[0], preview.to);
  if (readSubmission(storage))
    throw new SubmissionFailure(
      'A previous wallet request is unresolved. Reconcile it before submitting again.',
      'blocked',
    );
  const intent: Submission = {
    id: crypto.randomUUID(),
    account: preview.account,
    to: preview.to,
    data: preview.data,
    createdAt: Date.now(),
    network: 50383,
    value: preview.value,
    gas: preview.gas,
    gasPrice: preview.gasPrice,
  };
  storage.setItem(submissionKey, JSON.stringify(intent));
  onChange(intent);
  const update = (record: Submission | undefined) => {
    if (readSubmission(storage)?.id !== intent.id) return;
    if (record) storage.setItem(submissionKey, JSON.stringify(record));
    else storage.removeItem(submissionKey);
    onChange(record);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = Promise.resolve()
      .then(() => {
        if (revision() !== version) {
          update(undefined);
          throw new SubmissionFailure(
            'Wallet changed before dispatch. Review a new preview.',
            'blocked',
          );
        }
        return p.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: preview.account,
              to: preview.to,
              data: preview.data,
              value: '0x0',
              gas: '0x' + BigInt(preview.gas).toString(16),
              chainId: '0xc4cf',
              ...(preview.gasPrice
                ? { gasPrice: '0x' + BigInt(preview.gasPrice).toString(16) }
                : {}),
            },
          ],
        });
      })
      .then(
        (hash) => {
          if (typeof hash !== 'string' || !/^0x[\da-f]{64}$/i.test(hash))
            throw new SubmissionFailure(
              'Wallet returned no valid hash. Outcome is unknown; check wallet activity.',
              'unknown',
            );
          update({ ...intent, hash });
          return hash;
        },
        (error) => {
          if (error instanceof SubmissionFailure) throw error;
          if ((error as { code?: number })?.code === 4001) {
            update(undefined);
            throw new SubmissionFailure('User rejected the wallet signature.', 'rejected');
          }
          throw new SubmissionFailure(
            (error instanceof Error ? error.message : 'Wallet response was lost') +
              ' Outcome is unknown; reconcile wallet activity.',
            'unknown',
          );
        },
      );
    const hash = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SubmissionFailure(
                'Wallet response timed out. Outcome is unknown; reconcile wallet activity.',
                'unknown',
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
    if (revision() !== version)
      throw new SubmissionFailure(
        'Wallet identity changed while signing. Reconcile the saved request; it may have broadcast.',
        'unknown',
      );
    return hash;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
