import { expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { pinnedSnapshot } from '../../packages/dreamdex-adapter/snapshot';
it('pins margin and every active position/mark to the same block even while head changes', async () => {
  const owner = '0x1111111111111111111111111111111111111111',
    bank = '0x2222222222222222222222222222222222222222',
    pool = '0x3333333333333333333333333333333333333333';
  const reads: { functionName: string; blockNumber: bigint }[] = [];
  const client = {
    getChainId: vi.fn().mockResolvedValue(50383),
    getBlockNumber: vi.fn().mockResolvedValueOnce(100n).mockResolvedValue(101n),
    readContract: vi.fn(async (p: { functionName: string; blockNumber: bigint }) => {
      reads.push(p);
      switch (p.functionName) {
        case 'getAccountState':
          return { unlockedCollateralBalance: 100n, lockedCollateral: 2n, activePerpPools: [pool] };
        case 'getAccountHealth':
          return [100n, 1n, 1n, 1n];
        case 'getWithdrawableCollateral':
          return 99n;
        case 'getMarginStatus':
          return 0;
        case 'getPosition':
          return {
            size: 1n,
            avgEntryPrice: 100n,
            entryFundingIndex: 0n,
            lastUpdatedTimestampNs: 0n,
          };
        case 'tryGetHealthSnapshot':
          return [
            true,
            {
              oneBase: 1n,
              markPrice: 100n,
              projectedCumulativeFunding: 0n,
              effectiveIMFBps: 100n,
              maintenanceMarginBps: 50n,
              closeOutMarginBps: 20n,
            },
          ];
        default:
          throw new Error('Unexpected read');
      }
    }),
  };
  const snapshot = await pinnedSnapshot(client as unknown as PublicClient, bank, owner);
  expect(snapshot.margin.asOfBlock).toBe(100n);
  expect(snapshot.analytics[0].asOfBlock).toBe(100n);
  expect(reads.every((r) => r.blockNumber === 100n)).toBe(true);
  expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
});
