import { test, expect } from '@playwright/test';
import { mocks, nav } from './fixtures';
test('malformed initial and subsequent hashes recover to Command Center', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mocks(page);
  await page.goto('/app#%');
  await expect(
    page.getByRole('heading', { name: 'A clearer view. A better next move.' }),
  ).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => (location.hash = '%E0%A4%A'));
  await expect(
    page.getByRole('heading', { name: 'A clearer view. A better next move.' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('damaged saved arrays render a recoverable workspace and preserve original data', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('perpshq.watchlist', '{}');
    localStorage.setItem('perpshq.journal', '[{"id":"broken"}]');
  });
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'A clearer view. A better next move.' }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Workspace storage recovery', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('perpshq.recovery.perpshq.watchlist')),
  ).toBe('{}');
  await nav(page, 'Trade Journal');
  await expect(page.getByText('Start with your reasoning', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
