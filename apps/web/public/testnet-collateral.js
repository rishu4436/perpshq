/* global document, fetch, AbortSignal, window, localStorage, setInterval, navigator, Event */
const marketId = '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0';
const key = 'perpshq.collateralClaimIntent';
const el = (id) => document.getElementById(id);
let preview,
  busy = false;
let provider = window.ethereum;
let providerPinned = false;
window.addEventListener('eip6963:announceProvider', (event) => {
  const detail = event.detail;
  if (
    !providerPinned &&
    detail?.info?.rdns === 'io.metamask' &&
    typeof detail.provider?.request === 'function'
  )
    provider = detail.provider;
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
const message = (v) => {
  el('message').textContent = v;
};
async function api(path, body) {
  const r = await fetch('/api/collateral/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error);
  return b;
}
async function identity() {
  if (!provider) throw new Error('Open in Edge with your connected wallet.');
  providerPinned = true;
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }),
    provider.request({ method: 'eth_chainId' }),
  ]);
  if (!accounts[0] || Number(chain) !== 50383)
    throw new Error('Connect your wallet on Hideki 50383 first.');
  return accounts[0];
}
function saved() {
  return JSON.parse(localStorage.getItem(key) || 'null');
}
function update() {
  el('send').disabled =
    busy || !preview || !el('consent').checked || Date.now() > preview.expiresAt || !!saved();
}
el('consent').onchange = update;
setInterval(update, 1000);
async function review(deposit = false) {
  try {
    if (busy || saved() || localStorage.getItem('perpshq.unresolvedSubmission'))
      throw new Error(
        'Check and reconcile the existing wallet request before another transaction.',
      );
    preview = undefined;
    update();
    preview = await api(deposit ? 'funding/preview' : 'preview', {
      account: await identity(),
      marketId,
      ...(deposit ? { amount: '15' } : {}),
    });
    el('consent').checked = false;
    el('details').textContent = JSON.stringify(preview, null, 2);
    message(
      `Simulation passed. Review the exact ${preview.stage ?? 'claim'} and request wallet approval within ${preview.stage ? 120 : 30} seconds.`,
    );
    update();
  } catch (e) {
    message(e.message);
  }
}
el('preview').onclick = () => review(false);
el('deposit').onclick = () => review(true);
el('send').onclick = async () => {
  const run = async () => {
    if (busy || saved() || !el('consent').checked || !preview || Date.now() > preview.expiresAt)
      throw new Error('A fresh reviewed preview is required.');
    const account = await identity();
    if (account.toLowerCase() !== preview.account.toLowerCase())
      throw new Error('Wallet account changed. Review again.');
    if (localStorage.getItem('perpshq.unresolvedSubmission'))
      throw new Error('Resolve the existing order request first.');
    const fresh = await api(preview.stage ? 'funding/preview' : 'preview', {
      account,
      marketId,
      ...(preview.stage ? { amount: preview.amount } : {}),
    });
    for (const field of [
      'account',
      'chainId',
      'to',
      'data',
      'value',
      'grant',
      'stage',
      'amount',
      'bank',
    ])
      if (fresh[field] !== preview[field]) throw new Error('Claim changed. Review again.');
    if (BigInt(fresh.gas) * BigInt(fresh.gasPrice) > BigInt(preview.gas) * BigInt(preview.gasPrice))
      throw new Error('Gas estimate increased. Review again.');
    if (
      (await identity()).toLowerCase() !== account.toLowerCase() ||
      Date.now() > preview.expiresAt
    )
      throw new Error('Wallet changed or preview expired.');
    const intent = {
      account,
      marketId,
      stage: preview.stage,
      amount: preview.amount,
      at: Date.now(),
      state: 'unknown',
    };
    localStorage.setItem(key, JSON.stringify(intent));
    busy = true;
    update();
    message(
      'Review and approve the ' + (preview.stage ?? 'claim') + ' transaction in your wallet.',
    );
    try {
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: account,
            to: preview.to,
            data: preview.data,
            value: preview.value,
            gas: preview.gas,
            gasPrice: preview.gasPrice,
            chainId: '0xc4cf',
          },
        ],
      });
      if (!/^0x[\da-f]{64}$/i.test(hash))
        throw new Error('Wallet returned no valid hash. Inspect wallet activity; do not retry.');
      localStorage.setItem(key, JSON.stringify({ ...intent, hash, state: 'pending' }));
      message('Submitted: ' + hash + '. Use Check claim receipt after it mines.');
    } catch (e) {
      if (e.code === 4001) localStorage.removeItem(key);
      throw e;
    } finally {
      busy = false;
      update();
    }
  };
  try {
    if (!navigator.locks) throw new Error('Browser transaction locking is unavailable.');
    await navigator.locks.request(
      'perpshq-wallet-submission',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error('Another tab has a wallet request.');
        await run();
      },
    );
  } catch (e) {
    message(e.message);
  }
};
el('check').onclick = async () => {
  try {
    const intent = saved();
    if (!intent?.hash)
      throw new Error(
        intent
          ? 'Outcome unknown. Find the hash in wallet activity; do not retry.'
          : 'No claim has been submitted from this page.',
      );
    const receipt = await api(
      (intent.stage ? 'funding/receipt/' : 'receipt/') +
        intent.hash +
        '?account=' +
        intent.account +
        '&marketId=' +
        intent.marketId +
        (intent.stage ? '&stage=' + intent.stage + '&amount=' + intent.amount : ''),
    );
    el('details').textContent = JSON.stringify(receipt, null, 2);
    if (receipt.status === 'success' && intent.stage) {
      const history = JSON.parse(localStorage.getItem('perpshq.fundingHistory') || '[]');
      localStorage.setItem(
        'perpshq.fundingHistory',
        JSON.stringify([...history, { ...intent, receipt }]),
      );
      localStorage.removeItem(key);
      preview = undefined;
      el('consent').checked = false;
      update();
      message(
        intent.stage === 'approval'
          ? 'Approval confirmed. Review the 15 USDso deposit next.'
          : 'Deposit confirmed. Return to Trade Planner and refresh the account.',
      );
      return;
    }
    if (receipt.status === 'success' && receipt.claimed)
      message(
        'Verified on-chain: collateral claimed. Return to Trade Planner and refresh the account.',
      );
    else message('Claim receipt: ' + receipt.status + '. Collateral verified: ' + receipt.claimed);
  } catch (e) {
    message(e.message);
  }
};
if (saved()) message('A previous claim request is preserved. Check its receipt before continuing.');
