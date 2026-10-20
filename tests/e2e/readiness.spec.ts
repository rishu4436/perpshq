import { test, expect } from '@playwright/test';
import { mocks, fillPlan, account, btc } from './fixtures';

test('changed calldata after user review never reaches the wallet', async ({ page }) => {
  await mocks(page);
  let previews = 0;
  await page.route('**/api/preview', async (route) => {
    previews++;
    await route.fulfill({
      json: {
        chainId: 50383,
        account,
        to: btc.poolAddress,
        data: previews === 1 ? '0x1234' : '0x5678',
        value: '0',
        gas: '1000000',
        expiresAt: Date.now() + 30000,
        market: btc.symbol,
        estimatedGasSTT: '0.001',
        rawPrice: '3000000000000000000000',
        rawQuantity: '70000',
      },
    });
  });
  await page.goto('/app#Trade%20Planner');
  await fillPlan(page);
  await page.getByRole('button', { name: 'Connect wallet to validate' }).click();
  await page.getByRole('button', { name: 'Validate on testnet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm testnet order' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirm & open wallet' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/parameters changed/i);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __walletCalls: string[] }).__walletCalls.filter(
        (v) => v === 'eth_sendTransaction',
      ),
    ),
  ).toHaveLength(0);
});

test('unknown submission survives reload and clears only on matching mined evidence', async ({
  page,
}) => {
  await mocks(page, false, 'unknown');
  await page.goto('/app#Trade%20Planner');
  await fillPlan(page);
  await page.getByRole('button', { name: 'Connect wallet to validate' }).click();
  await page.getByRole('button', { name: 'Validate on testnet', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Confirm testnet order' });
  await d.getByRole('checkbox').check();
  await d.getByRole('button', { name: 'Confirm & open wallet' }).click();
  await expect(d.getByRole('alert')).toContainText(/unknown/i);
  await page.goto('/app#Positions%20%26%20Risk');
  await expect(page.getByRole('heading', { name: 'Unresolved wallet request' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Recovery transaction hash' })
    .fill('0x' + 'a'.repeat(64));
  await page.getByRole('button', { name: 'Verify and reconcile' }).click();
  await expect(page.getByRole('heading', { name: 'Unresolved wallet request' })).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('perpshq.unresolvedSubmission')),
  ).toBeNull();
  await expect(page.getByText('resting', { exact: true })).toBeVisible();
});

test('cancellation revalidates the reviewed order before a mocked wallet call', async ({
  page,
}) => {
  await mocks(page);
  await page.route('**/api/account/*', (r) =>
    r.fulfill({
      json: {
        address: account,
        fetchedAt: Date.now(),
        quoteDecimals: 18,
        margin: null,
        positions: [],
        fills: [],
        changes: [],
        errors: [],
        orders: [
          {
            orderId: '1',
            pool: btc.id,
            owner: account,
            isBid: true,
            price: '3000000000000000000000',
            quantityRemaining: '100000',
            fullQuantity: '100000',
            status: 'Open',
          },
        ],
      },
    }),
  );
  let calls = 0;
  await page.route('**/api/cancel-preview', (r) => {
    calls++;
    return r.fulfill({
      json: {
        chainId: 50383,
        account,
        to: btc.id,
        data: '0x1234',
        value: '0',
        gas: '1000000',
        expiresAt: Date.now() + 30000,
        market: btc.symbol,
        orderId: '1',
      },
    });
  });
  await page.goto('/app#Positions%20%26%20Risk');
  await page
    .locator('.topbar')
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm cancellation' })).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm cancellation' })).toHaveCount(0);
  expect(calls).toBe(2);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __walletCalls: string[] }).__walletCalls.filter(
        (v) => v === 'eth_sendTransaction',
      ),
    ),
  ).toHaveLength(1);
});
