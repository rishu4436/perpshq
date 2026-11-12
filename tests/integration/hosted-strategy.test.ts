import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request, type Server } from 'node:http';
import { MemoryDocuments } from '../hosted-fixtures';
const mocks = vi.hoisted(() => ({ review: vi.fn(), transaction: vi.fn(), receipt: vi.fn() }));
vi.mock('../../apps/api/src/owner-review', () => ({ prepareOwnerReview: mocks.review }));
vi.mock('../../packages/dreamdex-adapter', () => ({
  marketById: async () => ({ maxLeverage: 20, symbol: 'BTC-PERP' }),
  rpc: { verifyMessage: async () => false, getTransaction: mocks.transaction },
  receipt: mocks.receipt,
}));
import { hostedStrategyRouter } from '../../apps/api/src/hosted-strategy';
import { HostedStorageError } from '../../apps/api/src/hosted-store';
import { HostedLedger } from '../../apps/api/src/hosted-ledger';
import { reconcileAccounting, type AccountingCheckpointCache } from '../../packages/accounting';
import { defaultAgentConfig } from '../../packages/agent-engine';
const owner = '0x' + '1'.repeat(40),
  other = '0x' + '2'.repeat(40),
  pool = '0x' + '3'.repeat(40),
  hash = '0x' + 'a'.repeat(64);
let server: Server, base: string, store: MemoryDocuments, cookie: string, otherCookie: string;
async function session(account: string) {
  const token = randomBytes(32).toString('hex');
  await store.create('auth:' + createHash('sha256').update(token).digest('hex'), {
    kind: 'session',
    owner: account,
    origin: 'https://perps.test',
    expiresAt: Date.now() + 60000,
  });
  return '__Host-perpshq_session=' + token;
}
async function send(path: string, body?: unknown, auth: string | undefined = cookie) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const r = request(
      base + path,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Host: 'perps.test',
          Origin: 'https://perps.test',
          'Content-Type': 'application/json',
          ...(auth ? { Cookie: auth } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => {
          text += c;
        });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      },
    );
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}
function config() {
  const c = defaultAgentConfig(pool, randomUUID());
  c.ownerAddress = owner;
  c.mode = 'ASSISTED';
  c.execution.signer = 'owner-wallet';
  return c;
}
beforeEach(async () => {
  vi.clearAllMocks();
  store = new MemoryDocuments();
  cookie = await session(owner);
  otherCookie = await session(other);
  mocks.review.mockImplementation(async (c) => ({
    decision: {
      id: randomUUID(),
      strategy: c.strategy,
      agentId: c.id,
      evaluatedAt: Date.now(),
      type: c.strategy === 'risk-guardian' ? 'CANCEL_CANDIDATE' : 'ENTRY_CANDIDATE',
      signalKey: c.id + ':TEST',
      rationale: 'AUTOMATED TEST FIXTURE',
      risk: { allowed: true },
    },
    preview: {
      account: owner,
      chainId: 50383,
      to: pool,
      data: '0x1234',
      value: '0',
      gas: '100000',
      expiresAt: Date.now() + 60000,
      market: 'TEST FIXTURE',
    },
  }));
  mocks.transaction.mockResolvedValue({ from: owner, to: pool, input: '0x1234', value: 0n });
  mocks.receipt.mockResolvedValue({
    hash,
    receipt: { status: 'success', blockNumber: 1n },
    state: 'filled',
  });
  const app = express();
  app.use(express.json());
  app.use(hostedStrategyRouter(store));
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it.each([
  'multi-timeframe-trend',
  'support-resistance-breakout',
  'mean-reversion',
  'risk-guardian',
] as const)(
  'registers and reconciles the %s path with labelled test evidence',
  async (strategy) => {
    const c = config();
    c.strategy = strategy;
    const r = await send('/review', { config: c });
    expect(r.status).toBe(200);
    expect((await send('/begin', { ticketId: r.body.id })).status).toBe(200);
    expect((await send('/begin', { ticketId: r.body.id })).status).toBe(422);
    const receipt = await send('/receipt', {
      ticketId: r.body.id,
      hash,
      account: owner,
      marketId: pool,
      data: '0x1234',
    });
    expect(receipt.status).toBe(200);
    expect(receipt.body.strategyVerified).toBe(true);
    expect((await send('/status/' + r.body.id)).body.state).toBe('confirmed');
  },
);
it('isolates records between wallets and refuses unauthenticated or substituted owners', async () => {
  const c = config();
  expect((await send('/review', { config: c }, '')).status).toBe(401);
  c.ownerAddress = other;
  expect((await send('/review', { config: c })).status).toBe(422);
  expect(mocks.review).not.toHaveBeenCalled();
  c.ownerAddress = owner;
  const r = await send('/review', { config: c });
  expect((await send('/status/' + r.body.id, undefined, otherCookie)).status).toBe(422);
  expect(
    (await send('/rejected', { ticketId: r.body.id, walletCode: 4001 }, otherCookie)).status,
  ).toBe(422);
  expect((await send('/configs', undefined, otherCookie)).body.configs).toEqual([]);
});
it('stores versioned owned configurations and refuses stale revisions', async () => {
  const c = config();
  expect((await send('/configs', { config: c })).status).toBe(200);
  c.name = 'Updated';
  expect((await send('/configs', { config: c })).status).toBe(422);
  c.revision++;
  expect((await send('/configs', { config: c })).status).toBe(200);
  expect(((await send('/configs')).body.configs as { revision: number }[])[0].revision).toBe(2);
});
it('persists only server-produced verified accounting history for reuse by later reviews', async () => {
  const c = config(),
    since = 123000;
  const report = reconcileAccounting({
    account: owner,
    bank: pool,
    chainId: 50383,
    from: { block: '1', blockHash: '0x1', at: 120000, totalEquity: '10' },
    to: { block: '2', blockHash: '0x2', at: 124000, totalEquity: '10' },
    movements: [],
    reasons: [],
    fillCount: null,
    generatedAt: Date.now(),
  });
  const seen: unknown[] = [];
  mocks.review.mockImplementation(
    async (config, _previous, _runtime, cache: AccountingCheckpointCache) => {
      seen.push(cache.get(config.marketId, since));
      cache.put(config.marketId, { since, report });
      return {
        decision: {
          id: randomUUID(),
          agentId: config.id,
          configRevision: config.revision,
          strategy: config.strategy,
          type: 'NO_ACTION',
          evaluatedAt: Date.now(),
          rationale: 'LABELLED CHECKPOINT TEST',
        },
      };
    },
  );
  expect((await send('/review', { config: c })).status).toBe(200);
  expect(
    (await new HostedLedger(store).read(owner)).value.accounting?.[`${pool}:${since}`]?.report
      .complete,
  ).toBe(true);
  expect((await send('/review', { config: c })).status).toBe(200);
  expect(seen[0]).toBeUndefined();
  expect(seen[1]).toEqual({ since, report });
  expect((await send('/review', { config: c, accounting: { forged: true } })).status).toBe(400);
  expect((await send('/configs')).body).not.toHaveProperty('accounting');
});
it('refuses leverage above the verified market maximum before saving a revision', async () => {
  const c = config();
  c.risk.leverage = 100;
  const result = await send('/configs', { config: c });
  expect(result.status).toBe(422);
  expect(result.body.error).toContain('maximum verified leverage');
  expect((await send('/configs')).body.configs).toEqual([]);
});
it('releases a known pre-dispatch block without treating ambiguous errors as rejections', async () => {
  const c = config(),
    reviewed = await send('/review', { config: c });
  expect((await send('/begin', { ticketId: reviewed.body.id })).status).toBe(200);
  expect(
    (await send('/rejected', { ticketId: reviewed.body.id, walletCode: 'RPC error' })).status,
  ).toBe(400);
  expect((await send(`/status/${reviewed.body.id}`)).body.state).toBe('unknown');
  expect(
    (await send('/rejected', { ticketId: reviewed.body.id, walletCode: 'not-dispatched' })).status,
  ).toBe(200);
  expect((await send(`/status/${reviewed.body.id}`)).body.state).toBe('rejected');
});
it('reviews saved JSONB configurations after key reordering and still rejects changed values', async () => {
  const c = config();
  expect((await send('/configs', { config: c })).status).toBe(200);
  expect((await send('/configs', { config: c })).status).toBe(200);
  const reviewed = await send('/review', { config: c });
  expect(reviewed.status).toBe(200);
  expect((await send('/review', { config: c, ticketId: reviewed.body.id })).status).toBe(200);
  expect((await send('/begin', { ticketId: reviewed.body.id })).status).toBe(200);
  await send('/rejected', { ticketId: reviewed.body.id, walletCode: 4001 });
  c.name = 'Different strategy name';
  expect((await send('/review', { config: c })).status).toBe(422);
});
it('returns 503 for an ambiguous database response and preserves the registered unknown intent', async () => {
  const c = config(),
    r = await send('/review', { config: c }),
    swap = store.swap.bind(store);
  let lose = true;
  store.swap = async (key, revision, value, expiry) => {
    const applied = await swap(key, revision, value, expiry);
    if (
      lose &&
      key.startsWith('owner:') &&
      Object.values((value as { tickets: Record<string, { state: string }> }).tickets).some(
        (t) => t.state === 'unknown',
      )
    ) {
      lose = false;
      throw new HostedStorageError();
    }
    return applied;
  };
  expect((await send('/begin', { ticketId: r.body.id })).status).toBe(503);
  expect((await send('/status/' + r.body.id)).body.state).toBe('unknown');
  expect((await send('/review', { config: c })).status).toBe(422);
});
it('does not unlock on a substituted transaction or owner receipt', async () => {
  const r = await send('/review', { config: config() });
  await send('/begin', { ticketId: r.body.id });
  mocks.transaction.mockResolvedValue({ from: owner, to: pool, input: '0x9999', value: 0n });
  expect(
    (
      await send('/receipt', {
        ticketId: r.body.id,
        hash,
        account: owner,
        marketId: pool,
        data: '0x1234',
      })
    ).status,
  ).toBe(422);
  expect((await send('/status/' + r.body.id)).body.state).toBe('unknown');
});
