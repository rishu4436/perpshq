import { z } from 'zod';
import Decimal from 'decimal.js';
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
export const activitySchema = z
  .object({
    id: z.string().uuid(),
    flowId: z.string().uuid(),
    account: address,
    marketId: address,
    at: z.number().int().nonnegative(),
    state: z.enum([
      'draft',
      'reviewed',
      'signature',
      'pending',
      'unknown',
      'rejected',
      'confirmed',
      'reverted',
      'syncing',
      'resting',
      'partial',
      'filled',
      'cancelled',
      'journaled',
    ]),
    hash: z
      .string()
      .regex(/^0x[\da-fA-F]{64}$/)
      .optional(),
    detail: z.string().max(500),
  })
  .strict();
const decimal = z
  .string()
  .max(200)
  .regex(/^-?\d+(\.\d+)?$/);
const timestamp = z.number().int().nonnegative();
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const block = z.string().regex(/^\d+$/);
const point = z.object({ block, blockHash: hash, at: timestamp, totalEquity: decimal });
export const accountingSchema = z
  .object({
    account: address,
    bank: address,
    chainId: z.literal(50383),
    from: point,
    to: point,
    complete: z.boolean(),
    netPnl: decimal.nullable(),
    netFlows: decimal,
    fees: decimal,
    fundingPaid: decimal,
    realizedPnl: decimal,
    reasons: z.array(z.string()),
    movements: z.array(
      z.object({
        id: z.string(),
        block,
        kind: z.string(),
        amount: decimal,
        account: address,
        txHash: hash,
      }),
    ),
    fillCount: z.number().int().nonnegative(),
    generatedAt: timestamp,
  })
  .superRefine((r, ctx) => {
    if (
      r.complete !== (r.reasons.length === 0 && r.netPnl !== null) ||
      (!r.complete && r.netPnl !== null) ||
      (r.complete &&
        !new Decimal(r.to.totalEquity).minus(r.from.totalEquity).minus(r.netFlows).eq(r.netPnl!))
    )
      ctx.addIssue({ code: 'custom', message: 'Accounting report invariants do not reconcile' });
  });
export const inboxSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  at: timestamp,
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  detail: z.string(),
  agentId: z.string().uuid().optional(),
  acknowledgedAt: timestamp.optional(),
  delivery: z.literal('local-inbox'),
});
