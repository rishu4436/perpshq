# Mandatory agent risk controls

`packages/agent-risk` recomputes quantities, prices, notionals and estimated stop/slippage/fee loss from raw units. Optimistic strategy claims cannot bypass policy. Place proposals pass central assessment again during unsigned preflight. Cancellation/resting-order shrinkage use separate action-specific ownership/remaining-quantity checks.

| Control         | Behavior                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Network/market  | Hideki 50383, discovered pool, USDso wiring, actual decimals/tick/lot/minimum. Unknown constraints fail.                                     |
| Data            | Independent observation/account/mark age, valid oracle, completed ordered history and indexer freshness. Stale data pauses.                  |
| Exact sizing    | Decimal/bigint, inward IOC bounds, lot/minimum, raw consistency. Worst-case configured slippage enters sizing.                               |
| Notional/risk   | Proposal and estimated loss fit hard per-order/per-trade caps. Watched stops are not guarantees.                                             |
| Exposure        | Positions and remaining orders plus proposal fit total/per-market caps and count limits.                                                     |
| Margin/leverage | Usable collateral, health, verified account/market leverage; no setting changes. SDK max-size uses no auto-pull.                             |
| Loss            | Known complete session/UTC-day P&L required for increases. Missing actual P&L remains null and blocks. Paper values use its complete ledger. |
| Rate/failure    | Persisted hourly attempts, repeated-failure breaker, action/failure/unknown cooldowns.                                                       |
| Permission      | Actual fresh market-specific grants, explicit reduction/cancel policy, rechecked after asynchronous preflight.                               |
| Gas             | Actual operator STT, estimate with 25% headroom plus reserve. Paper mode does not claim gas verification.                                    |
| Concurrency     | Lease/fence, version/control recheck after I/O, monotonic cursors, unique intent/nonce and one unresolved operator request.                  |
| Recovery        | Unknown outcome, bad DB, lost control/lease, unreliable indexer or unsafe identity blocks/pauses. No blind restart retries.                  |

Reductions are clipped to an observed opposing position. Fresh data, reconciliation, action policy, permissions and gas still apply. They are opposite-side IOC proposals, without native reduce-only guarantees. Actual risk-increasing P&L is incomplete and blocked. No toggle enables signing.

Illustrative defaults: 50 USDso target order, 100 order cap, 150 market/200 total cap, 10 risk budget, 50 session/100 daily loss limits, 1 position/2 orders, 2x planning leverage, 6 attempts/hour, 3 failures, 50 bps slippage, 90-second data age, 0.02 STT reserve, 1.5 health and 300/900-second action/failure cooldowns. These are editable examples, not recommendations.

## Circuit breakers and emergency behavior

Queued pause differs from worker acknowledgement. Pending pause/stop/emergency prevents commits even before acknowledgement. Heartbeat expiry marks an active agent disconnected, not safely stopped on-chain. Emergency is latched and cannot be cleared by ordinary edits/resume. Pausing/shutdown do not cancel resting orders, flatten positions or revoke grants. Owners inspect actual state and separately authorize official account actions.

## Gates before canary

No genuine PerpsHQ-authored signed trade has been verified. Mocks/public-wallet evidence cannot substitute. Verify Somnia Account ownership/eligibility, complete loss accounting, operator grants/STT, current size/simulation and separately approved signer/nonce/reconciliation behavior. Explicit authorization identifies account, market, side, quantity, bound and action. Resolve nonatomic reduction limits. Never use an environment flag or main wallet key to enable unattended mode.
