import Decimal from 'decimal.js';
export interface AccountMovement {
  id: string;
  block: string;
  kind: string;
  amount: string;
  account: string;
  txHash: string;
}
export interface EquityPoint {
  block: string;
  blockHash: string;
  at: number;
  totalEquity: string;
}
export interface AccountingReport {
  account: string;
  bank: string;
  chainId: 50383;
  from: EquityPoint;
  to: EquityPoint;
  complete: boolean;
  netPnl: string | null;
  netFlows: string;
  fees: string;
  fundingPaid: string;
  realizedPnl: string;
  reasons: string[];
  movements: AccountMovement[];
  fillCount: number;
  generatedAt: number;
}
/** Equity already includes fees/funding: display their breakdown without deducting twice. */
export function reconcileAccounting(
  input: Omit<
    AccountingReport,
    'netPnl' | 'netFlows' | 'fees' | 'fundingPaid' | 'realizedPnl' | 'complete'
  >,
): AccountingReport {
  const reasons = [...input.reasons],
    seen = new Set<string>();
  let flows = new Decimal(0),
    fees = new Decimal(0),
    funding = new Decimal(0),
    realized = new Decimal(0);
  if (BigInt(input.to.block) < BigInt(input.from.block) || input.to.at < input.from.at)
    reasons.push('Snapshot range is reversed');
  for (const m of input.movements) {
    if (seen.has(m.id)) {
      reasons.push('Duplicate accounting event ' + m.id);
      continue;
    }
    seen.add(m.id);
    if (
      m.account.toLowerCase() !== input.account.toLowerCase() ||
      BigInt(m.block) <= BigInt(input.from.block) ||
      BigInt(m.block) > BigInt(input.to.block)
    ) {
      reasons.push('Accounting event outside owner/range');
      continue;
    }
    const amount = new Decimal(m.amount);
    if (!amount.isFinite()) {
      reasons.push('Non-finite accounting amount');
      continue;
    }
    if (['deposit', 'credit', 'main-funding', 'debt-coverage'].includes(m.kind))
      flows = flows.plus(amount);
    else if (['withdrawal', 'credit-reclaimed', 'principal-return'].includes(m.kind))
      flows = flows.minus(amount);
    else if (m.kind === 'fee') fees = fees.plus(amount);
    else if (m.kind === 'rebate') fees = fees.minus(amount);
    else if (m.kind === 'funding') funding = funding.plus(amount);
    else if (m.kind === 'realized') realized = realized.plus(amount);
    else reasons.push('Unsupported accounting movement ' + m.kind);
  }
  return {
    ...input,
    reasons: [...new Set(reasons)],
    complete: reasons.length === 0,
    netPnl: reasons.length
      ? null
      : new Decimal(input.to.totalEquity).minus(input.from.totalEquity).minus(flows).toFixed(),
    netFlows: flows.toFixed(),
    fees: fees.toFixed(),
    fundingPaid: funding.toFixed(),
    realizedPnl: realized.toFixed(),
  };
}
