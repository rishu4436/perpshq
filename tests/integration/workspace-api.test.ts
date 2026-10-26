import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { AgentStore } from '../../packages/agent-store';
import { createWorkspaceRouter } from '../../apps/api/src/workspace';
import { agentFixture, agentNow } from '../agent-fixtures';
import { randomUUID } from 'node:crypto';
import { unpackBackup, type WorkspaceBackup } from '../../packages/workspace';
const resources: { server: Server; store: AgentStore }[] = [];
afterEach(async () => {
  for (const { server, store } of resources.splice(0)) {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    store.close();
  }
});
async function setup() {
  const store = new AgentStore(':memory:'),
    app = express();
  app.use(express.json({ limit: '32mb' }));
  app.use('/workspace', createWorkspaceRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  resources.push({ server, store });
  const port = (server.address() as { port: number }).port;
  return {
    store,
    request: async (path: string, body?: unknown) =>
      fetch('http://127.0.0.1:' + port + '/workspace' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}
describe('workspace HTTP workflows', () => {
  it('reports recovery, archives and restores flat agents, and exports a complete backup', async () => {
    const { store, request } = await setup(),
      f = agentFixture();
    store.save(f.config, undefined, agentNow);
    const state = await (await request('/')).json();
    expect(state.recovery.agents).toHaveLength(1);
    expect((await request('/agents/' + f.config.id + '/lifecycle', { action: 'archive' })).ok).toBe(
      true,
    );
    expect((await (await request('/')).json()).archived).toHaveLength(1);
    expect((await request('/agents/' + f.config.id + '/lifecycle', { action: 'restore' })).ok).toBe(
      true,
    );
    const backup = await (await request('/backup')).json();
    expect((unpackBackup(backup) as WorkspaceBackup).tables.agent_config_versions).toHaveLength(1);
    expect((await request('/restore', backup)).status).toBe(422);
  });
  it('accepts a delayed durable outbox event once and rejects future/invalid data', async () => {
    const { request } = await setup(),
      f = agentFixture(),
      entry = {
        id: randomUUID(),
        flowId: randomUUID(),
        account: '0x' + '1'.repeat(40),
        marketId: f.config.marketId,
        at: Date.now() - 86400000,
        state: 'pending',
        hash: '0x' + 'a'.repeat(64),
        detail: 'Wallet supplied hash',
      };
    expect((await request('/activity', entry)).ok).toBe(true);
    expect((await request('/activity', entry)).ok).toBe(true);
    expect((await (await request('/')).json()).activities).toHaveLength(1);
    expect(
      (await request('/activity', { ...entry, id: randomUUID(), at: Date.now() + 600000 })).status,
    ).toBe(422);
    expect((await request('/activity', { ...entry, secret: 'never accepted' })).status).toBe(400);
    const alerts = (await (await request('/')).json()).alerts;
    expect(alerts).toHaveLength(1);
    expect((await request('/alerts/' + alerts[0].id + '/acknowledge', {})).ok).toBe(true);
  });
  it('rejects malformed restore data without modifying the empty database', async () => {
    const { request, store } = await setup();
    expect((await request('/restore', { format: 'other' })).status).toBe(400);
    expect(store.list()).toHaveLength(0);
  });
});
