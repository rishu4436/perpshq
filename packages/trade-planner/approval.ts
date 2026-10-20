import { NETWORK } from '../shared-types';
export interface TransactionPreview {
  chainId: number;
  account: string;
  to: string;
  data: `0x${string}`;
  value: string;
  gas: string;
  gasPrice?: string;
  expiresAt: number;
  market: string;
  estimatedGasSTT?: string;
  rawPrice?: string;
  rawQuantity?: string;
  orderType?: string;
  orderId?: string;
}
export function assertPreview(
  preview: TransactionPreview,
  account: string,
  pool: string,
  now = Date.now(),
) {
  if (
    preview.chainId !== NETWORK.id ||
    preview.account.toLowerCase() !== account.toLowerCase() ||
    preview.to.toLowerCase() !== pool.toLowerCase()
  )
    throw new Error('Preview does not match the selected market, account or chain');
  if (
    !/^0x[\da-f]{40}$/i.test(account) ||
    !/^0x[\da-f]{40}$/i.test(pool) ||
    !/^0x(?:[\da-f]{2})+$/i.test(preview.data)
  )
    throw new Error('Invalid transaction address or calldata');
  if (
    preview.value !== '0' ||
    !/^\d+$/.test(preview.gas) ||
    BigInt(preview.gas) <= 0n ||
    (preview.gasPrice !== undefined &&
      (!/^\d+$/.test(preview.gasPrice) || BigInt(preview.gasPrice) <= 0n))
  )
    throw new Error('Invalid transaction value or gas parameters');
  if (
    !Number.isFinite(preview.expiresAt) ||
    preview.expiresAt <= now ||
    preview.expiresAt > now + 60000
  )
    throw new Error('Preview expired or validity window is invalid. Validate again.');
}
/** Expiry of the validation lease may advance; the reviewed transaction itself must not change. */
export function assertSameApproval(reviewed: TransactionPreview, fresh: TransactionPreview) {
  assertPreview(fresh, reviewed.account, reviewed.to);
  const keys = [
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
  ] as const;
  if (
    keys.some((key) => {
      const a = reviewed[key],
        b = fresh[key];
      return typeof a === 'string' &&
        typeof b === 'string' &&
        ['account', 'to', 'data'].includes(key)
        ? a.toLowerCase() !== b.toLowerCase()
        : a !== b;
    })
  )
    throw new Error('Order parameters changed. Review a new preview.');
}

export class SubmissionFailure extends Error {
  constructor(
    message: string,
    public outcome: 'blocked' | 'rejected' | 'unknown',
  ) {
    super(message);
  }
}
