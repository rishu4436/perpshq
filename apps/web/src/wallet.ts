import { useEffect, useState } from 'react';
import { NETWORK } from '../../../packages/shared-types';
import { errorMessage, type Preview, type Evidence } from './lib';
interface Submission {
  account: string;
  to: string;
  data: string;
  createdAt: number;
  hash?: string;
}
const submissionKey = 'perpshq.unresolvedSubmission';
function savedSubmission(): Submission | undefined {
  try {
    return JSON.parse(localStorage.getItem(submissionKey) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}
interface Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (name: string, handler: (v: unknown) => void) => void;
  removeListener?: (name: string, handler: (v: unknown) => void) => void;
}
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export function useWallet() {
  const [address, setAddress] = useState<string>(),
    [chain, setChain] = useState<number>(),
    [error, setError] = useState<string>(),
    [submission, setSubmission] = useState<Submission | undefined>(savedSubmission);
  useEffect(() => {
    const p = window.ethereum;
    if (!p) return;
    const accounts = (a: unknown) => {
      setAddress((a as string[])[0]);
    };
    const network = (a: unknown) => setChain(Number(a));
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
    const p = window.ethereum;
    if (!p) throw new Error('Browser wallet is unavailable');
    const a = (await p.request({ method: 'eth_accounts' })) as string[];
    const c = Number(await p.request({ method: 'eth_chainId' }));
    if (c !== NETWORK.id || preview.chainId !== NETWORK.id)
      throw new Error('Wrong network. Switch to Hideki 50383.');
    if (a[0]?.toLowerCase() !== preview.account.toLowerCase())
      throw new Error('Wallet changed. Review a new preview.');
    if (Date.now() > preview.expiresAt)
      throw new Error('Preview expired. Refresh order validation.');
    if (savedSubmission()?.account.toLowerCase() === preview.account.toLowerCase())
      throw new Error(
        'A previous wallet request is unresolved. Reconcile its transaction before submitting again.',
      );
    const intent: Submission = {
      account: preview.account,
      to: preview.to,
      data: preview.data,
      createdAt: Date.now(),
    };
    localStorage.setItem(submissionKey, JSON.stringify(intent));
    setSubmission(intent);
    try {
      const hash = (await p.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: preview.account,
            to: preview.to,
            data: preview.data,
            value: '0x0',
            gas: '0x' + BigInt(preview.gas).toString(16),
            chainId: '0x' + NETWORK.id.toString(16),
          },
        ],
      })) as string;
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw new Error(
          'Wallet returned no valid hash; outcome is unknown. Reconcile with your wallet.',
        );
      const record = { ...intent, hash };
      localStorage.setItem(submissionKey, JSON.stringify(record));
      setSubmission(record);
      return hash;
    } catch (e) {
      if ((e as { code?: number }).code === 4001) {
        localStorage.removeItem(submissionKey);
        setSubmission(undefined);
      }
      throw e;
    }
  }
  function reconcile(e: Evidence) {
    const r = savedSubmission();
    if (
      r &&
      e.account.toLowerCase() === r.account.toLowerCase() &&
      e.pool.toLowerCase() === r.to.toLowerCase() &&
      (r.hash === e.hash || (!r.hash && r.data === e.input))
    ) {
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
    blocked: !!submission && submission.account.toLowerCase() === address?.toLowerCase(),
    correct: chain === NETWORK.id,
  };
}
