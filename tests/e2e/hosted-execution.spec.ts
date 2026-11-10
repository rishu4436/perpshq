import { test, expect, type Page } from '@playwright/test';
import { mocks, account, btc, fakeHash } from './fixtures';
import { defaultAgentConfig, type AgentConfig } from '../../packages/agent-engine';
import { createSiweMessage } from 'viem/siwe';
async function hostedMocks(page: Page, execute = false) {
  await mocks(page);
  let authenticated = false;
  const saved: AgentConfig[] = [],
    strategies: string[] = [];
  let ticket = crypto.randomUUID(),
    state = 'reviewed';
  await page.addInitScript(() => {
    const p = window.ethereum!;
    window.ethereum = {
      ...p,
      request: async (args) => {
        if (args.method === 'personal_sign') {
          (window as unknown as { __walletCalls: string[] }).__walletCalls.push('personal_sign');
          return '0x' + 'a'.repeat(130);
        }
        return p.request(args);
      },
    };
  });
  await page.route('**/api/agents', (r) =>
    r.fulfill({
      json: { publicHosted: true, hostedExecution: true, agents: [], connected: false },
    }),
  );
  await page.route('**/api/owner-strategy/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session'))
      return route.fulfill({ json: { owner: authenticated ? account : null } });
    if (path.endsWith('/auth/challenge')) {
      const id = crypto.randomUUID(),
        origin = new URL(route.request().url()).origin;
      return route.fulfill({
        json: {
          id,
          message: createSiweMessage({
            address: account,
            chainId: 50383,
            domain: new URL(origin).host,
            uri: origin,
            version: '1',
            nonce: 'AUTOMATEDTESTNONCE1234',
            requestId: id,
            issuedAt: new Date(),
            expirationTime: new Date(Date.now() + 300000),
            statement: 'Sign in to PerpsHQ Agent Studio. This does not authorize transactions.',
          }),
        },
      });
    }
    if (path.endsWith('/auth/verify')) {
      authenticated = true;
      return route.fulfill({ json: { owner: account } });
    }
    if (path.endsWith('/configs')) {
      if (route.request().method() === 'POST') {
        const c = route.request().postDataJSON().config as AgentConfig;
        saved.push(c);
        return route.fulfill({ json: { config: c } });
      }
      return route.fulfill({ json: { configs: saved, decisions: [], unresolved: [] } });
    }
    if (path.endsWith('/defaults')) {
      const c = defaultAgentConfig(btc.id, crypto.randomUUID());
      c.ownerAddress = account;
      c.mode = 'ASSISTED';
      c.execution.signer = 'owner-wallet';
      return route.fulfill({ json: c });
    }
    if (path.endsWith('/review')) {
      const c = route.request().postDataJSON().config as AgentConfig;
      strategies.push(c.strategy);
      state = 'reviewed';
      if (!execute)
        return route.fulfill({
          json: {
            config: c,
            decision: {
              id: crypto.randomUUID(),
              strategy: c.strategy,
              type: 'NO_ACTION',
              evaluatedAt: Date.now(),
              rationale: 'AUTOMATED TEST FIXTURE: no qualifying signal',
              failed: ['TEST FIXTURE signal condition'],
            },
          },
        });
      const guardian = c.strategy === 'risk-guardian';
      return route.fulfill({
        json: {
          id: ticket,
          config: c,
          decision: {
            id: crypto.randomUUID(),
            strategy: c.strategy,
            type: guardian ? 'CANCEL_CANDIDATE' : 'ENTRY_CANDIDATE',
            evaluatedAt: Date.now(),
            rationale: 'AUTOMATED TEST FIXTURE: prepared proposal',
            proposal: guardian ? undefined : { side: 'long', quantity: '0.00013' },
          },
          preview: {
            account,
            chainId: 50383,
            to: btc.id,
            data: '0x1234',
            value: '0',
            gas: '100000',
            expiresAt: Date.now() + 60000,
            market: 'TEST FIXTURE BTC',
            estimatedGasSTT: '.001',
          },
        },
      });
    }
    if (path.endsWith('/begin')) {
      state = 'unknown';
      return route.fulfill({ json: { registered: true } });
    }
    if (path.includes('/status/'))
      return route.fulfill({ json: { state, hash: null, account, to: btc.id, data: '0x1234' } });
    if (path.endsWith('/receipt')) {
      state = 'confirmed';
      ticket = crypto.randomUUID();
      return route.fulfill({
        json: {
          strategyVerified: true,
          evidence: {
            hash: fakeHash,
            network: 50383,
            account,
            pool: btc.id,
            input: '0x1234',
            state: 'filled',
            transactionTimestamp: Date.now(),
            receipt: { status: 'success', blockNumber: '100' },
          },
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: 'Unmocked hosted test route' } });
  });
  await page.goto('/app#Agent%20Studio');
  await page.getByRole('button', { name: 'Connect owner wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with connected wallet' }).click();
  await expect(page.getByText('Signed in as ' + account, { exact: false })).toBeVisible();
  return { strategies };
}
test('all four hosted templates review real-shaped decisions without opening a wallet for NO_ACTION', async ({
  page,
}) => {
  const { strategies } = await hostedMocks(page);
  for (const strategy of [
    'multi-timeframe-trend',
    'support-resistance-breakout',
    'mean-reversion',
    'risk-guardian',
  ]) {
    await page.getByLabel('Wallet strategy', { exact: true }).selectOption(strategy);
    await page.getByRole('button', { name: 'Load owner strategy configuration' }).click();
    await page.getByRole('button', { name: 'Review live owner strategy' }).click();
    await expect(page.getByRole('heading', { name: 'NO ACTION', exact: true })).toBeVisible();
    await expect(page.getByRole('note', { name: 'Conditions preventing execution' })).toContainText(
      'TEST FIXTURE signal condition',
    );
  }
  expect(strategies).toEqual([
    'multi-timeframe-trend',
    'support-resistance-breakout',
    'mean-reversion',
    'risk-guardian',
  ]);
  expect(
    await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls),
  ).not.toContain('eth_sendTransaction');
  await page.getByRole('button', { name: 'Save wallet strategy' }).click();
  await expect(page.getByLabel('Saved wallet strategies')).toBeVisible();
});
for (const strategy of [
  'multi-timeframe-trend',
  'support-resistance-breakout',
  'mean-reversion',
  'risk-guardian',
])
  test(`${strategy}: exact hosted proposal uses the shared wallet and verified receipt recovery (mocked)`, async ({
    page,
  }) => {
    await hostedMocks(page, true);
    await page.getByLabel('Wallet strategy', { exact: true }).selectOption(strategy);
    await page.getByRole('button', { name: 'Load owner strategy configuration' }).click();
    await page.getByRole('button', { name: 'Review live owner strategy' }).click();
    await page.getByRole('checkbox', { name: /I approve this exact strategy transaction/ }).check();
    await page.getByRole('button', { name: 'Confirm strategy & open wallet' }).click();
    await page.getByRole('button', { name: 'Reconcile strategy transaction' }).click();
    await expect(page.getByText(/Verified strategy transaction:/)).toContainText(fakeHash);
    const calls = await page.evaluate(
      () => (window as unknown as { __walletCalls: string[] }).__walletCalls,
    );
    expect(calls.filter((c) => c === 'eth_sendTransaction')).toHaveLength(1);
    expect(calls).toContain('personal_sign');
  });
