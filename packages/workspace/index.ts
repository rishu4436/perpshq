import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { AgentStore, AgentRecord } from '../agent-store';
import type { AgentObservation, AgentDecision, AgentAccount } from '../agent-engine/types';
import { paperAccount } from '../agent-engine/paper';
import { agentConfigSchema } from '../agent-engine/config';
import { ledgerSchema, runtimeSchema } from '../agent-store/validation';
import { evaluateHistory } from '../agent-engine/history';
import { gzipSync, gunzipSync } from 'node:zlib';
import { activitySchema, accountingSchema, inboxSchema } from './validation';

export function initializeWorkspace(s: AgentStore) {
  s.db
    .exec(`CREATE TABLE IF NOT EXISTS workspace_records(kind TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS workspace_alerts(id TEXT PRIMARY KEY,dedupe TEXT NOT NULL,created_at INTEGER NOT NULL,record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_conditions(key TEXT PRIMARY KEY,active INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_replays(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,at INTEGER NOT NULL,record TEXT NOT NULL);`);
}
export function records<T>(s: AgentStore, kind: string): T[] {
  return (
    s.db
      .prepare('SELECT record FROM workspace_records WHERE kind=? ORDER BY rowid DESC')
      .all(kind) as { record: string }[]
  ).map((r) => JSON.parse(r.record));
}
export function putRecord(s: AgentStore, kind: string, id: string, value: unknown) {
  s.db
    .prepare(
      'INSERT INTO workspace_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET record=excluded.record',
    )
    .run(kind, id, JSON.stringify(value));
}
export interface InboxAlert {
  id: string;
  key: string;
  at: number;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  agentId?: string;
  acknowledgedAt?: number;
  delivery: 'local-inbox';
}
export function condition(
  s: AgentStore,
  key: string,
  active: boolean,
  input: Omit<InboxAlert, 'id' | 'key' | 'at' | 'delivery'>,
  now = Date.now(),
) {
  const old = s.db.prepare('SELECT active FROM workspace_conditions WHERE key=?').get(key) as
    { active: number } | undefined;
  if (active && !old?.active) {
    const a: InboxAlert = { ...input, id: randomUUID(), key, at: now, delivery: 'local-inbox' };
    s.db
      .prepare('INSERT INTO workspace_alerts VALUES(?,?,?,?)')
      .run(a.id, key, now, JSON.stringify(a));
  }
  s.db
    .prepare(
      'INSERT INTO workspace_conditions VALUES(?,?) ON CONFLICT(key) DO UPDATE SET active=excluded.active',
    )
    .run(key, active ? 1 : 0);
}
export function inbox(s: AgentStore): InboxAlert[] {
  return (
    s.db
      .prepare('SELECT record FROM workspace_alerts ORDER BY created_at DESC,rowid DESC LIMIT 500')
      .all() as { record: string }[]
  ).map((r) => JSON.parse(r.record));
}
export function acknowledgeAlert(s: AgentStore, id: string, now = Date.now()) {
  const row = s.db.prepare('SELECT record FROM workspace_alerts WHERE id=?').get(id) as
    { record: string } | undefined;
  if (!row) throw new Error('Alert not found');
  const alert: InboxAlert = JSON.parse(row.record);
  alert.acknowledgedAt ??= now;
  s.db.prepare('UPDATE workspace_alerts SET record=? WHERE id=?').run(JSON.stringify(alert), id);
  return alert;
}
export function monitorWorkspace(s: AgentStore, now = Date.now()) {
  s.transaction(() => {
    const health = s.health();
    const active = s
      .list()
      .some((a) => ['simulating', 'awaiting-authorization'].includes(a.runtime.status));
    condition(
      s,
      'worker-disconnected',
      active && (!health || now - health.at > 30000 || health.state === 'stopped'),
      {
        severity: 'critical',
        title: 'Worker disconnected',
        detail:
          'Active agents have no current heartbeat. Restart the local worker and inspect recovery before resuming.',
      },
      now,
    );
    for (const a of s.list()) {
      const d = s.decisions(a.config.id, 1)[0];
      condition(
        s,
        'agent-stopped:' + a.config.id,
        !!a.lastError || a.runtime.status === 'emergency-stopped',
        {
          severity: 'critical',
          title: a.config.name + ' needs recovery',
          detail: a.lastError ?? 'Emergency stop is active.',
          agentId: a.config.id,
        },
        now,
      );
      condition(
        s,
        'stale:' + a.config.id,
        !!d &&
          (d.type === 'DATA_UNAVAILABLE' ||
            now - d.evaluatedAt > a.config.risk.maxDataAgeSeconds * 1000) &&
          ['simulating', 'awaiting-authorization'].includes(a.runtime.status),
        {
          severity: 'warning',
          title: a.config.name + ' has stale observations',
          detail: d?.rationale ?? 'No current evaluation',
          agentId: a.config.id,
        },
        now,
      );
      condition(
        s,
        'risk:' + a.config.id,
        !!d?.risk.checks.some((c) => !c.passed && /health|margin|loss/i.test(c.name)),
        {
          severity: 'critical',
          title: a.config.name + ' risk threshold reached',
          detail:
            d?.risk.checks
              .filter((c) => !c.passed)
              .map((c) => c.name + ': ' + c.detail)
              .join('; ') ?? '',
          agentId: a.config.id,
        },
        now,
      );
    }
  });
}
export function recovery(s: AgentStore, now = Date.now()) {
  const worker = s.health();
  return {
    worker,
    connected: !!worker && now - worker.at <= 30000 && worker.state !== 'stopped',
    observedAt: now,
    agents: s.list().map((a) => {
      const last = s.decisions(a.config.id, 1)[0],
        unknown = s.unresolved(a.config.id);
      return {
        id: a.config.id,
        name: a.config.name,
        status: a.runtime.status,
        revision: a.config.revision,
        runId: a.runtime.controlGeneration ?? 0,
        block: a.runtime.blockCursor ?? null,
        lastEvaluationAt: a.lastEvaluationAt ?? null,
        dataAgeMs: a.lastEvaluationAt ? now - a.lastEvaluationAt : null,
        stopReason: a.lastError ?? null,
        failures: a.runtime.consecutiveFailures,
        failedChecks: last?.risk.checks.filter((c) => !c.passed) ?? [],
        unresolved: unknown,
        requirements: [
          ...(a.runtime.status === 'emergency-stopped'
            ? ['Emergency stop is latched; create a separately reviewed configuration.']
            : []),
          ...(unknown.length
            ? ['Reconcile each unknown submission against authoritative transaction evidence.']
            : []),
          'Verify worker heartbeat, network, fresh market/account observations and risk limits before requesting resume.',
        ],
      };
    }),
  };
}

export function lifecycle(
  s: AgentStore,
  id: string,
  action: 'archive' | 'restore' | 'clone',
  now = Date.now(),
) {
  return s.transaction(() => {
    const a = s.get(id);
    if (action === 'clone') {
      // Return a fresh draft; the normal validated save endpoint creates it.
      return {
        ...a.config,
        id: randomUUID(),
        revision: 1,
        name: (a.config.name + ' copy').slice(0, 64),
        mode: 'DRY_RUN' as const,
      };
    }
    if (
      !['configured', 'paused', 'emergency-stopped'].includes(a.runtime.status) ||
      a.ledger.position ||
      a.ledger.orders.length ||
      s.unresolved(id).length ||
      s.commands(id).some((c) => !c.acknowledgedAt)
    )
      throw new Error(
        'Archive/restore requires a stopped, flat agent with no pending commands or unresolved intents',
      );
    if (action === 'restore' && s.list().length >= 20)
      throw new Error('Archive another agent before restoring; maximum 20 active configurations');
    a.archivedAt = action === 'archive' ? now : undefined;
    s.db.prepare('UPDATE agents SET record=? WHERE id=?').run(JSON.stringify(a), id);
    s.event(id, action, 'Configuration ' + action + 'd; ledger and audit history preserved', now);
    return a;
  });
}

export const portfolioSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(64),
    capital: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .refine((v) => new Decimal(v).gt(0) && new Decimal(v).lte('1000000000000')),
    agentIds: z.array(z.string().uuid()).min(1).max(20),
  })
  .strict();
export type SharedPortfolio = z.infer<typeof portfolioSchema>;
export function savePortfolio(s: AgentStore, input: unknown) {
  const p = portfolioSchema.parse(input);
  return s.transaction(() => {
    if (new Set(p.agentIds).size !== p.agentIds.length)
      throw new Error('Duplicate agent membership');
    const existing = records<SharedPortfolio>(s, 'portfolio');
    const old = existing.find((v) => v.id === p.id);
    for (const id of new Set([...p.agentIds, ...(old?.agentIds ?? [])])) {
      const a = s.get(id);
      if (
        a.archivedAt ||
        a.config.mode !== 'DRY_RUN' ||
        !['configured', 'paused'].includes(a.runtime.status) ||
        a.ledger.fills.length ||
        a.ledger.orders.length ||
        a.ledger.position ||
        s.commands(id).some((c) => !c.acknowledgedAt) ||
        s.unresolved(id).length
      )
        throw new Error(
          'Shared capital membership requires unused, stopped dry-run agents without pending work',
        );
      if (existing.some((v) => v.id !== p.id && v.agentIds.includes(id)))
        throw new Error('Agent already belongs to another shared portfolio');
    }
    putRecord(s, 'portfolio', p.id, p);
    return p;
  });
}
export function sharedAccount(
  s: AgentStore,
  record: AgentRecord,
  now: number,
  allPositions = false,
): AgentAccount {
  const own = paperAccount(record.config, record.ledger, now);
  const p = records<SharedPortfolio>(s, 'portfolio').find((p) =>
    p.agentIds.includes(record.config.id),
  );
  if (!p) return own;
  const agents = p.agentIds.map((id) => (id === record.config.id ? record : s.get(id)));
  const accounts = agents.map((a) => paperAccount(a.config, a.ledger, now));
  const equity = agents.reduce(
    (sum, a) => sum.plus(new Decimal(a.ledger.equity).minus(a.ledger.initialEquity)),
    new Decimal(p.capital),
  );
  const margin = accounts.reduce(
    (sum, a, i) => sum.plus(new Decimal(a.totalExposure).div(agents[i].config.risk.leverage)),
    new Decimal(0),
  );
  const positions = accounts.flatMap((a) => a.positions),
    orders = accounts.flatMap((a) => a.orders);
  const market = record.config.marketId.toLowerCase();
  const sum = (a: { notional: string }[]) =>
    a.reduce((n, v) => n.plus(v.notional), new Decimal(0)).toFixed();
  const errors = agents
    .filter(
      (a) =>
        a.ledger.position && now - a.ledger.updatedAt > record.config.risk.maxDataAgeSeconds * 1000,
    )
    .map((a) => 'Shared portfolio position valuation is stale: ' + a.config.name);
  return {
    ...own,
    errors,
    equity: equity.toFixed(),
    availableCollateral: Decimal.max(0, equity.minus(margin)).toFixed(),
    totalExposure: sum([...positions, ...orders]),
    marketExposure: sum(
      [...positions, ...orders].filter((v) => v.marketId.toLowerCase() === market),
    ),
    positionCount: positions.length,
    positions: allPositions ? positions : own.positions,
    orders,
    health: new Decimal(sum([...positions, ...orders])).isZero()
      ? 100
      : equity.div(new Decimal(sum([...positions, ...orders])).mul('.05')).toNumber(),
    sessionPnl: equity.minus(p.capital).toFixed(),
    dailyPnl: accounts.reduce((v, a) => v.plus(a.dailyPnl ?? 0), new Decimal(0)).toFixed(),
  };
}
export function portfolioViews(s: AgentStore, now = Date.now()) {
  return records<SharedPortfolio>(s, 'portfolio').map((p) => ({
    ...p,
    account: sharedAccount(s, s.get(p.agentIds[0]), now, true),
    members: p.agentIds.map((id) => {
      const a = s.get(id);
      return { id, name: a.config.name, status: a.runtime.status, valuedAt: a.ledger.updatedAt };
    }),
  }));
}
export function assertSharedCapital(
  s: AgentStore,
  next: AgentRecord,
  previous: AgentRecord,
  now: number,
) {
  if (!records<SharedPortfolio>(s, 'portfolio').some((p) => p.agentIds.includes(next.config.id)))
    return;
  const before = paperAccount(previous.config, previous.ledger, now),
    after = paperAccount(next.config, next.ledger, now);
  const priorFills = new Set(previous.ledger.fills.map((f) => f.id));
  const newEntry = next.ledger.fills.some((f) => f.kind === 'entry' && !priorFills.has(f.id));
  if (!newEntry && new Decimal(after.totalExposure).lte(before.totalExposure)) return;
  const a = sharedAccount(s, next, now);
  if (a.errors.length) throw new Error(a.errors.join('; '));
  const p = records<SharedPortfolio>(s, 'portfolio').find((p) =>
    p.agentIds.includes(next.config.id),
  )!;
  const margin = p.agentIds.reduce((sum, id) => {
    const r = id === next.config.id ? next : s.get(id);
    return sum.plus(
      new Decimal(paperAccount(r.config, r.ledger, now).totalExposure).div(r.config.risk.leverage),
    );
  }, new Decimal(0));
  if (margin.gt(a.equity) || new Decimal(a.totalExposure).gt(next.config.risk.maxTotalExposure))
    throw new Error('Shared paper capital or exposure limit exceeded; evaluation discarded');
}

export function saveReplay(
  s: AgentStore,
  a: AgentRecord,
  o: AgentObservation,
  d: AgentDecision,
  now: number,
) {
  const snapshot = {
    schemaVersion: 1,
    config: a.config,
    runtime: a.runtime,
    ledger: a.ledger,
    observation: o,
    decision: d,
  };
  s.db
    .prepare('INSERT OR IGNORE INTO agent_replays VALUES(?,?,?,?)')
    .run(d.id, a.config.id, now, JSON.stringify(snapshot));
  s.db
    .prepare(
      'DELETE FROM agent_replays WHERE agent_id=? AND id NOT IN (SELECT id FROM agent_replays WHERE agent_id=? ORDER BY at DESC LIMIT 100)',
    )
    .run(a.config.id, a.config.id);
}
export function replays(s: AgentStore, id: string) {
  return (
    s.db
      .prepare('SELECT record FROM agent_replays WHERE agent_id=? ORDER BY at DESC LIMIT 100')
      .all(id) as { record: string }[]
  ).map(
    (r) =>
      JSON.parse(r.record) as {
        schemaVersion: 1;
        config: AgentRecord['config'];
        observation: AgentObservation;
        decision: AgentDecision;
      },
  );
}
export function compareReplay(s: AgentStore, id: string, decisionId: string) {
  const source = replays(s, id).find((r) => r.decision.id === decisionId);
  if (!source?.observation.detail) throw new Error('Saved replay dataset unavailable');
  const d = source.observation.detail;
  return {
    decisionId,
    configRevision: source.config.revision,
    datasetHash: createHash('sha256').update(JSON.stringify(d.candles)).digest('hex'),
    sourceFetchedAt: d.quality.fetchedAt,
    scenarios: [
      { name: 'Recorded assumptions', fee: 1, slippage: 1, funding: 1 },
      { name: 'Double costs', fee: 2, slippage: 2, funding: 2 },
    ].map((v) => {
      const c = structuredClone(source.config);
      c.paper.feeBps = Math.min(100, c.paper.feeBps * v.fee);
      c.paper.slippageBps = Math.min(c.risk.maxSlippageBps, c.paper.slippageBps * v.slippage);
      c.paper.fundingBpsPerHour = Math.min(
        100,
        Math.max(-100, c.paper.fundingBpsPerHour * v.funding),
      );
      return {
        name: v.name,
        report: evaluateHistory(c, d.market, d.candles, source.decision.evaluatedAt),
      };
    }),
  };
}

const tables = [
  'agents',
  'agent_config_versions',
  'agent_commands',
  'agent_decisions',
  'agent_events',
  'agent_backtests',
  'agent_intents',
  'workspace_records',
  'workspace_alerts',
  'workspace_conditions',
  'agent_replays',
] as const;
type Table = (typeof tables)[number];
export interface WorkspaceBackup {
  format: 'perpshq-local-workspace';
  version: 1;
  createdAt: number;
  tables: Record<Table, Record<string, unknown>[]>;
  checksum: string;
}
export interface PackedBackup {
  encoding: 'gzip-base64';
  payload: string;
}
export function packBackup(b: WorkspaceBackup): PackedBackup {
  const raw = JSON.stringify(b);
  if (Buffer.byteLength(raw) > 256 * 1024 * 1024)
    throw new Error(
      'Workspace exceeds the 256 MB portable backup limit; use a native SQLite backup before pruning old replay evidence',
    );
  const payload = gzipSync(raw).toString('base64');
  if (payload.length > 28 * 1024 * 1024)
    throw new Error(
      'Compressed workspace exceeds the 28 MB import limit; preserve the native SQLite database',
    );
  return { encoding: 'gzip-base64', payload };
}
export function unpackBackup(input: unknown): unknown {
  if (input && typeof input === 'object' && 'encoding' in input) {
    const p = z
      .object({
        encoding: z.literal('gzip-base64'),
        payload: z
          .string()
          .max(28 * 1024 * 1024)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .strict()
      .parse(input);
    return JSON.parse(
      gunzipSync(Buffer.from(p.payload, 'base64'), { maxOutputLength: 256 * 1024 * 1024 }).toString(
        'utf8',
      ),
    );
  }
  return input;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function exportWorkspace(s: AgentStore): WorkspaceBackup {
  return s.transaction(() => {
    const data = Object.fromEntries(
      tables.map((t) => [t, s.db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all()]),
    ) as WorkspaceBackup['tables'];
    return {
      format: 'perpshq-local-workspace',
      version: 1,
      createdAt: Date.now(),
      tables: data,
      checksum: hash(data),
    };
  });
}
export function restoreWorkspace(s: AgentStore, input: unknown, now = Date.now()) {
  const b = z
    .object({
      format: z.literal('perpshq-local-workspace'),
      version: z.literal(1),
      createdAt: z.number().int().nonnegative(),
      tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(100000)),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .parse(input);
  if (
    hash(b.tables) !== b.checksum ||
    Object.keys(b.tables).sort().join() !== [...tables].sort().join()
  )
    throw new Error('Backup checksum or table set invalid');
  return s.transaction(() => {
    const lease = s.db.prepare('SELECT expires_at FROM agent_lease WHERE id=1').get() as
      { expires_at: number } | undefined;
    if (lease && lease.expires_at > now) throw new Error('Stop the local worker before restoring');
    if (
      tables
        .filter((t) => t !== 'workspace_conditions')
        .some((t) => (s.db.prepare('SELECT COUNT(*) as n FROM ' + t).get() as { n: number }).n > 0)
    )
      throw new Error(
        'Restore requires an empty workspace; existing records are never overwritten',
      );
    s.db.prepare('DELETE FROM workspace_conditions').run();
    for (const t of tables) {
      const cols = (s.db.prepare('PRAGMA table_info(' + t + ')').all() as { name: string }[]).map(
        (c) => c.name,
      );
      for (const row of b.tables[t]) {
        if (
          Object.keys(row).sort().join() !== cols.slice().sort().join() ||
          Object.values(row).some(
            (v) => v !== null && typeof v !== 'string' && typeof v !== 'number',
          )
        )
          throw new Error('Invalid backup row: ' + t);
        if (t === 'agents') {
          const r = JSON.parse(String(row.record)) as AgentRecord;
          r.config = agentConfigSchema.parse(r.config);
          r.runtime = runtimeSchema.parse(r.runtime);
          r.ledger = ledgerSchema.parse(r.ledger);
          if (r.config.id !== row.id || r.config.revision !== row.revision)
            throw new Error('Backup identity mismatch');
          if (
            r.archivedAt !== undefined &&
            (!Number.isSafeInteger(r.archivedAt) || r.archivedAt < 0)
          )
            throw new Error('Invalid archive timestamp');
          if (r.runtime.status !== 'emergency-stopped') r.runtime.status = 'paused';
          r.runtime.leaseValid = false;
          row.record = JSON.stringify(r);
        }
        if (t === 'agent_config_versions') {
          const c = agentConfigSchema.parse(JSON.parse(String(row.record)));
          if (c.id !== row.agent_id || c.revision !== row.revision)
            throw new Error('Backup configuration identity mismatch');
        }
        if (t === 'agent_intents') {
          const i = z
            .object({
              key: z.string(),
              agentId: z.string().uuid(),
              revision: z.number().int().positive(),
              owner: z.string().regex(/^0x[\da-fA-F]{40}$/),
              operator: z.string().regex(/^0x[\da-fA-F]{40}$/),
              marketId: z.string().regex(/^0x[\da-fA-F]{40}$/),
              decisionId: z.string(),
              data: z.string().regex(/^0x(?:[\da-fA-F]{2})*$/),
              nonce: z.number().int().nonnegative(),
              createdAt: z.number().int().nonnegative(),
              state: z.enum(['prepared', 'sent', 'unknown', 'confirmed', 'reverted', 'rejected']),
              hash: z
                .string()
                .regex(/^0x[\da-fA-F]{64}$/)
                .optional(),
              kind: z.literal('MOCK'),
            })
            .strict()
            .parse(JSON.parse(String(row.record)));
          if (
            i.key !== row.key ||
            i.agentId !== row.agent_id ||
            i.state !== row.state ||
            i.operator !== row.operator ||
            i.nonce !== row.nonce
          )
            throw new Error('Backup intent identity mismatch');
        }
        if (t === 'workspace_records') {
          const value = JSON.parse(String(row.record));
          if (!['portfolio', 'activity', 'accounting'].includes(String(row.kind)))
            throw new Error('Unsupported workspace record');
          if (row.kind === 'portfolio') portfolioSchema.parse(value);
          if (row.kind === 'activity') {
            const activity = activitySchema
              .extend({ source: z.literal('browser-reported') })
              .parse(value);
            if (activity.id !== row.id) throw new Error('Backup activity identity mismatch');
          }
          if (row.kind === 'accounting') accountingSchema.parse(value);
        }
        if (t === 'workspace_alerts') {
          const alert = inboxSchema.parse(JSON.parse(String(row.record)));
          if (alert.id !== row.id || alert.key !== row.dedupe || alert.at !== row.created_at)
            throw new Error('Backup alert identity mismatch');
        }
        if (
          ['agent_decisions', 'agent_backtests', 'agent_replays', 'workspace_alerts'].includes(t)
        ) {
          const value = JSON.parse(String(row.record));
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Invalid saved evidence');
        }
        if (t === 'agent_commands' && !row.acknowledged_at) {
          row.acknowledged_at = now;
          row.result = 'rejected: restored workspace requires new reviewed commands';
        }
        s.db
          .prepare(
            'INSERT INTO ' +
              t +
              ' (' +
              cols.join(',') +
              ') VALUES (' +
              cols.map(() => '?').join(',') +
              ')',
          )
          .run(...cols.map((c) => row[c] as string | number | null));
      }
    }
    // Parse every restored ledger and check relational ownership before committing anything.
    const agents = s.list(true),
      ids = new Set(agents.map((a) => a.config.id));
    for (const t of [
      'agent_config_versions',
      'agent_commands',
      'agent_decisions',
      'agent_events',
      'agent_backtests',
      'agent_intents',
      'agent_replays',
    ] as const)
      for (const r of b.tables[t])
        if (!ids.has(String(r.agent_id))) throw new Error('Backup references a missing agent');
    for (const p of records<SharedPortfolio>(s, 'portfolio')) {
      portfolioSchema.parse(p);
      if (p.agentIds.some((id) => !ids.has(id)))
        throw new Error('Backup portfolio references a missing agent');
    }
    return { restored: agents.length, paused: true, unresolved: s.unresolved().length };
  });
}
