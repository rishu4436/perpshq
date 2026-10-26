import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Address } from 'viem';
import { marginBankEventsAbi } from '@somnia-chain/markets-sdk';
const mocks = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
  getLogs: vi.fn(),
  readContract: vi.fn(),
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
