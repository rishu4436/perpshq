# Testnet evidence

## Current status

**No PerpsHQ-authored signed transaction exists.** No wallet trade has been authorized or submitted during this build. Captured public fill hashes in `probe-results.json` belong to existing network activity and are **not** evidence of PerpsHQ execution. The automated browser tests use obvious mocked hashes and `MOCK-TEST-ORDER`; they are CI fixtures only.

## Verified read-only evidence

`docs/probe-results.json` contains timestamps, observed chain ID 50383, 21 perp market records, actual BTC candles for six intervals, system configuration, resting depth, mark/funding state, recent public fills and an empty account read. `npm test` with `LIVE_TESTS=1` verifies chain identity, discovery, candles, book and an empty account. This requires read-only network access and never signs.

The generic Shannon REST market list contained only spot markets. An explicit `BTC-PERP/candles?interval=1m` request returned 404 `market_not_found`. That REST source is not used by the product.

An unsigned minimum-size order simulation using an existing public collateral account progressed through sizing, RPC simulation and gas estimation, then correctly failed the STT balance guard. This is not a ready-to-sign or signed order. The initial attempted positive check is retained in `verification-initial-simulation-attempt.json`; no authored transaction exists.

## Readiness audit evidence

Use [READINESS-AUDIT.md](READINESS-AUDIT.md) for the current code/tests and timestamped HTTP observations. The historical probe files above remain historical, read-only observations. Mocked preparation/cancellation and browser providers prove code paths only. No separately authorized positive signed order or cancellation exists.

The [exact transaction checklist](TESTNET-TRANSACTION-CHECKLIST.md) covers wallet ownership, STT gas, eligible perps collateral, protocol constraints, exact per-order authorization and recovery. The [genuine evidence folder](testnet-execution/README.md) is prepared with the required report fields and contains no fabricated execution record.

## Obtain genuine execution evidence

1. Open PerpsHQ in an external browser with an authorized EIP-1193 test wallet. Select chain 50383 using the documented Hideki RPC.
2. Fund it with STT for gas and put USDso in that wallet’s perps MarginBank using the official app. Paper credit must allow the selected market. Do not share keys with PerpsHQ.
3. Choose a discovered pool and manually enter your side, type, entry/reference, stop/target planning levels, maximum loss, collateral, leverage assumption and slippage. The user decides the exact order.
4. Validate. Review raw sizing limits, pool/account and estimated gas in the confirmation. If the SDK or simulation blocks it, resolve the stated condition; do not bypass checks.
5. Explicitly authorize that specific testnet order and sign it in the wallet. This is the consequential step and must be done by the user or separately authorized at action time.
6. Inspect the real transaction hash, receipt status, block, decoded events, order ID, indexed state and fill evidence. A success receipt without a fill remains a resting/syncing order.
7. Export evidence JSON. Save it under a named evidence folder after review and attach the hash to its journal entry. If resting, cancellation requires a separate confirmation/signature.

Replace this status only after a real hash and receipt have been captured. Never substitute a mocked provider hash or someone else’s public fill.

## Final integration evidence, 21 October 2026

No genuine authored order/cancellation was added. Unit/browser providers are mocks; worker fills are SIMULATED and the latest native run produced zero fills. Actual live read-only SDK/API probes and unsigned public-account simulation do not confer signing authority. Public active account reads can contain cross-block or ancillary RPC failures; these now explicitly block complete exposure rather than asserting zero. Current JSON probes are timestamped, not always-current prices or trade proof. [Final audit](FINAL-RELEASE-AUDIT.md) records current results and [exit safety](POSITION-EXIT-SAFETY.md) distinguishes native owner stops from unsupported delegated closes.
