# Price, review performance and network follow-up — 10 November 2026

## Price provenance

Market discovery/list prices remain indexed settlement snapshots. Detailed market prices come from the pool's on-chain oracle read. The API now records that source explicitly and retains the indexed value and timestamp when replacing the detailed mark with the oracle result. The BTC page shows both values, both available UTC timestamps, the percentage difference, and a visible explanation. A stale/unavailable oracle is labelled unavailable rather than misrepresented as a live settlement value.

Planner leverage errors now include the selected market's verified numerical limit and symbol. No constant 40× limit is hardcoded across markets.

## Repeat review latency

Owner-wallet daily accounting previously retained its verified history only in one Node process. A different Vercel instance could rescan from the UTC-day boundary. Hosted reviews now persist a bounded verified checkpoint privately with the owner's ledger, in the same fenced compare-and-swap transaction as the review.

On reuse, the adapter checks owner, bank, chain, requested boundary and completeness. It verifies the closing block hash, the opening block hash and the exact opening time boundary. A reorganization or mismatch discards the checkpoint and triggers a full scan. Each review still reads fresh opening/closing equity and scans every new bank-event block after the verified checkpoint. No cached P&L value substitutes for current accounting. Clients cannot submit checkpoint objects through the review API.

Four checkpoints are retained per owner; histories above the bounded movement limit are not cached. The first baseline of a new day/account, unavailable history, RPC delays or invalidated history can still require a longer read. No guaranteed response time is claimed.

## Switching back to Hideki

A transport disconnect is no longer interpreted as proof that wallet account authorization was revoked. Chain state and existing reviews are invalidated immediately; signing remains blocked until an actual Hideki/account check succeeds. Account revocation through accountsChanged or eth_accounts still clears the account. This avoids discarding the owner's Studio draft during a chain transition. The explicit switch action preserves scroll position and does not reload or navigate the document.

## Verification and remaining work

358 unit/integration checks passed, including persistence, cold-instance reuse, fresh closing balances and full rescans for owner, reorg and boundary mismatches. TypeScript, lint and production builds passed. Browser regressions cover differing BTC price sources, the numerical Planner limit and a simulated transport disconnect on switch-back, including preserved draft, route, document time origin and scroll position, on desktop and mobile.

No new wallet transactions or transfers were sent. Funded execution/recovery and qualifying Breakout/Mean Reversion receipts remain outstanding. No WalletConnect integration was added.

All 58 focused desktop/mobile browser regression checks passed.
