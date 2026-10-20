# Security model and review

Scope: local single-user workspace on loopback, chain 50383 only. No mainnet operations are implemented.

## Controls implemented

- No private key, seed phrase, exchange token or LLM key is needed. The API has no signer and no broadcast endpoint. Browser localStorage never contains signing keys.
- Every state-changing chain action requires a review dialog and a user wallet signature. The wallet checks chain, selected account and preview expiry. Order previews refresh before signing and compare all reviewed material fields. Original calldata and order expiry are pinned; changed parameters require a new review.
- Exact Decimal.js/bigint conversion for blockchain amounts; per-market decimals/ticks/lots/minimums. Schema validation and bounded request bodies.
- Official SDK account sizing plus contract simulation; mark, voucher, account exposure and protocol constraints fail closed. RPC chain and discovered system collateral are verified before preview.
- Persistent browser submission intent is recorded before asking the wallet to broadcast. Unknown outcomes block further submissions until verified recovery. User-rejected signatures (EIP-1193 code 4001) release the intent. Mined success or reverted receipts clear the lock only after matching Hideki, account, pool and exact calldata, plus the saved hash when known. Unknown-hash recovery also requires a matching transaction time.
- Receipt verification checks actual sender and pool; official event ABI distinguishes order state from receipt status.
- API listens on `127.0.0.1`, checks Host and Origin, rejects cross-origin requests, rate limits to 150 API requests/minute, limits JSON to 32KB and uses Helmet. React escapes text; external links use `noreferrer`.
- Production CSP allows only same-origin scripts and locally bundled fonts/assets. There is no public mutation API for personal records.
- SQLite uses bound parameters. Generated data, node_modules and .env are ignored by Git.
- Dependency audit after patched test-runner upgrade reported zero known vulnerabilities at build time.

## Limits

This is not a production multi-user custody or authentication system. Read-only account addresses are public chain data. Personal records are browser-local and accessible to scripts on the same origin; do not store secrets in journal text. A compromised wallet extension or local origin can still harm a user. Preview simulation cannot guarantee the state at inclusion. Fixed budget/slippage calculations cannot guarantee a stop price or maximum realized loss.

The browser uses a Web Lock for same-origin tab coordination when supported, plus persisted intent and a per-instance request lock. Cross-tab races without Web Locks, cross-device races and wallet-side replacements are not protocol-level idempotency guarantees. If a wallet response becomes uncertain, check wallet activity and the explorer instead of clearing storage and retrying. A lock without a known transaction may need manual investigation; the application never silently assumes rejection.

Native stops/reductions and linked bot permissions remain unsupported, so the UI does not describe planned stops as armed. No live signed execution, native cancellation or populated-account browser flow has been independently verified in this environment.

Before public hosting: review authenticated persistence, session replay protections, proxy/Host settings, CSP wallet compatibility, ingress limits and chain transport availability. Do not simply expose the local dev server, disable origin checks or add a funded backend key.

Readiness tests cover wrong account/chain, identity changes before and during dispatch, duplicate attempts, rejection, transport loss, timeout with a late hash, reload persistence, corrupt intent, mismatched evidence and cancellation revalidation. All signing tests use test doubles. Actual signed wallet compatibility and cancellation remain unverified; see the transaction checklist before any authorized demo.
