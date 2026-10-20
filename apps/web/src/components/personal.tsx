import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trophy,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  NETWORK,
  type Market,
  type Plan,
  type JournalEntry,
} from '../../../../packages/shared-types';
import { defaultWeights } from '../../../../packages/opportunity-scoring';
import { api, useStored, fmt, price, short, raw, download, type AccountData } from '../lib';
import type { Page, AlertRule, AlertEvent } from '../types';
import { Metric, Badge, Empty, ErrorNote, Skeleton } from './ui';
import { AccountOverview } from './trading';

export function Alerts({
  market: m,
  rules,
  setRules,
  history,
}: {
  market?: Market;
  rules: AlertRule[];
  setRules: (v: AlertRule[] | ((old: AlertRule[]) => AlertRule[])) => void;
  history: AlertEvent[];
}) {
  const [type, setType] = useState<AlertRule['type']>('price-above'),
    [threshold, setThreshold] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          <Bell size={16} />
          In-app risk alerts
        </h3>
        <Badge>WHILE OPEN</Badge>
      </div>
      <div className="panel-copy">
        <p>
          Rules check the selected market while PerpsHQ is open. Switch to a market to monitor it.
          Browser-close delivery is unavailable.
        </p>
        <form
          className="alert-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!m || !Number.isFinite(Number(threshold)) || threshold === '') return;
            setRules((v) => [
              ...v,
              {
                id: crypto.randomUUID(),
                marketId: m.id,
                symbol: m.symbol,
                type,
                threshold: Number(threshold),
                enabled: true,
              },
            ]);
            setThreshold('');
          }}
        >
          <span>{m?.symbol ?? 'Select a market'}</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AlertRule['type'])}
            aria-label="Alert condition"
          >
            <option value="price-above">Mark price above</option>
            <option value="price-below">Mark price below</option>
            <option value="rsi-above">RSI above</option>
            <option value="atr-above">ATR % above</option>
            <option value="margin-below">Equity − maintenance below</option>
          </select>
          <input
            aria-label="Alert threshold"
            type="number"
            step="any"
            required
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="Threshold"
          />
          <button className="secondary" disabled={!m}>
            <Plus size={14} />
            Create rule
          </button>
        </form>
        {rules.map((r) => (
          <div className="alert-rule" key={r.id}>
            <input
              type="checkbox"
              aria-label={`Enable ${r.symbol} alert`}
              checked={r.enabled}
              onChange={() =>
                setRules((v) => v.map((a) => (a.id === r.id ? { ...a, enabled: !a.enabled } : a)))
              }
            />
            <div>
              <strong>
                {r.symbol} · {r.type.replaceAll('-', ' ')} {r.threshold}
              </strong>
              <small>
                Last checked {r.checkedAt ? new Date(r.checkedAt).toLocaleTimeString() : 'not yet'}
              </small>
            </div>
            <button
              className="icon-button"
              title="Delete alert"
              onClick={() => setRules((v) => v.filter((a) => a.id !== r.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {history.length > 0 && (
          <div className="alert-history">
            {history.slice(0, 8).map((h) => (
              <div key={h.id}>
                <Bell size={13} />
                {h.text}
                <small>{new Date(h.time).toLocaleString()}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Portfolio({
  account: a,
  address,
  connect,
  loading,
  markets,
}: {
  account?: AccountData;
  address?: string;
  connect: () => void;
  loading: boolean;
  markets: Market[];
}) {
  const [snapshots, setSnapshots] = useStored<{ account: string; time: number; equity: number }[]>(
    'perpshq.equitySnapshots',
    [],
  );
  useEffect(() => {
    if (a?.margin)
      setSnapshots((v) => {
        if (v.some((s) => s.account === a.address && s.time === a.fetchedAt)) return v;
        return [
          ...v,
          {
            account: a.address,
            time: a.fetchedAt,
            equity: raw(a.margin!.equity, a.quoteDecimals)!,
          },
        ].slice(-1000);
      });
  }, [a?.fetchedAt]);
  const data = snapshots.filter((v) => v.account === address);
  const realized = a?.changes?.reduce((s, v) => s + (raw(v.realizedPnl, a.quoteDecimals) ?? 0), 0);
  return (
    <>
      <AccountOverview account={a} address={address} connect={connect} loading={loading} />
      {address && (
        <>
          <div className="analysis-grid">
            <section className="panel">
              <div className="panel-head">
                <h3>Observed equity</h3>
                <Badge>THIS BROWSER</Badge>
              </div>
              {data.length > 1 ? (
                <>
                  <EquityChart points={data} />
                  <div className="table-foot">
                    {data.length} real observations · Starts{' '}
                    {new Date(data[0].time).toLocaleString()} · No backfilled history.
                  </div>
                </>
              ) : (
                <Empty icon={Activity} title="Building your observation history">
                  Keep this workspace open to record verified equity snapshots. No historical curve
                  is fabricated.
                </Empty>
              )}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h3>Performance accounting</h3>
                <Badge>BOUNDED HISTORY</Badge>
              </div>
              <div className="panel-copy">
                <div className="summary-row">
                  <span>Realized P&L in latest 100 changes</span>
                  <strong>{price(realized)}</strong>
                </div>
                <div className="summary-row">
                  <span>Indexed fills loaded</span>
                  <strong>{a?.fills?.length ?? '—'}</strong>
                </div>
                <div className="summary-row">
                  <span>Closed-trade win rate</span>
                  <strong>Unavailable</strong>
                </div>
                <div className="summary-row">
                  <span>Funding cash flow (latest 100)</span>
                  <strong>
                    {a?.fundingPayments
                      ? price(
                          -a.fundingPayments.reduce(
                            (s, v) => s + (raw(v.amount, a.quoteDecimals) ?? 0),
                            0,
                          ),
                        )
                      : 'Unavailable'}
                  </strong>
                </div>
                <p>
                  Fills are execution events, not complete trades. A bounded change history cannot
                  establish lifetime performance or a valid closed-trade win rate. Deposits and
                  withdrawals also affect equity.
                </p>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-head">
              <h3>Verified fill history</h3>
              <button
                className="secondary"
                onClick={() =>
                  download('perpshq-fills.json', JSON.stringify(a?.fills ?? [], null, 2))
                }
              >
                <Download size={14} />
                Export
              </button>
            </div>
            {a?.fills?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Fill price</th>
                      <th>Quantity</th>
                      <th>Time</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.fills.map((f) => {
                      const m = markets.find((v) => v.id === f.pool);
                      return (
                        <tr key={f.id}>
                          <td>{m?.symbol ?? short(f.pool)}</td>
                          <td>{price(m ? raw(f.fillPrice, m.quoteDecimals) : undefined)}</td>
                          <td>{m ? fmt(raw(f.quantity, m.baseDecimals), 6) : '—'}</td>
                          <td>{new Date(Number(f.timestamp) * 1000).toLocaleString()}</td>
                          <td>
                            <a
                              href={`${NETWORK.explorer}/tx/${f.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {short(f.txHash)}
                              <ExternalLink size={12} />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No fill history loaded">
                Completed executions will appear when the indexer supplies them.
              </Empty>
            )}
          </section>
        </>
      )}
    </>
  );
}

export function EquityChart({ points }: { points: { time: number; equity: number }[] }) {
  const min = Math.min(...points.map((p) => p.equity)),
    max = Math.max(...points.map((p) => p.equity)),
    range = max - min || 1;
  const coords = points
    .map(
      (p, i) => `${20 + (i / (points.length - 1)) * 760},${160 - ((p.equity - min) / range) * 120}`,
    )
    .join(' ');
  return (
    <div className="equity-chart">
      <strong>{price(points.at(-1)?.equity)}</strong>
      <svg viewBox="0 0 800 190" role="img" aria-label="Actual observed account equity over time">
        <line x1="20" x2="780" y1="160" y2="160" stroke="#303c37" />
        <polyline points={coords} fill="none" stroke="#9fe3ba" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function Journal({
  entries,
  setEntries,
  onNew,
  plans,
  go,
}: {
  entries: JournalEntry[];
  setEntries: (v: JournalEntry[] | ((old: JournalEntry[]) => JournalEntry[])) => void;
  onNew: () => void;
  plans: Plan[];
  go: (p: Page, id?: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const update = (id: string, key: keyof JournalEntry, value: unknown) =>
    setEntries((v) => v.map((e) => (e.id === id ? { ...e, [key]: value } : e)));
  return (
    <>
      <div className="journal-toolbar">
        <label className="search-input">
          <Search size={14} />
          <input
            placeholder="Search thesis, market or tag"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          onClick={() => download('perpshq-journal.json', JSON.stringify(entries, null, 2))}
        >
          <Download size={14} />
          Export journal
        </button>
        <button className="primary" onClick={onNew}>
          <Plus size={15} />
          New entry
        </button>
      </div>
      {entries.length === 0 ? (
        <section className="panel">
          <Empty
            icon={BookOpen}
            title="Start with your reasoning"
            action={
              <button className="primary" onClick={onNew}>
                Write your first entry
                <Plus size={15} />
              </button>
            }
          >
            Record a thesis, your risk plan, and what you learn. Entries stay in this browser and
            can be exported.
          </Empty>
        </section>
      ) : (
        <div className="journal-grid">
          {entries
            .filter((e) =>
              (e.market + ' ' + e.thesis + ' ' + e.tags.join(' '))
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((e) => (
              <section className="panel journal-card" key={e.id}>
                <div className="panel-head">
                  <div>
                    <h3>{e.market}</h3>
                    <small>{new Date(e.createdAt).toLocaleString()}</small>
                  </div>
                  <button
                    className="icon-button"
                    title="Delete journal entry"
                    onClick={() => setEntries((v) => v.filter((x) => x.id !== e.id))}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="form-body">
                  <label className="field">
                    <span>Trade thesis</span>
                    <textarea
                      aria-label="Trade thesis"
                      placeholder="What conditions support your plan? What would invalidate it?"
                      value={e.thesis}
                      onChange={(v) => update(e.id, 'thesis', v.target.value)}
                    />
                  </label>
                  <div className="form-grid">
                    <label className="field">
                      <span>Tags (comma separated)</span>
                      <input
                        aria-label="Journal tags"
                        value={e.tags.join(', ')}
                        onChange={(v) =>
                          update(
                            e.id,
                            'tags',
                            v.target.value
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Emotional context</span>
                      <select
                        value={e.emotion}
                        onChange={(v) => update(e.id, 'emotion', v.target.value)}
                      >
                        {[
                          'Neutral',
                          'Patient',
                          'Confident',
                          'Anxious',
                          'Impulsive',
                          'Frustrated',
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    <span>Post-trade review</span>
                    <textarea
                      aria-label="Post-trade review"
                      placeholder="What happened? What will you repeat or change?"
                      value={e.review}
                      onChange={(v) => update(e.id, 'review', v.target.value)}
                    />
                  </label>
                  {e.plan && (
                    <div className="journal-plan">
                      <Badge>{e.plan.input.side.toUpperCase()}</Badge>
                      <span>
                        Entry {e.plan.input.entry} · Risk {e.plan.input.riskBudget} USDso · R/R{' '}
                        {e.plan.rr}
                      </span>
                    </div>
                  )}
                  {e.transactionHash ? (
                    <a
                      className="hash-link"
                      href={`${NETWORK.explorer}/tx/${e.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {e.transactionHash}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <small>No transaction attached · planning / reflection entry</small>
                  )}
                </div>
              </section>
            ))}
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Saved trade plans</h3>
          <Badge>{plans.length} SAVED</Badge>
        </div>
        {plans.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Risk budget</th>
                  <th>Quantity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <code>{short(p.input.marketId)}</code>
                    </td>
                    <td>{p.input.side}</td>
                    <td>{p.input.entry}</td>
                    <td>{p.input.riskBudget} USDso</td>
                    <td>{p.quantity}</td>
                    <td>
                      <button
                        className="row-action"
                        onClick={() => go('Trade Planner', p.input.marketId)}
                      >
                        Open planner
                        <ArrowUpRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-copy">
            <p>Valid plans you save in the planner appear here.</p>
          </div>
        )}
      </section>
    </>
  );
}

export function Arena({
  transactions,
  journalCount,
  planCount,
}: {
  transactions: { hash: string; state: string }[];
  journalCount: number;
  planCount: number;
}) {
  const [checks, setChecks] = useStored<string[]>('perpshq.arenaChecklist', []);
  const items = [
    'Check current Arena rules and eligibility in the official app',
    'Confirm paper USDso market allowlist',
    'Verify gas and perps margin funding',
    'Review official account and position sizing',
    'Capture a signed, confirmed testnet transaction',
    'Prepare a 3–5 minute demonstration',
    'Confirm DoraHacks whitelist and current deadline',
  ];
  return (
    <>
      <section className="panel arena-hero">
        <span className="arena-icon">
          <Trophy size={34} />
        </span>
        <div>
          <Badge tone="mint">DREAMDEX PERPS ARENA</Badge>
          <h2>Practice with a process.</h2>
          <p>
            Your analysis, plans, and evidence accompany you into the Arena. Competition eligibility
            and scoring are determined by dreamDEX.
          </p>
          <a
            className="primary"
            href="https://app.testnet.dreamdex.io/competition"
            target="_blank"
            rel="noreferrer"
          >
            Open official Arena
            <ExternalLink size={14} />
          </a>
          <div className="arena-progress">
            <div>
              <span>Your preparation</span>
              <span>
                {items.filter((item) => checks.includes(item)).length} / {items.length} steps
              </span>
            </div>
            <progress
              aria-label="Arena preparation completed"
              max={items.length}
              value={items.filter((item) => checks.includes(item)).length}
            />
          </div>
        </div>
      </section>
      <div className="metrics">
        <Metric
          label="Saved trade plans"
          value={planCount}
          detail="Your planning process"
          icon={Target}
        />
        <Metric
          label="Submitted transactions"
          value={transactions.length}
          detail="Local wallet submission records"
          icon={Zap}
        />
        <Metric
          label="Confirmed order states"
          value={
            transactions.filter((t) =>
              ['resting', 'filled', 'partial', 'cancelled'].includes(t.state),
            ).length
          }
          detail="Reconciled chain / indexer evidence"
          icon={Check}
        />
        <Metric
          label="Journal entries"
          value={journalCount}
          detail="Your review and reflection"
          icon={BookOpen}
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Preparation checklist</h3>
          <Badge>PERSONAL CHECKLIST</Badge>
        </div>
        <div className="checklist">
          {items.map((i) => (
            <label key={i}>
              <input
                type="checkbox"
                checked={checks.includes(i)}
                onChange={() =>
                  setChecks((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]))
                }
              />
              <span>{i}</span>
            </label>
          ))}
        </div>
        <div className="table-foot">
          No Arena rank, reward or qualification is inferred. Check the official competition for
          authoritative results.
        </div>
      </section>
    </>
  );
}

export function SettingsPanel({
  watchAddress,
  setWatchAddress,
  connected,
  walletConnect,
  onError,
}: {
  watchAddress: string;
  setWatchAddress: (v: string) => void;
  connected: boolean;
  walletConnect: () => void;
  onError: (e: string) => void;
}) {
  const [address, setAddress] = useState(watchAddress);
  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () =>
      api<{
        checkedAt: number;
        endpoints: { name: string; ok: boolean; data?: unknown; error?: string }[];
        database: { snapshots: { count: number } };
      }>('/diagnostics'),
  });
  return (
    <>
      <div className="analysis-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Wallet & read-only access</h3>
            <Wallet size={16} />
          </div>
          <div className="panel-copy">
            <p>
              Connect an EIP-1193 external wallet to sign Hideki orders. The dreamDEX app’s managed
              wallet needs a separate integration; its session is not imported here.
            </p>
            <button className="secondary" onClick={walletConnect}>
              {connected ? 'Choose wallet account' : 'Connect browser wallet'}
            </button>
            <form
              className="read-address"
              onSubmit={(e) => {
                e.preventDefault();
                if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
                  onError('Enter a complete 0x wallet address.');
                  return;
                }
                onError('');
                setWatchAddress(address);
              }}
            >
              <label className="field">
                <span>Read-only account address</span>
                <input
                  aria-label="Read-only account address"
                  placeholder="0x…"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <small>
                  Connected wallet takes precedence. Reading an address does not authorize signing.
                </small>
              </label>
              <button className="secondary">Save read address</button>
            </form>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Network configuration</h3>
            <Badge tone="mint">TESTNET ONLY</Badge>
          </div>
          <div className="panel-copy network-details">
            {Object.entries(NETWORK).map(([k, v]) => (
              <div key={k}>
                <small>{k}</small>
                <code>{String(v)}</code>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Connection diagnostics</h3>
          <button className="secondary" onClick={() => diagnostics.refetch()}>
            <RefreshCw size={14} className={diagnostics.isFetching ? 'spin' : ''} />
            Run checks
          </button>
        </div>
        <ErrorNote error={diagnostics.error} />
        {diagnostics.isLoading ? (
          <Skeleton />
        ) : (
          <div className="diagnostic-grid">
            {diagnostics.data?.endpoints.map((e) => (
              <div key={e.name}>
                <Badge tone={e.ok ? 'mint' : 'red'}>{e.ok ? 'CONNECTED' : 'UNAVAILABLE'}</Badge>
                <h3>{e.name}</h3>
                <details>
                  <summary>Connection details</summary>
                  <pre>
                    {e.error ??
                      JSON.stringify(
                        e.data,
                        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
                        2,
                      )?.slice(0, 1100)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Data, methodology & limitations</h3>
          <BookOpen size={16} />
        </div>
        <div className="help-grid">
          <div>
            <h3>Genuine perp data</h3>
            <p>
              Charts use Hideki perp fills, not spot or external reference candles. Only completed,
              ordered, contiguous candles enter indicators. Gaps and stale data are reported. Marks
              in the market table are older settlement snapshots.
            </p>
          </div>
          <div>
            <h3>Personal persistence</h3>
            <p>
              Watchlists, plans, journal entries, equity observations, alert rules and transaction
              references are stored in this browser. Export important records. Server SQLite stores
              public market and verified receipt snapshots.
            </p>
          </div>
          <div>
            <h3>Order safety</h3>
            <p>
              Every execution requires an explicit order confirmation and a wallet signature on
              chain 50383. The server has no signing keys or broadcast endpoint. The planner does
              not arm stop orders or set account leverage.
            </p>
          </div>
          <div>
            <h3>Research scores</h3>
            <p>
              Opportunity scores measure a weighted set of technical factors. They are not
              probabilities of profitable trades. Support zones use confirmed historical pivots; no
              future observations are used.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

export function WeightSettings({
  weights,
  onSave,
}: {
  weights: typeof defaultWeights;
  onSave: (v: typeof defaultWeights) => void;
}) {
  const [draft, setDraft] = useState(weights),
    [saved, setSaved] = useState(false);
  const total = Object.values(draft).reduce((s, v) => s + v, 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Opportunity score weights</h3>
        <Badge>{total} / 100 POINTS</Badge>
      </div>
      <div className="panel-copy">
        <p>
          Choose how much each technical factor contributes to your research ranking. Missing values
          still contribute zero. Weights must total 100.
        </p>
        <div className="form-grid score-weight-grid">
          {(Object.keys(draft) as (keyof typeof draft)[]).map((k) => (
            <label className="field" key={k}>
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input
                type="number"
                aria-label={k + ' score weight'}
                min="0"
                max="100"
                value={draft[k]}
                onChange={(e) => {
                  setSaved(false);
                  setDraft((v) => ({
                    ...v,
                    [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  }));
                }}
              />
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button
            className="primary"
            disabled={total !== 100}
            onClick={() => {
              onSave(draft);
              setSaved(true);
            }}
          >
            Apply weights
            <Check size={14} />
          </button>
          <button
            className="secondary"
            onClick={() => {
              setDraft(defaultWeights);
              onSave(defaultWeights);
              setSaved(true);
            }}
          >
            Reset defaults
          </button>
          {saved && <small>Saved to this browser. Rankings update immediately.</small>}
        </div>
      </div>
    </section>
  );
}
