import type { Address } from 'viem';
import type {
  MarginAccount,
  PerpPositionAnalytics,
  OpenOrdersOnchain,
} from '@somnia-chain/markets-sdk';
import type { Market } from '../shared-types';

/** Bounded indexer history must never be used as proof of complete current exposure. */
export function verifyExposure(
  owner: Address,
  markets: Market[],
  margin: MarginAccount | null,
  positions: PerpPositionAnalytics[] | null,
  open: OpenOrdersOnchain | null,
) {
  const reasons: string[] = [];
  const known = new Set(markets.map((m) => m.poolAddress.toLowerCase()));
  if (!margin || !positions || !open)
    reasons.push('Authoritative margin, active positions or open orders unavailable');
  if (
    margin &&
    [
      margin.asOfBlock,
      margin.equity,
      margin.unlockedCollateralBalance,
      margin.lockedCollateral,
      margin.imReq,
      margin.mmReq,
      margin.cmReq,
      margin.withdrawable,
    ].some((v) => typeof v !== 'bigint')
  )
    reasons.push('Margin snapshot fields are incomplete');
  if (
    new Set(markets.map((m) => m.marginBank.toLowerCase())).size !== 1 ||
    new Set(markets.map((m) => m.quoteToken.toLowerCase())).size !== 1 ||
    new Set(markets.map((m) => m.quoteDecimals)).size !== 1
  )
    reasons.push('Multiple collateral/bank domains require separate complete risk snapshots');
  if (margin && positions && open) {
    if (
      margin.asOfBlock !== open.blockNumber ||
      positions.some((p) => p.asOfBlock !== margin.asOfBlock)
    )
      reasons.push('Exposure observations do not share the margin block');
    const active = new Set(margin.activePerpPools.map((p) => p.toLowerCase()));
    const observed = new Set(positions.map((p) => p.pool.toLowerCase()));
    if (
      active.size !== observed.size ||
      [...active].some((p) => !observed.has(p)) ||
      observed.size !== positions.length
    )
      reasons.push('Active bank pools and position observations disagree');
    if (
      [...active].some((p) => !known.has(p)) ||
      positions.some((p) => !known.has(p.pool.toLowerCase())) ||
      open.orders.some((o) => !known.has(o.pool.toLowerCase()))
    )
      reasons.push('Exposure contains an unknown market');
    if (positions.some((p) => p.size !== 0n && !p.priceable))
      reasons.push('A nonzero position cannot be priced');
    if (
      open.orders.some(
        (o) =>
          o.owner.toLowerCase() !== owner.toLowerCase() ||
          o.quantityRemaining <= 0n ||
          o.quantityRemaining > o.fullQuantity ||
          o.price <= 0n,
      )
    )
      reasons.push('Open order ownership or remaining quantity is inconsistent');
    if (
      new Set(open.orders.map((o) => o.pool.toLowerCase() + ':' + o.orderId)).size !==
      open.orders.length
    )
      reasons.push('Duplicate authoritative order identities');
  }
  return {
    complete: reasons.length === 0,
    source: 'on-chain-active-pools-and-open-orders' as const,
    blockNumber: margin?.asOfBlock.toString() ?? null,
    reasons,
  };
}
