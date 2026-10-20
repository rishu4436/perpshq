import { test, expect } from '@playwright/test';
test('live UI loads verified markets and captures the local product', async ({ page }, info) => {
  test.skip(process.env.LIVE_TESTS !== '1', 'Optional read-only live smoke; never signs.');
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'BTC-PERP', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('img', { name: /Interactive dreamDEX/ })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Analyze BTC-PERP', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.screenshot({
    path: `docs/screenshots/live-${info.project.name}.png`,
    fullPage: info.project.name === 'desktop',
  });
  expect(errors).toEqual([]);
});
