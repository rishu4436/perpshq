import { test, expect } from '@playwright/test';
import { mocks, fillPlan, account, btc, eth, h, analysis } from './fixtures';

test('BTC and ETH alerts run without changing markets and do not repeat after reload', async ({
  page,
}) => {
  await mocks(page);
  await page.addInitScript(
    ({ btc, eth }) => {
      if (localStorage.getItem('perpshq.alertRules')) return;
      localStorage.setItem(
        'perpshq.alertRules',
        JSON.stringify(
          [btc, eth].map((m) => ({
            id: m.id,
            marketId: m.id,
            symbol: m.symbol,
            type: 'price-above',
            threshold: 1,
            enabled: true,
          })),
        ),
      );
    },
    { btc, eth },
  );
  const requested = new Set<string>();
  await page.route('**/api/markets/*', (route) => {
    const m = new URL(route.request().url()).pathname.endsWith(eth.id) ? eth : btc;
    requested.add(m.id);
    return route.fulfill({
      json: {
        market: { ...m, markPrice: 100, markUpdatedAt: Date.now() },
        candles: h.candles,
        quality: { ...h.quality, stale: false, fetchedAt: Date.now() },
        analysis,
        book: null,
        timeframes: {},
      },
    });
  });
  await page.goto('/app#Trade%20Journal');
  const history = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('perpshq.alertHistory') ?? '[]').length);
  await expect.poll(history, { timeout: 15000 }).toBe(2);
  expect([...requested]).toEqual(expect.arrayContaining([btc.id, eth.id]));
  await page.reload();
  await expect(page.locator('.app')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(history, { timeout: 15000 }).toBe(2);
});

test('margin alert reacts to account updates while selected market reads fail', async ({
  page,
}) => {
  await mocks(page);
  await page.addInitScript(
    ({ btc, account }) => {
      localStorage.setItem('perpshq.readAddress', JSON.stringify(account));
      localStorage.setItem(
        'perpshq.alertRules',
        JSON.stringify([
          {
            id: 'margin',
            marketId: btc.id,
            symbol: btc.symbol,
            type: 'margin-below',
            threshold: 100,
            enabled: true,
          },
        ]),
      );
    },
    { btc, account },
  );
  await page.route('**/api/markets/*', (r) =>
    r.fulfill({ status: 503, json: { error: 'TEST ONLY selected market unavailable' } }),
  );
  let equity = '1000000000000000000000';
  await page.route('**/api/account/*', (r) =>
    r.fulfill({
      json: {
        address: account,
        fetchedAt: Date.now(),
        quoteDecimals: 18,
        margin: {
          equity,
          mmReq: '0',
          unlockedCollateralBalance: equity,
          lockedCollateral: '0',
          imReq: '0',
          marginStatus: 'Healthy',
          asOfBlock: '1',
        },
        positions: [],
        orders: [],
        fills: [],
        changes: [],
        errors: [],
      },
    }),
  );
  await page.goto('/app#Trade%20Journal');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('perpshq.alertRules') ?? '[]')[0]?.status,
      ),
    )
    .toBe('ok');
  equity = '1000000000000000000';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('perpshq.alertHistory') ?? '[]').length),
    )
    .toBe(1);
});

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
  await page.reload();
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

test('planning references require clicks and original journal context survives refresh', async ({
  page,
}) => {
  await mocks(page);
  await page.route('**/api/markets/*', (r) =>
    r.fulfill({
      json: {
        market: { ...btc, markPrice: 100, markUpdatedAt: Date.now() },
        candles: h.candles,
        quality: { ...h.quality, count: 100, stale: false, fetchedAt: Date.now() },
        analysis: {
          ...analysis,
          zones: [
            {
              kind: 'support',
              low: 89,
              high: 90,
              lastSeen: Date.now() / 1000 - 900,
              touches: 3,
              strength: 1,
            },
            {
              kind: 'resistance',
              low: 110,
              high: 111,
              lastSeen: Date.now() / 1000 - 900,
              touches: 3,
              strength: 1,
            },
          ],
        },
        book: null,
        timeframes: {},
      },
    }),
  );
  await page.goto('/app#Trade%20Planner');
  const entry = page.getByRole('textbox', { name: 'Entry / reference price', exact: true });
  await expect(entry).toHaveValue('');
  await page.getByRole('button', { name: 'Use current mark as entry reference' }).click();
  await expect(entry).toHaveValue('100');
  await page.getByRole('button', { name: 'Use support as planning stop' }).click();
  await expect(page.getByRole('textbox', { name: 'Stop-loss level', exact: true })).toHaveValue(
    '89',
  );
  await page.getByRole('button', { name: 'Use resistance as planning target' }).click();
  await expect(page.getByRole('textbox', { name: 'Take-profit level', exact: true })).toHaveValue(
    '110',
  );
  await page.getByRole('button', { name: 'Short', exact: true }).click();
  await page.getByRole('button', { name: 'Use resistance as planning stop' }).click();
  await expect(page.getByRole('textbox', { name: 'Stop-loss level', exact: true })).toHaveValue(
    '111',
  );
  await page.getByRole('button', { name: 'Use support as planning target' }).click();
  await expect(page.getByRole('textbox', { name: 'Take-profit level', exact: true })).toHaveValue(
    '90',
  );
  await page.getByRole('button', { name: 'Import market context into journal' }).click();
  const captured = await page.evaluate(
    () => JSON.parse(localStorage.getItem('perpshq.journal')!)[0],
  );
  expect(captured.context.analysis.zones).toHaveLength(2);
  expect(captured.plan.references).toHaveLength(3);
  await page.reload();
  const restored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('perpshq.journal')!)[0],
  );
  expect(restored.context).toEqual(captured.context);
});

test('chart preserves canvas and user zoom through refresh and overlay changes', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Mouse wheel interaction is covered on desktop; mobile workflows run separately.',
  );
  await mocks(page);
  let updates = 0;
  await page.route('**/api/markets/*', (r) => {
    updates++;
    return r.fulfill({
      json: {
        market: { ...btc, markPrice: 100 + updates, markUpdatedAt: Date.now() },
        candles: h.candles.map((c, i) =>
          i === h.candles.length - 1 ? { ...c, volume: (c.volume ?? 0) + updates } : c,
        ),
        quality: { ...h.quality, stale: false, fetchedAt: Date.now() },
        analysis: { ...analysis, score: updates },
        book: null,
        timeframes: {},
      },
    });
  });
  await page.goto('/app#Market%20Intelligence');
  const chart = page.locator('.chart');
  await expect(chart.locator('canvas').first()).toBeVisible();
  const before = await chart.getAttribute('data-visible-range');
  await chart.hover();
  await page.mouse.wheel(0, -500);
  await expect.poll(() => chart.getAttribute('data-visible-range')).not.toBe(before);
  const zoom = await chart.getAttribute('data-visible-range');
  await chart
    .locator('canvas')
    .first()
    .evaluate((el) => el.setAttribute('data-original-canvas', 'yes'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.chart-price strong')).toHaveText('$102.00');
  await expect(chart.locator('canvas[data-original-canvas="yes"]')).toHaveCount(1);
  await expect(chart).toHaveAttribute('data-visible-range', zoom!);
  await page.getByRole('checkbox', { name: 'Bollinger', exact: true }).check();
  await expect(chart.locator('canvas[data-original-canvas="yes"]')).toHaveCount(1);
  await expect(chart).toHaveAttribute('data-visible-range', zoom!);
});
