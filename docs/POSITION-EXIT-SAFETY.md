# Position exit safety — 21 October 2026

**PerpsHQ does not submit position exits.** Guardian may simulate/recommend an opposite-side IOC, but delegated preflight now rejects non-entry position actions even when `allowPositionReductions=true`. Real broadcast is separately disabled. `reduceOrderFor` remains resting-order maintenance only.

## Current primary evidence

The official [perps orders page](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/orders), read 21 October, documents owner reduce-only orders and exchange-held TP/SL. The [Link a Bot guide](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot) explicitly excludes linked bots from arming exchange-held TP/SL. The [developer guide](https://app.testnet.dreamdex.io/docs/developers/perps-testnet) specifies Hideki 50383, USDso and STT; stop creation has additional native-token payment. Read the current fee from the protocol before any authorized action; do not infer sufficient gas/payment from USDso collateral.

Installed SDK **0.32.1** was inspected directly:

| Interface                                            | Verified scope / consequence                                                                                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perpPoolWriteAbi.placeOrder`                        | Ordinary price/quantity/order-type placement; no explicit reduce-only argument in the exported call used by PerpsHQ. An opposite-side call is not proof of atomic close protection.                                                      |
| Official `placeOrderFor`                             | Delegated counterpart; no verified position reduce-only flag. Source pinned in AGENT-STUDIO-DESIGN.md; no new signature invented.                                                                                                        |
| `reduceOrderFor(owner,orderId,newQuantityRemaining)` | Shrinks a resting order. It does not identify or reduce an open position.                                                                                                                                                                |
| `Trader.placePerpStopOrder`, `PerpStopIntent`        | SDK describes owner-created registry stops with reduceOnly default, optional opening intent and linked TP/SL. This is separate from ordinary pool placement and is not integrated by PerpsHQ.                                            |
| `PerpStopOrderLeg.quantity`                          | Zero means position-at-trigger; fixed nonzero quantities clamp down at trigger. SDK documents current-position, lot and direction checks in registry resolution. Deployment/permission behavior for a real user remains unverified here. |
| `client.previewPerpClosePnl`                         | Read-only estimate with quantity clamping, lot alignment, fees/funding. An estimate is not a write or transaction safety guarantee.                                                                                                      |

Relevant installed source: `src/trade.ts` (PerpStopIntent/PlacePerpStopOrderParams), `src/tradeAbi.ts` (perpStopRegistryWriteAbi), `src/perp/margin.ts` (previewPerpClosePnl). Official owner-native functionality exists; this audit does **not** claim that the entire exchange lacks native protection. PerpsHQ's manual UI and linked worker have not implemented/verified it.

## Concurrency and outage risks

A bot can read a long position, then another order can partially close it before the IOC mines. An old opposite-size sell may over-close/flip. Two watched exits or a manual close can race. Fresh preflight, quantity clipping, nonce serialization and cancellation reduce stale decisions but cannot create contract-level reduce-only semantics. Our operator adapter rejects these exits; the regression verifies rejection before simulation even with the policy enabled.

Paper exits operate only against the matching paper position and never become chain transactions. Guardian's stop/target is a watched reference, not an armed registry order. Worker/network/indexer downtime means no watched exit. Shutdown, emergency acknowledgement and grant revocation neither flatten exposure nor cancel resting orders.

## Required future work

Use separately authorized owner actions through the official app for actual position protection today. Before implementing native protection: verify the specific deployed registry, current ABI, owner/contract-wallet authorization, registry operator grant/payment, trigger direction, live quantity clamp, lot/minimum, fees/refunds, OCO/partial-fill behavior, cancellation and stale-oracle/subscription failure. Add concurrency tests with intervening manual/fill changes and verify real receipts/positions under exact per-action authorization. Do not authorize a normal opposite-side order as a guaranteed reduce-only close, and do not add an unsafe fallback when a native method is unavailable.
