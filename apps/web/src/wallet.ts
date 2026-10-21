import { useEffect, useState, useRef } from 'react';
import { NETWORK } from '../../../packages/shared-types';
import { errorMessage, type Preview, type Evidence } from './lib';
import {
  readSubmission,
  submissionKey,
  requestTransaction,
  evidenceMatches,
  type Submission,
  type Provider,
} from './transaction';
import { SubmissionFailure } from '../../../packages/trade-planner/approval';
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export function useWallet() {
  const [address, setAddress] = useState<string>(),
    [chain, setChain] = useState<number>(),
    [error, setError] = useState<string>(),
    [submission, setSubmission] = useState<Submission | undefined>(() =>
      readSubmission(localStorage),
    );
  const revision = useRef(0),
    inFlight = useRef(false);
  useEffect(() => {
    const changed = () => setSubmission(readSubmission(localStorage));
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    const p = window.ethereum;
    if (!p) return;
    const accounts = (a: unknown) => {
      revision.current++;
      setAddress((a as string[])[0]);
    };
    const network = (a: unknown) => {
      revision.current++;
      setChain(Number(a));
    };
    void p
      .request({ method: 'eth_accounts' })
      .then(accounts)
      .catch(() => {});
    void p
      .request({ method: 'eth_chainId' })
      .then(network)
      .catch(() => {});
    p.on?.('accountsChanged', accounts);
    p.on?.('chainChanged', network);
    return () => {
      p.removeListener?.('accountsChanged', accounts);
      p.removeListener?.('chainChanged', network);
    };
  }, []);
  async function connect() {
    try {
      setError(undefined);
      if (!window.ethereum)
        throw new Error(
          'No browser wallet found. Open PerpsHQ in a browser with an EIP-1193 wallet such as MetaMask.',
        );
      const a = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      setAddress(a[0]);
      setChain(Number(await window.ethereum.request({ method: 'eth_chainId' })));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function switchChain() {
    try {
      if (!window.ethereum) return;
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + NETWORK.id.toString(16) }],
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: '0x' + NETWORK.id.toString(16),
              chainName: NETWORK.name,
              nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
              rpcUrls: [NETWORK.rpc],
              blockExplorerUrls: [NETWORK.explorer],
            },
          ],
        });
      }
      setChain(Number(await window.ethereum.request({ method: 'eth_chainId' })));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function send(preview: Preview) {
    if (inFlight.current)
      throw new SubmissionFailure('A wallet request is already in progress.', 'blocked');
    const p = window.ethereum;
    if (!p) throw new SubmissionFailure('Browser wallet is unavailable', 'blocked');
    inFlight.current = true;
    const run = () =>
      requestTransaction(preview, p, localStorage, setSubmission, () => revision.current);
    try {
      if (navigator.locks)
        return await navigator.locks.request(
          'perpshq-wallet-submission',
          { ifAvailable: true },
          (lock) => {
            if (!lock)
              throw new SubmissionFailure('Another tab has an active wallet request.', 'blocked');
            return run();
          },
        );
      return await run();
    } finally {
      inFlight.current = false;
    }
  }
  function reconcile(e: Evidence) {
    const r = readSubmission(localStorage);
    if (r && evidenceMatches(r, e)) {
      localStorage.removeItem(submissionKey);
      setSubmission(undefined);
    }
  }
  return {
    address,
    chain,
    error,
    connect,
    switchChain,
    send,
    reconcile,
    submission,
    blocked: !!submission,
    correct: chain === NETWORK.id,
  };
}
