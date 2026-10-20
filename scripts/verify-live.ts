import { writeFile } from 'node:fs/promises';
const base = process.env.PERPSHQ_TEST_URL ?? 'http://127.0.0.1:3001';
const results: { name: string; ok: boolean; ms: number; summary?: unknown; error?: string }[] = [];
async function request(
  path: string,
  expected = 200,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const r = await fetch(base + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = await r.json();
  if (expected !== 0 && r.status !== expected)
    throw new Error(`Expected ${expected}, got ${r.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return expected === 0 ? { httpStatus: r.status, payload: data } : data;
}
async function check(name: string, fn: () => Promise<unknown>) {
  const start = Date.now();
  try {
    const summary = await fn();
    results.push({ name, ok: true, ms: Date.now() - start, summary });
    console.log('PASS', name, JSON.stringify(summary).slice(0, 300));
  } catch (e) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    });
    console.log('FAIL', name, results.at(-1)?.error);
  }
}
await check('health', async () => {
  const r = await request('/health');
  if (r.chainId !== 50383) throw new Error('Wrong chain');
  return r;
});
const discovery = await request('/markets');
const btc = discovery.markets.find((m: { baseSymbol: string }) => m.baseSymbol === 'BTC');
await check('discovery', async () => ({
  count: discovery.markets.length,
  btcPool: btc.poolAddress,
  decimals: btc.baseDecimals,
}));
await check('cockpit', async () => {
  const d = await request('/markets/' + btc.id + '?timeframe=15m');
  if (d.candles.length < 34) throw new Error('Insufficient history for MACD validation');
  return {
    count: d.candles.length,
    source: d.quality.source,
    gaps: d.quality.gaps,
    stale: d.quality.stale,
    rsi: d.analysis.values.rsi,
    mark: d.market.markPrice,
    bookLevels: (d.book?.bids.length ?? 0) + (d.book?.asks.length ?? 0),
    timeframes: Object.keys(d.timeframes),
  };
});
await check('scanner and actual bucket stats', async () => {
  const s = await request('/scanner?timeframe=15m');
  return {
    rows: s.rows.length,
    volumeCoverage: s.rows.filter(
      (r: { market: { volume24h?: number } }) => r.market.volume24h !== undefined,
    ).length,
    changeCoverage: s.rows.filter(
      (r: { market: { change24h?: number } }) => r.market.change24h !== undefined,
    ).length,
  };
});
await check('funding history', async () => {
  const d = await request('/markets/' + btc.id + '/funding');
  if (!d.history.length) throw new Error('No funding history');
  return {
    count: d.history.length,
    firstRate1h: d.history[0].rate1h,
    interval: d.settlementInterval,
    window: d.calculationWindow,
  };
});
await check('empty public account including analytics', async () => {
  const d = await request('/account/0x0000000000000000000000000000000000000001');
  if (d.margin?.equity !== '0') throw new Error('Unexpected empty-account equity');
  return {
    equity: d.margin.equity,
    analytics: d.analytics,
    fundingPayments: d.fundingPayments?.length,
    errors: d.errors,
  };
});
await check('public active-account reads', async () => {
  const probe = JSON.parse(
    await (await import('node:fs/promises')).readFile('docs/probe-results.json', 'utf8'),
  );
  const owner = probe.fills.data[0].maker;
  const d = await request('/account/' + owner);
  if (!d.margin) throw new Error('Public active margin read unavailable');
  return {
    positions: d.positions?.length,
    analytics: d.analytics?.length,
    priceable: d.analytics?.filter((p: { priceable: boolean }) => p.priceable).length,
    orders: d.orders?.length,
    fills: d.fills?.length,
    fundingPayments: d.fundingPayments?.length,
    errors: d.errors,
  };
});
await check('diagnostics', async () => {
  const d = await request('/diagnostics');
  return d.endpoints.map((e: { name: string; ok: boolean }) => ({ name: e.name, ok: e.ok }));
});
await check('unsigned simulation and gas guard for a public collateral account', async () => {
  const probe = JSON.parse(
    await (await import('node:fs/promises')).readFile('docs/probe-results.json', 'utf8'),
  );
  const { fromRaw } = await import('../packages/risk-engine');
  const response = await request('/preview', 0, {
    account: probe.fills.data[0].maker,
    input: {
      marketId: btc.id,
      side: 'long',
      type: 'limit',
      entry: '80000',
      stop: '79000',
      target: '82000',
      riskBudget: '10',
      collateral: '1000',
      leverage: '5',
      slippageBps: '10',
      quantity: fromRaw(btc.minQuantity, btc.baseDecimals),
    },
  });
  if (
    response.httpStatus === 422 &&
    response.payload.error === 'Insufficient STT for estimated network gas'
  )
    return {
      simulationPassed: true,
      gasEstimationReached: true,
      previewReady: false,
      blocked: 'Insufficient STT',
      signed: false,
      broadcast: false,
    };
  const p = response.payload;
  if (response.httpStatus !== 200 || p.chainId !== 50383 || !p.data?.startsWith('0x'))
    throw new Error(JSON.stringify(response));
  return {
    simulationPassed: true,
    previewReady: true,
    chainId: p.chainId,
    pool: p.to,
    rawPrice: p.rawPrice,
    rawQuantity: p.rawQuantity,
    estimatedGas: p.gas,
    signed: false,
    broadcast: false,
  };
});
await check('strict invalid input rejection', () =>
  request('/plan', 400, { unexpected: 'payload' }),
);
await check('cross-origin API denial', () =>
  request('/health', 403, undefined, { Origin: 'https://untrusted.example' }),
);
await check('unknown market rejection', () =>
  request('/markets/0x0000000000000000000000000000000000000001', 422),
);
await check('unfunded preview is blocked', () =>
  request('/preview', 422, {
    account: '0x0000000000000000000000000000000000000001',
    input: {
      marketId: btc.id,
      side: 'long',
      type: 'limit',
      entry: '80000',
      stop: '79000',
      target: '82000',
      riskBudget: '10',
      collateral: '1000',
      leverage: '5',
      slippageBps: '10',
    },
  }),
);
await writeFile(
  'docs/verification-results.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      base,
      mode: 'READ ONLY — no wallet signing or broadcasting',
      results,
    },
    null,
    2,
  ),
);
process.exit(results.every((r) => r.ok) ? 0 : 1);
