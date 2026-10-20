import { defineConfig, devices } from '@playwright/test';
const baseURL = process.env.PERPSHQ_TEST_URL ?? 'http://127.0.0.1:3000';
const channel = process.platform === 'win32' ? 'msedge' : undefined;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45000,
  fullyParallel: false,
  use: {
    baseURL,
    headless: true,
    channel,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel },
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run dev',
    url: baseURL + '/api/health',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
