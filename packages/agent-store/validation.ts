import { z } from 'zod';
import Decimal from 'decimal.js';
const decimal = z
  .string()
  .max(200)
  .regex(/^-?\d+(\.\d+)?$/)
  .refine((v) => new Decimal(v).isFinite());
const positive = decimal.refine((v) => new Decimal(v).gt(0)),
  nonnegative = decimal.refine((v) => new Decimal(v).gte(0));
const timestamp = z.number().finite().int().nonnegative();
const side = z.enum(['long', 'short']);
const proposal = z
  .object({
    action: z.enum(['entry', 'close-position', 'reduce-position', 'cancel-order']),
    side,
    quantity: positive,
    rawQuantity: z.string().regex(/^\d+$/),
    price: positive,
    rawPrice: z.string().regex(/^\d+$/),
    notional: positive,
    estimatedLoss: nonnegative,
    orderType: z.enum(['IOC', 'LIMIT']),
    stopPrice: positive.optional(),
    targetPrice: positive.optional(),
    orderId: z.string().optional(),
  })
  .strict();
export const ledgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    initialEquity: positive,
    cash: decimal,
    equity: decimal,
    peakEquity: decimal,
    maxDrawdown: nonnegative,
    realizedPnl: decimal,
    fees: nonnegative,
    funding: decimal,
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dayStartCash: decimal,
    updatedAt: timestamp,
    startedAt: timestamp,
    lastBookConsumedAt: timestamp.optional(),
    lastFillAt: timestamp.optional(),
    closedTrades: z.number().int().nonnegative(),
    closedNetPnl: decimal,
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    position: z
      .object({
        marketId: z.string().regex(/^0x[\da-fA-F]{40}$/),
        side,
        quantity: positive,
        entryPrice: positive,
        notional: positive,
        unrealizedPnl: decimal,
        stopPrice: positive.optional(),
        targetPrice: positive.optional(),
        source: z.literal('paper'),
        entryFees: nonnegative,
        fundingPaid: decimal,
        realizedNet: decimal,
      })
      .strict()
      .optional(),
    orders: z
      .array(
        z
          .object({
            id: z.string(),
            decisionId: z.string(),
            createdAt: timestamp,
            expiresAt: timestamp,
            proposal,
            remaining: positive,
          })
          .strict(),
      )
      .max(100),
    fills: z
      .array(
        z
          .object({
            id: z.string(),
            decisionId: z.string(),
            at: timestamp,
            side,
            quantity: positive,
            price: positive,
            fee: nonnegative,
            realizedPnl: decimal,
            kind: z.enum(['entry', 'exit']),
            evidenceKind: z.literal('SIMULATED'),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .superRefine((l, ctx) => {
    const cash = new Decimal(l.initialEquity).plus(l.realizedPnl).minus(l.fees).minus(l.funding);
    const equity = new Decimal(l.cash).plus(l.position?.unrealizedPnl ?? 0);
    if (
      cash.minus(l.cash).abs().gt('1e-40') ||
      equity.minus(l.equity).abs().gt('1e-40') ||
      l.wins + l.losses > l.closedTrades ||
      new Decimal(l.peakEquity).lt(l.equity) ||
      l.updatedAt < l.startedAt
    )
      ctx.addIssue({ code: 'custom', message: 'Paper accounting invariants do not reconcile' });
  });
export const runtimeSchema = z
  .object({
    controlGeneration: timestamp.optional(),
    emergencyLatched: z.boolean().optional(),
    lastSignalKey: z.string().max(1000).optional(),
    lastActionAt: timestamp.optional(),
    lastFailureAt: timestamp.optional(),
    consecutiveFailures: z.number().int().nonnegative(),
    transactionTimes: z.array(timestamp).max(10000),
    unknownIntent: z.boolean(),
    leaseValid: z.boolean(),
    controlAvailable: z.boolean(),
    cursor: timestamp,
    blockCursor: z.string().regex(/^\d+$/).optional(),
    status: z.enum([
      'configured',
      'simulating',
      'awaiting-authorization',
      'running',
      'paused',
      'disconnected',
      'recovering',
      'error',
      'emergency-stopped',
    ]),
  })
  .strict();
