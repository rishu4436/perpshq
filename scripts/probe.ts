import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { writeFile, mkdir } from 'node:fs/promises';
const sdk = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});
const results: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  sdk: '0.32.1',
  chain: 50383,
};
async function check(name: string, fn: () => Promise<unknown>) {
  const start = Date.now();
  try {
    const data = await fn();
    results[name] = { ok: true, ms: Date.now() - start, data };
    console.log(
      name,
      'OK',
      JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 1600),
    );
    return data;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    results[name] = { ok: false, ms: Date.now() - start, error: message };
    console.log(name, 'FAILED', message.slice(0, 600));
  }
}
await mkdir('docs', { recursive: true });
await check('rpc', async () => {
  const r = await fetch('https://api.hideki2.infra.testnet.somnia.network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(15000),
  });
  return r.json();
});
const markets = (await check('markets', () => sdk.client.listPerpMarkets())) as
  Awaited<ReturnType<typeof sdk.client.listPerpMarkets>> | undefined;
const m = markets?.find((v) => v.baseSymbol === 'BTC') ?? markets?.[0];
if (m) {
  await check('system', () => sdk.client.getPerpSystemConfig(m.marginBank));
  await check('book', () => sdk.client.getSpotOrderBook(m.poolAddress, { depth: 20 }));
  await check('perpState', () => sdk.client.getPerpState(m.poolAddress));
  for (const interval of [60, 300, 900, 3600, 14400, 86400])
    await check('candles' + interval, () =>
      sdk.client.getCandles(m.poolAddress, interval, { market: m.id, limit: 300 }),
    );
  await check('fills', () => sdk.client.getFills(m.poolAddress, { market: m.id, limit: 5 }));
  await check('zeroAccount', () =>
    sdk.client.getMarginAccount(m.marginBank, '0x0000000000000000000000000000000000000001'),
  );
}
await check('restMarkets', async () => {
  const r = await fetch('https://stg.api.dreamdex.io/v0/markets', {
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: await r.json() };
});
await check('restPerpCandles', async () => {
  const r = await fetch('https://stg.api.dreamdex.io/v0/markets/BTC-PERP/candles', {
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: (await r.text()).slice(0, 500) };
});
await writeFile(
  'docs/probe-results.json',
  JSON.stringify(results, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
);
await sdk.close();
process.exit(0);
