import { test, expect } from '@playwright/test';
import { mocks, nav, account, btc, eth, fakeHash, fillPlan } from './fixtures';
import { h, analysis } from './fixtures';
test('BTC price sources and timestamps are visible when the oracle differs from settlement', async ({
  page,
}) => {
  await mocks(page);
  await page.route('**/api/markets/' + btc.id + '?**', (r) =>
    r.fulfill({
      json: {
        market: {
          ...btc,
          markSource: 'oracle',
          markPrice: 73212.13,
          indexedMarkPrice: 74486.63,
          indexedMarkUpdatedAt: 1700000000000,
          markUpdatedAt: 1700000300000,
        },
        candles: h.candles,
        quality: h.quality,
        analysis,
        book: null,
        timeframes: {},
      },
    }),
  );
  await page.goto('/app#Market%20Intelligence');
  const sources = page.getByRole('region', { name: 'Market price sources' });
  await expect(sources).toContainText('Oracle mark: $73,212.13');
  await expect(sources).toContainText('Indexed settlement snapshot: $74,486.63');
  await expect(sources).toContainText('occur at different times');
});
test('Planner states the verified numerical leverage limit', async ({ page }) => {
  await mocks(page);
  await page.goto('/app');
  await nav(page, 'Trade Planner');
  await fillPlan(page);
  await page.getByRole('textbox', { name: 'Planning leverage', exact: true }).fill('100');
  await expect(page.getByText(/Requested planning leverage exceeds/)).toContainText(
    `${btc.maxLeverage}×`,
  );
});

test('row watchlist actions are state-aware on Command Center and Scanner', async ({ page }) => {
  await mocks(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Add ETH-PERP to watchlist', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove ETH-PERP from watchlist', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await nav(page, 'Opportunity Scanner');
  await page.getByRole('button', { name: 'Remove ETH-PERP from watchlist', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add ETH-PERP to watchlist', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});
test('journal deletion requires confirmation and cancellation preserves the entry', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/app');
  await nav(page, 'Trade Journal');
  await page.getByRole('button', { name: 'New entry', exact: true }).click();
  await page.getByLabel('Trade thesis', { exact: true }).fill('Keep my recorded context');
  await page.getByRole('button', { name: /Delete journal entry for/ }).click();
  await expect(page.getByRole('alertdialog', { name: 'Confirm journal deletion' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep entry', exact: true }).click();
  await expect(page.getByLabel('Trade thesis', { exact: true })).toHaveValue(
    'Keep my recorded context',
  );
  await page.getByRole('button', { name: /Delete journal entry for/ }).click();
  await page.getByRole('button', { name: 'Confirm delete entry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start with your reasoning' })).toBeVisible();
});
test('Planner market picker keeps separate drafts and discards the previous market approval', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await nav(page, 'Trade Planner');
  await page.getByLabel('Trade Planner market', { exact: true }).selectOption(btc.id);
  await fillPlan(page);
  await page.getByRole('button', { name: 'Validate on testnet', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm & open wallet', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Trade Planner market', { exact: true }).selectOption(eth.id);
  await expect(
    page.getByRole('button', { name: 'Confirm & open wallet', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Entry / reference price', exact: true }).fill('2000');
  await page.getByLabel('Trade Planner market', { exact: true }).selectOption(btc.id);
  await expect(
    page.getByRole('textbox', { name: 'Entry / reference price', exact: true }),
  ).toHaveValue('3000');
});
test('comma-separated journal tags survive incremental typing, persistence and export data', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/app');
  await nav(page, 'Trade Journal');
  await page.getByRole('button', { name: 'New entry', exact: true }).click();
  await page.getByLabel('Journal tags').pressSequentially('qa, test, x');
  await expect(page.getByLabel('Journal tags')).toHaveValue('qa, test, x');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('perpshq.journal')!)[0].tags),
  ).toEqual(['qa', 'test', 'x']);
  await page.reload();
  await expect(page.getByLabel('Journal tags')).toHaveValue('qa, test, x');
});
test('invalid read address stays inline and never contaminates other screens', async ({ page }) => {
  await mocks(page);
  await page.goto('/app');
  await nav(page, 'Settings & Help');
  const field = page.getByLabel('Read-only account address');
  await field.fill('0x123');
  await page.getByRole('button', { name: 'Save read address' }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#read-address-error')).toContainText('complete');
  await nav(page, 'Command Center');
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a complete' })).toHaveCount(0);
});
test('watchlist toggle and chart controls have meaningful accessible names; scanner has an empty state', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Add selected market to watchlist', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove selected market from watchlist', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh chart', exact: true })).toBeVisible();
  await nav(page, 'Opportunity Scanner');
  await page.getByPlaceholder('Search markets').fill('NO_SUCH_MARKET');
  await expect(page.getByRole('heading', { name: 'No markets match' })).toBeVisible();
});
test('hosted activity stays in browser and receipt lookup rejects an unrelated account', async ({
  page,
}) => {
  await mocks(page);
  let forbidden = 0;
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { publicHosted: true } }));
  await page.route('**/api/workspace/activity', (r) => {
    forbidden++;
    return r.fulfill({ status: 403, json: { error: 'LOCAL ONLY' } });
  });
  await page.addInitScript(
    ({ account, btc }) =>
      localStorage.setItem(
        'perpshq.activityOutbox',
        JSON.stringify([
          {
            id: crypto.randomUUID(),
            flowId: crypto.randomUUID(),
            account,
            marketId: btc.id,
            at: Date.now(),
            state: 'draft',
            detail: 'AUTOMATED TEST FIXTURE',
          },
        ]),
      ),
    { account, btc },
  );
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await nav(page, 'Recovery Center');
  await page.getByLabel('Hideki receipt transaction hash').fill(fakeHash);
  await page.getByRole('button', { name: 'Verify transaction hash', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Verified resting');
  await page.route('**/api/receipt/**', (r) =>
    r.fulfill({
      json: {
        hash: fakeHash,
        network: 50383,
        account: '0x' + '2'.repeat(40),
        pool: btc.id,
        state: 'filled',
      },
    }),
  );
  await page.getByRole('button', { name: 'Verify transaction hash', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('does not match');
  expect(forbidden).toBe(0);
  await expect(
    page.getByRole('link', { name: 'Fund testnet collateral / review margin deposit' }),
  ).toHaveAttribute('href', '/testnet-collateral.html');
});
