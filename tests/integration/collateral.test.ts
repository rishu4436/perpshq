import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getPerpVoucherEligibility: vi.fn(),
  readContract: vi.fn(),
  call: vi.fn(),
  estimateGas: vi.fn(),
  getGasPrice: vi.fn(),
  getBalance: vi.fn(),
}));
vi.mock('../../packages/dreamdex-adapter', () => ({
  rpc: m,
  sdk: { client: m, trader: m },
  marketById: async () => ({
    marginBank: '0x' + '2'.repeat(40),
    quoteToken: '0x' + '4'.repeat(40),
    quoteDecimals: 18,
  }),
}));
import { prepareCollateralClaim, prepareMarginDeposit } from '../../apps/api/src/collateral';
const owner = ('0x' + '1'.repeat(40)) as `0x${string}`;
beforeEach(() => {
  vi.resetAllMocks();
  m.getChainId.mockResolvedValue(50383);
  m.getPerpVoucherEligibility.mockResolvedValue({
    eligible: true,
    grantAmount: 1000n * 10n ** 18n,
  });
  m.readContract.mockResolvedValue('0x' + '3'.repeat(40));
  m.call.mockResolvedValue({});
  m.estimateGas.mockResolvedValue(100000n);
  m.getGasPrice.mockResolvedValue(1n);
  m.getBalance.mockResolvedValue(10n ** 18n);
});
it('simulates an unsigned zero-value claim and adds gas headroom', async () => {
  const p = await prepareCollateralClaim(owner, owner);
  expect(p.grant).toBe('1000');
  expect(p.value).toBe('0x0');
  expect(p.gas).toBe('0x1e848');
  expect(m.call).toHaveBeenCalledWith(expect.objectContaining({ account: owner, value: 0n }));
});
it('blocks wrong chain before resolving a claim', async () => {
  m.getChainId.mockResolvedValue(1);
  await expect(prepareCollateralClaim(owner, owner)).rejects.toThrow('50383');
  expect(m.readContract).not.toHaveBeenCalled();
});
it('blocks duplicate/ineligible claims', async () => {
  m.getPerpVoucherEligibility.mockResolvedValue({ eligible: false, reason: 'alreadyClaimed' });
  await expect(prepareCollateralClaim(owner, owner)).rejects.toThrow('alreadyClaimed');
  expect(m.call).not.toHaveBeenCalled();
});
it('rejects a dormant distributor', async () => {
  m.readContract.mockResolvedValue('0x' + '0'.repeat(40));
  await expect(prepareCollateralClaim(owner, owner)).rejects.toThrow('unavailable');
});
it('blocks failed simulation and insufficient gas', async () => {
  m.call.mockRejectedValueOnce(new Error('simulation reverted'));
  await expect(prepareCollateralClaim(owner, owner)).rejects.toThrow('No transaction was sent');
  m.call.mockResolvedValue({});
  m.getBalance.mockResolvedValue(0n);
  await expect(prepareCollateralClaim(owner, owner)).rejects.toThrow('STT');
});
it('approves exactly 15 USDso before a deposit without granting unlimited access', async () => {
  m.readContract.mockImplementation(async ({ functionName }) =>
    functionName === 'balanceOf' ? 100n * 10n ** 18n : 0n,
  );
  const p = await prepareMarginDeposit(owner, owner);
  expect(p.stage).toBe('approval');
  expect(p.to).toBe('0x' + '4'.repeat(40));
  expect(p.amount).toBe('15');
  expect(p.value).toBe('0x0');
});
it('prepares a bank deposit only after sufficient token allowance', async () => {
  m.readContract.mockResolvedValue(100n * 10n ** 18n);
  const p = await prepareMarginDeposit(owner, owner);
  expect(p.stage).toBe('deposit');
  expect(p.to).toBe('0x' + '2'.repeat(40));
});
it('blocks a deposit with insufficient token balance', async () => {
  m.readContract.mockResolvedValue(0n);
  await expect(prepareMarginDeposit(owner, owner)).rejects.toThrow('15 eligible');
  expect(m.call).not.toHaveBeenCalled();
});
it('bounds this test flow to the reviewed deposit amount', async () => {
  await expect(prepareMarginDeposit(owner, owner, '100')).rejects.toThrow();
  expect(m.call).not.toHaveBeenCalled();
});
