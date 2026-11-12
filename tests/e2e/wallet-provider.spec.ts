import { test, expect } from '@playwright/test';
import { mocks, account, fakeHash, nav, fillPlan } from './fixtures';

test('network polling detects Ethereum even when account reads stall and events are missing', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.evaluate(() => {
    const provider = window.ethereum!;
    const original = provider.request.bind(provider);
    provider.request = (args) =>
      args.method === 'eth_accounts'
        ? new Promise(() => {})
        : args.method === 'eth_chainId'
          ? Promise.resolve('0x1')
          : original(args);
  });
  await page.getByRole('button', { name: 'Refresh wallet network', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wallet network: 1.' })).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole('button', { name: 'Switch to Hideki', exact: true }).first(),
  ).toBeVisible();
});

test('MetaMask connection and signing remain bound when another wallet owns window.ethereum', async ({
  page,
}) => {
  await mocks(page);
  await page.addInitScript(
    ({ account, fakeHash }) => {
      const calls: string[] = [];
      (window as unknown as { __metamaskCalls: string[] }).__metamaskCalls = calls;
      let connected = false;
      const provider = {
        request: async ({ method }: { method: string }) => {
          calls.push(method);
          if (method === 'eth_accounts') return connected ? [account] : [];
          if (method === 'eth_requestAccounts') {
            connected = true;
            return [account];
          }
          if (method === 'eth_chainId') return '0xc4cf';
          if (method === 'eth_sendTransaction') return fakeHash;
          return null;
        },
        on() {},
        removeListener() {},
      };
      window.addEventListener('eip6963:requestProvider', () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: { info: { rdns: 'io.metamask' }, provider },
          }),
        ),
      );
    },
    { account, fakeHash },
  );
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await nav(page, 'Trade Planner');
  await fillPlan(page);
  await page.getByRole('button', { name: 'Validate on testnet' }).click();
  await page.getByRole('checkbox', { name: /I authorize this specific testnet order/ }).check();
  await page.getByRole('button', { name: 'Confirm & open wallet', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __metamaskCalls: string[] }).__metamaskCalls),
    )
    .toContain('eth_sendTransaction');
  const legacy = await page.evaluate(
    () => (window as unknown as { __walletCalls: string[] }).__walletCalls,
  );
  expect(legacy).not.toContain('eth_requestAccounts');
  expect(legacy).not.toContain('eth_sendTransaction');
});
