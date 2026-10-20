import { test, expect, type Page } from '@playwright/test';
import probe from '../../docs/probe-results.json' with { type: 'json' };
import { normalizeMarket } from '../../packages/dreamdex-adapter';
import type { PerpMarket } from '@somnia-chain/markets-sdk';

const markets = probe.markets.data.map((m) => normalizeMarket(m as PerpMarket));
async function mockDiscovery(page: Page) {
  await page.route('**/api/markets', (r) =>
    r.fulfill({ json: { markets, fetchedAt: Date.now() } }),
  );
  await page.route('**/api/markets/*', (r) =>
    r.fulfill({ status: 503, json: { error: 'Test: history unavailable' } }),
  );
}

test('homepage preview, workflow keyboard controls and FAQ work without a wallet', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockDiscovery(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Your next move.In sharper focus.',
  );
  await expect(page.getByRole('link', { name: 'Enter the workspace' })).toHaveAttribute(
    'href',
    '/app#Command%20Center',
  );
  const preview = page.locator('.lp-product-frame');
  await preview.scrollIntoViewIfNeeded();
  await expect(
    preview.getByRole('link', { name: 'Open selected preview in workspace' }),
  ).toHaveAttribute('href', /market=0x/, { timeout: 15000 });
  await preview
    .getByRole('button', { name: 'Discover', exact: true })
    .filter({ visible: true })
    .click();
  await expect(preview.getByText('Indexed settlement marks')).toBeVisible();
  await expect(preview.getByText(markets[0].symbol, { exact: true })).toBeVisible();
  await preview
    .getByRole('button', { name: 'Plan', exact: true })
    .filter({ visible: true })
    .click();
  await expect(preview.getByRole('link', { name: 'Build a trade plan' })).toHaveAttribute(
    'href',
    /\/app\?market=0x.+#Trade%20Planner/,
  );
  await preview
    .getByRole('button', { name: 'Intelligence', exact: true })
    .filter({ visible: true })
    .click();
  await expect(preview.getByText('Verified history is temporarily unavailable.')).toBeVisible();
  const plan = page.getByRole('tab', { name: /03 Plan/ });
  await plan.click();
  await expect(page.getByRole('tabpanel')).toContainText('Give every decision a framework.');
  await plan.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /04 Execute/ })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Make the call. Keep control.');
  const question = page.getByRole('button', { name: 'Can I execute trades from PerpsHQ?' });
  await question.click();
  await expect(question).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByText(/Signed end-to-end execution still awaits verification/),
  ).toBeVisible();
  await question.click();
  await expect(question).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});

test('navigation reaches the workspace and mobile menu closes on Escape', async ({
  page,
}, info) => {
  await mockDiscovery(page);
  await page.goto('/');
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Website navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Platform', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'Enter the workspace' }).click();
  await expect(page).toHaveURL(/\/app#Command%20Center$/);
  await expect(page.getByRole('link', { name: 'Website', exact: true })).toBeVisible({
    timeout: 20000,
  });
});

test('planner preview hands the selected market to the app', async ({ page }) => {
  await mockDiscovery(page);
  await page.goto('/');
  const preview = page.locator('.lp-product-frame');
  await preview.scrollIntoViewIfNeeded();
  await expect(
    preview.getByRole('link', { name: 'Open selected preview in workspace' }),
  ).toHaveAttribute('href', /market=0x/);
  await preview
    .getByRole('button', { name: 'Plan', exact: true })
    .filter({ visible: true })
    .click();
  await preview.getByRole('link', { name: 'Build a trade plan' }).click();
  await expect(page.getByRole('heading', { name: 'Trade Planner', exact: true })).toBeVisible({
    timeout: 15000,
  });
  const btc = markets.find((m) => m.baseSymbol === 'BTC')!;
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('perpshq.market') ?? 'null')),
  ).toBe(btc.id);
});

test('capture the actual live landing page', async ({ page }, info) => {
  test.skip(process.env.LIVE_TESTS !== '1', 'Optional live visual check; read-only.');
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(
    page.locator('.lp-preview-chart').getByRole('img', { name: /Interactive dreamDEX/ }),
  ).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `docs/screenshots/landing-${info.project.name}.png`,
    fullPage: true,
    scale: 'css',
    animations: 'disabled',
  });
  await page.screenshot({
    path: `docs/screenshots/landing-hero-${info.project.name}.png`,
    scale: 'css',
    animations: 'disabled',
  });
  await page.locator('.lp-final-cta').screenshot({
    path: `docs/screenshots/landing-cta-${info.project.name}.png`,
    scale: 'css',
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
