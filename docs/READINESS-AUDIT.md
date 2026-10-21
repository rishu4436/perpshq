# PerpsHQ readiness audit — 20 October 2026

## A. Executive summary

The existing product, visual identity, navigation, SDK integration and personal storage were retained. The audit hardens the unsigned preparation/signing boundary, unknown-outcome recovery and cancellation; removes stale directional analysis; evaluates market/account alerts independently; connects analysis to explicit draft references and preserved journal snapshots; and preserves chart interaction during refresh.

The work is on `fix/perpshq-hackathon-readiness`, based on `main` at `3e4120b`. The repository remains private. No public deployment, merge, social post, hackathon submission, funding action, signing or broadcast was performed. **No PerpsHQ-authored signed order or cancellation has been verified.** The code is prepared for a specifically authorized external-wallet demo; automated success is not signed-chain proof.

## B. Technical findings and evidence

### P0 — material transaction changes escaped review

Root cause: the old confirmation refresh compared only a subset of preview fields; regenerated expiry also changed order calldata. A refreshed request could reach the wallet with parameters different from the reviewed transaction.

Reproduction: the new browser regression returns `0x1234` for the reviewed preview and `0x5678` for revalidation. Before the fix, the expected changed-parameter alert was absent because the request reached the mocked wallet. After the fix it displays a new-review error and records zero `eth_sendTransaction` calls.

Fix: [approval.ts](../packages/trade-planner/approval.ts) compares chain, account, target, calldata, value, gas/gas price, displayed STT estimate, raw price/quantity, type, market and order ID. [adapter](../packages/dreamdex-adapter/index.ts) and [API](../apps/api/src/server.ts) accept bounded `approvedData`, decode the official ABI, retain the original expiry and reject mismatching or expired encoded parameters before simulation. [trading.tsx](../apps/web/src/components/trading.tsx) validates the initial binding, refreshes before confirmation and displays the preview's actual raw quantity.

Verification: 13 material-field mutation cases, official-ABI stable-expiry preparation, expired/changed-data rejection and desktop/mobile changed-calldata browser cases. Gas/price changes require another review even if caused by normal network movement.

### P0 — uncertain wallet outcomes and identity changes

Root cause: dispatch, persistence and provider lifecycle were coupled in the UI. Lost or delayed responses, account/network changes and page reloads needed a single fail-closed coordinator, rather than an assumed rejection or a fresh retry.

Fix: [transaction.ts](../apps/web/src/transaction.ts) persists intent before dispatch, pins the actual payload, reads wallet identity again and checks an event revision before dispatch. Timeout is 120 seconds; a late valid hash is still saved against that intent. Only explicit EIP-1193 code 4001 releases a rejected request. Unknown results, malformed persisted intent and identity changes while signing keep the lock. [wallet.ts](../apps/web/src/wallet.ts) adds an in-flight guard, same-origin Web Locks when available, and storage-change observation. Existing unresolved storage keys and legacy records remain supported. Recovery checks mined receipt, Hideki, sender, pool, exact calldata and known hash; unknown-hash recovery also bounds transaction time.

Reproduction/verification: deterministic provider tests cover rejection, transport loss, timeout/late hash, revision changes before dispatch and during signing, duplicate/reloaded intent, malformed intent and mismatching evidence. Browser tests explicitly reload after an unknown result, then reconcile matching mined evidence. All providers/hashes in these tests are test doubles.

### P0 — cancellation and receipt classification

Root cause: cancellation preflight lacked equivalent chain/gas protection and the UI needed a second review comparison. Receipt success/indexer state could be confused with fill evidence, especially when the indexer lagged.

Fix: the adapter checks cancellation ownership, open state and positive remaining quantity, Hideki RPC identity, simulation, gas plus 25% headroom and STT balance. Initial cancellation preview binds account/pool/order; confirmation revalidates and compares the complete preview. [evidence.ts](../packages/trade-planner/evidence.ts) distinguishes reverted, resting, partial, filled, cancelled and syncing states, giving actual same-transaction fill events precedence over an older indexed open order. Receipt exports include calldata, mined timestamp, transaction status, indexer status and check time.

Verification: mock preparation checks owned/other-owned orders and gas rejection; browser cancellation calls preview twice before exactly one mocked send. Pure reconciliation tests cover success-without-fill, resting, partial, full fill before indexer catch-up, cancellation and revert. A real cancellation remains unverified.

### P1 — stale/insufficient scenarios leaked levels

Root cause: [opportunity-scoring](../packages/opportunity-scoring/index.ts) suppressed displayed stale indicators/zones but still used historical support/resistance in directional scenario strings. Short history also produced unsupported levels. The structure factor could award points to an unavailable structure.

Reproduction: before the patch, two new regression cases failed: stale bullish text contained a breakout price (`106.159`), and a 40-bar sample returned zones. The existing empty-analysis score test subsequently caught the unavailable structure contribution; that was fixed too.

Fix: fresh history with at least 50 completed bars is required for directional zones/structure scenarios. Otherwise bullish/bearish explanations explicitly say unavailable. Unavailable structure contributes no score. Cached UI detail/scanner interpretations expire after 90 seconds, including dashboard bullish/bearish counts and deterministic assistant answers.

Verification: [analysis-quality.test.ts](../tests/unit/analysis-quality.test.ts) covers stale, insufficient and fresh history; all existing engine tests still pass. No stale price level is described as a fresh directional scenario.

### P1 — alerts depended on the selected market

Root cause: the old App effect evaluated rules only against selected-market detail and reran on that query's refresh. Non-selected markets and margin updates could be missed; side effects inside state updates risked repeats.

Fix: [alert-engine](../packages/alert-engine/index.ts) is deterministic, and [useAlertMonitoring](../apps/web/src/useAlertMonitoring.ts) schedules one query per enabled market/timeframe with a two-request concurrency bound, query deduplication and 60-second polling. Account evaluation follows fresh account observations independently. Each rule retains checked/observed times, trigger state, last value and a visible status/reason. Unavailable/stale data preserves prior trigger state; a usable inactive observation rearms it. Events are deduplicated and persisted using existing storage keys. Legacy margin rules bind to the first usable account.

Verification: five pure tests plus desktop/mobile browser tests verify simultaneous BTC/ETH evaluation without selecting them, no repeat after reload/refresh, and a margin threshold change while selected-market reads return 503. Alerts require the browser to remain open; there is no guaranteed background service.

### P1 — intelligence did not meaningfully enter planning

Root cause: Planner accepted `detail` but did not use it. Market handoff preserved selection while analysis and original provenance were lost during manual copying.

Fix: [intelligence-context.tsx](../apps/web/src/components/intelligence-context.tsx) displays mark/timestamp, EMA trend, RSI, MACD, ATR, confirmed nearest zones, structure, timeframe assessment and quality/scenario notes. [context.ts](../packages/trade-planner/context.ts) validates freshness, confirmed level bounds and the correct side of entry. Explicit buttons fill draft entry/stop/target only; short choices are inverted. Stops/targets remain planning notes. Mark shortcuts also require a fresh mark. Optional context/references are added to existing plan/journal contracts and storage; saving/selecting preserves the original snapshot, while manual field edits remove that field's reference attribution. Journal records display and export captured context. Journal market labels follow the plan's market.

Verification: pure tests cover long/short candidates, invalid/stale/insufficient/future observations, mark tick rounding and immutable captured context. Browser tests exercise explicit clicks for both long and short, field values, journal import and reload preservation. The existing scanner → cockpit → saved plan → journal workflow remains covered on both viewports. Side, leverage and risk inputs are never chosen automatically.

### P1 — refresh reset chart interaction

Root cause: [Chart.tsx](../apps/web/src/Chart.tsx) created/removed the chart and called `fitContent` whenever candles, analysis, overlays or height changed.

Fix: mount/subscription cleanup is separate from updates. Candle, line and volume series are reused; disabled overlays/old price lines are removed. Normal updates restore the previous visible time range. New market/timeframe data intentionally fits its history. Reload/navigation starts a new view; cross-navigation zoom persistence is not implemented.

Verification: desktop Playwright zooms with the mouse wheel, refreshes genuinely changed API data, verifies the visible range and original canvas, then changes an overlay and verifies both again. The mouse-wheel case is intentionally skipped for the mobile project; mobile screen/workflow/layout checks run separately.

### P2 — brittle live dashboard assertion

Root cause: old live smoke/visual tests assumed BTC would always rank in the dashboard's top eight. During this audit eight other actual markets ranked ahead of BTC, while its selected chart loaded correctly.

Verification/fix: the initial production run recorded four failures (the same assertion on two tests × two viewports), 39 passes and one intentional mobile mouse-wheel skip. Live dashboard tests now require rendered ranked rows and verify every row's symbol against current discovered perpetual markets. The full Scanner still specifically verifies BTC. No product ranking was changed to satisfy the test.

### P2 — navigation during initial reload could be missed

A mobile reload/recovery regression exposed a hash-navigation race: App read the initial destination during render, but a navigation before its passive `hashchange` listener attached was missed. The screen remained on Planner even though the new URL requested Positions. The listener now also synchronizes the current hash when installed. The recovery browser test retains its immediate post-reload destination change; it is not replaced with a delay. The expanded short-reference test also corrected its expected target to the conservative support edge (90), rather than the opposite edge (89).

## C. Commands and results

Windows PowerShell, Node 24; final browser target is the local production bundle at `http://127.0.0.1:3002`. No automated test signs or broadcasts.

| Command                                                                                                                                                                         | Result                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                                                                        | Completed: 295 packages, zero reported vulnerabilities. npm policy blocked an esbuild install script; the installed build tool and production builds worked.                                   |
| `npm run lint`                                                                                                                                                                  | Passed.                                                                                                                                                                                        |
| `npm run typecheck`                                                                                                                                                             | Passed.                                                                                                                                                                                        |
| `npm test`                                                                                                                                                                      | **96 passed, 5 skipped**, 8 files, zero failed. The five skipped cases are optional live checks, not counted as passed.                                                                        |
| `$env:LIVE_TESTS='1'; npm test`                                                                                                                                                 | **101 passed**, 8 files, zero failed/skipped. Includes 5 actual read-only SDK/RPC tests; other preparation/provider tests use mocks or captured fixtures.                                      |
| `npm run build`                                                                                                                                                                 | Passed: TypeScript plus Vite production bundle; no dependency added.                                                                                                                           |
| `$env:PORT='3002'; npm start`                                                                                                                                                   | Local production server started successfully.                                                                                                                                                  |
| `$env:PERPSHQ_TEST_URL='http://127.0.0.1:3002'; $env:LIVE_TESTS='1'; npm run test:e2e`                                                                                          | **43 passed, 1 skipped, 0 failed** (44 total, 3.5 minutes). The mobile mouse-wheel case is intentionally skipped; all six opt-in live cases passed.                                            |
| `$env:PERPSHQ_TEST_URL='http://127.0.0.1:3002'; $env:PERPSHQ_VERIFICATION_OUTPUT='docs/readiness-http-results.json'; node node_modules/tsx/dist/cli.mjs scripts/verify-live.ts` | **13/13 passed**, including actual market/candle/book/funding/account reads, simulation/gas guard and rejection/Origin checks. See [readiness-http-results.json](readiness-http-results.json). |
| `npm run format:check` and `git diff --check`                                                                                                                                   | Passed.                                                                                                                                                                                        |

Earlier development run: 14/15 browser cases passed; the first lazy app load exceeded its 5-second assertion while a build ran concurrently. The same workflow passed in production. Earlier context-test failure was an incorrect textbox label in the new test and was corrected to the existing accessible label. An intermediate production run had 40 passes, 3 failures and 1 skip: two incorrect short-target expectations and the reload navigation race described above. After correcting the expected conservative edge and fixing navigation synchronization, the complete final rerun passed. Earlier attempts are not represented as clean final runs.

Read-only HTTP evidence is retained separately from historical baseline probes. Generated Playwright reports/traces remain ignored; current live screen captures are under `docs/screenshots/`. Captured fixtures contain their own historical provenance and are never served as live product data.

## D. Real blockchain readiness

Verified: official installed SDK 0.32.1 ABI compatibility, market decimals/increments, bounded order construction, fail-closed protocol sizing/simulation/gas guards, public RPC chain identity, actual market/candle/book/account reads and mocked complete preparation/cancellation/recovery paths. At 2026-10-20T14:57:39.761Z, all 13 HTTP checks passed: 21 discovered markets, 312 completed BTC candles, 40 book levels, 24 funding observations and an existing public account with 21 priceable analytics/position rows were observed. Its unsigned order passed simulation and gas estimation, then was correctly blocked by insufficient STT; it was **not ready to sign**. An empty account was blocked by collateral sizing. No signature or broadcast occurred.

Unverified: a ready-to-sign positive preview for the user's funded wallet; actual browser extension signing behavior; any PerpsHQ-authored mined order, fill, or cancellation. No user wallet/funding/transaction-specific authorization was supplied. Public-account reads/simulations confer no signing authority and are not authored trade evidence.

Complete [TESTNET-TRANSACTION-CHECKLIST.md](TESTNET-TRANSACTION-CHECKLIST.md) using an owning external EIP-1193 account on Hideki, eligible funded perps collateral, currently estimated STT and separate exact transaction authorization. The [evidence folder/report format](testnet-execution/README.md) is prepared and contains no fabricated transaction.

## E. Hackathon readiness

Implementation, regression tests, private source, demo workflow, evidence format, manual execution checklist and reviewer access instructions are prepared. Genuine signed execution is explicitly missing, as allowed by this audit's definition of done. The broader bounty/demo/submission is **not complete**.

Outstanding: user-owned funded/authorized trade and real evidence, final demo recording, owner-approved reviewer/public access or hosting, approved social links, organizer requirements/eligibility/whitelist verification and submission through the owner's account. The official DoraHacks page remained inaccessible when retried. The supplied deadline of 1 November 2026 23:59 UTC remains unverified. See [SUBMISSION.md](SUBMISSION.md) and [REVIEWER-ACCESS.md](REVIEWER-ACCESS.md).

## F. Review branch and commits

Repository: [private PerpsHQ](https://github.com/rishu4436/perpshq). Branch: `fix/perpshq-hackathon-readiness`; base: `main`. No force push or merge.

- `db32a94`: pin reviewed transactions; wallet recovery, cancellation and receipt handling.
- `ec74f1c`: suppress stale/insufficient directional analysis.
- `843e43d`: independent persistent market/account alert engine and scheduler.
- `1bb3412`: preserve chart instance/range across refresh.
- `6b91798`: compare the displayed gas estimate at confirmation.
- `6cf57b2`: connect analysis references, alert scheduling and original journal provenance.
- `43236e3`: synchronize navigation arriving during initial app mount.
- Final browser/HTTP verification and documentation are included in this branch. [Reviewable branch comparison](https://github.com/rishu4436/perpshq/compare/main...fix/perpshq-hackathon-readiness); the PR link accompanies the completion report.

## G. Remaining practical risks

- Simulation describes the observed state; price, liquidity, funding, gas and protocol restrictions can change before mining. Revalidation may intentionally require a fresh review.
- No native protective order, reduce-only close, margin funding, leverage mutation, app-managed wallet or linked-bot signing is implemented. Stop/target estimates are not guaranteed realized losses.
- Browser alerts may pause with closure/throttling. Local storage is single-origin/device persistence and can be erased; export important records. No cross-device protocol idempotency exists. Web Locks are browser-dependent.
- Exact matching prevents unsafe recovery but cannot invent a missing transaction hash. A genuinely unresolved wallet request may need manual investigation; do not bypass its lock.
- RPC/indexer delays or gaps can make data unavailable and order state syncing. Bounded account histories do not establish lifetime P&L. No deployment availability/SLA or successful public CI result is inferred from local tests.
