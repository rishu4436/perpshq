import { test, expect } from '@playwright/test';
import { mocks, nav } from './fixtures';

test('public hosting shows strategy evidence without exposing shared worker controls', async ({
  page,
}) => {
  await mocks(page);
  await page.route('**/api/agents', (route) =>
    route.fulfill({
      json: {
        publicHosted: true,
        agents: [],
        worker: null,
        connected: false,
        broadcastEnabled: false,
      },
    }),
  );
  await page.goto('/app#Agent%20Studio');
  await expect(
    page.getByRole('heading', { name: 'Four strategies. Visible reasoning.' }),
  ).toBeVisible();
  await expect(page.getByText('Verified testnet entry', { exact: true })).toBeVisible();
  await expect(page.getByText('Live entry not yet verified', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Load owner strategy configuration' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Create agent', exact: true })).toHaveCount(0);
});

test('public recovery exports browser records without a shared server backup', async ({ page }) => {
  await mocks(page);
  await page.route('**/api/workspace', (route) => route.fulfill({ json: { publicHosted: true } }));
  await page.goto('/app');
  await nav(page, 'Recovery Center');
  await expect(page.getByRole('heading', { name: 'Your wallet. Your workspace.' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export browser backup' }).click();
  expect((await download).suggestedFilename()).toBe('perpshq-browser-backup.json');
  await expect(page.getByRole('tab', { name: 'Shared capital' })).toHaveCount(0);
});
