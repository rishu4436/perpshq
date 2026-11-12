import { test, expect } from '@playwright/test';
import { mocks } from './fixtures';

test('protocol-gated claims stop before signing and explain the deposit alternative', async ({
  page,
}) => {
  await mocks(page);
  await page.route('**/api/collateral/preview', (route) =>
    route.fulfill({
      status: 422,
      json: {
        error:
          'Collateral claim simulation reverted. The deployed claim-policy gate rejects direct claims. No transaction was sent.',
      },
    }),
  );
  await page.goto('/testnet-collateral.html');
  await page.evaluate(() => window.ethereum!.request({ method: 'eth_requestAccounts' }));
  await page.getByRole('button', { name: 'Review collateral claim' }).click();
  await expect(page.locator('#message')).toContainText(
    'Direct claim unavailable under protocol policy',
  );
  await expect(page.getByRole('button', { name: 'Review collateral claim' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Request wallet approval' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review 15 USDso margin deposit' })).toBeEnabled();
  await expect(page.locator('#details')).toContainText('No claim transaction was sent');
  expect(
    await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls),
  ).not.toContain('eth_sendTransaction');
});
