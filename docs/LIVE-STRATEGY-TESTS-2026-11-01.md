# Connected-wallet strategy tests — 1 November 2026

All changes remain local. No GitHub push or deployment was made. These are actual Hideki chain 50383 transactions from owner `0xd2e173c9d10952a7c5d903f1bff64a7e85b18145`. Autonomous broadcasting remains disabled.

## Verified execution

| Strategy/path                                        | Result                                                                                                             | Evidence                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Trend owner-wallet entry (30 October)                | Filled 0.00013 BTC short at 78,112.70 USDso                                                                        | `0xada1934cdd648fa55feb93310c3b7786dbb36c083873ca8bc5870ddc8b2e1850`, block 36819829 |
| Supervised cleanup of that short                     | Filled equal-size buy at 78,221.00; account verified flat afterward                                                | `0xcbb792ec5f03619645cc1edef7d43df1c6cf3db0b4c0bfca4c03d7ebe777a8fb`, block 36936139 |
| Guarded supervised cleanup of a subsequent extra buy | Filled sell; a repeat real-RPC preview was blocked because the position was already flat                           | `0x62773dec262f192abbf4133fd5022db06a3143db5ff0fd1d506fbde27d9d97dc`                 |
| Guardian cancellation setup (1 November)             | Manual setup: 0.00015 BTC GTC buy at 70,000, verified resting with no position opened                              | `0x31b4437603390ea18511f54cdee126dfc48f9068d9a6f433ad3ac125c3d31cf4`                 |
| Guardian owner-wallet cancellation                   | Strategy produced CANCEL_CANDIDATE, exact owned order cancelled; receipt success and decoded cancellation verified | `0x6fe8b1a9b192a41201ce4fe7facaa1886c5e7a3651ecdf153ae99491860812bd`, block 38569908 |

Guardian used an explicitly configured zero-open-order cap with resting cancellations enabled. The cancelled order was `15200117116736679756188`. The setup transaction is not counted as a Guardian entry; Guardian never seeks entries. Fresh post-cancellation bank/open-order reads show no positions, no open orders and no account errors.

Raw strategy tickets and receipts are in ignored local directory `data/owner-strategy-evidence/`. Current setup and post-cancellation snapshots are in `data/live-strategy-review/guardian-setup-account-2026-11-01.json` and `guardian-after-cancel-2026-11-01.json`. These contain actual chain evidence, separate from automated mocks.

## Fixes verified during live testing

- Discover MetaMask through EIP-6963, independently of a competing Binance Wallet legacy injection. Account/network events, connection, switching and signing use the selected provider. Delayed responses from an old provider cannot overwrite the current account state.
- Cancellation previews now include the raw gas estimate needed to preserve the approved fee ceiling when refreshed estimates still fit with headroom. Higher fee prices/budgets still require a new review.
- Earlier live fixes preserve exact price/quantity/calldata while revalidating risk, serialize BigInt receipts correctly, recover cancelled/late wallet requests and retain unknown outcomes conservatively.
- The supervised close-only option requires the opposite IOC for the exact current full position, and pins its position fingerprint across review. Repeating the close while flat fails before signing. This is not native atomic reduce-only protection.

## Still outstanding

Breakout and Mean Reversion do not yet have verified live entry receipts. Current scans retain default indicator conditions, real completed candles, freshness and risk gates. NO_ACTION, stale data and insufficient history are not counted as executed trades. Read-only scan evidence is in `data/live-strategy-review/signal-scan-2026-11-01.json`.

The completed broad scan evaluated 100 market/timeframe configurations (10 markets × 5 timeframes × 2 strategies): 44 NO_ACTION, 32 DATA_UNAVAILABLE and 24 PAUSE_REQUIRED. No entry was eligible. A subsequent bounded check made 24 more BTC 1m/ETH 5m observations over current candle closes; all returned NO_ACTION. These observations are saved separately in `fresh-candle-checks-2026-11-01.json`. No entry thresholds or risk limits were loosened to manufacture transactions.

Guardian was reviewed again after cancellation and returned NO_ACTION with no remaining position/order to act on. Its post-cancellation result is in `guardian-after-review-2026-11-01.json`.

Validation: 321 unit/integration tests passed, five optional SDK checks skipped; lint, TypeScript and the production build passed. Eight focused desktop/mobile owner execution and competing-provider browser checks passed. The complete desktop/mobile suite then passed 77 checks with nine optional/live/desktop-only checks skipped.

Final live account evidence is `data/live-strategy-review/final-account-2026-11-01.json`: no positions, no open orders, no account errors. The durable owner-strategy database has zero unresolved requests. PerpsHQ remains running locally for review.

Guardian's cancellation path is verified. Its native atomic reduce-only position-exit path remains unsupported. The autonomous worker was not enabled, and these transactions do not establish strategy profitability.
