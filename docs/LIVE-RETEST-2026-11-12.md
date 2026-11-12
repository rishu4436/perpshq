# Live wallet retest — 12 November 2026

## Actual testnet evidence

The user reported completing the manual entry, full close, resting-order cancellation and Guardian cancellation tests. A fresh production account read at block 48088227 independently confirmed zero active positions, zero authoritative on-chain open orders, complete exposure and no account errors. Equity/unlocked collateral was 14.997797495104596718 USDso (displayed as $15.00), and gas balance was 49.890139892 STT. The user reported no unresolved wallet requests. Full manual open/close hashes were subsequently recovered from public account history by their unique reported prefix/suffix and independently checked; the ordinary resting-order/cancellation abbreviations remain user-reported.

Owner: `0xd2e173c9d10952a7c5d903f1bff64a7e85b18145`. Network: Hideki 50383. BTC pool: `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`.

Independently checked through the production receipt verifier:

- Manual open: `0x69c12dbb40ad8f22b76e6e65376e9c38a12c4d880e30c6a9581b5de23625f7cd`, successful block `48053845`, filled.
- Manual close: `0x4173e964bd68d094ab6a47d418a830a3a71d046c97fc0386deb6bf2af40a60ba`, successful block `48055457`, filled.

- Guardian test placement: `0xfed80367f639bb61920ef710f27b686b080e4d9fe4a63fb749344872bb9c0991`, successful block `48063158`; current attributable order state is cancelled.
- Guardian cancellation: `0x113c8606f147485851e8c93b5aa50586ef5efa4ad6e44727ee7312affdff3716`, successful block `48065728`, state cancelled.
- Reported order ID: `8983564363896563290257`, resting buy of 0.00013 BTC at 70,562.40 USDso. The user reported CANCEL_CANDIDATE under an intentional zero-order cap and NO_ACTION once flat. They restored the cap and cancellation permission afterward.

No transactions were broadcast by the coding agent during this follow-up.

## Regression fixes

- Chain polling is independent of account polling. A stalled eth_accounts request cannot prevent eth_chainId reads. Chain errors/timeouts invalidate the displayed network rather than leaving Hideki confirmed indefinitely. Focus/visibility, provider events and periodic polling remain active; Refresh wallet network explicitly reads the pinned provider. Connected provider identity is pinned and addresses are compared canonically.
- A valid returned transaction hash is retained as a known submission even if wallet identity changes while the wallet prompt is open. Receipt reconciliation still uses the original account, pool, calldata and chain; no identity change releases a pending lock.
- Expiry is checked before and after live strategy revalidation and immediately before dispatch. A request already sent to MetaMask is labelled pending; the app does not claim that its timer cancels an external wallet prompt. Known pre-dispatch blocks release their durable registration separately from ambiguous broadcasts.
- Close-only consent is local to the current Planner visit rather than inherited from a persisted draft.
- Newly loaded wallet configurations have strategy/market/timeframe names; saved options also expose market, timeframe, revision and an ID suffix. Existing custom names are preserved.
- Review-history responses merge by decision ID instead of replacing newer client history with an earlier server response.
- A policy-gated direct collateral claim stops before signing, clearly explains the protocol restriction and directs the user to wallet-USDso deposit or official dreamDEX funding instructions. The app cannot remove the deployed contract gate.

## Submission limits

### Follow-up network retest

The user subsequently confirmed automatic Ethereum detection within a few seconds, the wrong-network warning and disabled Load/Save/Review controls in real MetaMask. The owner draft survived switch-back and a fresh NO_ACTION review completed. No transactions were sent. Receipt reconciliation staying enabled is intentional: it reads Hideki receipts rather than requesting a wallet signature.

Two presentation regressions remained: the current review was removed rather than retained as stale, and switching back jumped to the top. The current follow-up preserves the review evidence with an explicit stale label and disabled approval controls, retaining invalidation after return to Hideki until a fresh review. Account changes still clear the previous owner's visible snapshot. Scroll restoration now runs after the chain-dependent React layout commits instead of only at wallet-request completion. Regression coverage includes completed NO_ACTION evidence, an executable stale snapshot, and a delayed switch request with populated/expanded review evidence. These two changes still need the user's real MetaMask retest after deployment.

The 12 November run did not execute Trend, Breakout or Mean Reversion because no genuine entry qualified. Earlier historical Trend evidence remains historical evidence, not proof that this run completed all strategies. Strategy rejection and pending-request recovery were not exercised live in this run.

The release remains conditional on a real MetaMask network-switch retest and qualifying strategy execution/recovery evidence. Automated browser fixtures are labelled as automated tests, not real trades. Do not claim all four strategy executions passed.

## Automated validation

360 unit/integration checks passed with five optional SDK skips. TypeScript, lint and production builds passed. The broad desktop/mobile browser run passed 64 checks; two new naming/history cases initially had an ambiguous test selector, which was corrected. A focused eight-case desktop/mobile rerun passed, covering both corrected cases and the final Planner/template changes. Two additional collateral-policy browser cases passed, bringing distinct verified browser cases to 68 across the runs. Network fallback with a stalled account read, switch-back preservation and pending-wallet expiry behaviour passed on desktop and mobile.

For the subsequent stale-review/scroll follow-up, all 30 hosted-execution/provider browser checks passed on desktop and mobile. This includes the revised retained-NO_ACTION expectation, stale executable approval lock after switch-back, delayed provider completion with expanded review evidence, unchanged document/route/draft, and scroll delta below 150 pixels from a starting position beyond 200 pixels. All four execution/recovery paths in this browser suite use explicitly mocked receipts.
