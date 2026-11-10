import type { Market } from '../../../../packages/shared-types';
import { price, fmt } from '../lib';
const time = (at?: number) =>
  at && Number.isFinite(at) ? new Date(at).toISOString() : 'Timestamp unavailable';
export function PriceSources({ market, indexed }: { market: Market; indexed?: Market }) {
  const oracle = market.markSource === 'oracle' && !market.error ? market.markPrice : undefined;
  const settlement = market.indexedMarkPrice ?? indexed?.markPrice;
  const settlementAt = market.indexedMarkUpdatedAt ?? indexed?.markUpdatedAt;
  const gap = oracle && settlement ? ((oracle - settlement) / settlement) * 100 : undefined;
  return (
    <section className="notice" aria-label="Market price sources">
      <strong>{market.symbol} price sources</strong>
      <p>
        Oracle mark: {price(oracle)} ·{' '}
        {oracle === undefined ? 'Live oracle unavailable' : time(market.markUpdatedAt)}
      </p>
      <p>
        Indexed settlement snapshot: {price(settlement)} · {time(settlementAt)}
      </p>
      {gap !== undefined && (
        <p>
          Oracle versus settlement: {fmt(gap, 2)}%. The market list uses the indexed settlement
          snapshot; this chart header uses the on-chain oracle. Settlement updates and oracle reads
          occur at different times, so these prices can differ.
        </p>
      )}
    </section>
  );
}
