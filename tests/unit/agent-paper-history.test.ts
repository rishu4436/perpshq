import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { agentFixture, agentNow } from '../agent-fixtures';
import { evaluateAgent } from '../../packages/agent-engine';
import { advancePaper, markPaper, paperAccount } from '../../packages/agent-engine/paper';
import { evaluateHistory } from '../../packages/agent-engine/history';
import { assessRisk, sizeProposal } from '../../packages/agent-risk';
function paperFixture() {
  const f = agentFixture();
  f.detail.market.markPrice = 100;
  f.detail.book = {
    bids: [{ price: 99.99, quantity: 10 }],
    asks: [{ price: 100.01, quantity: 10 }],
    fetchedAt: agentNow,
    source: 'TEST ONLY depth',
  };
  const p = sizeProposal(f.config, f.detail.market, 'long'),
    d = {
      ...evaluateAgent(f.config, f.observation, f.runtime, agentNow),
      proposal: p,
      type: 'ENTRY_CANDIDATE' as const,
      risk: assessRisk(f.config, f.observation, f.runtime, p, agentNow),
    };
  return { ...f, decision: d };
}
describe('auditable paper accounting', () => {
  it('uses observed depth with adverse costs and never creates a blockchain hash', () => {
    const f = paperFixture(),
      result = advancePaper(f.config, f.ledger, f.detail, f.decision, agentNow);
    expect(result.ledger.fills).toHaveLength(1);
    const fill = result.ledger.fills[0];
    expect(new Decimal(fill.price).gte('100.01')).toBe(true);
    expect(new Decimal(result.ledger.cash).eq(new Decimal(f.ledger.cash).minus(fill.fee))).toBe(
      true,
    );
    expect(fill.evidenceKind).toBe('SIMULATED');
    expect(fill).not.toHaveProperty('hash');
    expect(paperAccount(f.config, result.ledger, agentNow).gasSTT).toBeNull();
  });
  it('includes entry/exit fees in closed-trade net outcomes', () => {
    const f = paperFixture(),
      opened = advancePaper(f.config, f.ledger, f.detail, f.decision, agentNow).ledger;
    f.detail.market.markPrice = 103;
    f.detail.market.markUpdatedAt = agentNow + 1000;
    f.detail.book = {
      bids: [{ price: 103, quantity: 10 }],
      asks: [{ price: 103.01, quantity: 10 }],
      fetchedAt: agentNow + 1000,
      source: 'TEST ONLY',
    };
    const p = sizeProposal(
      f.config,
      f.detail.market,
      'short',
      opened.position!.quantity,
      'close-position',
    );
    const closed = advancePaper(
      f.config,
      opened,
      f.detail,
      { ...f.decision, id: 'exit', type: 'EXIT_CANDIDATE', proposal: p },
      agentNow + 1000,
    ).ledger;
    expect(closed.position).toBeUndefined();
    expect(closed.closedTrades).toBe(1);
    expect(closed.wins).toBe(1);
    expect(
      new Decimal(closed.closedNetPnl).eq(new Decimal(closed.cash).minus(closed.initialEquity)),
    ).toBe(true);
    expect(new Decimal(closed.fees).gt(opened.fees)).toBe(true);
  });
  it('caps partial fills to visible quantity and does not consume the same observation twice', () => {
    const f = paperFixture();
    const minimum = new Decimal(f.detail.market.minQuantity).div(
      new Decimal(10).pow(f.detail.market.baseDecimals),
    );
    f.detail.book!.asks[0].quantity = minimum.mul(2).toNumber();
    const first = advancePaper(f.config, f.ledger, f.detail, f.decision, agentNow);
    expect(first.notes.join(' ')).toContain('Partial');
    expect(new Decimal(first.ledger.position!.quantity).lte(minimum.mul(2))).toBe(true);
    const again = advancePaper(
      f.config,
      first.ledger,
      f.detail,
      { ...f.decision, id: 'different-decision' },
      agentNow + 1,
    );
    expect(again.ledger.fills).toHaveLength(1);
  });
  it.each(['missing', 'stale', 'crossed'] as const)('never invents fills for %s depth', (kind) => {
    const f = paperFixture();
    if (kind === 'missing') f.detail.book = null;
    if (kind === 'stale') f.detail.book!.fetchedAt = agentNow - 90001;
    if (kind === 'crossed') f.detail.book!.bids[0].price = 101;
    const result = advancePaper(f.config, f.ledger, f.detail, f.decision, agentNow);
    expect(result.ledger.fills).toHaveLength(0);
    expect(result.ledger.position).toBeUndefined();
  });
  it('holds a paper limit until it can cross a later observed book, without assuming maker queue priority', () => {
    const f = paperFixture();
    f.config.execution.orderType = 'LIMIT';
    const p = sizeProposal(f.config, f.detail.market, 'long');
    const first = advancePaper(
      f.config,
      f.ledger,
      f.detail,
      { ...f.decision, proposal: p },
      agentNow,
    ).ledger;
    expect(first.fills).toHaveLength(0);
    expect(first.orders).toHaveLength(1);
    f.detail.book!.asks[0].price = 99.5;
    f.detail.book!.bids[0].price = 99.49;
    f.detail.book!.fetchedAt = agentNow + 1000;
    f.detail.market.markUpdatedAt = agentNow + 1000;
    const next = advancePaper(f.config, first, f.detail, undefined, agentNow + 1000).ledger;
    expect(next.fills).toHaveLength(1);
    expect(next.orders).toHaveLength(0);
  });
  it('withholds paper execution for stale history and stale mark', () => {
    const f = paperFixture();
    f.detail.quality.stale = true;
    expect(() => advancePaper(f.config, f.ledger, f.detail, f.decision, agentNow)).toThrow(
      'stale history',
    );
    f.detail.quality.stale = false;
    f.detail.market.markUpdatedAt = agentNow - 90001;
    expect(() => markPaper(f.config, f.ledger, f.detail, agentNow)).toThrow('fresh valid mark');
  });
  it('charges the explicit funding assumption over elapsed time and tracks drawdown', () => {
    const f = paperFixture();
    f.config.paper.fundingBpsPerHour = 10;
    const opened = advancePaper(f.config, f.ledger, f.detail, f.decision, agentNow).ledger;
    f.detail.market.markUpdatedAt = agentNow + 3600000;
    const later = markPaper(f.config, opened, f.detail, agentNow + 3600000);
    expect(new Decimal(later.funding).gt(0)).toBe(true);
    expect(new Decimal(later.cash).lt(opened.cash)).toBe(true);
    expect(new Decimal(later.maxDrawdown).gte(opened.maxDrawdown)).toBe(true);
  });
});
describe('causal historical evaluation', () => {
  it('reports real sample coverage and separate chronological validation without predictive claims', () => {
    const f = agentFixture(),
      r = evaluateHistory(f.config, f.detail.market, f.detail.candles, agentNow);
    expect(r.kind).toBe('HISTORICAL_SIMULATION');
    expect(r.sample.usableCandles).toBe(f.detail.candles.length);
    expect(r.partitions[0].to!).toBeLessThan(r.partitions[1].from!);
    expect(r.limitations.join(' ')).toContain('No historical order book');
    expect(r.partitions[0].evaluatedCandles).toBeGreaterThan(0);
  });
  it('adding later real observations cannot change earlier decisions', () => {
    const f = agentFixture(),
      full = evaluateHistory(f.config, f.detail.market, f.detail.candles, agentNow),
      prefix = evaluateHistory(f.config, f.detail.market, f.detail.candles.slice(0, 200), agentNow);
    expect(prefix.decisions.slice(0, 50)).toEqual(full.decisions.slice(0, 50));
  });
  it('missing volume never receives an arbitrary favorable next-open fill', () => {
    const f = agentFixture(),
      r = evaluateHistory(
        f.config,
        f.detail.market,
        f.detail.candles.map((c) => ({ ...c, volume: undefined })),
        agentNow,
      );
    expect(r.partitions.reduce((sum, p) => sum + p.simulatedFills, 0)).toBe(0);
    expect(r.partitions.reduce((sum, p) => sum + p.unfilled, 0)).toBeGreaterThan(0);
  });
  it('insufficient history produces no fabricated trade statistics', () => {
    const f = agentFixture(),
      r = evaluateHistory(f.config, f.detail.market, f.detail.candles.slice(-20), agentNow);
    expect(
      r.partitions.every(
        (p) =>
          p.evaluatedCandles === 0 && p.averageClosedNetOutcome === null && p.winLossRatio === null,
      ),
    ).toBe(true);
  });
  it('does not relabel another market’s candles', () => {
    const f = agentFixture();
    expect(() =>
      evaluateHistory(
        f.config,
        f.detail.market,
        [{ ...f.detail.candles[0], market: '0x' + '2'.repeat(40) }],
        agentNow,
      ),
    ).toThrow('configured perp');
  });
});
