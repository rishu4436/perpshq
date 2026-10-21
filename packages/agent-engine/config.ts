import { z } from 'zod';
import Decimal from 'decimal.js';
const address = z
  .string()
  .regex(/^0x[\da-fA-F]{40}$/)
  .refine((v) => !/^0x0{40}$/i.test(v), 'Zero address is not an account');
const money = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d+)?$/)
  .refine(
    (v) => new Decimal(v).gt(0) && new Decimal(v).lte('1000000000000000'),
    'Use a positive bounded decimal',
  );
export const agentConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    revision: z.number().int().min(1),
    name: z.string().trim().min(1).max(64),
    chainId: z.literal(50383),
    mode: z.enum(['DRY_RUN', 'ASSISTED', 'AUTONOMOUS_TESTNET']),
    strategy: z.enum([
      'multi-timeframe-trend',
      'support-resistance-breakout',
      'mean-reversion',
      'risk-guardian',
    ]),
    marketId: address,
    timeframes: z
      .array(z.enum(['1m', '5m', '15m', '1h', '4h', '1d']))
      .min(1)
      .max(3),
    sidePolicy: z.enum(['both', 'long-only', 'short-only']),
    ownerAddress: address.optional(),
    operatorAddress: address.optional(),
    conditions: z
      .object({
        emaFast: z.number().int().min(2).max(100),
        emaSlow: z.number().int().min(3).max(300),
        requireEMA: z.boolean(),
        requireMACD: z.boolean(),
        requireRSI: z.boolean(),
        rsiLongMin: z.number().min(0).max(100),
        rsiLongMax: z.number().min(0).max(100),
        rsiShortMin: z.number().min(0).max(100),
        rsiShortMax: z.number().min(0).max(100),
        adxMin: z.number().min(0).max(100),
        minTimeframeAgreement: z.number().int().min(1).max(3),
        minCoverage: z.number().min(0).max(100),
        atrMinPct: z.number().min(0).max(20),
        atrMaxPct: z.number().positive().max(50),
        requireVolume: z.boolean(),
        volumeRatioMin: z.number().positive().max(20),
        requireLiquidity: z.boolean(),
        rsiOversold: z.number().min(0).max(49),
        rsiOverbought: z.number().min(51).max(100),
        bandLower: z.number().min(0).max(0.49),
        bandUpper: z.number().min(0.51).max(1),
        maDistancePct: z.number().min(0).max(30),
        adxMax: z.number().min(0).max(100),
        requireRecovery: z.boolean(),
        reduceHealth: z.number().positive().max(100),
        flattenHealth: z.number().positive().max(100),
        maxUnrealizedLoss: money,
      })
      .strict(),
    risk: z
      .object({
        orderNotional: money,
        maxOrderNotional: money,
        maxTotalExposure: money,
        maxMarketExposure: money,
        maxOpenPositions: z.number().int().min(1).max(20),
        maxOpenOrders: z.number().int().min(0).max(20),
        leverage: z.number().positive().max(100),
        riskBudget: money,
        maxSessionLoss: money,
        maxDailyLoss: money,
        maxTransactionsPerHour: z.number().int().min(1).max(100),
        maxRepeatedFailures: z.number().int().min(1).max(10),
        maxSlippageBps: z.number().int().min(0).max(500),
        maxDataAgeSeconds: z.number().int().min(5).max(90),
        minGasReserveSTT: money,
        minHealth: z.number().positive().max(100),
        cooldownSeconds: z.number().int().min(1).max(86400),
        failureCooldownSeconds: z.number().int().min(60).max(86400),
      })
      .strict(),
    execution: z
      .object({
        orderType: z.enum(['IOC', 'LIMIT']),
        limitOffsetBps: z.number().int().min(0).max(500),
        stopLossPct: z.number().positive().max(25),
        takeProfitPct: z.number().positive().max(100),
        exitOnSignal: z.boolean(),
        expirySeconds: z.number().int().min(60).max(86400),
        allowPositionReductions: z.boolean(),
        allowRestingCancellations: z.boolean(),
      })
      .strict(),
    paper: z
      .object({
        initialEquity: money,
        slippageBps: z.number().int().min(0).max(500),
        feeBps: z.number().min(0).max(100),
        fundingBpsPerHour: z.number().min(-100).max(100),
        maxVolumeParticipationPct: z.number().positive().max(5),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (new Set(c.timeframes).size !== c.timeframes.length)
      fail(['timeframes'], 'Timeframes must be unique');
    if (c.conditions.emaFast >= c.conditions.emaSlow)
      fail(['conditions', 'emaSlow'], 'Slow EMA must exceed fast EMA');
    if (c.conditions.minTimeframeAgreement > c.timeframes.length)
      fail(['conditions', 'minTimeframeAgreement'], 'Agreement exceeds configured timeframes');
    if (
      c.conditions.rsiLongMin > c.conditions.rsiLongMax ||
      c.conditions.rsiShortMin > c.conditions.rsiShortMax
    )
      fail(['conditions'], 'RSI ranges are inconsistent');
    if (c.conditions.atrMinPct >= c.conditions.atrMaxPct)
      fail(['conditions', 'atrMaxPct'], 'Maximum ATR must exceed minimum');
    if (c.conditions.flattenHealth >= c.conditions.reduceHealth)
      fail(['conditions', 'flattenHealth'], 'Flatten threshold must be below reduce threshold');
    if (
      new Decimal(c.risk.orderNotional).gt(c.risk.maxOrderNotional) ||
      new Decimal(c.risk.maxOrderNotional).gt(c.risk.maxMarketExposure) ||
      new Decimal(c.risk.maxMarketExposure).gt(c.risk.maxTotalExposure)
    )
      fail(['risk'], 'Require order size ≤ order cap ≤ market cap ≤ total cap');
    if (
      c.paper.slippageBps > c.risk.maxSlippageBps ||
      c.execution.limitOffsetBps > c.risk.maxSlippageBps
    )
      fail(['paper', 'slippageBps'], 'Slippage/offset exceeds the risk cap');
    if (
      c.ownerAddress &&
      c.operatorAddress &&
      c.ownerAddress.toLowerCase() === c.operatorAddress.toLowerCase()
    )
      fail(['operatorAddress'], 'Owner and dedicated operator must differ');
    if (c.mode !== 'DRY_RUN' && (!c.ownerAddress || !c.operatorAddress))
      fail(
        ['ownerAddress'],
        'Owner and dedicated operator addresses are required for assisted/disabled autonomous mode',
      );
  });
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export const LIVE_BROADCAST_ENABLED = false;
export function defaultAgentConfig(marketId: string, id: string): AgentConfig {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    name: 'Untitled agent',
    chainId: 50383,
    mode: 'DRY_RUN',
    strategy: 'multi-timeframe-trend',
    marketId,
    timeframes: ['15m'],
    sidePolicy: 'both',
    conditions: {
      emaFast: 20,
      emaSlow: 50,
      requireEMA: true,
      requireMACD: true,
      requireRSI: true,
      rsiLongMin: 50,
      rsiLongMax: 70,
      rsiShortMin: 30,
      rsiShortMax: 50,
      adxMin: 20,
      minTimeframeAgreement: 1,
      minCoverage: 60,
      atrMinPct: 0,
      atrMaxPct: 5,
      requireVolume: true,
      volumeRatioMin: 1.1,
      requireLiquidity: true,
      rsiOversold: 30,
      rsiOverbought: 70,
      bandLower: 0.1,
      bandUpper: 0.9,
      maDistancePct: 0.5,
      adxMax: 25,
      requireRecovery: true,
      reduceHealth: 1.5,
      flattenHealth: 1.1,
      maxUnrealizedLoss: '20',
    },
    risk: {
      orderNotional: '50',
      maxOrderNotional: '100',
      maxTotalExposure: '200',
      maxMarketExposure: '150',
      maxOpenPositions: 1,
      maxOpenOrders: 2,
      leverage: 2,
      riskBudget: '10',
      maxSessionLoss: '50',
      maxDailyLoss: '100',
      maxTransactionsPerHour: 6,
      maxRepeatedFailures: 3,
      maxSlippageBps: 50,
      maxDataAgeSeconds: 90,
      minGasReserveSTT: '0.02',
      minHealth: 1.5,
      cooldownSeconds: 300,
      failureCooldownSeconds: 900,
    },
    execution: {
      orderType: 'IOC',
      limitOffsetBps: 10,
      stopLossPct: 1,
      takeProfitPct: 2,
      exitOnSignal: true,
      expirySeconds: 300,
      allowPositionReductions: false,
      allowRestingCancellations: false,
    },
    paper: {
      initialEquity: '1000',
      slippageBps: 10,
      feeBps: 5,
      fundingBpsPerHour: 0,
      maxVolumeParticipationPct: 1,
    },
  };
}
