# Live QA fixes — 10 November 2026

This follows the owner's pasted wallet/configuration and screen audit. No funds were sent to the newly reported test address, and no new trade receipt is claimed.

## Safety fixes

- Wallet account/chain events invalidate reviews immediately. Three-second polling and focus/visibility checks recover providers that omit events. Agent review, save and submit independently query the actual pinned wallet. A late response from an old wallet context or edited configuration cannot restore an active review.
- Data-network labels explicitly describe Hideki data; a separate wallet-network warning and switch action identify a connected wallet on another chain. Changing networks preserves the draft while invalidating approval.
- Hosted configuration saves enforce the discovered market's maximum leverage before writing a revision. The client performs the same check for a readable field error.
- Empty decimal amounts produce required-field errors. Decimal validation no longer throws before field errors can be returned.
- Recent reviews are labelled historical evidence rather than approvals. Reviews from an older saved configuration revision are marked stale.
- Explicit quantities that are not exact lot multiples produce an actionable lot-size error and remain blocked. Calculated risk sizing still rounds downward safely.

## Workspace fixes and improvements

- Journal tag editing preserves typed comma separators while persisting normalized tags.
- Invalid read-only addresses show an inline, accessible Settings error rather than leaking a global banner across screens.
- Watchlist toggle labels reflect add/remove state; chart refresh has an explicit accessible name. The chart watchlist control remains available on mobile.
- Hosted activity is kept in the browser instead of sending the outbox to denied local-worker routes. Existing local storage and exports remain available.
- Chart attribution uses a visible TradingView link instead of the logo's inline font, preserving the strict font policy.
- Trading readiness and account screens link to `/testnet-collateral.html`. The existing flow simulates a one-time claim or an exact 15 USDso approval/deposit. It uses the discovered MetaMask provider. Hideki STT gas and USDso bank collateral are clearly distinguished. Protocol claim rejection remains a possible outcome.
- Recovery Center exposes an account/market-bound transaction-hash inspector. An unrelated account, pool or network is rejected. Inspection does not bypass unresolved-submission reconciliation.
- Portfolio filters loaded equity observations, fills, funding and P&L by range. Its coverage remains explicitly bounded. Fees absent from the loaded payload remain unavailable. Rounded negative zero displays as zero.
- Scanner already had an empty state; a regression now exercises it. Oracle and indexed settlement marks retain their separate source labels, with an explanation that their timestamps and prices can differ.

## Verification

351 unit/integration tests passed, with five optional SDK tests skipped, including exact-lot and invalid-decimal regressions. Type checking, lint and client/server builds passed. Browser checks cover reported steps on desktop and mobile, including both event-driven and polling network changes, all four mocked execution/recovery paths, journal persistence, inline errors and account-bound receipt lookup. The mobile watchlist toggle passed a focused recheck after restoring its visibility. Mocked wallet evidence is not a live testnet transaction.

Breakout and Mean Reversion qualifying entry receipts and a live funded-wallet execution of this updated release remain outstanding. No WalletConnect integration was added.
