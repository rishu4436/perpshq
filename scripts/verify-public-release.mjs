/* global console, process, fetch, AbortSignal */
import { mkdir, writeFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
const base = process.env.RELEASE_URL ?? 'https://perpshq.vercel.app';
const checks = [];
async function check(path, status = 200, body, headers = {}) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
    redirect: 'manual',
  });
  const text = await response.text();
  if (response.status !== status)
    throw new Error(
      `${path}: expected ${status}, received ${response.status}: ${text.slice(0, 250)}`,
    );
  checks.push({ path, status: response.status });
  return response.headers.get('content-type')?.includes('application/json')
    ? JSON.parse(text)
    : text;
}
await check('/');
await check('/app');
const health = await check('/api/health');
if (!health.publicHosted || health.chainId !== 50383)
  throw new Error('Incorrect hosted mode/network');
const markets = await check('/api/markets');
const btc = markets.markets.find((m) => m.baseSymbol === 'BTC');
if (!btc) throw new Error('BTC discovery missing');
const detail = await check(`/api/markets/${btc.id}?timeframe=15m`);
if (detail.candles.length < 50 || !detail.market.markPrice)
  throw new Error('BTC history or live mark unavailable');
const agents = await check('/api/agents');
if (!agents.publicHosted || agents.agents.length) throw new Error('Public agent isolation failed');
await check('/api/workspace/backup', 403);
await check('/api/workspace/restore', 403, {});
await check('/api/agents', 403, {});
await check('/api/owner-strategy/begin', 403, {});
await check('/api/health', 403, undefined, { Origin: 'https://untrusted.invalid' });
const owner = '0xd2e173c9d10952a7c5d903f1bff64a7e85b18145';
const account = await check('/api/account/' + owner);
if (
  !account.exposure.complete ||
  account.errors.length ||
  account.positions.length ||
  account.openOrders.length
)
  throw new Error('Expected reconciled flat test account');
const tick = new Decimal(btc.tickSize).div(new Decimal(10).pow(btc.quoteDecimals));
const mark = new Decimal(detail.market.markPrice).div(tick).floor().mul(tick);
const preview = await check('/api/preview', 200, {
  account: owner,
  input: {
    marketId: btc.id,
    side: 'long',
    type: 'market',
    entry: mark.toFixed(),
    stop: mark.mul('.99').div(tick).floor().mul(tick).toFixed(),
    target: mark.mul('1.02').div(tick).ceil().mul(tick).toFixed(),
    riskBudget: '1',
    collateral: '15',
    leverage: '1',
    slippageBps: '50',
    quantity: '0.00013',
  },
});
if (
  preview.chainId !== 50383 ||
  preview.account.toLowerCase() !== owner ||
  !preview.data ||
  !preview.gas
)
  throw new Error('Unsigned preview incomplete');
await mkdir('data/release-verification', { recursive: true });
await writeFile(
  'data/release-verification/hosted-api.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      base,
      checks,
      markets: markets.markets.length,
      candles: detail.candles.length,
      unsignedSimulation: true,
      broadcast: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    base,
    passed: checks.length,
    markets: markets.markets.length,
    unsignedSimulation: true,
    broadcast: false,
  }),
);
