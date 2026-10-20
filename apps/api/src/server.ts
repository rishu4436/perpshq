import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  markets,
  detail,
  scan,
  account,
  prepare,
  prepareCancel,
  receipt,
  rpc,
  sdk,
  message,
  marketById,
  funding,
} from '../../../packages/dreamdex-adapter';
import { planTrade } from '../../../packages/risk-engine';
import { NETWORK, type Timeframe } from '../../../packages/shared-types';

const app = express(),
  port = Number(process.env.PORT ?? 3000),
  production = process.argv.includes('--production');
mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/perpshq.sqlite');
db.exec(
  'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL);',
);
const json = (v: unknown) =>
  JSON.stringify(v, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const persist = (key: string, value: unknown) =>
  db
    .prepare(
      'INSERT INTO snapshots VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt',
    )
    .run(key, json(value), Date.now());
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: production
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'", NETWORK.rpc],
            frameAncestors: ["'self'"],
          },
        }
      : false,
  }),
);
app.use(
  '/api',
  rateLimit({ windowMs: 60000, limit: 150, standardHeaders: 'draft-8', legacyHeaders: false }),
);
app.use('/api', (req, res, next) => {
  const host = req.hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    res.status(403).json({ error: 'This local workspace only accepts loopback hosts.' });
    return;
  }
  const origin = req.get('origin');
  if (origin && !['http://127.0.0.1:' + port, 'http://localhost:' + port].includes(origin)) {
    res.status(403).json({ error: 'Cross-origin API access is disabled.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '32kb' }));
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  tf = z.enum(['1m', '5m', '15m', '1h', '4h', '1d']);
const numeric = z
  .string()
  .max(100)
  .regex(/^\d+(\.\d+)?$/);
const input = z
  .object({
    marketId: addr,
    side: z.enum(['long', 'short']),
    type: z.enum(['limit', 'market']),
    entry: numeric,
    stop: numeric,
    target: numeric,
    riskBudget: numeric,
    collateral: numeric,
    leverage: numeric,
    slippageBps: numeric,
    quantity: numeric.optional(),
  })
  .strict();
type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;
const route = (method: 'get' | 'post', path: string, fn: Handler) =>
  app[method](path, async (req, res) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) res.type('json').send(json(result));
    } catch (e) {
      const validation = e instanceof z.ZodError;
      res.status(validation ? 400 : 422).json({
        error: validation
          ? e.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')
          : message(e),
      });
    }
  });
route('get', '/api/health', async () => ({
  ok: true,
  name: 'PerpsHQ',
  chainId: NETWORK.id,
  mode: 'read-only API / browser signing',
  now: Date.now(),
}));
route('get', '/api/markets', async () => {
  const m = await markets();
  persist('markets', m);
  return {
    markets: m,
    fetchedAt: Date.now(),
    source: 'Hideki SDK indexer; marks on this list are settlement snapshots',
  };
});
route('get', '/api/markets/:id', async (req) =>
  detail(addr.parse(req.params.id), tf.parse(req.query.timeframe ?? '15m') as Timeframe),
);
route('get', '/api/markets/:id/funding', async (req) => funding(addr.parse(req.params.id)));
route('get', '/api/scanner', async (req) => ({
  rows: await scan(tf.parse(req.query.timeframe ?? '15m') as Timeframe),
  fetchedAt: Date.now(),
}));
route('get', '/api/account/:address', async (req) =>
  account(addr.parse(req.params.address) as `0x${string}`),
);
route('post', '/api/plan', async (req) => {
  const p = input.parse(req.body);
  return planTrade(p, await marketById(p.marketId));
});
route('post', '/api/preview', async (req) => {
  const body = z.object({ input, account: addr }).strict().parse(req.body);
  return prepare(
    planTrade(body.input, await marketById(body.input.marketId)),
    body.account as `0x${string}`,
  );
});
route('post', '/api/cancel-preview', async (req) => {
  const b = z
    .object({ marketId: addr, orderId: z.string().regex(/^\d{1,39}$/), account: addr })
    .strict()
    .parse(req.body);
  return prepareCancel(b.marketId, b.orderId, b.account as `0x${string}`);
});
route('get', '/api/receipt/:hash', async (req) => {
  const b = {
    hash: hash.parse(req.params.hash),
    marketId: addr.parse(req.query.marketId),
    account: addr.parse(req.query.account),
  };
  const evidence = await receipt(b.hash as `0x${string}`, b.marketId, b.account as `0x${string}`);
  persist('receipt:' + b.hash, evidence);
  return evidence;
});
route('get', '/api/diagnostics', async () => {
  const results = await Promise.allSettled([
    rpc.getChainId(),
    rpc.getBlockNumber(),
    markets().then((v) => ({ count: v.length, source: 'Hideki perpetual indexer' })),
    sdk.client.getIndexerFreshness(NETWORK.id),
  ]);
  return {
    checkedAt: Date.now(),
    network: NETWORK,
    endpoints: results.map((r, i) => ({
      name: ['RPC chain', 'RPC head', 'Perp discovery', 'Indexer freshness'][i],
      ok: r.status === 'fulfilled',
      data: r.status === 'fulfilled' ? r.value : undefined,
      error: r.status === 'rejected' ? message(r.reason) : undefined,
    })),
    database: {
      engine: 'SQLite',
      snapshots: db.prepare('SELECT COUNT(*) AS count FROM snapshots').get(),
    },
  };
});
if (production) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: resolve('vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, '127.0.0.1', () =>
  console.log(
    `PerpsHQ ready at http://127.0.0.1:${port} · Hideki 50383 · ${production ? 'production' : 'development'}`,
  ),
);
async function shutdown() {
  server.close();
  await sdk.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
