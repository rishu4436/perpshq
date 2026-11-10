# Live QA follow-up — 10 November 2026

This addresses the second owner retest. No transactions or transfers were sent to the reported test wallet.

- New strategy decisions contain an immutable primary candle snapshot: market, timeframe, UTC open/close boundaries, OHLC, optional volume, source, fetch time, source-complete flag and independently checked closed flag. The active review shows these values outside raw JSON. Older decisions are not backfilled with data they did not record.
- Command Center and Scanner row watchlist actions now change between Add/Remove and expose pressed state, matching Market Intelligence.
- Changing wallet account or network marks prior review IDs stale in that browser's history. The invalidation is persisted across reloads. It remains distinct from server configuration-revision staleness; historical records never become transaction approvals.
- Saving a configuration shows its name and confirmed revision. Unchanged saves compare parsed configurations consistently even after JSONB key reordering.
- Slow reviews display elapsed time and explain pending RPC/indexer and risk-accounting reads. Independent observation reads run concurrently. Full-day risk accounting, freshness checks and execution simulation remain mandatory; no guaranteed latency is claimed.
- Journal deletion requires an explicit confirmation, with a Keep entry action.
- Trade Planner has its own market selector. Switching markets loads that market's saved draft, discards the previous active preview and retains global unresolved-submission locks.
- Oracle and indexed settlement prices retain separate source labels. Their difference is expected when sources and timestamps differ; neither value is overwritten to make them appear equal.

353 unit/integration checks passed, including exact candle snapshot and unfinished-candle regressions. TypeScript, ESLint and client/server production builds passed. Focused browser checks exercise these changes on desktop and mobile, including the confirmation/cancellation paths and draft isolation when changing markets. Mocked browser transactions are labelled test fixtures and are not real execution evidence.

The focused browser run passed 53 cases. Three new desktop assertions initially failed because of a broad text selector and an expectation made after resetting the mocked network on reload; all three passed after correcting the tests. All 56 distinct focused cases are verified across that run and the recheck.

Browser tests now use a dedicated default port, 3107, so a different project on port 3000 is not mistaken for PerpsHQ. The normal development port remains unchanged.

Live funded-wallet execution/recovery, and qualifying Breakout/Mean Reversion entry receipts, remain outstanding. The currently selected wallet requires Hideki STT for gas and USDso collateral in the perps bank. No WalletConnect integration was added.
