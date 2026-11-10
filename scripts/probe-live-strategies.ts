import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { AgentStore } from '../packages/agent-store';
import { defaultAgentConfig, evaluateAgent } from '../packages/agent-engine';
import { observeAgent } from '../apps/agent-worker/src/live-data';
import { sdk } from '../packages/dreamdex-adapter';
import { accountPerformance } from '../packages/dreamdex-adapter/accounting';
const owner = '0xd2e173c9d10952a7c5d903f1bff64a7e85b18145';
const market = '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0';
await mkdir('data/live-strategy-review', { recursive: true });
const store = new AgentStore('data/live-strategy-review/review.sqlite');
const lease = store.acquire(randomUUID(), Date.now(), 300000);
if (!lease) throw new Error('Review lease unavailable');
const results = [];
try {
  const config = defaultAgentConfig(market, randomUUID());
  config.ownerAddress = owner;
  config.risk.orderNotional = '11';
  config.risk.maxOrderNotional = '11';
  config.risk.maxMarketExposure = '11';
  config.risk.maxTotalExposure = '11';
  config.risk.leverage = 1;
  config.risk.riskBudget = '1';
  // Review current signals without pretending a short scan proves complete daily loss history.
  const observation = await observeAgent(config);
  const recentAccounting = await accountPerformance(owner, market, Date.now() - 180000).catch(
    (error: unknown) => ({
      complete: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  for (const strategy of [
    'multi-timeframe-trend',
    'support-resistance-breakout',
    'mean-reversion',
    'risk-guardian',
  ] as const) {
    const current = { ...structuredClone(config), id: randomUUID(), strategy };
    const decision = evaluateAgent(
      current,
      observation,
      {
        consecutiveFailures: 0,
        transactionTimes: [],
        unknownIntent: false,
        leaseValid: store.owns(lease, Date.now()),
        controlAvailable: true,
        cursor: 0,
        status: 'configured',
      },
      Date.now(),
    );
    results.push({ config: current, decision });
  }
  await writeFile(
    'data/live-strategy-review/results.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        owner,
        observation,
        recentAccounting,
        results,
        broadcast: false,
        note: 'Actual chain and market observation. Existing strategy evaluator in review mode; no paper ledger or mocked market data. A proposal is not a transaction. Owner-wallet strategy dispatch is not implemented.',
      },
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  );
  console.log(
    JSON.stringify(
      results.map(({ decision: d }) => ({
        strategy: d.strategy,
        type: d.type,
        failed: d.failed,
        rationale: d.rationale,
        riskFailures: d.risk.checks.filter((c) => !c.passed).map((c) => c.name),
        proposal: d.proposal,
      })),
      null,
      2,
    ),
  );
} finally {
  store.release(lease, Date.now());
  store.close();
  sdk.close();
}
