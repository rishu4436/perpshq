import { test, expect, type Page } from '@playwright/test';
import probe from '../../docs/probe-results.json' with { type: 'json' };
import { normalizeCandles } from '../../packages/market-data';
import { analyze } from '../../packages/opportunity-scoring';
import { normalizeMarket } from '../../packages/dreamdex-adapter';
import type { PerpMarket } from '@somnia-chain/markets-sdk';
const ms = probe.markets.data.map((m) => normalizeMarket(m as PerpMarket));
const btc = ms.find((m) => m.baseSymbol === 'BTC')!,
  eth = ms.find((m) => m.baseSymbol === 'ETH')!;
const now = new Date(probe.checkedAt).getTime();
const h = normalizeCandles(
  probe.candles900.data.map((c) => ({
    market: btc.id,
    time: Number(c.bucketStart),
    open: Number(c.openPrice) / 1e18,
    high: Number(c.high) / 1e18,
    low: Number(c.low) / 1e18,
    close: Number(c.closePrice) / 1e18,
    volume: Number(c.baseVolume) / 1e8,
    timeframe: '15m' as const,
    source: 'CAPTURED LIVE DATA — AUTOMATED TEST FIXTURE',
    fetchedAt: now,
    complete: Number(c.bucketStart) + 900 <= now / 1000,
  })),
  '15m',
  now,
);
const analysis = analyze(h.candles, false);
const account = '0x1111111111111111111111111111111111111111',
  fakeHash = '0x' + 'a'.repeat(64);
async function mocks(page: Page, wrongChain = false, outcome = 'success') {
  await page.addInitScript(
    ({ account, wrongChain, outcome }) => {
      const calls: string[] = [];
      let connected = false;
      (window as unknown as { ethereum: unknown }).ethereum = {
        request: async ({ method }: { method: string }) => {
          calls.push(method);
          if (method === 'eth_accounts') return connected ? [account] : [];
          if (method === 'eth_requestAccounts') {
            connected = true;
            return [account];
          }
          if (method === 'eth_chainId') return wrongChain ? '0x1' : '0xc4cf';
          if (method === 'eth_sendTransaction') {
            if (outcome === 'rejected')
              throw { code: 4001, message: 'User rejected signature (AUTOMATED TEST)' };
            if (outcome === 'unknown')
              throw new Error('Wallet transport lost after request (AUTOMATED TEST)');
            return '0x' + 'a'.repeat(64);
          }
          return null;
        },
        on() {},
        removeListener() {},
      };
    },
    { account, wrongChain, outcome },
  );
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    let data: unknown = {};
    let status = 200;
    if (u.pathname === '/api/markets') data = { markets: [btc, eth], fetchedAt: now };
    else if (u.pathname === '/api/scanner')
      data = {
        rows: [btc, eth].map((m) => ({ market: m, analysis, quality: h.quality })),
        fetchedAt: now,
      };
    else if (u.pathname.endsWith('/funding'))
      data = {
        source: 'AUTOMATED TEST FIXTURE',
        nextDueAt: now + 3600000,
        settlementInterval: 3600,
        calculationWindow: 28800,
        openInterest: 1,
        history: [],
      };
    else if (u.pathname.startsWith('/api/markets/')) {
      const m = u.pathname.endsWith(eth.id) ? eth : btc;
      data = {
        market: m,
        candles: h.candles,
        quality: h.quality,
        analysis,
        book: null,
        timeframes: {
          '15m': {
            trend: analysis.trend,
            rsi: analysis.values.rsi,
            macd: analysis.values.macdHistogram,
            count: h.candles.length,
          },
        },
      };
    } else if (u.pathname.startsWith('/api/account/'))
      data = {
        address: account,
        fetchedAt: now,
        quoteDecimals: 18,
        margin: {
          equity: '1000000000000000000000',
          unlockedCollateralBalance: '1000000000000000000000',
          lockedCollateral: '0',
          imReq: '0',
          mmReq: '0',
          marginStatus: 'Healthy',
          asOfBlock: '100',
        },
        positions: [],
        orders: [],
        fills: [],
        changes: [],
        gas: '1000000000000000000',
        errors: [],
      };
    else if (u.pathname === '/api/preview') {
      const req = route.request().postDataJSON();
      data = {
        chainId: 50383,
        account,
        to: req.input.marketId,
        data: '0x1234',
        value: '0',
        gas: '1000000',
        expiresAt: Date.now() + 30000,
        market: 'BTC-PERP',
        estimatedGasSTT: '0.001',
        rawPrice: '3000000000000000000000',
        rawQuantity: '70000',
      };
    } else if (u.pathname.startsWith('/api/receipt/'))
      data = {
        hash: fakeHash,
        network: 50383,
        market: 'BTC-PERP',
        pool: btc.poolAddress,
        account,
        state: 'resting',
        checkedAt: Date.now(),
        orderId: 'MOCK-TEST-ORDER',
        receipt: { status: 'success', blockNumber: '100', gasUsed: '100' },
        events: [],
      };
    else if (u.pathname === '/api/diagnostics')
      data = {
        checkedAt: now,
        endpoints: [{ name: 'Test fixture transport', ok: true, data: 'MOCKED FOR AUTOMATED CI' }],
        database: { snapshots: { count: 0 } },
      };
    else {
      status = 404;
      data = { error: 'Unmocked test route' };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
}
async function nav(page: Page, name: string) {
  await expect(page.locator('.app .topbar')).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('button', { name: new RegExp('^' + name.replace('&', '\\&')) })
    .first()
    .click();
}
async function fillPlan(page: Page) {
  for (const [label, value] of [
    ['Entry / reference price', '3000'],
    ['Stop-loss level', '2900'],
    ['Take-profit level', '3200'],
    ['Maximum loss budget (USDso)', '10'],
    ['Available collateral (USDso)', '100'],
    ['Planning leverage', '5'],
    ['Slippage allowance (bps)', '10'],
  ])
    await page.getByRole('textbox', { name: label, exact: true }).fill(value);
}
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
