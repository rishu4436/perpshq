import { describe, expect, it } from 'vitest';
import { reconcileAccounting, type AccountMovement } from '../../packages/accounting';
import { tradingReadiness } from '../../packages/trade-planner/readiness';
import { agentFixture, agentNow } from '../agent-fixtures';
const owner = '0x' + '1'.repeat(40);
function report(movements: AccountMovement[] = []) {
  return reconcileAccounting({
    account: owner,
    bank: '0x' + '2'.repeat(40),
    chainId: 50383,
    from: { block: '100', blockHash: '0xaa', at: 1000, totalEquity: '100' },
    to: { block: '110', blockHash: '0xbb', at: 2000, totalEquity: '155' },
    movements,
    reasons: [],
    fillCount: 2,
    generatedAt: 2000,
  });
}
const movement = (kind: string, amount: string, id = kind): AccountMovement => ({
  id,
  block: '105',
  kind,
  amount,
  account: owner,
  txHash: '0xabc',
});
describe('accounting and readiness', () => {
  it('removes cash flows and avoids double charging fees/funding already reflected in equity', () => {
    const r = report([
      movement('deposit', '80'),
      movement('withdrawal', '30'),
      movement('fee', '2'),
      movement('funding', '3'),
    ]);
    expect(r.complete).toBe(true);
    expect(r.netPnl).toBe('5');
    expect(r.netFlows).toBe('50');
    expect(r.fees).toBe('2');
    expect(r.fundingPaid).toBe('3');
  });
  it('handles negative funding, rebates, credits and principal returns exactly', () => {
    const r = report([
      movement('funding', '-2'),
      movement('rebate', '0.1'),
      movement('credit', '10'),
      movement('principal-return', '5'),
    ]);
    expect(r.netPnl).toBe('50');
    expect(r.fundingPaid).toBe('-2');
    expect(r.fees).toBe('-0.1');
  });
  it('withholds P&L for duplicate, unsupported or wrongly scoped evidence', () => {
    for (const moves of [
      [movement('mystery', '1')],
      [movement('deposit', '1'), movement('deposit', '1')],
      [{ ...movement('deposit', '1'), block: '100' }],
      [{ ...movement('deposit', '1'), account: 'other' }],
    ]) {
      const r = report(moves);
      expect(r.complete).toBe(false);
      expect(r.netPnl).toBeNull();
    }
  });
  it('never treats a connected wallet as funded and ready', () => {
    const f = agentFixture(),
      r = tradingReadiness({
        address: owner,
        chain: 50383,
        market: f.detail.market,
        now: agentNow,
      });
    expect(r.find((v) => v.name === 'Wallet connected')?.passed).toBe(true);
    expect(r.find((v) => v.name === 'Eligible collateral')?.passed).toBe(false);
    expect(r.find((v) => v.name === 'Complete exposure')?.passed).toBe(false);
  });
  it('blocks stale, mismatched account identity and unresolved submissions', () => {
    const f = agentFixture(),
      r = tradingReadiness({
        address: owner,
        chain: 50383,
        market: f.detail.market,
        unresolved: true,
        now: agentNow,
        account: {
          address: '0x' + '2'.repeat(40),
          fetchedAt: agentNow - 91000,
          quoteDecimals: 18,
          margin: null,
          errors: [],
        },
      });
    expect(r.find((v) => v.name === 'Account identity and freshness')?.passed).toBe(false);
    expect(r.find((v) => v.name === 'Submission reconciled')?.passed).toBe(false);
  });
});
