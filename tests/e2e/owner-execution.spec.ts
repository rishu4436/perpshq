import { test, expect } from '@playwright/test';
import { mocks, account, btc, nav } from './fixtures';
import { defaultAgentConfig } from '../../packages/agent-engine/config';

test('a lost durable-registration response preserves recovery and never dispatches a wallet transaction', async ({
  page,
}) => {
  await mocks(page);
  const config = defaultAgentConfig(btc.id, crypto.randomUUID());
  config.ownerAddress = account;
  config.mode = 'ASSISTED';
  config.execution.signer = 'owner-wallet';
  const id = crypto.randomUUID();
  await page.route('**/api/owner-strategy/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/begin'))
      return route.fulfill({
        status: 503,
        json: { error: 'TEST FIXTURE: registration response lost' },
      });
    await route.fulfill({
      json: path.endsWith('/defaults')
        ? config
        : {
            id,
            config,
            decision: { type: 'ENTRY_CANDIDATE', proposal: { side: 'long', quantity: '0.00013' } },
            preview: {
              chainId: 50383,
              account,
              to: btc.id,
              data: '0x1234',
              value: '0',
              gas: '100000',
              expiresAt: Date.now() + 30000,
              market: 'TEST FIXTURE BTC',
              estimatedGasSTT: '0.001',
            },
          },
    });
  });
  await page.goto('/app#Agent%20Studio');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Load owner strategy configuration' }).click();
  await page.getByRole('button', { name: 'Review live owner strategy' }).click();
  await page.getByRole('checkbox', { name: /I approve this exact strategy transaction/ }).check();
  await page.getByRole('button', { name: 'Confirm strategy & open wallet' }).click();
  await expect(
    page.getByRole('region', { name: 'Connected wallet strategy execution' }).getByRole('alert'),
  ).toContainText('registration response lost');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('perpshq.ownerStrategyIntent')!).ticketId,
    ),
  ).toBe(id);
  expect(
    await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls),
  ).not.toContain('eth_sendTransaction');
});

test('a live no-action owner decision never opens the wallet', async ({ page }) => {
  await mocks(page);
  const config = defaultAgentConfig(btc.id, crypto.randomUUID());
  config.ownerAddress = account;
  config.mode = 'ASSISTED';
  config.execution.signer = 'owner-wallet';
  await page.route('**/api/owner-strategy/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith('/defaults')
        ? config
        : {
            decision: {
              type: 'NO_ACTION',
              rationale: 'TEST FIXTURE: real strategy conditions not met.',
              failed: ['Confirmed completed-candle breakout', 'Observed volume confirmation'],
            },
          },
    });
  });
  await page.goto('/app#Agent%20Studio');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Load owner strategy configuration' }).click();
  await page.getByRole('button', { name: 'Review live owner strategy' }).click();
  await expect(page.getByRole('heading', { name: 'NO ACTION', exact: true })).toBeVisible();
  const blockers = page.getByRole('note', { name: 'Conditions preventing execution' });
  await expect(blockers).toContainText('Confirmed completed-candle breakout');
  await expect(blockers).toContainText('Observed volume confirmation');
  await expect(page.getByRole('button', { name: 'Confirm strategy & open wallet' })).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls),
  ).not.toContain('eth_sendTransaction');
});

test('a damaged owner intent keeps the app usable and blocks another wallet request', async ({
  page,
}) => {
  await mocks(page);
  await page.addInitScript(() => localStorage.setItem('perpshq.ownerStrategyIntent', '{damaged'));
  await page.goto('/app');
  await nav(page, 'Agent Studio');
  await expect(
    page.getByRole('heading', { name: 'Execute a strategy with your wallet' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reconcile strategy transaction' }).click();
  await expect(
    page.getByRole('region', { name: 'Connected wallet strategy execution' }).getByRole('alert'),
  ).toContainText('Saved strategy request is damaged');
  expect(await page.evaluate(() => localStorage.getItem('perpshq.ownerStrategyIntent'))).toBe(
    '{damaged',
  );
});
