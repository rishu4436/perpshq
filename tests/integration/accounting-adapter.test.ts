import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Address } from 'viem';
import { marginBankEventsAbi } from '@somnia-chain/markets-sdk';
const mocks = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
  getLogs: vi.fn(),
  readContract: vi.fn(),
  request: vi.fn(),
  getUserFillsPage: vi.fn(),
  getIndexerFreshness: vi.fn(),
}));
vi.mock('../../packages/dreamdex-adapter/index', () => ({
  rpc: mocks,
  sdk: { client: mocks },
  marketById: async () => ({
    marginBank: '0x2222222222222222222222222222222222222222',
    quoteDecimals: 0,
  }),
}));
import { accountPerformance } from '../../packages/dreamdex-adapter/accounting';
const owner = '0x1111111111111111111111111111111111111111' as Address;
const hash = '0x' + 'a'.repeat(64);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getChainId.mockResolvedValue(50383);
  mocks.request.mockImplementation(async ({ params }) =>
    (
      await mocks.getLogs({
        fromBlock: BigInt(params[0].fromBlock),
        toBlock: BigInt(params[0].toBlock),
      })
    ).map((log: { blockNumber: bigint; logIndex: number }) => ({
      ...log,
      blockNumber: '0x' + log.blockNumber.toString(16),
      logIndex: '0x' + log.logIndex.toString(16),
      transactionIndex: '0x0',
    })),
  );
  mocks.getBlockNumber.mockResolvedValue(110n);
  mocks.getBlock.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: blockNumber,
    hash: '0x' + blockNumber.toString(16).padStart(64, '0'),
  }));
  mocks.readContract.mockImplementation(
    async ({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) =>
      functionName === 'getAccountState'
        ? { lockedCollateral: 10n }
        : blockNumber === 100n
          ? 90n
          : 145n,
  );
  mocks.getLogs.mockResolvedValue([
    {
      topics: encodeEventTopics({
        abi: marginBankEventsAbi,
        eventName: 'Deposited',
        args: { account: owner },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [50n]),
      removed: false,
      transactionHash: hash,
      blockNumber: 105n,
      logIndex: 0,
    },
  ]);
  mocks.getUserFillsPage.mockResolvedValue({
    datasetGeneration: 'one',
    fills: [],
    nextCursor: null,
  });
  mocks.getIndexerFreshness.mockResolvedValue({ chainId: 50383, latestProcessedBlock: 110 });
});
describe('verified accounting adapter', () => {
  it('verifies bank-only P&L without claiming an indexed fill count', async () => {
    mocks.getUserFillsPage.mockRejectedValue(new Error('database query error'));
    mocks.getIndexerFreshness.mockRejectedValue(new Error('indexer unavailable'));
    const result = await accountPerformance(owner, owner, 99000, undefined, 'bank-only');
    expect(result.complete).toBe(true);
    expect(result.fillCount).toBeNull();
    expect(mocks.getUserFillsPage).not.toHaveBeenCalled();
    expect(mocks.getIndexerFreshness).not.toHaveBeenCalled();
  });
  it('extends only a verified bank history tail', async () => {
    mocks.getLogs.mockResolvedValue([]);
    await accountPerformance(owner, owner, 98000, undefined, 'bank-only');
    mocks.getLogs.mockClear();
    mocks.getBlockNumber.mockResolvedValue(120n);
    const result = await accountPerformance(owner, owner, 98000, undefined, 'bank-only');
    expect(result.complete).toBe(true);
    expect(mocks.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 111n, toBlock: 120n }),
    );
  });
  it('rescans the full interval when the cached closing block has reorganized', async () => {
    mocks.getLogs.mockResolvedValue([]);
    await accountPerformance(owner, owner, 97000, undefined, 'bank-only');
    mocks.getLogs.mockClear();
    mocks.getBlockNumber.mockResolvedValue(120n);
    mocks.getBlock.mockImplementation(async ({ blockNumber }) => ({
      number: blockNumber,
      timestamp: blockNumber,
      hash:
        '0x' + (blockNumber === 110n ? 'f'.repeat(64) : blockNumber.toString(16).padStart(64, '0')),
    }));
    const result = await accountPerformance(owner, owner, 97000, undefined, 'bank-only');
    expect(result.complete).toBe(true);
    expect(mocks.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 98n, toBlock: 120n }),
    );
  });
  it('withholds P&L when this owner funds a different child account', async () => {
    mocks.getLogs.mockResolvedValue([
      {
        topics: encodeEventTopics({
          abi: marginBankEventsAbi,
          eventName: 'MainFundedChild',
          args: {
            child: '0x3333333333333333333333333333333333333333',
            payer: owner,
          },
        }),
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [10n, 10n]),
        removed: false,
        transactionHash: hash,
        blockNumber: 105n,
        logIndex: 0,
      },
    ]);
    const result = await accountPerformance(owner, owner, 96000, undefined, 'bank-only');
    expect(result.complete).toBe(false);
    expect(result.netPnl).toBeNull();
    expect(result.reasons.join()).toContain('Cross-account capital movement');
  });
  it('scans inclusive log ranges within the live Hideki 1000-block limit without gaps', async () => {
    mocks.getBlockNumber.mockResolvedValue(2050n);
    mocks.getLogs.mockImplementation(
      async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 1000n) throw new Error('block range exceeds 1000');
        return [];
      },
    );
    mocks.getIndexerFreshness.mockResolvedValue({ chainId: 50383, latestProcessedBlock: 2050 });
    const result = await accountPerformance(owner, owner, 100000);
    expect(result.complete).toBe(true);
    expect(mocks.getLogs.mock.calls.map(([range]) => [range.fromBlock, range.toBlock])).toEqual([
      [101n, 1100n],
      [1101n, 2050n],
    ]);
  });
  it('uses exact block boundaries, includes locked collateral, and removes a bank deposit', async () => {
    const r = await accountPerformance(owner, owner, 100000);
    expect(r.complete).toBe(true);
    expect(r.from.block).toBe('100');
    expect(r.from.totalEquity).toBe('100');
    expect(r.to.totalEquity).toBe('155');
    expect(r.netFlows).toBe('50');
    expect(r.netPnl).toBe('5');
    expect(mocks.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 101n, toBlock: 110n }),
    );
  });
  it('drains fill pages and rejects dataset changes', async () => {
    mocks.getUserFillsPage
      .mockResolvedValueOnce({
        datasetGeneration: 'one',
        fills: [{ id: 'a', blockNumber: '105' }],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({ datasetGeneration: 'two', fills: [], nextCursor: null });
    const r = await accountPerformance(owner, owner, 100000);
    expect(r.complete).toBe(false);
    expect(r.netPnl).toBeNull();
    expect(r.reasons).toContain('Fill dataset changed during pagination');
  });
  it('withholds verification when the indexer has not processed the end block', async () => {
    mocks.getIndexerFreshness.mockResolvedValue({ chainId: 50383, latestProcessedBlock: 109 });
    const r = await accountPerformance(owner, owner, 100000);
    expect(r.complete).toBe(false);
    expect(r.reasons.join()).toContain('closing snapshot');
  });
  it('fails closed for unknown account events instead of inventing a cash-flow classification', async () => {
    mocks.getLogs.mockResolvedValue([
      {
        topics: ['0x' + 'f'.repeat(64), '0x' + owner.slice(2).padStart(64, '0')],
        data: '0x',
        removed: false,
        transactionHash: hash,
        blockNumber: 105n,
        logIndex: 0,
      },
    ]);
    const r = await accountPerformance(owner, owner, 100000);
    expect(r.netPnl).toBeNull();
    expect(r.reasons.join()).toContain('Unknown account bank event');
  });
  it('rejects the wrong network before reading account history', async () => {
    mocks.getChainId.mockResolvedValue(1);
    await expect(accountPerformance(owner, owner, 100000)).rejects.toThrow('50383');
    expect(mocks.getLogs).not.toHaveBeenCalled();
  });
  it('does not double count a repeated log', async () => {
    const logs = await mocks.getLogs();
    mocks.getLogs.mockResolvedValue([...logs, ...logs]);
    const r = await accountPerformance(owner, owner, 100000);
    expect(r.complete).toBe(false);
    expect(r.netFlows).toBe('50');
  });
});
