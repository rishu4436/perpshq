# PerpsHQ local improvements — 26 October 2026

Implemented in the existing local checkout, with features added before the seven audited bug fixes. No commit, GitHub push, deployment, wallet signature, permission grant or trading transaction was performed.

Open **Recovery Center** from the application navigation, or `/app#Recovery%20Center`. Run the application with `npm run dev`; the independent agent worker still runs separately with `npm run agent:worker`. Saving a configuration does not start it.

## Added features, in priority order

| Priority | Feature                                 | Delivered behavior                                                                                                                                                                                                                 |
| -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Coherent account snapshots              | Margin, active positions and mark/health analytics share one selected block. Order exposure retains same-block completeness checks.                                                                                                |
| 2        | Recovery Center                         | Durable worker heartbeat, run generation, configuration revision, last evaluation, stop reason, failed checks, unresolved intents and recovery requirements.                                                                       |
| 3        | Lifecycle and full backup               | Archive flat stopped agents without erasing history, restore archived agents, clone a new dry-run configuration, and export/import the SQLite workspace plus browser records.                                                      |
| 4        | Trading readiness                       | Wallet, chain, identity/freshness, margin collateral, planning gas reserve, complete exposure, health, market constraints and unresolved submission checks, also shown in Trade Planner.                                           |
| 5        | Order activity                          | Draft, reviewed, signature, hash/pending, unknown/rejected, receipt/order observations and journal events correlated by flow/hash. Browser outbox retries local delivery.                                                          |
| 6        | Account accounting                      | Block-pinned equity, bounded bank-log scans and paginated fill checks; external flows removed from equity change, with fees/funding displayed without subtracting twice. Only complete reports supply P&L to assisted risk checks. |
| 7        | Decision replay and comparison          | Saved observation, candles, indicators, configuration, prior runtime/ledger, proposal and checks. Compare baseline costs with doubled fees/slippage/funding on the identical dataset and chronological partitions.                 |
| 8        | Shared paper capital and durable alerts | Shared bankroll, aggregate position/order exposure and atomic allocation checks; persistent alerts for disconnect, stale data, errors, risk failures and order-state changes, with deduplication and acknowledgment.               |

The new screens use the charcoal/lime identity, responsive cards, readable explanations and explicit evidence labels. Recovery Center has a separate production bundle.

## Seven audited defects fixed

1. **Emergency stop:** a durable latch survives ordinary commands, configuration changes, restart and restore. Requesting emergency stop latches immediately.
2. **Pause/resume race:** persisted control generations invalidate successful observations and errors that began before a control transition. Tests use separate SQLite connections.
3. **Historical hourly cap:** historical and forward runs share action-attempt accounting, including unfilled attempts. Historical projected cost/exposure checks were tightened.
4. **Failure recovery:** verified healthy evaluation resets transient consecutive failures, preserving cooldown and unknown-submission safeguards.
5. **Assisted pause:** `PAUSE_REQUIRED` persists a paused lifecycle in assisted mode and stops further observation cycles until a new reviewed command.
6. **Malformed URL:** initial navigation and hash changes fall back to Command Center for invalid encoding or unknown routes.
7. **Malformed browser data:** runtime schemas validate saved watchlists, journals, plans, rules and planner context. Legacy/v1 data migrates; malformed originals remain available for export. Safe defaults and an error boundary recover the view. Quota failures keep latest values in memory and include them in exports.

Also fixed delayed planner previews: a response for an earlier form or wallet cannot open confirmation after inputs change.

## Backup and recovery

- Export includes configurations/versions, runtime/ledgers, commands/events, decisions, historical reports, unresolved intents, replay evidence, portfolios, accounting, alert acknowledgments and `perpshq.*` browser records. The worker accepts no signing key.
- Server data uses checksummed gzip. Import validates the table set, identities, relationships, ledgers, runtime, intents and auxiliary records transactionally. Invalid imports roll back.
- Restore requires an empty database and no active worker lease. The browser refuses to overwrite journals, saved plans, transactions or unresolved submissions.
- Restored agents are paused; emergency latches and unknown intents survive. Pending commands are rejected, so restore cannot restart an agent.
- Portable limits: 32 MB complete file, 28 MB base64 server payload, 256 MB expanded server data. Larger workspaces need a native SQLite backup. Replay retention is 100 observations per agent; existing event/configuration history is not silently pruned.
- Browser records belong to their browser origin, including port. Export from the origin where journals/plans were created. Exports contain account addresses and personal records; checksums detect corruption but provide neither authenticity nor encryption.

## Verification

- `LIVE_TESTS=0 npm test`: **20 files passed, 280 tests passed, 5 optional live tests skipped**.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript checking. Only nonfatal dependency PURE-comment warnings remain.
- Production preview on loopback port 4182, Playwright with two workers: **69 passed, 9 skipped**, across desktop Edge and mobile Chromium emulation. Skips are eight opt-in live cases and one mobile-inapplicable mouse-wheel case.
- `npm run format:check` and `git diff --check`: passed.

The tests cover emergency transitions, stale commits/errors, action limits, recovery, assisted pause, pinned blocks, accounting completeness, archive/clone, tampering/rollback, unknown-intent preservation, shared capital, stale member marks, alert deduplication, storage recovery and delayed previews.

The browser/API integration uses isolated in-memory SQLite stores and fixture observations. It exercises real workspace handlers, saves a portfolio, acknowledges an alert, compares a replay, downloads a compressed backup and restores it into a second empty database. It does not touch the user's persistent database. Desktop/mobile screenshots in ignored `data/local-release-2026-10-26/` contain test fixtures.

## Remaining limits

- **No live execution verification:** final non-live Vitest setup rejects non-loopback fetches; mocked browser fixtures block off-loopback page requests. This validates local software, not current RPC/indexer availability or signed execution.
- **Native protective exits remain unavailable.** Planned stops are labeled as unarmed; paper stops are simulated. Existing owner-reviewed order cancellation remains, but no new position-reduction or native stop transaction is claimed. Autonomous broadcasting stays disabled.
- **Accounting fails closed:** archive RPC reads, complete bank events and a caught-up indexer are required. Unknown credit/principal events and liquidation/transfers require supported decoders; installed SDK 0.32.1 does not expose every event layout. Unsupported intervals provide no P&L. The API permits seven days per report; scans stop at one million blocks or 200 fill pages. Large histories can exceed API/worker deadlines; incremental background reconciliation remains future work.
- **Shared capital is paper-only.** Strategies own their own positions while risk aggregates the pool. Membership/capital cannot change after use. Paused valuations remain frozen; stale held positions block new shared exposure. The existing UTC daily-loss guard is conservative rather than conventional day-start-equity P&L.
- **Local delivery only:** alerts persist across browser closure while the worker/API runs; no external notifications are sent. Browser-reported order events are not authoritative chain evidence by themselves. The browser outbox is bounded to 1,000 events.
- **Historical assumptions remain:** no reconstructed maker queue, liquidation simulation or executable native protection. Cost comparisons are research diagnostics, not predicted returns.
