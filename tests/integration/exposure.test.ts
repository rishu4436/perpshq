import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import type {
  MarginAccount,
  PerpPositionAnalytics,
  OpenOrdersOnchain,
  PerpMarket,
} from '@somnia-chain/markets-sdk';
import { agentFixture, agentNow } from '../agent-fixtures';
import { verifyExposure } from '../../packages/dreamdex-adapter/exposure';
import { account, sdk, rpc } from '../../packages/dreamdex-adapter';
import { assessRisk, sizeProposal } from '../../packages/agent-risk';
import probe from '../../docs/probe-results.json';
import * as snapshots from '../../packages/dreamdex-adapter/snapshot';
const owner = ('0x' + '1'.repeat(40)) as Address;
const market = agentFixture().detail.market;
function fixture() {
  const margin: MarginAccount = {
    asOfBlock: 100n,
    activePerpPools: [],
    equity: 0n,
    unlockedCollateralBalance: 0n,
    lockedCollateral: 0n,
    imReq: 0n,
    mmReq: 0n,
    cmReq: 0n,
    withdrawable: 0n,
    marginStatus: 'Healthy',
  };
  const positions: PerpPositionAnalytics[] = [];
  const open: OpenOrdersOnchain = { blockNumber: 100n, orders: [] };
  return { margin, positions, open, markets: [market] };
}
function order(id = 1n, pool = market.poolAddress) {
  return {
    pool,
    orderId: id,
    owner,
    isBid: true,
    userData: 0n,
    price: 100n * 10n ** 18n,
    fullQuantity: 10000n,
    quantityRemaining: 5000n,
    expireTimestampNs: 0n,
  };
}
function position(pool = market.poolAddress) {
  return { pool, asOfBlock: 100n, size: 10000n, priceable: true } as PerpPositionAnalytics;
}
describe('authoritative current exposure completeness', () => {
  it('accepts an actually empty bank and full empty order read', () => {
    const f = fixture();
    expect(verifyExposure(owner, f.markets, f.margin, f.positions, f.open).complete).toBe(true);
  });
  it('accepts a complete active position and partially filled resting order', () => {
    const f = fixture();
    f.margin.activePerpPools = [market.poolAddress];
    f.positions.push(position());
    f.open.orders.push(order());
    expect(verifyExposure(owner, f.markets, f.margin, f.positions, f.open).complete).toBe(true);
  });
  it('covers more than one historical page and several markets without truncation', () => {
    const f = fixture(),
      other = {
        ...market,
        id: ('0x' + '3'.repeat(40)) as Address,
        poolAddress: ('0x' + '3'.repeat(40)) as Address,
      };
    f.markets.push(other);
    f.margin.activePerpPools = [market.poolAddress, other.poolAddress];
    f.positions.push(position(), position(other.poolAddress));
    f.open.orders = Array.from({ length: 125 }, (_, i) =>
      order(BigInt(i + 1), i % 2 ? other.poolAddress : market.poolAddress),
    );
    expect(verifyExposure(owner, f.markets, f.margin, f.positions, f.open).complete).toBe(true);
  });
  it.each([
    'margin',
    'positions',
    'orders',
    'lag',
    'missing-pool',
    'unknown-pool',
    'unpriceable',
    'wrong-owner',
    'duplicate',
    'collateral',
    'incomplete-margin',
  ] as const)('fails closed for %s', (kind) => {
    const f = fixture();
    f.open.orders.push(order());
    if (kind === 'lag') f.open.blockNumber = 99n;
    if (kind === 'incomplete-margin') f.margin.equity = undefined as unknown as bigint;
    if (kind === 'missing-pool') f.margin.activePerpPools = [market.poolAddress];
    if (kind === 'unknown-pool') f.open.orders[0].pool = ('0x' + '4'.repeat(40)) as Address;
    if (kind === 'unpriceable') {
      f.positions.push({ ...position(), priceable: false });
      f.margin.activePerpPools = [market.poolAddress];
    }
    if (kind === 'wrong-owner') f.open.orders[0].owner = ('0x' + '5'.repeat(40)) as Address;
    if (kind === 'duplicate') f.open.orders.push(order());
    if (kind === 'collateral')
      f.markets.push({ ...market, quoteToken: ('0x' + '5'.repeat(40)) as Address });
    const result = verifyExposure(
      owner,
      f.markets,
      kind === 'margin' ? null : f.margin,
      kind === 'positions' ? null : f.positions,
      kind === 'orders' ? null : f.open,
    );
    expect(result.complete).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
  it('cannot authorize an increase even if other loss/permission fields claim completeness', () => {
    const f = agentFixture();
    Object.assign(f.account, {
      source: 'chain',
      exposureComplete: false,
      historyComplete: true,
      sessionPnl: '0',
      dailyPnl: '0',
      gasSTT: '1',
      verifiedLeverage: 5,
      permissions: { place: true, cancel: true, reduce: true, checkedAt: agentNow },
    });
    const risk = assessRisk(
      f.config,
      f.observation,
      f.runtime,
      sizeProposal(f.config, f.detail.market, 'long'),
      agentNow,
    );
    expect(risk.allowed).toBe(false);
    expect(risk.pause).toBe(true);
    expect(risk.checks.find((c) => c.name === 'Exposure complete')?.passed).toBe(false);
  });
});
describe('account adapter does not substitute bounded indexed history', () => {
  beforeEach(() => {
    vi.spyOn(snapshots, 'pinnedSnapshot').mockResolvedValue({
      margin: fixture().margin,
      analytics: [],
    });
    vi.spyOn(sdk.client, 'listPerpMarkets').mockResolvedValue(
      probe.markets.data as unknown as PerpMarket[],
    );
    vi.spyOn(sdk.client, 'getMarginAccount').mockResolvedValue(fixture().margin);
    vi.spyOn(sdk.client, 'listPerpPositions').mockResolvedValue([]);
    vi.spyOn(sdk.client, 'getOrders').mockResolvedValue(
      Array.from({ length: 100 }, () => ({ status: 'Filled' })) as never,
    );
    vi.spyOn(sdk.client, 'getUserFills').mockResolvedValue([]);
    vi.spyOn(sdk.client, 'listPerpPositionChanges').mockResolvedValue([]);
    vi.spyOn(sdk.client, 'getPerpVoucher').mockResolvedValue(null as never);
    vi.spyOn(sdk.client, 'getFundingPayments').mockResolvedValue([]);
    vi.spyOn(sdk.client, 'listPerpPositionAnalytics').mockResolvedValue([]);
    vi.spyOn(rpc, 'getBalance').mockResolvedValue(0n);
  });
  afterEach(() => vi.restoreAllMocks());
  it('returns all 125 chain orders at the margin block, independently of 100 history rows', async () => {
    vi.spyOn(sdk.client, 'getOpenOrdersOnchain').mockResolvedValue({
      blockNumber: 100n,
      orders: Array.from({ length: 125 }, (_, i) => order(BigInt(i + 1))),
    });
    const result = await account(owner);
    expect(result.orders).toHaveLength(100);
    expect(result.openOrders).toHaveLength(125);
    expect(result.exposure.complete).toBe(true);
    expect(sdk.client.getOpenOrdersOnchain).toHaveBeenCalledWith(expect.any(Array), owner, {
      blockNumber: 100n,
    });
  });
  it('an RPC/pagination-detail failure cannot degrade to a complete empty list', async () => {
    vi.spyOn(sdk.client, 'getOpenOrdersOnchain').mockRejectedValue(new Error('Detail read failed'));
    const result = await account(owner);
    expect(result.openOrders).toBeNull();
    expect(result.exposure.complete).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
afterAll(() => sdk.close());
