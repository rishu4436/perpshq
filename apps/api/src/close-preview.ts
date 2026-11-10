import type { Plan } from '../../../packages/shared-types';
export function closingPositionFingerprint(
  plan: Plan,
  account: {
    exposure: { complete: boolean };
    positions?:
      { pool: string; size: bigint; avgEntryPrice: bigint; entryFundingIndex: bigint }[] | null;
  },
) {
  if (!account.exposure.complete || !account.positions)
    throw new Error('Close blocked: a complete current bank position snapshot is required');
  const p = account.positions.find(
    (p) => p.pool.toLowerCase() === plan.input.marketId.toLowerCase(),
  );
  if (!p || p.size === 0n) throw new Error('Close blocked: this position is already flat');
  if (
    plan.input.type !== 'market' ||
    (p.size > 0n ? plan.input.side !== 'short' : plan.input.side !== 'long')
  )
    throw new Error('Close blocked: an opposite-side IOC is required');
  if (BigInt(plan.rawQuantity) !== (p.size < 0n ? -p.size : p.size))
    throw new Error('Close blocked: quantity must equal the current full position');
  return `${p.size}:${p.avgEntryPrice}:${p.entryFundingIndex}`;
}
