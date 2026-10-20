# 3–5 minute demonstration

## Preparation

Run `npm install`, `npm run build`, `npm start` from the project directory. Open `http://127.0.0.1:3000` in a normal browser for external-wallet support. Keep RPC/WebSocket and indexer connectivity available. Use a test wallet with STT and perps collateral only if the user intends to authorize a test order.

## Story

0:00–0:35 — Command Center. Explain the fragmented trading workflow. Point out discovered perpetual markets, actual perp candle chart and visibly sourced settlement versus current marks. Account remains usefully disconnected until chosen.

0:35–1:10 — Scanner. Search a market, star it, choose a timeframe/preset and inspect heuristic ranking. Explain that missing evidence contributes zero and that the score is not a win probability.

1:10–2:10 — Cockpit. Open the same market, toggle overlays, inspect RSI/MACD/ATR/ADX, confirmed support zones and multi-timeframe disagreement. Show source quality notes, warm-up states and a conditional explanation. Ask the deterministic assistant about support or RSI.

2:10–3:00 — Planner. Selected pool is retained. Manually enter the user’s risk assumptions. Show lot rounding, estimated loss/reward, protocol limits and the statement that planning stops are not native protection. Save the plan.

3:00–3:45 — Optional authorized transaction. Only with the user’s approval, connect their test wallet and validate one specific order. Show the full account/pool/chain preview. The user signs. Display the actual receipt and order state. If authorization/funding is unavailable, clearly state that execution remains unverified; do not show the CI mock as a real trade.

3:45–4:30 — Positions & Risk and Journal. Reconcile actual chain/indexer state, explain lag, show current health, record the thesis and reflection, and export evidence. Do not equate a fill with a complete profitable trade.

4:30–5:00 — Arena Companion. Show the preparation checklist, local evidence counts and official Arena link. Describe repeated use: scan, reason, plan, execute only when authorized, observe and review.

## Honest demo limitations

Native position closing, native stop placement, managed-wallet integration, full lifetime analytics and historical backtesting are not available. No authored testnet transaction exists until the authorization steps in TESTNET-EVIDENCE.md have been completed. Use actual loading, errors and unavailable states when services are impaired.
