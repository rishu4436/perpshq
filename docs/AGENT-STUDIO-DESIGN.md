# Agent Studio implementation design

Agent Studio extends the existing MVP on `feature/perpshq-agent-studio`, based on readiness commit `d8f0e95`. PR #1 is still open; this feature depends on its transaction fixes and will be reviewed against the readiness branch. Main is not changed or merged. `docs/ROADMAP.md` did not exist and will be created.

## Boundaries

Signal generation → central risk policy → authorization → unsigned operator preparation → reconciliation are independent modules. Strategies cannot access a signer. Live broadcast is disabled in source, not enabled by an environment variable, config edit or UI toggle. The worker rejects signing secrets. No permission grant, funding, key creation, transaction or deployment is part of implementation/testing.

The existing manual wallet workflow remains separate and unchanged. A real user-owned signed order is still missing; its specific authorization, funded eligible margin, STT and actual receipt/order evidence remain prerequisites for any later supervised canary.

## Modules

- `packages/agent-engine`: strict versioned configurations, four deterministic strategies, explanation records and historical prefix evaluation.
- `packages/agent-risk`: mandatory shared exposure, sizing, loss, freshness, gas/permission, throughput and circuit-breaker checks. Unknown actual P&L is never zero.
- `packages/agent-execution`: official linked-operator ABI/permission reads, unsigned simulation/gas sizing, attribution/reconciliation, durable intent coordination with isolated mock transports only.
- `packages/agent-store`: SQLite configurations, optimistic versions, commands/audit, decisions, paper ledger, heartbeat, fenced durable lease, nonces and unresolved intents.
- `apps/agent-worker`: independent Node process, read-only Hideki observations, command acknowledgement, durable recovery, bounded polling/backoff and safe shutdown.
- `apps/web/src/components/agent-studio`: overview, no-code builder, simulation/decisions, permissions and operations views in the existing Perspective design.
- Loopback API adapter: nonsecret single-user local controls backed by the same SQLite store. Browser state is never represented as a remote Railway control plane.

## Official interface findings

Research pin: official dreamDEX bot kit `25798660bbe4674a6f83a960b202852896e2fed4`, SDK `0.32.1`. Sources: [perps](https://app.testnet.dreamdex.io/docs/developers/perps-testnet), [Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot), [operator implementation](https://github.com/somnia-chain/dreamdex-bot-kit/blob/25798660bbe4674a6f83a960b202852896e2fed4/packages/perp-core/src/operator.ts), [operations](https://github.com/somnia-chain/dreamdex-bot-kit/blob/25798660bbe4674a6f83a960b202852896e2fed4/docs/24-7-operations.md), [Railway](https://github.com/somnia-chain/dreamdex-bot-kit/blob/25798660bbe4674a6f83a960b202852896e2fed4/docs/railway.md).

The installed SDK's minimal perp write ABI does not export delegated `…For` writes. Use the pinned official bot-kit signatures, verify their selectors and parameter suffixes against installed SDK owner-call ABI entries, and use actual `isOperatorAuthorized` pool reads for each action/market. Do not claim absent SDK methods exist. `reduceOrderFor` shrinks a resting order; it does **not** reduce a position. Guardian position reductions are proposals for a separately simulated opposite-side IOC and cannot claim native reduce-only or protective-stop semantics.

Perps are Hideki 50383 with discovered USDso bank/collateral and market decimals. Ignore the bot kit's generic spot/Shannon/mainnet defaults. The documented Railway template is an external bot-kit template, not a deployment of PerpsHQ; the web retrieval tool could not open its page.

## Persistence and safety

One SQLite volume coordinates a worker with a renewable lease and monotonically increasing fencing token. Every result/ledger/cursor commit rechecks lease ownership, configuration version and current pause state after network I/O. Only acknowledged commands change worker state; requested pause, heartbeat timeout and emergency stop are distinct. A stopped worker does not cancel on-chain orders or close positions. Restart restores the ledger/cursor and refuses unresolved execution intents. Multiple independent databases cannot coordinate; this release requires one worker/volume and has no hosted remote-control claim.

The local API keeps Host/Origin restrictions. It exposes no broadcast endpoint and no public worker port. Hosted multi-user control, identity verification and secret management are explicitly not implemented by the local adapter. Dry-run simulation uses its own clearly labelled synthetic cash ledger over validated real observations; no synthetic candles or fabricated live returns.

## Implementation sequence

1. Validate schema, deterministic signals and central risk policy with unit tests.
2. Add conservative paper accounting and chronological history evaluation.
3. Add durable store, commands, leases, recovery and independent worker tests.
4. Verify official permission/operator encoding and unsigned execution with mocks/read-only probes.
5. Add Agent Studio UI and local API; test desktop/mobile workflows and retain MVP regressions.
6. Prepare Docker/Railway, environment schema, operations/security guides and actual verification report.
7. Run locked install, lint, typecheck, unit/integration/worker tests, build, browser tests and optional read-only live checks. Commit in increments and open a review PR; never merge or deploy automatically.
