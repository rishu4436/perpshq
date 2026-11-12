import { useEffect, useState, useRef } from 'react';
import type { useWallet } from '../../wallet';
import type { Market } from '../../../../../packages/shared-types';
import type { AgentConfig, AgentDecision } from '../../../../../packages/agent-engine';
import { assertSameApproval } from '../../../../../packages/trade-planner/approval';
import { api, errorMessage, useStored, type Preview, type Evidence } from '../../lib';
import { ErrorNote } from '../ui';
import { fromRaw } from '../../../../../packages/risk-engine';
import { assertWalletChallenge } from '../../wallet-auth';
import { agentConfigSchema } from '../../../../../packages/agent-engine/config';
type Review = {
  id?: string;
  config: AgentConfig;
  decision: AgentDecision;
  preview?: Preview;
  expiresAt?: number;
};
const intentKey = 'perpshq.ownerStrategyIntent';
function mergeHistory(...lists: AgentDecision[][]) {
  return [...new Map(lists.flat().map((d) => [d.id, d])).values()]
    .sort((a, b) => a.evaluatedAt - b.evaluatedAt)
    .slice(-100);
}
const strategyNames: Record<AgentConfig['strategy'], string> = {
  'multi-timeframe-trend': 'Trend',
  'support-resistance-breakout': 'Breakout',
  'mean-reversion': 'Mean Reversion',
  'risk-guardian': 'Risk Guardian',
};
type OwnerIntent = {
  ticketId: string;
  account: string;
  marketId: string;
  data: string;
  hash?: string;
};
function readOwnerIntent(): OwnerIntent | null {
  const raw = localStorage.getItem(intentKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value &&
      ['ticketId', 'account', 'marketId', 'data'].every((k) => typeof value[k] === 'string') &&
      (value.hash === undefined || typeof value.hash === 'string')
    )
      return value;
  } catch {
    /* Preserve malformed records so signing remains blocked. */
  }
  return { ticketId: 'invalid', account: '', marketId: '', data: '' };
}
export function OwnerExecution({
  wallet,
  markets,
  hosted = false,
}: {
  wallet: ReturnType<typeof useWallet>;
  markets: Market[];
  hosted?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const reviewEpoch = useRef(0);
  const previousWallet = useRef({ address: wallet.address, chain: wallet.chain });
  const [invalidations, setInvalidations] = useStored<Record<string, string[]>>(
    'perpshq.ownerReviewInvalidations',
    {},
  );
  const [notice, setNotice] = useState('');
  const [walletRequested, setWalletRequested] = useState(false);
  const [operation, setOperation] = useState('Checking live chain data and strategy policy');
  const [startedAt, setStartedAt] = useState(0);
  const [draft, setDraft] = useState(''),
    [review, setReview] = useState<Review>(),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [recoveryHash, setRecoveryHash] = useState(''),
    [error, setError] = useState(''),
    [evidence, setEvidence] = useState<Evidence>();
  const [sessionOwner, setSessionOwner] = useState<string>(),
    [saved, setSaved] = useState<AgentConfig[]>([]),
    [history, setHistory] = useState<AgentDecision[]>([]),
    [remotePending, setRemotePending] = useState<OwnerIntent>(),
    [strategy, setStrategy] = useState<AgentConfig['strategy']>('multi-timeframe-trend'),
    [marketId, setMarketId] = useState(''),
    [timeframe, setTimeframe] = useState<AgentConfig['timeframes'][number]>('15m');
  const authenticated =
    !hosted || (!!wallet.address && sessionOwner === wallet.address.toLowerCase());
  const reviewStale =
    !!review &&
    (review.config.ownerAddress?.toLowerCase() !== wallet.address?.toLowerCase() ||
      !wallet.correct ||
      (invalidations[wallet.address?.toLowerCase() ?? ''] ?? []).includes(review.decision.id));
  useEffect(() => {
    const previous = previousWallet.current;
    if (
      previous.address &&
      (previous.address !== wallet.address || previous.chain !== wallet.chain)
    ) {
      const owner = previous.address.toLowerCase();
      setInvalidations((old) => ({
        ...old,
        [owner]: [
          ...new Set([
            ...(old[owner] ?? []),
            ...history.map((d) => d.id),
            ...(review ? [review.decision.id] : []),
          ]),
        ].slice(-100),
      }));
    }
    const accountChanged = previous.address !== wallet.address;
    previousWallet.current = { address: wallet.address, chain: wallet.chain };
    setNotice('');
    reviewEpoch.current++;
    // Network changes invalidate authorization, but preserve the evidence for inspection.
    // Switching accounts still clears the previous owner's visible snapshot.
    if (accountChanged) setReview(undefined);
    setConsent(false);
  }, [wallet.address, wallet.chain]);
  useEffect(() => {
    if (!hosted) return;
    let active = true;
    setSaved([]);
    setHistory([]);
    setRemotePending(undefined);
    setDraft('');
    setSessionOwner(undefined);
    void api<{ owner: string | null }>('/owner-strategy/session')
      .then((s) => {
        if (active) setSessionOwner(s.owner ?? undefined);
      })
      .catch((e) => {
        if (active) {
          setSessionOwner(undefined);
          setError(errorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [hosted, wallet.address]);
  useEffect(() => {
    if (!hosted || !sessionOwner || sessionOwner !== wallet.address?.toLowerCase()) return;
    let active = true;
    void api<{ configs: AgentConfig[]; decisions: AgentDecision[]; unresolved: OwnerIntent[] }>(
      '/owner-strategy/configs',
    )
      .then((s) => {
        if (active) {
          setSaved(s.configs);
          setHistory((existing) => mergeHistory(existing, s.decisions));
          setRemotePending(s.unresolved[0]);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [hosted, sessionOwner, wallet.address, evidence]);
  useEffect(() => {
    if (!busy && !review?.preview) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review, busy]);
  useEffect(() => {
    if (review?.preview)
      document.getElementById('owner-review-summary')?.scrollIntoView({ block: 'start' });
  }, [review?.id]);
  async function run(
    work: () => Promise<void>,
    label = 'Checking live chain data and strategy policy',
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setOperation(label);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
      if (hosted && e instanceof Error && 'status' in e && e.status === 401)
        setSessionOwner(undefined);
    } finally {
      setBusy(false);
    }
  }
  const pending = readOwnerIntent;
  async function signIn() {
    if (!wallet.address || !wallet.correct)
      throw new Error('Connect your owner wallet on Hideki first');
    const c = await api<{ id: string; message: string }>('/owner-strategy/auth/challenge', {
      account: wallet.address,
      chainId: 50383,
    });
    assertWalletChallenge(c.message, wallet.address, window.location.origin, c.id);
    const signature = await wallet.signMessage(c.message);
    const s = await api<{ owner: string }>('/owner-strategy/auth/verify', { id: c.id, signature });
    setSessionOwner(s.owner);
  }
  function edit(next: AgentConfig) {
    setNotice('');
    reviewEpoch.current++;
    setDraft(JSON.stringify(next, null, 2));
    setReview(undefined);
    setConsent(false);
  }
  function parsedDraft() {
    let value: unknown;
    try {
      value = JSON.parse(draft);
    } catch {
      throw new Error('Configuration must be valid JSON. Check commas and quotation marks.');
    }
    const parsed = agentConfigSchema.safeParse(value);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    const c = parsed.data,
      market = markets.find((m) => m.id.toLowerCase() === c.marketId.toLowerCase());
    if (!market || c.risk.leverage > (market.maxLeverage ?? 1))
      throw new Error(
        `risk.leverage: maximum verified leverage for ${market?.symbol ?? 'this market'} is ${market?.maxLeverage ?? 1}×`,
      );
    return c;
  }
  function select(
    strategyValue: AgentConfig['strategy'],
    marketValue: string,
    timeframeValue: AgentConfig['timeframes'][number],
  ) {
    setStrategy(strategyValue);
    setMarketId(marketValue);
    setTimeframe(timeframeValue);
    if (draft) {
      let c: AgentConfig;
      try {
        c = parsedDraft();
      } catch (error) {
        setError(errorMessage(error));
        return;
      }
      edit({
        ...c,
        id: crypto.randomUUID(),
        revision: 1,
        strategy: strategyValue,
        marketId: marketValue || c.marketId,
        timeframes: [timeframeValue],
        name: `${strategyNames[strategyValue]} · ${markets.find((m) => m.id === (marketValue || c.marketId))?.symbol ?? 'market'} · ${timeframeValue}`,
      });
    }
  }
  async function save() {
    const current = await wallet.checkConnection();
    const c = parsedDraft(),
      old = saved.find((v) => v.id === c.id);
    if (!authenticated || c.ownerAddress?.toLowerCase() !== wallet.address?.toLowerCase())
      throw new Error('Sign in with the configuration owner first');
    const unchanged = old && JSON.stringify(agentConfigSchema.parse(old)) === JSON.stringify(c);
    const result = await api<{ config: AgentConfig }>('/owner-strategy/configs', {
      config: { ...c, revision: unchanged ? old.revision : (old?.revision ?? 0) + 1 },
    });
    current();
    setSaved((v) => [...v.filter((s) => s.id !== result.config.id), result.config]);
    edit(result.config);
    setNotice(`Saved ${result.config.name} · revision ${result.config.revision}.`);
  }
  async function load() {
    if (!wallet.address || !wallet.correct)
      throw new Error('Connect the owner wallet on Hideki first');
    if (!authenticated) throw new Error('Sign in with your connected wallet first');
    const market =
      markets.find((m) => m.id === marketId) ??
      markets.find((m) => m.baseSymbol === 'BTC') ??
      markets[0];
    const config = await api<AgentConfig>(
      `/owner-strategy/defaults?account=${wallet.address}&marketId=${market.id}`,
    );
    setDraft(
      JSON.stringify(
        {
          ...config,
          strategy,
          timeframes: [timeframe],
          name: `${strategyNames[strategy]} · ${market.symbol} · ${timeframe}`,
        },
        null,
        2,
      ),
    );
    setReview(undefined);
    setConsent(false);
  }
  async function validate() {
    const current = await wallet.checkConnection(),
      epoch = reviewEpoch.current;
    if (!authenticated) throw new Error('Sign in with your connected wallet first');
    if (pending() || wallet.blocked)
      throw new Error('Reconcile the existing wallet request before another review');
    const config = parsedDraft();
    if (config.ownerAddress?.toLowerCase() !== wallet.address?.toLowerCase() || !wallet.correct)
      throw new Error('Configuration must match the connected owner on Hideki');
    const result = await api<Review>('/owner-strategy/review', { config });
    await wallet.checkConnection();
    current();
    if (epoch !== reviewEpoch.current)
      throw new Error('Configuration changed while reviewing. Review again.');
    setReview({ ...result, config });
    setConsent(false);
    if (hosted) setHistory((v) => mergeHistory(v, [result.decision]));
  }
  async function submit() {
    const current = await wallet.checkConnection(),
      epoch = reviewEpoch.current;
    if (!consent || !review?.id || !review.preview || pending() || wallet.blocked)
      throw new Error('A fresh reviewed proposal and consent are required');
    if (reviewStale) throw new Error('Stale review. Review again on Hideki before signing.');
    if (Date.now() > review.preview.expiresAt)
      throw new Error('Review expired. Review again before opening the wallet.');
    if (JSON.stringify(parsedDraft()) !== JSON.stringify(agentConfigSchema.parse(review.config)))
      throw new Error('Configuration changed; review again');
    const fresh = await api<Review>('/owner-strategy/review', {
      config: review.config,
      ticketId: review.id,
    });
    await wallet.checkConnection();
    current();
    if (epoch !== reviewEpoch.current)
      throw new Error('Configuration changed while reviewing. Review again.');
    if (!fresh.preview) throw new Error('Strategy no longer has an executable proposal');
    assertSameApproval(review.preview, fresh.preview);
    if (Date.now() > review.preview.expiresAt)
      throw new Error('Review expired during live checks. Review again before opening the wallet.');
    const intent = {
      ticketId: review.id,
      account: fresh.preview.account,
      marketId: review.config.marketId,
      data: fresh.preview.data,
    };
    localStorage.setItem(intentKey, JSON.stringify(intent));
    try {
      await api('/owner-strategy/begin', { ticketId: review.id });
    } catch (e) {
      // A lost HTTP response may follow a committed durable registration.
      // Only an explicit client-error response proves this begin was refused.
      if (
        e instanceof Error &&
        'status' in e &&
        typeof e.status === 'number' &&
        e.status >= 400 &&
        e.status < 500
      )
        localStorage.removeItem(intentKey);
      throw e;
    }
    setWalletRequested(true);
    try {
      const hash = await wallet.send(
        {
          ...fresh.preview,
          expiresAt: Math.min(fresh.preview.expiresAt, review.preview.expiresAt),
        },
        async () => {
          await api('/owner-strategy/rejected', { ticketId: intent.ticketId, walletCode: 4001 });
          if (pending()?.ticketId === intent.ticketId) localStorage.removeItem(intentKey);
        },
        async () => {
          await api('/owner-strategy/rejected', {
            ticketId: intent.ticketId,
            walletCode: 'not-dispatched',
          });
          if (pending()?.ticketId === intent.ticketId) localStorage.removeItem(intentKey);
        },
      );
      localStorage.setItem(intentKey, JSON.stringify({ ...intent, hash }));
      setNotice(`Submitted ${hash}. Reconcile strategy transaction to verify its receipt.`);
    } finally {
      setWalletRequested(false);
    }
    setReview(undefined);
    setConsent(false);
  }
  async function reconcile() {
    const intent = pending();
    if (!intent) throw new Error('No submitted strategy request');
    if (intent.ticketId === 'invalid')
      throw new Error(
        'Saved strategy request is damaged. Restore its local backup before submitting again.',
      );
    const status = await api<{ state: string; account: string; to: string; data: string }>(
      `/owner-strategy/status/${intent.ticketId}`,
    );
    if (status.state === 'rejected') {
      wallet.reconcileRejection(status);
      localStorage.removeItem(intentKey);
      setReview(undefined);
      setConsent(false);
      return;
    }
    const matchingSubmission =
      wallet.submission &&
      wallet.submission.account.toLowerCase() === intent.account.toLowerCase() &&
      wallet.submission.to.toLowerCase() === intent.marketId.toLowerCase() &&
      wallet.submission.data.toLowerCase() === intent.data.toLowerCase();
    const hash =
      intent.hash ||
      (matchingSubmission ? wallet.submission?.hash : undefined) ||
      recoveryHash.trim();
    if (!/^0x[\da-f]{64}$/i.test(hash))
      throw new Error(
        'Wallet outcome is unknown. Recover its hash from wallet activity before retrying',
      );
    const result = await api<{ evidence: Evidence; strategyVerified: boolean }>(
      '/owner-strategy/receipt',
      { ...intent, hash },
    );
    wallet.reconcile(result.evidence);
    setEvidence(result.evidence);
    localStorage.removeItem(intentKey);
    setRecoveryHash('');
  }
  return (
    <section className="panel" aria-label="Connected wallet strategy execution">
      <div className="panel-head">
        <h3>Execute a strategy with your wallet</h3>
        <span>Hideki · owner approval</span>
      </div>
      <div className="modal-content">
        <p>
          Review a live strategy decision, then approve its exact transaction in your connected
          wallet. No automatic signing. Risk Guardian can cancel excess owned resting orders; native
          position exits remain unavailable here.
        </p>
        {hosted && (
          <>
            <p>
              Sign in once to protect your saved strategies and transaction recovery. The sign-in
              message does not authorize trades; every transaction still needs its own wallet
              approval.
            </p>
            {authenticated ? (
              <p role="status">
                Signed in as {sessionOwner}{' '}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api('/owner-strategy/auth/logout', {});
                      setSessionOwner(undefined);
                      setSaved([]);
                      setHistory([]);
                      setRemotePending(undefined);
                      setDraft('');
                      setReview(undefined);
                      setConsent(false);
                    })
                  }
                >
                  Sign out
                </button>
              </p>
            ) : (
              wallet.address && (
                <button
                  className="primary"
                  disabled={busy || !wallet.correct}
                  onClick={() => void run(signIn)}
                >
                  Sign in with connected wallet
                </button>
              )
            )}
            {wallet.address && !wallet.correct && (
              <button type="button" className="secondary" onClick={() => void wallet.switchChain()}>
                Switch to Hideki
              </button>
            )}
            <div className="plan-grid">
              <label className="field">
                <span>Strategy</span>
                <select
                  aria-label="Wallet strategy"
                  value={strategy}
                  onChange={(e) =>
                    select(e.target.value as AgentConfig['strategy'], marketId, timeframe)
                  }
                >
                  <option value="multi-timeframe-trend">Trend</option>
                  <option value="support-resistance-breakout">Breakout</option>
                  <option value="mean-reversion">Mean Reversion</option>
                  <option value="risk-guardian">Risk Guardian</option>
                </select>
              </label>
              <label className="field">
                <span>Market</span>
                <select
                  aria-label="Strategy market"
                  value={marketId || markets.find((m) => m.baseSymbol === 'BTC')?.id || ''}
                  onChange={(e) => select(strategy, e.target.value, timeframe)}
                >
                  {markets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.symbol}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Completed timeframe</span>
                <select
                  aria-label="Strategy timeframe"
                  value={timeframe}
                  onChange={(e) =>
                    select(strategy, marketId, e.target.value as AgentConfig['timeframes'][number])
                  }
                >
                  {['1m', '5m', '15m', '1h', '4h', '1d'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            {!!saved.length && (
              <label className="field">
                <span>Saved strategies</span>
                <select
                  aria-label="Saved wallet strategies"
                  defaultValue=""
                  onChange={(e) => {
                    const c = saved.find((c) => c.id === e.target.value);
                    if (c) {
                      setStrategy(c.strategy);
                      setMarketId(c.marketId);
                      setTimeframe(c.timeframes[0]);
                      edit(c);
                    }
                  }}
                >
                  <option value="" disabled>
                    Choose a saved strategy
                  </option>
                  {saved.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {strategyNames[c.strategy]} ·{' '}
                      {markets.find((m) => m.id === c.marketId)?.symbol} · {c.timeframes.join('/')}{' '}
                      · revision {c.revision} · {c.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {remotePending && !pending() && (
              <button
                className="secondary"
                onClick={() => {
                  localStorage.setItem(intentKey, JSON.stringify(remotePending));
                  setError(
                    'Recovered your unresolved request. Reconcile its matching receipt before another trade.',
                  );
                }}
              >
                Recover pending wallet request
              </button>
            )}
          </>
        )}
        {!wallet.address ? (
          <button className="primary" onClick={() => void wallet.connect()}>
            Connect owner wallet
          </button>
        ) : (
          <button
            className="secondary"
            disabled={busy || !authenticated || !wallet.correct}
            onClick={() => void run(load)}
          >
            Load owner strategy configuration
          </button>
        )}
        {draft && (
          <>
            {hosted && (
              <button
                className="secondary"
                disabled={busy || !authenticated || !wallet.correct}
                onClick={() => void run(save)}
              >
                Save wallet strategy
              </button>
            )}
            <label className="field">
              <span>Owner strategy configuration</span>
              <textarea
                aria-label="Owner strategy configuration"
                rows={12}
                style={{ width: '100%', fontFamily: 'monospace' }}
                value={draft}
                onChange={(e) => {
                  reviewEpoch.current++;
                  setNotice('');
                  setDraft(e.target.value);
                  setReview(undefined);
                  setConsent(false);
                }}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !wallet.correct || !authenticated}
              onClick={() =>
                void run(
                  validate,
                  'Reviewing completed candles, account state and daily-loss limits',
                )
              }
            >
              Review live owner strategy
            </button>
          </>
        )}
        <ErrorNote error={error} />
        {notice && <p role="status">{notice}</p>}
        {review && (
          <>
            <h4 id="owner-review-summary">{review.decision.type.replaceAll('_', ' ')}</h4>
            {reviewStale && (
              <p role="note" aria-label="Review validity">
                <strong>Stale — wallet account or network changed</strong>. Historical evidence
                only. Run a fresh review on Hideki before execution.
              </p>
            )}
            <p>{review.decision.rationale}</p>
            {review.decision.candleEvidence ? (
              <section aria-label="Reviewed candle evidence">
                <h4>Reviewed candle · {review.decision.candleEvidence.timeframe}</h4>
                <p>
                  Open time (UTC):{' '}
                  {Number.isFinite(review.decision.candleEvidence.openTime)
                    ? new Date(review.decision.candleEvidence.openTime * 1000).toISOString()
                    : 'Unavailable'}
                  <br />
                  Close time (UTC):{' '}
                  {Number.isFinite(review.decision.candleEvidence.closeTime)
                    ? new Date(review.decision.candleEvidence.closeTime * 1000).toISOString()
                    : 'Unavailable'}
                </p>
                <dl>
                  {(['open', 'high', 'low', 'close', 'volume'] as const).map((key) => (
                    <div key={key}>
                      <dt>{key.toUpperCase()}</dt>
                      <dd>
                        {Number.isFinite(review.decision.candleEvidence![key])
                          ? review.decision.candleEvidence![key]
                          : 'Unavailable'}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p>
                  <strong>Closed: {review.decision.candleEvidence.closed ? 'Yes' : 'No'}</strong> ·
                  Source marked complete:{' '}
                  {review.decision.candleEvidence.sourceComplete ? 'Yes' : 'No'}
                </p>
                <small>
                  Source: {review.decision.candleEvidence.source}. Values are the recorded candle
                  used by this review, not the current mark.
                </small>
              </section>
            ) : (
              <p>
                No candle snapshot is available for this review. Older history is not backfilled;
                run a fresh review.
              </p>
            )}
            {!!review.decision.failed?.length && (
              <div role="note" aria-label="Conditions preventing execution">
                <strong>Conditions preventing execution</strong>
                <ul>
                  {review.decision.failed.map((condition) => (
                    <li key={condition}>{condition}</li>
                  ))}
                </ul>
                <p>No transaction is available until the strategy and risk checks pass.</p>
              </div>
            )}
            {review.preview && (
              <dl style={{ overflowWrap: 'anywhere' }}>
                <dt>Market / side</dt>
                <dd>
                  {review.preview.market} · {review.decision.proposal?.side ?? 'Cancel owned order'}
                </dd>
                <dt>Quantity</dt>
                <dd>{review.decision.proposal?.quantity ?? 'Not applicable'}</dd>
                <dt>Execution price bound</dt>
                <dd>
                  {review.preview.rawPrice
                    ? fromRaw(
                        review.preview.rawPrice,
                        markets.find(
                          (m) => m.id.toLowerCase() === review.config.marketId.toLowerCase(),
                        )?.quoteDecimals ?? 18,
                      )
                    : 'Cancellation'}
                </dd>
                <dt>Owner / chain</dt>
                <dd>
                  {review.preview.account} · {review.preview.chainId}
                </dd>
                <dt>Pool</dt>
                <dd>{review.preview.to}</dd>
                <dt>Estimated gas</dt>
                <dd>{review.preview.estimatedGasSTT} STT</dd>
                <dt>Review time remaining</dt>
                <dd>{Math.max(0, Math.ceil((review.preview.expiresAt - now) / 1000))} seconds</dd>
              </dl>
            )}
            <details>
              <summary>View signal and risk evidence</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {JSON.stringify(
                  { decision: review.decision, transaction: review.preview },
                  null,
                  2,
                )}
              </pre>
            </details>
            {review.preview && (
              <>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={reviewStale}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  I approve this exact strategy transaction on Hideki. Planning stops are not armed.
                </label>
                <button
                  className="primary"
                  disabled={
                    !consent ||
                    busy ||
                    !wallet.correct ||
                    !authenticated ||
                    reviewStale ||
                    now > review.preview.expiresAt
                  }
                  onClick={() => void run(submit)}
                >
                  {walletRequested
                    ? 'Wallet approval pending — inspect MetaMask'
                    : reviewStale
                      ? 'Stale review — review again'
                      : now > review.preview.expiresAt
                        ? 'Review expired — review again'
                        : 'Confirm strategy & open wallet'}
                </button>
                {walletRequested && (
                  <p role="status">
                    This request was sent to MetaMask while valid. The review timer cannot withdraw
                    an open wallet request. Approve or reject it there; do not submit another
                    request.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {pending() && !pending()?.hash && (
          <label className="field">
            <span>Recover transaction hash from wallet activity</span>
            <input
              aria-label="Strategy recovery transaction hash"
              value={recoveryHash}
              onChange={(e) => setRecoveryHash(e.target.value)}
              placeholder="0x…"
            />
            <small>
              A matching confirmed Hideki receipt is required before another request can proceed.
            </small>
          </label>
        )}
        <button className="secondary" disabled={busy} onClick={() => void run(reconcile)}>
          Reconcile strategy transaction
        </button>
        {evidence && (
          <p>
            Verified strategy transaction: {evidence.hash} · {evidence.state}
          </p>
        )}
        {busy && (
          <p role="status">
            {operation}… {Math.max(0, Math.floor((now - startedAt) / 1000))}s elapsed.
            {now - startedAt >= 10000 && (
              <>
                {' '}
                Still waiting for RPC/indexer reads and complete risk accounting. This review does
                not send a transaction.
              </>
            )}
          </p>
        )}
        {hosted && history.length > 0 && (
          <details>
            <summary>Recent strategy reviews ({history.length})</summary>
            <p>
              Historical evidence only. These records cannot authorize a transaction; run a fresh
              review of your current configuration.
            </p>
            <ul>
              {history
                .slice(-10)
                .reverse()
                .map((d, i) => (
                  <li key={`${d.id}:${i}`}>
                    {d.strategy} · {d.type.replaceAll('_', ' ')} ·{' '}
                    {d.configRevision !== undefined && <>revision {d.configRevision} · </>}
                    {saved.some((c) => c.id === d.agentId && c.revision !== d.configRevision) && (
                      <strong>Stale — configuration changed · </strong>
                    )}
                    {(invalidations[wallet.address?.toLowerCase() ?? ''] ?? []).includes(d.id) && (
                      <strong>Stale — wallet account or network changed · </strong>
                    )}
                    {new Date(d.evaluatedAt).toLocaleString()}
                    <p>{d.rationale}</p>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
