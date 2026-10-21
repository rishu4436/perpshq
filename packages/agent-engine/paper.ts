import Decimal from 'decimal.js';
import type { MarketDetail } from '../shared-types';
import type { AgentConfig } from './config';
import type { AgentAccount, AgentDecision, AgentPosition, ProposedOrder } from './types';
export interface PaperFill {
  id: string;
  decisionId: string;
  at: number;
  side: 'long' | 'short';
  quantity: string;
  price: string;
  fee: string;
  realizedPnl: string;
  kind: 'entry' | 'exit';
  evidenceKind: 'SIMULATED';
}
export interface PaperOrder {
  id: string;
  decisionId: string;
  createdAt: number;
  expiresAt: number;
  proposal: ProposedOrder;
  remaining: string;
}
export interface PaperPosition extends AgentPosition {
  entryFees: string;
  fundingPaid: string;
  realizedNet: string;
}
export interface PaperLedger {
  schemaVersion: 1;
  initialEquity: string;
  cash: string;
  equity: string;
  peakEquity: string;
  maxDrawdown: string;
  realizedPnl: string;
  fees: string;
  funding: string;
  day: string;
  dayStartCash: string;
  updatedAt: number;
  startedAt: number;
  position?: PaperPosition;
  lastBookConsumedAt?: number;
  orders: PaperOrder[];
  fills: PaperFill[];
  closedTrades: number;
  closedNetPnl: string;
  wins: number;
  losses: number;
  lastFillAt?: number;
}
export function initialLedger(c: AgentConfig, now: number): PaperLedger {
  return {
    schemaVersion: 1,
    initialEquity: c.paper.initialEquity,
    cash: c.paper.initialEquity,
    equity: c.paper.initialEquity,
    peakEquity: c.paper.initialEquity,
    maxDrawdown: '0',
    realizedPnl: '0',
    fees: '0',
    funding: '0',
    day: new Date(now).toISOString().slice(0, 10),
    dayStartCash: c.paper.initialEquity,
    updatedAt: now,
    startedAt: now,
    orders: [],
    fills: [],
    closedTrades: 0,
    closedNetPnl: '0',
    wins: 0,
    losses: 0,
  };
}
export function paperAccount(c: AgentConfig, l: PaperLedger, now: number): AgentAccount {
  const exposure = new Decimal(l.position?.notional ?? 0).plus(
    l.orders.reduce(
      (sum, o) => sum.plus(new Decimal(o.remaining).mul(o.proposal.price)),
      new Decimal(0),
    ),
  );
  const unrealized = new Decimal(l.position?.unrealizedPnl ?? 0);
  return {
    source: 'paper',
    observedAt: now,
    equity: l.equity,
    availableCollateral: Decimal.max(
      0,
      new Decimal(l.equity).minus(exposure.div(c.risk.leverage)),
    ).toFixed(),
    totalExposure: exposure.toFixed(),
    marketExposure: exposure.toFixed(),
    positionCount: l.position ? 1 : 0,
    positions: l.position ? [l.position] : [],
    orders: l.orders.map((o) => ({
      orderId: o.id,
      marketId: c.marketId,
      owner: c.ownerAddress ?? 'PAPER',
      agentId: c.id,
      quantity: o.proposal.quantity,
      remaining: o.remaining,
      notional: new Decimal(o.remaining).mul(o.proposal.price).toFixed(),
    })),
    health: exposure.isZero() ? 100 : new Decimal(l.equity).div(exposure.mul(0.05)).toNumber(),
    verifiedLeverage: null,
    sessionPnl: new Decimal(l.equity).minus(l.initialEquity).toFixed(),
    dailyPnl: new Decimal(l.cash).minus(l.dayStartCash).plus(Decimal.min(unrealized, 0)).toFixed(),
    historyComplete: true,
    gasSTT: null,
    permissions: null,
    errors: [],
  };
}
export function markPaper(
  c: AgentConfig,
  input: PaperLedger,
  d: MarketDetail,
  now: number,
): PaperLedger {
  const l: PaperLedger = structuredClone(input),
    mark = d.market.markPrice;
  if (
    !mark ||
    d.market.error ||
    !d.market.markUpdatedAt ||
    now - d.market.markUpdatedAt > c.risk.maxDataAgeSeconds * 1000 ||
    d.market.markUpdatedAt > now + 1000
  )
    throw new Error('Paper accounting requires a fresh valid mark');
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== l.day) {
    l.day = day;
    l.dayStartCash = l.cash;
  }
  if (l.position) {
    const elapsed = Math.max(0, now - l.updatedAt) / 3600000;
    const funding = new Decimal(l.position.quantity)
      .mul(mark)
      .mul(c.paper.fundingBpsPerHour)
      .div(10000)
      .mul(elapsed)
      .mul(l.position.side === 'long' ? 1 : -1);
    l.position.fundingPaid = new Decimal(l.position.fundingPaid).plus(funding).toFixed();
    l.cash = new Decimal(l.cash).minus(funding).toFixed();
    l.funding = new Decimal(l.funding).plus(funding).toFixed();
    l.position.notional = new Decimal(l.position.quantity).mul(mark).toFixed();
    l.position.unrealizedPnl = new Decimal(mark)
      .minus(l.position.entryPrice)
      .mul(l.position.quantity)
      .mul(l.position.side === 'long' ? 1 : -1)
      .toFixed();
  }
  l.equity = new Decimal(l.cash).plus(l.position?.unrealizedPnl ?? 0).toFixed();
  l.peakEquity = Decimal.max(l.peakEquity, l.equity).toFixed();
  l.maxDrawdown = Decimal.max(l.maxDrawdown, new Decimal(l.peakEquity).minus(l.equity)).toFixed();
  l.updatedAt = now;
  return l;
}
/** Snapshot-depth taker model, no queue priority, invented candle or guaranteed fill. */
export function visibleFill(
  c: AgentConfig,
  d: MarketDetail,
  p: ProposedOrder,
  wanted: string,
  now: number,
) {
  const b = d.book;
  if (
    !b ||
    now - b.fetchedAt > c.risk.maxDataAgeSeconds * 1000 ||
    b.fetchedAt > now + 1000 ||
    !b.asks.length ||
    !b.bids.length ||
    b.bids[0].price >= b.asks[0].price
  )
    return { quantity: '0', price: '0', reason: 'Fresh uncrossed two-sided depth is unavailable.' };
  const levels = (p.side === 'long' ? b.asks : b.bids)
    .filter(
      (v) =>
        Number.isFinite(v.price) && Number.isFinite(v.quantity) && v.price > 0 && v.quantity > 0,
    )
    .sort((a, b) => (p.side === 'long' ? a.price - b.price : b.price - a.price));
  let remaining = new Decimal(wanted),
    filled = new Decimal(0),
    cost = new Decimal(0);
  const slip = new Decimal(c.paper.slippageBps).div(10000);
  for (const level of levels) {
    const price = new Decimal(level.price).mul(
      new Decimal(1).plus(slip.mul(p.side === 'long' ? 1 : -1)),
    );
    if (p.side === 'long' ? price.gt(p.price) : price.lt(p.price)) break;
    const take = Decimal.min(level.quantity, remaining);
    filled = filled.plus(take);
    cost = cost.plus(take.mul(price));
    remaining = remaining.minus(take);
    if (remaining.lte(0)) break;
  }
  const lot = new Decimal(d.market.lotSize).div(new Decimal(10).pow(d.market.baseDecimals));
  const aligned = filled.div(lot).floor().mul(lot);
  if (aligned.lt(new Decimal(d.market.minQuantity).div(new Decimal(10).pow(d.market.baseDecimals))))
    return {
      quantity: '0',
      price: '0',
      reason: 'Visible depth within the bound is below the market minimum.',
    };
  return {
    quantity: aligned.toFixed(),
    price: cost.div(filled).toFixed(),
    reason: aligned.lt(wanted)
      ? 'Partial simulated fill capped by observed depth.'
      : 'Simulated fill from observed depth with adverse slippage.',
  };
}
export function applyPaperFill(
  c: AgentConfig,
  l: PaperLedger,
  p: ProposedOrder,
  q: string,
  price: string,
  id: string,
  now: number,
) {
  const qty = new Decimal(q),
    fee = qty.mul(price).mul(c.paper.feeBps).div(10000);
  let pnl = new Decimal(0),
    kind: PaperFill['kind'] = 'entry';
  if (p.action === 'entry') {
    if (l.position && l.position.side !== p.side)
      throw new Error('Paper entry cannot silently net an opposite position');
    const old = new Decimal(l.position?.quantity ?? 0),
      combined = old.plus(qty),
      entry = old
        .mul(l.position?.entryPrice ?? 0)
        .plus(qty.mul(price))
        .div(combined);
    l.position = {
      marketId: c.marketId,
      side: p.side,
      quantity: combined.toFixed(),
      entryPrice: entry.toFixed(),
      notional: combined.mul(price).toFixed(),
      unrealizedPnl: '0',
      stopPrice: p.stopPrice,
      targetPrice: p.targetPrice,
      source: 'paper',
      entryFees: new Decimal(l.position?.entryFees ?? 0).plus(fee).toFixed(),
      fundingPaid: l.position?.fundingPaid ?? '0',
      realizedNet: l.position?.realizedNet ?? '0',
    };
  } else {
    if (!l.position || l.position.side === p.side || qty.gt(l.position.quantity))
      throw new Error('Paper reduction does not match an existing position');
    pnl = new Decimal(price)
      .minus(l.position.entryPrice)
      .mul(qty)
      .mul(l.position.side === 'long' ? 1 : -1);
    kind = 'exit';
    const ratio = qty.div(l.position.quantity),
      entryCost = new Decimal(l.position.entryFees).mul(ratio),
      fundingCost = new Decimal(l.position.fundingPaid).mul(ratio);
    const net = new Decimal(l.position.realizedNet)
      .plus(pnl)
      .minus(fee)
      .minus(entryCost)
      .minus(fundingCost);
    const left = new Decimal(l.position.quantity).minus(qty);
    if (left.isZero()) {
      l.position = undefined;
      l.closedTrades++;
      l.closedNetPnl = new Decimal(l.closedNetPnl).plus(net).toFixed();
      if (net.gt(0)) l.wins++;
      else if (net.lt(0)) l.losses++;
    } else {
      l.position.quantity = left.toFixed();
      l.position.notional = left.mul(price).toFixed();
      l.position.entryFees = new Decimal(l.position.entryFees).minus(entryCost).toFixed();
      l.position.fundingPaid = new Decimal(l.position.fundingPaid).minus(fundingCost).toFixed();
      l.position.realizedNet = net.toFixed();
    }
  }
  l.cash = new Decimal(l.cash).plus(pnl).minus(fee).toFixed();
  l.realizedPnl = new Decimal(l.realizedPnl).plus(pnl).toFixed();
  l.fees = new Decimal(l.fees).plus(fee).toFixed();
  l.lastFillAt = now;
  l.fills.push({
    id: 'paper:' + id + ':' + l.fills.length,
    decisionId: id,
    at: now,
    side: p.side,
    quantity: q,
    price,
    fee: fee.toFixed(),
    realizedPnl: pnl.toFixed(),
    kind,
    evidenceKind: 'SIMULATED',
  });
  l.fills = l.fills.slice(-1000);
}
export function advancePaper(
  c: AgentConfig,
  input: PaperLedger,
  d: MarketDetail,
  decision: AgentDecision | undefined,
  now: number,
) {
  if (d.quality.stale) throw new Error('Paper fills are withheld for stale history');
  let l = markPaper(c, input, d, now);
  const notes: string[] = [];
  const freshDepth = () => !!d.book && d.book.fetchedAt > (l.lastBookConsumedAt ?? 0);
  const nextOrders: PaperOrder[] = [];
  for (const order of l.orders) {
    if (order.expiresAt <= now) {
      notes.push('Paper limit expired: ' + order.id);
      continue;
    }
    const fill = freshDepth()
      ? visibleFill(c, d, order.proposal, order.remaining, now)
      : { quantity: '0', price: '0', reason: 'This book observation was already consumed.' };
    if (new Decimal(fill.quantity).gt(0)) {
      applyPaperFill(c, l, order.proposal, fill.quantity, fill.price, order.decisionId, now);
      l.lastBookConsumedAt = d.book!.fetchedAt;
      order.remaining = new Decimal(order.remaining).minus(fill.quantity).toFixed();
      notes.push(fill.reason);
    }
    if (new Decimal(order.remaining).gt(0)) nextOrders.push(order);
  }
  l.orders = nextOrders;
  if (
    decision?.proposal &&
    decision.risk.allowed &&
    ['ENTRY_CANDIDATE', 'EXIT_CANDIDATE', 'REDUCE_CANDIDATE'].includes(decision.type)
  ) {
    const p = decision.proposal;
    // Existing exit recommendations for actual chain positions are never converted to paper fills.
    if (p.action !== 'entry' && !l.position)
      notes.push('Chain position recommendation only; no corresponding paper position exists.');
    else {
      const fill = freshDepth()
        ? visibleFill(c, d, p, p.quantity, now)
        : { quantity: '0', price: '0', reason: 'This book observation was already consumed.' };
      notes.push(fill.reason);
      if (new Decimal(fill.quantity).gt(0)) {
        applyPaperFill(c, l, p, fill.quantity, fill.price, decision.id, now);
        l.lastBookConsumedAt = d.book!.fetchedAt;
      }
      const remaining = new Decimal(p.quantity).minus(fill.quantity);
      if (p.orderType === 'LIMIT' && remaining.gt(0))
        l.orders.push({
          id: 'paper-order:' + decision.id,
          decisionId: decision.id,
          createdAt: now,
          expiresAt: now + c.execution.expirySeconds * 1000,
          proposal: p,
          remaining: remaining.toFixed(),
        });
    }
  }
  // Revalue after fills; elapsed is zero, so funding is not charged twice.
  l = markPaper(c, l, d, now);
  return { ledger: l, notes };
}
