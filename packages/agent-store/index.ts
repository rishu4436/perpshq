import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ledgerSchema, runtimeSchema } from './validation';
import { agentConfigSchema, type AgentConfig } from '../agent-engine/config';
import type { AgentDecision, AgentRuntime, AgentStatus, AgentAccount } from '../agent-engine/types';
import { initialLedger, type PaperLedger } from '../agent-engine/paper';
export interface AgentRecord {
  config: AgentConfig;
  runtime: AgentRuntime;
  ledger: PaperLedger;
  createdAt: number;
  updatedAt: number;
  lastEvaluationAt?: number;
  lastError?: string;
  lastAccount?: AgentAccount;
  permissions?: unknown;
}
export interface AgentCommand {
  id: string;
  agentId: string;
  revision: number;
  type: 'start' | 'stop' | 'pause' | 'resume' | 'emergency-stop';
  requestedAt: number;
  acknowledgedAt?: number;
  result?: string;
}
export interface AgentEvent {
  id: number;
  agentId: string;
  at: number;
  kind: string;
  message: string;
}
export interface WorkerLease {
  workerId: string;
  fence: number;
  expiresAt: number;
}
export interface ExecutionIntent {
  key: string;
  agentId: string;
  revision: number;
  owner: string;
  operator: string;
  marketId: string;
  decisionId: string;
  data: string;
  nonce: number;
  createdAt: number;
  state: 'prepared' | 'sent' | 'unknown' | 'confirmed' | 'reverted' | 'rejected';
  hash?: string;
  kind: 'MOCK';
}
const serialize = (v: unknown) => JSON.stringify(v);
export class AgentStore {
  readonly db: DatabaseSync;
  constructor(path = process.env.AGENT_STORE_PATH ?? 'data/agent-studio.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS agent_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO agent_meta VALUES('schema','1');
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_config_versions(agent_id TEXT NOT NULL,revision INTEGER NOT NULL,at INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(agent_id,revision));
      CREATE TABLE IF NOT EXISTS agent_commands(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,requested_at INTEGER NOT NULL,acknowledged_at INTEGER,result TEXT);
      CREATE TABLE IF NOT EXISTS agent_decisions(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,at INTEGER NOT NULL,record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_decisions_time ON agent_decisions(agent_id,at);
      CREATE TABLE IF NOT EXISTS agent_events(id INTEGER PRIMARY KEY AUTOINCREMENT,agent_id TEXT NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_lease(id INTEGER PRIMARY KEY CHECK(id=1),worker_id TEXT NOT NULL,fence INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_backtests(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,at INTEGER NOT NULL,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_heartbeat(id INTEGER PRIMARY KEY CHECK(id=1),record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_intents(key TEXT PRIMARY KEY,agent_id TEXT NOT NULL,state TEXT NOT NULL,operator TEXT NOT NULL,nonce INTEGER NOT NULL,record TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS agent_operator_nonce ON agent_intents(operator,nonce) WHERE state!='rejected';`);
    const version = this.db.prepare("SELECT value FROM agent_meta WHERE key='schema'").get() as {
      value: string;
    };
    if (version.value !== '1')
      throw new Error('Unsupported agent database schema; migration is required');
    const check = this.db.prepare('PRAGMA quick_check').get() as Record<string, string>;
    if (Object.values(check)[0] !== 'ok') throw new Error('Agent persistent state is corrupted');
    if (path !== ':memory:' && process.platform !== 'win32') chmodSync(path, 0o600);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private parse(text: string): AgentRecord {
    const r = JSON.parse(text) as AgentRecord;
    r.config = agentConfigSchema.parse(r.config);
    r.runtime = runtimeSchema.parse(r.runtime);
    r.ledger = ledgerSchema.parse(r.ledger);
    if (
      r.ledger.position &&
      r.ledger.position.marketId.toLowerCase() !== r.config.marketId.toLowerCase()
    )
      throw new Error('Paper position and agent market do not match');
    return r;
  }
  list(): AgentRecord[] {
    return (
      this.db.prepare('SELECT record FROM agents ORDER BY rowid DESC').all() as { record: string }[]
    ).map((r) => this.parse(r.record));
  }
  get(id: string): AgentRecord {
    const row = this.db.prepare('SELECT record FROM agents WHERE id=?').get(id) as
      { record: string } | undefined;
    if (!row) throw new Error('Agent not found');
    return this.parse(row.record);
  }
  private write(r: AgentRecord) {
    this.db
      .prepare('UPDATE agents SET revision=?,record=? WHERE id=?')
      .run(r.config.revision, serialize(r), r.config.id);
  }
  save(input: AgentConfig, expectedRevision?: number, now = Date.now()): AgentRecord {
    const config = agentConfigSchema.parse(input);
    return this.transaction(() => {
      const old = this.db.prepare('SELECT record FROM agents WHERE id=?').get(config.id) as
        { record: string } | undefined;
      if (old) {
        const record = this.parse(old.record);
        if (
          expectedRevision !== record.config.revision ||
          config.revision !== record.config.revision + 1
        )
          throw new Error('Configuration version conflict; reload before editing');
        if (
          [
            'simulating',
            'awaiting-authorization',
            'running',
            'recovering',
            'emergency-stopped',
          ].includes(record.runtime.status) ||
          this.unresolved(config.id).length
        )
          throw new Error('Pause and reconcile this agent before editing');
        if (record.ledger.position || record.ledger.orders.length)
          throw new Error(
            'Paper exposure exists: create a new agent to change its configuration without reinterpreting the ledger',
          );
        if (
          record.ledger.fills.length &&
          (record.config.marketId !== config.marketId ||
            JSON.stringify(record.config.paper) !== JSON.stringify(config.paper))
        )
          throw new Error(
            'Paper history exists: create a new agent to change market or accounting assumptions',
          );
        const next = {
          ...record,
          config,
          updatedAt: now,
          runtime: { ...record.runtime, lastSignalKey: undefined, status: 'configured' as const },
        };
        if (!record.ledger.fills.length) next.ledger = initialLedger(config, now);
        this.write(next);
        this.db
          .prepare('INSERT INTO agent_config_versions VALUES(?,?,?,?)')
          .run(config.id, config.revision, now, serialize(config));
        this.event(
          config.id,
          'configuration-updated',
          'Configuration revision ' + config.revision + ' saved locally',
          now,
        );
        return next;
      }
      if (expectedRevision !== undefined || config.revision !== 1)
        throw new Error('A new configuration starts at revision 1');
      const record: AgentRecord = {
        config,
        createdAt: now,
        updatedAt: now,
        runtime: {
          consecutiveFailures: 0,
          transactionTimes: [],
          unknownIntent: false,
          leaseValid: false,
          controlAvailable: true,
          cursor: 0,
          status: 'configured',
        },
        ledger: initialLedger(config, now),
      };
      this.db
        .prepare('INSERT INTO agents VALUES(?,?,?)')
        .run(config.id, config.revision, serialize(record));
      this.db
        .prepare('INSERT INTO agent_config_versions VALUES(?,?,?,?)')
        .run(config.id, config.revision, now, serialize(config));
      this.event(
        config.id,
        'configured',
        'Agent configuration saved; no worker has started it',
        now,
      );
      return record;
    });
  }
  event(id: string, kind: string, message: string, now = Date.now()) {
    this.db
      .prepare('INSERT INTO agent_events(agent_id,at,kind,message) VALUES(?,?,?,?)')
      .run(id, now, kind, message.slice(0, 1000));
  }
  events(id: string, limit = 100): AgentEvent[] {
    return this.db
      .prepare(
        'SELECT id,agent_id as agentId,at,kind,message FROM agent_events WHERE agent_id=? ORDER BY id DESC LIMIT ?',
      )
      .all(id, Math.min(limit, 1000)) as unknown as AgentEvent[];
  }
  decisions(id: string, limit = 100): AgentDecision[] {
    return (
      this.db
        .prepare('SELECT record FROM agent_decisions WHERE agent_id=? ORDER BY at DESC LIMIT ?')
        .all(id, Math.min(limit, 1000)) as { record: string }[]
    ).map((r) => JSON.parse(r.record));
  }
  command(
    agentId: string,
    type: AgentCommand['type'],
    revision: number,
    now = Date.now(),
    requestId: string = randomUUID(),
  ): AgentCommand {
    return this.transaction(() => {
      const duplicate = this.db
        .prepare('SELECT agent_id as agentId,revision,kind as type FROM agent_commands WHERE id=?')
        .get(requestId) as Pick<AgentCommand, 'agentId' | 'revision' | 'type'> | undefined;
      if (duplicate) {
        if (
          duplicate.agentId !== agentId ||
          duplicate.type !== type ||
          duplicate.revision !== revision
        )
          throw new Error('Command request ID was reused with different parameters');
        return this.db
          .prepare(
            'SELECT id,agent_id as agentId,revision,kind as type,requested_at as requestedAt,acknowledged_at as acknowledgedAt,result FROM agent_commands WHERE id=?',
          )
          .get(requestId) as unknown as AgentCommand;
      }
      const a = this.get(agentId);
      if (a.config.revision !== revision) throw new Error('Configuration version conflict');
      if (['start', 'resume'].includes(type) && a.config.mode === 'AUTONOMOUS_TESTNET')
        throw new Error(
          'Autonomous activation is disabled in source. Dry-run and assisted observation never broadcast.',
        );
      if (['start', 'resume'].includes(type) && a.runtime.status === 'emergency-stopped')
        throw new Error(
          'Emergency stop is latched; create a separately reviewed configuration to restart',
        );
      const cmd = { id: requestId, agentId, type, revision, requestedAt: now };
      this.db
        .prepare(
          'INSERT INTO agent_commands(id,agent_id,revision,kind,requested_at) VALUES(?,?,?,?,?)',
        )
        .run(cmd.id, agentId, revision, type, now);
      this.event(
        agentId,
        'command-requested',
        type + ' requested; worker acknowledgement pending',
        now,
      );
      return cmd;
    });
  }
  commands(id?: string): AgentCommand[] {
    return this.db
      .prepare(
        `SELECT id,agent_id as agentId,revision,kind as type,requested_at as requestedAt,acknowledged_at as acknowledgedAt,result FROM agent_commands ${id ? 'WHERE agent_id=?' : ''} ORDER BY requested_at DESC,rowid DESC LIMIT 100`,
      )
      .all(...(id ? [id] : [])) as unknown as AgentCommand[];
  }
  acquire(workerId: string, now: number, ttl = 30000): WorkerLease | null {
    return this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM agent_lease WHERE id=1').get() as
        { worker_id: string; fence: number; expires_at: number } | undefined;
      // A repeated configured worker ID is still a separate process. Only renew() extends ownership.
      if (old && old.expires_at > now) return null;
      const fence = (old?.fence ?? 0) + 1;
      this.db
        .prepare(
          'INSERT INTO agent_lease VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET worker_id=excluded.worker_id,fence=excluded.fence,expires_at=excluded.expires_at',
        )
        .run(workerId, fence, now + ttl);
      return { workerId, fence, expiresAt: now + ttl };
    });
  }
  owns(lease: WorkerLease, now: number): boolean {
    const row = this.db
      .prepare('SELECT worker_id,fence,expires_at FROM agent_lease WHERE id=1')
      .get() as { worker_id: string; fence: number; expires_at: number } | undefined;
    return (
      !!row && row.worker_id === lease.workerId && row.fence === lease.fence && row.expires_at > now
    );
  }
  renew(lease: WorkerLease, now: number, ttl = 30000): boolean {
    const result = this.db
      .prepare(
        'UPDATE agent_lease SET expires_at=? WHERE id=1 AND worker_id=? AND fence=? AND expires_at>?',
      )
      .run(now + ttl, lease.workerId, lease.fence, now);
    if (result.changes) lease.expiresAt = now + ttl;
    return !!result.changes;
  }
  release(lease: WorkerLease, now: number) {
    this.db
      .prepare('UPDATE agent_lease SET expires_at=? WHERE id=1 AND worker_id=? AND fence=?')
      .run(now, lease.workerId, lease.fence);
  }
  heartbeat(lease: WorkerLease, now: number, state: string, error?: string) {
    if (!this.owns(lease, now)) throw new Error('Worker lease lost');
    this.db
      .prepare(
        'INSERT INTO agent_heartbeat VALUES(1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
      )
      .run(
        serialize({
          workerId: lease.workerId,
          fence: lease.fence,
          at: now,
          state,
          error,
          network: 50383,
          broadcastEnabled: false,
          control: 'local-sqlite',
        }),
      );
  }
  health() {
    const row = this.db.prepare('SELECT record FROM agent_heartbeat WHERE id=1').get() as
      { record: string } | undefined;
    return row
      ? (JSON.parse(row.record) as {
          workerId: string;
          fence: number;
          at: number;
          state: string;
          error?: string;
          network: number;
          broadcastEnabled: false;
          control: string;
        })
      : null;
  }
  acknowledge(lease: WorkerLease, now: number) {
    this.transaction(() => {
      if (!this.owns(lease, now)) throw new Error('Worker lease lost');
      const pending = this.db
        .prepare(
          'SELECT id,agent_id,revision,kind FROM agent_commands WHERE acknowledged_at IS NULL ORDER BY requested_at,rowid',
        )
        .all() as { id: string; agent_id: string; revision: number; kind: AgentCommand['type'] }[];
      for (const cmd of pending) {
        const a = this.get(cmd.agent_id);
        let result = 'acknowledged';
        if (a.config.revision !== cmd.revision) result = 'rejected: configuration changed';
        else if (
          (cmd.kind === 'start' || cmd.kind === 'resume') &&
          (a.config.mode === 'AUTONOMOUS_TESTNET' ||
            a.runtime.status === 'emergency-stopped' ||
            this.unresolved(a.config.id).length)
        )
          result = 'rejected: activation gate or unresolved intent';
        else {
          const status: AgentStatus =
            cmd.kind === 'emergency-stop'
              ? 'emergency-stopped'
              : cmd.kind === 'start' || cmd.kind === 'resume'
                ? a.config.mode === 'DRY_RUN'
                  ? 'simulating'
                  : 'awaiting-authorization'
                : 'paused';
          a.runtime.status = status;
          a.runtime.leaseValid = true;
          a.updatedAt = now;
          this.write(a);
          this.event(
            a.config.id,
            status,
            'Worker acknowledged ' +
              cmd.kind +
              '. Existing positions/orders are not automatically closed/cancelled.',
            now,
          );
        }
        this.db
          .prepare('UPDATE agent_commands SET acknowledged_at=?,result=? WHERE id=?')
          .run(now, result, cmd.id);
      }
    });
  }
  commitEvaluation(
    lease: WorkerLease,
    revision: number,
    record: AgentRecord,
    decision: AgentDecision,
    now: number,
  ) {
    this.transaction(() => {
      if (!this.owns(lease, now)) throw new Error('Worker lease lost; evaluation discarded');
      const current = this.get(record.config.id);
      const pause = this.db
        .prepare(
          "SELECT id FROM agent_commands WHERE agent_id=? AND acknowledged_at IS NULL AND kind IN ('pause','stop','emergency-stop') LIMIT 1",
        )
        .get(record.config.id);
      if (
        current.config.revision !== revision ||
        !['simulating', 'awaiting-authorization'].includes(current.runtime.status) ||
        pause
      )
        throw new Error('Control/configuration changed during evaluation; result discarded');
      if (record.runtime.cursor < current.runtime.cursor)
        throw new Error('Evaluation cursor cannot move backwards');
      if (
        current.runtime.blockCursor &&
        (!record.runtime.blockCursor ||
          BigInt(record.runtime.blockCursor) < BigInt(current.runtime.blockCursor))
      )
        throw new Error('Chain cursor cannot move backwards');
      this.parse(serialize(record));
      this.db
        .prepare('INSERT OR IGNORE INTO agent_decisions VALUES(?,?,?,?)')
        .run(decision.id, decision.agentId, decision.evaluatedAt, serialize(decision));
      this.write(record);
      this.event(record.config.id, decision.type, decision.rationale, now);
      this.db
        .prepare(
          'DELETE FROM agent_decisions WHERE agent_id=? AND id NOT IN (SELECT id FROM agent_decisions WHERE agent_id=? ORDER BY at DESC LIMIT 1000)',
        )
        .run(record.config.id, record.config.id);
    });
  }
  fail(lease: WorkerLease, id: string, message: string, now: number) {
    this.transaction(() => {
      if (!this.owns(lease, now)) return;
      const r = this.get(id);
      if (r.runtime.status === 'emergency-stopped' || r.runtime.status === 'paused') return;
      r.runtime.status = 'paused';
      r.runtime.consecutiveFailures++;
      r.runtime.lastFailureAt = now;
      r.lastError = message;
      r.updatedAt = now;
      this.write(r);
      this.event(id, 'circuit-breaker', message, now);
    });
  }
  setPermissions(id: string, revision: number, result: unknown, now = Date.now()) {
    this.transaction(() => {
      const r = this.get(id);
      if (r.config.revision !== revision) throw new Error('Configuration version conflict');
      r.permissions = result;
      r.updatedAt = now;
      this.write(r);
      this.event(
        id,
        'permissions-read',
        'Read-only market-specific permission observation saved',
        now,
      );
    });
  }
  unresolved(agentId?: string): ExecutionIntent[] {
    return (
      this.db
        .prepare(
          `SELECT record FROM agent_intents WHERE state IN ('prepared','sent','unknown') ${agentId ? 'AND agent_id=?' : ''}`,
        )
        .all(...(agentId ? [agentId] : [])) as { record: string }[]
    ).map((r) => JSON.parse(r.record));
  }
  intent(key: string): ExecutionIntent | undefined {
    const r = this.db.prepare('SELECT record FROM agent_intents WHERE key=?').get(key) as
      { record: string } | undefined;
    return r ? JSON.parse(r.record) : undefined;
  }
  reserveIntent(
    lease: WorkerLease,
    input: Omit<ExecutionIntent, 'nonce' | 'state'>,
    pendingNonce: number,
    now: number,
  ): ExecutionIntent {
    return this.transaction(() => {
      if (!this.owns(lease, now)) throw new Error('Worker lease lost');
      if (
        this.intent(input.key) ||
        this.unresolved().some((i) => i.operator.toLowerCase() === input.operator.toLowerCase())
      )
        throw new Error('Duplicate or unresolved execution intent');
      const max = this.db
        .prepare(
          "SELECT MAX(nonce) as nonce FROM agent_intents WHERE operator=? AND state!='rejected'",
        )
        .get(input.operator.toLowerCase()) as { nonce: number | null };
      const nonce = Math.max(pendingNonce, (max.nonce ?? -1) + 1);
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Invalid pending nonce');
      const record: ExecutionIntent = {
        ...input,
        operator: input.operator.toLowerCase(),
        nonce,
        state: 'prepared',
      };
      this.db
        .prepare('INSERT INTO agent_intents VALUES(?,?,?,?,?,?)')
        .run(
          record.key,
          record.agentId,
          record.state,
          record.operator,
          record.nonce,
          serialize(record),
        );
      return record;
    });
  }
  updateIntent(key: string, state: ExecutionIntent['state'], hash?: string) {
    const i = this.intent(key);
    if (!i) throw new Error('Intent not found');
    if (['confirmed', 'reverted', 'rejected'].includes(i.state))
      throw new Error('Intent is already terminal');
    i.state = state;
    if (hash) i.hash = hash;
    this.db
      .prepare('UPDATE agent_intents SET state=?,record=? WHERE key=?')
      .run(state, serialize(i), key);
  }
  versions(id: string) {
    this.get(id);
    return (
      this.db
        .prepare(
          'SELECT revision,at,record FROM agent_config_versions WHERE agent_id=? ORDER BY revision DESC',
        )
        .all(id) as { revision: number; at: number; record: string }[]
    ).map((r) => ({
      revision: r.revision,
      at: r.at,
      config: agentConfigSchema.parse(JSON.parse(r.record)),
    }));
  }
  saveHistory(id: string, report: unknown, now = Date.now()) {
    this.get(id);
    this.db
      .prepare('INSERT INTO agent_backtests VALUES(?,?,?,?)')
      .run(randomUUID(), id, now, serialize(report));
  }
  history(id: string) {
    return (
      this.db
        .prepare('SELECT record FROM agent_backtests WHERE agent_id=? ORDER BY at DESC LIMIT 10')
        .all(id) as { record: string }[]
    ).map((v) => JSON.parse(v.record));
  }
  close() {
    this.db.close();
  }
}
