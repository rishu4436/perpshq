/** Explicit local QA mutations only. Run against an isolated AGENT_STORE_PATH, never a public API. */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { defaultAgentConfig } from '../packages/agent-engine/config';
const base = process.env.PERPSHQ_TEST_URL ?? 'http://127.0.0.1:3002';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Agent verification is restricted to a local isolated QA server');
const checks: { name: string; ok: boolean; details?: unknown }[] = [];
const check = (name: string, ok: boolean, details?: unknown) => {
  checks.push({ name, ok, details });
  if (!ok) throw new Error(name);
  console.log('PASS ' + name);
};
async function call(path: string, body?: unknown, headers?: Record<string, string>) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
try {
  const markets = await call('/markets');
  const market = markets.data.markets.find((m: { symbol: string }) => m.symbol === 'BTC-PERP');
  check('actual perpetual discovery', markets.status === 200 && !!market, { marketId: market?.id });
  const config = defaultAgentConfig(market.id, randomUUID());
  config.name = 'HTTP verification · isolated dry run';
  config.ownerAddress = '0x' + '1'.repeat(40);
  config.operatorAddress = '0x' + '2'.repeat(40);
  const valid = await call('/agents/validate', config);
  check(
    'actual market constraint validation',
    valid.status === 200 && valid.data.valid && valid.data.broadcastEnabled === false,
  );
  const bad = await call('/agents/validate', { ...config, chainId: 1 });
  check('wrong chain rejected', bad.status === 400);
  const extra = await call('/agents/validate', {
    ...config,
    privateKey: 'FORBIDDEN TEST ONLY NOT A KEY',
  });
  check('secret-shaped configuration field rejected', extra.status === 400);
  const saved = await call('/agents', { config });
  check(
    'save creates configured not running',
    saved.status === 200 && saved.data.runtime.status === 'configured',
  );
  const next = { ...config, revision: 2, name: 'HTTP verification · reviewed revision' };
  check(
    'versioned edit',
    (await call('/agents', { config: next, expectedRevision: 1 })).status === 200,
  );
  check(
    'stale version rejected',
    (await call('/agents', { config: next, expectedRevision: 1 })).status === 409,
  );
  const detail = await call('/agents/' + config.id);
  check('configuration snapshots durable', detail.data.configurationVersions.length === 2);
  const requestId = randomUUID(),
    path = '/agents/' + config.id;
  const body = { type: 'pause', revision: 2, requestId };
  const command = await call(path + '/commands', body),
    replay = await call(path + '/commands', body);
  check(
    'command replay preserves pending acknowledgement',
    command.status === 200 && command.data.id === replay.data.id && !command.data.acknowledgedAt,
  );
  check(
    'changed replay rejected',
    (await call(path + '/commands', { ...body, type: 'resume' })).status === 422,
  );
  const exported = await call(path + '/export');
  check(
    'nonsecret actual Railway export',
    exported.data.nonsecret &&
      exported.data.railway.environment.AGENT_MODE === 'DRY_RUN' &&
      !JSON.stringify(exported.data).includes('PRIVATE_KEY'),
  );
  const permissions = await call(path + '/permissions', { revision: 2 });
  check(
    'actual synthetic-public-address permission read',
    permissions.status === 200 &&
      permissions.data.chainId === 50383 &&
      permissions.data.place === false &&
      permissions.data.cancel === false &&
      permissions.data.reduce === false,
    { block: permissions.data.block, scope: 'Synthetic public addresses; no user grant inferred' },
  );
  const history = await call(path + '/history', { revision: 2 });
  check(
    'actual chronological candle report',
    history.status === 200 &&
      history.data.kind === 'HISTORICAL_SIMULATION' &&
      history.data.partitions.length === 2,
    { sample: history.data.sample, sourceCandleHash: history.data.sourceCandleHash },
  );
  const evidence = await call(path + '/evidence');
  check(
    'no invented on-chain evidence',
    evidence.status === 200 &&
      evidence.data.realTransactions.length === 0 &&
      evidence.data.broadcastEnabled === false,
  );
  check(
    'cross-origin control rejected',
    (
      await call(
        path + '/commands',
        { ...body, requestId: randomUUID() },
        { origin: 'https://untrusted.invalid' },
      )
    ).status === 403,
  );
  check('legacy manual Planner API remains online', (await call('/health')).status === 200);
} finally {
  writeFileSync(
    'docs/agent-http-verification.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        scope: 'Isolated local QA database / actual read-only Hideki sources',
        signed: false,
        broadcast: false,
        cloudDeployed: false,
        checks,
      },
      null,
      2,
    ) + '\n',
  );
}
