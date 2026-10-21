/** A receipt confirms a transaction; fills require separate event/indexer evidence. */
export function orderOutcome(e: {
  reverted: boolean;
  cancellation: boolean;
  cancelled: boolean;
  rested: boolean;
  remaining?: bigint;
  fillCount: number;
  order: null | { status: string; quantityRemaining: string; fullQuantity: string };
}) {
  if (e.reverted) return 'reverted';
  if (e.cancelled) return 'cancelled';
  // Same-transaction terminal fill evidence takes precedence over a lagging indexer row.
  if (e.remaining === 0n) return 'filled';
  if (e.order?.status === 'Filled') return 'filled';
  if (e.order && ['Cancelled', 'Expired'].includes(e.order.status)) return 'cancelled';
  if (e.remaining !== undefined && e.fillCount > 0) return 'partial';
  if (e.order)
    return BigInt(e.order.quantityRemaining) < BigInt(e.order.fullQuantity)
      ? 'partial'
      : e.cancellation
        ? 'syncing'
        : 'resting';
  return e.rested ? 'resting' : 'syncing';
}
