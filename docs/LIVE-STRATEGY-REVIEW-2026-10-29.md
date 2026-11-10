# Live strategy transaction review — 29 October 2026

Later verified Trend and Guardian transaction results supersede this historical status: [1 November live strategy tests](LIVE-STRATEGY-TESTS-2026-11-01.md).

Requested scope: execute all four strategies using the connected owner wallet on Hideki, with all changes kept local.

## Current continuation status

This section supersedes the earlier implementation limitations below. A connected owner-wallet execution panel and durable API review/receipt workflow now exist. The autonomous worker remains disabled. Owner signing uses actual owner gas and independently reconciled bank accounting; it does not fabricate operator permissions.

Actual 1h BTC data produced an `ENTRY_CANDIDATE` with the default trend signal conditions, 0.00013 BTC and an 11 USDso notional cap at 1x planning leverage. No signal threshold was disabled to create it. `data/live-strategy-review/latest-trend.json` contains a captured live review; a review is not a trade.

Live confirmation exposed and fixed two defects: the approved execution bound was compared against a moving mark instead of its original reference mark, and fresh risk sizing retained an old planning stop. Revalidation now preserves approved raw price, raw quantity and calldata while refreshing planning stop/target and loss estimates and enforcing all current risk checks. Increased network costs still require a new review.

The request reached MetaMask in reopened Edge at `http://localhost:3000/app#Agent%20Studio`. MetaMask was locked. Its authentication dialog requires the owner to unlock it; no password was requested or accessed. The durable request `78257202-a176-4ac7-8357-a352ff626a35` has no transaction hash and remains unresolved. Do not clear this lock or infer rejection from timeout. Inspect wallet activity, reject an expired request if still pending, then reconcile or renew as appropriate.

Hash recovery now accepts a matching late wallet response or a wallet-activity hash and requires a verified matching receipt before releasing the lock. Damaged local intent records keep signing blocked while leaving the workspace usable. Guardian cancellation additionally requires a fresh reconciled account and attributable owned order. Native atomic reduce-only position exits remain unsupported.

Explicit wallet rejection now propagates to the linked durable strategy request even if it arrives after the caller's timeout. A lost registration HTTP response preserves the browser's recovery record; only an explicit client-error refusal clears that unsubmitted registration record.

Accounting checks now cover owner-filtered log queries, cache-tail verification and reorg rescan. A main account funding a different child or absorbing another account's bad debt fails closed pending dedicated reconciliation.

**All four live strategy executions are still unverified. No new strategy transaction has been broadcast or counted as passed.** Previous manual BTC opening/closing receipts remain separate evidence. No GitHub push was made.

Validation in this continuation:

- Full Vitest run: 310 passed, five optional SDK checks skipped. After the late-rejection fix, the complete transaction unit file passed 31 tests, including its newly added regression.
- Full desktop/mobile Playwright run: 73 passed, nine optional capture/live or desktop-only checks skipped. Windows now defaults to one worker after a four-worker cold run stalled while loading the lazy workspace.
- Focused owner-wallet desktop/mobile rerun covers no-action non-dispatch, damaged-intent recovery, and the newly added lost-registration-response regression. These use labelled mocks and are not testnet execution evidence.
- TypeScript, lint, production build and diff whitespace checks passed. The production build emitted dependency annotation warnings but completed successfully.
- Latest live account snapshot: `data/live-strategy-review/current-account.json`, no positions, no open orders and no account errors.

The sections below describe the earlier diagnostic run and are retained as historical context.

**This request is not completed. No new strategy transaction was broadcast.** Earlier manual BTC open/close transactions are not presented as strategy executions.

## Actual observations

`scripts/probe-live-strategies.ts` captures actual BTC market/candle/book data, the owner's chain account, current indexer state and a recent accounting attempt. It evaluates the existing strategy rules with a real fenced local review lease. No mocked candles, fills, operator permissions, account balances or paper ledger are supplied. The evaluator remains in review mode and has no signing key.

Local raw evidence: `data/live-strategy-review/results.json`. Strategy thresholds are defaults; sizing is capped at 11 USDso notional, 1x planning leverage and 1 USDso risk budget. No thresholds were relaxed to manufacture a signal.

| Strategy                    | Latest live result | Reason                                                                                     |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Multi-timeframe trend       | NO_ACTION          | MACD momentum agreement failed                                                             |
| Support/resistance breakout | NO_ACTION          | No confirmed completed-candle breakout or observed volume confirmation                     |
| Mean reversion              | NO_ACTION          | RSI/recovery, Bollinger extreme, moving-average distance and ranging ADX conditions failed |
| Risk Guardian               | PAUSE_REQUIRED     | Operator gas reserve unavailable; owner account is flat and has no position to reduce      |

An eligible signal is necessary but not sufficient: complete daily/session loss history and the strategy's own execution checks must also pass. A short accounting sample does not prove complete daily history.

## Bug found and fixed

The live accounting request failed because it queried 2000 blocks per `eth_getLogs`, while Hideki reported a 1000-block maximum. The adapter now uses inclusive ranges of at most 1000 blocks, without gaps or overlap, and preserves the total 1,000,000-block scan budget. The regression rejects oversized intervals and verifies consecutive ranges across the limit.

The live retry progressed beyond that RPC failure but encountered the external indexer's `UserFillsPage` database query error. That is recorded as incomplete accounting, not silently converted to zero loss or a successful verification.

Validation: seven accounting integration tests passed, TypeScript and focused lint passed, and diff whitespace checks passed. The server was restarted to load the fix.

## Remaining execution limitations

Agent Studio has no connected owner-wallet strategy dispatch flow. Its worker does not broadcast live orders; its delegated preflight requires a distinct authorized operator. The owner's manual Planner cannot be counted as a strategy executor merely by placing four trades and labelling them afterward.

Risk Guardian's actual position exits additionally require verified native reduce-only protection; ordinary opposite-side IOC orders do not provide that guarantee. No operator was fabricated, no permissions were granted, no broadcaster guard was disabled, and no position was opened solely to claim Guardian had protected it.

All changes remain local; nothing was pushed or submitted.
