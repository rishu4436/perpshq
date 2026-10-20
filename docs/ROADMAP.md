# PerpsHQ Roadmap — October 20, 2026

**Current priority: complete the core MVP. Agent Studio and 24/7 automation are future work, not implemented or enabled.**

## P0 — Finish existing PerpsHQ
- Fix stale-market directional scenario text, multi-market and margin alert evaluation, cockpit-to-planner context transfer, and chart zoom reset on data refresh.
- Harden the existing user-owned wallet order lifecycle and unknown-transaction recovery.
- Obtain an **explicitly user-approved** real Hideki (50383) testnet perp order and independently verify transaction receipt, order state and fill state.
- Pass regression checks and deliver reviewer-accessible demo, transaction evidence, README and bounty submission. No simulated evidence may stand in for an authored trade.

## P1 — Complete the one-destination workflow
- Carry verified market intelligence into trade plans and journals.
- Improve account risk views, monitoring, and position/order review; avoid invented performance or liquidation metrics.

## P2 — Agent Studio (planned after P0)
**Vision:** User-configurable, explainable dreamDEX perp strategies integrated with PerpsHQ's market data, indicators, risk engine and transaction evidence.

**Stage A — Dry-run agent:** Configurable deterministic strategies (trend, breakout, mean reversion, risk guardian), correct candle/freshness checks, backtesting without lookahead, timestamped decisions, no on-chain writes.

**Stage B — Permissioned testnet orders:** A dedicated operator key linked to a user's Somnia Account wallet through dreamDEX **Link a Bot**, granting perps permissions market by market. Review current ABI for `placeOrderFor`, `cancelOrderFor` and `reduceOrderFor`. Owner controls the collateral; bot pays STT for gas. No withdrawal capability does **not** eliminate trading losses. Enforce max notional, exposure, daily/session loss, order rate, stale-data guard, gas reserve, and emergency stop; test revocation and resting-order cleanup. A linked bot **cannot** arm native exchange-held TP/SL; bot-monitored exits are unavailable if the worker stops.

**Stage C — Always-on runner:** Run a persistent **separate worker on Railway or a comparable service**, not in the browser or the loopback Express server. Reuse the official dreamDEX bot kit's perps examples and [24/7 Railway instructions](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/railway.md) and [Railway template](https://railway.com/deploy/pE6EIF). Perps require **Hideki 50383**: set `STRATEGY=perp-*` and `NETWORK=hideki` as documented; spot testnet defaults are a different chain. `OWNER_ADDRESS` identifies the linked trading account. Secure the operator secret in the worker's secret settings, not in GitHub or the client. Add persistent state, restart policy, monitoring, heartbeat, RPC/WebSocket reconnect, nonce discipline, receipt reconciliation, fail-closed circuit breakers and remote pause.

**Stage D — Verification:** First dry-run continuously; then supervised low-notional user-approved canary trades. Verify actual receipts/fills and test outages, duplicate submissions, stale data, account permission changes, low gas and crash recovery. Unattended execution remains OFF until separately authorized.

**Hosting clarification:** dreamDEX provides a bot builder, open-source perps templates, linked-bot permissions and deployment guides. The official docs route 24/7 bots to Railway; they do **not** establish that dreamDEX hosts the worker itself. Somnia Reactivity may help with chain events but is not a general-purpose off-chain strategy host; verify target-network support before using it.

## References
- [dreamDEX perps developer docs](https://app.testnet.dreamdex.io/docs/developers/perps-testnet)
- [Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot)
- [Official perps strategies](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/perps.md)
- [24/7 operations](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/24-7-operations.md)
- [Railway deployment](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/railway.md)
