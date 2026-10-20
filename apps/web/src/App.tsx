import type { Page, ScanRow, AlertRule, AlertEvent } from './types';
import { Metric, Badge, Empty, ErrorNote, Coin, Skeleton } from './components/ui';
import {
  Planner,
  AccountOverview,
  Positions,
  TransactionList,
  SubmissionRecovery,
} from './components/trading';
import { Scoring, Book, FundingPanel, HistoricalContext } from './components/analysis';
import {
  Alerts,
  Portfolio,
  Journal,
  Arena,
  SettingsPanel,
  WeightSettings,
} from './components/personal';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  LayoutDashboard,
  ListFilter,
  Menu,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Wallet,
  X,
  ChartNoAxesCombined,
} from 'lucide-react';
import {
  intervals,
  type Market,
  type MarketDetail,
  type Timeframe,
  type Plan,
  type JournalEntry,
} from '../../../packages/shared-types';
import {
  matchesPreset,
  defaultWeights,
  reweight,
  analyze,
} from '../../../packages/opportunity-scoring';
import {
  api,
  useStored,
  fmt,
  price,
  compact,
  short,
  raw,
  journalEntry,
  type AccountData,
  type Evidence,
} from './lib';
import { useWallet } from './wallet';
import { Chart } from './Chart';
import { useAlertMonitoring } from './useAlertMonitoring';
import { PerspectiveMark } from './components/identity';

const navigation: [Page, typeof Activity][] = [
  ['Command Center', LayoutDashboard],
  ['Opportunity Scanner', Search],
  ['Market Intelligence', ChartNoAxesCombined],
  ['Trade Planner', Target],
  ['Positions & Risk', Shield],
  ['Portfolio Analytics', Activity],
  ['Trade Journal', BookOpen],
  ['Arena Companion', Trophy],
  ['Settings & Help', Settings],
];
const workflow: { label: string; page: Page }[] = [
  { label: 'Discover', page: 'Opportunity Scanner' },
  { label: 'Analyze', page: 'Market Intelligence' },
  { label: 'Plan', page: 'Trade Planner' },
  { label: 'Monitor', page: 'Positions & Risk' },
  { label: 'Review', page: 'Trade Journal' },
];
const presets = [
  'All markets',
  'Trending markets',
  'Possible breakouts',
  'Oversold / overbought',
  'Trend pullbacks',
  'Volatility expansion',
  'Mixed signals',
];

function App() {
  const qc = useQueryClient(),
    wallet = useWallet();
  const [page, setPage] = useState<Page>(
      () => (decodeURIComponent(location.hash.slice(1)) as Page) || 'Command Center',
    ),
    [mobile, setMobile] = useState(false),
    [selected, setSelected] = useStored('perpshq.market', ''),
    [timeframe, setTimeframe] = useStored<Timeframe>('perpshq.timeframe', '15m'),
    [watch, setWatch] = useStored<string[]>('perpshq.watchlist', []),
    [journal, setJournal] = useStored<JournalEntry[]>('perpshq.journal', []),
    [savedPlans, setSavedPlans] = useStored<Plan[]>('perpshq.plans', []),
    [overlays, setOverlays] = useStored<string[]>('perpshq.overlays', [
      'EMA 20',
      'EMA 50',
      'Volume',
      'S/R zones',
    ]),
    [query, setQuery] = useState(''),
    [preset, setPreset] = useState('All markets'),
    [onlyWatch, setOnlyWatch] = useState(false),
    [sort, setSort] = useState('score'),
    [toast, setToast] = useState(''),
    [askOpen, setAskOpen] = useState(false),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(''),
    [alertsOpen, setAlertsOpen] = useState(false),
    [rules, setRules] = useStored<AlertRule[]>('perpshq.alertRules', []),
    [alertHistory, setAlertHistory] = useStored<AlertEvent[]>('perpshq.alertHistory', []),
    [watchAddress, setWatchAddress] = useStored('perpshq.readAddress', ''),
    [noticeError, setNoticeError] = useState('');
  const [transactions, setTransactions] = useStored<
    { hash: string; marketId: string; account: string; state: string }[]
  >('perpshq.transactions', []);
  const [freshnessClock, setFreshnessClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setFreshnessClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [weights, setWeights] = useStored('perpshq.weights', defaultWeights);
  const accountAddress =
    wallet.address ?? (/^0x[0-9a-fA-F]{40}$/.test(watchAddress) ? watchAddress : undefined);
  const mq = useQuery({
    queryKey: ['markets'],
    queryFn: () => api<{ markets: Market[]; fetchedAt: number }>('/markets'),
    refetchInterval: 30000,
  });
  const ms = mq.data?.markets ?? [],
    m = ms.find((v) => v.id === selected) ?? ms[0];
  useEffect(() => {
    if (!selected && ms[0]) setSelected(ms[0].id);
  }, [ms.length, selected]);
  const dq = useQuery({
    queryKey: ['detail', m?.id, timeframe],
    queryFn: () => api<MarketDetail>(`/markets/${m!.id}?timeframe=${timeframe}`),
    enabled: !!m,
    refetchInterval: 30000,
  });
  const sq = useQuery({
    queryKey: ['scanner', timeframe],
    queryFn: () => api<{ rows: ScanRow[]; fetchedAt: number }>('/scanner?timeframe=' + timeframe),
    enabled: ms.length > 0 && (page === 'Command Center' || page === 'Opportunity Scanner'),
    refetchInterval: 60000,
  });
  const aq = useQuery({
    queryKey: ['account', accountAddress],
    queryFn: () => api<AccountData>('/account/' + accountAddress),
    enabled: !!accountAddress,
    refetchInterval: 20000,
  });
  const detail = useMemo(() => {
      if (!dq.data) return undefined;
      const timedOut = freshnessClock - dq.data.quality.fetchedAt > 90000;
      return {
        ...dq.data,
        quality: {
          ...dq.data.quality,
          stale: dq.data.quality.stale || timedOut,
          notes: [
            ...dq.data.quality.notes,
            ...(timedOut
              ? [
                  'Last successful read is older than 90 seconds. Cached interpretations are disabled.',
                ]
              : []),
          ],
        },
        analysis: reweight(
          timedOut || dq.data.quality.stale ? analyze(dq.data.candles, true) : dq.data.analysis,
          weights,
        ),
      };
    }, [dq.data, weights, freshnessClock]),
    analysis = detail?.analysis,
    liveMarket = detail?.market ?? m,
    account = aq.data;
  const rows = useMemo(() => {
    const rows = (sq.data?.rows ?? []).map((r) => ({
      ...r,
      analysis: reweight(
        freshnessClock - (sq.data?.fetchedAt ?? 0) > 90000 || r.quality.stale
          ? analyze([], true)
          : r.analysis,
        weights,
      ),
    }));
    return rows
      .filter(
        (v) =>
          v.market.symbol.toLowerCase().includes(query.toLowerCase()) &&
          (!onlyWatch || watch.includes(v.market.id)) &&
          matchesPreset(v.analysis, preset),
      )
      .sort((a, b) =>
        sort === 'symbol'
          ? a.market.symbol.localeCompare(b.market.symbol)
          : sort === 'rsi'
            ? (b.analysis.values.rsi ?? -1) - (a.analysis.values.rsi ?? -1)
            : sort === 'change'
              ? (b.market.change24h ?? -Infinity) - (a.market.change24h ?? -Infinity)
              : sort === 'volume'
                ? (b.market.volume24h ?? -1) - (a.market.volume24h ?? -1)
                : b.analysis.score - a.analysis.score,
      );
  }, [sq.data, query, onlyWatch, watch, preset, sort, weights, freshnessClock]);
  function go(p: Page, id?: string) {
    if (id) setSelected(id);
    setPage(p);
    location.hash = encodeURIComponent(p);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  useEffect(() => {
    const h = () => {
      const p = decodeURIComponent(location.hash.slice(1)) as Page;
      setPage(navigation.some((v) => v[0] === p) ? p : 'Command Center');
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  useEffect(() => {
    document.title = `PerpsHQ · ${page}`;
  }, [page]);
  useEffect(() => {
    if (!mobile) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobile(false);
        document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobile]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        go('Opportunity Scanner');
        document.getElementById('market-search')?.focus();
      }
      if (e.key === 'Escape') {
        setAskOpen(false);
        setAlertsOpen(false);
        setMobile(false);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useAlertMonitoring({
    rules,
    setRules,
    setHistory: setAlertHistory,
    account,
    accountError: aq.error,
    notify: setToast,
  });
  function toggleWatch(id: string) {
    setWatch((v) => (v.includes(id) ? v.filter((i) => i !== id) : [...v, id]));
  }
  function savePlan(p: Plan) {
    setSavedPlans((v) => [p, ...v].slice(0, 50));
    setToast('Trade plan saved to this browser.');
  }
  function addJournal(p?: Plan, hash?: string) {
    if (!m) return;
    setJournal((v) => [
      journalEntry(ms.find((m) => m.id === p?.input.marketId) ?? m, p, accountAddress, hash),
      ...v,
    ]);
    go('Trade Journal');
  }
  function updateEvidence(e: Evidence) {
    wallet.reconcile(e);
    setTransactions((v) =>
      v.some((t) => t.hash === e.hash)
        ? v.map((t) => (t.hash === e.hash ? { ...t, state: e.state } : t))
        : [{ hash: e.hash, marketId: e.pool, account: e.account, state: e.state }, ...v],
    );
  }
  function ask() {
    if (!detail) return;
    const q = question.toLowerCase(),
      a = detail.analysis;
    setAnswer(
      q.includes('support')
        ? a.explanations[4]
        : q.includes('resistan')
          ? a.explanations[5]
          : q.includes('rsi')
            ? a.explanations[1]
            : q.includes('risk')
              ? `${a.scenarios.neutral} ${a.explanations[3]} A plan’s stop is not an armed protective order.`
              : q.includes('why') || q.includes('trend')
                ? a.explanations.slice(0, 3).join(' ')
                : a.explanations.join(' '),
    );
  }
  const rising = (sq.data?.rows ?? []).filter(
      (v) =>
        !v.quality.stale &&
        freshnessClock - (sq.data?.fetchedAt ?? 0) <= 90000 &&
        v.analysis.trend === 'Bullish',
    ).length,
    bearish = (sq.data?.rows ?? []).filter(
      (v) =>
        !v.quality.stale &&
        freshnessClock - (sq.data?.fetchedAt ?? 0) <= 90000 &&
        v.analysis.trend === 'Bearish',
    ).length;
  const chartPanel = (large = false) => (
    <section className="panel chart-panel">
      <div className="panel-head">
        <div className="market-title">
          {m && <Coin market={m} />}
          <div>
            <h3>{m?.symbol ?? 'Discovering markets'}</h3>
            <small>Perpetual · USDso</small>
          </div>
          <Badge tone="mint">Hideki</Badge>
        </div>
        <div className="chart-price">
          <strong>{price(liveMarket?.markPrice)}</strong>
          <small>{detail?.market.error ? 'Indexed settlement mark' : 'On-chain oracle mark'}</small>
        </div>
        <button
          className="icon-button"
          title="Add selected market to watchlist"
          onClick={() => m && toggleWatch(m.id)}
        >
          <Star size={17} fill={m && watch.includes(m.id) ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="chart-toolbar">
        <div className="segmented">
          {(Object.keys(intervals) as Timeframe[]).map((t) => (
            <button
              key={t}
              className={t === timeframe ? 'active' : ''}
              onClick={() => setTimeframe(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="muted chart-source">Perp fills / UTC</span>
        <button className="icon-button" onClick={() => dq.refetch()} title="Refresh chart">
          <RefreshCw size={14} className={dq.isFetching ? 'spin' : ''} />
        </button>
      </div>
      {dq.isLoading ? (
        <Skeleton />
      ) : detail?.candles.length ? (
        <Chart
          candles={detail.candles}
          analysis={detail.analysis}
          overlays={overlays}
          height={large ? 430 : 300}
        />
      ) : (
        <Empty title="No verified candle history">
          {dq.error instanceof Error
            ? dq.error.message
            : 'The selected interval has no completed perpetual candles. Try a different interval.'}
        </Empty>
      )}
      <div className="chart-foot">
        <span className="source-dot" />
        Actual dreamDEX perp fills{' '}
        <span className="muted">
          {detail?.quality.count ?? 0} completed candles · {timeframe}
        </span>
        {!large && (
          <button className="text-button" onClick={() => go('Market Intelligence')}>
            Open cockpit <ArrowUpRight size={13} />
          </button>
        )}
      </div>
    </section>
  );
  const marketsTable = (scanner = false) => (
    <section className="panel market-panel">
      <div className="panel-head">
        <div>
          <h3>{scanner ? 'Market scanner' : 'Markets on your radar'}</h3>
          <small>
            {scanner
              ? 'Ranked by explainable technical evidence'
              : 'Explore the Hideki perpetual universe'}
          </small>
        </div>
        {!scanner && (
          <button className="text-button" onClick={() => go('Opportunity Scanner')}>
            Open scanner <ArrowRight size={14} />
          </button>
        )}
      </div>
      <div className="table-controls">
        <div className="tabs">
          <button className={!onlyWatch ? 'active' : ''} onClick={() => setOnlyWatch(false)}>
            All markets <span>{ms.length}</span>
          </button>
          <button className={onlyWatch ? 'active' : ''} onClick={() => setOnlyWatch(true)}>
            <Star size={13} /> Watchlist <span>{watch.length}</span>
          </button>
        </div>
        <label className="search-input">
          <Search size={14} />
          <input
            id="market-search"
            placeholder="Search markets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>
        <label className="sr-only" htmlFor="sort">
          Sort markets
        </label>
        <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score">Opportunity score ↓</option>
          <option value="symbol">Market A–Z</option>
          <option value="rsi">RSI ↓</option>
          <option value="change">Price movers ↓</option>
          <option value="volume">Volume ↓</option>
        </select>
      </div>
      {scanner && (
        <div className="preset-list">
          {presets.map((p) => (
            <button key={p} className={preset === p ? 'active' : ''} onClick={() => setPreset(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      {scanner && (
        <div className="table-reading-hint">
          <span>MARKET OBSERVATIONS</span>
          <span>
            Scroll horizontally for all factors <ArrowRight size={13} />
          </span>
        </div>
      )}
      <div
        className="table-scroll"
        role="region"
        aria-label={scanner ? 'Perpetual market scanner' : 'Perpetual markets'}
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Settlement mark</th>
              <th>24h change</th>
              <th>Volume (USDso)</th>
              <th>Trend</th>
              <th>RSI (14)</th>
              {scanner && (
                <>
                  <th>MACD hist.</th>
                  <th>BB position</th>
                  <th>ADX</th>
                  <th>ATR %</th>
                  <th>Support / resistance</th>
                  <th>Funding / h</th>
                </>
              )}
              <th>
                <span title="Heuristic prioritization score. Not win probability.">
                  Opportunity ⓘ
                </span>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, scanner ? 100 : 8).map(({ market: m, analysis: a, quality: q }) => (
              <tr key={m.id}>
                <td>
                  <div className="market-cell">
                    <button
                      aria-label={`Watch ${m.symbol}`}
                      className={'star ' + (watch.includes(m.id) ? 'selected' : '')}
                      onClick={() => toggleWatch(m.id)}
                    >
                      <Star size={14} fill={watch.includes(m.id) ? 'currentColor' : 'none'} />
                    </button>
                    <Coin market={m} />
                    <div>
                      <button
                        className="market-link"
                        onClick={() => go('Market Intelligence', m.id)}
                      >
                        {m.symbol}
                      </button>
                      <small>{m.baseSymbol} / USDso</small>
                    </div>
                  </div>
                </td>
                <td className="numeric">
                  {price(m.markPrice)}
                  <small className="muted">
                    {m.markUpdatedAt
                      ? new Date(m.markUpdatedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'No mark timestamp'}
                  </small>
                </td>
                <td
                  className={
                    m.change24h === undefined
                      ? 'muted'
                      : m.change24h >= 0
                        ? 'mint-text'
                        : 'red-text'
                  }
                >
                  {m.change24h === undefined
                    ? '—'
                    : (m.change24h >= 0 ? '+' : '') + fmt(m.change24h) + '%'}
                </td>
                <td>
                  {compact(m.volume24h)}
                  <small>24h fill buckets</small>
                </td>
                <td>
                  <Badge
                    tone={
                      a.trend === 'Bullish' ? 'mint' : a.trend === 'Bearish' ? 'red' : 'neutral'
                    }
                  >
                    {a.trend === 'Bullish' ? (
                      <ArrowUpRight size={11} />
                    ) : a.trend === 'Bearish' ? (
                      <ArrowDownLeft size={11} />
                    ) : null}
                    {a.trend}
                  </Badge>
                </td>
                <td className="numeric">
                  {fmt(a.values.rsi, 1)}
                  <span className="rsi-track">
                    <i style={{ width: (a.values.rsi ?? 0) + '%' }} />
                  </span>
                </td>
                {scanner && (
                  <>
                    <td>{fmt(a.values.macdHistogram, 4)}</td>
                    <td>
                      {a.values.bbPosition === null ? '—' : fmt(a.values.bbPosition * 100, 1) + '%'}
                    </td>
                    <td>{fmt(a.values.adx, 1)}</td>
                    <td>{fmt(a.values.atrPct, 2)}</td>
                    <td className="level-cell">
                      S {price(a.zones.find((z) => z.kind === 'support')?.high)}
                      <small>R {price(a.zones.find((z) => z.kind === 'resistance')?.low)}</small>
                    </td>
                    <td>{m.fundingRate === undefined ? '—' : fmt(m.fundingRate * 100, 4) + '%'}</td>
                  </>
                )}
                <td>
                  <div className="score">
                    <span className="score-bar">
                      <i style={{ width: a.score + '%' }} />
                    </span>
                    <strong>{q.stale ? '—' : a.score}</strong>
                    <small>/100</small>
                  </div>
                </td>
                <td>
                  <button
                    className="row-action"
                    aria-label={`Analyze ${m.symbol}`}
                    onClick={() => go('Market Intelligence', m.id)}
                  >
                    {scanner ? 'Analyze' : 'View'}
                    <ArrowUpRight size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sq.isLoading ? (
        <Skeleton />
      ) : (
        rows.length === 0 && (
          <Empty icon={Search} title="No markets match">
            Try another preset or add markets to your watchlist.
          </Empty>
        )
      )}
      <ErrorNote error={sq.error} />
      <div className="table-foot">
        <span>
          <span className="source-dot" /> SDK indexer · {timeframe} completed candles
        </span>
        <span>Missing evidence contributes 0 to score · marks are settlement snapshots</span>
      </div>
    </section>
  );
  const sectionNumber = String(
    Math.max(
      0,
      navigation.findIndex(([name]) => name === page),
    ) + 1,
  ).padStart(2, '0');
  const activeStage =
    page === 'Command Center'
      ? 'Discover'
      : page === 'Portfolio Analytics'
        ? 'Review'
        : workflow.find((stage) => stage.page === page)?.label;
  return (
    <div className="app" data-view={page.toLowerCase().replaceAll(/[^a-z]+/g, '-')}>
      <a
        className="skip-link"
        href="#workspace-content"
        onClick={(event) => {
          event.preventDefault();
          const content = document.getElementById('workspace-content');
          content?.focus();
          content?.scrollIntoView({ block: 'start' });
        }}
      >
        Skip to workspace
      </a>
      {mobile && (
        <button
          className="navigation-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}

      <aside id="workspace-navigation" className={'sidebar ' + (mobile ? 'is-open' : '')}>
        <a className="brand" href="#Command%20Center" onClick={() => go('Command Center')}>
          <span className="brand-symbol">
            <PerspectiveMark />
          </span>
          <span className="brand-wordmark">
            perps<span>hq</span>
            <i>.</i>
          </span>
        </a>
        <div className="brand-caption">PERPETUALS, IN PERSPECTIVE</div>
        <div className="workspace-label">
          YOUR WORKSPACE <span>01 — 09</span>
        </div>
        <nav aria-label="Main workspace">
          {navigation.slice(0, 7).map(([p, Icon], index) => (
            <button
              key={p}
              onClick={() => go(p)}
              aria-current={page === p ? 'page' : undefined}
              className={page === p ? 'nav-item active' : 'nav-item'}
            >
              <Icon size={17} />
              <span>{p}</span>
              <span className="nav-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <button
          className={'nav-item ' + (page === 'Arena Companion' ? 'active' : '')}
          onClick={() => go('Arena Companion')}
        >
          <Trophy size={17} />
          <span>Arena Companion</span>
          <Badge tone="mint">↗</Badge>
        </button>
        <div className="sidebar-bottom">
          <div className="network-card">
            <span className="source-dot" />
            <strong>Somnia Hideki</strong>
            <p>Chain 50383 · Testnet</p>
            <small>Powered by dreamDEX data.</small>
          </div>
          <button
            className={'nav-item ' + (page === 'Settings & Help' ? 'active' : '')}
            onClick={() => go('Settings & Help')}
          >
            <Settings size={17} />
            Settings & Help
          </button>
          <div className="version">
            PerpsHQ v0.1 <span>TESTNET ONLY</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            aria-expanded={mobile}
            aria-controls="workspace-navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <a href="/" aria-label="Website">
              <span className="desktop-website">Website</span>
              <span className="mobile-wordmark">
                perps<span>hq</span>
                <i>.</i>
              </span>
            </a>{' '}
            <ChevronRight size={13} />
            <span>{page}</span>
          </div>
          <div className="topbar-right">
            <span className="network-pill">
              <Globe size={12} />
              Somnia Hideki
              <ChevronDown size={11} />
            </span>
            <button className="health" onClick={() => go('Settings & Help')}>
              <span className={mq.isError ? 'status-dot red-dot' : 'source-dot'} />
              {mq.isError ? 'Data offline' : mq.isLoading ? 'Connecting' : 'Data connected'}
            </button>
            <div className="topbar-divider" />
            <button
              className="icon-button notification"
              aria-label="Open alerts"
              onClick={() => setAlertsOpen(true)}
            >
              <Bell size={17} />
              {alertHistory.length > 0 && <i />}
            </button>
            <button
              className="wallet-button"
              onClick={() =>
                wallet.address && !wallet.correct ? wallet.switchChain() : wallet.connect()
              }
            >
              <Wallet size={14} />
              {wallet.address
                ? wallet.correct
                  ? short(wallet.address)
                  : 'Switch to Hideki'
                : 'Connect wallet'}
            </button>
          </div>
        </header>
        <main id="workspace-content" tabIndex={-1}>
          <div className="page-header">
            <div>
              <div className="eyebrow">
                <span className="mini-line" />
                PERSPECTIVE / {sectionNumber}
                <span className="eyebrow-divider">—</span>
                {page === 'Trade Planner' || page === 'Positions & Risk'
                  ? 'DECIDE WITH INTENT'
                  : page === 'Trade Journal' || page === 'Portfolio Analytics'
                    ? 'BUILD YOUR PROCESS'
                    : 'SEE THE WHOLE PICTURE'}
              </div>
              <h1>{page === 'Command Center' ? 'A clearer view. A better next move.' : page}</h1>
              <p>
                {
                  (
                    {
                      'Command Center':
                        'Your markets, intelligence, and trading workflow. All connected.',
                      'Opportunity Scanner':
                        'Find the markets worth a closer look. Understand the evidence behind every score.',
                      'Market Intelligence': 'Turn real market data into a clearer trading thesis.',
                      'Trade Planner': 'Define your risk before you define your position.',
                      'Positions & Risk': 'Keep your exposure and account health in perspective.',
                      'Portfolio Analytics': 'Review outcomes with a transparent view of the data.',
                      'Trade Journal':
                        'Good decisions deserve a record. Build a repeatable process.',
                      'Arena Companion': 'Prepare for the Arena. Keep your evidence in one place.',
                      'Settings & Help':
                        'Your workspace, data sources, and connection diagnostics.',
                    } as Record<Page, string>
                  )[page]
                }
              </p>
            </div>
            <div className="header-actions">
              <span className="testnet-label">
                <span />
                HIDEKI / 50383
              </span>
              <button
                className="secondary"
                onClick={() => {
                  qc.invalidateQueries();
                  setToast('Refreshing verified data…');
                }}
              >
                <RefreshCw size={14} className={mq.isFetching ? 'spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
          <nav className="workspace-flow" aria-label="Workspace workflow">
            <span className="flow-label">
              <PerspectiveMark />
              THE CONTINUOUS EDGE
            </span>
            <div>
              {workflow.map((stage, index) => (
                <button
                  key={stage.label}
                  aria-current={activeStage === stage.label ? 'step' : undefined}
                  className={activeStage === stage.label ? 'active' : ''}
                  onClick={() => go(stage.page)}
                >
                  <span>0{index + 1}</span>
                  {stage.label}
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          </nav>
          <ErrorNote error={wallet.error ?? (noticeError || null)} />
          <ErrorNote error={mq.error} />
          {page === 'Command Center' && (
            <>
              <div className="metrics">
                <Metric
                  label="Perpetual markets"
                  value={ms.length || '—'}
                  detail="USDso margined · dreamDEX"
                  icon={Globe}
                />
                <Metric
                  label="Bullish conditions"
                  value={sq.data ? rising : '—'}
                  detail={
                    <>
                      <span className="mint-text">EMA alignment</span> · {timeframe} timeframe
                    </>
                  }
                  icon={TrendingUp}
                  tone="mint-text"
                />
                <Metric
                  label="Your watchlist"
                  value={watch.length}
                  detail="Markets you’re keeping an eye on"
                  icon={Star}
                />
                <Metric
                  label="Account equity"
                  value={
                    account?.margin ? price(raw(account.margin.equity, account.quoteDecimals)) : '—'
                  }
                  detail={
                    accountAddress
                      ? 'Verified cross-margin account'
                      : 'Connect a wallet to view your account'
                  }
                  icon={Wallet}
                />
              </div>
              <div className="dashboard-grid">
                {chartPanel()}
                <section className="panel intelligence-panel">
                  <div className="panel-head">
                    <h3>
                      <Sparkles size={16} />
                      Market intelligence
                    </h3>
                    <Badge tone="mint">DETERMINISTIC</Badge>
                  </div>
                  <div className="intel-main">
                    <div className="intel-label">
                      {m?.symbol ?? 'Selected market'}
                      <span> / {timeframe}</span>
                    </div>
                    <h2>{analysis?.regime ?? 'Reading the market…'}</h2>
                    <p>
                      {analysis?.explanations[0] ?? 'Grounded in actual Hideki perp candles.'}{' '}
                      {analysis?.explanations[2]}
                    </p>
                    <div className="intel-facts">
                      <div>
                        <span>RSI (14)</span>
                        <strong>{fmt(analysis?.values.rsi, 1)}</strong>
                      </div>
                      <div>
                        <span>ATR volatility</span>
                        <strong>{fmt(analysis?.values.atrPct)}%</strong>
                      </div>
                      <div>
                        <span>Evidence coverage</span>
                        <strong>{analysis?.coverage ?? '—'}%</strong>
                      </div>
                    </div>
                    <div className="intel-caution">
                      <Shield size={15} />
                      <span>
                        {analysis?.explanations[4] ??
                          'Waiting for confirmed support and resistance.'}
                      </span>
                    </div>
                    <button className="primary full" onClick={() => go('Market Intelligence')}>
                      Explore intelligence
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="intel-bottom">
                    <span className="source-dot" /> Explainable analysis. No black-box signals.
                  </div>
                </section>
              </div>
              {marketsTable()}
              <div className="bottom-grid">
                <section className="panel workflow-panel">
                  <span className="round-icon">
                    <Target size={21} />
                  </span>
                  <div>
                    <h3>From insight to a considered plan.</h3>
                    <p>
                      Size your position around your risk budget, then validate against dreamDEX.
                    </p>
                  </div>
                  <button className="secondary" onClick={() => go('Trade Planner')}>
                    Create a trade plan
                    <ArrowRight size={14} />
                  </button>
                </section>
                <section className="panel sentiment-panel">
                  <div>
                    <h3>Market conditions</h3>
                    <small>Directional EMA alignment · {timeframe}</small>
                  </div>
                  <div className="sentiment-bar">
                    <i style={{ flex: rising || 0.01 }} />
                    <i
                      style={{
                        flex: Math.max(0, (sq.data?.rows.length ?? 0) - rising - bearish) || 0.01,
                      }}
                    />
                    <i style={{ flex: bearish || 0.01 }} />
                  </div>
                  <div className="sentiment-label">
                    <span>↗ {rising} bullish</span>
                    <span>
                      {(sq.data?.rows.length ?? 0) - rising - bearish} mixed / unavailable
                    </span>
                    <span>↘ {bearish} bearish</span>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === 'Opportunity Scanner' && (
            <>
              <div className="scanner-intro">
                <div>
                  <ListFilter size={17} />
                  <span>Scan timeframe</span>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                    aria-label="Scanner timeframe"
                  >
                    {Object.keys(intervals).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <p>Opportunity score is a prioritization heuristic, never a win probability.</p>
              </div>
              {marketsTable(true)}
              <Scoring analysis={analysis} />
            </>
          )}
          {page === 'Market Intelligence' && (
            <>
              <div className="cockpit-grid">
                <section className="panel market-picker">
                  <div className="panel-head">
                    <h3>Markets</h3>
                    <Star size={14} />
                  </div>
                  <div className="picker-list">
                    {ms.map((v) => (
                      <button
                        key={v.id}
                        className={m?.id === v.id ? 'active' : ''}
                        onClick={() => setSelected(v.id)}
                      >
                        <Coin market={v} />
                        <div>
                          <strong>{v.baseSymbol}</strong>
                          <small>PERP</small>
                        </div>
                        <span>{price(v.markPrice)}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <div className="cockpit-center">
                  {chartPanel(true)}
                  <div className="overlay-toolbar">
                    {[
                      'EMA 9',
                      'EMA 20',
                      'EMA 50',
                      'EMA 100',
                      'EMA 200',
                      'SMA 20',
                      'SMA 50',
                      'SMA 200',
                      'Bollinger',
                      'Volume',
                      'S/R zones',
                    ].map((o) => (
                      <label key={o}>
                        <input
                          type="checkbox"
                          checked={overlays.includes(o)}
                          onChange={() =>
                            setOverlays((v) =>
                              v.includes(o) ? v.filter((i) => i !== o) : [...v, o],
                            )
                          }
                        />
                        {o}
                      </label>
                    ))}
                  </div>
                </div>
                <section className="panel cockpit-intel">
                  <div className="panel-head">
                    <h3>
                      <Sparkles size={16} />
                      The market, explained
                    </h3>
                  </div>
                  <div className="intel-main">
                    <Badge
                      tone={
                        analysis?.trend === 'Bullish'
                          ? 'mint'
                          : analysis?.trend === 'Bearish'
                            ? 'red'
                            : 'neutral'
                      }
                    >
                      {analysis?.trend ?? 'Loading'}
                    </Badge>
                    <h2>{analysis?.regime ?? 'Waiting for data'}</h2>
                    {analysis?.explanations.slice(0, 4).map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                    <button className="primary full" onClick={() => go('Trade Planner')}>
                      Plan a trade
                      <ArrowRight size={14} />
                    </button>
                    <button className="text-button full" onClick={() => setAskOpen(true)}>
                      <MessageSquare size={14} />
                      Ask PerpsHQ
                    </button>
                  </div>
                </section>
              </div>
              {detail?.quality.notes.map((n, i) => (
                <div className="notice" key={i}>
                  {n}
                </div>
              ))}
              {detail?.market.error && <div className="notice">{detail.market.error}</div>}
              <div className="analysis-grid">
                <Book detail={detail} />
                <section className="panel">
                  <div className="panel-head">
                    <h3>Multi-timeframe assessment</h3>
                    <Badge>COMPLETED CANDLES</Badge>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Timeframe</th>
                          <th>EMA trend</th>
                          <th>RSI</th>
                          <th>MACD histogram</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['15m', '1h', '4h'] as Timeframe[]).map((t) => (
                          <tr key={t}>
                            <td>{t}</td>
                            <td>{detail?.timeframes[t]?.trend ?? 'Unavailable'}</td>
                            <td>{fmt(detail?.timeframes[t]?.rsi, 1)}</td>
                            <td>{fmt(detail?.timeframes[t]?.macd, 3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel-copy">
                    <p>{analysis?.structure}</p>
                    <small>
                      Each timeframe uses its own completed, contiguous candle history. Missing
                      history never counts as agreement.
                    </small>
                  </div>
                </section>
              </div>
              <div className="analysis-grid">
                <section className="panel">
                  <div className="panel-head">
                    <h3>Indicator detail</h3>
                    <Badge>WARM-UP AWARE</Badge>
                  </div>
                  <div className="indicator-grid">
                    {Object.entries(analysis?.values ?? {}).map(([k, v]) => (
                      <div key={k}>
                        <span>{k.replace(/([A-Z])/g, ' $1').toUpperCase()}</span>
                        <strong>{fmt(v, k.toLowerCase().includes('macd') ? 4 : 2)}</strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h3>Conditional scenarios</h3>
                    <Target size={16} />
                  </div>
                  <div className="scenario-list">
                    <div>
                      <Badge tone="mint">Bullish condition</Badge>
                      <p>{analysis?.scenarios.bullish}</p>
                    </div>
                    <div>
                      <Badge tone="red">Bearish condition</Badge>
                      <p>{analysis?.scenarios.bearish}</p>
                    </div>
                    <div>
                      <Badge>No-trade condition</Badge>
                      <p>{analysis?.scenarios.neutral}</p>
                    </div>
                  </div>
                </section>
              </div>
              <FundingPanel market={m} />
              <HistoricalContext detail={detail} />
              <Scoring analysis={analysis} />
              <div className="source-caption">
                Source: {detail?.quality.source ?? 'Pending'} · Fetched{' '}
                {detail ? new Date(detail.quality.fetchedAt).toLocaleString() : '—'} · Funding{' '}
                {liveMarket?.fundingRate !== undefined
                  ? fmt(liveMarket.fundingRate * 100, 5) + '% per hour (normalized)'
                  : 'unavailable'}
              </div>
            </>
          )}
          {page === 'Trade Planner' && m && (
            <Planner
              key={m.id}
              market={liveMarket!}
              detail={detail}
              wallet={wallet}
              onSave={savePlan}
              onJournal={addJournal}
              onTransaction={(tx) => setTransactions((v) => [tx, ...v].slice(0, 100))}
              pending={transactions.filter(
                (v) =>
                  v.account.toLowerCase() === wallet.address?.toLowerCase() &&
                  ['pending', 'unknown', 'syncing'].includes(v.state),
              )}
              onEvidence={updateEvidence}
            />
          )}
          {page === 'Positions & Risk' && (
            <>
              <AccountOverview
                account={account}
                loading={aq.isLoading}
                address={accountAddress}
                connect={wallet.connect}
              />
              <ErrorNote error={aq.error} />
              {account?.errors.map((e, i) => (
                <div className="notice" key={i}>
                  {e}
                </div>
              ))}
              {accountAddress && (
                <Positions
                  account={account}
                  markets={ms}
                  wallet={wallet}
                  go={go}
                  onTransaction={(tx) => setTransactions((v) => [tx, ...v])}
                />
              )}
              <Alerts
                market={liveMarket}
                rules={rules}
                setRules={setRules}
                history={alertHistory}
              />
              <SubmissionRecovery wallet={wallet} onEvidence={updateEvidence} />
              <TransactionList transactions={transactions} onUpdate={updateEvidence} />
            </>
          )}
          {page === 'Portfolio Analytics' && (
            <Portfolio
              account={account}
              address={accountAddress}
              connect={wallet.connect}
              loading={aq.isLoading}
              markets={ms}
            />
          )}
          {page === 'Trade Journal' && (
            <Journal
              entries={journal}
              setEntries={setJournal}
              onNew={() => addJournal(savedPlans[0])}
              plans={savedPlans}
              go={go}
            />
          )}
          {page === 'Arena Companion' && (
            <Arena
              transactions={transactions}
              journalCount={journal.length}
              planCount={savedPlans.length}
            />
          )}
          {page === 'Settings & Help' && (
            <>
              <WeightSettings weights={weights} onSave={setWeights} />
              <SettingsPanel
                watchAddress={watchAddress}
                setWatchAddress={setWatchAddress}
                connected={!!wallet.address}
                walletConnect={wallet.connect}
                onError={setNoticeError}
              />
            </>
          )}
          <footer>
            <span className="footer-brand">
              <span className="source-dot" />
              PerpsHQ <span>×</span> dreamDEX
            </span>
            <span>Independent frontend · Hideki 50383 · Test funds only</span>
            <a
              href="https://app.testnet.dreamdex.io/docs/developers/perps-testnet"
              target="_blank"
              rel="noreferrer"
            >
              Documentation <ExternalLink size={11} />
            </a>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {askOpen && (
        <div className="modal-backdrop" onClick={() => setAskOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Ask PerpsHQ"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h3>
                <Sparkles size={18} />
                Ask PerpsHQ
              </h3>
              <button
                className="icon-button"
                aria-label="Close assistant"
                onClick={() => setAskOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-content">
              <Badge tone="mint">
                DETERMINISTIC · {m?.symbol} · {timeframe}
              </Badge>
              <h2>Understand the evidence.</h2>
              <p>Answers use the selected market’s structured data. No LLM or API key required.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask();
                }}
              >
                <input
                  autoFocus
                  aria-label="Ask a market question"
                  placeholder="What does RSI indicate here?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <button className="primary" disabled={!detail}>
                  Ask
                  <ArrowRight size={14} />
                </button>
              </form>
              {answer && (
                <div className="answer">
                  {answer}
                  <small>
                    Source: {detail?.quality.source} ·{' '}
                    {detail ? new Date(detail.quality.fetchedAt).toLocaleTimeString() : ''}
                  </small>
                </div>
              )}
              <div className="quick-questions">
                {[
                  'Where is support?',
                  'What does RSI indicate?',
                  'What risks should I consider?',
                ].map((q) => (
                  <button
                    className="secondary"
                    key={q}
                    onClick={() => {
                      setQuestion(q);
                      setAnswer(
                        q.includes('support')
                          ? (analysis?.explanations[4] ?? 'Unavailable')
                          : q.includes('RSI')
                            ? (analysis?.explanations[1] ?? 'Unavailable')
                            : (analysis?.scenarios.neutral ?? 'Unavailable'),
                      );
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
      {alertsOpen && (
        <div className="modal-backdrop" onClick={() => setAlertsOpen(false)}>
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Alert center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h3>Alert center</h3>
              <button
                className="icon-button"
                aria-label="Close alerts"
                onClick={() => setAlertsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <Alerts market={liveMarket} rules={rules} setRules={setRules} history={alertHistory} />
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
