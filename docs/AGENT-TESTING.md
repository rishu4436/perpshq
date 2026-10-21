# Agent Studio verification

Verification uses real read-only sources, isolated paper stores and explicit test doubles. No private key, signed order, transfer, bot grant or deployment is used. Source snapshots from earlier work are test fixtures, not runtime prices. Synthetic depth/accounts/hashes in automated tests are labelled test-only.

## Commands and results

| Check                                  | Result                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm ci`                               | Passed; 295 packages installed, 296 audited, zero known vulnerabilities at verification. No new dependency added. |
| `npm run lint`                         | Passed.                                                                                                           |
| `npm run typecheck`                    | Passed.                                                                                                           |
| `npm test`                             | 206 passed, five optional live tests skipped; 12 files passed.                                                    |
| `LIVE_TESTS=1 npm test`                | 211 passed, zero failed/skipped; includes five actual read-only SDK tests.                                        |
| `npm run build`                        | Passed TypeScript and production Vite build. Dependency PURE-comment warnings are nonfatal.                       |
| Dedicated Agent Studio browser run     | 12/12 passed across desktop/mobile.                                                                               |
| Actual Agent Studio visual capture     | 2/2 passed; persisted local state, no mocks in these captures.                                                    |
| Full production browser suite          | 57 passed, zero failed; one mobile wheel/zoom case intentionally skipped (58 total). Desktop zoom is covered.     |
| Actual independent worker verification | 7/7 passed; [timestamped JSON](agent-worker-verification.json).                                                   |
| Actual local Agent API verification    | 16/16 passed; [timestamped JSON](agent-http-verification.json).                                                   |
| Docker local build/start               | Blocked before build: Docker Desktop Linux daemon pipe unavailable. Container behavior remains unverified.        |

The initial full browser attempt spanned an overnight machine suspension and was interrupted/restarted. Only the completed final run above establishes its result. An npm wrapper rejected an extra forwarded `--workers` flag; the normal `npm run test:e2e` command runs with one worker under LIVE_TESTS=1.

## Coverage

Agent-specific unit/integration tests: **110** (48 signal/config/risk, 14 paper/history, 29 unsigned execution/reconciliation, 19 worker/store). Existing **101** tests remain (96 default plus five optional live). Existing mocked manual-wallet execution paths are preserved.

- Configuration/strategy: invalid schemas, key fields, contradictory limits, EMA/RSI/timeframes, warm-up/completion/staleness, market/chain, MTF/coverage, deterministic candidates, duplicate signals, prior-prefix breakout, mean-reversion recovery and Guardian reductions.
- Risk: forged claimed sizing, exact 24-decimal lots, exposure/count/margin/leverage/loss/rate/failure/cooldown/gas/permission/health checks and unknown/incomplete account state.
- Paper/history: partial depth, no repeated snapshot fills, no stale/crossed/missing fills, conservative limits/expiry, net entry/exit costs and funding, drawdown, chronological partition boundaries, prefix invariance and missing-volume rejection.
- Execution: pinned official selectors/direct ABI suffixes, separate owner/operator, actual-call-shaped grant reads, size/system/simulation/gas failures, revocation during preflight, reviewed data/nonce changes, owned cancellation/shrinkage, source broadcast lock, receipt partial/rest/fill/revert/indexer delay and attribution mismatch.
- Durable worker: config versions/replay, command acknowledgement, emergency latch, physical database reopen, corrupt ledger, duplicate worker including same ID, lease replacement, pending pause/lease loss during I/O, block regression, unresolved intent recovery, read deadline, RPC/WS/indexer/oracle/store failure and explicit safe resume.
- Browser: create/edit/reload, validation/locked autonomous mode, requested/acknowledged start/pause/emergency, decisions/paper results, permission/history/export, local worker disconnect and manual Planner isolation during agent-store failure.

## Reproduce

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
$env:LIVE_TESTS='1'
npm test
```

Windows uses installed Edge; Linux CI installs Chromium. Browser wallet tests always mock EIP-1193; CI does not broadcast. Live checks read actual endpoints and can fail if external services are unavailable.

For actual agent API/visual checks, start a server with **isolated** `AGENT_STORE_PATH='data/agent-studio-qa.sqlite'`, configure a dry-run agent, run a separate worker against that same path, and set PERPSHQ_TEST_URL to the server. `scripts/verify-agent-http.ts` intentionally saves a labelled QA configuration and queues only local commands; never target a live operational store. It verifies discovered constraints, actual false grants for synthetic public addresses, actual-candle reports, exports, version/replay/origin guards and absence of chain evidence. Browser capture requires a configured agent; an empty workspace is not a test failure in normal use.

`node node_modules/tsx/dist/cli.mjs scripts/verify-agent-worker.ts` creates its own ignored temporary database and actual bounded child workers. It verifies startup/heartbeat, duplicate rejection, health exit code, real pause/resume acknowledgement, clean exit, restart/ledger/cursor/unique fills and pool permission read ABI with synthetic addresses. **False grants do not establish an authorized wallet.** Its one paper fill is simulated; real transaction count stays zero.

Screenshots: [desktop](screenshots/agent-studio-desktop.png), [mobile](screenshots/agent-studio-mobile.png). Observations are dated, not a claim that a worker remains online. No container startup, cloud uptime, funded linked-owner execution, atomic reduce-only or genuine authored testnet trade has been verified.
