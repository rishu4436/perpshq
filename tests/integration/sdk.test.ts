import { describe, it, expect, afterAll } from 'vitest';
import { encodeFunctionData, decodeFunctionData } from 'viem';
import { perpPoolWriteAbi } from '@somnia-chain/markets-sdk';
import { normalizeMarket, sdk, markets, candles, book, rpc } from '../../packages/dreamdex-adapter';
import { NETWORK } from '../../packages/shared-types';
import probe from '../../docs/probe-results.json';
describe('official SDK compatibility against captured live evidence', () => {
  it('normalizes actual SDK metadata using each market’s own decimals', () => {
    const rows = probe.markets.data;
    const btc = rows.find((v) => v.baseSymbol === 'BTC')!;
    const near = rows.find((v) => v.baseSymbol === 'NEAR')!;
    const b = normalizeMarket(btc as Parameters<typeof normalizeMarket>[0]);
    expect(b.symbol).toBe('BTC-PERP');
    expect(b.baseDecimals).toBe(8);
    expect(normalizeMarket(near as Parameters<typeof normalizeMarket>[0]).baseDecimals).toBe(24);
    expect(b.quoteToken.toLowerCase()).toBe(probe.system.data.collateralToken.toLowerCase());
  });
  it('encodes the verified SDK ABI for wallet-owned perps orders', () => {
    const args = [
      true,
      0n,
      100000000000000000000n,
      10000n,
      1800000000000000000n,
      2,
      0,
      '0x0000000000000000000000000000000000000000',
      0n,
    ] as const;
    const data = encodeFunctionData({ abi: perpPoolWriteAbi, functionName: 'placeOrder', args });
    const result = decodeFunctionData({ abi: perpPoolWriteAbi, data });
    expect(result.functionName).toBe('placeOrder');
    expect(result.args).toEqual(args);
  });
  it('captured chain identity and candles belong to the discovered perp pool', () => {
    expect(Number(probe.rpc.data.result)).toBe(NETWORK.id);
    expect(probe.candles900.data.length).toBeGreaterThan(50);
    expect(probe.restMarkets.data.body.markets.every((v) => v.kind === 'spot')).toBe(true);
  });
});
describe.runIf(process.env.LIVE_TESTS === '1')(
  'read-only live Hideki integration (no signing)',
  () => {
    it('validates RPC chain', async () => expect(await rpc.getChainId()).toBe(50383));
    it('discovers actual perpetual markets', async () =>
      expect((await markets()).length).toBeGreaterThan(0));
    it('retrieves normalized completed perp candles', async () => {
      const m = (await markets()).find((v) => v.baseSymbol === 'BTC')!;
      const h = await candles(m, '15m');
      expect(h.candles.length).toBeGreaterThan(34);
      expect(h.candles.every((v) => v.complete && v.market === m.id)).toBe(true);
    });
    it('reads actual perp order-book levels', async () => {
      const b = await book((await markets())[0]);
      expect(b.bids.length + b.asks.length).toBeGreaterThan(0);
    });
    it('reads a public, empty account without a signer', async () => {
      const m = (await markets())[0],
        a = await sdk.client.getMarginAccount(
          m.marginBank,
          '0x0000000000000000000000000000000000000001',
        );
      expect(a.equity).toBe(0n);
    });
  },
);
afterAll(async () => sdk.close());
