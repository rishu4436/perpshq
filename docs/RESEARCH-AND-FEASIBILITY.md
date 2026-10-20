# Research and feasibility

Research date: 20 October 2026. Runtime probe results are stored separately in `docs/probe-results.json`.

## Confirmed official documentation

- [Perps developers](https://app.testnet.dreamdex.io/docs/developers/perps-testnet): SDK **0.32.1**, Hideki chain **50383**, USDso perpetual collateral. SDK package version exists on npm (verified).
- RPC `https://api.hideki2.infra.testnet.somnia.network`; WebSocket `wss://api.hideki2.infra.testnet.somnia.network/ws`; GraphQL `https://hideki-dev.smk.somnia.host/v1/graphql`.
- Discover pools and their decimals using `listPerpMarkets`; verify collateral with `getPerpSystemConfig`. Do not use the generic spot collateral address.
- `getMaxPerpOrderSize` returns `priceable`, `placeable`, `maxQuantity`, `limitedBy`. Check immediately before signing. `placePerpOrder` is the SDK order method. Raw pool calls can be encoded from the SDK ABI for external EIP-1193 signing.
- [Order rules](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/orders): GTC/IOC/FOK/ALO; a receipt is not fill evidence. A marketable order needs a crossing limit. Native protection requires extra STT and is a separate transaction.
- [Margin](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/margin-and-liquidations): cross margin is default; paper credit restrictions and account exposure caps apply. Liquidation is account-wide and cannot be accurately inferred from a single position.
- [Bot examples](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/perps.md): linked operators cannot withdraw; external wallet flow is preferred here so no key is stored on the server.

## History/data risk

[General REST API](https://app.testnet.dreamdex.io/docs/developers/http-api) targets mainnet 5031 and **Shannon 50312**, not Hideki. Its candles must not be relabeled as Hideki perp candles. Probe the actual perps SDK/indexer history before enabling analysis. No synthetic or external reference history will be displayed as perp history. Indicators are unavailable when completed observations are insufficient. Snapshot polling is not historical trade volume.

## Signing and security

Use a browser-owned EIP-1193 wallet on chain 50383. The API only reads public state and simulates unsigned transactions. It never receives a private key, signs, or broadcasts. A preview binds account, market, side, raw size, raw price and chain; expires quickly; and is refreshed before wallet signing. User confirmation is required for every order/cancellation. No live trade is authorized by the build request.

## Competition

[DoraHacks event](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail) was inaccessible through web retrieval. Deadline 1 November 2026 23:59 UTC, whitelist and social requirements are user-supplied and remain independently unverified. Do not present them as confirmed organizer rules.

## Runtime results and limitations

Actual SDK probes confirmed 21 Hideki perpetual markets, bank/collateral wiring, mark/funding/open-interest reads, 40 levels of BTC resting depth, real fill records, and candles at all six requested intervals. BTC 15m history provided over 280 completed contiguous observations; gaps varied by interval/market and are reported. The source is actual perp fills, not spot or an external reference feed.

The generic staging REST market list returned only spot markets. Explicit `BTC-PERP/candles?interval=1m` returned HTTP 404 `market_not_found`. Production therefore uses the verified SDK/indexer path.

Live API checks also loaded 21 indexed positions and 21 priceable on-chain analytics rows for a pre-existing public testnet market-maker account, plus its bounded order/fill/funding history. These are verification observations, not the user’s account. Empty-account reads returned zero with no errors. Funding history returned 24 actual settlement records, with per-row window normalization.

For an unsigned minimum-size order simulation against that public collateral account, sizing, `eth_call` and gas estimation progressed to the STT check; the preview was blocked because that account lacked gas. The initial attempted positive-preview check is retained in `verification-initial-simulation-attempt.json`. It is not counted as a successful ready-to-sign preview. A separate empty account was rejected by official sizing for collateral. No order was signed or broadcast.

Signed browser-wallet execution, actual cancellation, native stops and native reduce-only position management remain unverified or unsupported as described in SDK-INTEGRATION.md. A real PerpsHQ execution demonstration requires a user-controlled wallet with both STT and eligible perps collateral, plus explicit authorization of the specific transaction. Full historical performance cannot be inferred from bounded samples.
