# SDK integration and reproduction

Pinned dependency: `@somnia-chain/markets-sdk@0.32.1`. The installed source and exported types were inspected, then read-only runtime probes were run against chain 50383. See `probe-results.json` for captured responses and `RESEARCH-AND-FEASIBILITY.md` for official links.

## Verified reads

- `listPerpMarkets`: 21 actual perpetual markets at the initial probe, including BTC, ETH, SOL and NEAR. Runtime discovery remains authoritative.
- `getPerpSystemConfig`: discovered MarginBank is fully wired and returns the same USDso collateral as the market rows.
- `getCandles(pool, seconds, {market, limit})`: actual perp fill candles returned for 60, 300, 900, 3600, 14400 and 86400 seconds. History length and gaps vary.
- `getSpotOrderBook`: despite its name, this reads the shared OrderBook core used by PerpPool; the SDK’s own unified perp book implementation calls it. These are resting levels, not guaranteed fillable liquidity. Crossed snapshots are possible.
- `getPerpState`: mark validity, oracle index timestamp, open interest and funding state.
- `getFills`: scoped actual fills, with transaction references.
- `getMarginAccount`: official account-wide equity, unlocked/locked collateral, initial/maintenance requirements and health. The all-zero test account was read without signing.
- Indexed position/order/fill/change reads and same-block analytics were verified against an existing public active testnet account. This does not verify user-owned signing.

Market table marks are indexed settlement observations, visibly distinguished from the cockpit’s current on-chain mark. Funding fractions are normalized using each pool’s actual `fundingWindowSec`, shown as an hourly equivalent, never assumed to be per hour at source.

## Exact transaction construction

The adapter imports the official `perpPoolWriteAbi`; no guessed function signature is used. Order arguments mirror the installed SDK’s `perpOrderCall` implementation: side, user tag, raw quote price, raw base quantity, expiry in nanoseconds, order type, self-match behavior, zero builder address and zero builder fee. GTC uses type 0, IOC uses type 2. No builder fee is requested.

Limit prices must exactly align to the discovered raw tick. Quantities are rounded down to the raw lot with Decimal.js and validated against the minimum. Marketable orders use the user’s reference price and slippage to form a bounded crossing limit, rounded inward to a valid tick. A visible opposite side is required, followed by simulation; the book can still change before confirmation.

`getMaxPerpOrderSize` is checked with `autoPull:false`, so the preview sizes against perps account funding. The user’s planning leverage does not mutate their account leverage. The protocol’s actual account setting is enforced by its sizing/simulation. Every preview calls the RPC for its chain ID and verifies the bank’s collateral wiring.

The API performs `eth_call`, estimates gas, adds 25% gas headroom, and checks STT balance. The wallet controls signing and broadcasts through its configured Hideki provider. Preview validity is 30 seconds; signing refreshes validation. There is no private-key setup.

## Reconciliation

Receipt lookup verifies sender and target pool, decodes official lifecycle events and queries the indexed order. Resting, partial, filled, cancelled, reverted and indexer-syncing states remain distinct. Native cancellation has its own preview and confirmation. RPC failures preserve an unresolved submission instead of assuming nothing was sent. Use Positions & Risk to reconcile a known hash or recover a missing hash from wallet activity.

## Not yet verified / unsupported

No signed transaction has been submitted for this build. A real funded external wallet and the user’s per-order authorization are required. App-managed dreamDEX wallet sessions and linked-bot signing are not integrated. Native TP/SL, leverage changes, margin funding, reduce-only position close and linked-operator flows are not exposed. Use the official app for these actions until supported APIs and wallet permissions have been implemented and validated.
