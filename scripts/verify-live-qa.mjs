/* global console, process, localStorage, URL, document */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.RELEASE_URL ?? 'https://perpshq.vercel.app';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
});
const results = [],
  errors = [];
try {
  for (const [device, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: device === 'mobile',
      hasTouch: device === 'mobile',
    });
    await context.addInitScript(() =>
      localStorage.setItem(
        'perpshq.activityOutbox',
        JSON.stringify([
          {
            id: 'QA-READ-ONLY-OUTBOX',
            flowId: 'QA',
            account: '0x' + '1'.repeat(40),
            marketId: '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0',
            at: Date.now(),
            state: 'draft',
            detail: 'LABELLED QA outbox fixture; no transaction',
          },
        ]),
      ),
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push({ device, error: error.message }));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /Content Security Policy|font-src|Refused to load the font/i.test(message.text())
      )
        errors.push({ device, error: message.text() });
    });
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/workspace/activity')
        errors.push({ device, error: 'Hosted browser attempted a local-only activity request' });
    });
    for (const screen of [
      'Command Center',
      'Agent Studio',
      'Portfolio Analytics',
      'Recovery Center',
      'Settings & Help',
    ]) {
      await page.goto(base + '/app#' + encodeURIComponent(screen), {
        waitUntil: 'domcontentloaded',
      });
      await page.locator('main h1').waitFor({ timeout: 45000 });
      if (screen === 'Command Center')
        await page
          .getByRole('button', { name: 'Refresh chart', exact: true })
          .waitFor({ timeout: 45000 });
      if (screen === 'Recovery Center')
        await page
          .getByRole('heading', { name: 'Verify a transaction hash' })
          .waitFor({ timeout: 45000 });
      await page.waitForTimeout(1200);
      const size = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      if (size.content > size.viewport + 1) throw new Error(`${device} ${screen} overflow`);
      results.push({ device, screen, overflow: false });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await mkdir('data/qa-fixes-2026-11-10', { recursive: true });
await writeFile(
  'data/qa-fixes-2026-11-10/live-browser.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      base,
      actualHostedPages: true,
      walletConnected: false,
      broadcast: false,
      results,
      errors,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ pages: results.length, errors }));
if (errors.length) process.exitCode = 1;
