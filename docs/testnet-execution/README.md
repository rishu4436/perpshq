# Genuine execution evidence

No PerpsHQ-authored execution evidence is present. This folder contains instructions only. CI mock hashes and captured third-party fills must never be copied here as PerpsHQ trades.

After the [transaction checklist](../TESTNET-TRANSACTION-CHECKLIST.md) is completed with specific user approval, create a dated subfolder named from the actual transaction hash. Retain the exported evidence JSON and a short human-reviewed report containing:

| Field                 | Required observation                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Authorization         | When and what exact order/cancellation the user approved; no private keys or seed phrases   |
| Identity              | Actual wallet, Hideki chain 50383, symbol and discovered pool                               |
| Submitted transaction | Actual hash, exact calldata, value and explorer link                                        |
| Receipt               | Success/revert, block number, gas used and mined timestamp                                  |
| Lifecycle             | Decoded events, order ID if available, resting/partial/filled/cancelled/reverted state      |
| Synchronization       | Indexer available/not-observed/unavailable, check timestamp, later reconciliation if needed |
| Account               | Observed position and margin state after the transaction, with timestamp                    |
| Planning provenance   | Original journal context, chosen draft references and actual submitted parameters           |
| Outcome               | What the evidence proves and what remains unknown                                           |

Do not invent missing fields. A resting order can be valid execution evidence without any fill. Store any separately approved cancellation under its own real hash and link it to the original order. Avoid retaining unrelated private browser/wallet information in screenshots.
