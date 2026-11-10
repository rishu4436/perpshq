# PerpsHQ local submission package — 29 October 2026

> Historical/local implementation context. The [10 November release report](RELEASE-2026-11-10.md) is the current deployment, execution and submission status.

Latest status: [1 November live strategy tests](LIVE-STRATEGY-TESTS-2026-11-01.md) supersede the locked-wallet continuation below. Trend entry and Guardian cancellation now have verified strategy receipts; Breakout and Mean Reversion live execution remain unverified.

All work in this sprint remains local. No GitHub push, public deployment, social post or organizer submission was made.

## Owner-wallet continuation

Connected strategy execution is now implemented locally with exact transaction review, current risk revalidation, persistent unknown-outcome locks and matching receipt recovery. The live trend review produced a genuine 0.00013 BTC candidate under default signal thresholds. MetaMask is currently locked, with an unresolved request and no returned transaction hash. The owner must unlock MetaMask before live testing can resume. The latest account read is flat with no open orders or account errors.

**The four requested strategy executions have not been verified. The project is not yet fully checked for that release requirement.** See [the current live review status](LIVE-STRATEGY-REVIEW-2026-10-29.md). Historical manual BTC transactions and the earlier demo do not prove the new strategy flow. No pending-request lock was cleared merely because a wallet response timed out.

## Verified trading

The connected Edge wallet completed an actual Hideki chain 50383 BTC open and full close. The position is flat, with no resting orders. Exact hashes, receipt blocks, decoded fill quantities/prices and subsequent bank state are in [TESTNET-EXECUTION-2026-10-29.md](TESTNET-EXECUTION-2026-10-29.md).

The closing sell was supervised and equal to the existing position. Atomic reduce-only closes and autonomous agent broadcasting remain unsupported. Do not present the manual closing test as proof of autonomous exits.

## Strategies

All four strategies are covered by the focused 114-test run: trend agreement and data integrity; confirmed support/resistance breakout with volume/liquidity gates; mean reversion with recovery checks; Risk Guardian with no-entry and bounded reduction recommendations. Execution permission, unknown-broadcast recovery and historical chronology regressions also pass.

Command: `node node_modules/vitest/vitest.mjs run tests/unit/agent-engine.test.ts tests/unit/agent-paper-history.test.ts tests/integration/agent-execution.test.ts tests/integration/audit-regressions.test.ts`.

These are deterministic code tests using labelled fixtures. They do not establish profitable strategies or demonstrate four live autonomous trading sessions. Automated test simulations remain distinct from the actual wallet transactions.

## Website verification

The focused desktop/mobile landing and manual workflow suite passed 24 runnable checks, with 2 optional live captures skipped. One cold workspace load initially exceeded the test helper's five-second wait. The helper now waits up to 30 seconds for the same visible workspace condition, and the failing desktop navigation case passed on rerun. No assertion was removed. The tested flows include wallet rejection, unknown-outcome locks, exact review, all navigation destinations and mobile overflow.

## Demo files

The repeatable recorder is `scripts/record-local-demo.mjs`. Output is in ignored local directory `data/submission-demo/`: captioned 1080p WebM, MP4 export, scene screenshots and scene manifest. The tour reads the running local app with a separate disconnected recording browser; it does not fabricate wallet balances or fills. Its final card quotes the independently verified transaction evidence. No voiceover or public video URL is claimed.

## Final external requirements

- Verify current DoraHacks organizer rules, deadline, whitelist and required links in the organizer page. Automated retrieval of the official page was unavailable; the old brief's deadline remains unverified.
- Review the finished local video and upload it only when public upload is authorized.
- Provide a reviewer-accessible hosted URL if the event requires one. The app currently runs locally.
- The latest changes are absent from the public repository until the owner authorizes a push.
- Review submission wording and any social requirements, then submit through the owner account.

The package is prepared for local review. These external requirements prevent an unconditional claim that the public submission is complete.
