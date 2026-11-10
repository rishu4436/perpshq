import { useEffect, useState, useRef } from 'react';
import type { Market } from '../../../../packages/shared-types';
import { NETWORK } from '../../../../packages/shared-types';
import { api, errorMessage, type Evidence } from '../lib';
import { ErrorNote } from './ui';
export function ReceiptLookup({ account, market }: { account?: string; market?: Market }) {
  const [hash, setHash] = useState(''),
    [error, setError] = useState(''),
    [evidence, setEvidence] = useState<Evidence>(),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setEvidence(undefined);
    setError('');
  }, [account, market?.id]);
  async function verify() {
    const token = epoch.current;
    setError('');
    setEvidence(undefined);
    setBusy(true);
    try {
      if (!account || !market)
        throw new Error(
          'Connect a wallet or set a read-only address and select the transaction’s market.',
        );
      if (!/^0x[a-f0-9]{64}$/i.test(hash.trim()))
        throw new Error('Enter the complete 0x transaction hash from wallet activity.');
      const result = await api<Evidence>(
        `/receipt/${hash.trim()}?account=${account}&marketId=${market.id}`,
      );
      if (epoch.current !== token) return;
      if (
        result.account.toLowerCase() !== account.toLowerCase() ||
        result.pool.toLowerCase() !== market.id.toLowerCase() ||
        result.network !== NETWORK.id
      )
        throw new Error('Receipt does not match this account, market and Hideki network.');
      setEvidence(result);
    } catch (error) {
      if (epoch.current === token) setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Verify a transaction hash</h3>
      </div>
      <div className="panel-copy">
        <p>
          Inspect an actual Hideki order or cancellation for{' '}
          {market?.symbol ?? 'the selected market'} and your connected or read-only account. An
          unrelated account or pool is rejected. Looking up a receipt does not clear unresolved
          submission locks; use the matching recovery request to reconcile it.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="field">
            <span>Hideki transaction hash</span>
            <input
              aria-label="Hideki receipt transaction hash"
              placeholder="0x…"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={busy}>
            {busy ? 'Verifying receipt…' : 'Verify transaction hash'}
          </button>
        </form>
        <ErrorNote error={error} />
        {evidence && (
          <p role="status">
            Verified {evidence.state} ·{' '}
            <a href={`${NETWORK.explorer}/tx/${evidence.hash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
