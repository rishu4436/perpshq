import { prepareOwnerReview, type Ticket } from './owner-review';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { AgentStore } from '../../../packages/agent-store';
import {
  agentConfigSchema,
  defaultAgentConfig,
  type AgentConfig,
} from '../../../packages/agent-engine';
import { marketById, receipt, rpc } from '../../../packages/dreamdex-adapter';
import { assertSameApproval } from '../../../packages/trade-planner/approval';
const address = z.string().regex(/^0x[\da-f]{40}$/i);
export function ownerStrategyRouter(directory = 'data') {
  const router = Router();
  const store = new AgentStore(join(directory, 'owner-strategy-review.sqlite'));
  const db = new DatabaseSync(join(directory, 'owner-strategy-transactions.sqlite'));
  db.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempted_at INTEGER, signal TEXT, hash TEXT)',
  );
  const lookup = (id: string) =>
    db.prepare('SELECT * FROM reviews WHERE id=?').get(id) as
      { payload: string; state: string; owner: string; signal: string; hash?: string } | undefined;
  const unresolved = (owner: string) =>
    !!db
      .prepare("SELECT id FROM reviews WHERE owner=? AND state='unknown'")
      .get(owner.toLowerCase());
  router.get('/status/:ticketId', (req, res) => {
    const row = lookup(req.params.ticketId);
    if (!row) return res.status(404).json({ error: 'Unknown strategy request' });
    const ticket: Ticket = JSON.parse(row.payload);
    res.json({
      state: row.state,
      hash: row.hash ?? null,
      account: ticket.preview.account,
      to: ticket.preview.to,
      data: ticket.preview.data,
    });
  });
  const runtime = (lease: NonNullable<ReturnType<AgentStore['acquire']>>, owner: string) => ({
    consecutiveFailures: (() => {
      const rows = db
        .prepare(
          'SELECT state FROM reviews WHERE owner=? AND attempted_at IS NOT NULL ORDER BY attempted_at DESC LIMIT 100',
        )
        .all(owner.toLowerCase()) as { state: string }[];
      const first = rows.findIndex((r) => r.state !== 'reverted');
      return first === -1 ? rows.length : first;
    })(),
    lastFailureAt:
      (
        db
          .prepare("SELECT MAX(attempted_at) AS at FROM reviews WHERE owner=? AND state='reverted'")
          .get(owner.toLowerCase()) as { at: number | null }
      ).at ?? undefined,
    transactionTimes: (
      db
        .prepare('SELECT attempted_at FROM reviews WHERE owner=? AND attempted_at>?')
        .all(owner.toLowerCase(), Date.now() - 3600000) as { attempted_at: number }[]
    ).map((r) => r.attempted_at),
    unknownIntent: unresolved(owner),
    leaseValid: store.owns(lease, Date.now()),
    controlAvailable: true,
    cursor: 0,
    status: 'configured' as const,
  });
  router.get('/defaults', async (req, res) => {
    try {
      const owner = address.parse(req.query.account),
        market = address.parse(req.query.marketId);
      await marketById(market);
      const c = defaultAgentConfig(market, randomUUID());
      c.mode = 'ASSISTED';
      c.ownerAddress = owner;
      c.execution.signer = 'owner-wallet';
      c.risk.orderNotional = '11';
      c.risk.maxOrderNotional = '11';
      c.risk.maxMarketExposure = '11';
      c.risk.maxTotalExposure = '11';
      c.risk.leverage = 1;
      c.risk.riskBudget = '1';
      res.json(c);
    } catch (e) {
      res.status(422).json({ error: e instanceof Error ? e.message : 'Invalid owner or market' });
    }
  });
  async function build(config: AgentConfig, previous?: Ticket) {
    const lease = store.acquire(randomUUID(), Date.now(), 300000);
    if (!lease) throw new Error('Another owner review is in progress');
    try {
      return await prepareOwnerReview(config, previous, () =>
        runtime(lease, config.ownerAddress ?? ''),
      );
    } finally {
      store.release(lease, Date.now());
    }
  }
  router.post('/review', async (req, res) => {
    try {
      const { config, ticketId } = z
        .object({ config: agentConfigSchema, ticketId: z.string().uuid().optional() })
        .strict()
        .parse(req.body);
      const row = ticketId ? lookup(ticketId) : undefined;
      if (row && row.state !== 'reviewed')
        throw new Error('This wallet request is already consumed or unresolved');
      const previous: Ticket | undefined = row ? JSON.parse(row.payload) : undefined;
      if (
        ticketId &&
        (!previous ||
          previous.expiresAt < Date.now() ||
          JSON.stringify(previous.config) !== JSON.stringify(config))
      )
        throw new Error('Review expired or configuration changed');
      const result = await build(config, previous);
      if (!result.preview) {
        res.json(result);
        return;
      }
      if (previous) assertSameApproval(previous.preview, result.preview);
      const ticket: Ticket = {
        ...result,
        preview: result.preview,
        id: previous?.id ?? randomUUID(),
        config,
        expiresAt: result.preview.expiresAt,
      };
      db.prepare(
        "INSERT INTO reviews(id,owner,payload,state,signal) VALUES(?,?,?,'reviewed',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(
        ticket.id,
        config.ownerAddress!.toLowerCase(),
        JSON.stringify(ticket),
        ticket.decision.signalKey ?? `${config.id}:${ticket.preview.orderId}`,
      );
      res.json(ticket);
    } catch (e) {
      res.status(422).json({ error: e instanceof Error ? e.message : 'Owner review failed' });
    }
  });
  router.post('/begin', (req, res) => {
    try {
      const id = z.string().uuid().parse(req.body.ticketId);
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = lookup(id);
        if (!row || row.state !== 'reviewed') throw new Error('Ticket is unavailable or consumed');
        const ticket: Ticket = JSON.parse(row.payload);
        if (ticket.expiresAt < Date.now() || unresolved(row.owner))
          throw new Error('Expired review or unresolved owner request');
        if (
          db
            .prepare("SELECT id FROM reviews WHERE owner=? AND signal=? AND state='confirmed'")
            .get(row.owner, row.signal)
        )
          throw new Error('This strategy signal already executed');
        const recent = db
          .prepare(
            'SELECT MAX(attempted_at) AS at, COUNT(*) AS count FROM reviews WHERE owner=? AND attempted_at>?',
          )
          .get(row.owner, Date.now() - 3600000) as { at: number | null; count: number };
        if (
          recent.count >= ticket.config.risk.maxTransactionsPerHour ||
          (recent.at && Date.now() - recent.at < ticket.config.risk.cooldownSeconds * 1000)
        )
          throw new Error('Owner transaction rate or cooldown limit reached');
        db.prepare("UPDATE reviews SET state='unknown',attempted_at=? WHERE id=?").run(
          Date.now(),
          id,
        );
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      res.json({ registered: true });
    } catch (e) {
      res
        .status(422)
        .json({ error: e instanceof Error ? e.message : 'Submission registration failed' });
    }
  });
  router.post('/rejected', (req, res) => {
    const b = z
      .object({
        ticketId: z.string().uuid(),
        walletCode: z.union([z.literal(4001), z.literal('not-dispatched')]),
      })
      .safeParse(req.body);
    if (!b.success) {
      res
        .status(422)
        .json({
          error:
            'Only explicit wallet rejection or a request blocked before dispatch can release this request',
        });
      return;
    }
    db.prepare(
      "UPDATE reviews SET state='rejected' WHERE id=? AND state='unknown' AND hash IS NULL",
    ).run(b.data.ticketId);
    res.json({ rejected: true });
  });
  router.post('/receipt', async (req, res) => {
    try {
      const b = z
        .object({
          ticketId: z.string().uuid(),
          hash: z.string().regex(/^0x[\da-f]{64}$/i),
          account: address,
          marketId: address,
          data: z.string().regex(/^0x[\da-f]+$/i),
        })
        .strict()
        .parse(req.body);
      const tx = await rpc.getTransaction({ hash: b.hash as `0x${string}` });
      if (
        tx.input.toLowerCase() !== b.data.toLowerCase() ||
        tx.from.toLowerCase() !== b.account.toLowerCase() ||
        tx.value !== 0n
      )
        throw new Error('Transaction does not match the persisted owner request');
      const evidence = await receipt(
        b.hash as `0x${string}`,
        b.marketId,
        b.account as `0x${string}`,
      );
      const row = lookup(b.ticketId);
      const ticket: Ticket | undefined = row ? JSON.parse(row.payload) : undefined;
      if (
        !ticket ||
        !row ||
        !['unknown', 'confirmed', 'reverted'].includes(row.state) ||
        (row.hash && row.hash.toLowerCase() !== b.hash.toLowerCase())
      )
        throw new Error('No matching durable submitted strategy review');
      if (
        ticket.config.marketId.toLowerCase() !== b.marketId.toLowerCase() ||
        ticket.preview.to.toLowerCase() !== tx.to?.toLowerCase()
      )
        throw new Error('Receipt market does not match the reviewed strategy');
      if (
        ticket &&
        (ticket.preview.data.toLowerCase() !== tx.input.toLowerCase() ||
          ticket.preview.account.toLowerCase() !== tx.from.toLowerCase())
      )
        throw new Error('Receipt conflicts with reviewed strategy ticket');
      await mkdir(join(directory, 'owner-strategy-evidence'), { recursive: true });
      await writeFile(
        join(directory, 'owner-strategy-evidence', `${b.hash}.json`),
        JSON.stringify(
          { ticket: ticket ?? null, evidence },
          (_, v) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        ),
      );
      db.prepare('UPDATE reviews SET state=?,hash=? WHERE id=?').run(
        evidence.receipt.status === 'success' ? 'confirmed' : 'reverted',
        b.hash,
        b.ticketId,
      );
      res.json(
        JSON.parse(
          JSON.stringify({ evidence, strategyVerified: !!ticket }, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        ),
      );
    } catch (e) {
      res
        .status(422)
        .json({ error: e instanceof Error ? e.message : 'Receipt unavailable; do not retry' });
    }
  });
  return Object.assign(router, {
    close: () => {
      store.close();
      db.close();
    },
  });
}
