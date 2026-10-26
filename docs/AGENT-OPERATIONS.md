# Agent worker operations

## Startup and health

Use Node 24, `npm ci`, `npm run agent:check`, then `npm run agent:worker` independently of the web app. Both local processes share the same AGENT_STORE_PATH. Closing the browser does not stop the worker. Stopping the worker does not close positions.

Startup checks environment, Hideki RPC, available markets, SDK 0.32.1 and durable state. Optional config imports only new DRY_RUN agents; existing pause/version state persists. Actual owner/operator permissions, gas and account health are checked during owner-backed observations. Complete actual loss history is unavailable, so assisted increases remain blocked. Unresolved MOCK intents prevent restart/resume; no real signer exists.

`npm run agent:health` exits zero for an existing heartbeat ≤30 seconds old, nonstopped state, chain 50383 and disabled broadcast. Use the same DB path. It does not create a healthy store if none exists. Five-second heartbeat/renewal is independent of 10–300-second polling. A healthy idle process can contain paused agents; inspect per-agent errors.

## Commands and shutdown

Start/resume/pause/stop/emergency UUID/revision requests stay pending until acknowledgement. Read command result and heartbeat; offline is not paused. Pending stop commands prevent in-flight commits. Emergency is latched: resume/edit cannot clear it. Retain evidence and investigate before creating a separately reviewed new agent.

SIGINT/SIGTERM stops new work, clears heartbeat renewal, records stopped state, releases fence and closes DB/SDK. Late observations are discarded. AGENT_MAX_CYCLES also supports bounded shutdown. `persistenceAcknowledged:false` indicates a shutdown/store problem, not flattened positions. Existing paper/chain exposure remains. Revoking grants does not cancel resting orders. Inspect official account state before separately authorized cleanup.

## Recovery runbook

| Symptom                          | Action                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Stale/oracle/RPC/indexer failure | Leave paused, inspect actual endpoints/freshness, resume explicitly only after fresh observations.                                     |
| Grant/gas missing                | Read public grants/STT. Do not add keys. Funding/grants require separate authorization.                                                |
| Unknown intent                   | Preserve DB; investigate hash/nonce/exact calldata/receipt. Never clear/retry blindly. Automated intents here are MOCK only.           |
| Duplicate worker                 | Stop unwanted process, inspect lease/fence, keep one shared volume. Same ID cannot grant ownership.                                    |
| DB corrupt/unavailable           | Stop, preserve DB/WAL/SHM, restore consistent backup and reconcile before restarting. Never replace corrupt financial state with zero. |
| Config conflict                  | Reload revision, pause and inspect exposure. Active/exposed ledgers cannot be reinterpreted by editing.                                |
| Cloud/offline UI                 | Local UI has no remote authority. Verify service state out of band; never infer kill acknowledgement.                                  |

Back up while API/worker are stopped or use SQLite consistent backup tooling; copying only a live WAL DB can lose records. Protect backups/addresses/strategies with OS ACLs. POSIX DB mode is 0600; Windows inherits ACLs. No app encryption or hosted identity boundary is claimed.

Decisions retain newest 1000/agent (API defaults 100), reports return latest ten and command/event views are bounded. Full ledger, commands, events and report tables can grow: monitor disk/export/archive during approved maintenance. Never delete active nonce/unknown-intent records. No offsite backup, alert delivery or on-call service is configured.

## Canary gate

The manual MVP still lacks a genuine specifically approved authored trade. Before canary: explicit exact transaction authorization, funded eligible margin/STT, Somnia Account ownership/grants, supervised manual receipt/order verification, reliable loss accounting, signer/secret review and external nonce coordination. Review nonatomic reductions. Verify actual receipt/fills/positions, cancellation and unknown-outcome recovery. CI/mocks/public wallets cannot satisfy these gates. Mainnet/unattended broadcasting remains disabled.
