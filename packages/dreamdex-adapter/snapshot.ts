import { parseAbi, type Address, type PublicClient } from 'viem';
import {
  MARGIN_STATUS,
  perpPositionAnalytics,
  type MarginAccount,
} from '@somnia-chain/markets-sdk';
// Read signatures verified against the installed SDK 0.32.1 src/readsAbi.ts.
export const bankReadAbi = parseAbi([
  'function getAccountEquity(address account) view returns (int256)',
  'function getAccountState(address account) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))',
  'function getAccountHealth(address account) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)',
  'function getWithdrawableCollateral(address account) view returns (uint256)',
  'function getMarginStatus(address account) view returns (uint8)',
  'function getPosition(address account, address perpPool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))',
]);
const poolReadAbi = parseAbi([
  'function tryGetHealthSnapshot() view returns (bool ok, (uint256 oneBase, uint256 markPrice, int256 projectedCumulativeFunding, uint256 effectiveIMFBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps) snapshot)',
]);
export async function pinnedSnapshot(
  client: PublicClient,
  bank: Address,
  owner: Address,
  blockNumber?: bigint,
) {
  if ((await client.getChainId()) !== 50383)
    throw new Error('Account snapshot requires Hideki chain 50383');
  const at = blockNumber ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const base = { address: bank, abi: bankReadAbi, blockNumber: at } as const;
  const [state, health, withdrawable, status] = await Promise.all([
    client.readContract({ ...base, functionName: 'getAccountState', args: [owner] }),
    client.readContract({ ...base, functionName: 'getAccountHealth', args: [owner] }),
    client.readContract({ ...base, functionName: 'getWithdrawableCollateral', args: [owner] }),
    client.readContract({ ...base, functionName: 'getMarginStatus', args: [owner] }),
  ]);
  if (!MARGIN_STATUS[status]) throw new Error('Unknown margin status');
  const margin: MarginAccount = {
    ...state,
    activePerpPools: [...state.activePerpPools],
    equity: health[0],
    imReq: health[1],
    mmReq: health[2],
    cmReq: health[3],
    withdrawable,
    marginStatus: MARGIN_STATUS[status],
    asOfBlock: at,
  };
  const analytics = await Promise.all(
    state.activePerpPools.map(async (pool) => {
      const [position, [ok, snap]] = await Promise.all([
        client.readContract({ ...base, functionName: 'getPosition', args: [owner, pool] }),
        client.readContract({
          address: pool,
          abi: poolReadAbi,
          blockNumber: at,
          functionName: 'tryGetHealthSnapshot',
        }),
      ]);
      if (!ok) return { priceable: false as const, asOfBlock: at, pool, size: position.size };
      return {
        priceable: true as const,
        asOfBlock: at,
        pool,
        avgEntryPrice: position.avgEntryPrice,
        markPrice: snap.markPrice,
        ...perpPositionAnalytics({
          size: position.size,
          avgEntryPrice: position.avgEntryPrice,
          entryFundingIndex: position.entryFundingIndex,
          markPrice: snap.markPrice,
          projectedCumulativeFunding: snap.projectedCumulativeFunding,
          oneBase: snap.oneBase,
          effectiveImfBps: snap.effectiveIMFBps,
          maintenanceMarginBps: snap.maintenanceMarginBps,
          closeOutMarginBps: snap.closeOutMarginBps,
        }),
      };
    }),
  );
  return { margin, analytics };
}
