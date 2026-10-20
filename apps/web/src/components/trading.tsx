import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Download,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Shield,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  NETWORK,
  type Market,
  type MarketDetail,
  type PlanInput,
  type Plan,
} from '../../../../packages/shared-types';
import {
  assertPreview,
  assertSameApproval,
  SubmissionFailure,
} from '../../../../packages/trade-planner/approval';
import { planTrade, fromRaw } from '../../../../packages/risk-engine';
import {
  api,
  errorMessage,
  useStored,
  fmt,
  price,
  short,
  raw,
  download,
  type AccountData,
  type Evidence,
  type Preview,
} from '../lib';
import { useWallet } from '../wallet';
import type { Page } from '../types';
import { Metric, Badge, Empty, ErrorNote, Coin, Skeleton } from './ui';

export function Planner({
  market: m,
  wallet,
  onSave,
  onJournal,
  onTransaction,
  pending,
  onEvidence,
}: {
  market: Market;
  detail?: MarketDetail;
  wallet: ReturnType<typeof useWallet>;
  onSave: (p: Plan) => void;
  onJournal: (p: Plan, hash?: string) => void;
  onTransaction: (t: { hash: string; marketId: string; account: string; state: string }) => void;
  pending: { hash: string; marketId: string; account: string; state: string }[];
  onEvidence: (e: Evidence) => void;
}) {
  const initial: PlanInput = {
    marketId: m.id,
    side: 'long',
    type: 'limit',
    entry: '',
    stop: '',
    target: '',
    riskBudget: '',
    collateral: '',
    leverage: '',
    slippageBps: '',
  };
  const [input, setInput] = useStored<PlanInput>('perpshq.planner.' + m.id, initial),
    [preview, setPreview] = useState<Preview>(),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('Draft'),
    [tx, setTx] = useState<string>(),
    [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const plan = useMemo(() => planTrade({ ...input, marketId: m.id }, m), [input, m]);
  const incomplete = (
    ['entry', 'stop', 'target', 'riskBudget', 'collateral', 'leverage', 'slippageBps'] as const
  ).some((key) => !input[key].trim());
  const calculated = !incomplete && Number(plan.quantity) > 0;
  const displayPlanError = (message: string) =>
    message.startsWith('[DecimalError]')
      ? 'Use valid numbers for your prices, risk budget, collateral, leverage and slippage.'
      : message;

  const evidence = useQuery({
    queryKey: ['receipt', tx, m.id, wallet.address],
    queryFn: () => api<Evidence>(`/receipt/${tx}?marketId=${m.id}&account=${wallet.address}`),
    enabled: !!tx && !!wallet.address,
    refetchInterval: (q) =>
      q.state.data &&
      ['filled', 'cancelled', 'reverted', 'rejected', 'resting', 'partial'].includes(
        q.state.data.state,
      )
        ? false
        : 5000,
    retry: false,
  });
  useEffect(() => {
    if (evidence.data) {
      setStatus(evidence.data.state);
      onEvidence(evidence.data);
    }
  }, [evidence.dataUpdatedAt]);
  useEffect(() => {
    setPreview(undefined);
    setConsent(false);
  }, [input, wallet.address, wallet.chain]);
  useEffect(() => {
    if (!preview) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [preview]);
  function field(k: keyof PlanInput, value: string) {
    setInput((v) => ({ ...v, [k]: value }));
    setError('');
    setStatus('Draft');
  }
  async function validate() {
    if (!wallet.address || !wallet.correct) return;
    setBusy(true);
    setStatus('Validating');
    setError('');
    try {
      const p = await api<Preview>('/preview', { input, account: wallet.address });
      assertPreview(p, wallet.address, m.poolAddress);
      setPreview(p);
      setConsent(false);
      setNow(Date.now());
      setStatus('Ready for confirmation');
    } catch (e) {
      setError(errorMessage(e));
      setStatus('Blocked');
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || !preview || !consent || pending.length) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (Date.now() > preview.expiresAt) throw new Error('Preview expired. Validate again.');
      const fresh = await api<Preview>('/preview', {
        input,
        account: wallet.address,
        approvedData: preview.data,
      });
      assertSameApproval(preview, fresh);
      setStatus('Awaiting wallet signature');
      const hash = await wallet.send(fresh);
      setTx(hash);
      onTransaction({ hash, marketId: m.id, account: fresh.account, state: 'pending' });
      setStatus('Transaction pending');
      setPreview(undefined);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      setStatus(
        e instanceof SubmissionFailure
          ? e.outcome === 'rejected'
            ? 'Signature rejected'
            : e.outcome === 'unknown'
              ? 'Unknown broadcast outcome'
              : 'Blocked'
          : 'Blocked',
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  const fieldInput = (key: keyof PlanInput, label: string, hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={input[key] ?? ''}
        onChange={(e) => field(key, e.target.value)}
        placeholder="Enter value"
        aria-label={label}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
  return (
    <>
      <div className="planner-layout">
        <section className="panel planner-form">
          <div className="panel-head">
            <div className="market-title">
              <Coin market={m} />
              <div>
                <h3>{m.symbol}</h3>
                <small>Define your own trade parameters</small>
              </div>
            </div>
            <Badge>USDso</Badge>
          </div>
          <div className="form-body">
            <div className="form-section-label">
              <span>01 /</span> DEFINE THE IDEA
            </div>
            <div className="side-toggle">
              <button
                className={input.side === 'long' ? 'long active' : ''}
                onClick={() => field('side', 'long')}
              >
                <ArrowUpRight size={16} />
                Long
              </button>
              <button
                className={input.side === 'short' ? 'short active' : ''}
                onClick={() => field('side', 'short')}
              >
                <ArrowDownLeft size={16} />
                Short
              </button>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Order type</span>
                <select value={input.type} onChange={(e) => field('type', e.target.value)}>
                  <option value="limit">Limit · GTC</option>
                  <option value="market">Marketable · IOC</option>
                </select>
              </label>
              <div className="mark-context">
                <small>Current mark</small>
                <strong>{price(m.markPrice)}</strong>
                <button
                  className="text-button"
                  disabled={!m.markPrice || !!m.error}
                  onClick={() => field('entry', String(m.markPrice))}
                >
                  Use mark as entry
                </button>
              </div>
              {fieldInput(
                'entry',
                'Entry / reference price',
                'Must align to tick ' + fromRaw(m.tickSize, m.quoteDecimals),
              )}
              {fieldInput('stop', 'Stop-loss level', 'Planning level · not an armed order')}
              {fieldInput('target', 'Take-profit level', 'Planning level · not an armed order')}
              {fieldInput('riskBudget', 'Maximum loss budget (USDso)')}
              {fieldInput(
                'collateral',
                'Available collateral (USDso)',
                'Your stated planning balance; chain limits checked separately',
              )}
              {fieldInput(
                'leverage',
                'Planning leverage',
                'Maximum ' +
                  (m.maxLeverage ?? 'unavailable') +
                  '×; does not change account settings',
              )}
              {fieldInput('slippageBps', 'Slippage allowance (bps)', '0–500 bps. 100 bps = 1%')}
              {fieldInput(
                'quantity',
                'Quantity override (optional)',
                'Leave blank to size from your risk budget',
              )}
            </div>
            <div className="form-actions">
              <button
                className="secondary"
                disabled={plan.errors.length > 0}
                onClick={() => onSave(plan)}
              >
                <BookOpen size={14} />
                Save plan
              </button>
              <button
                className="secondary"
                disabled={plan.errors.length > 0}
                onClick={() => onJournal(plan)}
              >
                Add to journal
                <Plus size={14} />
              </button>
            </div>
          </div>
        </section>
        <div className="plan-review">
          <section className="panel">
            <div className="panel-head">
              <h3>Risk & position preview</h3>
              <Shield size={17} />
            </div>
            <div className="plan-metrics">
              <div className="form-section-label">
                <span>02 /</span> SIZE THE RISK
              </div>
              <div className="plan-size">
                <small>Risk-sized quantity</small>
                <strong>
                  {calculated ? plan.quantity : '—'} <span>{m.baseSymbol}</span>
                </strong>
              </div>
              {[
                ['Notional exposure', calculated ? price(Number(plan.notional)) : '—'],
                ['Planning margin', calculated ? price(Number(plan.margin)) : '—'],
                ['Estimated loss', calculated ? price(Number(plan.loss)) : '—'],
                ['Estimated gain', calculated ? price(Number(plan.gain)) : '—'],
                ['Reward / risk', calculated ? plan.rr + ' : 1' : '—'],
              ].map(([label, value]) => (
                <div className="summary-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="panel-copy">
              <Badge tone={incomplete ? 'neutral' : plan.errors.length ? 'red' : 'mint'}>
                {incomplete ? 'DRAFT PLAN' : plan.errors.length ? 'BLOCKED' : 'PLAN VALID'}
              </Badge>
              {incomplete ? (
                <p className="draft-guidance">
                  Your risk preview will appear as you complete the parameters. Fill in every
                  required value to validate your plan.
                </p>
              ) : (
                plan.errors.map((e, i) => (
                  <p className="red-text" key={i}>
                    {displayPlanError(e)}
                  </p>
                ))
              )}
              {plan.warnings.map((w, i) => (
                <small className="block" key={i}>
                  {w}
                </small>
              ))}
            </div>
          </section>
          <section className="panel execution-card">
            <div className="panel-head">
              <h3>Execute on dreamDEX</h3>
              <Badge tone="mint">50383</Badge>
            </div>
            <div className="panel-copy">
              <div className="form-section-label">
                <span>03 /</span> REVIEW & AUTHORIZE
              </div>
              <div className="summary-row">
                <span>Order lifecycle</span>
                <Badge>{status}</Badge>
              </div>
              <p>
                The official SDK checks account size, voucher restrictions and mark availability.
                The RPC simulates the transaction and estimates gas.
              </p>
              {!wallet.address ? (
                <button className="primary full" onClick={wallet.connect}>
                  <Wallet size={15} />
                  Connect wallet to validate
                </button>
              ) : !wallet.correct ? (
                <button className="primary full" onClick={wallet.switchChain}>
                  Switch to Hideki
                </button>
              ) : (
                <button
                  className="primary full"
                  disabled={busy || plan.errors.length > 0 || pending.length > 0 || wallet.blocked}
                  onClick={validate}
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : <Shield size={15} />}
                  Validate on testnet
                </button>
              )}
              <ErrorNote error={error} />
              {(pending.length > 0 || wallet.blocked) && (
                <div className="notice">
                  A previous transaction has an unresolved state. Reconcile it in Positions & Risk
                  before submitting another order.
                </div>
              )}
              <small className="block">
                No mainnet. No server-held keys. Every transaction requires your wallet approval.
              </small>
            </div>
          </section>
        </div>
      </div>
      {evidence.data && (
        <section className="panel evidence-panel">
          <div className="panel-head">
            <h3>Verified transaction evidence</h3>
            <Badge tone={evidence.data.state === 'rejected' ? 'red' : 'mint'}>
              {evidence.data.state}
            </Badge>
          </div>
          <div className="panel-copy">
            <a
              className="hash-link"
              href={`${NETWORK.explorer}/tx/${evidence.data.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              {evidence.data.hash}
              <ExternalLink size={14} />
            </a>
            <p>
              Block {evidence.data.receipt.blockNumber} · Receipt {evidence.data.receipt.status} ·
              Order ID {evidence.data.orderId ?? 'awaiting event/indexer evidence'}
            </p>
            <p>
              Transaction confirmation and fill confirmation are separate. A resting order remains
              exposed to later execution.
            </p>
            <button
              className="secondary"
              onClick={() =>
                download('perpshq-evidence.json', JSON.stringify(evidence.data, null, 2))
              }
            >
              <Download size={14} />
              Export evidence
            </button>
            <button className="secondary" onClick={() => onJournal(plan, evidence.data!.hash)}>
              Journal this transaction
            </button>
          </div>
        </section>
      )}
      {preview && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm testnet order"
          >
            <div className="panel-head">
              <h3>Review testnet order</h3>
              <button
                className="icon-button"
                aria-label="Close order confirmation"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="modal-content">
              <Badge tone="mint">SOMNIA HIDEKI · 50383</Badge>
              <h2>
                {input.side === 'long' ? 'Buy / long' : 'Sell / short'} {m.symbol}
              </h2>
              <div className="summary-row">
                <span>Quantity</span>
                <strong>
                  {plan.quantity} {m.baseSymbol}
                </strong>
              </div>
              <div className="summary-row">
                <span>Limit / execution bound</span>
                <strong>{price(raw(preview.rawPrice, m.quoteDecimals))}</strong>
              </div>
              <div className="summary-row">
                <span>Estimated gas</span>
                <strong>{preview.estimatedGasSTT} STT</strong>
              </div>
              <div className="address-box">
                <small>Wallet / margin account</small>
                <code>{preview.account}</code>
                <small>Perpetual pool</small>
                <code>{preview.to}</code>
              </div>
              <p>
                Stop and take-profit levels will remain planning notes. This transaction places only
                the {input.type === 'market' ? 'IOC' : 'GTC'} order.
              </p>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I authorize this specific testnet order and understand the planned stop is not
                armed.
              </label>
              <ErrorNote error={error} />
              <button
                className="primary full"
                disabled={!consent || busy || now > preview.expiresAt}
                onClick={submit}
              >
                {busy
                  ? 'Waiting for wallet…'
                  : now > preview.expiresAt
                    ? 'Preview expired — validate again'
                    : 'Confirm & open wallet'}
                <Wallet size={15} />
              </button>
              <small>
                Preview expires in {Math.max(0, Math.ceil((preview.expiresAt - now) / 1000))}{' '}
                seconds. Signing always rechecks the network and account.
              </small>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function AccountOverview({
  account: a,
  address,
  loading,
  connect,
}: {
  account?: AccountData;
  address?: string;
  loading: boolean;
  connect: () => void;
}) {
  if (!address)
    return (
      <section className="panel account-welcome">
        <Empty
          icon={Wallet}
          title="Your account, in perspective"
          action={
            <div className="welcome-actions">
              <button className="primary" onClick={connect}>
                Connect wallet
                <ArrowRight size={15} />
              </button>
              <a className="secondary" href="#Settings%20%26%20Help">
                Use a read-only address
              </a>
            </div>
          }
        >
          Connect an external wallet or set a read-only address in Settings to inspect its Hideki
          margin account.
        </Empty>
        <div className="account-features">
          <div>
            <Shield size={21} />
            <div>
              <strong>Exposure, with context.</strong>
              <p>Inspect cross-margin health, collateral and position requirements.</p>
            </div>
          </div>
          <div>
            <Activity size={21} />
            <div>
              <strong>Evidence over assumptions.</strong>
              <p>Review indexed fills and observations from the connected account.</p>
            </div>
          </div>
          <div>
            <Wallet size={21} />
            <div>
              <strong>Your wallet. Your decision.</strong>
              <p>Explore an address in read-only mode. Every order requires your authorization.</p>
            </div>
          </div>
        </div>
      </section>
    );
  if (loading) return <Skeleton />;
  const m = a?.margin;
  return (
    <>
      <div className="account-caption">
        <Wallet size={14} />
        <code>{address}</code>
        <Badge>{m?.marginStatus ?? 'Unavailable'}</Badge>
      </div>
      <div className="metrics">
        <Metric
          label="Account equity"
          value={price(raw(m?.equity, a?.quoteDecimals))}
          detail="Collateral + P&L − pending funding"
          icon={Wallet}
        />
        <Metric
          label="Unlocked collateral"
          value={price(raw(m?.unlockedCollateralBalance, a?.quoteDecimals))}
          detail="Perps account · not spot wallet"
          icon={Shield}
        />
        <Metric
          label="Maintenance required"
          value={price(raw(m?.mmReq, a?.quoteDecimals))}
          detail="Official cross-margin requirement"
          icon={Activity}
        />
        <Metric
          label="Network gas balance"
          value={a?.gas ? fmt(raw(a.gas), 5) + ' STT' : '—'}
          detail={'Snapshot block ' + (m?.asOfBlock ?? 'unavailable')}
          icon={Zap}
        />
      </div>
    </>
  );
}

export function Positions({
  account: a,
  markets,
  wallet,
  go,
  onTransaction,
}: {
  account?: AccountData;
  markets: Market[];
  wallet: ReturnType<typeof useWallet>;
  go: (p: Page, id?: string) => void;
  onTransaction: (t: { hash: string; marketId: string; account: string; state: string }) => void;
}) {
  const [preview, setPreview] = useState<Preview>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function cancel(m: Market, id: string) {
    setBusy(true);
    setError('');
    try {
      setPreview(
        await api<Preview>('/cancel-preview', {
          marketId: m.id,
          orderId: id,
          account: wallet.address,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      if (!preview.orderId) throw new Error('Cancellation order ID is missing');
      const fresh = await api<Preview>('/cancel-preview', {
        marketId: preview.to,
        orderId: preview.orderId,
        account: preview.account,
      });
      assertSameApproval(preview, fresh);
      const hash = await wallet.send(fresh);
      onTransaction({ hash, marketId: preview.to, account: preview.account, state: 'pending' });
      setPreview(undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorNote error={error} />
      <section className="panel">
        <div className="panel-head">
          <h3>Open positions</h3>
          <Badge>{a?.positions?.length ?? '—'} POSITIONS</Badge>
        </div>
        {a?.positions?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Direction</th>
                  <th>Quantity</th>
                  <th>Average entry</th>
                  <th>Live mark</th>
                  <th>Unrealized P&L</th>
                  <th>Funding owed</th>
                  <th>Last update P&L</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {a.positions.map((p, i) => {
                  const m = markets.find((v) => v.id === p.pool),
                    live = a.analytics?.find((v) => v.pool === p.pool);
                  return (
                    <tr key={i}>
                      <td>{m?.symbol ?? short(p.pool)}</td>
                      <td>
                        <Badge tone={p.isLong ? 'mint' : 'red'}>
                          {p.isLong ? 'Long' : 'Short'}
                        </Badge>
                      </td>
                      <td>{m ? fmt(Math.abs(raw(p.size, m.baseDecimals)!), 6) : '—'}</td>
                      <td>{price(raw(p.entryPriceX18, 18))}</td>
                      <td>
                        {price(live?.priceable ? raw(live.markPrice, a.quoteDecimals) : undefined)}
                      </td>
                      <td>
                        {price(
                          live?.priceable ? raw(live.unrealizedPnl, a.quoteDecimals) : undefined,
                        )}
                      </td>
                      <td>
                        {price(
                          live?.priceable ? raw(live.accruedFunding, a.quoteDecimals) : undefined,
                        )}
                      </td>
                      <td>{price(raw(p.realizedPnl, a.quoteDecimals))}</td>
                      <td>
                        <button className="row-action" onClick={() => go('Trade Planner', m?.id)}>
                          Review plan
                          <ArrowUpRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Shield}
            title={a?.positions ? 'No open positions' : 'Position data unavailable'}
          >
            No position values are inferred from order submissions. Position reads come from the
            Hideki perp indexer.
          </Empty>
        )}
        <div className="table-foot">
          Live mark, P&L and funding use the official same-block analytics when available. Entry
          rows are indexed and may lag. Positive funding is owed by the account. Liquidation
          estimates are unavailable.
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Orders</h3>
          <small>Latest 100 indexed orders</small>
        </div>
        {a?.orders?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Market / order ID</th>
                  <th>Side</th>
                  <th>Limit</th>
                  <th>Remaining</th>
                  <th>State</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {a.orders.map((o) => {
                  const m = markets.find((v) => v.id === o.pool);
                  return (
                    <tr key={o.orderId}>
                      <td>
                        {m?.symbol ?? short(o.pool)}
                        <small>{o.orderId}</small>
                      </td>
                      <td>{o.isBid ? 'Buy' : 'Sell'}</td>
                      <td>{price(m ? raw(o.price, m.quoteDecimals) : undefined)}</td>
                      <td>{m ? fmt(raw(o.quantityRemaining, m.baseDecimals), 6) : '—'}</td>
                      <td>
                        <Badge>{o.status}</Badge>
                      </td>
                      <td>
                        <button
                          className="secondary"
                          disabled={
                            busy ||
                            !wallet.correct ||
                            wallet.address?.toLowerCase() !== a.address.toLowerCase() ||
                            o.status !== 'Open' ||
                            !m
                          }
                          onClick={() => m && cancel(m, o.orderId)}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={a?.orders ? 'No indexed orders' : 'Orders unavailable'}>
            Resting orders will appear here after the indexer catches up.
          </Empty>
        )}
      </section>
      {preview && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm cancellation"
          >
            <div className="modal-content">
              <h2>Cancel this order?</h2>
              <p>
                {preview.market} · Order {preview.orderId}
              </p>
              <div className="address-box">
                <code>{preview.account}</code>
                <code>{preview.to}</code>
              </div>
              <p>
                This asks your wallet to cancel the remaining resting quantity on Hideki. Any
                already filled portion remains a position.
              </p>
              <ErrorNote error={error} />
              <button className="secondary" disabled={busy} onClick={() => setPreview(undefined)}>
                Keep order
              </button>
              <button className="primary" disabled={busy} onClick={confirm}>
                {busy ? 'Waiting for wallet…' : 'Confirm cancellation'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function TransactionList({
  transactions,
  onUpdate,
}: {
  transactions: { hash: string; marketId: string; account: string; state: string }[];
  onUpdate: (e: Evidence) => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function reconcile(t: (typeof transactions)[number]) {
    setBusy(true);
    setError('');
    try {
      onUpdate(
        await api<Evidence>(`/receipt/${t.hash}?marketId=${t.marketId}&account=${t.account}`),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Transaction reconciliation</h3>
        <Badge>RECEIPT ≠ FILL</Badge>
      </div>
      <ErrorNote error={error} />
      {transactions.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Account</th>
                <th>Last known state</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.hash}>
                  <td>
                    <a href={`${NETWORK.explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer">
                      {short(t.hash)}
                      <ExternalLink size={12} />
                    </a>
                  </td>
                  <td>{short(t.account)}</td>
                  <td>
                    <Badge>{t.state}</Badge>
                  </td>
                  <td>
                    <button className="secondary" disabled={busy} onClick={() => reconcile(t)}>
                      Reconcile
                      <RefreshCw size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No submitted transactions">
          After wallet submission, hashes and receipt reconciliation appear here. No transaction has
          been invented for this build.
        </Empty>
      )}
    </section>
  );
}

export function SubmissionRecovery({
  wallet,
  onEvidence,
}: {
  wallet: ReturnType<typeof useWallet>;
  onEvidence: (e: Evidence) => void;
}) {
  const [hash, setHash] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (!wallet.blocked || !wallet.submission) return null;
  const s = wallet.submission;
  async function check() {
    setBusy(true);
    setError('');
    try {
      const h = hash || s.hash;
      if (!h || !/^0x[0-9a-fA-F]{64}$/.test(h))
        throw new Error('Enter the complete transaction hash from your wallet activity.');
      const e = await api<Evidence>(`/receipt/${h}?marketId=${s.to}&account=${s.account}`);
      if (!s.hash && e.input !== s.data)
        throw new Error('This transaction does not match the unresolved calldata.');
      onEvidence(e);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (s.invalid)
    return (
      <div className="notice danger" role="alert">
        The stored submission record is unreadable. Signing is locked. Inspect and export browser
        storage and wallet activity before recovery.
      </div>
    );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Unresolved wallet request</h3>
        <Badge tone="red">SUBMISSION LOCKED</Badge>
      </div>
      <div className="panel-copy">
        <p>
          To prevent duplicate orders, this account cannot submit another transaction until its
          previous request is reconciled. Check your wallet activity; a transport error does not
          prove the request failed.
        </p>
        <code>{s.to}</code>
        <form
          className="read-address"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <input
            aria-label="Recovery transaction hash"
            placeholder="0x transaction hash from wallet activity"
            value={hash || s.hash || ''}
            onChange={(e) => setHash(e.target.value)}
            style={{ width: '100%' }}
          />
          <button className="secondary" disabled={busy}>
            Verify and reconcile
          </button>
        </form>
        <ErrorNote error={error} />
      </div>
    </section>
  );
}
