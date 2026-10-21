import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BookOpen } from 'lucide-react';
import type {
  MarketDetail,
  MarketContextSnapshot,
  PlanInput,
  PlanningReference,
} from '../../../../packages/shared-types';
import {
  contextStatus,
  planningCandidates,
  referenceValue,
  entryReference,
  snapshotContext,
} from '../../../../packages/trade-planner/context';
import { Badge } from './ui';
import { fmt, price } from '../lib';
export function IntelligenceContext({
  detail: d,
  input,
  onReference,
  onImport,
  original,
}: {
  detail?: MarketDetail;
  input: PlanInput;
  onReference: (reference: PlanningReference) => void;
  onImport: (context: MarketContextSnapshot) => void;
  original?: MarketContextSnapshot;
}) {
  const [stopSelection, setStopSelection] = useState(''),
    [targetSelection, setTargetSelection] = useState('');
  const now = Date.now(),
    status = contextStatus(d, now),
    candidates = planningCandidates(d, input, now);
  const a = status.fresh ? d?.analysis : undefined;
  const identity = (z: { low: number; high: number; lastSeen: number }) =>
    z.low + ':' + z.high + ':' + z.lastSeen;
  function choose(field: 'stop' | 'target') {
    const list = field === 'stop' ? candidates.stops : candidates.targets;
    const key = field === 'stop' ? stopSelection : targetSelection;
    const z = list.find((z) => identity(z) === key) ?? list[0];
    if (!d || !z || !contextStatus(d).fresh) return;
    onReference({
      field,
      source: z.kind,
      value: referenceValue(z, input.side),
      selectedAt: Date.now(),
      observedAt: d.quality.fetchedAt,
      timeframe: d.candles[0]?.timeframe ?? '15m',
    });
  }
  return (
    <section className="panel intelligence-context">
      <div className="panel-head">
        <div>
          <h3>Market intelligence context</h3>
          <small>
            {d?.market.symbol ?? 'Selected market'} · Analysis references for your draft
          </small>
        </div>
        <Badge tone={status.fresh ? 'mint' : 'neutral'}>
          {status.fresh ? 'VERIFIED HISTORY' : 'CONTEXT UNAVAILABLE'}
        </Badge>
      </div>
      <div className="panel-copy">
        <div className="context-facts">
          <div>
            <small>Current on-chain mark</small>
            <strong>{price(status.markFresh ? d?.market.markPrice : undefined)}</strong>
            <small>
              {d?.market.markUpdatedAt
                ? new Date(d.market.markUpdatedAt).toLocaleString()
                : 'Timestamp unavailable'}
            </small>
          </div>
          <div>
            <small>EMA trend</small>
            <strong>{a?.trend ?? 'Unavailable'}</strong>
          </div>
          <div>
            <small>RSI (14)</small>
            <strong>{fmt(a?.values.rsi, 1)}</strong>
          </div>
          <div>
            <small>MACD histogram</small>
            <strong>
              {a?.values.macdHistogram == null
                ? 'Unavailable'
                : a.values.macdHistogram > 0
                  ? 'Positive'
                  : a.values.macdHistogram < 0
                    ? 'Negative'
                    : 'Flat'}
            </strong>
          </div>
          <div>
            <small>ATR (14)</small>
            <strong>
              {fmt(a?.values.atr, 4)} · {fmt(a?.values.atrPct)}%
            </strong>
          </div>
          <div>
            <small>Nearest confirmed support</small>
            <strong>{price(a?.zones.find((z) => z.kind === 'support')?.high)}</strong>
          </div>
          <div>
            <small>Nearest confirmed resistance</small>
            <strong>{price(a?.zones.find((z) => z.kind === 'resistance')?.low)}</strong>
          </div>
        </div>
        <p>
          {a?.structure ??
            'Structure and directional scenarios are unavailable until fresh, sufficient history is present.'}
        </p>
        <div className="context-timeframes">
          {(['15m', '1h', '4h'] as const).map((tf) => (
            <div key={tf}>
              <span>{tf}</span>
              <strong>
                {status.fresh ? (d?.timeframes[tf]?.trend ?? 'Unavailable') : 'Unavailable'}
              </strong>
              <small>{status.fresh ? (d?.timeframes[tf]?.count ?? 0) : 0} completed</small>
            </div>
          ))}
        </div>
        {status.fresh && (
          <div className="context-scenarios">
            <p>
              <strong>Bullish condition</strong>
              <br />
              {a?.scenarios.bullish}
            </p>
            <p>
              <strong>Bearish condition</strong>
              <br />
              {a?.scenarios.bearish}
            </p>
          </div>
        )}
        {d?.quality.notes.map((note, i) => (
          <small className="block" key={i}>
            {note}
          </small>
        ))}
        {!status.fresh && (
          <div className="notice">
            History is stale, insufficient, or unavailable. Level shortcuts are disabled.
          </div>
        )}
        <div className="context-actions">
          <button
            className="secondary"
            disabled={!status.markFresh}
            onClick={() => {
              if (d && contextStatus(d).markFresh)
                onReference({
                  field: 'entry',
                  source: 'mark',
                  value: entryReference(d),
                  selectedAt: Date.now(),
                  observedAt: d.market.markUpdatedAt!,
                  timeframe: d.candles[0]?.timeframe ?? '15m',
                });
            }}
          >
            Use current mark as entry reference
          </button>
          {(['stop', 'target'] as const).map((field) => {
            const list = field === 'stop' ? candidates.stops : candidates.targets,
              selection = field === 'stop' ? stopSelection : targetSelection;
            const source =
              input.side === 'long'
                ? field === 'stop'
                  ? 'support'
                  : 'resistance'
                : field === 'stop'
                  ? 'resistance'
                  : 'support';
            return (
              <div key={field}>
                <label className="field">
                  <span>Suggested {source} reference</span>
                  <select
                    aria-label={'Select ' + field + ' reference'}
                    value={
                      list.some((z) => identity(z) === selection)
                        ? selection
                        : list[0]
                          ? identity(list[0])
                          : ''
                    }
                    onChange={(e) =>
                      (field === 'stop' ? setStopSelection : setTargetSelection)(e.target.value)
                    }
                    disabled={!list.length}
                  >
                    <option value="" disabled>
                      No eligible level
                    </option>
                    {list.map((z) => (
                      <option key={identity(z)} value={identity(z)}>
                        {price(z.low)}–{price(z.high)} · {z.touches} pivots
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary" disabled={!list.length} onClick={() => choose(field)}>
                  {field === 'stop' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}Use{' '}
                  {source} as planning {field}
                </button>
              </div>
            );
          })}
        </div>
        <p className="context-disclosure">
          Reference levels populate draft fields only after your click. Stops and targets are
          planning notes, not exchange-held protective orders. Only the separately reviewed
          entry/order parameters can be submitted on-chain.
        </p>
        <button
          className="secondary"
          disabled={!d}
          onClick={() => {
            if (d) onImport(original ?? snapshotContext(d));
          }}
        >
          <BookOpen size={14} />
          Import market context into journal
        </button>
        {original && (
          <small className="block">
            Original analysis captured {new Date(original.capturedAt).toLocaleString()} is preserved
            with your saved plan and journal. The panel above shows the latest available read.
          </small>
        )}
      </div>
    </section>
  );
}
