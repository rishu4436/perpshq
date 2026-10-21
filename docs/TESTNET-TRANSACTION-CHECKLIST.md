# First authorized testnet transaction

Status: **not executed**. This checklist grants no transaction permission. Automated tests and the HTTP verifier only read or simulate. No private key is required by PerpsHQ.

## Prerequisites

- Use an external browser with a working EIP-1193 wallet extension. The account must be controlled by the user and permitted to place/cancel its own perps orders. A read-only address, managed dreamDEX wallet, or someone else's public account is not signing authority.
- Select **Somnia Hideki, chain 50383**. Verify the chain in both PerpsHQ and the wallet. Use the endpoints in README and the [official developer documentation](https://app.testnet.dreamdex.io/docs/developers/perps-testnet).
- Obtain **STT for network gas** through official testnet channels. There is no verified fixed funding amount: the current requirement is the returned `gas` (including 25% headroom) multiplied by the current returned `gasPrice`, in wei. `estimatedGasSTT` expresses this in STT. Keep enough additional STT for a separate cancellation if needed; its gas must be estimated independently. Validation blocks if the observed balance is insufficient. No claim is made about the user's actual balance.
- Fund the signing account's discovered **perps MarginBank with eligible USDso**, through the official app. Verify market-specific bank and collateral addresses from discovery/system configuration. A wallet token balance alone is not funded perps collateral (`autoPull:false`). Paper credit must permit the selected market. Official sizing must report priceable/placeable and allow the requested raw quantity. Planning collateral/leverage fields do not fund an account or change protocol leverage.
- Pick a currently discovered, supported perp pool. Confirm its decimals, tick, lot and minimum. Do not substitute generic spot/Shannon addresses. Fresh mark, usable book for IOC, protocol availability and successful simulation are required.

## Review and authorize one order

1. Run `npm ci`, `npm run build`, `npm start`. Open `http://127.0.0.1:3000/app` in the external browser. Complete discovery → analysis → Planner. Inspect source timestamps and data warnings.
2. Choose side and order type yourself. Enter risk, collateral, leverage and slippage assumptions. Reference buttons change draft fields only after a click; stop and target are **not armed protection**. Review risk calculations and raw size/increments.
3. Connect the owning wallet; select Hideki. Click **Validate on testnet**. Resolve any blocked condition without bypassing guards. A preview is a 30-second validation lease, not an execution guarantee.
4. Review exact account, pool, chain, quantity, execution price bound and gas. Revalidation preserves approved calldata, including its original order expiry, and rejects any changed material field. A changed preview requires a fresh review. Never blindly retry an unknown result.
5. **The user must now explicitly authorize this specific order**, including account, pool, side, type, price bound and quantity. General permission to build/test this project does not authorize it. Check the order consent box and approve the separately displayed wallet request only after this authorization.
6. Save the real hash. Verify sender/target/calldata, mined receipt status and block, decoded events and order ID, indexed order/fill state and timestamps. `transactionStatus: confirmed` and `state: resting` are compatible; confirmation alone is not a fill.
7. Export evidence JSON; put reviewed genuine records in [testnet-execution](testnet-execution/README.md). Attach the real hash and original context to a journal entry. Record public explorer links and actual position/account observations.

## Cancellation and recovery

- A resting order remains exposed. Cancellation requires another explicit user authorization and wallet confirmation. The account must own an open order with remaining quantity; preview and confirmation both validate it. Cancellation does not reverse an earlier fill. Verify the cancellation receipt and remaining order state.
- EIP-1193 `4001` is a rejected signature and releases the submission intent. Transport errors, timeout, invalid/no hash, or identity changes while signing preserve an **unknown outcome** and lock retries. Switching account or reloading does not erase that intent.
- Use **Positions & Risk → Unresolved wallet request**. Inspect wallet activity to find the real hash, then verify/reconcile it. Recovery requires matching account, pool, exact calldata, Hideki and a mined receipt; unknown-hash recovery also checks transaction time. A reverted matching receipt safely resolves the request but is not a successful order.
- If the request has no provable mined hash, investigate wallet activity/RPC or obtain provider support. Do not clear browser storage to bypass the lock. Cross-device and wallets without Web Locks have no protocol idempotency guarantee.

## Completion evidence

Mark execution verified only after the actual authorized transaction, receipt, order state and any fill/cancellation have been inspected. No signed positive order, cancellation, or external-wallet compatibility session has yet been demonstrated by this audit.
