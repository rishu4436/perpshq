/* global document, console, process */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out = resolve(process.env.DEMO_OUTPUT ?? 'data/submission-demo-2026-11-10');
const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:3000';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
const scenes = [
  ['/', 'PerpsHQ — research, plan, execute and review dreamDEX perpetuals.', 18],
  [
    '/app#Command%20Center',
    'Live Hideki markets. Prices and unavailable states come from the deployed API.',
    18,
  ],
  [
    '/app#Opportunity%20Scanner',
    'Compare explainable opportunity scores. Scores are research heuristics, not win probabilities.',
    18,
  ],
  [
    '/app#Market%20Intelligence',
    'Inspect actual completed candles, technical indicators and confirmed historical levels.',
    22,
  ],
  [
    '/app#Trade%20Planner',
    'Plan quantity, slippage and risk before requesting an exact wallet transaction.',
    18,
  ],
  [
    '/app#Positions%20%26%20Risk',
    'Wallet signing stays in Edge. This separate recording browser is intentionally disconnected.',
    15,
  ],
  [
    '/app#Agent%20Studio',
    'Four live strategy templates. Sign in with your wallet, save privately, review real signals and approve eligible actions. Autonomous broadcasting is disabled.',
    22,
  ],
  [
    '/app#Recovery%20Center',
    'Export browser records. Hosted recovery explains which worker tools require the local application.',
    18,
  ],
  ['/app#Trade%20Journal', 'Keep the original trade thesis and evidence for later review.', 15],
];
const manifest = [];
for (const [route, caption, seconds] of scenes) {
  await page.goto(baseURL + route);
  await page.waitForTimeout(4500);
  await page.evaluate((text) => {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '20px',
      left: '12%',
      right: '4%',
      padding: '18px 24px',
      background: '#10180ff2',
      color: '#e4ffbd',
      border: '1px solid #9cb960',
      borderRadius: '12px',
      font: '22px system-ui',
      zIndex: '99999',
    });
    document.body.append(el);
  }, caption);
  await page.screenshot({ path: resolve(out, `scene-${manifest.length + 1}.png`) });
  await page.waitForTimeout(seconds * 1000);
  manifest.push({ route, caption, seconds });
}
await page.setContent(
  `<body style="margin:0;background:#0d160d;color:#e9f5db;font:28px system-ui;padding:80px;line-height:1.6"><p style="color:#c6f982">PERPSHQ / VERIFIED HIDEKI TESTNET EVIDENCE</p><h1>Manual open → close verified</h1><p>0.00013 BTC long opened at 79,984.30 USDso.<br>Equal-size sell filled at 80,197.60 USDso.<br>Subsequent account state verified flat.</p><p style="font-size:20px;overflow-wrap:anywhere">Open: 0x9c6415e10a238db0b353f9d2185bfb0ede64429fc1ec72056ff33276e0c39449<br>Close: 0x39c2790a6a7919696c61a05933b0e1e2a7a5d8690095337642bcd48c48732eb5</p><p>Historical chain receipts, shown separately from this product tour.<br>Supervised close; no atomic reduce-only claim.</p></body>`,
);
await page.screenshot({ path: resolve(out, 'execution-proof.png') });
await page.waitForTimeout(16000);
await page.setContent(
  `<body style="margin:0;background:#0d160d;color:#e9f5db;font:27px system-ui;padding:80px;line-height:1.6"><p style="color:#c6f982">PERPSHQ / STRATEGY EXECUTION EVIDENCE</p><h1>Trend entry + Guardian cancellation</h1><p>Trend: actual 0.00013 BTC short filled at 78,112.70 USDso.<br>Guardian: actual owned resting BTC order cancelled.</p><p style="font-size:20px;overflow-wrap:anywhere">Trend: 0xada1934cdd648fa55feb93310c3b7786dbb36c083873ca8bc5870ddc8b2e1850<br>Guardian: 0x6fe8b1a9b192a41201ce4fe7facaa1886c5e7a3651ecdf153ae99491860812bd</p><p>Owner-wallet transactions executed in the local application.<br>Breakout and Mean Reversion: no qualifying live entry verified.<br>Autonomous execution is disabled. Testnet results do not establish profitability.</p></body>`,
);
await page.screenshot({ path: resolve(out, 'strategy-evidence.png') });
await page.waitForTimeout(20000);
const video = page.video();
await context.close();
await video.saveAs(resolve(out, 'perpshq-demo.webm'));
await browser.close();
await writeFile(
  resolve(out, 'manifest.json'),
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      baseURL,
      scenes: manifest,
      notes:
        'Actual hosted app tour including wallet-authenticated Agent Studio, plus separately labelled historical transaction evidence cards. No fake wallet or trading state. This disconnected recording does not demonstrate a new wallet signature or trade. Silent video with captions.',
    },
    null,
    2,
  ),
);
console.log(resolve(out, 'perpshq-demo.webm'));
