import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownToLine,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileJson,
  FlaskConical,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Shield,
  Square,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import Decimal from 'decimal.js';
import type { Market } from '../../../../../packages/shared-types';
import { defaultAgentConfig, type AgentConfig } from '../../../../../packages/agent-engine/config';
import type { AgentDecision, AgentStatus } from '../../../../../packages/agent-engine/types';
import type { HistoricalReport } from '../../../../../packages/agent-engine/history';
import type { AgentRecord, AgentCommand, AgentEvent } from '../../../../../packages/agent-store';
import type { PermissionSnapshot } from '../../../../../packages/agent-execution';
import { api, download, errorMessage, fmt, short } from '../../lib';
import { Badge, Empty, ErrorNote, Metric, Skeleton } from '../ui';
import { AgentBuilder, StudioDialog, strategyNames } from './builder';
import './studio.css';
interface StudioAgent extends AgentRecord {
  displayStatus: AgentStatus;
  pendingCommands: AgentCommand[];
  lastDecision: AgentDecision | null;
}
interface StudioState {
  agents: StudioAgent[];
  worker: { workerId: string; at: number; state: string; fence: number } | null;
  connected: boolean;
  controlPlane: string;
  remoteControlAvailable: false;
  broadcastEnabled: false;
}
interface DetailState {
  agent: AgentRecord;
  decisions: AgentDecision[];
  events: AgentEvent[];
  commands: AgentCommand[];
  history: HistoricalReport[];
}
const stamp = (v?: number | null) => (v ? new Date(v).toLocaleString() : 'Not observed');
const statusLabel = (v: string) => v.replaceAll('-', ' ').replace(/^\w/, (s) => s.toUpperCase());
export default function AgentStudio({ markets }: { markets: Market[] }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(''),
    [builder, setBuilder] = useState<AgentConfig>(),
    [tab, setTab] = useState('Overview'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [stopTarget, setStopTarget] = useState<StudioAgent>();
  const q = useQuery({
    queryKey: ['agents'],
    queryFn: () => api<StudioState>('/agents'),
    refetchInterval: 5000,
    retry: 1,
  });
  const state = q.data,
    agents = state?.agents ?? [],
    chosen = agents.find((a) => a.config.id === selected) ?? agents[0],
    id = chosen?.config.id;
  const dq = useQuery({
    queryKey: ['agent-detail', id],
    queryFn: () => api<DetailState>('/agents/' + id),
    enabled: !!id,
    refetchInterval: 5000,
    retry: 1,
  });
  const details = dq.data,
    agent = details?.agent ?? chosen,
    c = agent?.config,
    ledger = agent?.ledger;
  const permission = agent?.permissions as PermissionSnapshot | undefined;
  const symbol = (marketId: string) =>
    markets.find((m) => m.id.toLowerCase() === marketId.toLowerCase())?.symbol ?? short(marketId);
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['agents'] });
    await qc.invalidateQueries({ queryKey: ['agent-detail'] });
  }
  async function action(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(success);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function command(a: StudioAgent, type: AgentCommand['type']) {
    return action(
      () =>
        api('/agents/' + a.config.id + '/commands', {
          type,
          revision: a.config.revision,
          requestId: crypto.randomUUID(),
        }),
      statusLabel(type) + ' requested. Status changes only after worker acknowledgement.',
    );
  }
  async function exportConfig(railway = false) {
    if (!c) return;
    await action(
      async () => {
        const data = await api<{ config: AgentConfig; railway: unknown; nonsecret: true }>(
          '/agents/' + c.id + '/export',
        );
        if (railway && !data.railway)
          throw new Error(
            'Railway export requires a DRY_RUN configuration. Assisted mode is local observation only.',
          );
        download(
          railway ? 'perpshq-agent-railway.json' : 'perpshq-agent-' + c.id + '.json',
          JSON.stringify(railway ? data : data.config, null, 2),
        );
      },
      railway
        ? 'Nonsecret Railway package exported. No service has been deployed.'
        : 'Versioned configuration exported. No signing secrets are included.',
    );
  }
  const workerConnected = !!state?.connected;
  const activeMarkets = new Set(
    agents
      .filter((a) => ['simulating', 'awaiting-authorization'].includes(a.displayStatus))
      .map((a) => a.config.marketId),
  ).size;
  return (
    <div className="agent-studio">
      <section className="studio-intro">
        <div>
          <div className="studio-kicker">
            <Bot size={16} /> AGENT STUDIO <span>01 / OBSERVE BEFORE YOU AUTHORIZE</span>
          </div>
          <h2>
            Your strategy.
            <br />
            <em>With clear boundaries.</em>
          </h2>
          <p>
            Build explainable agents around real Hideki markets. Simulate decisions, inspect the
            risk checks, and keep execution under your control.
          </p>
        </div>
        <div className="studio-boundary">
          <span className="studio-lock-icon">
            <LockKeyhole size={22} />
          </span>
          <strong>Live execution is locked</strong>
          <p>
            Dry run and assisted observation never sign or broadcast. Autonomous activation requires
            a separate authorization and validated canary.
          </p>
          <Badge>HIDEKI / 50383</Badge>
        </div>
      </section>
      <div className="studio-toolbar">
        <div className="studio-worker-state">
          <span className={'source-dot ' + (workerConnected ? '' : 'offline')} />
          <strong>
            {workerConnected ? 'Local worker connected' : 'Local worker disconnected'}
          </strong>
          <span>
            {state?.worker ? 'Heartbeat ' + stamp(state.worker.at) : 'No heartbeat recorded'}
          </span>
        </div>
        <div>
          <button className="secondary" onClick={refresh} disabled={busy}>
            <RefreshCw size={14} />
            Refresh agents
          </button>
          <button
            className="primary"
            disabled={!markets.length || busy}
            onClick={() => setBuilder(defaultAgentConfig(markets[0].id, crypto.randomUUID()))}
          >
            <Plus size={16} />
            Create agent
          </button>
        </div>
      </div>
      <ErrorNote error={error || q.error || dq.error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="metrics-grid studio-metrics">
        <Metric
          label="Configured agents"
          value={agents.length}
          detail="Saved, versioned configurations"
          icon={Bot}
        />
        <Metric
          label="Running on chain"
          value={0}
          detail="Broadcast is disabled in source"
          icon={LockKeyhole}
        />
        <Metric
          label="Dry-run agents"
          value={agents.filter((a) => a.config.mode === 'DRY_RUN').length}
          detail={activeMarkets + ' active observed markets'}
          icon={FlaskConical}
        />
        <Metric
          label="Paused agents"
          value={
            agents.filter(
              (a) => a.displayStatus === 'paused' || a.displayStatus === 'emergency-stopped',
            ).length
          }
          detail="Acknowledged pause / emergency states"
          icon={Pause}
        />
      </div>
      {q.isLoading ? (
        <Skeleton />
      ) : agents.length === 0 ? (
        <section className="panel studio-empty">
          <Empty
            icon={Bot}
            title="Start with a strategy you can explain."
            action={
              <button
                className="primary"
                disabled={!markets.length}
                onClick={() => setBuilder(defaultAgentConfig(markets[0].id, crypto.randomUUID()))}
              >
                <Plus size={16} />
                Create your first agent
              </button>
            }
          >
            No agents or performance records have been invented. Configure a market and hard limits,
            start the independent dry-run worker, then inspect its actual decisions.
          </Empty>
          <div className="studio-empty-steps">
            {[
              ['01', 'Configure', 'Choose evidence and limits.'],
              ['02', 'Observe', 'Use real market observations.'],
              ['03', 'Review', 'Read decisions before execution.'],
            ].map(([n, t, d]) => (
              <div key={n}>
                <span>{n}</span>
                <strong>{t}</strong>
                <small>{d}</small>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="studio-layout">
          <aside className="panel studio-agent-list">
            <div className="panel-head">
              <h3>Your agents</h3>
              <Badge>{agents.length}</Badge>
            </div>
            {agents.map((a) => (
              <button
                key={a.config.id}
                className={'studio-agent-card ' + (a.config.id === id ? 'selected' : '')}
                onClick={() => {
                  setSelected(a.config.id);
                  setError('');
                  setNotice('');
                }}
                aria-label={'Inspect ' + a.config.name}
              >
                <span className="studio-agent-card-top">
                  <Bot size={18} />
                  <strong>{a.config.name}</strong>
                  <ChevronRight size={14} />
                </span>
                <span>
                  {symbol(a.config.marketId)} · {a.config.timeframes.join(' / ')}
                </span>
                <small>{strategyNames[a.config.strategy]}</small>
                <span className="studio-agent-badges">
                  <Badge
                    tone={
                      a.displayStatus === 'simulating'
                        ? 'mint'
                        : a.displayStatus === 'emergency-stopped'
                          ? 'red'
                          : 'neutral'
                    }
                  >
                    {statusLabel(a.displayStatus)}
                  </Badge>
                  <Badge>
                    {a.config.mode === 'DRY_RUN'
                      ? 'PAPER'
                      : a.config.mode === 'ASSISTED'
                        ? 'PROPOSALS'
                        : 'LOCKED'}
                  </Badge>
                </span>
                {a.pendingCommands.length > 0 && (
                  <small className="studio-pending">
                    {statusLabel(a.pendingCommands[0].type)} requested · acknowledgement pending
                  </small>
                )}
              </button>
            ))}
          </aside>
          <div className="studio-agent-content">
            {agent && c && chosen && (
              <>
                <section className="panel studio-agent-heading">
                  <div>
                    <div className="studio-kicker">
                      {symbol(c.marketId)} / REVISION {c.revision}
                    </div>
                    <h2>{c.name}</h2>
                    <p>
                      {strategyNames[c.strategy]} ·{' '}
                      {c.mode === 'DRY_RUN'
                        ? 'Simulated ledger'
                        : c.mode === 'ASSISTED'
                          ? 'Human-review proposals'
                          : 'Autonomous activation disabled'}
                    </p>
                  </div>
                  <div className="studio-agent-controls">
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        ['simulating', 'awaiting-authorization', 'emergency-stopped'].includes(
                          chosen.runtime.status,
                        )
                      }
                      onClick={() => setBuilder({ ...c, revision: c.revision + 1 })}
                    >
                      Edit configuration
                    </button>
                    {['simulating', 'awaiting-authorization'].includes(chosen.runtime.status) ? (
                      <>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => command(chosen, 'pause')}
                        >
                          <Pause size={14} />
                          Pause agent
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => command(chosen, 'stop')}
                        >
                          <Square size={13} />
                          Stop observation
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          chosen.displayStatus === 'emergency-stopped' ||
                          c.mode === 'AUTONOMOUS_TESTNET'
                        }
                        onClick={() =>
                          command(chosen, chosen.displayStatus === 'paused' ? 'resume' : 'start')
                        }
                      >
                        <Play size={14} />
                        {chosen.displayStatus === 'paused'
                          ? 'Resume agent'
                          : c.mode === 'ASSISTED'
                            ? 'Observe proposals'
                            : 'Start dry run'}
                      </button>
                    )}
                    <button
                      className="secondary studio-danger-button"
                      disabled={busy || chosen.displayStatus === 'emergency-stopped'}
                      onClick={() => setStopTarget(chosen)}
                    >
                      <Shield size={14} />
                      Emergency stop
                    </button>
                  </div>
                </section>
                {!workerConnected && (
                  <div className="notice">
                    <Terminal size={15} /> This browser does not run the agent. Start{' '}
                    <code>npm run agent:worker</code> in a separate local terminal using the same
                    SQLite store. Pending commands remain unacknowledged until that worker responds.
                    A Railway worker on another volume is not controlled here.
                  </div>
                )}
                {chosen.pendingCommands.length > 0 && (
                  <div className="notice studio-command-pending">
                    <Clock3 size={16} />
                    {statusLabel(chosen.pendingCommands[0].type)} requested at{' '}
                    {stamp(chosen.pendingCommands[0].requestedAt)}. Awaiting worker acknowledgement.
                  </div>
                )}
                <div className="studio-detail-tabs" role="tablist" aria-label="Agent detail views">
                  {['Overview', 'Decisions', 'Simulation', 'Permissions', 'Deployment'].map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                      {t}
                    </button>
                  ))}
                </div>
                {tab === 'Overview' && (
                  <>
                    <div className="studio-overview-grid">
                      <section className="panel">
                        <div className="panel-head">
                          <h3>Observed state</h3>
                          <Badge tone={chosen.displayStatus === 'simulating' ? 'mint' : 'neutral'}>
                            {statusLabel(chosen.displayStatus)}
                          </Badge>
                        </div>
                        <dl className="studio-definition-list">
                          <div>
                            <dt>Last evaluation</dt>
                            <dd>{stamp(agent.lastEvaluationAt)}</dd>
                          </div>
                          <div>
                            <dt>Last worker heartbeat</dt>
                            <dd>{stamp(state?.worker?.at)}</dd>
                          </div>
                          <div>
                            <dt>Owner account</dt>
                            <dd>
                              {c.ownerAddress ? (
                                <code>{c.ownerAddress}</code>
                              ) : (
                                'Not configured · paper needs no wallet'
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Operator address</dt>
                            <dd>
                              {c.operatorAddress ? (
                                <code>{c.operatorAddress}</code>
                              ) : (
                                'Not configured'
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Operator STT</dt>
                            <dd>
                              {permission
                                ? permission.gasSTT + ' STT · ' + stamp(permission.checkedAt)
                                : agent.lastAccount?.gasSTT
                                  ? agent.lastAccount.gasSTT +
                                    ' STT · ' +
                                    stamp(agent.lastAccount.observedAt)
                                  : 'Unavailable · no verified balance read'}
                            </dd>
                          </div>
                          <div>
                            <dt>Permission status</dt>
                            <dd>
                              {permission
                                ? permission.place && permission.cancel
                                  ? 'Observed place / cancel grants'
                                  : 'Missing required grants'
                                : 'Not checked'}
                            </dd>
                          </div>
                          <div>
                            <dt>Agent-attributed on-chain orders</dt>
                            <dd>None recorded · no authored transactions</dd>
                          </div>
                          <div>
                            <dt>Paper resting orders</dt>
                            <dd>{ledger?.orders.length ?? 0} simulated</dd>
                          </div>
                        </dl>
                      </section>
                      <section className="panel">
                        <div className="panel-head">
                          <h3>Hard limits</h3>
                          <Shield size={17} />
                        </div>
                        <dl className="studio-definition-list">
                          <div>
                            <dt>Order / market / total notional</dt>
                            <dd>
                              {c.risk.maxOrderNotional} / {c.risk.maxMarketExposure} /{' '}
                              {c.risk.maxTotalExposure} USDso
                            </dd>
                          </div>
                          <div>
                            <dt>Per-trade risk budget</dt>
                            <dd>{c.risk.riskBudget} USDso</dd>
                          </div>
                          <div>
                            <dt>Session / daily loss guard</dt>
                            <dd>
                              {c.risk.maxSessionLoss} / {c.risk.maxDailyLoss} USDso
                            </dd>
                          </div>
                          <div>
                            <dt>Positions / orders</dt>
                            <dd>
                              {c.risk.maxOpenPositions} / {c.risk.maxOpenOrders} maximum
                            </dd>
                          </div>
                          <div>
                            <dt>Slippage / data age</dt>
                            <dd>
                              {c.risk.maxSlippageBps} bps / {c.risk.maxDataAgeSeconds}s
                            </dd>
                          </div>
                          <div>
                            <dt>Actions / cooldown</dt>
                            <dd>
                              {c.risk.maxTransactionsPerHour}/hour · {c.risk.cooldownSeconds}s
                            </dd>
                          </div>
                          <div>
                            <dt>Gas reserve</dt>
                            <dd>{c.risk.minGasReserveSTT} STT beyond the estimated fee</dd>
                          </div>
                          <div>
                            <dt>Native stop / take profit</dt>
                            <dd>Not armed · watched references only</dd>
                          </div>
                        </dl>
                      </section>
                    </div>
                    <section className="panel">
                      <div className="panel-head">
                        <h3>Latest decision</h3>
                        <button className="text-button" onClick={() => setTab('Decisions')}>
                          View decision log <ChevronRight size={13} />
                        </button>
                      </div>
                      {details?.decisions[0] ? (
                        <DecisionCard decision={details.decisions[0]} />
                      ) : (
                        <Empty title="No evaluation recorded">
                          A saved configuration is not a running agent. Start observation and wait
                          for a real worker evaluation.
                        </Empty>
                      )}
                    </section>
                    {agent.lastError && <ErrorNote error={agent.lastError} />}
                    <ActivityLog
                      events={details?.events ?? []}
                      commands={details?.commands ?? []}
                    />
                  </>
                )}
                {tab === 'Decisions' && (
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h3>Decision log</h3>
                        <small>Stored signal, risk and provenance records · most recent 100</small>
                      </div>
                      <Badge>EXPLAINABLE</Badge>
                    </div>
                    {details?.decisions.length ? (
                      details.decisions.map((d) => <DecisionCard key={d.id} decision={d} />)
                    ) : (
                      <Empty title="No decisions yet">
                        The independent worker records successful evaluations, rejected signals and
                        unavailable data. No sample decisions are presented as live.
                      </Empty>
                    )}
                  </section>
                )}
                {tab === 'Simulation' && ledger && (
                  <>
                    <div className="notice">
                      <FlaskConical size={16} /> Paper fills and historical outcomes are simulations
                      over observed perp data. They are never blockchain fills or evidence of
                      predictive accuracy.
                    </div>
                    {c.mode === 'DRY_RUN' ? (
                      <>
                        <div className="metrics-grid studio-paper-metrics">
                          <Metric
                            label="Paper equity"
                            value={fmt(Number(ledger.equity)) + ' USDso'}
                            detail={'Observed ' + stamp(ledger.updatedAt)}
                          />
                          <Metric
                            label="Simulated cash P&L"
                            value={
                              fmt(new Decimal(ledger.cash).minus(ledger.initialEquity).toNumber()) +
                              ' USDso'
                            }
                            detail="Realized cash change after modeled fees/funding"
                          />
                          <Metric
                            label="Observed drawdown"
                            value={fmt(Number(ledger.maxDrawdown)) + ' USDso'}
                            detail="Sampled equity · not intrabar worst case"
                          />
                        </div>
                        <PaperCurve decisions={details?.decisions ?? []} />
                        <section className="panel">
                          <div className="panel-head">
                            <h3>Simulated positions & fills</h3>
                            <Badge>PAPER ONLY</Badge>
                          </div>
                          <div className="studio-panel-body">
                            <p>
                              {ledger.position
                                ? ledger.position.side.toUpperCase() +
                                  ' ' +
                                  ledger.position.quantity +
                                  ' at ' +
                                  ledger.position.entryPrice +
                                  ' · unrealized ' +
                                  ledger.position.unrealizedPnl +
                                  ' USDso'
                                : 'No open simulated position.'}
                            </p>
                            <p>
                              Modeled fees {ledger.fees} USDso · assumed funding {ledger.funding}{' '}
                              USDso · {ledger.fills.length} retained simulated fills.
                            </p>
                            {ledger.fills.length > 0 && (
                              <div className="table-scroll">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Time</th>
                                      <th>Action</th>
                                      <th>Quantity</th>
                                      <th>Price</th>
                                      <th>Fee</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ledger.fills
                                      .slice(-30)
                                      .reverse()
                                      .map((f) => (
                                        <tr key={f.id}>
                                          <td>{stamp(f.at)}</td>
                                          <td>
                                            {f.kind} / {f.side}
                                          </td>
                                          <td>{f.quantity}</td>
                                          <td>{f.price}</td>
                                          <td>{f.fee}</td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {ledger.orders.length > 0 && (
                              <p>
                                {ledger.orders.length} paper limit orders remain modeled. Queue
                                priority is not assumed.
                              </p>
                            )}
                          </div>
                        </section>
                      </>
                    ) : (
                      <section className="panel">
                        <Empty title="Assisted proposals have no paper performance">
                          Actual account observations and proposals are kept separate from synthetic
                          cash. No on-chain performance has been recorded.
                        </Empty>
                      </section>
                    )}
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h3>Chronological historical evaluation</h3>
                          <small>
                            Real completed perp candles · fixed parameters · next-open fill
                            assumptions
                          </small>
                        </div>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            action(
                              () => api('/agents/' + c.id + '/history', { revision: c.revision }),
                              'Historical evaluation saved. Read its coverage and fill-model limitations.',
                            )
                          }
                        >
                          <Activity size={14} />
                          Run historical evaluation
                        </button>
                      </div>
                      {details?.history[0] ? (
                        <HistoricalResult report={details.history[0]} />
                      ) : (
                        <Empty title="No historical evaluation saved">
                          Warm-up and missing history can leave few or no evaluable candles. No
                          favorable fills or reconstructed historical depth will be invented.
                        </Empty>
                      )}
                    </section>
                  </>
                )}
                {tab === 'Permissions' && (
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h3>Owner & linked operator</h3>
                        <small>Read-only verification · no access grant or gas transfer</small>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy || !c.ownerAddress || !c.operatorAddress}
                        onClick={() =>
                          action(
                            () => api('/agents/' + c.id + '/permissions', { revision: c.revision }),
                            'Market-specific permissions and gas were observed. No access was granted.',
                          )
                        }
                      >
                        <RefreshCw size={14} />
                        Check permissions
                      </button>
                    </div>
                    <div className="studio-panel-body">
                      <div className="notice">
                        Use a Somnia Account wallet; the documented flow does not support Legacy
                        Accounts. Access is market-specific. Revocation does not cancel resting
                        orders, and linked bots cannot arm native TP/SL.
                      </div>
                      <ol className="studio-onboarding">
                        <li>
                          Create a dedicated bot wallet outside PerpsHQ. Keep its key separate from
                          your owner wallet.
                        </li>
                        <li>
                          Configure only the public owner and operator addresses. Use an owner
                          account with deliberately limited eligible USDso perps collateral.
                        </li>
                        <li>
                          Review the official Link a Bot guide. Any grant or optional gas transfer
                          needs separate explicit authorization; PerpsHQ does not perform it.
                        </li>
                        <li>
                          Verify this market's place, cancel and order-reduction permissions and the
                          operator's STT reserve.
                        </li>
                        <li>
                          Inspect dry-run decisions and limits. Signing remains locked until a
                          supervised, specifically authorized canary is implemented and verified.
                        </li>
                      </ol>
                      <a
                        className="secondary"
                        href="https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read official Link a Bot guide ↗
                      </a>
                      {permission ? (
                        <>
                          <h4>Last actual observation · {stamp(permission.checkedAt)}</h4>
                          <dl className="studio-definition-list">
                            <div>
                              <dt>Market / block</dt>
                              <dd>
                                {symbol(permission.marketId)} / {permission.block}
                              </dd>
                            </div>
                            <div>
                              <dt>Owner contract</dt>
                              <dd>
                                {permission.accountKind} · contract code alone does not prove wallet
                                ownership
                              </dd>
                            </div>
                            <div>
                              <dt>Place / cancel / reduce resting order</dt>
                              <dd>
                                {String(permission.place)} / {String(permission.cancel)} /{' '}
                                {String(permission.reduce)}
                              </dd>
                            </div>
                            <div>
                              <dt>Operator gas</dt>
                              <dd>{permission.gasSTT} STT</dd>
                            </div>
                          </dl>
                        </>
                      ) : (
                        <p className="muted">
                          No permission or gas claim is made until a fresh read succeeds. Add public
                          addresses in a paused agent's configuration to enable checking.
                        </p>
                      )}
                      <p>
                        <strong>Order shrinkage is not a position close.</strong> A position-exit
                        proposal needs separately reviewed opposite-side IOC parameters; no atomic
                        reduce-only guarantee is claimed.
                      </p>
                    </div>
                  </section>
                )}
                {tab === 'Deployment' && (
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h3>Independent worker</h3>
                        <small>Local operation now · Railway package prepared for review</small>
                      </div>
                      <Badge>NO DEPLOYMENT</Badge>
                    </div>
                    <div className="studio-panel-body">
                      <div className="studio-deploy-status">
                        <div>
                          <Radio size={18} />
                          <strong>Local shared-store control</strong>
                          <span>
                            {workerConnected
                              ? 'Heartbeat observed'
                              : 'Worker offline / not started'}
                          </span>
                        </div>
                        <div>
                          <LockKeyhole size={18} />
                          <strong>Railway remote control</strong>
                          <span>Unavailable · no authenticated cloud integration</span>
                        </div>
                      </div>
                      <h4>Run without keeping this browser open</h4>
                      <pre className="studio-code">
                        npm run agent:check{'\n'}npm run agent:worker{'\n'}npm run agent:health
                      </pre>
                      <p>
                        The worker shares <code>data/agent-studio.sqlite</code> with this local API.
                        A durable lease prevents a second worker on that same volume. Pause and
                        emergency stop are requests until acknowledged. An offline worker cannot
                        acknowledge a command.
                      </p>
                      <div className="studio-export-actions">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => exportConfig(false)}
                        >
                          <FileJson size={16} />
                          Export configuration
                        </button>
                        <button
                          className="secondary"
                          disabled={busy || c.mode !== 'DRY_RUN'}
                          onClick={() => exportConfig(true)}
                        >
                          <ArrowDownToLine size={16} />
                          Export Railway config
                        </button>
                      </div>
                      <h4>Railway deployment checklist</h4>
                      <ol className="studio-onboarding">
                        <li>
                          Review <code>docs/AGENT-RAILWAY-DEPLOYMENT.md</code>, the worker
                          Dockerfile and Railway configuration.
                        </li>
                        <li>
                          Keep <code>AGENT_NETWORK=hideki</code> and <code>AGENT_MODE=DRY_RUN</code>
                          . Save the nonsecret exported configuration on a persistent volume.
                        </li>
                        <li>
                          Use one worker per shared SQLite volume. Disable public networking. No
                          private key is needed or accepted by this release.
                        </li>
                        <li>
                          Obtain separate owner approval for the exact deployment. Then verify
                          container health, heartbeat, persistence, logs and recovery on the
                          deployed service.
                        </li>
                        <li>
                          This dashboard does not remotely control an independent Railway volume.
                          Authenticated hosted control and live canary authorization remain future
                          gates.
                        </li>
                      </ol>
                      <div className="notice">
                        No cloud service has been deployed. A local heartbeat proves local process
                        activity, not 24/7 cloud availability.
                      </div>
                    </div>
                  </section>
                )}
                <div className="studio-evidence-note">
                  <CheckCircle2 size={16} />
                  <span>
                    Transaction evidence: no Agent Studio-authored on-chain transaction exists.{' '}
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        action(
                          async () =>
                            download(
                              'perpshq-agent-evidence.json',
                              JSON.stringify(await api('/agents/' + c.id + '/evidence'), null, 2),
                            ),
                          'Evidence exported with explicit simulation labels.',
                        )
                      }
                    >
                      Export recorded evidence
                    </button>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="studio-safety-footer">
        <LockKeyhole size={14} />
        <span>
          Decisions are proposals. Keys stay outside this interface. Simulated fills carry no
          explorer links.
        </span>
      </div>
      {builder && (
        <AgentBuilder
          initial={builder}
          markets={markets}
          onClose={() => setBuilder(undefined)}
          onSave={async (config) => {
            setError('');
            try {
              await api('/agents', {
                config,
                expectedRevision: config.revision > 1 ? config.revision - 1 : undefined,
              });
              setSelected(config.id);
              await refresh();
              setNotice(
                'Configuration saved. No observation or execution was started automatically.',
              );
              return true;
            } catch (e) {
              setError(errorMessage(e));
              throw e;
            }
          }}
        />
      )}
      {stopTarget && (
        <StudioDialog title="Emergency stop agent" onClose={() => setStopTarget(undefined)}>
          <div className="studio-panel-body">
            <TriangleAlert size={28} />
            <h3>Stop new evaluations for {stopTarget.config.name}?</h3>
            <p>
              This sends a durable emergency-stop request to the local shared-store worker. It is
              not acknowledged until that worker responds. The stop is latched for this agent.
            </p>
            <p>
              Existing on-chain positions and resting orders are not closed or cancelled. Review
              them in the official app and revoke bot permissions only with separate authorization.
            </p>
            <button
              className="primary studio-danger-button"
              disabled={busy}
              onClick={async () => {
                await command(stopTarget, 'emergency-stop');
                setStopTarget(undefined);
              }}
            >
              Request emergency stop
            </button>
          </div>
        </StudioDialog>
      )}
    </div>
  );
}
function DecisionCard({ decision: d }: { decision: AgentDecision }) {
  return (
    <article className="studio-decision">
      <div>
        <Badge tone={d.risk.allowed ? 'mint' : d.type === 'PAUSE_REQUIRED' ? 'red' : 'neutral'}>
          {d.type.replaceAll('_', ' ')}
        </Badge>
        <small>
          {stamp(d.evaluatedAt)} · v{d.configRevision} · {d.evidenceKind}
        </small>
      </div>
      <p>{d.rationale}</p>
      <div className="studio-condition-tags">
        {d.matched.map((m, i) => (
          <span className="passed" key={'m' + i}>
            <CheckCircle2 size={12} />
            {m}
          </span>
        ))}
        {d.failed.map((f, i) => (
          <span key={'f' + i}>
            <TriangleAlert size={12} />
            {f}
          </span>
        ))}
      </div>
      {d.proposal && (
        <p className="studio-proposal">
          Proposed {d.proposal.action} · {d.proposal.side} {d.proposal.quantity} · bound{' '}
          {d.proposal.price} · {d.proposal.orderType}. <strong>Not submitted.</strong>
        </p>
      )}
      <details>
        <summary>Inspect source & risk evidence</summary>
        <pre>
          {JSON.stringify(
            {
              source: d.sourceTimestamps,
              indicators: d.indicators,
              risk: d.risk,
              proposal: d.proposal,
              signalKey: d.signalKey,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}
function ActivityLog({ events, commands }: { events: AgentEvent[]; commands: AgentCommand[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Activity & command acknowledgements</h3>
        <Badge>AUDIT LOG</Badge>
      </div>
      <div className="studio-panel-body">
        {commands.slice(0, 5).map((c) => (
          <div className="studio-command-row" key={c.id}>
            <strong>{statusLabel(c.type)}</strong>
            <span>
              {c.acknowledgedAt
                ? 'Acknowledged ' + stamp(c.acknowledgedAt) + ' · ' + c.result
                : 'Requested ' + stamp(c.requestedAt) + ' · not acknowledged'}
            </span>
          </div>
        ))}
        {events.length ? (
          <ol className="studio-timeline">
            {events.slice(0, 20).map((e) => (
              <li key={e.id}>
                <span />
                <div>
                  <strong>{statusLabel(e.kind)}</strong>
                  <small>{stamp(e.at)}</small>
                  <p>{e.message}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>No worker activity has been recorded.</p>
        )}
      </div>
    </section>
  );
}
function PaperCurve({ decisions }: { decisions: AgentDecision[] }) {
  const points = decisions
      .filter((d) => d.paperOutcome)
      .slice()
      .reverse(),
    values = points.map((d) => Number(d.paperOutcome!.equity));
  if (values.length < 2)
    return (
      <section className="panel">
        <Empty title="Equity observations are warming up">
          At least two persisted paper observations are needed for a curve. No sample returns are
          inserted.
        </Empty>
      </section>
    );
  const lo = Math.min(...values),
    hi = Math.max(...values),
    range = hi - lo || 1;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Observed paper equity</h3>
        <Badge>SIMULATED</Badge>
      </div>
      <div className="studio-paper-curve">
        <svg viewBox="0 0 700 160" role="img" aria-label="Persisted simulated equity observations">
          <path
            d={values
              .map(
                (v, i) =>
                  (i ? 'L' : 'M') +
                  ((i / (values.length - 1)) * 680 + 10).toFixed(2) +
                  ',' +
                  (140 - ((v - lo) / range) * 120).toFixed(2),
              )
              .join(' ')}
            fill="none"
            stroke="#c4e99a"
            strokeWidth="2"
          />
        </svg>
        <div>
          <span>{stamp(points[0].evaluatedAt)}</span>
          <span>{stamp(points.at(-1)!.evaluatedAt)}</span>
        </div>
      </div>
    </section>
  );
}
function HistoricalResult({ report: r }: { report: HistoricalReport }) {
  return (
    <div className="studio-panel-body">
      <p>
        {r.sample.usableCandles} usable / {r.sample.availableCandles} observed candles ·{' '}
        {r.sample.timeframe} · {stamp(r.sample.from ? r.sample.from * 1000 : undefined)} →{' '}
        {stamp(r.sample.to ? r.sample.to * 1000 : undefined)}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Partition</th>
              <th>Evaluated</th>
              <th>Candidates / fills</th>
              <th>Closed trades</th>
              <th>Mean closed net</th>
              <th>Win / loss ratio</th>
              <th>Max drawdown</th>
              <th>Max adverse</th>
            </tr>
          </thead>
          <tbody>
            {r.partitions.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.evaluatedCandles}</td>
                <td>
                  {p.candidates} / {p.simulatedFills}
                </td>
                <td>{p.closedTrades}</td>
                <td>{p.averageClosedNetOutcome ?? 'Unavailable'}</td>
                <td>{p.winLossRatio == null ? 'Unavailable' : fmt(p.winLossRatio)}</td>
                <td>{p.maxDrawdown}</td>
                <td>{p.maxAdverseExcursion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details open>
        <summary>Coverage, costs & confidence limits</summary>
        {r.limitations.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        <pre>{JSON.stringify(r.assumptions, null, 2)}</pre>
      </details>
      <button
        className="secondary"
        onClick={() => download('perpshq-historical-simulation.json', JSON.stringify(r, null, 2))}
      >
        <ArrowDownToLine size={14} />
        Export historical report
      </button>
    </div>
  );
}
