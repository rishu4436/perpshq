# 3–5 minute demonstration

## Preparation

Run `npm ci`, `npm run build`, `npm start` from the project directory. Open `http://127.0.0.1:3000` in a normal browser for external-wallet support. Keep RPC/WebSocket and indexer connectivity available. Use a test wallet with STT and perps collateral only if the user intends to authorize a test order.

## Story

0:00–0:35 — Command Center. Explain the fragmented trading workflow. Point out discovered perpetual markets, actual perp candle chart and visibly sourced settlement versus current marks. Account remains usefully disconnected until chosen.

0:35–1:10 — Scanner. Search a market, star it, choose a timeframe/preset and inspect heuristic ranking. Explain that missing evidence contributes zero and that the score is not a win probability.

1:10–2:10 — Cockpit. Open the same market, zoom, refresh without losing the visible range, toggle overlays, inspect RSI/MACD/ATR/ADX, confirmed support zones and multi-timeframe disagreement. Show source quality notes, warm-up states and a conditional explanation. Ask the deterministic assistant about support or RSI.

2:10–3:00 — Planner. Selected pool is retained. Inspect the Market Intelligence Context panel and its timestamps, source warnings and timeframe assessment. Explicitly click eligible entry/support/resistance references; demonstrate the correct inverse choices for shorts. Manually enter the user’s risk assumptions. Show lot rounding, estimated loss/reward, protocol limits and the statement that planning stops are not native protection. Save the plan and import original context into the journal. Show that subsequent refreshes preserve the captured analysis.

3:00–3:45 — Optional authorized transaction. Only with the user’s approval, connect their test wallet and validate one specific order. Show the full account/pool/chain preview. The user signs. Display the actual receipt and order state. If authorization/funding is unavailable, clearly state that execution remains unverified; do not show the CI mock as a real trade.

3:45–4:30 — Positions & Risk and Journal. Reconcile actual chain/indexer state, explain lag, show current health, record the thesis and reflection, and export evidence. Do not equate a fill with a complete profitable trade.

4:30–5:00 — Arena Companion. Show the preparation checklist, local evidence counts and official Arena link. Describe repeated use: scan, reason, plan, execute only when authorized, observe and review.

## Honest demo limitations

Native position closing, native stop placement, managed-wallet integration, full lifetime analytics and historical backtesting are not available. No authored testnet transaction exists until the authorization steps in TESTNET-EVIDENCE.md have been completed. Use actual loading, errors and unavailable states when services are impaired.

## Demo preparation checklist

- [x] Existing product identity and discovery/analysis/planning/review navigation retained.
- [x] Stale-data scenarios, independent alerts, explicit planning references and stable chart refresh implemented and regression-tested.
- [x] Mocked rejection, unknown outcome, cancellation and matching receipt recovery covered without broadcasting.
- [x] First-transaction and reviewer-access instructions prepared.
- [ ] Complete the user-owned wallet/funding and exact authorization steps in [TESTNET-TRANSACTION-CHECKLIST.md](TESTNET-TRANSACTION-CHECKLIST.md).
- [ ] Record a genuine transaction, actual order/position result and any separately authorized cancellation. Preserve the distinction between confirmation and fill.
- [ ] Record the final video, add approved public links and verify current organizer requirements. No recording or posting has been performed.

## Integrated Agent Studio demonstration (additional 2 minutes)

Prepare an isolated local database with a normal DRY_RUN config and a separate `npm run agent:worker` process sharing AGENT_STORE_PATH. Keep a real observation history; do not seed fabricated returns/fills. Saving alone is configured, not running.

1. Open Agent Studio, create or inspect a market/strategy, edit signals/costs/hard limits, validate and save a version. State the selected mode and absence of a signer.
2. Request dry run and show actual worker acknowledgement/heartbeat. Close the browser briefly and confirm the independent worker continues recording observations.
3. Open Decisions: show a real matched/rejected rule, source/candle time and central risk explanation. NO_ACTION or DATA_UNAVAILABLE is a valid truthful demo outcome. If no fill occurs, say so; never force favorable candles or relax limits to manufacture one.
4. Open Simulation: show actual paper records/cost assumptions or the empty state. Historical results use real available candles and chronological partitions, not predictive accuracy.
5. Show actual public-address grant reads/unsigned entry preflight capability. False/no grants and incomplete account history are blockers, not authorization. Operator position exits are unavailable because ordinary delegated IOC lacks verified atomic reduce-only protection.
6. Request pause; show pending then worker acknowledgement. Restart the worker on the same DB; show persisted config/ledger/cursor and paused state. Explain emergency latch, unknown-intent lock and that stop does not flatten chain exposure.
7. Open Deployment: nonsecret export, no authenticated cloud connection, Docker/Railway preparation only. No cloud uptime claim. Explain the separately authorized canary and merge/deployment gates.

## Video and screenshot plan

Record the actual integrated branch at 1440px desktop, readable 1080p export; optional mobile segment at 390px. First show website → Scanner → Cockpit → user-clicked Planner context → exact preview. Pause the recording before a wallet request unless the user has explicitly authorized that exact funded testnet action. If unapproved/unfunded, show the real blocker and the prepared checklist; do not insert mock footage as genuine evidence. With authorization, record actual hash/receipt and distinguish partial/resting/fill, then journal original context.

Use a separate labelled Agent Studio segment to show real read-only observations and genuine worker acknowledgements. Narration must distinguish code/tests, simulations and on-chain proof. Hide wallet secrets and account login/session material; public addresses/transactions may be shown only as intended evidence. Final video file, hosted link and public deployment are not yet created. Keep X posting and DoraHacks submission for explicit owner review/approval.
