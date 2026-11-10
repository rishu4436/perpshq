import { Router } from 'express';
import { z } from 'zod';
import {
  formatEther,
  parseAbi,
  encodeFunctionData,
  zeroAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { sdk, rpc, marketById } from '../../../packages/dreamdex-adapter';
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const fundingInput = z
  .object({ account: address, marketId: address, amount: z.literal('15') })
  .strict();
const tokenAbi = parseAbi([
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
]);
const depositAbi = parseAbi(['function deposit(uint256 amount)']);
export async function prepareMarginDeposit(owner: Address, marketId: string, amount = '15') {
  fundingInput.parse({ account: owner, marketId, amount });
  if ((await rpc.getChainId()) !== 50383) throw new Error('Hideki chain 50383 required');
  const m = await marketById(marketId),
    quantity = parseUnits(amount, m.quoteDecimals);
  const [balance, allowance] = await Promise.all([
    rpc.readContract({
      address: m.quoteToken,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [owner],
    }),
    rpc.readContract({
      address: m.quoteToken,
      abi: tokenAbi,
      functionName: 'allowance',
      args: [owner, m.marginBank],
    }),
  ]);
  if (balance < quantity) throw new Error('Wallet needs 15 eligible USDso for this test deposit');
  const stage = allowance < quantity ? 'approval' : 'deposit';
  const to = stage === 'approval' ? m.quoteToken : m.marginBank;
  const data =
    stage === 'approval'
      ? encodeFunctionData({
          abi: tokenAbi,
          functionName: 'approve',
          args: [m.marginBank, quantity],
        })
      : encodeFunctionData({ abi: depositAbi, functionName: 'deposit', args: [quantity] });
  await rpc.call({ account: owner, to, data, value: 0n });
  const [estimate, gasPrice, gasBalance] = await Promise.all([
    rpc.estimateGas({ account: owner, to, data, value: 0n }),
    rpc.getGasPrice(),
    rpc.getBalance({ address: owner }),
  ]);
  const gas = (estimate * 125n) / 100n;
  if (gasBalance < gas * gasPrice) throw new Error('Insufficient STT for gas');
  return {
    account: owner,
    marketId,
    chainId: 50383,
    stage,
    amount,
    token: m.quoteToken,
    bank: m.marginBank,
    to,
    data,
    value: '0x0',
    gas: '0x' + gas.toString(16),
    gasPrice: '0x' + gasPrice.toString(16),
    estimatedGasSTT: formatEther(gas * gasPrice),
    expiresAt: Date.now() + 120000,
  };
}
// Same verified signatures as SDK 0.32.1 readsAbi/tradeAbi; no server signer.
async function claimCall(bank: Address) {
  const to = await rpc.readContract({
    address: bank,
    abi: parseAbi(['function getCreditGranter() view returns (address)']),
    functionName: 'getCreditGranter',
  });
  if (to === zeroAddress) throw new Error('Collateral distributor is unavailable');
  return {
    to,
    data: encodeFunctionData({ abi: parseAbi(['function claim()']), functionName: 'claim' }),
  };
}
export async function prepareCollateralClaim(owner: Address, marketId: string) {
  if ((await rpc.getChainId()) !== 50383) throw new Error('Hideki chain 50383 required');
  const market = await marketById(marketId);
  const eligibility = await sdk.client.getPerpVoucherEligibility(market.marginBank, owner);
  if (!eligibility.eligible) throw new Error('Collateral claim unavailable: ' + eligibility.reason);
  const call = await claimCall(market.marginBank);
  try {
    await rpc.call({ account: owner, to: call.to, data: call.data, value: 0n });
  } catch (e) {
    let cause: unknown = e;
    let data: string | undefined;
    for (let i = 0; i < 10 && cause && typeof cause === 'object'; i++) {
      if ('data' in cause && typeof cause.data === 'string') data = cause.data;
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw new Error(
      'Collateral claim simulation reverted' +
        (data ? ' (' + data + ')' : '') +
        (data === '0x3e31dcc2'
          ? '. The deployed claim-policy gate rejects direct claims; SDK eligibility alone does not cover this gate. Use a supported authorized claim flow or deposit wallet USDso'
          : '') +
        '. No transaction was sent.',
    );
  }
  const [estimate, gasPrice, balance] = await Promise.all([
    rpc.estimateGas({ account: owner, to: call.to, data: call.data, value: 0n }),
    rpc.getGasPrice(),
    rpc.getBalance({ address: owner }),
  ]);
  const gas = (estimate * 125n) / 100n;
  if (balance < gas * gasPrice) throw new Error('Insufficient STT for claim gas');
  return {
    account: owner,
    marketId,
    bank: market.marginBank,
    chainId: 50383,
    grant: formatEther(eligibility.grantAmount),
    to: call.to,
    data: call.data,
    value: '0x0',
    gas: '0x' + gas.toString(16),
    gasPrice: '0x' + gasPrice.toString(16),
    estimatedGasSTT: formatEther(gas * gasPrice),
    expiresAt: Date.now() + 30000,
  };
}
export function collateralRouter() {
  const r = Router();
  r.post('/funding/preview', async (req, res) => {
    try {
      const b = fundingInput.parse(req.body);
      res.json(await prepareMarginDeposit(b.account as Address, b.marketId, b.amount));
    } catch (e) {
      res.status(422).json({ error: e instanceof Error ? e.message : 'Funding preview failed' });
    }
  });
  r.get('/funding/receipt/:hash', async (req, res) => {
    try {
      const owner = address.parse(req.query.account) as Address,
        marketId = address.parse(req.query.marketId),
        amount = z.literal('15').parse(req.query.amount);
      const stage = z.enum(['approval', 'deposit']).parse(req.query.stage),
        hash = z
          .string()
          .regex(/^0x[\da-fA-F]{64}$/)
          .parse(req.params.hash) as Hex;
      if ((await rpc.getChainId()) !== 50383) throw new Error('Wrong chain');
      const m = await marketById(marketId),
        quantity = parseUnits(amount, m.quoteDecimals);
      const expectedTo = stage === 'approval' ? m.quoteToken : m.marginBank;
      const expectedData =
        stage === 'approval'
          ? encodeFunctionData({
              abi: tokenAbi,
              functionName: 'approve',
              args: [m.marginBank, quantity],
            })
          : encodeFunctionData({ abi: depositAbi, functionName: 'deposit', args: [quantity] });
      const [tx, receipt] = await Promise.all([
        rpc.getTransaction({ hash }),
        rpc.getTransactionReceipt({ hash }),
      ]);
      if (
        tx.from.toLowerCase() !== owner.toLowerCase() ||
        tx.to?.toLowerCase() !== expectedTo.toLowerCase() ||
        tx.input !== expectedData ||
        tx.value !== 0n
      )
        throw new Error('Receipt does not match the reviewed funding transaction');
      res.json({
        hash,
        stage,
        amount,
        status: receipt.status,
        block: receipt.blockNumber.toString(),
      });
    } catch (e) {
      res
        .status(422)
        .json({ error: e instanceof Error ? e.message : 'Funding receipt unavailable' });
    }
  });
  r.post('/preview', async (req, res) => {
    try {
      const b = z.object({ account: address, marketId: address }).strict().parse(req.body);
      res.json(await prepareCollateralClaim(b.account as Address, b.marketId));
    } catch (e) {
      res.status(422).json({ error: e instanceof Error ? e.message : 'Claim preparation failed' });
    }
  });
  r.get('/receipt/:hash', async (req, res) => {
    try {
      const hash = z
        .string()
        .regex(/^0x[\da-fA-F]{64}$/)
        .parse(req.params.hash) as Hex;
      const owner = address.parse(req.query.account) as Address;
      const market = await marketById(address.parse(req.query.marketId));
      if ((await rpc.getChainId()) !== 50383) throw new Error('Wrong chain');
      const expected = await claimCall(market.marginBank);
      const [tx, receipt] = await Promise.all([
        rpc.getTransaction({ hash }),
        rpc.getTransactionReceipt({ hash }),
      ]);
      if (
        tx.from.toLowerCase() !== owner.toLowerCase() ||
        tx.to?.toLowerCase() !== expected.to.toLowerCase() ||
        tx.input !== expected.data ||
        tx.value !== 0n
      )
        throw new Error('Transaction does not match this account collateral claim');
      const voucher = await sdk.client.getPerpVoucher(market.marginBank, owner);
      res.json({
        hash,
        block: receipt.blockNumber.toString(),
        status: receipt.status,
        claimed: voucher?.claimed === true,
        creditRaw: voucher?.floor.toString(),
      });
    } catch (e) {
      res
        .status(422)
        .json({ error: e instanceof Error ? e.message : 'Receipt unavailable; do not resubmit' });
    }
  });
  return r;
}
