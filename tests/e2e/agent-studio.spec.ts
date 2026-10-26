import { test, expect, type Page } from '@playwright/test';
import { mocks, ms, nav } from './fixtures';
import { agentConfigSchema, type AgentConfig } from '../../packages/agent-engine/config';
import { initialLedger, advancePaper } from '../../packages/agent-engine/paper';
import { evaluateAgent } from '../../packages/agent-engine';
import { evaluateHistory } from '../../packages/agent-engine/history';
import { agentFixture, agentNow } from '../agent-fixtures';
import type { AgentRecord, AgentCommand, AgentEvent } from '../../packages/agent-store';
import type { AgentDecision } from '../../packages/agent-engine/types';
import type { PermissionSnapshot } from '../../packages/agent-execution';
async function studioMocks(page: Page) {
  await mocks(page);
  const agents: AgentRecord[] = [],
    commands: AgentCommand[] = [],
    events: AgentEvent[] = [],
    initialDecisions: AgentDecision[] = [],
    history: ReturnType<typeof evaluateHistory>[] = [],
    initialConnected = false;
  let decisions = initialDecisions,
    connected = initialConnected;
  await page.route('**/api/agents**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method(),
      body = method === 'POST' ? route.request().postDataJSON() : undefined;
    const id = path.split('/')[3],
      a = agents.find((a) => a.config.id === id);
    let response: unknown = {};
    if (path === '/api/agents/validate') {
      const result = agentConfigSchema.safeParse(body);
      if (!result.success)
        return route.fulfill({
          status: 400,
          json: { error: result.error.issues.map((i) => i.message).join('; ') },
        });
      response = {
        valid: true,
        warnings: ['AUTOMATED TEST ONLY: configuration is not trading authorization.'],
      };
    } else if (path === '/api/agents' && method === 'POST') {
      const config = agentConfigSchema.parse(body.config),
        old = agents.find((a) => a.config.id === config.id);
      if (old) {
        old.config = config;
        response = old;
      } else {
        const record: AgentRecord = {
          config,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          runtime: {
            status: 'configured',
            leaseValid: false,
            controlAvailable: true,
            unknownIntent: false,
            consecutiveFailures: 0,
            transactionTimes: [],
            cursor: 0,
          },
          ledger: initialLedger(config, Date.now()),
        };
        agents.push(record);
        response = record;
      }
      events.push({
        id: events.length + 1,
        agentId: config.id,
        kind: 'configured',
        at: Date.now(),
        message: 'AUTOMATED TEST ONLY: configuration persisted in mock control-plane fixture.',
      });
    } else if (path === '/api/agents')
      response = {
        agents: agents.map((a) => ({
          ...a,
          displayStatus:
            ['simulating', 'awaiting-authorization'].includes(a.runtime.status) && !connected
              ? 'disconnected'
              : a.runtime.status,
          pendingCommands: commands.filter((c) => c.agentId === a.config.id && !c.acknowledgedAt),
          lastDecision: decisions[0] ?? null,
        })),
        connected,
        worker: connected
          ? { workerId: 'AUTOMATED-TEST-WORKER', at: Date.now(), state: 'idle', fence: 1 }
          : null,
        controlPlane: 'local-sqlite',
        remoteControlAvailable: false,
        broadcastEnabled: false,
      };
    else if (!a)
      return route.fulfill({ status: 404, json: { error: 'Agent not found (TEST ONLY)' } });
    else if (path.endsWith('/commands')) {
      const cmd: AgentCommand = {
        id: body.requestId,
        agentId: a.config.id,
        revision: body.revision,
        type: body.type,
        requestedAt: Date.now(),
      };
      commands.unshift(cmd);
      response = cmd;
    } else if (path.endsWith('/permissions')) {
      const p: PermissionSnapshot = {
        owner: a.config.ownerAddress!,
        operator: a.config.operatorAddress!,
        marketId: a.config.marketId,
        checkedAt: Date.now(),
        chainId: 50383,
        block: '100',
        accountKind: 'contract-observed',
        place: false,
        cancel: false,
        reduce: false,
        gasSTT: '0',
        broadcastEnabled: false,
      };
      a.permissions = p;
      response = p;
    } else if (path.endsWith('/history')) {
      const f = agentFixture();
      const report = evaluateHistory(
        { ...a.config, marketId: f.config.marketId },
        f.detail.market,
        f.detail.candles,
        agentNow,
      );
      history.unshift(report);
      response = report;
    } else if (path.endsWith('/export'))
      response = {
        config: a.config,
        schemaVersion: 1,
        nonsecret: true,
        broadcastEnabled: false,
        railway: {
          environment: {
            AGENT_NETWORK: 'hideki',
            AGENT_MODE: 'DRY_RUN',
            AGENT_STORE_PATH: '/data/agent-studio.sqlite',
            AGENT_CONFIG_FILE: '/data/agent.json',
          },
        },
      };
    else if (path.endsWith('/evidence'))
      response = {
        agentId: a.config.id,
        realTransactions: [],
        paperFills: a.ledger.fills,
        broadcastEnabled: false,
      };
    else
      response = {
        agent: a,
        decisions,
        events: events
          .filter((e) => e.agentId === a.config.id)
          .slice()
          .reverse(),
        commands: commands.filter((c) => c.agentId === a.config.id),
        history,
        unresolvedIntents: [],
      };
    await route.fulfill({ json: response });
  });
  return {
    agents: () => agents,
    disconnect: () => {
      connected = false;
    },
    acknowledge: () => {
      connected = true;
      for (const cmd of commands
        .filter((c) => !c.acknowledgedAt)
        .slice()
        .reverse()) {
        const a = agents.find((a) => a.config.id === cmd.agentId)!;
        cmd.acknowledgedAt = Date.now();
        cmd.result = 'acknowledged';
        a.runtime.status =
          cmd.type === 'start' || cmd.type === 'resume'
            ? 'simulating'
            : cmd.type === 'emergency-stop'
              ? 'emergency-stopped'
              : 'paused';
        events.push({
          id: events.length + 1,
          agentId: a.config.id,
          at: Date.now(),
          kind: a.runtime.status,
          message: 'AUTOMATED TEST ONLY: worker acknowledgement fixture.',
        });
      }
      const a = agents[0];
      if (a?.runtime.status === 'simulating' && !decisions.length) {
        const f = agentFixture(),
          c: AgentConfig = { ...f.config, id: a.config.id, name: a.config.name },
          d = evaluateAgent(c, f.observation, f.runtime, agentNow);
        decisions = [d];
        a.ledger = advancePaper(c, initialLedger(c, agentNow), f.detail, d, agentNow).ledger;
        a.lastEvaluationAt = agentNow;
      }
    },
  };
}
async function create(page: Page, name = 'TEST ONLY Trend Agent', addresses = false) {
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create agent' });
  await dialog.getByRole('textbox', { name: 'Agent name', exact: true }).fill(name);
  if (addresses) {
    await dialog.getByRole('tab', { name: 'Owner & operator', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'Owner Somnia Account address', exact: true })
      .fill('0x' + '1'.repeat(40));
    await dialog
      .getByRole('textbox', { name: 'Dedicated operator public address', exact: true })
      .fill('0x' + '2'.repeat(40));
  }
  await dialog.getByRole('button', { name: 'Validate configuration', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('validated');
  await dialog.getByRole('button', { name: 'Save agent', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test('create, validate, edit and reload a versioned agent without starting it', async ({
  page,
}) => {
  const state = await studioMocks(page);
  await page.goto('/app#Agent%20Studio');
  await expect(page.getByRole('heading', { name: 'Agent Studio', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Create your first agent' })).toBeVisible();
  await create(page);
  expect(state.agents()).toHaveLength(1);
  expect(state.agents()[0].runtime.status).toBe('configured');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'TEST ONLY Trend Agent', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit configuration', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit agent' });
  await edit
    .getByRole('textbox', { name: 'Agent name', exact: true })
    .fill('TEST ONLY Revised Agent');
  await edit.getByRole('tab', { name: 'Risk limits', exact: true }).click();
  await edit.getByRole('textbox', { name: 'Risk budget per trade (USDso)', exact: true }).fill('9');
  await edit.getByRole('button', { name: 'Save agent', exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(state.agents()[0].config.revision).toBe(2);
  expect(state.agents()[0].config.risk.riskBudget).toBe('9');
  expect(state.agents()[0].runtime.status).toBe('configured');
});
test('invalid strategy conditions are rejected and autonomous activation stays locked', async ({
  page,
}) => {
  const state = await studioMocks(page);
  await page.goto('/app#Agent%20Studio');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Create agent' });
  await expect(d.getByRole('option', { name: /Autonomous testnet/ })).toHaveAttribute(
    'disabled',
    '',
  );
  await d.getByRole('tab', { name: 'Signals', exact: true }).click();
  await d.getByRole('textbox', { name: 'Slow EMA period', exact: true }).fill('5');
  await d.getByRole('button', { name: 'Validate configuration', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Slow EMA must exceed');
  expect(state.agents()).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
});
test('start, decisions, paper fills and pause use requested versus acknowledged states', async ({
  page,
}) => {
  const state = await studioMocks(page);
  await page.goto('/app#Agent%20Studio');
  await create(page);
  await page.getByRole('button', { name: 'Start dry run', exact: true }).click();
  await expect(page.locator('.studio-command-pending')).toContainText(
    'Awaiting worker acknowledgement',
  );
  expect(state.agents()[0].runtime.status).toBe('configured');
  state.acknowledge();
  await page.getByRole('button', { name: 'Refresh agents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause agent', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Decisions', exact: true }).click();
  await expect(page.locator('.studio-decision')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Simulation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Simulated positions & fills' })).toBeVisible();
  await expect(page.locator('.agent-studio a[href*="/tx/"]')).toHaveCount(0);
  state.disconnect();
  await page.getByRole('button', { name: 'Refresh agents', exact: true }).click();
  await expect(page.getByText('Local worker disconnected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause agent', exact: true }).click();
  await expect(page.locator('.studio-command-pending')).toContainText('Pause requested');
  state.acknowledge();
  await page.getByRole('button', { name: 'Refresh agents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume agent', exact: true })).toBeVisible();
});
test('permission reads, historical reports and nonsecret Railway exports are available', async ({
  page,
}) => {
  await studioMocks(page);
  await page.goto('/app#Agent%20Studio');
  await create(page, 'TEST ONLY Permission Agent', true);
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  await page.getByRole('button', { name: 'Check permissions', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Last actual observation/ })).toBeVisible();
  await expect(page.getByText('false / false / false', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Run historical evaluation', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'chronological-validation', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Deployment', exact: true }).click();
  await expect(page.getByText('Unavailable · no authenticated cloud integration')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Railway config', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('perpshq-agent-railway.json');
  const payload = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(payload).toContain('DRY_RUN');
  expect(payload).toContain('50383');
  expect(payload).not.toContain('PRIVATE_KEY');
  expect(payload).not.toContain('privateKey');
});
test('emergency stop is a durable request, not an invented remote kill confirmation', async ({
  page,
}) => {
  const state = await studioMocks(page);
  await page.goto('/app#Agent%20Studio');
  await create(page);
  await page.getByRole('button', { name: 'Emergency stop', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Emergency stop agent' });
  await expect(d).toContainText('not closed or cancelled');
  await d.getByRole('button', { name: 'Request emergency stop' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator('.studio-command-pending')).toContainText('Emergency stop requested');
  expect(state.agents()[0].runtime.status).toBe('configured');
  state.acknowledge();
  await page.getByRole('button', { name: 'Refresh agents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Emergency stop', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Edit configuration', exact: true }),
  ).toBeDisabled();
});
test('an agent-store outage remains isolated from the manual Planner', async ({ page }) => {
  await mocks(page);
  await page.route('**/api/agents**', (r) =>
    r.fulfill({ status: 503, json: { error: 'AUTOMATED TEST ONLY: agent store unavailable' } }),
  );
  await page.goto('/app#Agent%20Studio');
  await expect(page.getByRole('alert')).toContainText('agent store unavailable');
  await nav(page, 'Trade Planner');
  await expect(
    page.getByRole('textbox', { name: 'Entry / reference price', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
  expect(ms.length).toBeGreaterThan(0);
});

test('capture the actual local Agent Studio with real persisted state', async ({ page }, info) => {
  test.skip(
    process.env.LIVE_TESTS !== '1',
    'Optional read-only real local state capture; no signing.',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app#Agent%20Studio');
  await expect(
    page.getByRole('heading', { name: 'Agent Studio', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Live execution is locked', { exact: true })).toBeVisible();
  await expect(page.locator('.studio-agent-list button').first()).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `docs/screenshots/agent-studio-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
  for (const tab of ['Decisions', 'Simulation', 'Permissions', 'Deployment']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      tab + ' fits the viewport',
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
