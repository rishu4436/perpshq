import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  evaluate: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
  receipt: vi.fn(),
  getTransaction: vi.fn(),
}));
vi.mock('../../apps/agent-worker/src/live-data', () => ({ observeAgent: mocks.observe }));
vi.mock('../../packages/agent-engine', async (original) => ({
  ...(await original<object>()),
  evaluateAgent: mocks.evaluate,
}));
vi.mock('../../packages/dreamdex-adapter', () => ({
  marketById: async () => ({ id: '0x' + '2'.repeat(40), markPrice: 100 }),
  prepare: mocks.prepare,
  prepareCancel: mocks.cancel,
  receipt: mocks.receipt,
  rpc: { getTransaction: mocks.getTransaction },
}));
vi.mock('../../packages/risk-engine', async (original) => ({
  ...(await original<object>()),
  planTrade: () => ({ rawQuantity: '10000000', rawPrice: '100000000000000000000' }),
}));
vi.mock('../../packages/agent-risk', () => ({
  assessRisk: () => ({ allowed: true }),
  sizeProposal: () => ({ estimatedLoss: '1', stopPrice: '99', targetPrice: '102' }),
}));
import { ownerStrategyRouter } from '../../apps/api/src/owner-strategy';
import { defaultAgentConfig } from '../../packages/agent-engine/config';
const owner = '0x' + '1'.repeat(40),
  pool = '0x' + '2'.repeat(40),
  hash = '0x' + 'a'.repeat(64);
let server: Server, router: ReturnType<typeof ownerStrategyRouter>, root: string, url: string;
const config = () => ({
  ...defaultAgentConfig(pool, crypto.randomUUID()),
  mode: 'ASSISTED',
  ownerAddress: owner,
  execution: { ...defaultAgentConfig(pool, crypto.randomUUID()).execution, signer: 'owner-wallet' },
});
async function post(path: string, body: unknown) {
  const r = await fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
beforeEach(async () => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'perpshq-owner-'));
  router = ownerStrategyRouter(root);
  const app = express();
  app.use(express.json());
  app.use(router);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  mocks.observe.mockResolvedValue({
    account: { historyComplete: true, availableCollateral: '100', orders: [] },
    detail: { market: { markPrice: 100 } },
  });
  mocks.evaluate.mockImplementation((c) => ({
    id: 'd',
    agentId: c.id,
    type: 'ENTRY_CANDIDATE',
    signalKey: c.id + ':candle:long',
    risk: { allowed: true },
    proposal: {
      action: 'entry',
      side: 'long',
      quantity: '0.1',
      rawQuantity: '10000000',
      price: '100',
      rawPrice: '100000000000000000000',
      notional: '10',
      estimatedLoss: '1',
      stopPrice: '99',
      targetPrice: '102',
      orderType: 'IOC',
    },
  }));
  mocks.prepare.mockResolvedValue({
    chainId: 50383,
    account: owner,
    to: pool,
    data: '0x1234',
    value: '0',
    gas: '100000',
    gasPrice: '1000',
    expiresAt: Date.now() + 30000,
    market: 'TEST',
    rawPrice: '100000000000000000000',
    rawQuantity: '10000000',
  });
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  router.close();
  if (!root.startsWith(join(tmpdir(), 'perpshq-owner-')))
    throw new Error('Unexpected test cleanup path');
  rmSync(root, { recursive: true });
});
describe('connected owner strategy review', () => {
  it('holds the reviewed gas budget for small estimate changes and rejects a higher fee price', async () => {
    const c = config();
    const prepared = await mocks.prepare();
    mocks.prepare.mockResolvedValue({
      ...prepared,
      estimatedGasUnits: '80000',
      estimatedGasSTT: '0.0000000001',
    });
    const first = await post('/review', { config: c });
    mocks.prepare.mockResolvedValue({
      ...prepared,
      gas: '106250',
      estimatedGasUnits: '85000',
      estimatedGasSTT: '0.00000000010625',
    });
    const refreshed = await post('/review', { config: c, ticketId: first.body.id });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.preview.gas).toBe('100000');
    mocks.prepare.mockResolvedValue({
      ...prepared,
      gas: '106250',
      gasPrice: '1001',
      estimatedGasUnits: '85000',
      estimatedGasSTT: '0.00000000010635625',
    });
    expect((await post('/review', { config: c, ticketId: first.body.id })).status).toBe(422);
  });
  it('exposes the persisted explicit rejection for browser reload recovery', async () => {
    const reviewed = await post('/review', { config: config() });
    await post('/begin', { ticketId: reviewed.body.id });
    await post('/rejected', { ticketId: reviewed.body.id, walletCode: 4001 });
    const status = await (await fetch(url + '/status/' + reviewed.body.id)).json();
    expect(status).toMatchObject({
      state: 'rejected',
      account: owner,
      to: pool,
      data: '0x1234',
      hash: null,
    });
  });
  it('rejects delegated configs without preparing owner calldata', async () => {
    const c = config();
    c.execution.signer = 'operator';
    const r = await post('/review', { config: c });
    expect(r.status).toBe(422);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('never prepares a transaction for a no-action strategy', async () => {
    mocks.evaluate.mockReturnValue({ type: 'NO_ACTION', risk: { allowed: false } });
    const r = await post('/review', { config: config() });
    expect(r.status).toBe(200);
    expect(r.body.preview).toBeUndefined();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('keeps exact approval when the fresh mark moves within the reviewed mark tolerance', async () => {
    const c = config();
    const first = await post('/review', { config: c });
    expect(first.status).toBe(200);
    mocks.observe.mockResolvedValue({
      account: { historyComplete: true, availableCollateral: '100', orders: [] },
      detail: { market: { markPrice: 100.1 } },
    });
    const next = await post('/review', { config: c, ticketId: first.body.id });
    expect(next.status).toBe(200);
    expect(next.body.preview.data).toBe(first.body.preview.data);
    expect(next.body.preview.rawPrice).toBe(first.body.preview.rawPrice);
    expect(next.body.referenceMark).toBe(100);
    mocks.observe.mockResolvedValue({
      account: { historyComplete: true, availableCollateral: '100', orders: [] },
      detail: { market: { markPrice: 110 } },
    });
    const outside = await post('/review', { config: c, ticketId: first.body.id });
    expect(outside.status).toBe(422);
    expect(outside.body.error).toContain('slippage policy');
  });
  it('persists an unknown request before wallet dispatch and blocks duplicate reviews', async () => {
    const first = await post('/review', { config: config() });
    expect(first.status).toBe(200);
    expect((await post('/begin', { ticketId: first.body.id })).status).toBe(200);
    expect((await post('/begin', { ticketId: first.body.id })).status).toBe(422);
    const next = await post('/review', { config: config() });
    expect(next.status).toBe(422);
    expect(next.body.error).toContain('unknown');
  });
  it('refuses changed calldata during confirmation', async () => {
    const c = config();
    const first = await post('/review', { config: c });
    mocks.prepare.mockResolvedValue({ ...first.body.preview, data: '0x5678' });
    const next = await post('/review', { config: c, ticketId: first.body.id });
    expect(next.status).toBe(422);
  });
  it('only prepares Guardian cancellation from a fresh reconciled owned order', async () => {
    const c = config();
    c.strategy = 'risk-guardian';
    c.execution.allowRestingCancellations = true;
    mocks.evaluate.mockReturnValue({ type: 'CANCEL_CANDIDATE', risk: { allowed: false } });
    const observed = {
      account: {
        errors: [],
        exposureComplete: true,
        observedAt: Date.now(),
        orders: [{ owner, marketId: pool, orderId: '7' }],
      },
      detail: { market: { markPrice: 100 }, quality: { fetchedAt: Date.now() } },
    };
    mocks.observe.mockResolvedValue(observed);
    mocks.cancel.mockResolvedValue({
      chainId: 50383,
      account: owner,
      to: pool,
      data: '0x1234',
      value: '0',
      gas: '100000',
      expiresAt: Date.now() + 30000,
      market: 'TEST',
      orderId: '7',
    });
    expect((await post('/review', { config: c })).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(pool, '7', owner);
    mocks.cancel.mockClear();
    observed.account.observedAt = Date.now() - 3600000;
    const stale = await post('/review', { config: c });
    expect(stale.status).toBe(422);
    expect(stale.body.error).toContain('fresh reconciled');
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('only verified matching receipts release the durable request', async () => {
    const c = config();
    const r = await post('/review', { config: c });
    await post('/begin', { ticketId: r.body.id });
    mocks.getTransaction.mockResolvedValue({ from: owner, to: pool, input: '0x9999', value: 0n });
    const body = { ticketId: r.body.id, hash, account: owner, marketId: pool, data: '0x1234' };
    expect((await post('/receipt', body)).status).toBe(422);
    mocks.getTransaction.mockResolvedValue({ from: owner, to: pool, input: '0x1234', value: 0n });
    mocks.receipt.mockResolvedValue({
      hash,
      receipt: { status: 'success', blockNumber: 10n },
      state: 'filled',
    });
    expect((await post('/receipt', body)).body.strategyVerified).toBe(true);
    expect((await post('/begin', { ticketId: r.body.id })).status).toBe(422);
  });
});
