import Decimal from 'decimal.js';
import type { Market } from '../shared-types';
export interface ReadinessAccount {
  address: string;
  fetchedAt: number;
  gas?: string | null;
  quoteDecimals: number;
  exposure?: { complete: boolean; blockNumber: string | null; reasons: string[] };
  margin: null | {
    unlockedCollateralBalance: string;
    equity: string;
    imReq: string;
    asOfBlock: string;
  };
  errors: string[];
}
export function tradingReadiness(input: {
  address?: string;
  chain?: number;
  account?: ReadinessAccount;
  market?: Market;
  unresolved?: boolean;
  planErrors?: string[];
  now?: number;
}) {
  const { address, chain, account: a, market: m } = input,
    now = input.now ?? Date.now();
  const positive = (v: string | undefined | null) => {
    try {
      return new Decimal(v ?? 0).gt(0);
    } catch {
      return false;
    }
  };
  const fresh = !!a && now - a.fetchedAt >= 0 && now - a.fetchedAt <= 90000;
  return [
    {
      name: 'Wallet connected',
      passed: !!address,
      detail: address ?? 'Connect the wallet that will review and sign the order.',
    },
    {
      name: 'Hideki network',
      passed: chain === 50383,
      detail: chain === 50383 ? 'Chain 50383' : 'Switch the connected wallet to Somnia Hideki.',
    },
    {
      name: 'Account identity and freshness',
      passed: !!address && a?.address.toLowerCase() === address.toLowerCase() && fresh,
      detail: 'Use a matching account snapshot no older than 90 seconds.',
    },
    {
      name: 'Eligible collateral',
      passed: positive(a?.margin?.unlockedCollateralBalance),
      detail:
        'Unlocked collateral must be present in the perpetual margin bank; wallet token balances alone do not count.',
    },
    {
      name: 'Gas reserve',
      passed: !!a?.gas && new Decimal(a.gas).gte('10000000000000000'),
      detail:
        'Maintain at least 0.01 STT for planning. The reviewed transaction still needs its own exact gas estimate.',
    },
    {
      name: 'Complete exposure',
      passed: a?.exposure?.complete === true,
      detail:
        a?.exposure?.reasons.join('; ') ||
        'Margin, positions and remaining orders must share one verified block.',
    },
    {
      name: 'Margin health',
      passed: !!a?.margin && new Decimal(a.margin.equity).gte(a.margin.imReq),
      detail: 'Free equity must cover current initial margin requirements.',
    },
    {
      name: 'Market increments',
      passed: !!m && positive(m.minQuantity) && positive(m.lotSize) && positive(m.tickSize),
      detail: m
        ? `Minimum ${m.minQuantity} raw base units · lot ${m.lotSize} · tick ${m.tickSize} raw quote units`
        : 'Select a discovered perpetual market.',
    },
    {
      name: 'Submission reconciled',
      passed: !input.unresolved,
      detail: input.unresolved
        ? 'Resolve the previous wallet request before another submission.'
        : 'No unresolved browser submission.',
    },
    {
      name: 'Plan validation',
      passed: input.planErrors !== undefined && input.planErrors.length === 0,
      detail:
        (input.planErrors?.length
          ? `${input.planErrors.length} plan issue${input.planErrors.length === 1 ? '' : 's'} to resolve. Review the highlighted plan fields below.`
          : '') || 'Complete the plan and obtain a fresh reviewed preview before signing.',
    },
  ];
}
