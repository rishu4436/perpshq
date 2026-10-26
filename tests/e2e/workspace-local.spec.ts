import { test, expect } from '@playwright/test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentStore } from '../../packages/agent-store';
import { AgentWorker } from '../../apps/agent-worker/src/worker';
import { createWorkspaceRouter } from '../../apps/api/src/workspace';
import {
  condition,
  inbox,
  records,
  unpackBackup,
  type WorkspaceBackup,
} from '../../packages/workspace';
import { agentFixture, agentNow } from '../agent-fixtures';
import { mocks, nav } from './fixtures';

test('Recovery Center persists through the real local API and restores its portable backup', async ({
  page,
  request,
}, testInfo) => {
  const source = new AgentStore(':memory:'),
    target = new AgentStore(':memory:');
  const f = agentFixture(),
    spare = { ...f.config, id: randomUUID(), name: 'Capital sandbox — TEST ONLY' };
  source.save(f.config, undefined, agentNow);
  source.save(spare, undefined, agentNow);
  source.command(f.config.id, 'start', 1, agentNow);
  const worker = new AgentWorker(source, async () => structuredClone(f.observation), {
    clock: () => agentNow,
  });
  const app = express();
  app.use(express.json({ limit: '32mb' }));
  app.use('/api/workspace', createWorkspaceRouter(source));
  app.use('/restore-target', createWorkspaceRouter(target));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    worker.start();
    await worker.cycle();
    worker.shutdown();
    condition(source, 'smoke', true, {
      severity: 'warning',
      title: 'TEST ONLY recovery alert',
      detail: 'Local API and SQLite validation fixture.',
    });
    await mocks(page);
    await page.route('**/api/workspace**', async (route) => {
      const u = new URL(route.request().url());
      const response = await route.fetch({ url: base + u.pathname + u.search });
      await route.fulfill({ response });
    });
    await page.goto('/app');
    await nav(page, 'Recovery Center');
    await expect(page.getByRole('heading', { name: 'Clarity before the next move.' })).toBeVisible({
      timeout: 30000,
    });
    const artifacts = resolve('data/local-release-2026-10-26');
    await mkdir(artifacts, { recursive: true });
    const capture = async (name: string) => {
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: resolve(artifacts, testInfo.project.name + '-' + name + '.png'),
        fullPage: true,
      });
    };
    await capture('recovery');
    await page.getByRole('tab', { name: 'Decision replay', exact: true }).click();
    await page.getByLabel('Replay agent').selectOption(f.config.id);
    await page.getByRole('button', { name: 'Compare cost scenarios' }).click();
    await expect(page.getByRole('heading', { name: 'Replay comparison lab' })).toBeVisible();
    await capture('replay');
    await page.getByRole('tab', { name: 'Shared capital', exact: true }).click();
    await page.getByLabel('Shared portfolio name').fill('Local integration bankroll');
    await page.getByLabel(spare.name, { exact: true }).check();
    await page.getByRole('button', { name: 'Create shared portfolio' }).click();
    await expect(page.getByRole('heading', { name: 'Local integration bankroll' })).toBeVisible();
    expect(records(source, 'portfolio')).toHaveLength(1);
    await capture('shared-capital');
    await page.getByRole('tab', { name: /Alert inbox/ }).click();
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await expect(page.getByText(/^Acknowledged /)).toBeVisible();
    expect(inbox(source)[0].acknowledgedAt).toBeTruthy();
    await page.getByRole('tab', { name: 'Backups', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export full workspace' }).click();
    const path = await (await downloaded).path();
    const backup = JSON.parse(await readFile(path!, 'utf8'));
    const expanded = unpackBackup(backup.server) as WorkspaceBackup;
    expect(expanded.tables.agent_replays).toHaveLength(1);
    const restored = await request.post(base + '/restore-target/restore', { data: backup.server });
    expect(restored.ok()).toBe(true);
    expect(target.list()).toHaveLength(2);
    expect(target.list().every((a) => a.runtime.status === 'paused')).toBe(true);
    expect(records(target, 'portfolio')).toHaveLength(1);
    expect(inbox(target)[0].acknowledgedAt).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    worker.shutdown();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    source.close();
    target.close();
  }
});
