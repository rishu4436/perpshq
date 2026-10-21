# PerpsHQ roadmap — 21 October 2026

**P0 remains the trustworthy manual MVP and a specifically authorized real Hideki order. Agent Studio dry run is implemented on this integration branch; live automation and cloud uptime remain unverified/disabled.**

## P0 — Finish the existing MVP

- Preserve and re-test stale-data scenarios, independent market/margin alerts, cockpit-to-planner context, journal provenance and chart zoom/pan fixes from readiness PR #1.
- Preserve exact review-to-wallet consistency and unknown-submission recovery; complete every safe order/cancellation test.
- Obtain a separately and specifically approved user-owned/funded Hideki (50383) perp order and verify actual receipt, order and fill state. No simulation/public-wallet activity substitutes for authored evidence.
- Deliver accurate reviewer access, demo and submission evidence. Do not merge, deploy, post or submit automatically.

## P1 — One-destination risk integrity

Verify complete owner exposure using authoritative open orders/active positions, fail closed for incomplete account/history and retain actual collateral/gas/protocol sizing checks. Investigate safe position exits without mislabelling opposite-side IOC as reduce-only. See FINAL-RELEASE-AUDIT.md and POSITION-EXIT-SAFETY.md.

## P2 — Agent Studio stages

**Stage A — Implemented dry run:** Four deterministic strategies, versioned builder, mandatory risk, actual-observation paper ledger/history and independent durable worker. See AGENT-STUDIO.md and BUILD-PROGRESS.md. No signer or on-chain writes.

**Stage B — Future permissioned testnet orders:** Dedicated operator linked to a user's Somnia Account, per-market grants, separate STT, verified ABI and explicit loss/exposure/rate/freshness/health policy. Owner holds margin; inability to withdraw does not prevent trading losses. reduceOrderFor shrinks resting orders, not positions. Linked bots cannot arm native protective stops. Actual loss accounting and separately reviewed signer/canary remain required.

**Stage C — Prepared, not deployed runner:** Separate Node worker, Docker/Railway files, volume/lease/heartbeat/recovery. Perps target Hideki 50383, not spot defaults. PerpsHQ's actual AGENT_* schema accepts no signing secret; official bot-kit STRATEGY/OWNER_ADDRESS/PRIVATE_KEY examples are not this release's variables. Public remote control requires authenticated ownership, durable commands/acks, replay protection and secret isolation first.

**Stage D — Verification:** Real dry-run startup/restart/outage/pause/duplicate tests; container testing when an engine is available; separately approved supervised canary only after manual proof and safety gates. No environment flag enables unattended execution.

**Hosting clarification:** Official dreamDEX examples route always-on bots to external services such as Railway; they do not establish exchange-hosted workers. Reactivity is not a general off-chain strategy host. One shared volume/replica, monitoring, backups and actual observed uptime are required before a cloud reliability claim.

## References

- [Perps developer docs](https://app.testnet.dreamdex.io/docs/developers/perps-testnet)
- [Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot)
- [Official perps examples](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/perps.md)
- [24/7 operations](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/24-7-operations.md)
- [Railway deployment](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/railway.md)
