import { afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionData } from 'viem';
import { perpPoolWriteAbi, type PerpMarket } from '@somnia-chain/markets-sdk';
import { sdk, rpc, prepare, prepareCancel, normalizeMarket } from '../../packages/dreamdex-adapter';
import { planTrade } from '../../packages/risk-engine';
import type { PlanInput } from '../../packages/shared-types';
import probe from '../../docs/probe-results.json';
const source = probe.markets.data.find((m) => m.baseSymbol === 'BTC')!;
const m = normalizeMarket(source as PerpMarket);
const account = '0x1111111111111111111111111111111111111111';
const input: PlanInput = {
  marketId: m.id,
  side: 'long',
  type: 'limit',
  entry: '100000',
  stop: '99000',
  target: '102000',
  riskBudget: '10',
  collateral: '1000',
  leverage: '5',
  slippageBps: '10',
};
const plan = () => planTrade(input, m);
beforeEach(() => {
  vi.spyOn(sdk.client, 'listPerpMarkets').mockResolvedValue([source] as never);
  vi.spyOn(sdk.client, 'getPerpSystemConfig').mockResolvedValue({
    collateralToken: m.quoteToken,
    fullyWired: true,
  } as never);
  vi.spyOn(sdk.client, 'getMaxPerpOrderSize').mockResolvedValue({
    priceable: true,
    placeable: true,
    maxQuantity: 10n ** 30n,
    limitedBy: 'none',
  } as never);
  vi.spyOn(rpc, 'getChainId').mockResolvedValue(50383);
  vi.spyOn(rpc, 'call').mockResolvedValue({ data: '0x' } as never);
  vi.spyOn(rpc, 'estimateGas').mockResolvedValue(1000000n);
  vi.spyOn(rpc, 'getGasPrice').mockResolvedValue(1000n);
  vi.spyOn(rpc, 'getBalance').mockResolvedValue(10n ** 18n);
  vi.spyOn(sdk.client, 'getOrder').mockResolvedValue({
    owner: account,
    status: 'Open',
    quantityRemaining: '100',
    fullQuantity: '100',
  } as never);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => sdk.close());
describe('unsigned official-SDK preparation with mocked chain reads; never broadcasts', () => {
  it('prepares exact official ABI and preserves the reviewed order expiry on refresh', async () => {
    const p = await prepare(plan(), account);
    const decoded = decodeFunctionData({ abi: perpPoolWriteAbi, data: p.data });
    expect(decoded.functionName).toBe('placeOrder');
    expect(decoded.args[2]).toBe(BigInt(plan().rawPrice));
    expect(decoded.args[3]).toBe(BigInt(plan().rawQuantity));
    const fresh = await prepare(plan(), account, p.data);
    expect(fresh.data).toBe(p.data);
    expect(fresh.gas).toBe('1250000');
    expect(fresh.value).toBe('0');
    expect(rpc.call).toHaveBeenCalledTimes(2);
  });
  it.each(['rawPrice', 'rawQuantity'] as const)(
    'blocks invalid %s increments before simulation',
    async (key) => {
      const p = plan();
      p[key] = '1';
      await expect(prepare(p, account)).rejects.toThrow(/increments/);
      expect(rpc.call).not.toHaveBeenCalled();
    },
  );
  it('blocks insufficient declared collateral', async () => {
    await expect(prepare(planTrade({ ...input, collateral: '0.01' }, m), account)).rejects.toThrow(
      /margin/,
    );
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it('blocks official collateral/voucher/position-size restrictions', async () => {
    vi.mocked(sdk.client.getMaxPerpOrderSize).mockResolvedValue({
      priceable: true,
      placeable: false,
      maxQuantity: 0n,
      limitedBy: 'voucherBlocked',
    } as never);
    await expect(prepare(plan(), account)).rejects.toThrow(/voucherBlocked/);
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it('blocks insufficient network gas', async () => {
    vi.mocked(rpc.getBalance).mockResolvedValue(0n);
    await expect(prepare(plan(), account)).rejects.toThrow(/Insufficient STT/);
  });
  it('blocks wrong-chain and stale-mark preparation', async () => {
    vi.mocked(rpc.getChainId).mockResolvedValue(1);
    await expect(prepare(plan(), account)).rejects.toThrow(/chain mismatch/);
    vi.mocked(rpc.getChainId).mockResolvedValue(50383);
    vi.mocked(sdk.client.getMaxPerpOrderSize).mockResolvedValue({ priceable: false } as never);
    await expect(prepare(plan(), account)).rejects.toThrow(/stale/);
  });
  it('never bypasses a failed contract simulation', async () => {
    vi.mocked(rpc.call).mockRejectedValue(new Error('Simulation revert'));
    await expect(prepare(plan(), account)).rejects.toThrow(/Simulation revert/);
    expect(rpc.estimateGas).not.toHaveBeenCalled();
  });
  it('rejects different approved calldata before simulation', async () => {
    const p = await prepare(plan(), account);
    await expect(
      prepare(
        { ...plan(), rawQuantity: (BigInt(plan().rawQuantity) + BigInt(m.lotSize)).toString() },
        account,
        p.data,
      ),
    ).rejects.toThrow(/parameters changed/);
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });
  it('rejects expired approved order data', async () => {
    const p = await prepare(plan(), account),
      decoded = decodeFunctionData({ abi: perpPoolWriteAbi, data: p.data });
    if (decoded.functionName !== 'placeOrder') throw Error('wrong ABI');
    const data = encodeFunctionData({
      abi: perpPoolWriteAbi,
      functionName: 'placeOrder',
      args: [decoded.args[0], 0n, decoded.args[2], decoded.args[3], 1n, 0, 0, decoded.args[7], 0n],
    });
    await expect(prepare(plan(), account, data)).rejects.toThrow(/expiry/);
  });
  it('prepares only an owned, open cancellation with enough gas on Hideki', async () => {
    const p = await prepareCancel(m.id, '1', account);
    expect(decodeFunctionData({ abi: perpPoolWriteAbi, data: p.data })).toMatchObject({
      functionName: 'cancelOrder',
      args: [1n],
    });
    vi.mocked(sdk.client.getOrder).mockResolvedValue({
      owner: '0x' + '2'.repeat(40),
      status: 'Open',
      quantityRemaining: '1',
    } as never);
    await expect(prepareCancel(m.id, '1', account)).rejects.toThrow(
      /unavailable|different account/,
    );
    vi.mocked(sdk.client.getOrder).mockResolvedValue({
      owner: account,
      status: 'Open',
      quantityRemaining: '1',
    } as never);
    vi.mocked(rpc.getBalance).mockResolvedValue(0n);
    await expect(prepareCancel(m.id, '1', account)).rejects.toThrow(/Insufficient STT/);
  });
});
