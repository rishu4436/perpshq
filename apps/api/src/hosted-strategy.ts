import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentConfigSchema, defaultAgentConfig } from '../../../packages/agent-engine';
import { assertSameApproval } from '../../../packages/trade-planner/approval';
import { marketById, receipt, rpc } from '../../../packages/dreamdex-adapter';
import { hostedAuth } from './hosted-auth';
import { HostedLedger } from './hosted-ledger';
import { HostedStorageError, type DocumentStore } from './hosted-store';
import { prepareOwnerReview, type Ticket } from './owner-review';
import { sameConfig } from './config-equality';
const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export function hostedStrategyRouter(store: DocumentStore) {
  const router = Router(),
    ledger = new HostedLedger(store),
    auth = hostedAuth(store, (args) => rpc.verifyMessage(args));
  router.use(auth.router);
  router.use(auth.sameOrigin, auth.requireOwner);
  const route = (
    method: 'get' | 'post',
    path: string,
    work: (owner: string, req: Request) => Promise<unknown>,
  ) =>
    router[method](path, async (req, res: Response) => {
      try {
        res
          .type('json')
          .send(
            JSON.stringify(await work(res.locals.owner, req), (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          );
      } catch (e) {
        res
          .status(e instanceof HostedStorageError ? 503 : e instanceof z.ZodError ? 400 : 422)
          .json({
            error:
              e instanceof z.ZodError
                ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
                : e instanceof Error
                  ? e.message
                  : 'Strategy request failed',
          });
      }
    });
  const checkOwner = (owner: string, config: z.infer<typeof agentConfigSchema>) => {
    if (
      config.ownerAddress?.toLowerCase() !== owner ||
      config.mode !== 'ASSISTED' ||
      config.execution.signer !== 'owner-wallet' ||
      config.operatorAddress
    )
      throw new Error(
        'Configuration must match the signed-in owner and use owner-wallet execution',
      );
  };
  route('get', '/defaults', async (owner, req) => {
    if (addr.parse(req.query.account).toLowerCase() !== owner) throw new Error('Owner mismatch');
    const market = addr.parse(req.query.marketId);
    await marketById(market);
    const c = defaultAgentConfig(market, randomUUID());
    c.ownerAddress = owner;
    c.mode = 'ASSISTED';
    c.execution.signer = 'owner-wallet';
    Object.assign(c.risk, {
      orderNotional: '11',
      maxOrderNotional: '11',
      maxMarketExposure: '11',
      maxTotalExposure: '11',
      riskBudget: '1',
      leverage: 1,
    });
    return c;
  });
  route('get', '/configs', async (owner) => {
    const d = (await ledger.read(owner)).value;
    return {
      configs: Object.values(d.configs).map((v) => v.config),
      decisions: d.decisions,
      unresolved: Object.values(d.tickets)
        .filter((v) => v.state === 'unknown')
        .map((v) => ({
          ticketId: v.ticket.id,
          account: owner,
          marketId: v.ticket.config.marketId,
          data: v.ticket.preview.data,
          hash: v.hash,
        })),
    };
  });
  route('post', '/configs', async (owner, req) => {
    const c = agentConfigSchema.parse(req.body.config);
    checkOwner(owner, c);
    const market = await marketById(c.marketId);
    if (c.risk.leverage > (market.maxLeverage ?? 1))
      throw new Error(
        `risk.leverage: maximum verified leverage for ${market.symbol ?? 'this market'} is ${market.maxLeverage ?? 1}×`,
      );
    await ledger.mutate(owner, (d) => {
      const old = d.configs[c.id];
      if (sameConfig(old?.config, c)) return;
      if (c.revision !== (old?.config.revision ?? 0) + 1)
        throw new Error('Configuration revision conflict');
      if (!old && Object.keys(d.configs).length >= 30)
        throw new Error('Maximum 30 saved strategies per wallet');
      d.configs[c.id] = { config: c, versions: [...(old?.versions ?? []), c].slice(-20) };
    });
    return { config: c };
  });
  route('post', '/review', async (owner, req) => {
    const b = z
      .object({ config: agentConfigSchema, ticketId: z.string().uuid().optional() })
      .strict()
      .parse(req.body);
    checkOwner(owner, b.config);
    const { token, document } = await ledger.acquire(owner);
    try {
      const savedConfig = document.configs[b.config.id]?.config;
      if (savedConfig && !sameConfig(savedConfig, b.config))
        throw new Error(
          'Saved configuration changed. Save your edits or reload the current revision before reviewing.',
        );
      const row = b.ticketId ? document.tickets[b.ticketId] : undefined,
        previous = row?.ticket;
      if (
        b.ticketId &&
        (!row ||
          row.state !== 'reviewed' ||
          !previous ||
          previous.expiresAt < Date.now() ||
          !sameConfig(previous.config, b.config))
      )
        throw new Error('Review expired, consumed or configuration changed');
      const result = await prepareOwnerReview(b.config, previous, () =>
        ledger.runtime(document, token),
      );
      let ticket: Ticket | undefined;
      if (result.preview) {
        if (previous) assertSameApproval(previous.preview, result.preview);
        ticket = {
          ...result,
          id: previous?.id ?? randomUUID(),
          config: b.config,
          preview: result.preview,
          expiresAt: result.preview.expiresAt,
        };
      }
      await ledger.saveReview(owner, token, result.decision, ticket);
      return ticket ?? { ...result, config: b.config };
    } finally {
      await ledger.release(owner, token);
    }
  });
  route('post', '/begin', async (owner, req) => {
    await ledger.begin(owner, z.string().uuid().parse(req.body.ticketId));
    return { registered: true };
  });
  route('get', '/status/:ticketId', async (owner, req) => {
    const row = (await ledger.read(owner)).value.tickets[
      z.string().uuid().parse(req.params.ticketId)
    ];
    if (!row) throw new Error('Unknown strategy request');
    const p = row.ticket.preview;
    return { state: row.state, hash: row.hash ?? null, account: p.account, to: p.to, data: p.data };
  });
  route('post', '/rejected', async (owner, req) => {
    const b = z
      .object({ ticketId: z.string().uuid(), walletCode: z.literal(4001) })
      .strict()
      .parse(req.body);
    await ledger.mutate(owner, (d) => {
      const row = d.tickets[b.ticketId];
      if (!row) throw new Error('Unknown strategy request');
      if (row.state === 'unknown' && !row.hash) row.state = 'rejected';
    });
    return { rejected: true };
  });
  route('post', '/receipt', async (owner, req) => {
    const b = z
      .object({
        ticketId: z.string().uuid(),
        hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
        account: addr,
        marketId: addr,
        data: z.string().regex(/^0x(?:[a-fA-F0-9]{2})+$/),
      })
      .strict()
      .parse(req.body);
    if (b.account.toLowerCase() !== owner) throw new Error('Owner mismatch');
    const saved = (await ledger.read(owner)).value.tickets[b.ticketId];
    if (
      !saved ||
      !['unknown', 'confirmed', 'reverted'].includes(saved.state) ||
      (saved.hash && saved.hash.toLowerCase() !== b.hash.toLowerCase())
    )
      throw new Error('No matching submitted strategy request');
    const p = saved.ticket.preview;
    if (
      p.account.toLowerCase() !== owner ||
      saved.ticket.config.marketId.toLowerCase() !== b.marketId.toLowerCase() ||
      p.data.toLowerCase() !== b.data.toLowerCase()
    )
      throw new Error('Receipt conflicts with reviewed strategy');
    const tx = await rpc.getTransaction({ hash: b.hash as `0x${string}` });
    if (
      tx.from.toLowerCase() !== owner ||
      tx.to?.toLowerCase() !== p.to.toLowerCase() ||
      tx.input.toLowerCase() !== p.data.toLowerCase() ||
      tx.value !== 0n
    )
      throw new Error('Transaction does not match the reviewed strategy');
    const evidence = await receipt(b.hash as `0x${string}`, b.marketId, owner as `0x${string}`);
    if (
      !['success', 'reverted'].includes(evidence.receipt.status) ||
      BigInt(evidence.receipt.blockNumber) <= 0n
    )
      throw new Error('A mined matching receipt is required');
    await ledger.mutate(owner, (d) => {
      const row = d.tickets[b.ticketId];
      if (
        !row ||
        !['unknown', 'confirmed', 'reverted'].includes(row.state) ||
        (row.hash && row.hash.toLowerCase() !== b.hash.toLowerCase())
      )
        throw new Error('Strategy request changed during reconciliation');
      const fresh = row.state === 'unknown';
      row.hash = b.hash;
      row.state = evidence.receipt.status === 'success' ? 'confirmed' : 'reverted';
      row.evidence = JSON.parse(
        JSON.stringify(evidence, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
      );
      if (fresh) {
        if (row.state === 'confirmed') {
          d.failureStreak = 0;
          if (row.ticket.decision.signalKey) d.executed[row.ticket.decision.signalKey] = Date.now();
        } else {
          d.failureStreak++;
          d.lastFailureAt = Date.now();
        }
      }
    });
    return { evidence, strategyVerified: true };
  });
  return router;
}
