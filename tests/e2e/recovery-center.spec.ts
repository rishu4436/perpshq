import { test, expect } from '@playwright/test';
import { mocks, btc, nav } from './fixtures';
const id = '11111111-1111-4111-8111-111111111111',
  alertId = '22222222-2222-4222-8222-222222222222';
test.beforeEach(async ({ page }) => {
  await mocks(page);
  const alert = {
    id: alertId,
    key: 'test',
    at: Date.now(),
    severity: 'critical',
    title: 'Worker disconnected',
    detail: 'Restart the local worker and verify fresh observations.',
    delivery: 'local-inbox',
    acknowledgedAt: undefined as number | undefined,
  };
  await page.route('**/api/workspace**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/acknowledge')) {
      alert.acknowledgedAt = Date.now();
      return route.fulfill({ json: alert });
    }
    if (path.endsWith('/replays')) return route.fulfill({ json: [] });
    if (path.endsWith('/backup'))
      return route.fulfill({
        json: { format: 'perpshq-local-workspace', version: 1, tables: {}, checksum: 'test' },
      });
    if (path.endsWith('/portfolios'))
      return route.fulfill({ json: route.request().postDataJSON() });
    return route.fulfill({
      json: {
        recovery: {
          connected: false,
          worker: null,
          observedAt: Date.now(),
          agents: [
            {
              id,
              name: 'Trend research',
              status: 'paused',
              revision: 1,
              runId: 3,
              block: '100',
              lastEvaluationAt: Date.now(),
              dataAgeMs: 0,
              stopReason: 'RPC unavailable',
              failures: 1,
              failedChecks: [
                { name: 'Data freshness', passed: false, detail: 'Refresh observations' },
              ],
              unresolved: [],
              requirements: ['Verify fresh observations before resume.'],
            },
          ],
        },
        alerts: [alert],
        portfolios: [],
        archived: [],
        activities: [
          {
            id: 'event',
            account: '0x' + '1'.repeat(40),
            marketId: btc.id,
            at: Date.now(),
            state: 'unknown',
            detail: 'Wallet transport interrupted',
          },
        ],
        accounting: [],
      },
    });
  });
  await page.goto('/app');
  await nav(page, 'Recovery Center');
  await expect(page.getByRole('heading', { name: 'Clarity before the next move.' })).toBeVisible({
    timeout: 30000,
  });
});
test('shows actionable recovery state and responsive controls', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Clarity before the next move.' })).toBeVisible();
  await expect(page.getByText('RPC unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Run 3 · Revision 1', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('readiness explains missing account prerequisites', async ({ page }) => {
  await page.getByRole('tab', { name: 'Readiness', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trading readiness' })).toBeVisible();
  await expect(page.getByText('Eligible collateral', { exact: true })).toBeVisible();
  await expect(page.getByText('Complete exposure', { exact: true })).toBeVisible();
});
test('acknowledges a durable inbox alert', async ({ page }) => {
  await page.getByRole('tab', { name: /Alert inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Persistent alert inbox' })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(page.getByText(/^Acknowledged /)).toBeVisible();
});
test('downloads a complete backup with browser journal data', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('perpshq.journal', JSON.stringify([{ id: 'local-test' }])),
  );
  await page.getByRole('tab', { name: 'Backups', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full workspace' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/perpshq-workspace.*json/);
  await expect(page.getByText('Complete workspace backup downloaded.')).toBeVisible();
});
test('does not manufacture replay evidence for older decisions', async ({ page }) => {
  await page.getByRole('tab', { name: 'Decision replay', exact: true }).click();
  await expect(page.getByText(/No saved replay yet/)).toBeVisible();
});
test('creates shared capital using explicitly selected agents', async ({ page }) => {
  await page.getByRole('tab', { name: 'Shared capital', exact: true }).click();
  await page.getByLabel('Shared paper capital').fill('500');
  await page.getByLabel('Trend research', { exact: true }).check();
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/workspace/portfolios') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create shared portfolio' }).click();
  expect((await request).postDataJSON()).toMatchObject({ capital: '500', agentIds: [id] });
  await expect(page.getByText('Shared paper portfolio created.')).toBeVisible();
});
