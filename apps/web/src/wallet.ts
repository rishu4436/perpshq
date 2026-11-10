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
import { discoverWalletProvider } from './wallet-providers';
import { stringToHex } from 'viem';
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export function useWallet() {
  const [provider, setProvider] = useState<Provider>();
  const providerRef = useRef<Provider | undefined>(undefined);
  providerRef.current = provider;
  const [address, setAddress] = useState<string>(),
    [chain, setChain] = useState<number>(),
    [error, setError] = useState<string>(),
    [submission, setSubmission] = useState<Submission | undefined>(() =>
      readSubmission(localStorage),
    );
  const revision = useRef(0),
    inFlight = useRef(false);
  useEffect(() => discoverWalletProvider(window, window.ethereum, setProvider), []);
  useEffect(() => {
    const changed = () => setSubmission(readSubmission(localStorage));
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    const p = provider;
    if (!p) return;
    let active = true;
    revision.current++;
    setAddress(undefined);
    setChain(undefined);
    const accounts = (a: unknown) => {
      if (!active) return;
      revision.current++;
      setAddress((a as string[])[0]);
    };
    const network = (a: unknown) => {
      if (!active) return;
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
      active = false;
      revision.current++;
      p.removeListener?.('accountsChanged', accounts);
      p.removeListener?.('chainChanged', network);
    };
  }, [provider]);
  async function connect() {
    try {
      setError(undefined);
      const p = providerRef.current;
      if (!p)
        throw new Error(
          'No browser wallet found. Open PerpsHQ in a browser with an EIP-1193 wallet such as MetaMask.',
        );
      const a = (await p.request({ method: 'eth_requestAccounts' })) as string[];
      if (p !== providerRef.current) throw new Error('Wallet provider changed. Connect again.');
      setAddress(a[0]);
      setChain(Number(await p.request({ method: 'eth_chainId' })));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function switchChain() {
    try {
      const p = providerRef.current;
      if (!p) return;
      try {
        await p.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + NETWORK.id.toString(16) }],
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await p.request({
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
      if (p !== providerRef.current) throw new Error('Wallet provider changed. Connect again.');
      setChain(Number(await p.request({ method: 'eth_chainId' })));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function signMessage(message: string) {
    const p = providerRef.current,
      version = revision.current;
    if (!p || !address || chain !== NETWORK.id)
      throw new Error('Connect your wallet on Hideki first');
    const accounts = (await p.request({ method: 'eth_accounts' })) as string[];
    if (Number(await p.request({ method: 'eth_chainId' })) !== NETWORK.id)
      throw new Error('Switch your wallet to Hideki first');
    if (accounts[0]?.toLowerCase() !== address.toLowerCase())
      throw new Error('Wallet account changed');
    const signature = await p.request({
      method: 'personal_sign',
      params: [stringToHex(message), address],
    });
    if (p !== providerRef.current || revision.current !== version)
      throw new Error('Wallet changed during sign-in. Try again.');
    if (typeof signature !== 'string') throw new Error('Wallet did not return a signature');
    return signature;
  }
  async function send(preview: Preview, onRejected?: () => Promise<void>) {
    if (inFlight.current)
      throw new SubmissionFailure('A wallet request is already in progress.', 'blocked');
    const p = providerRef.current;
    if (!p) throw new SubmissionFailure('Browser wallet is unavailable', 'blocked');
    inFlight.current = true;
    const run = () =>
      requestTransaction(
        preview,
        p,
        localStorage,
        setSubmission,
        () => revision.current,
        120000,
        onRejected,
      );
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
  function reconcileRejection(request: { account: string; to: string; data: string }) {
    const saved = readSubmission(localStorage);
    if (!saved) return;
    if (
      saved.hash ||
      saved.invalid ||
      saved.account.toLowerCase() !== request.account.toLowerCase() ||
      saved.to.toLowerCase() !== request.to.toLowerCase() ||
      saved.data.toLowerCase() !== request.data.toLowerCase()
    )
      throw new Error(
        'Saved wallet request conflicts with the rejected strategy; reconcile its receipt',
      );
    localStorage.removeItem(submissionKey);
    setSubmission(undefined);
  }
  return {
    address,
    chain,
    error,
    connect,
    switchChain,
    signMessage,
    send,
    reconcile,
    reconcileRejection,
    submission,
    blocked: !!submission,
    correct: chain === NETWORK.id,
  };
}
