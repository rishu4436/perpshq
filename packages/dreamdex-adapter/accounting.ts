import { decodeEventLog, type Address } from 'viem';
import { marginBankEventsAbi } from '@somnia-chain/markets-sdk';
import { rpc, sdk, marketById } from './index';
import { fromRaw } from '../risk-engine';
import { reconcileAccounting, type AccountMovement, type EquityPoint } from '../accounting';
import { bankReadAbi } from './snapshot';

export async function accountPerformance(
  owner: Address,
  marketId: string,
  since: number,
  endBlock?: bigint,
) {
  if (!Number.isSafeInteger(since) || since < 0 || since > Date.now())
    throw new Error('Invalid accounting start time');
  if ((await rpc.getChainId()) !== 50383) throw new Error('Accounting requires Hideki chain 50383');
  const m = await marketById(marketId),
    bank = m.marginBank;
  const end = await rpc.getBlock({
    blockNumber: endBlock ?? (await rpc.getBlockNumber({ cacheTime: 0 })),
  });
  let lo = 0n,
    hi = end.number;
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
  const movements: AccountMovement[] = [],
    reasons: string[] = [];
  const topicOwner = owner.toLowerCase().slice(2).padStart(64, '0');
  let ranges = 0;
  for (let from = start.number + 1n; from <= end.number; from += 2000n) {
    if (++ranges > 500) {
      reasons.push('Accounting range exceeds 1,000,000 blocks; choose a shorter interval');
      break;
    }
    const to = from + 1999n < end.number ? from + 1999n : end.number;
    const logs = await rpc.getLogs({ address: bank, fromBlock: from, toBlock: to });
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
  for (let page = 0; page < 200; page++) {
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
  if (!drained) reasons.push('Fill history pagination incomplete');
  const freshness = await sdk.client.getIndexerFreshness(50383);
  if (
    !freshness ||
    freshness.chainId !== 50383 ||
    freshness.latestProcessedBlock === null ||
    BigInt(freshness.latestProcessedBlock) < end.number
  )
    reasons.push('Fill indexer has not processed the closing snapshot block');
  const verify = await rpc.getBlock({ blockNumber: end.number });
  const verifyStart = await rpc.getBlock({ blockNumber: start.number });
  if (verify.hash !== end.hash || verifyStart.hash !== start.hash)
    reasons.push('Chain reorganized during reconciliation');
  return reconcileAccounting({
    account: owner,
    bank,
    chainId: 50383,
    from: point(start, a),
    to: point(end, b),
    movements,
    reasons,
    fillCount,
    generatedAt: Date.now(),
  });
}
