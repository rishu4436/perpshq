import { expect, it, describe } from 'vitest';
import { agentFixture, agentNow } from '../agent-fixtures';
import { agentConfigSchema, LIVE_BROADCAST_ENABLED } from '../../packages/agent-engine/config';
import { evaluateAgent } from '../../packages/agent-engine';
import { assessRisk, sizeProposal } from '../../packages/agent-risk';
describe('versioned no-code configuration', () => {
  it('accepts safe dry-run defaults without any wallet or key', () => {
    const { config } = agentFixture();
    expect(agentConfigSchema.parse(config).mode).toBe('DRY_RUN');
    expect(LIVE_BROADCAST_ENABLED).toBe(false);
  });
  it.each([
    'chain',
    'key',
    'ema',
    'timeframes',
    'agreement',
    'risk',
    'slippage',
    'rsi',
    'guardian',
    'identity',
    'assisted',
  ] as const)('rejects inconsistent %s', (kind) => {
    const { config: c } = agentFixture();
    const x: unknown =
      kind === 'chain'
        ? { ...c, chainId: 1 }
        : kind === 'key'
          ? { ...c, privateKey: 'FORBIDDEN TEST STRING' }
          : kind === 'ema'
            ? { ...c, conditions: { ...c.conditions, emaSlow: 2 } }
            : kind === 'timeframes'
              ? { ...c, timeframes: ['15m', '15m'] }
              : kind === 'agreement'
                ? { ...c, conditions: { ...c.conditions, minTimeframeAgreement: 2 } }
                : kind === 'risk'
                  ? { ...c, risk: { ...c.risk, orderNotional: '1000' } }
                  : kind === 'slippage'
                    ? { ...c, paper: { ...c.paper, slippageBps: 500 } }
                    : kind === 'rsi'
                      ? { ...c, conditions: { ...c.conditions, rsiLongMin: 80, rsiLongMax: 20 } }
                      : kind === 'guardian'
                        ? { ...c, conditions: { ...c.conditions, flattenHealth: 2 } }
                        : kind === 'identity'
                          ? {
                              ...c,
                              ownerAddress: '0x' + '1'.repeat(40),
                              operatorAddress: '0x' + '1'.repeat(40),
                            }
                          : { ...c, mode: 'ASSISTED' };
    expect(agentConfigSchema.safeParse(x).success).toBe(false);
  });
});
describe('deterministic signal engine', () => {
  it.each([
    ['support-resistance-breakout', 76],
    ['mean-reversion', 60],
  ] as const)(
    'can accept a complete %s condition using only a captured historical prefix',
    (strategy, length) => {
      const f = agentFixture();
      f.config.strategy = strategy;
      // Deliberately permissive test parameters; these are not recommended presets or live results.
      Object.assign(f.config.conditions, {
        rsiOversold: 49,
        rsiOverbought: 51,
        bandLower: 0.49,
        bandUpper: 0.51,
        maDistancePct: 0,
        adxMax: 100,
        requireVolume: false,
      });
      f.detail.candles = f.detail.candles.slice(0, length);
      const now = (f.detail.candles.at(-1)!.time + 900) * 1000 + 1;
      f.detail.quality.fetchedAt = now;
      f.detail.market.markUpdatedAt = now;
      f.detail.market.markPrice = f.detail.candles.at(-1)!.close;
      f.detail.book!.fetchedAt = now;
      f.account.observedAt = now;
      f.observation.observedAt = now;
      const d = evaluateAgent(f.config, f.observation, f.runtime, now);
      expect(d.type).toBe('ENTRY_CANDIDATE');
      expect(d.failed).toEqual([]);
      expect(d.matched).toContain(
        strategy === 'mean-reversion'
          ? 'Price recovery confirmation'
          : 'Confirmed completed-candle breakout',
      );
    },
  );
  it('produces an explainable candidate only after enabled conditions and central policy pass', () => {
    const f = agentFixture(),
      d = evaluateAgent(f.config, f.observation, f.runtime, agentNow);
    expect(d.type).toBe('ENTRY_CANDIDATE');
    expect(d.risk.allowed).toBe(true);
    expect(d.matched).toContain('Multi-timeframe agreement');
    expect(d.sourceTimestamps.block).toBe('100');
    expect(d.proposal?.rawQuantity).toMatch(/^\d+$/);
    expect(evaluateAgent(f.config, f.observation, f.runtime, agentNow)).toEqual(d);
  });
  it('never repeats a processed completed-candle signal', () => {
    const f = agentFixture(),
      d = evaluateAgent(f.config, f.observation, f.runtime, agentNow);
    expect(
      evaluateAgent(
        f.config,
        f.observation,
        { ...f.runtime, lastSignalKey: d.signalKey },
        agentNow + 1,
      ).type,
    ).toBe('NO_ACTION');
  });
  it.each([
    'stale',
    'missing',
    'warmup',
    'unfinished',
    'future',
    'wrong-market',
    'wrong-chain',
    'indexer',
    'control',
    'unknown',
  ] as const)('withholds %s observations', (kind) => {
    const f = agentFixture();
    if (kind === 'stale') f.detail.quality.stale = true;
    if (kind === 'missing') f.observation.detail = undefined;
    if (kind === 'warmup') f.detail.candles = f.detail.candles.slice(-20);
    if (kind === 'unfinished') f.detail.candles.at(-1)!.complete = false;
    if (kind === 'future') f.detail.candles.at(-1)!.time = agentNow / 1000;
    if (kind === 'wrong-market') f.detail.market.id = '0x' + '2'.repeat(40);
    if (kind === 'wrong-chain') f.observation.chainId = 1;
    if (kind === 'indexer') f.observation.indexerReliable = false;
    if (kind === 'control') f.runtime.controlAvailable = false;
    if (kind === 'unknown') f.runtime.unknownIntent = true;
    expect(['DATA_UNAVAILABLE', 'PAUSE_REQUIRED']).toContain(
      evaluateAgent(f.config, f.observation, f.runtime, agentNow).type,
    );
  });
  it('requires enabled momentum and independent timeframe agreement', () => {
    const f = agentFixture();
    f.config.conditions.requireRSI = true;
    f.config.conditions.rsiLongMin = 99;
    f.config.conditions.rsiLongMax = 100;
    f.config.conditions.rsiShortMin = 99;
    f.config.conditions.rsiShortMax = 100;
    expect(evaluateAgent(f.config, f.observation, f.runtime, agentNow).type).toBe('NO_ACTION');
    f.config.conditions.requireRSI = false;
    f.config.timeframes = ['15m', '1h'];
    f.config.conditions.minTimeframeAgreement = 2;
    expect(evaluateAgent(f.config, f.observation, f.runtime, agentNow).failed).toContain(
      'Multi-timeframe agreement',
    );
  });
  it('a breakout requires a confirmed prior zone, volume and usable current liquidity', () => {
    const f = agentFixture();
    f.config.strategy = 'support-resistance-breakout';
    f.detail.book = null;
    const d = evaluateAgent(f.config, f.observation, f.runtime, agentNow);
    expect(d.type).toBe('NO_ACTION');
    expect(d.failed).toContain('Fresh opposite-side liquidity');
  });
  it('mean reversion never treats RSI alone as an entry', () => {
    const f = agentFixture();
    f.config.strategy = 'mean-reversion';
    f.config.conditions.rsiOversold = 49;
    f.config.conditions.rsiOverbought = 51;
    f.config.conditions.maDistancePct = 30;
    const d = evaluateAgent(f.config, f.observation, f.runtime, agentNow);
    expect(d.type).toBe('NO_ACTION');
    expect(d.failed).toContain('Distance from moving average');
  });
  it('Guardian never seeks entries and recommends a bounded opposite-side reduction', () => {
    const f = agentFixture();
    f.config.strategy = 'risk-guardian';
    expect(evaluateAgent(f.config, f.observation, f.runtime, agentNow).type).toBe('NO_ACTION');
    f.account.positions = [
      {
        marketId: f.config.marketId,
        side: 'long',
        quantity: '0.001',
        entryPrice: String(f.detail.market.markPrice),
        notional: '80',
        unrealizedPnl: '0',
        source: 'paper',
      },
    ];
    f.account.health = 1.2;
    const d = evaluateAgent(f.config, f.observation, f.runtime, agentNow);
    expect(d.type).toBe('REDUCE_CANDIDATE');
    expect(d.proposal?.side).toBe('short');
    expect(Number(d.proposal?.quantity)).toBeLessThanOrEqual(0.00025);
  });
});
describe('non-bypassable central policy', () => {
  it.each(['notional', 'quantity', 'loss', 'raw'] as const)('rejects forged %s claims', (field) => {
    const f = agentFixture(),
      p = sizeProposal(f.config, f.detail.market, 'long');
    if (field === 'notional') p.notional = '0.01';
    if (field === 'quantity') p.quantity = '0.00000001';
    if (field === 'loss') p.estimatedLoss = '0';
    if (field === 'raw') p.rawQuantity = (BigInt(p.rawQuantity) * 1000000n).toString();
    expect(assessRisk(f.config, f.observation, f.runtime, p, agentNow).allowed).toBe(false);
  });
  it.each([
    'total',
    'market',
    'positions',
    'orders',
    'session',
    'daily',
    'incomplete',
    'transactions',
    'failures',
    'cooldown',
    'gas',
    'permission',
    'leverage',
  ] as const)('enforces %s guard', (kind) => {
    const f = agentFixture(),
      p = sizeProposal(f.config, f.detail.market, 'long');
    if (kind === 'total') f.account.totalExposure = '1000';
    if (kind === 'market') f.account.marketExposure = '1000';
    if (kind === 'positions') f.account.positionCount = 1;
    if (kind === 'orders')
      f.account.orders = Array.from({ length: 3 }, (_, i) => ({
        orderId: String(i),
        marketId: f.config.marketId,
        owner: 'PAPER',
        quantity: '1',
        remaining: '1',
        notional: '1',
      }));
    if (kind === 'session') f.account.sessionPnl = '-50';
    if (kind === 'daily') f.account.dailyPnl = '-100';
    if (kind === 'incomplete') {
      f.account.historyComplete = false;
      f.account.dailyPnl = null;
    }
    if (kind === 'transactions')
      f.runtime.transactionTimes = Array.from({ length: 6 }, () => agentNow - 1);
    if (kind === 'failures') f.runtime.consecutiveFailures = 3;
    if (kind === 'cooldown') f.runtime.lastActionAt = agentNow - 1;
    if (['gas', 'permission', 'leverage'].includes(kind)) {
      f.account.source = 'chain';
      f.account.gasSTT = kind === 'gas' ? '0' : '1';
      f.account.permissions = {
        place: kind !== 'permission',
        cancel: true,
        reduce: true,
        checkedAt: agentNow,
      };
      f.account.verifiedLeverage = kind === 'leverage' ? 1 : 5;
    }
    expect(assessRisk(f.config, f.observation, f.runtime, p, agentNow).allowed).toBe(false);
  });
  it('respects 24-decimal base quantities without floating-point raw conversions', () => {
    const f = agentFixture(),
      m = {
        ...f.detail.market,
        baseDecimals: 24,
        lotSize: '1000000000000000000',
        minQuantity: '1000000000000000000',
      };
    const p = sizeProposal(f.config, m, 'long');
    expect(BigInt(p.rawQuantity) % BigInt(m.lotSize)).toBe(0n);
  });
});
