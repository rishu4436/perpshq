import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, ShieldCheck, Check } from 'lucide-react';
import { agentConfigSchema, type AgentConfig } from '../../../../../packages/agent-engine/config';
import type { Market, Timeframe } from '../../../../../packages/shared-types';
import { api, errorMessage } from '../../lib';
import { Badge, ErrorNote } from '../ui';
export const strategyNames: Record<AgentConfig['strategy'], string> = {
  'multi-timeframe-trend': 'Multi-timeframe trend',
  'support-resistance-breakout': 'Support / resistance breakout',
  'mean-reversion': 'Mean reversion',
  'risk-guardian': 'Risk Guardian',
};
export function StudioDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button,input,select')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const controls = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      old?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        className="modal studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="panel-head">
          <div>
            <small>AGENT STUDIO / CONFIGURATION</small>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close agent dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
type Group = 'conditions' | 'risk' | 'execution' | 'paper';
export function AgentBuilder({
  initial,
  markets,
  onClose,
  onSave,
}: {
  initial: AgentConfig;
  markets: Market[];
  onClose: () => void;
  onSave: (config: AgentConfig) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial),
    [tab, setTab] = useState('Strategy'),
    [error, setError] = useState(''),
    [validated, setValidated] = useState<string[]>(),
    [busy, setBusy] = useState(false);
  const update = (next: AgentConfig) => {
    setDraft(next);
    setValidated(undefined);
    setError('');
  };
  function value(group: Group, key: string) {
    return (draft[group] as unknown as Record<string, string | number | boolean>)[key];
  }
  function field(
    group: Group,
    key: string,
    label: string,
    description: string,
    kind: 'number' | 'decimal' | 'boolean' = 'number',
  ) {
    const change = (v: string | boolean) =>
      update({ ...draft, [group]: { ...draft[group], [key]: kind === 'number' ? Number(v) : v } });
    return kind === 'boolean' ? (
      <label className="studio-check" key={key}>
        <input
          type="checkbox"
          aria-label={label}
          checked={Boolean(value(group, key))}
          onChange={(e) => change(e.target.checked)}
        />
        <span>
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      </label>
    ) : (
      <label className="field" key={key}>
        <span>{label}</span>
        <input
          aria-label={label}
          inputMode="decimal"
          value={String(value(group, key))}
          onChange={(e) => change(e.target.value)}
        />
        <small>{description}</small>
      </label>
    );
  }
  async function validate() {
    setBusy(true);
    try {
      const parsed = agentConfigSchema.parse(draft);
      const result = await api<{ valid: boolean; warnings: string[] }>('/agents/validate', parsed);
      setValidated(result.warnings);
      setError('');
    } catch (e) {
      setError(
        e instanceof Error && 'issues' in e
          ? (e as { issues: { path: unknown[]; message: string }[] }).issues
              .map((i) => i.path.join('.') + ': ' + i.message)
              .join(' · ')
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <StudioDialog title={initial.revision > 1 ? 'Edit agent' : 'Create agent'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const c = agentConfigSchema.parse(draft);
            if (await onSave(c)) onClose();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div
          className="studio-builder-tabs"
          role="tablist"
          aria-label="Agent configuration sections"
        >
          {['Strategy', 'Signals', 'Risk limits', 'Execution & costs', 'Owner & operator'].map(
            (t) => (
              <button
                type="button"
                key={t}
                role="tab"
                aria-selected={t === tab}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ),
          )}
        </div>
        <div className="studio-builder-body">
          <ErrorNote error={error} />
          {tab === 'Strategy' && (
            <>
              <div className="studio-form-intro">
                <Badge tone="mint">DRY RUN FIRST</Badge>
                <h3>A strategy you can inspect.</h3>
                <p>
                  Choose the evidence to watch. Every candidate still passes the shared risk policy.
                  These defaults are illustrative, not optimized trading parameters.
                </p>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Agent name</span>
                  <input
                    aria-label="Agent name"
                    maxLength={64}
                    value={draft.name}
                    onChange={(e) => update({ ...draft, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Strategy type</span>
                  <select
                    aria-label="Strategy type"
                    value={draft.strategy}
                    onChange={(e) =>
                      update({ ...draft, strategy: e.target.value as AgentConfig['strategy'] })
                    }
                  >
                    {Object.entries(strategyNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Trading market</span>
                  <select
                    aria-label="Agent trading market"
                    value={draft.marketId}
                    onChange={(e) => update({ ...draft, marketId: e.target.value })}
                  >
                    {markets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.symbol}
                      </option>
                    ))}
                  </select>
                  <small>Discovered Hideki perpetual pools only.</small>
                </label>
                <label className="field">
                  <span>Activation mode</span>
                  <select
                    aria-label="Agent activation mode"
                    value={draft.mode}
                    onChange={(e) =>
                      update({ ...draft, mode: e.target.value as AgentConfig['mode'] })
                    }
                  >
                    <option value="DRY_RUN">Dry run · simulated ledger</option>
                    <option value="ASSISTED">Assisted · proposals only</option>
                    <option value="AUTONOMOUS_TESTNET" disabled>
                      Autonomous testnet · locked
                    </option>
                  </select>
                  <small>
                    Neither available mode signs or broadcasts. A configuration edit cannot unlock
                    autonomous trading.
                  </small>
                </label>
                <label className="field">
                  <span>Entry side policy</span>
                  <select
                    aria-label="Entry side policy"
                    value={draft.sidePolicy}
                    onChange={(e) =>
                      update({ ...draft, sidePolicy: e.target.value as AgentConfig['sidePolicy'] })
                    }
                  >
                    <option value="both">Both directions, when conditions match</option>
                    <option value="long-only">Long candidates only</option>
                    <option value="short-only">Short candidates only</option>
                  </select>
                </label>
              </div>
              <fieldset className="studio-timeframe-field">
                <legend>Timeframes · first checked is primary</legend>
                {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
                  <label key={tf}>
                    <input
                      type="checkbox"
                      aria-label={'Agent timeframe ' + tf}
                      checked={draft.timeframes.includes(tf)}
                      onChange={(e) =>
                        update({
                          ...draft,
                          timeframes: e.target.checked
                            ? [...draft.timeframes, tf]
                            : draft.timeframes.filter((v) => v !== tf),
                        })
                      }
                    />
                    {tf}
                  </label>
                ))}
                <small>
                  Choose one to three. Current primary: {draft.timeframes[0] ?? 'none'}.
                  Higher-timeframe history must be available.
                </small>
              </fieldset>
            </>
          )}
          {tab === 'Signals' && (
            <>
              <div className="studio-form-intro">
                <h3>{strategyNames[draft.strategy]}</h3>
                <p>
                  Only enabled, fully observed conditions count. Missing or stale evidence withholds
                  candidates.
                </p>
              </div>
              <div className="form-grid">
                {field(
                  'conditions',
                  'emaFast',
                  'Fast EMA period',
                  'Completed-candle smoothing period.',
                )}
                {field(
                  'conditions',
                  'emaSlow',
                  'Slow EMA period',
                  'Must exceed fast EMA; also sets minimum warm-up.',
                )}
                {field(
                  'conditions',
                  'minCoverage',
                  'Minimum indicator coverage (%)',
                  'Coverage is evidence availability, not win probability.',
                )}
                {field(
                  'conditions',
                  'atrMinPct',
                  'Minimum ATR (%)',
                  'Exclude movement below this volatility floor.',
                )}
                {field(
                  'conditions',
                  'atrMaxPct',
                  'Maximum ATR (%)',
                  'Withhold candidates above this volatility cap.',
                )}
                {draft.strategy === 'multi-timeframe-trend' && (
                  <>
                    {field(
                      'conditions',
                      'minTimeframeAgreement',
                      'Required agreeing timeframes',
                      'Cannot exceed configured timeframe count.',
                    )}
                    {field('conditions', 'adxMin', 'Minimum ADX', 'Trend-strength floor.')}
                    {field(
                      'conditions',
                      'rsiLongMin',
                      'Long RSI minimum',
                      'Lower bound for a long trend candidate.',
                    )}
                    {field(
                      'conditions',
                      'rsiLongMax',
                      'Long RSI maximum',
                      'Upper bound for a long trend candidate.',
                    )}
                    {field(
                      'conditions',
                      'rsiShortMin',
                      'Short RSI minimum',
                      'Lower bound for a short trend candidate.',
                    )}
                    {field(
                      'conditions',
                      'rsiShortMax',
                      'Short RSI maximum',
                      'Upper bound for a short trend candidate.',
                    )}
                  </>
                )}
                {draft.strategy === 'support-resistance-breakout' &&
                  field(
                    'conditions',
                    'volumeRatioMin',
                    'Minimum relative volume',
                    'Current completed volume / preceding 20-bar mean.',
                  )}
                {draft.strategy === 'mean-reversion' && (
                  <>
                    {field(
                      'conditions',
                      'rsiOversold',
                      'RSI oversold threshold',
                      'An extreme alone never guarantees a long entry.',
                    )}
                    {field(
                      'conditions',
                      'rsiOverbought',
                      'RSI overbought threshold',
                      'An extreme alone never guarantees a short entry.',
                    )}
                    {field(
                      'conditions',
                      'bandLower',
                      'Lower Bollinger position',
                      '0 is the lower band.',
                    )}
                    {field(
                      'conditions',
                      'bandUpper',
                      'Upper Bollinger position',
                      '1 is the upper band.',
                    )}
                    {field(
                      'conditions',
                      'maDistancePct',
                      'Minimum distance from EMA (%)',
                      'Absolute distance from configured fast EMA.',
                    )}
                    {field(
                      'conditions',
                      'adxMax',
                      'Maximum ranging ADX',
                      'Reject strongly trending conditions.',
                    )}
                  </>
                )}
                {draft.strategy === 'risk-guardian' && (
                  <>
                    {field(
                      'conditions',
                      'reduceHealth',
                      'Reduce below health ratio',
                      'Equity / maintenance; recommends a 25% position reduction.',
                    )}
                    {field(
                      'conditions',
                      'flattenHealth',
                      'Flatten below health ratio',
                      'Must be below reduce threshold.',
                    )}
                    {field(
                      'conditions',
                      'maxUnrealizedLoss',
                      'Maximum unrealized loss (USDso)',
                      'Recommends exit when an observed loss reaches the threshold.',
                      'decimal',
                    )}
                  </>
                )}
              </div>
              <div className="studio-check-grid">
                {draft.strategy === 'multi-timeframe-trend' && (
                  <>
                    {field(
                      'conditions',
                      'requireEMA',
                      'Require EMA alignment',
                      'Price and fast/slow EMA must agree.',
                      'boolean',
                    )}
                    {field(
                      'conditions',
                      'requireMACD',
                      'Require MACD agreement',
                      'Histogram must support the proposed direction.',
                      'boolean',
                    )}
                    {field(
                      'conditions',
                      'requireRSI',
                      'Require RSI range',
                      'Both configured side-specific ranges are enforced.',
                      'boolean',
                    )}
                  </>
                )}
                {draft.strategy === 'support-resistance-breakout' && (
                  <>
                    {field(
                      'conditions',
                      'requireVolume',
                      'Require observed volume',
                      'Missing volume is unavailable, never zero.',
                      'boolean',
                    )}
                    {field(
                      'conditions',
                      'requireLiquidity',
                      'Require current liquidity',
                      'No historical book is invented during backtests.',
                      'boolean',
                    )}
                  </>
                )}
                {draft.strategy === 'mean-reversion' &&
                  field(
                    'conditions',
                    'requireRecovery',
                    'Require price recovery',
                    'A completed close and RSI must turn away from the extreme.',
                    'boolean',
                  )}
              </div>
            </>
          )}
          {tab === 'Risk limits' && (
            <>
              <div className="studio-form-intro">
                <ShieldCheck size={24} />
                <h3>Limits sit outside the strategy.</h3>
                <p>
                  Every proposed action passes central policy. Unknown actual account P&L blocks
                  risk-increasing assisted proposals.
                </p>
              </div>
              <div className="form-grid">
                {field(
                  'risk',
                  'orderNotional',
                  'Desired order notional (USDso)',
                  'Sizing may decrease to fit risk and market lots.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'maxOrderNotional',
                  'Maximum order notional (USDso)',
                  'Hard cap per order.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'maxMarketExposure',
                  'Maximum market exposure (USDso)',
                  'Positions plus remaining orders and proposed size.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'maxTotalExposure',
                  'Maximum total exposure (USDso)',
                  'Account-wide exposure cap.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'riskBudget',
                  'Risk budget per trade (USDso)',
                  'Estimated stop distance, slippage and configured fees.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'leverage',
                  'Planning leverage',
                  'Cannot exceed market or verified account limits.',
                )}
                {field(
                  'risk',
                  'maxOpenPositions',
                  'Maximum open positions',
                  'No new entry at the cap.',
                )}
                {field(
                  'risk',
                  'maxOpenOrders',
                  'Maximum open orders',
                  'Zero disables new entries.',
                )}
                {field(
                  'risk',
                  'maxSessionLoss',
                  'Maximum session loss (USDso)',
                  'Unknown session accounting is a block.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'maxDailyLoss',
                  'Maximum daily loss (USDso)',
                  'Paper uses a conservative observed UTC-day loss guard.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'maxTransactionsPerHour',
                  'Maximum actions per hour',
                  'Dry-run actions model the transaction-rate budget.',
                )}
                {field(
                  'risk',
                  'maxRepeatedFailures',
                  'Maximum repeated failures',
                  'Repeated failures require intervention.',
                )}
                {field(
                  'risk',
                  'maxSlippageBps',
                  'Maximum slippage (bps)',
                  'Hard execution bound; 100 bps = 1%.',
                )}
                {field(
                  'risk',
                  'maxDataAgeSeconds',
                  'Maximum data age (seconds)',
                  'Maximum 90; stale evidence pauses risk-taking.',
                )}
                {field(
                  'risk',
                  'minGasReserveSTT',
                  'Minimum operator STT reserve',
                  'Required in addition to the estimated transaction fee.',
                  'decimal',
                )}
                {field(
                  'risk',
                  'minHealth',
                  'Minimum account health ratio',
                  'Risk-increasing actions require verified health.',
                )}
                {field(
                  'risk',
                  'cooldownSeconds',
                  'Action cooldown (seconds)',
                  'Also suppresses repeated paper actions.',
                )}
                {field(
                  'risk',
                  'failureCooldownSeconds',
                  'Failure cooldown (seconds)',
                  'Unknown outcomes must also be reconciled.',
                )}
              </div>
            </>
          )}
          {tab === 'Execution & costs' && (
            <>
              <div className="notice">
                Stops and targets are monitored rules, not exchange-held protection. Worker shutdown
                does not close positions. All performance here is simulated.
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Proposed order type</span>
                  <select
                    aria-label="Proposed order type"
                    value={draft.execution.orderType}
                    onChange={(e) =>
                      update({
                        ...draft,
                        execution: {
                          ...draft.execution,
                          orderType: e.target.value as 'IOC' | 'LIMIT',
                        },
                      })
                    }
                  >
                    <option value="IOC">Bounded IOC</option>
                    <option value="LIMIT">Resting limit</option>
                  </select>
                </label>
                {field(
                  'execution',
                  'limitOffsetBps',
                  'Limit offset (bps)',
                  'For resting proposals; must fit slippage cap.',
                )}
                {field(
                  'execution',
                  'stopLossPct',
                  'Watched stop distance (%)',
                  'Planning/monitoring level only.',
                )}
                {field(
                  'execution',
                  'takeProfitPct',
                  'Watched target distance (%)',
                  'The worker must be running to observe an exit.',
                )}
                {field(
                  'execution',
                  'expirySeconds',
                  'Order expiry (seconds)',
                  'A separately reviewed expiry is encoded in unsigned calls.',
                )}
                {field(
                  'paper',
                  'initialEquity',
                  'Initial paper equity (USDso)',
                  'Synthetic simulation cash, never wallet collateral.',
                  'decimal',
                )}
                {field(
                  'paper',
                  'slippageBps',
                  'Paper slippage (bps)',
                  'Adverse to each simulated fill; limited by observed depth.',
                )}
                {field(
                  'paper',
                  'feeBps',
                  'Paper fee (bps)',
                  'Charged on every simulated entry/exit fill.',
                )}
                {field(
                  'paper',
                  'fundingBpsPerHour',
                  'Funding assumption (bps/hour)',
                  'Constant assumption; may be negative. Not actual funding.',
                )}
                {field(
                  'paper',
                  'maxVolumeParticipationPct',
                  'Historical participation cap (%)',
                  'Uses previously known volume; does not prove next-open liquidity.',
                )}
              </div>
              <div className="studio-check-grid">
                {field(
                  'execution',
                  'exitOnSignal',
                  'Monitor trend reversal exits',
                  'Existing positions may produce an opposite-side proposal.',
                  'boolean',
                )}
                {field(
                  'execution',
                  'allowPositionReductions',
                  'Permit position-reduction recommendations',
                  'Recommendations only. Delegated position exits remain unavailable; review owner actions separately.',
                  'boolean',
                )}
                {field(
                  'execution',
                  'allowRestingCancellations',
                  'Allow unsigned resting-order management',
                  'Cancellations/order shrinkage still require verified grants.',
                  'boolean',
                )}
              </div>
            </>
          )}
          {tab === 'Owner & operator' && (
            <>
              <div className="studio-form-intro">
                <h3>Public addresses. Separate authority.</h3>
                <p>
                  Dry run needs no wallet. Assisted observation requires public owner/operator
                  addresses. Create and hold any dedicated bot key outside PerpsHQ.
                </p>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Owner Somnia Account address</span>
                  <input
                    aria-label="Owner Somnia Account address"
                    placeholder="0x… · public address only"
                    value={draft.ownerAddress ?? ''}
                    onChange={(e) =>
                      update({ ...draft, ownerAddress: e.target.value || undefined })
                    }
                  />
                  <small>The documented linking flow excludes Legacy Accounts.</small>
                </label>
                <label className="field">
                  <span>Dedicated operator public address</span>
                  <input
                    aria-label="Dedicated operator public address"
                    placeholder="0x… · public address only"
                    value={draft.operatorAddress ?? ''}
                    onChange={(e) =>
                      update({ ...draft, operatorAddress: e.target.value || undefined })
                    }
                  />
                  <small>Must differ from the owner. Never enter a key or seed phrase.</small>
                </label>
              </div>
              <div className="notice">
                Per-market permissions and STT are verified separately. A public address is not
                proof that you own the wallet. No permission grant or fund transfer is performed
                here.
              </div>
            </>
          )}
          {validated && (
            <div className="studio-validation" role="status">
              <strong>
                <Check size={16} />
                Configuration validated for observation
              </strong>
              {validated.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
        </div>
        <div className="studio-dialog-actions">
          <span>Revision {draft.revision} · Hideki 50383</span>
          <button className="secondary" type="button" disabled={busy} onClick={validate}>
            {busy ? 'Checking…' : 'Validate configuration'}
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Save agent
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
