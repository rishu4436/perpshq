# Agent Studio release report

Prepared 21 October 2026. Scope: existing PerpsHQ extension on Hideki 50383. All live execution remains disabled. This is a reviewable local dry-run implementation with explicit remaining gates, not an autonomously traded or deployed service.

## 1. Architecture implemented

Pure strategy → mandatory risk → unsigned authorization/preflight → separately attributed reconciliation. Independent Node worker and local API share durable SQLite; React never owns the worker lifecycle. See [architecture](AGENT-STUDIO-ARCHITECTURE.md).

## 2. New files/modules

Four packages: `agent-engine` (config/types/evaluation/paper/history), `agent-risk`, `agent-store` (including strict financial validation), `agent-execution`. New `apps/agent-worker` lifecycle/data/health/config/Docker/Railway files; local API `agents.ts`; lazy Agent Studio UI/builder/CSS. Added fixtures, four unit/integration test files, browser tests, two actual verification scripts/JSON records and the linked documentation set. Existing App/navigation/server/types/package scripts changed only for integration. Root `.dockerignore` protects data/env/build context.

## 3. Working product features

Create/edit/validate versioned no-code strategies; observed dashboard; dry-run start/pause/resume/stop/emergency requests and acknowledgements; decision provenance/risk log; persisted paper ledger/curve/fills; actual-candle historical reports; public-address permission onboarding/reads; nonsecret config/Railway export; deployment limitations; evidence export. Existing manual screens/signing preparation remain intact. Screens fit desktop/mobile with keyboard/focus handling in builder dialogs.

## 4. Strategies

Multi-timeframe trend, confirmed support/resistance breakout, multi-condition mean reversion, Risk Guardian. All reuse actual normalized completed history and existing indicators/structure. Guardian monitors exposure rather than finding entries. [Full methodology](AGENT-STRATEGIES.md).

## 5. Strategy limits

No predictive edge/positive-return claim. Real perps history can be thin/gapped. Paper cash/cost/funding are assumptions. Book fills omit queue/hidden depth; history uses next observed open/prior volume, no historical book, no favorable intrabar stops. Temporal validation is exploratory. Guardian needs a healthy worker/data and cannot arm native stops. Opposite-side IOC is not atomic reduce-only. Independent ledgers are not a pooled portfolio.

## 6. Risk protections

Exact raw sizing/grid/minimum, notional/risk/exposure/count/leverage/collateral, fresh mark/history/account/indexer, complete loss guards, rate/failure/cooldown, actual STT/permissions and explicit action policy. Unknown actual P&L is null and blocks increases. Store lease/fence/version/pause recheck after I/O, intent/nonce uniqueness and unknown lock prevent blind retries. [Risk details](AGENT-RISK-CONTROLS.md).

## 7. Actual worker proof

Seven actual keyless checks passed: independent startup/heartbeat, duplicate rejection, health CLI, pause/resume acknowledgement, clean bounded shutdown, restart preserving cursor/ledger/unique records, actual pool grant ABI reads. The run recorded one **simulated** fill and zero actual transactions. Public synthetic accounts had false grants. [Evidence](agent-worker-verification.json). Local Node process proof is not cloud/container/24/7 proof.

## 8. Verification

Locked install, lint, typecheck and production build passed. Default unit/integration: 206 passed, five intentionally skipped. With actual read-only SDK checks: 211 passed, zero skipped/failed. New Agent Studio workflows: 12/12 desktop/mobile; actual captures: 2/2. Local real API: 16/16. Full production browsers: 57 passed, zero failed; one mobile wheel/zoom case intentionally skipped (58 total). Desktop zoom is covered.. Docker check is blocked by the unavailable local Linux engine. See [complete testing record](AGENT-TESTING.md).

## 9. Railway readiness

Root-context Node 24 nonroot Dockerfile, persistent-volume path, heartbeat health CLI, exact env schema, ON_FAILURE/ten retries and no exposed port. Container build/start remains unverified due missing daemon. No service/domain/deployment created. One replica/shared volume required; no remote authenticated control. [Deployment guide](AGENT-RAILWAY-DEPLOYMENT.md).

## 10. Linked-bot verification

Official bot-kit pin `25798660bbe4674a6f83a960b202852896e2fed4`, installed SDK 0.32.1. SDK delegated exports are absent; exact official signatures were independently checked via selectors/direct-call suffixes. `placeOrderFor` = `0x80054449`, `cancelOrderFor` = `0xe37b444b`, `reduceOrderFor` = `0x364c2587`. Last method shrinks resting orders, not positions. Actual same-block pool grants/gas are read; mock tests cover simulation/gas/size/revocation/reconciliation. No real wallet grant or signer compatibility is claimed. MIT notice retained.

## 11. Before an authorized canary

First complete the outstanding specifically authorized manual authored testnet order. Verify real Somnia Account ownership/eligible margin, funded STT, per-market operator grants, complete loss accounting and independently reviewed signer/secret/nonce boundary. Explicitly approve exact account/pool/side/quantity/bound/action. Verify genuine receipt/order/fills/positions, cancellation and unknown recovery; resolve nonatomic reduction semantics. A source change and separate review are required before enabling any broadcast. Environment variables alone cannot satisfy these gates.

## 12. Remaining safety/operational issues

No genuine authored trade, live signer, cloud deployment or uptime proof. Incomplete actual P&L blocks increases. Generic contract code does not prove Somnia Account ownership. Hosted identity/roles/encrypted metadata/remote control are unimplemented; API remains loopback. Independent volumes/external operator use do not coordinate. DB backups/retention/disk monitoring are manual. Pause/emergency/shutdown/revocation never imply flattened exposure. No mainnet action exists. [Security](SECURITY.md), [operations](AGENT-OPERATIONS.md).

## 13. Branch and review

Branch: `feature/perpshq-agent-studio`, based on readiness commit `d8f0e95`. Meaningful strategy/risk, worker/store, delegated preflight and UI/API commits isolate the implementation. Review targets `fix/perpshq-hackathon-readiness` because [PR #1](https://github.com/rishu4436/perpshq/pull/1) is still open; merge readiness first, then retarget/review this feature normally. No automatic merge.

Repository visibility was observed PUBLIC on 21 October 2026. The owner explicitly authorized keeping it public and pushing this feature. Published feature review: [PR #2](https://github.com/rishu4436/perpshq/pull/2), targeting `fix/perpshq-hackathon-readiness`. GitHub Actions checks are attached to the PR; inspect the latest head checks before merge. The working branch is pushed and no merge/deployment was performed.

No real trade, transfer, funding, permission grant, public deployment or visibility change was performed during implementation.

## Superseding final integration audit

The 21 October integration sprint adds authoritative exposure completeness, strict secondary-frame/gap checks, post-cost paper-fill limits/unique IDs, explicit delegated position-exit rejection and worker reentrancy protection. Current tests are 241 offline + five optional read-only = 246, with 145 agent/exposure and 101 legacy cases. Native worker proof is now eight checks including forced termination and lease-expiry takeover; the newest real-observation run produced zero simulated fills and zero transactions. The earlier one-fill observation above is historical, not current demo performance. Current integration/review status and all release gates are in [FINAL-RELEASE-AUDIT.md](FINAL-RELEASE-AUDIT.md); PR #2 remains the prior feature review, not proof that main contains it.
