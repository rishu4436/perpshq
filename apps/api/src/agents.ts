import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AgentStore } from '../../../packages/agent-store';
import { agentConfigSchema, LIVE_BROADCAST_ENABLED } from '../../../packages/agent-engine/config';
import { evaluateHistory } from '../../../packages/agent-engine/history';
import { marketById, detail } from '../../../packages/dreamdex-adapter';
import {
  readPermissions,
  prepareOperatorAction,
  type OperatorAction,
} from '../../../packages/agent-execution';
import { observeAgent } from '../../agent-worker/src/live-data';
export function createAgentRouter() {
  const router = Router();
  let store: AgentStore | undefined;
  // A damaged agent store must not take the existing manual MVP/API down.
  try {
    store = new AgentStore();
  } catch {
    /* Agent routes report unavailable; manual routes stay online. */
  }
  const route = (
    method: 'get' | 'post',
    path: string,
    fn: (req: Request, s: AgentStore) => Promise<unknown>,
  ) =>
    router[method](path, async (req, res: Response) => {
      if (!store) {
        res.status(503).json({
          error: 'Agent state unavailable. Inspect the local SQLite volume; no agent can execute.',
        });
        return;
      }
      try {
        const result = await fn(req, store);
        res
          .type('json')
          .send(JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
      } catch (e) {
        const validation = e instanceof z.ZodError,
          message = validation
            ? e.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')
            : e instanceof Error
              ? e.message
              : 'Agent operation unavailable';
        res
          .status(validation ? 400 : message.includes('conflict') ? 409 : 422)
          .json({ error: message.slice(0, 1500) });
      }
    });
  const id = (req: Request) => z.string().uuid().parse(req.params.id);
  route('get', '/', async (_req, s) => {
    const worker = s.health(),
      connected = !!worker && Date.now() - worker.at <= 30000 && worker.state !== 'stopped';
    const agents = s.list().map((a) => ({
      ...a,
      displayStatus:
        ['simulating', 'awaiting-authorization'].includes(a.runtime.status) && !connected
          ? 'disconnected'
          : a.runtime.status,
      pendingCommands: s.commands(a.config.id).filter((c) => !c.acknowledgedAt),
      lastDecision: s.decisions(a.config.id, 1)[0] ?? null,
    }));
    return {
      schemaVersion: 1,
      agents,
      worker,
      connected,
      controlPlane: 'local-sqlite',
      remoteControlAvailable: false,
      broadcastEnabled: LIVE_BROADCAST_ENABLED,
      chainId: 50383,
      observedAt: Date.now(),
    };
  });
  route('post', '/validate', async (req) => {
    const c = agentConfigSchema.parse(req.body),
      market = await marketById(c.marketId);
    if (c.risk.leverage > (market.maxLeverage ?? 0))
      throw new Error('Configured leverage exceeds the discovered market maximum');
    return {
      valid: true,
      configRevision: c.revision,
      market: {
        id: market.id,
        symbol: market.symbol,
        tickSize: market.tickSize,
        lotSize: market.lotSize,
        minQuantity: market.minQuantity,
        baseDecimals: market.baseDecimals,
        quoteDecimals: market.quoteDecimals,
      },
      warnings: [
        'Configuration validity is not execution authorization. Fresh observations and central policy are checked on every evaluation.',
        ...(c.mode !== 'DRY_RUN'
          ? ['Assisted proposals cannot broadcast. Autonomous activation is disabled in source.']
          : []),
        'Paper fees, funding and cash are user assumptions. Actual account P&L/permissions are not implied.',
      ],
      broadcastEnabled: false,
    };
  });
  route('post', '/', async (req, s) => {
    const body = z
      .object({
        config: agentConfigSchema,
        expectedRevision: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    await marketById(body.config.marketId);
    if (!s.list().some((a) => a.config.id === body.config.id) && s.list().length >= 20)
      throw new Error('This local workspace supports at most 20 configured agents');
    return s.save(body.config, body.expectedRevision);
  });
  route('get', '/:id', async (req, s) => {
    const agentId = id(req);
    return {
      agent: s.get(agentId),
      decisions: s.decisions(agentId),
      events: s.events(agentId),
      commands: s.commands(agentId),
      history: s.history(agentId),
      configurationVersions: s.versions(agentId),
      unresolvedIntents: s.unresolved(agentId),
    };
  });
  route('post', '/:id/commands', async (req, s) => {
    const b = z
      .object({
        type: z.enum(['start', 'stop', 'pause', 'resume', 'emergency-stop']),
        revision: z.number().int().positive(),
        requestId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    return s.command(id(req), b.type, b.revision, Date.now(), b.requestId);
  });
  route('post', '/:id/permissions', async (req, s) => {
    const b = z.object({ revision: z.number().int().positive() }).strict().parse(req.body),
      a = s.get(id(req));
    if (a.config.revision !== b.revision) throw new Error('Configuration version conflict');
    const result = await readPermissions(a.config, await marketById(a.config.marketId));
    s.setPermissions(a.config.id, b.revision, result);
    return result;
  });
  route('post', '/:id/history', async (req, s) => {
    const b = z.object({ revision: z.number().int().positive() }).strict().parse(req.body),
      a = s.get(id(req));
    if (a.config.revision !== b.revision) throw new Error('Configuration version conflict');
    const d = await detail(a.config.marketId, a.config.timeframes[0]);
    const report = {
      ...evaluateHistory(a.config, d.market, d.candles.slice(-500)),
      sourceCandleHash: createHash('sha256')
        .update(JSON.stringify(d.candles.slice(-500)))
        .digest('hex'),
      sourceFetchedAt: d.quality.fetchedAt,
    };
    if (s.get(a.config.id).config.revision !== b.revision)
      throw new Error('Configuration changed during historical evaluation');
    s.saveHistory(a.config.id, report);
    s.event(
      a.config.id,
      'historical-evaluation',
      'Chronological real-candle simulation completed; no historical order book or predictive edge is asserted',
    );
    return report;
  });
  route('get', '/:id/export', async (req, s) => {
    const a = s.get(id(req));
    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      config: a.config,
      nonsecret: true,
      railway:
        a.config.mode === 'DRY_RUN'
          ? {
              environment: {
                AGENT_NETWORK: 'hideki',
                AGENT_MODE: 'DRY_RUN',
                AGENT_STORE_PATH: '/data/agent-studio.sqlite',
                AGENT_CONFIG_FILE: '/data/agent.json',
                AGENT_POLL_MS: '30000',
              },
              instructions:
                'Save config as /data/agent.json on a persistent volume. Deploy only after owner approval. No key is needed or accepted. This UI controls only its local shared SQLite worker.',
            }
          : null,
      broadcastEnabled: false,
    };
  });
  route('get', '/:id/evidence', async (req, s) => {
    const a = s.get(id(req));
    return {
      agentId: a.config.id,
      realTransactions: [],
      paperFills: a.ledger.fills,
      unresolvedIsolatedMockIntents: s.unresolved(a.config.id),
      broadcastEnabled: false,
      explanation:
        'No Agent Studio-authored on-chain transaction exists. Simulated fills are not chain evidence.',
    };
  });
  route('post', '/:id/operator-preview', async (req, s) => {
    const b = z
      .object({
        revision: z.number().int().positive(),
        decisionId: z.string().max(200).optional(),
        action: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('place') }).strict(),
          z.object({ kind: z.literal('cancel'), orderId: z.string().regex(/^\d{1,39}$/) }).strict(),
          z
            .object({
              kind: z.literal('reduce-order'),
              orderId: z.string().regex(/^\d{1,39}$/),
              newQuantityRemaining: z.string().regex(/^\d{1,78}$/),
            })
            .strict(),
        ]),
        approvedData: z
          .string()
          .regex(/^0x(?:[\da-fA-F]{2})+$/)
          .max(4096)
          .optional(),
      })
      .strict()
      .parse(req.body);
    const a = s.get(id(req));
    if (a.config.revision !== b.revision) throw new Error('Configuration version conflict');
    const decision = b.decisionId
      ? s.decisions(a.config.id, 1000).find((d) => d.id === b.decisionId)
      : undefined;
    const action: OperatorAction =
      b.action.kind === 'place'
        ? {
            kind: 'place',
            proposal:
              decision?.proposal ??
              (() => {
                throw new Error('A stored proposal is required');
              })(),
          }
        : b.action;
    const observation =
        b.action.kind === 'place' ? await observeAgent(a.config, a.createdAt) : undefined,
      health = s.health();
    const runtime = {
      ...a.runtime,
      controlAvailable: true,
      leaseValid:
        !!health &&
        s.owns({ workerId: health.workerId, fence: health.fence, expiresAt: 0 }, Date.now()),
      unknownIntent: s.unresolved(a.config.id).length > 0,
    };
    return prepareOperatorAction(a.config, action, {
      decision,
      observation,
      runtime,
      approvedData: b.approvedData as `0x${string}` | undefined,
    });
  });
  return { router, store, close: () => store?.close() };
}
