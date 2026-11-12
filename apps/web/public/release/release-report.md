# PerpsHQ release — 10 November 2026

Latest update: [12 November live wallet retest and regression follow-up](LIVE-RETEST-2026-11-12.md). Guardian cancellation receipts were independently checked at blocks 48063158 and 48065728. The latest user-run manual flows passed; Trend, Breakout and Mean Reversion entry execution and strategy rejection/pending recovery remain pending in this run. The user confirmed automatic Ethereum detection and locked controls in MetaMask. The stale-review display and switch-back scroll follow-up still need a real MetaMask retest. Submission readiness remains conditional. Earlier Trend receipts below are historical evidence.

- Website: https://perpshq.vercel.app
- Workspace: https://perpshq.vercel.app/app
- Reviewer kit: https://perpshq.vercel.app/release.html
- Demo: https://perpshq.vercel.app/release/perpshq-demo.mp4
- Source, video and evidence package: https://perpshq.vercel.app/release/perpshq-submission.zip

## Delivered scope

Public hosting supports live Hideki discovery/scanning, technical analysis, planning, manual browser-wallet signing, account/receipt reconciliation and browser-local journals/watchlists. Agent Studio adds SIWE owner authentication, wallet-isolated versioned configurations, actual strategy reviews, exact connected-wallet execution and durable receipt recovery in Neon Postgres. The public API uses an exact Host/Origin policy and transient public-data cache. Shared local worker controls and backups remain local. No server signer or private key is accepted.

The full local source remains included for private worker observation, configuration, history/recovery and assisted owner-wallet strategy execution. Autonomous broadcasting and atomic reduce-only exits are unavailable. Stops and targets are planning references, not armed protective orders.

## Actual chain evidence

Manual BTC open/close, Trend entry and Guardian cancellation are verified. Exact hashes, receipt blocks and limitations are in LIVE-STRATEGY-TESTS-2026-11-01.md and TESTNET-EXECUTION-2026-10-29.md. Breakout/Mean Reversion have no qualifying live entry receipt. Latest actual account evidence is flat, with no resting orders or account errors. No new trade was made during deployment.

## Release fixes and verification

The [latest retest fixes](LIVE-QA-PRICE-AND-PERFORMANCE-2026-11-10.md) make oracle/settlement price differences visible, display numerical Planner leverage limits, persist reorg-checked daily accounting to reduce repeated scans across hosted instances, and preserve the owner view during network transitions. The current unit/integration count is 358 passing checks with five optional skips.

The [second QA follow-up](LIVE-QA-FOLLOWUP-2026-11-10.md) adds recorded OHLC/closed-candle evidence, persistent browser history invalidation on wallet changes, row watchlist labels, configuration save feedback, review progress, journal deletion confirmation and a Planner market selector. The current unit/integration count is 353 passing checks with five optional skips.

The follow-up [live QA fix report](LIVE-QA-FIXES-2026-11-10.md) covers wallet-network invalidation, market leverage validation, stale review labels, required amount and lot errors, journal tags, inline Settings errors, accessibility, hosted activity, chart font policy, collateral links and receipt lookup. The updated unit/integration suite passes 351 tests with five optional SDK skips. Earlier counts below describe the preceding release.

Fixed production ESM resolution by compiling internal TypeScript modules into an ESM server bundle. Public mode never creates the local personal databases or exposes shared mutable worker routes. Unknown wallet outcomes, close-position guards, exact approval matching and MetaMask provider selection retain their tested behavior.

The high-severity body-parser advisory was resolved by compatible dependency updates. The tooling-only minimatch advisory was resolved with a targeted patched dependency override. npm audit now reports zero known vulnerabilities; this is a dependency scan, not a formal security certification.

348 unit/integration checks passed, 5 optional checks skipped. Twenty focused desktop/mobile wallet and hosting checks passed, including labelled mock execution for all four templates. Fresh actual deployed checks covered 24 desktop/mobile screens with no page errors or overflow. Twenty-four real production API checks verified wallet authentication, replay refusal, durable configurations, all four strategy reviews, isolation and logout, using unfunded ephemeral QA identities without broadcasting. TypeScript, client/server builds and ESLint passed. Actual Postgres cross-client reads and concurrent compare-and-swap writes were verified. Live verification caught JSONB object-key reordering; configuration comparison now uses semantic equality and test storage reproduces JSONB ordering. Mock execution is not a live trade receipt. See [submission status](SUBMISSION-STATUS-2026-11-10.md) for remaining limits.

Hosted health, market discovery and local-control denial were checked after deployment. Final browser/media/package verification is recorded in the package's verification manifest. The recording is a captioned deployed-site tour plus separately labelled historical receipt evidence. It does not show staged wallet trades or establish strategy profitability.

## Publication and organizer status

Deployed directly from the local source to the owner's Vercel project. The owner authorized publishing the release source to GitHub. No social post or organizer submission was made.

The official event page is https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail. Current deadline/whitelist requirements could not be independently confirmed: retrieval returned HTTP 405, and secondary listings disagree. An accessible product and prepared package do not guarantee eligibility or acceptance. The owner must verify the organizer page and submit through their account.
