import { test, expect } from '@playwright/test';
import { mocks, nav, fillPlan } from './fixtures';
test('discards a delayed preview after the reviewed form changes', async ({ page }) => {
  await mocks(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/preview', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/app#Trade%20Planner');
  await fillPlan(page);
  await page.getByRole('button', { name: 'Connect wallet to validate' }).click();
  const request = page.waitForRequest('**/api/preview');
  await page.getByRole('button', { name: 'Validate on testnet', exact: true }).click();
  await request;
  await page.getByRole('textbox', { name: 'Stop-loss level', exact: true }).fill('2800');
  release();
  await expect(
    page.getByText('Plan or wallet changed while validating. Validate the current plan again.'),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Confirm testnet order' })).toHaveCount(0);
});
test('connected discovery → scanner → cockpit → saved plan → journal', async ({ page }) => {
  await mocks(page);
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'A clearer view. A better next move.' }),
  ).toBeVisible();
  await nav(page, 'Opportunity Scanner');
  await page.getByPlaceholder('Search markets').fill('ETH');
  await expect(page.getByRole('button', { name: 'Analyze ETH-PERP' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze BTC-PERP' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze ETH-PERP' }).click();
  await expect(page.getByRole('heading', { name: 'ETH-PERP', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Bollinger', exact: true }).check();
  await page.getByRole('button', { name: 'Plan a trade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ETH-PERP', exact: true })).toBeVisible();
  await fillPlan(page);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  await page.getByRole('button', { name: 'Add to journal', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Trade thesis', exact: true })
    .fill('TEST ONLY: risk first, wait for confirmation.');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Trade thesis', exact: true })).toHaveValue(
    'TEST ONLY: risk first, wait for confirmation.',
  );
});
test('wallet confirmation is required; mocked receipt remains resting', async ({ page }) => {
  await mocks(page);
  await page.goto('/app#Trade%20Planner');
  await fillPlan(page);
  await page.getByRole('button', { name: 'Connect wallet to validate' }).click();
  await page.getByRole('button', { name: 'Validate on testnet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm testnet order' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm & open wallet' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirm & open wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Verified transaction evidence' })).toBeVisible();
  await expect(page.locator('.evidence-panel')).toContainText('resting');
  await expect(page.locator('.evidence-panel')).toContainText('MOCK-TEST-ORDER');
});
test('wrong chain blocks validation and invalid stops block saving', async ({ page }) => {
  await mocks(page, true);
  await page.goto('/app#Trade%20Planner');
  await fillPlan(page);
  await page.getByRole('textbox', { name: 'Stop-loss level', exact: true }).fill('3100');
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
  await expect(
    page.getByText('Stop must be below a long entry or above a short entry'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet to validate' }).click();
  await expect(page.getByRole('button', { name: 'Validate on testnet', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Switch to Hideki', exact: true }).last(),
  ).toBeVisible();
});
test('every navigation destination renders and mobile has no page overflow', async ({ page }) => {
  await mocks(page);
  await page.goto('/app');
  for (const name of [
    'Opportunity Scanner',
    'Market Intelligence',
    'Trade Planner',
    'Positions & Risk',
    'Portfolio Analytics',
    'Trade Journal',
    'Recovery Center',
    'Arena Companion',
    'Settings & Help',
  ]) {
    await nav(page, name);
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
    const size = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(size.content).toBeLessThanOrEqual(size.width + 1);
  }
  await nav(page, 'Command Center');
});
test('watchlist and alert rules persist through reload', async ({ page }) => {
  await mocks(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Watch BTC-PERP', exact: true }).click();
  await page.getByRole('button', { name: /Watchlist 1/ }).click();
  await expect(page.getByRole('button', { name: 'Analyze ETH-PERP' })).toHaveCount(0);
  await nav(page, 'Positions & Risk');
  await page.getByRole('spinbutton', { name: 'Alert threshold' }).fill('99999');
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.reload();
  await expect(page.getByText('BTC-PERP · price above 99999')).toBeVisible();
});
test('API transport failures have specific user-visible states', async ({ page }) => {
  await page.route('**/api/**', (r) =>
    r.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'TEST FIXTURE: Hideki indexer unreachable' }),
    }),
  );
  await page.goto('/app');
  await expect(page.getByRole('alert')).toContainText('Hideki indexer unreachable');
});
test('user rejection releases the submission lock without inventing a transaction', async ({
  page,
}) => {
  await mocks(page, false, 'rejected');
  await page.goto('/app#Trade%20Planner');
  await fillPlan(page);
  await page.getByRole('button', { name: 'Connect wallet to validate' }).click();
  await page.getByRole('button', { name: 'Validate on testnet', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Confirm testnet order' });
  await d.getByRole('checkbox').check();
  await d.getByRole('button', { name: 'Confirm & open wallet' }).click();
  await expect(page.getByRole('alert').first()).toContainText('rejected');
  await expect(page.getByRole('heading', { name: 'Verified transaction evidence' })).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('perpshq.unresolvedSubmission')),
  ).toBeNull();
});
test('unknown wallet response locks retries until receipt recovery', async ({ page }) => {
  await mocks(page, false, 'unknown');
  await page.goto('/app#Trade%20Planner');
  await fillPlan(page);
  await page.getByRole('button', { name: 'Connect wallet to validate' }).click();
  await page.getByRole('button', { name: 'Validate on testnet', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Confirm testnet order' });
  await d.getByRole('checkbox').check();
  await d.getByRole('button', { name: 'Confirm & open wallet' }).click();
  await expect(page.getByRole('alert').first()).toContainText('transport lost');
  expect(
    await page.evaluate(() => localStorage.getItem('perpshq.unresolvedSubmission')),
  ).not.toBeNull();
  await d.getByRole('button', { name: 'Close order confirmation' }).click();
  await expect(
    page.getByRole('button', { name: 'Validate on testnet', exact: true }),
  ).toBeDisabled();
  await nav(page, 'Positions & Risk');
  await expect(page.getByRole('heading', { name: 'Unresolved wallet request' })).toBeVisible();
});
