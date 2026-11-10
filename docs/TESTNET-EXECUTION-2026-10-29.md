# Hideki testnet execution — 29 October 2026

Real browser-wallet transactions on chain 50383. Changes remain local.

## Verified result

- Account: `0xd2e173c9d10952a7c5d903f1bff64a7e85b18145`.
- BTC pool: `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`.
- Exact 15 USDso approval: `0xf31fef358c90b9f3d93985b7d50fb74424bf6c20cc5527dcbb2ed27463d4264b`, successful at block 36039285.
- 15 USDso deposit: `0xaa48abaa472d5fd1b7d1e9952c48a267d309f17de2c2318655a04feb079d9aa9`, successful at block 36041139.
- Minimum BTC IOC buy: `0x9c6415e10a238db0b353f9d2185bfb0ede64429fc1ec72056ff33276e0c39449`, successful at block 36049416.
- Order ID: `16749643618928281544924`.
- The pool's `OrderFilled` log proves all 13000 raw units (0.00013 BTC) filled at 79,984.30 USDso, below the reviewed 80,400 execution ceiling. Remaining quantity: zero.
- Actual transaction gas: 3,099,965 units at 6 gwei, or 0.01859979 testnet STT.
- A subsequent direct bank snapshot confirms size 13000, average entry 79,984.30, healthy account margin, and no resting orders.

The long was subsequently closed in the supervised test below. Stop and target references were planning notes; no protective orders were armed. The planning leverage field did not change the bank's leverage or margin configuration.

## Verified closing test

- Closing IOC sell: `0x39c2790a6a7919696c61a05933b0e1e2a7a5d8690095337642bcd48c48732eb5`.
- Successful receipt at block 36222436, order ID `21582690566240184116636`.
- `OrderFilled` proves 13000 raw BTC units sold at 80,197.60 USDso with zero quantity remaining.
- The bank snapshot at block 36222578 confirms no active pools, no positions, no open orders and zero initial/maintenance/close-out margin requirement.
- Remaining bank equity/collateral: 15.021142619291658596 USDso; status Healthy.
- This was an explicitly authorized, supervised equal-size opposite IOC. It does not establish atomic reduce-only support or enable autonomous agent exits.

## Claim diagnosis and funding

Direct `claim()` simulation reverts with selector `0x3e31dcc2`. The deployed implementation's additional claim-policy gate rejects direct claims even though SDK eligibility reports eligible. No successful voucher claim is claimed here, and the protocol policy was not modified. Existing wallet USDso was approved for exactly 15 USDso and deposited into the discovered perpetual margin bank instead.

The local funding utility simulates transactions, checks chain/account/balance, requires explicit review, saves unresolved wallet intents before dispatch, and matches receipt sender, destination, calldata and value before clearing them. It never holds a signing key.

## Bugs exposed by this execution

1. Order revalidation rejected lower gas estimates as changed order parameters. Refreshed gas limits, gas prices and displayed fee estimates may now decrease; increases and changes to order calldata, identity, size, price or type still require another review.
2. The open-position list could show an empty indexed result after an actual fill. It now uses positions read from the margin bank at the same block as margin and analytics. Market-address matching ignores checksum casing. Historical realized P&L unavailable from that read remains unknown.

Receipt and fill verification are independent of the indexer. Indexed order/fill history may still lag.

## Validation

- Full unit/integration run: 292 passed, 5 optional live tests skipped. The two subsequently added snapshot/exposure regression cases also passed in the focused 20-test run.
- Production build, TypeScript checks, lint, formatting and diff whitespace checks passed.
- Desktop/mobile browser suite: 67 passed, 9 optional tests skipped, 2 Agent Studio loading assertions timed out at five seconds. Both failed cases passed unchanged in a serial rerun (2 passed).
- The connected Edge wallet's actual position screen shows one BTC long, quantity 0.000130 and entry 79,984.30. Funding and trade receipts were checked separately from these automated fixtures.
