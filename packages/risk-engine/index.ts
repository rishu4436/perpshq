import Decimal from 'decimal.js';
import type { Market, PlanInput, Plan, OrderBook } from '../shared-types';
Decimal.set({ precision: 80, rounding: Decimal.ROUND_DOWN });
export function toRaw(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 100)
    throw new Error('Use a positive plain decimal');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error('Invalid token decimals');
  const d = new Decimal(value).mul(new Decimal(10).pow(decimals));
  if (!d.isInteger()) throw new Error(`Amount exceeds ${decimals} decimal places`);
  return BigInt(d.toFixed(0));
}
export function fromRaw(value: string | bigint, decimals: number): string {
  return new Decimal(value.toString()).div(new Decimal(10).pow(decimals)).toFixed();
}
export function planTrade(input: PlanInput, market: Market): Plan {
  const errors: string[] = [],
    warnings = [
      'Stop and target are planning levels only. This order does not arm native TP/SL.',
      'Loss estimates include adverse entry and exit slippage; gaps, funding and network fees can add further loss.',
    ];
  const out: Plan = {
    input,
    quantity: '0',
    rawQuantity: '0',
    rawPrice: '0',
    notional: '0',
    margin: '0',
    loss: '0',
    gain: '0',
    rr: '0',
    errors,
    warnings,
  };
  try {
    if (input.marketId !== market.id)
      throw new Error('Plan market does not match the selected pool');
    const e = new Decimal(input.entry),
      s = new Decimal(input.stop),
      t = new Decimal(input.target),
      r = new Decimal(input.riskBudget),
      coll = new Decimal(input.collateral),
      lev = new Decimal(input.leverage),
      slip = new Decimal(input.slippageBps).div(10000);
    if ([e, s, t, r, coll, lev].some((v) => !v.isFinite() || v.lte(0)))
      throw new Error('Entry, stop, target, collateral, risk and leverage must be positive');
    if (slip.lt(0) || slip.gt(0.05) || !slip.isFinite())
      throw new Error('Slippage must be between 0 and 500 bps');
    if (lev.gt(market.maxLeverage ?? 1))
      errors.push('Requested planning leverage exceeds verified market maximum');
    const dist = input.side === 'long' ? e.minus(s) : s.minus(e),
      reward = input.side === 'long' ? t.minus(e) : e.minus(t);
    if (dist.lte(0)) throw new Error('Stop must be below a long entry or above a short entry');
    if (reward.lte(0)) throw new Error('Target must be above a long entry or below a short entry');
    const riskPer = dist.plus(e.plus(s).mul(slip));
    const q = input.quantity ? new Decimal(input.quantity) : r.div(riskPer);
    if (!q.isFinite() || q.lte(0)) throw new Error('Quantity must be positive');
    const base = new Decimal(10).pow(market.baseDecimals),
      lot = new Decimal(market.lotSize);
    if (lot.lte(0) || new Decimal(market.tickSize).lte(0))
      throw new Error('Market increments unavailable');
    const raw = q.mul(base).div(lot).floor().mul(lot);
    const quantity = raw.div(base),
      priceRaw = toRaw(input.entry, market.quoteDecimals);
    if (priceRaw % BigInt(market.tickSize) !== 0n)
      errors.push('Entry must be an exact multiple of this market’s price tick');
    if (raw.lt(market.minQuantity)) errors.push('Risk-sized quantity is below the market minimum');
    const notional = quantity.mul(e),
      margin = notional.div(lev),
      loss = quantity.mul(riskPer),
      gain = quantity.mul(reward.minus(e.plus(t).mul(slip)));
    if (margin.gt(coll)) errors.push('Planned margin exceeds stated collateral');
    if (loss.gt(r)) errors.push('Quantity exceeds the stated loss budget after slippage');
    if (gain.lte(0)) errors.push('Estimated slippage exceeds target reward');
    Object.assign(out, {
      quantity: quantity.toFixed(),
      rawQuantity: raw.toFixed(0),
      rawPrice: priceRaw.toString(),
      notional: notional.toFixed(2),
      margin: margin.toFixed(2),
      loss: loss.toFixed(2),
      gain: gain.toFixed(2),
      rr: gain.div(loss).toFixed(2),
    });
    return out;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Invalid plan');
    return out;
  }
}
export function estimateFill(book: OrderBook, side: 'long' | 'short', quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be positive');
  let remaining = quantity,
    cost = 0;
  const levels = side === 'long' ? book.asks : book.bids;
  for (const l of levels) {
    const q = Math.min(remaining, l.quantity);
    remaining -= q;
    cost += q * l.price;
    if (remaining <= 1e-12) break;
  }
  const filled = quantity - remaining;
  return {
    average: filled > 0 ? cost / filled : null,
    filled,
    unfilled: remaining,
    depthLimited: remaining > 1e-12,
  };
}
