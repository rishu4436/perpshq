import { decodeEventLog, formatLog, toHex, type Address, type Hex } from 'viem';
import { marginBankEventsAbi } from '@somnia-chain/markets-sdk';
import { rpc, sdk, marketById } from './index';
import { fromRaw } from '../risk-engine';
import {
  reconcileAccounting,
  type AccountMovement,
  type EquityPoint,
  type AccountingReport,
} from '../accounting';
import { bankReadAbi } from './snapshot';
const verifiedBankHistory = new Map<string, AccountingReport>();
async function ownerLogs(bank: Address, owner: Address, from: bigint, to: bigint) {
  const topic = ('0x' + owner.slice(2).toLowerCase().padStart(64, '0')) as Hex;
  const groups = await Promise.all(
    [1, 2, 3].map(async (position) => {
      const topics: Array<Hex | null> = Array(position).fill(null);
      topics.push(topic);
      const raw = await rpc.request({
        method: 'eth_getLogs',
        params: [{ address: bank, fromBlock: toHex(from), toBlock: toHex(to), topics }],
      });
      if (raw.length >= 10000) throw new Error('Owner log range may be truncated');
      return raw.map((log) => formatLog(log));
    }),
  );
  const seen = new Set<string>();
  const result = [];
  for (const group of groups) {
    const previous = new Set(seen);
    const key = (l: (typeof group)[number]) => `${l.blockHash}:${l.transactionHash}:${l.logIndex}`;
    result.push(...group.filter((l) => !previous.has(key(l))));
    group.forEach((l) => seen.add(key(l)));
  }
  return result;
}
async function* bankLogs(bank: Address, first: bigint, last: bigint, owner?: Address) {
  for (let batch = first; batch <= last; batch += 8000n) {
    const requests = [];
    for (let from = batch; from < batch + 8000n && from <= last; from += 1000n) {
      const to = from + 999n < last ? from + 999n : last;
      requests.push(
        owner
          ? ownerLogs(bank, owner, from, to)
          : rpc.getLogs({ address: bank, fromBlock: from, toBlock: to }),
      );
    }
    for (const logs of await Promise.all(requests)) yield logs;
  }
}

export async function accountPerformance(
  owner: Address,
  marketId: string,
  since: number,
  endBlock?: bigint,
  evidence: 'indexed' | 'bank-only' = 'indexed',
) {
  if (!Number.isSafeInteger(since) || since < 0 || since > Date.now())
    throw new Error('Invalid accounting start time');
  if ((await rpc.getChainId()) !== 50383) throw new Error('Accounting requires Hideki chain 50383');
  const m = await marketById(marketId),
    bank = m.marginBank;
  const end = await rpc.getBlock({
    blockNumber: endBlock ?? (await rpc.getBlockNumber({ cacheTime: 0 })),
  });
  const cacheKey = `${bank.toLowerCase()}:${owner.toLowerCase()}:${since}`;
  let prior = evidence === 'bank-only' ? verifiedBankHistory.get(cacheKey) : undefined;
  if (
    prior &&
    (BigInt(prior.to.block) > end.number ||
      (await rpc.getBlock({ blockNumber: BigInt(prior.to.block) })).hash !== prior.to.blockHash)
  )
    prior = undefined;
  let lo = 0n,
    hi = end.number;
  if (prior) lo = hi = BigInt(prior.from.block);
  // Last block at or before the requested boundary, never a future opening state.
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n,
      b = await rpc.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) * 1000 <= since) lo = mid;
    else hi = mid - 1n;
  }
  const start = await rpc.getBlock({ blockNumber: lo });
  async function equityAt(blockNumber: bigint) {
    const [state, equity] = await Promise.all([
      rpc.readContract({
        address: bank,
        abi: bankReadAbi,
        functionName: 'getAccountState',
        args: [owner],
        blockNumber,
      }),
      rpc.readContract({
        address: bank,
        abi: bankReadAbi,
        functionName: 'getAccountEquity',
        args: [owner],
        blockNumber,
      }),
    ]);
    return equity + state.lockedCollateral;
  }
  const [a, b] = await Promise.all([equityAt(start.number), equityAt(end.number)]);
  const point = (block: typeof start, equity: bigint): EquityPoint => ({
    block: block.number.toString(),
    blockHash: block.hash,
    at: Number(block.timestamp) * 1000,
    totalEquity: fromRaw(equity, m.quoteDecimals),
  });
  const movements: AccountMovement[] = prior ? [...prior.movements] : [],
    reasons: string[] = [];
  const topicOwner = owner.toLowerCase().slice(2).padStart(64, '0');
  // Hideki rejects eth_getLogs intervals containing more than 1000 blocks.
  const first = (prior ? BigInt(prior.to.block) : start.number) + 1n;
  const last = first + 999999n < end.number ? first + 999999n : end.number;
  if (last < end.number)
    reasons.push('Accounting range exceeds 1,000,000 blocks; choose a shorter interval');
  for await (const logs of bankLogs(
    bank,
    first,
    last,
    evidence === 'bank-only' ? owner : undefined,
  )) {
    if (logs.length >= 10000) {
      reasons.push('Log range may be truncated');
      break;
    }
    for (const log of logs) {
      if (!log.topics.some((t) => t?.slice(2).toLowerCase() === topicOwner)) continue;
      if (
        log.removed ||
        !log.transactionHash ||
        log.blockNumber === null ||
        log.logIndex === null
      ) {
        reasons.push('Unfinalized or incomplete bank event');
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: marginBankEventsAbi,
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args as Record<string, unknown>,
          name = decoded.eventName;
        const subject = String(args.account ?? args.child ?? args.payer ?? '').toLowerCase();
        if (subject !== owner.toLowerCase()) {
          if (
            (name === 'MainFundedChild' &&
              String(args.payer).toLowerCase() === owner.toLowerCase()) ||
            (name === 'BadDebtAbsorbed' &&
              String(args.absorbedBy).toLowerCase() === owner.toLowerCase())
          )
            reasons.push('Cross-account capital movement requires dedicated reconciliation');
          if (['CloseOutMarginSettled', 'PositionTransferred', 'AutoDeleveraged'].includes(name))
            reasons.push('Transferred or liquidation position requires dedicated reconciliation');
          continue;
        }
        const kinds: Record<string, string> = {
          Deposited: 'deposit',
          DepositedFor: 'deposit',
          Withdrawn: 'withdrawal',
          MainFundedChild: 'main-funding',
          FundingSettled: 'funding',
          FeeCharged: 'fee',
          BuilderFeeCharged: 'fee',
          RebatePaid: 'rebate',
          PositionUpdated: 'realized',
          BadDebtAbsorbed: 'debt-coverage',
        };
        const kind = kinds[name];
        if (!kind) {
          if (
            ![
              'CollateralLocked',
              'CollateralUnlocked',
              'IsolatedModeSet',
              'MaxLeverageSet',
              'LiquidationOrderPanicked',
            ].includes(name)
          )
            reasons.push('Unsupported bank event ' + name);
          continue;
        }
        const amount = args.payment ?? args.realizedPnl ?? args.covered ?? args.amount;
        if (typeof amount !== 'bigint') {
          reasons.push('Missing amount on ' + name);
          continue;
        }
        movements.push({
          id: log.transactionHash + ':' + log.logIndex,
          block: log.blockNumber.toString(),
          kind,
          amount: fromRaw(amount, m.quoteDecimals),
          account: owner,
          txHash: log.transactionHash,
        });
      } catch {
        reasons.push(
          'Unknown account bank event; credit or principal movements need a supported decoder',
        );
      }
    }
  }
  // Drain the stable fill cursor with a hard budget; detect generation changes and missing positions.
  let cursor: string | undefined,
    generation: string | undefined,
    fillCount = 0,
    drained = false;
  const seen = new Set<string>();
  for (let page = 0; evidence === 'indexed' && page < 200; page++) {
    const data = await sdk.client.getUserFillsPage(owner, {
      marketType: 'PERP',
      limit: 100,
      cursor,
    });
    if (generation && generation !== data.datasetGeneration) {
      reasons.push('Fill dataset changed during pagination');
      break;
    }
    generation = data.datasetGeneration;
    for (const f of data.fills) {
      if (!f.blockNumber) {
        reasons.push('Fill has no authoritative block');
        continue;
      }
      if (BigInt(f.blockNumber) > start.number && BigInt(f.blockNumber) <= end.number) {
        if (seen.has(f.id)) reasons.push('Duplicate fill in pagination');
        seen.add(f.id);
        fillCount++;
      }
    }
    if (!data.nextCursor) {
      drained = true;
      break;
    }
    if (data.nextCursor === cursor) {
      reasons.push('Fill cursor did not advance');
      break;
    }
    cursor = data.nextCursor;
  }
  if (evidence === 'indexed' && !drained) reasons.push('Fill history pagination incomplete');
  const freshness = evidence === 'indexed' ? await sdk.client.getIndexerFreshness(50383) : null;
  if (
    evidence === 'indexed' &&
    (!freshness ||
      freshness.chainId !== 50383 ||
      freshness.latestProcessedBlock === null ||
      BigInt(freshness.latestProcessedBlock) < end.number)
  )
    reasons.push('Fill indexer has not processed the closing snapshot block');
  const verify = await rpc.getBlock({ blockNumber: end.number });
  const verifyStart = await rpc.getBlock({ blockNumber: start.number });
  if (verify.hash !== end.hash || verifyStart.hash !== start.hash)
    reasons.push('Chain reorganized during reconciliation');
  const report = reconcileAccounting({
    account: owner,
    bank,
    chainId: 50383,
    from: point(start, a),
    to: point(end, b),
    movements,
    reasons,
    fillCount: evidence === 'indexed' ? fillCount : null,
    generatedAt: Date.now(),
  });
  if (evidence === 'bank-only' && report.complete) {
    if (verifiedBankHistory.size >= 100) verifiedBankHistory.clear();
    verifiedBankHistory.set(cacheKey, report);
  }
  return report;
}
