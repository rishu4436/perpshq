import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDot,
  Command,
  Crosshair,
  Layers3,
  Menu,
  MoveUpRight,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import type { Market, MarketDetail, Timeframe } from '../../../packages/shared-types';
import { api, fmt, price } from './lib';
import { fromRaw } from '../../../packages/risk-engine';
import './landing.css';
import { PerspectiveMark } from './components/identity';

const LiveChart = lazy(() => import('./Chart').then((m) => ({ default: m.Chart })));
const workspace = (section = 'Command Center') => '/app#' + encodeURIComponent(section);
function selectMarket(id: string) {
  localStorage.setItem('perpshq.market', JSON.stringify(id));
}

export function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a
      className={'lp-brand' + (footer ? ' lp-brand-footer' : '')}
      href="/"
      aria-label="PerpsHQ home"
    >
      <span className="lp-brand-mark">
        <PerspectiveMark />
      </span>
      <span>
        perps<span className="lp-brand-hq">hq</span>
        <span className="lp-brand-dot">.</span>
      </span>
    </a>
  );
}
function CoinMark({ symbol }: { symbol: string }) {
  return (
    <span className={'lp-coin lp-coin-' + symbol.toLowerCase()}>
      {({ BTC: '₿', ETH: 'Ξ', SOL: '◎', HYPE: 'H' } as Record<string, string>)[symbol] ??
        symbol.slice(0, 1)}
    </span>
  );
}
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="lp-spark-empty">Waiting for verified history</div>;
  const min = Math.min(...values),
    range = Math.max(...values) - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 220},${52 - ((v - min) / range) * 42}`)
    .join(' ');
  return (
    <svg
      className="lp-spark"
      viewBox="0 0 220 62"
      aria-label="Recent actual perpetual candle closes"
      role="img"
    >
      <defs>
        <linearGradient id="lp-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4f88a" stopOpacity=".22" />
          <stop offset="100%" stopColor="#d4f88a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,62 ${points} 220,62`} fill="url(#lp-spark-fill)" />
      <polyline points={points} stroke="#d4f88a" strokeWidth="1.8" fill="none" />
    </svg>
  );
}

const flow = [
  {
    name: 'Discover',
    title: 'Find your next focus.',
    copy: 'Start with the market universe. Filter conditions, build a watchlist, and find the markets that deserve your attention.',
    section: 'Opportunity Scanner',
  },
  {
    name: 'Analyze',
    title: 'See the complete picture.',
    copy: 'Bring price, momentum, volatility, confirmed levels, and multiple timeframes into the same conversation.',
    section: 'Market Intelligence',
  },
  {
    name: 'Plan',
    title: 'Give every decision a framework.',
    copy: 'Define your entry, invalidation, and risk budget. Understand the size of your position before opening your wallet.',
    section: 'Trade Planner',
  },
  {
    name: 'Execute',
    title: 'Make the call. Keep control.',
    copy: 'Validate against dreamDEX, review the exact order, and authorize it with your own testnet wallet.',
    section: 'Trade Planner',
  },
  {
    name: 'Improve',
    title: 'Turn experience into perspective.',
    copy: 'Keep the thesis, the evidence, and the lesson together in a journal you can revisit and export.',
    section: 'Trade Journal',
  },
];
const faqs = [
  [
    'Do I need a wallet to explore?',
    'No. Market discovery, charts, technical analysis, and the opportunity scanner work in public read-only mode. Connect a wallet when you want to inspect your account or review an order.',
  ],
  [
    'Where does the market data come from?',
    'PerpsHQ discovers perpetual markets on Somnia Hideki through the official dreamDEX SDK. Charts use actual perp-fill candles from the Hideki indexer. Current oracle marks and older settlement snapshots are identified separately. Missing or stale history is surfaced.',
  ],
  [
    'What does the opportunity score mean?',
    'It is a transparent research heuristic built from trend, momentum, volume, structure, volatility, level evidence, and available timeframe agreement. It is not a win probability. You can inspect the breakdown and configure the weights.',
  ],
  [
    'Can I execute trades from PerpsHQ?',
    'The external-wallet order flow is implemented for Hideki testnet, chain 50383. It validates and simulates an order before asking for your explicit confirmation and wallet signature. Signed end-to-end execution still awaits verification with an authorized funded wallet. Stop and target levels are planning notes, not armed protective orders.',
  ],
  [
    'Is this connected to mainnet?',
    'This build is for Somnia Hideki testnet and uses test funds. Mainnet trading is not available. PerpsHQ is an independent frontend built around dreamDEX, not an official dreamDEX product.',
  ],
];

export default function Landing() {
  const [menu, setMenu] = useState(false),
    [tab, setTab] = useState('Intelligence'),
    [tf, setTf] = useState<Timeframe>('15m'),
    [step, setStep] = useState(1),
    [faq, setFaq] = useState<number | null>(0);
  const markets = useQuery({
    queryKey: ['markets'],
    queryFn: () => api<{ markets: Market[]; fetchedAt: number }>('/markets'),
    refetchInterval: 60000,
  });
  const rows = markets.data?.markets ?? [],
    btc = rows.find((m) => m.baseSymbol === 'BTC') ?? rows[0];
  const detail = useQuery({
    queryKey: ['detail', btc?.id, tf],
    queryFn: () => api<MarketDetail>(`/markets/${btc!.id}?timeframe=${tf}`),
    enabled: !!btc,
    refetchInterval: 60000,
  });
  const d = detail.data,
    mark = d?.market.error ? undefined : d?.market.markPrice,
    a = d?.analysis;
  useEffect(() => {
    document.title = 'PerpsHQ — A sharper perspective on perpetuals';
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.08 },
    );
    document.querySelectorAll('.lp-reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  function launch(section: string) {
    return btc ? `/app?market=${btc.id}#${encodeURIComponent(section)}` : workspace(section);
  }
  return (
    <div className="landing">
      <header className="lp-header">
        <div className="lp-nav-shell">
          <Brand />
          <nav className={menu ? 'lp-nav is-open' : 'lp-nav'} aria-label="Website navigation">
            <a href="#platform" onClick={() => setMenu(false)}>
              Platform
            </a>
            <a href="#intelligence" onClick={() => setMenu(false)}>
              Intelligence
            </a>
            <a href="#process" onClick={() => setMenu(false)}>
              The process
            </a>
            <a href="#questions" onClick={() => setMenu(false)}>
              FAQ
            </a>
          </nav>
          <a className="lp-nav-cta" href={workspace()}>
            Launch app
            <ArrowUpRight size={15} />
          </a>
          <button
            className="lp-menu"
            aria-label={menu ? 'Close menu' : 'Open menu'}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main className="lp-main">
        <section className="lp-hero lp-container">
          <div className="lp-hero-copy">
            <a className="lp-hero-badge" href="#platform">
              <span className="lp-live-dot" />
              Built for dreamDEX
              <span className="lp-badge-divider" />
              Somnia testnet
              <ArrowUpRight size={12} />
            </a>
            <h1>
              Your next move.
              <br />
              In <span>sharper focus.</span>
            </h1>
            <p className="lp-hero-description">
              A clearer perspective on perpetuals.
              <br />
              Discover the market. Understand the evidence.
              <br className="lp-desktop-break" /> Build a plan that’s yours.
            </p>
            <div className="lp-hero-actions">
              <a className="lp-button" href={workspace()}>
                Enter the workspace
                <ArrowUpRight size={19} />
              </a>
              <a className="lp-text-link" href="#platform">
                <span className="lp-play">
                  <ArrowDown size={14} />
                </span>
                Explore the platform
              </a>
            </div>
            <div className="lp-hero-footnote">
              <span className="lp-avatar-icon">
                <ScanLine size={13} />
              </span>
              Explore first. No wallet required.
              <span className="lp-footnote-line" />
              <span>Testnet only</span>
            </div>
          </div>
          <div
            className="lp-orbit-scene"
            aria-label="A connected view of the perpetual market universe"
          >
            <div className="lp-orbit-halo" />
            <div className="lp-orbit-plane">
              <div className="lp-orbit-ring lp-ring-one" />
              <div className="lp-orbit-ring lp-ring-two" />
              <div className="lp-orbit-ring lp-ring-three" />
              <div className="lp-orbit-axis lp-axis-one" />
              <div className="lp-orbit-axis lp-axis-two" />
            </div>
            <div className="lp-orbit-core">
              <div className="lp-core-inner">
                <PerspectiveMark />
              </div>
            </div>
            <div className="lp-orbit-node lp-node-btc">
              <CoinMark symbol="BTC" />
              <div>
                <strong>BTC</strong>
                <span>Perpetual</span>
              </div>
              <span className="lp-node-dot" />
            </div>
            <div className="lp-orbit-node lp-node-eth">
              <CoinMark symbol="ETH" />
              <strong>ETH</strong>
            </div>
            <div className="lp-orbit-node lp-node-sol">
              <CoinMark symbol="SOL" />
              <strong>SOL</strong>
            </div>
            <div className="lp-scene-label lp-scene-top">
              <span />A CONNECTED PERSPECTIVE
            </div>
            <div className="lp-hero-price-card">
              <div className="lp-price-card-label">
                <span className="lp-live-dot" />
                {btc?.symbol ?? 'BTC-PERP'}
                <span>HIDEKI</span>
              </div>
              <strong className="lp-hero-price">{price(mark)}</strong>
              <span className="lp-price-source">
                {detail.isError
                  ? 'Feed temporarily unavailable'
                  : mark
                    ? 'On-chain oracle mark'
                    : 'Connecting to verified data'}
              </span>
              <Sparkline values={d?.candles.slice(-38).map((c) => c.close) ?? []} />
              <div className="lp-price-card-foot">
                <span>THE MARKET, IN CONTEXT</span>
                <Crosshair size={13} />
              </div>
            </div>
            <div className="lp-scene-coordinates">
              50383 <span>↗</span> SOMNIA HIDEKI
            </div>
          </div>
        </section>
        <div className="lp-proof-strip">
          <div className="lp-container lp-proof-inner">
            <span className="lp-proof-caption">A WORKSPACE WITH PERSPECTIVE</span>
            <span>
              <CircleDot size={16} />
              dreamDEX native
            </span>
            <span>
              <Layers3 size={17} />
              Multiple timeframes
            </span>
            <span>
              <ScanLine size={17} />
              Explainable analysis
            </span>
            <span>
              <Wallet size={17} />
              You authorize every order
            </span>
          </div>
        </div>

        <section id="platform" className="lp-platform lp-container lp-reveal">
          <div className="lp-section-top">
            <div>
              <span className="lp-kicker">
                <i />
                THE WHOLE PICTURE
              </span>
              <h2>
                From first look
                <br />
                to next move.
              </h2>
            </div>
            <p>
              All the context you need.
              <br />
              One connected workspace.
              <br />
              <span>A little less switching. A lot more perspective.</span>
            </p>
          </div>
          <div className="lp-product-frame">
            <div className="lp-window-bar">
              <div className="lp-window-dots">
                <i />
                <i />
                <i />
              </div>
              <div className="lp-window-address">
                <ShieldCheck size={11} />
                perpshq / workspace
              </div>
              <span className="lp-product-status">
                <span className="lp-live-dot" />
                {markets.isError ? 'Data unavailable' : 'Hideki testnet'}
              </span>
            </div>
            <div className="lp-product-content">
              <aside className="lp-preview-sidebar">
                <span className="lp-mini-brand">
                  <Command size={18} />
                  perpshq.
                </span>
                <span className="lp-preview-label">WORKSPACE</span>
                {[
                  { name: 'Intelligence', icon: Crosshair },
                  { name: 'Discover', icon: ScanLine },
                  { name: 'Plan', icon: Layers3 },
                ].map((item) => (
                  <button
                    key={item.name}
                    className={tab === item.name ? 'active' : ''}
                    onClick={() => setTab(item.name)}
                  >
                    <item.icon size={15} />
                    {item.name}
                    {tab === item.name && <i />}
                  </button>
                ))}
                <div className="lp-preview-network">
                  <span className="lp-live-dot" />
                  Somnia Hideki<small>Independent frontend</small>
                </div>
              </aside>
              <div className="lp-preview-main">
                <div className="lp-preview-heading">
                  <div>
                    <span className="lp-preview-eyebrow">PERSPECTIVE / LIVE WORKSPACE</span>
                    <h3>
                      {tab === 'Intelligence'
                        ? 'Every angle. In one view.'
                        : tab === 'Discover'
                          ? 'Find your market.'
                          : 'Consider the risk. Then the trade.'}
                    </h3>
                  </div>
                  <a
                    href={launch(
                      tab === 'Discover'
                        ? 'Opportunity Scanner'
                        : tab === 'Plan'
                          ? 'Trade Planner'
                          : 'Market Intelligence',
                    )}
                    aria-label="Open selected preview in workspace"
                  >
                    <MoveUpRight size={18} />
                  </a>
                </div>
                <div className="lp-preview-mobile-tabs" role="group" aria-label="Product preview">
                  {['Intelligence', 'Discover', 'Plan'].map((t) => (
                    <button className={t === tab ? 'active' : ''} onClick={() => setTab(t)} key={t}>
                      {t}
                    </button>
                  ))}
                </div>
                {tab === 'Intelligence' ? (
                  <div className="lp-terminal-preview">
                    <div className="lp-preview-chart">
                      <div className="lp-chart-heading">
                        <div>
                          <CoinMark symbol={btc?.baseSymbol ?? 'BTC'} />
                          <strong>{btc?.symbol ?? 'BTC-PERP'}</strong>
                          <span>PERPETUAL</span>
                        </div>
                        <strong>{price(mark)}</strong>
                      </div>
                      <div className="lp-chart-options">
                        <div role="group" aria-label="Preview chart timeframe">
                          {(['15m', '1h', '4h'] as Timeframe[]).map((t) => (
                            <button
                              key={t}
                              className={tf === t ? 'active' : ''}
                              onClick={() => setTf(t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        <span>
                          EMA 20 <i />
                          EMA 50 <i />
                        </span>
                      </div>
                      <div className="lp-live-chart">
                        {d?.candles.length ? (
                          <Suspense
                            fallback={<div className="lp-chart-loading">Loading chart…</div>}
                          >
                            <LiveChart
                              candles={d.candles}
                              analysis={d.analysis}
                              overlays={['EMA 20', 'EMA 50', 'Volume']}
                              height={260}
                            />
                          </Suspense>
                        ) : (
                          <div className="lp-chart-loading">
                            <ScanLine size={25} />
                            <span>
                              {detail.isError
                                ? 'Verified history is temporarily unavailable.'
                                : 'Loading actual perpetual candles…'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="lp-preview-chart-source">
                        <span className="lp-live-dot" />
                        Actual dreamDEX perp-fill candles
                        <span>
                          {d?.quality.count ?? '—'} completed · {tf}
                          {d?.quality.stale ? ' · Stale history' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="lp-preview-analysis">
                      <div className="lp-analysis-heading">
                        <Sparkles size={14} />
                        Market intelligence<span>↗</span>
                      </div>
                      <span className="lp-regime">{a?.trend ?? 'Waiting for data'}</span>
                      <h4>{a?.regime ?? 'A clearer perspective.'}</h4>
                      <p>
                        {a?.explanations[0] ??
                          'Technical context drawn from verified market observations.'}
                      </p>
                      <div className="lp-analysis-row">
                        <span>RSI (14)</span>
                        <strong>{fmt(a?.values.rsi, 1)}</strong>
                      </div>
                      <div className="lp-analysis-row">
                        <span>ATR / price</span>
                        <strong>{fmt(a?.values.atrPct)}%</strong>
                      </div>
                      <div className="lp-analysis-row">
                        <span>Evidence coverage</span>
                        <strong>{a?.coverage ?? '—'}%</strong>
                      </div>
                      <a href={launch('Market Intelligence')}>
                        Explore the evidence
                        <ArrowUpRight size={13} />
                      </a>
                    </div>
                  </div>
                ) : tab === 'Discover' ? (
                  <div className="lp-discovery-preview">
                    <div className="lp-discovery-label">
                      <span>HIDEKI PERPETUAL MARKETS</span>
                      <span>Indexed settlement marks</span>
                    </div>
                    {rows.slice(0, 5).map((m) => (
                      <a
                        key={m.id}
                        href={workspace('Market Intelligence')}
                        onClick={() => selectMarket(m.id)}
                      >
                        <CoinMark symbol={m.baseSymbol} />
                        <div>
                          <strong>{m.symbol}</strong>
                          <small>USDso margined</small>
                        </div>
                        <span>{price(m.markPrice)}</span>
                        <ArrowUpRight size={15} />
                      </a>
                    ))}
                    {markets.isError && (
                      <p>
                        Discovery is temporarily unavailable. The workspace includes connection
                        diagnostics.
                      </p>
                    )}
                    <a className="lp-preview-scanner-link" href={workspace('Opportunity Scanner')}>
                      Open the complete scanner
                      <ArrowRight size={14} />
                    </a>
                  </div>
                ) : (
                  <div className="lp-plan-preview">
                    <div>
                      <span className="lp-plan-market">
                        <CoinMark symbol={btc?.baseSymbol ?? 'BTC'} />
                        {btc?.symbol ?? 'Select a market'}
                      </span>
                      <h4>
                        A plan with
                        <br />a point of view.
                      </h4>
                      <p>
                        Your entry. Your invalidation.
                        <br />
                        Your risk budget. Connected to the right market.
                      </p>
                      <a className="lp-button" href={launch('Trade Planner')}>
                        Build a trade plan
                        <ArrowUpRight size={16} />
                      </a>
                    </div>
                    <div className="lp-plan-steps">
                      {[
                        'Define your thesis',
                        'Set a loss budget',
                        'Validate market constraints',
                        'Review & authorize',
                      ].map((v, i) => (
                        <div key={v}>
                          <span>0{i + 1}</span>
                          {v}
                          <Check size={14} />
                        </div>
                      ))}
                      <small>
                        {btc
                          ? `Minimum ${fromRaw(btc.minQuantity, btc.baseDecimals)} ${btc.baseSymbol} · Market-specific lot and tick checks`
                          : 'Market constraints are discovered from dreamDEX.'}
                      </small>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="lp-product-caption">
              <span>01 / THE WORKSPACE</span>
              <span>Real source data. A real product. Explore it for yourself.</span>
              <a href={workspace()}>
                Open full screen
                <ArrowUpRight size={13} />
              </a>
            </div>
          </div>
        </section>

        <section id="intelligence" className="lp-intelligence lp-container">
          <div className="lp-section-top lp-reveal">
            <div>
              <span className="lp-kicker">
                <i />
                BUILT AROUND YOUR DECISIONS
              </span>
              <h2>
                Less noise.
                <br />
                <span>More understanding.</span>
              </h2>
            </div>
            <p>
              Tools that work together.
              <br />
              Context that stays with you.
              <br />
              <span>From the first signal to the final reflection.</span>
            </p>
          </div>
          <div className="lp-bento-grid">
            <article className="lp-feature lp-feature-large lp-reveal">
              <div className="lp-feature-topline">
                <span>01 — INTELLIGENCE</span>
                <Crosshair size={21} />
              </div>
              <div
                className="lp-confluence-art"
                aria-label="Trend, momentum, volatility and structure brought together"
              >
                <div className="lp-confluence-label lp-confluence-trend">
                  Trend
                  <ArrowUpRight size={12} />
                </div>
                <div className="lp-confluence-label lp-confluence-momentum">
                  Momentum
                  <ArrowDownLeft size={12} />
                </div>
                <div className="lp-confluence-label lp-confluence-volatility">
                  Volatility
                  <Layers3 size={12} />
                </div>
                <div className="lp-confluence-label lp-confluence-structure">
                  Structure
                  <Crosshair size={12} />
                </div>
                <div className="lp-confluence-center">
                  <ScanLine size={33} />
                </div>
                <div className="lp-confluence-circle" />
                <div className="lp-confluence-circle outer" />
              </div>
              <h3>
                Every signal,
                <br />
                with its reasoning.
              </h3>
              <p>
                Momentum, volatility, market structure, and multiple timeframes. Understand what
                agrees, what conflicts, and where the evidence ends.
              </p>
              <a href={launch('Market Intelligence')}>
                Find your perspective
                <ArrowUpRight size={16} />
              </a>
            </article>
            <article className="lp-feature lp-feature-scanner lp-reveal">
              <div className="lp-feature-topline">
                <span>02 — DISCOVERY</span>
                <ScanLine size={19} />
              </div>
              <div
                className="lp-scanner-art"
                aria-label="Illustration of a market scanning workflow"
              >
                <div className="lp-scan-line" />
                {['BTC', 'ETH', 'SOL'].map((s, i) => (
                  <div key={s}>
                    <CoinMark symbol={s} />
                    <span>{s}-PERP</span>
                    <div className="lp-art-bars">
                      {[2, 3, 1, 4, 2, 5, 3].map((h, j) => (
                        <i key={j} style={{ height: 5 + h * 3 + (i % 2) * 2 }} />
                      ))}
                    </div>
                    <Crosshair size={12} />
                  </div>
                ))}
              </div>
              <small className="lp-art-caption">Workflow illustration</small>
              <h3>Find your focus.</h3>
              <p>
                A market scanner with an explainable score. Filter conditions and keep your
                watchlist close.
              </p>
              <a href={workspace('Opportunity Scanner')}>
                Explore the scanner
                <ArrowUpRight size={15} />
              </a>
            </article>
            <article className="lp-feature lp-feature-planning lp-reveal">
              <div className="lp-feature-topline">
                <span>03 — INTENTIONAL EXECUTION</span>
                <ShieldCheck size={19} />
              </div>
              <div className="lp-risk-art">
                <div>
                  <span className="lp-risk-crosshair">
                    <Crosshair size={20} />
                  </span>
                  <span className="lp-risk-path" />
                  <Wallet size={22} />
                  <span className="lp-risk-path" />
                  <span className="lp-risk-check">
                    <Check size={15} />
                  </span>
                </div>
                <span>
                  YOUR PLAN <i /> YOUR WALLET <i /> YOUR CALL
                </span>
              </div>
              <h3>Risk, before the click.</h3>
              <p>
                Size around your loss budget. Review protocol constraints. You confirm every testnet
                order.
              </p>
              <a href={launch('Trade Planner')}>
                Create a considered plan
                <ArrowUpRight size={15} />
              </a>
            </article>
          </div>
        </section>

        <section id="process" className="lp-process">
          <div className="lp-container">
            <div className="lp-section-top lp-reveal">
              <div>
                <span className="lp-kicker">
                  <i />
                  ONE CONTINUOUS PROCESS
                </span>
                <h2>Make the connection.</h2>
              </div>
              <p>
                A good workflow keeps the context.
                <br />
                <span>So your next step starts where the last one left off.</span>
              </p>
            </div>
            <div className="lp-flow-tabs lp-reveal" role="tablist" aria-label="Trading workflow">
              {flow.map((f, i) => (
                <button
                  role="tab"
                  aria-selected={step === i}
                  aria-controls="lp-flow-panel"
                  id={'lp-flow-tab-' + i}
                  key={f.name}
                  className={step === i ? 'active' : ''}
                  tabIndex={step === i ? 0 : -1}
                  onKeyDown={(e) => {
                    const next =
                      e.key === 'ArrowRight'
                        ? (i + 1) % flow.length
                        : e.key === 'ArrowLeft'
                          ? (i + flow.length - 1) % flow.length
                          : e.key === 'Home'
                            ? 0
                            : e.key === 'End'
                              ? flow.length - 1
                              : null;
                    if (next !== null) {
                      e.preventDefault();
                      setStep(next);
                      document.getElementById('lp-flow-tab-' + next)?.focus();
                    }
                  }}
                  onClick={() => setStep(i)}
                >
                  <span>0{i + 1}</span>
                  <strong>{f.name}</strong>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
            <div
              className="lp-flow-panel lp-reveal"
              id="lp-flow-panel"
              role="tabpanel"
              aria-labelledby={'lp-flow-tab-' + step}
            >
              <span className="lp-flow-number">
                0{step + 1}
                <i>/05</i>
              </span>
              <div>
                <h3>{flow[step].title}</h3>
                <p>{flow[step].copy}</p>
              </div>
              <a
                href={launch(flow[step].section)}
                className="lp-round-link"
                aria-label={'Open ' + flow[step].name + ' workspace'}
              >
                <MoveUpRight size={25} />
              </a>
            </div>
          </div>
        </section>

        <section className="lp-principles lp-container lp-reveal">
          <div className="lp-principles-heading">
            <span className="lp-kicker">
              <i />
              CLARITY IS A FEATURE
            </span>
            <h2>
              Built on evidence.
              <br />
              Designed for agency.
            </h2>
            <a className="lp-text-link" href={workspace('Settings & Help')}>
              Explore our approach
              <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="lp-principle-list">
            <div>
              <span>01</span>
              <div>
                <h3>Know your source.</h3>
                <p>Actual perp candles. Visible provenance. Missing data stays visible, too.</p>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <h3>Understand the score.</h3>
                <p>
                  Deterministic calculations, inspectable factors, and adjustable weights. Always a
                  research heuristic.
                </p>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <h3>Keep the final say.</h3>
                <p>Read-only exploration. User-owned signing. A review before every order.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="questions" className="lp-faq lp-container lp-reveal">
          <div>
            <span className="lp-kicker">
              <i />A FEW THINGS TO KNOW
            </span>
            <h2>
              Good questions.
              <br />
              Clear answers.
            </h2>
            <p>
              Something else on your mind?
              <br />
              <a href={workspace('Settings & Help')}>
                Explore settings & help
                <ArrowUpRight size={13} />
              </a>
            </p>
          </div>
          <div className="lp-faq-list">
            {faqs.map(([q, answer], i) => (
              <div className={'lp-faq-item' + (faq === i ? 'open' : '')} key={q}>
                <h3>
                  <button
                    aria-expanded={faq === i}
                    aria-controls={'lp-answer-' + i}
                    onClick={() => setFaq(faq === i ? null : i)}
                  >
                    <span>{q}</span>
                    <ChevronDown size={18} />
                  </button>
                </h3>
                <div id={'lp-answer-' + i} hidden={faq !== i}>
                  <p>{answer}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-final-cta lp-container lp-reveal">
          <div className="lp-cta-grid" />
          <span className="lp-kicker">YOUR NEXT CHAPTER STARTS WITH CONTEXT</span>
          <h2>
            A sharper perspective.
            <br />
            <span>A more considered move.</span>
          </h2>
          <a className="lp-button lp-button-dark" href={workspace()}>
            Make yourself at HQ
            <ArrowUpRight size={20} />
          </a>
          <p>No wallet needed to explore. Your decisions stay yours.</p>
          <span className="lp-cta-corner lp-corner-one" />
          <span className="lp-cta-corner lp-corner-two" />
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <div className="lp-footer-top">
          <div>
            <Brand footer />
            <p>Discover. Analyze. Plan. Trade. Improve.</p>
          </div>
          <div className="lp-footer-links">
            <a href="#platform">The platform</a>
            <a href={workspace()}>
              Workspace
              <ArrowUpRight size={12} />
            </a>
            <a
              href="https://app.testnet.dreamdex.io/docs/developers/perps-testnet"
              target="_blank"
              rel="noreferrer"
            >
              dreamDEX docs
              <ArrowUpRight size={12} />
            </a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© {new Date().getFullYear()} PerpsHQ</span>
          <span>Independent frontend. Somnia Hideki testnet. Test funds only.</span>
          <span className="lp-footer-status">
            <span className="lp-live-dot" />
            Made for a clearer view.
          </span>
        </div>
      </footer>
    </div>
  );
}
