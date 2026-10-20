import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink } from 'lucide-react';
import {
  NETWORK,
  type Analysis,
  type Market,
  type MarketDetail,
} from '../../../../packages/shared-types';
import { estimateFill } from '../../../../packages/risk-engine';
import { api, fmt, price, compact, short } from '../lib';
import { evaluateCrossovers } from '../../../../packages/signal-evaluator';
import { Badge, Empty, ErrorNote, Skeleton } from './ui';

export function Scoring({ analysis: a }: { analysis?: Analysis }) {
  return (
    <section className="panel scoring-panel">
      <div className="panel-head">
        <div>
          <h3>Behind the opportunity score</h3>
          <small>A transparent way to prioritize your research</small>
        </div>
        <Badge>NOT A FORECAST</Badge>
      </div>
      <div className="factor-grid">
        {a?.factors.map((f) => (
          <div key={f.name}>
            <div>
              <span>{f.name}</span>
              <strong>
                {f.value === null ? '—' : Math.round(f.value * f.weight)}
                <small> / {f.weight}</small>
              </strong>
            </div>
            <span className="factor-track">
              <i style={{ width: (f.value ?? 0) * 100 + '%' }} />
            </span>
            <small>{f.reason}</small>
          </div>
        ))}
      </div>
      <div className="table-foot">
        Fixed 100-point denominator. Missing factors contribute zero; no reweighting rewards missing
        data. Coverage {a?.coverage ?? 0}%.
      </div>
    </section>
  );
}

export function Book({ detail: d }: { detail?: MarketDetail }) {
  const b = d?.book,
    bestBid = b?.bids[0]?.price,
    bestAsk = b?.asks[0]?.price;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : undefined;
  return (
    <section className="panel book">
      <div className="panel-head">
        <h3>Visible order book</h3>
        <Badge>ON-CHAIN SNAPSHOT</Badge>
      </div>
      {b ? (
        <>
          <div className="book-columns">
            <div>
              <div className="book-head">
                <span>Bid (USDso)</span>
                <span>Size</span>
              </div>
              {b.bids.slice(0, 6).map((v, i) => (
                <div className="book-row bid" key={i}>
                  <span>{fmt(v.price, v.price < 1 ? 5 : 2)}</span>
                  <span>{fmt(v.quantity, 5)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="book-head">
                <span>Ask (USDso)</span>
                <span>Size</span>
              </div>
              {b.asks.slice(0, 6).map((v, i) => (
                <div className="book-row ask" key={i}>
                  <span>{fmt(v.price, v.price < 1 ? 5 : 2)}</span>
                  <span>{fmt(v.quantity, 5)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-copy">
            <p>
              Visible spread {spread === undefined ? 'unavailable' : price(spread)}
              {spread !== undefined && spread < 0
                ? ' · crossed resting snapshot; fillability is not guaranteed'
                : ''}
            </p>
            <small>
              Resting depth can include orders that cannot fill. Snapshot at{' '}
              {new Date(b.fetchedAt).toLocaleTimeString()}; simulation is required before signing.
            </small>
          </div>
          <DepthEstimate book={b} />
        </>
      ) : (
        <Empty title="Depth unavailable">
          {d?.bookError ?? 'Waiting for a verified perp order-book read.'}
        </Empty>
      )}
    </section>
  );
}

export function FundingPanel({ market: m }: { market?: Market }) {
  const [notional, setNotional] = useState(''),
    [hours, setHours] = useState('');
  const q = useQuery({
    queryKey: ['funding', m?.id],
    queryFn: () =>
      api<{
        source: string;
        nextDueAt: number;
        settlementInterval: number;
        calculationWindow: number;
        openInterest?: number;
        history: {
          time: number;
          rate1h: number;
          intervalsSettled: string;
          intervalsAccrued: string;
          txHash: string;
        }[];
      }>(`/markets/${m!.id}/funding`),
    enabled: !!m,
    refetchInterval: 60000,
  });
  const latest = q.data?.history[0]?.rate1h;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Funding & derivatives context</h3>
        <Badge>VERIFIED EVENTS</Badge>
      </div>
      <ErrorNote error={q.error} />
      {q.data ? (
        <>
          <div className="funding-summary">
            <div>
              <small>Open interest · base units</small>
              <strong>
                {compact(q.data.openInterest)} {m?.baseSymbol}
              </strong>
            </div>
            <div>
              <small>Next settlement due · lazy execution</small>
              <strong>{new Date(q.data.nextDueAt).toLocaleString()}</strong>
            </div>
            <div>
              <small>Calculation window / settlement cadence</small>
              <strong>
                {q.data.calculationWindow}s / {q.data.settlementInterval}s
              </strong>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Settlement observed</th>
                  <th>Hourly rate equivalent</th>
                  <th>Intervals spanned / accrued</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {q.data.history.slice(0, 6).map((r) => (
                  <tr key={r.txHash + r.time}>
                    <td>{new Date(r.time).toLocaleString()}</td>
                    <td>{fmt(r.rate1h * 100, 5)}%</td>
                    <td>
                      {r.intervalsSettled} / {r.intervalsAccrued}
                    </td>
                    <td>
                      <a
                        href={`${NETWORK.explorer}/tx/${r.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(r.txHash)}
                        <ExternalLink size={11} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-copy">
            <div className="alert-form">
              <label className="field">
                <span>Hypothetical notional (USDso)</span>
                <input
                  aria-label="Funding estimate notional"
                  inputMode="decimal"
                  value={notional}
                  onChange={(e) => setNotional(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Assumed holding hours</span>
                <input
                  aria-label="Funding estimate hours"
                  inputMode="decimal"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </label>
              <strong>
                {latest !== undefined && Number(notional) > 0 && Number(hours) > 0
                  ? price(Number(notional) * Number(hours) * latest)
                  : '—'}
              </strong>
            </div>
            <small>
              Illustrative long-side cost at the latest observed normalized rate held constant.
              Positive means longs pay; shorts receive the opposite. Lazy settlement and forgiven
              intervals mean this is not a guaranteed payment. Each historical row uses its own rate
              denominator.
            </small>
          </div>
        </>
      ) : q.isLoading ? (
        <Skeleton />
      ) : (
        <Empty title="Funding history unavailable">No funding values are inferred.</Empty>
      )}
    </section>
  );
}

export function HistoricalContext({ detail: d }: { detail?: MarketDetail }) {
  const [horizon, setHorizon] = useState(6),
    [cost, setCost] = useState(20),
    [run, setRun] = useState(false);
  useEffect(() => setRun(false), [d?.market.id]);
  const observations = useMemo(
    () => (run && d && !d.quality.stale ? evaluateCrossovers(d.candles, horizon, cost) : []),
    [run, d?.candles, horizon, cost],
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Historical signal context</h3>
          <small>
            Exploratory EMA 20 close crossovers · {d?.candles.length ?? 0} completed candles
          </small>
        </div>
        <Badge>NO VALIDATED EDGE</Badge>
      </div>
      <div className="panel-copy">
        <p>
          Inspect what followed historical close / EMA 20 crosses in this market’s available
          history. Entry uses the next candle’s open, exit uses a fixed future close, and the cost
          below is deducted from each observation. Results do not represent achievable fills.
        </p>
        <div className="alert-form">
          <label className="field">
            <span>Forward candle horizon</span>
            <input
              aria-label="Signal evaluation horizon"
              type="number"
              min="1"
              max="48"
              value={horizon}
              onChange={(e) => {
                setRun(false);
                setHorizon(Math.max(1, Math.min(48, Number(e.target.value) || 1)));
              }}
            />
          </label>
          <label className="field">
            <span>Assumed round-trip cost (bps)</span>
            <input
              aria-label="Signal evaluation costs"
              type="number"
              min="0"
              max="1000"
              value={cost}
              onChange={(e) => {
                setRun(false);
                setCost(Math.max(0, Math.min(1000, Number(e.target.value) || 0)));
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={!d || d.quality.stale || d.candles.length < 80}
            onClick={() => setRun(true)}
          >
            Evaluate observed history
            <ArrowRight size={14} />
          </button>
        </div>
        {run && (
          <div className="evaluation-grid">
            {(['exploration', 'holdout'] as const).map((part) => {
              const rows = observations.filter((o) => o.partition === part),
                mean = (key: 'netMovePct' | 'favorablePct' | 'adversePct') =>
                  rows.length ? rows.reduce((s, o) => s + o[key], 0) / rows.length : null;
              return (
                <div key={part}>
                  <Badge>
                    {part === 'exploration' ? 'FIRST 70% · EXPLORATION' : 'LAST 30% · HOLDOUT'}
                  </Badge>
                  <div className="summary-row">
                    <span>Signal observations</span>
                    <strong>{rows.length}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Mean move after assumed costs</span>
                    <strong>{fmt(mean('netMovePct'), 3)}%</strong>
                  </div>
                  <div className="summary-row">
                    <span>Mean favorable / adverse excursion</span>
                    <strong>
                      {fmt(mean('favorablePct'), 3)}% / {fmt(mean('adversePct'), 3)}%
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <small>
          Chronological 70/30 split; boundary-crossing outcomes excluded. Signals may overlap and
          are not independent. Funding, gaps, market impact and fillability are not modeled. Small
          samples cannot establish accuracy, win probability or a predictive edge. Evaluation is
          disabled when history is stale or shorter than 80 candles.
        </small>
      </div>
    </section>
  );
}

export function DepthEstimate({ book: b }: { book: NonNullable<MarketDetail['book']> }) {
  const [quantity, setQuantity] = useState(''),
    [side, setSide] = useState<'long' | 'short'>('long');
  const qty = Number(quantity),
    est = Number.isFinite(qty) && qty > 0 ? estimateFill(b, side, qty) : null,
    bid = b.bids.reduce((s, l) => s + l.quantity, 0),
    ask = b.asks.reduce((s, l) => s + l.quantity, 0),
    imbalance = bid + ask ? ((bid - ask) / (bid + ask)) * 100 : null;
  return (
    <div className="panel-copy">
      <div className="summary-row">
        <span>Visible resting-size imbalance</span>
        <strong>{fmt(imbalance, 1)}%</strong>
      </div>
      <div className="alert-form">
        <select
          aria-label="Depth estimate side"
          value={side}
          onChange={(e) => setSide(e.target.value as 'long' | 'short')}
        >
          <option value="long">Buy / long</option>
          <option value="short">Sell / short</option>
        </select>
        <input
          aria-label="Depth estimate quantity"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Base quantity"
        />
      </div>
      {est && (
        <>
          <div className="summary-row">
            <span>Estimated visible fill price</span>
            <strong>{price(est.average)}</strong>
          </div>
          <small>
            {est.depthLimited
              ? `Depth limited: ${fmt(est.unfilled, 6)} base quantity beyond the visible snapshot.`
              : 'Visible snapshot covers the requested size.'}{' '}
            This includes resting orders that may fail fillability checks; it is not an executable
            quote.
          </small>
        </>
      )}
    </div>
  );
}
