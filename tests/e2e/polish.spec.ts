import { test, expect } from '@playwright/test';
import { expectLiveRankedMarkets } from './fixtures';
import probe from '../../docs/probe-results.json' with { type: 'json' };
import { normalizeMarket } from '../../packages/dreamdex-adapter';
import type { PerpMarket } from '@somnia-chain/markets-sdk';

test('workflow navigation and keyboard access preserve the current screen', async ({
  page,
}, info) => {
  const markets = probe.markets.data.map((m) => normalizeMarket(m as PerpMarket));
  await page.route('**/api/**', (r) =>
    new URL(r.request().url()).pathname === '/api/markets'
      ? r.fulfill({ json: { markets, fetchedAt: Date.now() } })
      : r.fulfill({ status: 503, json: { error: 'Automated test: source unavailable' } }),
  );
  await page.goto('/app');
  const workflow = page.getByRole('navigation', { name: 'Workspace workflow' });
  await workflow.getByRole('button', { name: '03 Plan' }).click();
  await expect(page.getByRole('heading', { name: 'Trade Planner', exact: true })).toBeVisible();
  await expect(page.getByText('DRAFT PLAN', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
  await expect(page.getByText(/\[DecimalError\]/)).toHaveCount(0);
  const before = page.url();
  const skip = page.getByRole('link', { name: 'Skip to workspace' });
  await expect(skip).toHaveCSS('clip-path', 'inset(50%)');
  await skip.focus();
  await expect(skip).toHaveCSS('clip-path', 'none');
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-content')).toBeFocused();
  expect(page.url()).toBe(before);
  if (info.project.name === 'mobile') {
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Main workspace' })).not.toBeVisible();
  }
  await workflow.getByRole('button', { name: '05 Review' }).click();
  await expect(page.getByRole('heading', { name: 'Trade Journal', exact: true })).toBeVisible();
});

test('review every live app screen and save responsive visual evidence', async ({ page }, info) => {
  test.skip(
    process.env.LIVE_TESTS !== '1',
    'Optional real-data visual review. Never connects or signs.',
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'BTC-PERP', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('img', { name: /Interactive dreamDEX/ })).toBeVisible({
    timeout: 30000,
  });
  await page.evaluate(() => document.fonts.ready);
  const screens = [
    'Command Center',
    'Opportunity Scanner',
    'Market Intelligence',
    'Trade Planner',
    'Positions & Risk',
    'Portfolio Analytics',
    'Trade Journal',
    'Arena Companion',
    'Settings & Help',
  ];
  for (const [index, name] of screens.entries()) {
    if (index) {
      const menu = page.getByRole('button', { name: 'Open navigation' });
      if (await menu.isVisible()) await menu.click();
      await page
        .locator('.sidebar')
        .getByRole('button', { name: new RegExp('^' + name.replace('&', '\\&')) })
        .click();
      await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
    }
    await expect(page.locator('.skeletons')).toHaveCount(0, { timeout: 30000 });
    if (name === 'Command Center') await expectLiveRankedMarkets(page);
    if (name === 'Opportunity Scanner')
      await expect(page.getByRole('button', { name: 'Analyze BTC-PERP', exact: true })).toBeVisible(
        { timeout: 30000 },
      );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const slug = name.toLowerCase().replaceAll(/[^a-z]+/g, '-');
    await page.screenshot({
      path: 'docs/screenshots/workspace-' + slug + '-' + info.project.name + '.png',
      fullPage: false,
      scale: 'css',
      animations: 'disabled',
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      name + ' must fit the viewport',
    ).toBe(true);
  }
  // The populated journal is a local writing action; it does not touch a wallet.
  await page
    .getByRole('navigation', { name: 'Workspace workflow' })
    .getByRole('button', { name: '05 Review' })
    .click();
  await page.getByRole('button', { name: 'New entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Trade thesis', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/workspace-journal-editor-' + info.project.name + '.png',
    scale: 'css',
    animations: 'disabled',
  });
  if (info.project.name === 'desktop') {
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const name of screens) {
        const menu = page.getByRole('button', { name: 'Open navigation' });
        if (await menu.isVisible()) await menu.click();
        await page
          .locator('.sidebar')
          .getByRole('button', { name: new RegExp('^' + name.replace('&', '\\&')) })
          .click();
        await expect(page.locator('.page-header h1')).toBeVisible();
        expect
          .soft(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            name + ' at ' + width + 'px',
          )
          .toBe(true);
      }
    }
  }
  expect(errors).toEqual([]);
});
