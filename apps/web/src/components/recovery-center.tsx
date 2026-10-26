import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Archive, Download, RefreshCw, Shield } from 'lucide-react';
import type { Market, MarketDetail } from '../../../../packages/shared-types';
import type { AgentConfig } from '../../../../packages/agent-engine/config';
import type { AccountingReport } from '../../../../packages/accounting';
import type {
  recovery,
  portfolioViews,
  replays,
  compareReplay,
  InboxAlert,
  PackedBackup,
} from '../../../../packages/workspace';
import { ReadinessChecklist } from './readiness-checklist';
import { api, download, errorMessage, fmt, type AccountData } from '../lib';
import type { useWallet } from '../wallet';
import { flushActivity, type ActivityEntry } from '../activity';
import { Badge, ErrorNote } from './ui';
import { exportBrowserStorage } from '../storage';
import './recovery-center.css';
type Recovery = ReturnType<typeof recovery>;
interface State {
  recovery: Recovery;
  alerts: InboxAlert[];
  portfolios: ReturnType<typeof portfolioViews>;
  archived: { id: string; name: string }[];
  activities: ActivityEntry[];
  accounting: AccountingReport[];
}
const when = (t?: number | null) => (t ? new Date(t).toLocaleString() : 'Not observed');
const tabs = [
  'Recovery',
  'Readiness',
  'Order activity',
  'Accounting',
  'Backups',
  'Decision replay',
  'Shared capital',
  'Alert inbox',
];
export default function RecoveryCenter({
  wallet,
  account,
  market,
  detail,
}: {
  wallet: ReturnType<typeof useWallet>;
  account?: AccountData;
  market?: Market;
  detail?: MarketDetail;
}) {
  const qc = useQueryClient(),
    [tab, setTab] = useState(tabs[0]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(''),
    [decision, setDecision] = useState(''),
    [comparison, setComparison] = useState<ReturnType<typeof compareReplay>>(),
    [capital, setCapital] = useState('1000'),
    [poolName, setPoolName] = useState('Shared research portfolio'),
    [members, setMembers] = useState<string[]>([]),
    [hours, setHours] = useState('24');
  const q = useQuery({
    queryKey: ['workspace'],
    queryFn: () => api<State>('/workspace'),
    refetchInterval: 10000,
  });
  const s = q.data,
    agentId = selected || s?.recovery.agents[0]?.id;
  const rq = useQuery({
    queryKey: ['replays', agentId],
    queryFn: () => api<ReturnType<typeof replays>>('/workspace/agents/' + agentId + '/replays'),
    enabled: tab === 'Decision replay' && !!agentId,
  });
  const replay = rq.data?.find((r) => r.decision.id === decision) ?? rq.data?.[0];
  useEffect(() => {
    void flushActivity();
    const t = setInterval(() => void flushActivity(), 15000);
    return () => clearInterval(t);
  }, []);
  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(success);
      await qc.invalidateQueries({ queryKey: ['workspace'] });
      await qc.invalidateQueries({ queryKey: ['agents'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function backup() {
    const server = await api<PackedBackup>('/workspace/backup');
    const browser = exportBrowserStorage(localStorage);
    const data = JSON.stringify(
      { format: 'perpshq-complete-backup', version: 1, server, browser },
      null,
      2,
    );
    if (new Blob([data]).size > 32 * 1024 * 1024)
      throw new Error(
        'Complete backup exceeds the 32 MB portable import limit; preserve the native database and export browser journals separately.',
      );
    download('perpshq-workspace-' + new Date().toISOString().slice(0, 10) + '.json', data);
  }
  async function restore(file: File) {
    if (file.size > 32 * 1024 * 1024) throw new Error('Backup exceeds 32 MB');
    const b = JSON.parse(await file.text()) as {
      format: string;
      version: number;
      server: unknown;
      browser: Record<string, string>;
    };
    if (
      b.format !== 'perpshq-complete-backup' ||
      b.version !== 1 ||
      !b.browser ||
      typeof b.browser !== 'object' ||
      Array.isArray(b.browser) ||
      Object.entries(b.browser).some(([k, v]) => !k.startsWith('perpshq.') || typeof v !== 'string')
    )
      throw new Error('Unsupported complete backup');
    for (const k of [
      'perpshq.journal',
      'perpshq.plans',
      'perpshq.transactions',
      'perpshq.unresolvedSubmission',
    ]) {
      const v = localStorage.getItem(k);
      if (v && v !== '[]' && v !== 'null')
        throw new Error(
          'Restore into an empty browser workspace; existing journal, transactions or unresolved submissions are preserved.',
        );
    }
    const old = Object.fromEntries(Object.keys(b.browser).map((k) => [k, localStorage.getItem(k)]));
    try {
      for (const [k, v] of Object.entries(b.browser)) localStorage.setItem(k, v);
      await api('/workspace/restore', b.server);
    } catch (e) {
      for (const [k, v] of Object.entries(old)) {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      }
      throw e;
    }
    location.reload();
  }
  const accountReports =
    s?.accounting.filter(
      (a) => a.account.toLowerCase() === (wallet.address ?? account?.address)?.toLowerCase(),
    ) ?? [];
  return (
    <div className="recovery-center">
      <section className="control-intro">
        <div className="eyebrow">PERPSHQ / OPERATIONS</div>
        <h2>Clarity before the next move.</h2>
        <p>Recover safely, inspect the evidence, and keep your workspace under your control.</p>
        <Badge>LOCAL WORKSPACE</Badge>
      </section>
      <div className="control-tabs" role="tablist" aria-label="Recovery Center sections">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
            {t === 'Alert inbox' && s?.alerts.some((a) => !a.acknowledgedAt) ? ' •' : ''}
          </button>
        ))}
      </div>
      <ErrorNote error={error || q.error || rq.error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {tab === 'Recovery' && (
        <>
          <div className="control-summary">
            <Shield />
            <div>
              <strong>{s?.recovery.connected ? 'Worker connected' : 'Worker disconnected'}</strong>
              <p>
                Heartbeat {when(s?.recovery.worker?.at)} · Worker fence{' '}
                {s?.recovery.worker?.fence ?? '—'}
              </p>
            </div>
            <button className="secondary" onClick={() => q.refetch()}>
              <RefreshCw size={15} />
              Refresh status
            </button>
          </div>
          {s?.recovery.agents.map((a) => (
            <section className="panel control-card" key={a.id}>
              <div className="panel-head">
                <h3>{a.name}</h3>
                <Badge>{a.status}</Badge>
              </div>
              <div className="control-card-body">
                <p>
                  Run {a.runId} · Revision {a.revision} · Block {a.block ?? '—'} · Last evaluation{' '}
                  {when(a.lastEvaluationAt)}
                </p>
                {a.stopReason && <p className="notice">{a.stopReason}</p>}
                <ul>
                  {a.failedChecks.map((c) => (
                    <li key={c.name}>
                      <strong>{c.name}</strong> — {c.detail}
                    </li>
                  ))}
                  {a.requirements.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p>
                  {a.unresolved.length} unresolved execution intents · {a.failures} consecutive
                  failures
                </p>
                <div className="control-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const c = await api<AgentConfig>(
                          '/workspace/agents/' + a.id + '/lifecycle',
                          { action: 'clone' },
                        );
                        await api('/agents', { config: c });
                      }, 'Fresh dry-run configuration created. Review it in Agent Studio.')
                    }
                  >
                    Clone as dry run
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api('/workspace/agents/' + a.id + '/lifecycle', { action: 'archive' }),
                        'Agent archived with its history preserved.',
                      )
                    }
                  >
                    <Archive size={14} />
                    Archive
                  </button>
                </div>
              </div>
            </section>
          ))}
          {!s?.recovery.agents.length && (
            <p className="notice">Create an agent in Agent Studio to inspect its recovery state.</p>
          )}
          {s?.archived.map((a) => (
            <div className="control-summary" key={a.id}>
              <span>{a.name} · Archived</span>
              <button
                disabled={busy}
                className="secondary"
                onClick={() =>
                  run(
                    () => api('/workspace/agents/' + a.id + '/lifecycle', { action: 'restore' }),
                    'Agent restored.',
                  )
                }
              >
                Restore agent
              </button>
            </div>
          ))}
        </>
      )}
      {tab === 'Readiness' && (
        <ReadinessChecklist wallet={wallet} account={account} market={market} />
      )}
      {tab === 'Order activity' && (
        <section className="panel control-card">
          <div className="panel-head">
            <h3>
              <Activity size={16} /> Order activity timeline
            </h3>
            <Badge>BROWSER REPORTED</Badge>
          </div>
          <div className="control-card-body">
            <p>
              Wallet requests and observed order states are recorded locally. Use Positions &amp;
              Risk to reconcile unknown submissions against chain evidence.
            </p>
            <ol className="order-timeline">
              {s?.activities
                .filter(
                  (a) =>
                    a.account.toLowerCase() === (wallet.address ?? account?.address)?.toLowerCase(),
                )
                .map((a) => (
                  <li key={a.id}>
                    <strong>{a.state}</strong>
                    <time>{when(a.at)}</time>
                    <p>{a.detail}</p>
                    {a.hash && <code>{a.hash}</code>}
                  </li>
                ))}
            </ol>
            {!wallet.address && !account?.address && (
              <p>Connect a wallet or set a read-only account to view its activity.</p>
            )}
          </div>
        </section>
      )}
      {tab === 'Accounting' && (
        <>
          <section className="panel control-card">
            <div className="panel-head">
              <h3>Verified account performance</h3>
              <Badge>REAL ACCOUNT</Badge>
            </div>
            <div className="control-card-body">
              <p>
                Reconcile equity snapshots and complete bank event ranges. Deposits and withdrawals
                are removed from trading P&amp;L. Fees and funding are already included in equity
                and are not subtracted twice.
              </p>
              <div className="control-actions">
                <label>
                  Lookback hours
                  <input
                    aria-label="Accounting lookback hours"
                    type="number"
                    min="1"
                    max="168"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !market || !(wallet.address ?? account?.address)}
                  onClick={() =>
                    run(
                      () =>
                        api('/workspace/accounting', {
                          account: wallet.address ?? account?.address,
                          marketId: market?.id,
                          since: Date.now() - Number(hours) * 3600000,
                        }),
                      'Account reconciliation saved.',
                    )
                  }
                >
                  {busy ? 'Reconciling…' : 'Reconcile account'}
                </button>
              </div>
            </div>
          </section>
          {accountReports.map((a) => (
            <section className="panel control-card" key={a.from.block}>
              <div className="panel-head">
                <h3>
                  {when(a.from.at)} → {when(a.to.at)}
                </h3>
                <Badge>{a.complete ? 'VERIFIED RANGE' : 'INCOMPLETE'}</Badge>
              </div>
              <div className="control-card-body">
                <div className="control-stat-grid">
                  {[
                    ['Net trading P&L', a.netPnl],
                    ['External flows', a.netFlows],
                    ['Fees less rebates', a.fees],
                    ['Funding paid (signed)', a.fundingPaid],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <strong>{v === null ? 'Unavailable' : fmt(Number(v), 4)}</strong>
                    </div>
                  ))}
                </div>
                <p>
                  Blocks {a.from.block}–{a.to.block} · {a.fillCount} fills · {a.movements.length}{' '}
                  accounting events
                </p>
                {a.reasons.map((r) => (
                  <p className="notice" key={r}>
                    {r}
                  </p>
                ))}
                <button
                  className="secondary"
                  onClick={() => download('perpshq-accounting.json', JSON.stringify(a, null, 2))}
                >
                  Export reconciliation
                </button>
              </div>
            </section>
          ))}
        </>
      )}
      {tab === 'Backups' && (
        <section className="panel control-card">
          <div className="panel-head">
            <h3>Your complete local workspace</h3>
            <Download size={18} />
          </div>
          <div className="control-card-body">
            <p>
              Export agent configurations, paper ledgers, decisions, commands, unknown intents,
              replay datasets, alert inbox, accounting reports, and this browser’s journal, plans
              and settings.
            </p>
            <p>
              Restore requires an empty local database and a stopped worker. Restored agents remain
              paused; emergency stops and unresolved intents remain enforced. Pending commands are
              rejected so restoring cannot start an agent.
            </p>
            <div className="control-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => run(backup, 'Complete workspace backup downloaded.')}
              >
                Export full workspace
              </button>
              <label className="secondary">
                Restore backup
                <input
                  aria-label="Restore workspace backup"
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void run(() => restore(f), 'Workspace restored.');
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </section>
      )}
      {tab === 'Decision replay' && (
        <>
          <section className="panel control-card">
            <div className="panel-head">
              <h3>Replay the evidence</h3>
              <Badge>RECORDED OBSERVATION</Badge>
            </div>
            <div className="control-card-body">
              <label>
                Agent
                <select
                  aria-label="Replay agent"
                  value={agentId ?? ''}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setDecision('');
                    setComparison(undefined);
                  }}
                >
                  {s?.recovery.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Decision
                <select
                  aria-label="Replay decision"
                  value={replay?.decision.id ?? ''}
                  onChange={(e) => {
                    setDecision(e.target.value);
                    setComparison(undefined);
                  }}
                >
                  {rq.data?.map((r) => (
                    <option key={r.decision.id} value={r.decision.id}>
                      {when(r.decision.evaluatedAt)} · {r.decision.type}
                    </option>
                  ))}
                </select>
              </label>
              {replay ? (
                <>
                  <h3>{replay.decision.type}</h3>
                  <p>{replay.decision.rationale}</p>
                  <p>
                    Revision {replay.config.revision} · Block{' '}
                    {replay.decision.sourceTimestamps.block} · Observed{' '}
                    {when(replay.observation.observedAt)}
                  </p>
                  <div className="control-columns">
                    <div>
                      <h4>Matched signals</h4>
                      <ul>
                        {replay.decision.matched.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                      <h4>Missing conditions</h4>
                      <ul>
                        {replay.decision.failed.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4>Risk checks</h4>
                      <ul>
                        {replay.decision.risk.checks.map((c) => (
                          <li key={c.name}>
                            {c.passed ? '✓' : 'Blocked'} · {c.name}: {c.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {replay.decision.proposal && (
                    <p>
                      Proposed {replay.decision.proposal.side} · Quantity{' '}
                      {replay.decision.proposal.quantity} · Price bound{' '}
                      {replay.decision.proposal.price} · Estimated loss{' '}
                      {replay.decision.proposal.estimatedLoss}
                    </p>
                  )}
                  <details>
                    <summary>Observed indicators and final 20 candles</summary>
                    <dl>
                      {Object.entries(replay.decision.indicators).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v ?? 'Unavailable'}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="control-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Open</th>
                            <th>High</th>
                            <th>Low</th>
                            <th>Close</th>
                            <th>Volume</th>
                          </tr>
                        </thead>
                        <tbody>
                          {replay.observation.detail?.candles.slice(-20).map((c) => (
                            <tr key={c.time}>
                              <td>{when(c.time * 1000)}</td>
                              <td>{c.open}</td>
                              <td>{c.high}</td>
                              <td>{c.low}</td>
                              <td>{c.close}</td>
                              <td>{c.volume ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <div className="control-actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        download('perpshq-decision-replay.json', JSON.stringify(replay, null, 2))
                      }
                    >
                      Export full evidence
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        run(
                          async () =>
                            setComparison(
                              await api<ReturnType<typeof compareReplay>>(
                                '/workspace/agents/' + agentId + '/compare',
                                { decisionId: replay.decision.id },
                              ),
                            ),
                          'Compared the same saved dataset and revision.',
                        )
                      }
                    >
                      Compare cost scenarios
                    </button>
                  </div>
                </>
              ) : (
                <p>
                  No saved replay yet. New worker evaluations retain their exact observations; older
                  decisions do not invent missing evidence.
                </p>
              )}
            </div>
          </section>
          {comparison && (
            <section className="panel control-card">
              <div className="panel-head">
                <h3>Replay comparison lab</h3>
              </div>
              <div className="control-card-body">
                <p>
                  Same saved dataset · Revision {comparison.configRevision} · Slippage is capped at
                  the configured risk limit.
                </p>
                <div className="control-columns">
                  {comparison.scenarios.map((v) => (
                    <div key={v.name}>
                      <h4>{v.name}</h4>
                      {v.report.partitions.map((p) => (
                        <p key={p.name}>
                          {p.name}: {p.simulatedFills} fills · Net equity change{' '}
                          {fmt(Number(p.netEquityChange), 4)} · Drawdown{' '}
                          {fmt(Number(p.maxDrawdown), 4)}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                <p>
                  Historical assumptions and sample limits apply. Comparison does not establish
                  predictive returns.
                </p>
              </div>
            </section>
          )}
        </>
      )}
      {tab === 'Shared capital' && (
        <>
          <section className="panel control-card">
            <div className="panel-head">
              <h3>One paper bankroll. Multiple strategies.</h3>
              <Badge>SIMULATED</Badge>
            </div>
            <div className="control-card-body">
              <p>
                Agents reserve margin against one shared equity balance. Membership requires unused,
                stopped dry-run agents; capital and membership cannot be rewritten after fills.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      api('/workspace/portfolios', {
                        id: crypto.randomUUID(),
                        name: poolName,
                        capital,
                        agentIds: members,
                      }),
                    'Shared paper portfolio created.',
                  );
                }}
              >
                <div className="control-columns">
                  <label>
                    Portfolio name
                    <input
                      aria-label="Shared portfolio name"
                      value={poolName}
                      onChange={(e) => setPoolName(e.target.value)}
                    />
                  </label>
                  <label>
                    Shared capital
                    <input
                      aria-label="Shared paper capital"
                      inputMode="decimal"
                      value={capital}
                      onChange={(e) => setCapital(e.target.value)}
                    />
                  </label>
                </div>
                {s?.recovery.agents.map((a) => (
                  <label className="control-checkbox" key={a.id}>
                    <input
                      type="checkbox"
                      checked={members.includes(a.id)}
                      onChange={(e) =>
                        setMembers((v) =>
                          e.target.checked ? [...v, a.id] : v.filter((id) => id !== a.id),
                        )
                      }
                    />
                    {a.name}
                  </label>
                ))}
                <button className="primary" disabled={busy || !members.length}>
                  Create shared portfolio
                </button>
              </form>
            </div>
          </section>
          {s?.portfolios.map((p) => (
            <section className="panel control-card" key={p.id}>
              <div className="panel-head">
                <h3>{p.name}</h3>
              </div>
              <div className="control-card-body">
                <div className="control-stat-grid">
                  {[
                    ['Equity', p.account.equity],
                    ['Available collateral', p.account.availableCollateral],
                    ['Total exposure', p.account.totalExposure],
                    ['Session P&L', p.account.sessionPnl],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <strong>{fmt(Number(v), 4)}</strong>
                    </div>
                  ))}
                </div>
                <p>
                  {p.account.positionCount} positions · {p.account.orders.length} remaining orders
                </p>
                {p.account.errors.map((message) => (
                  <p className="red-text" key={message}>
                    {message}
                  </p>
                ))}
                {p.members.map((m) => (
                  <p key={m.id}>
                    {m.name} · {m.status} · Valued {when(m.valuedAt)}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      {tab === 'Alert inbox' && (
        <section className="panel control-card">
          <div className="panel-head">
            <h3>Persistent alert inbox</h3>
            <Badge>LOCAL DELIVERY</Badge>
          </div>
          <div className="control-card-body">
            <p>
              Worker and API monitoring save state changes even when the browser is closed.
              Worker-disconnect detection requires the local API to remain running. These alerts do
              not send external notifications.
            </p>
            {s?.alerts.map((a) => (
              <article className="inbox-item" key={a.id}>
                <div>
                  <Badge>{a.severity}</Badge>
                  <strong>{a.title}</strong>
                  <time>{when(a.at)}</time>
                  <p>{a.detail}</p>
                </div>
                {a.acknowledgedAt ? (
                  <small>Acknowledged {when(a.acknowledgedAt)}</small>
                ) : (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api('/workspace/alerts/' + a.id + '/acknowledge', {}),
                        'Alert acknowledged.',
                      )
                    }
                  >
                    Acknowledge
                  </button>
                )}
              </article>
            ))}
            {!s?.alerts.length && <p>No alerts have been recorded.</p>}
          </div>
        </section>
      )}
      <p className="control-footnote">
        PerpsHQ · Inspect the evidence before acting.{' '}
        {detail?.market.symbol ?? market?.symbol ?? 'Select a market'} · Local persistence
      </p>
    </div>
  );
}
