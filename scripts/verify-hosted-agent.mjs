/* global console */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mkdir, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
const base = 'https://perpshq.vercel.app';
const evidence = {
  checkedAt: new Date().toISOString(),
  base,
  actualHostedApi: true,
  broadcast: false,
  checks: [],
  reviews: [],
};
function client() {
  let cookie = '';
  return async (path, body, expected = 200) => {
    // Independent TLS connections avoid stale keep-alive resets during slow live reviews.
    // Never retry a mutation after an ambiguous response.
    const r = await new Promise((resolve, reject) => {
      const req = httpsRequest(
        base + '/api/owner-strategy' + path,
        {
          method: body ? 'POST' : 'GET',
          agent: false,
          headers: {
            Origin: base,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('error', reject);
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode,
                cookie: res.headers['set-cookie']?.[0],
                body: JSON.parse(text),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.setTimeout(300000, () => req.destroy(new Error('Live API check timed out')));
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
    const c = r.cookie;
    if (c) cookie = c.split(';')[0];
    const result = r.body;
    if (r.status !== expected)
      throw new Error(`${path}: ${r.status} ${JSON.stringify(result).slice(0, 350)}`);
    evidence.checks.push({ path, status: r.status });
    return result;
  };
}
const request = client();
await request('/configs', undefined, 401);
const account = privateKeyToAccount(generatePrivateKey()); // Unfunded, ephemeral QA identity; never persisted.
const challenge = await request('/auth/challenge', { account: account.address, chainId: 50383 });
const signature = await account.signMessage({ message: challenge.message });
await request('/auth/verify', { id: challenge.id, signature });
await request('/auth/verify', { id: challenge.id, signature }, 401);
const session = await request('/session');
if (session.owner !== account.address.toLowerCase()) throw new Error('Session owner mismatch');
for (const strategy of [
  'multi-timeframe-trend',
  'support-resistance-breakout',
  'mean-reversion',
  'risk-guardian',
]) {
  const config = await request(
    `/defaults?account=${account.address}&marketId=0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`,
  );
  config.strategy = strategy;
  if (strategy === 'multi-timeframe-trend') {
    const excessive = await request(
      '/configs',
      { config: { ...config, risk: { ...config.risk, leverage: 100 } } },
      422,
    );
    if (!excessive.error.includes('maximum verified leverage'))
      throw new Error('Unclear leverage rejection');
    const required = await request(
      '/configs',
      { config: { ...config, risk: { ...config.risk, orderNotional: '' } } },
      400,
    );
    if (!required.error.includes('Required') || required.error.includes('DecimalError'))
      throw new Error('Unclear required amount rejection');
  }
  await request('/configs', { config });
  const reviewStarted = Date.now();
  const result = await request('/review', { config });
  if (result.decision?.sourceTimestamps?.candleTime !== undefined) {
    const candle = result.decision.candleEvidence;
    if (
      !candle ||
      ['open', 'high', 'low', 'close'].some((key) => !Number.isFinite(candle[key])) ||
      typeof candle.closed !== 'boolean' ||
      candle.openTime !== result.decision.sourceTimestamps.candleTime
    )
      throw new Error('Review is missing its actual candle OHLC and closed evidence');
  }
  evidence.reviews.push({
    strategy,
    decision: result.decision,
    hasExecutablePreview: !!result.preview,
    durationMs: Date.now() - reviewStarted,
  });
  console.log(JSON.stringify({ strategy, type: result.decision?.type, preview: !!result.preview }));
}
const persisted = await request('/configs');
if (persisted.configs.length !== 4 || persisted.decisions.length < 4)
  throw new Error('Durable configuration/review history missing');
const other = client();
const second = privateKeyToAccount(generatePrivateKey());
const ch = await other('/auth/challenge', { account: second.address, chainId: 50383 });
await other('/auth/verify', {
  id: ch.id,
  signature: await second.signMessage({ message: ch.message }),
});
const isolated = await other('/configs');
if (isolated.configs.length || isolated.decisions.length || isolated.unresolved.length)
  throw new Error('Wallet isolation failed');
await request('/auth/logout', {});
await request('/configs', undefined, 401);
await other('/auth/logout', {});
await mkdir('data/hosted-agent-studio', { recursive: true });
await writeFile('data/hosted-agent-studio/live-api.json', JSON.stringify(evidence, null, 2));
console.log(
  `Actual hosted authentication, persistence, four reviews and isolation passed (${evidence.checks.length} checks). No transaction broadcast.`,
);
