# PerpsHQ Agent Studio

Agent Studio adds configurable, explainable strategies to the existing workspace. Open `/app#Agent%20Studio`. This release implements local dry run and assisted observation; **there is no Agent Studio signing or broadcast endpoint**. It does not establish a profitable strategy, an authored testnet trade, cloud deployment or 24/7 uptime.

## Start a local simulation

1. Run `npm ci` and `npm run dev` with Node 24 (the container and CI use 24).
2. Open Agent Studio and select **Create agent**. Choose a discovered perpetual market and one of four strategies. Dry run is default. No wallet is needed.
3. Configure signals, risk limits, execution bounds and simulation costs. Validate and save. Saving creates a versioned configuration, not a running agent.
4. In a separate terminal in the repository, run `npm run agent:check`, then `npm run agent:worker`. API and worker must share `AGENT_STORE_PATH` (default `data/agent-studio.sqlite`). No signing secrets are accepted.
5. Select **Start dry run**. The UI first shows a pending request. The worker acknowledges it and begins evaluating actual Hideki observations. An offline worker cannot acknowledge a pause.
6. Inspect Decisions for timestamps, matched/failed rules, exact proposed sizing, risk checks and rationale. Simulation shows only stored paper outcomes and clearly labelled historical results.
7. Pause before editing. An agent with paper exposure cannot be edited: create a new configuration to avoid reinterpreting positions. Emergency stop is latched; it preserves exposure and cannot be resumed or edited into activation.

For a custom database in PowerShell, set `$env:AGENT_STORE_PATH='data/my-agents.sqlite'` in **both** terminals before starting. Protect public addresses and strategy metadata with filesystem permissions, even though they are not signing secrets.

## Implemented modes

| Mode               | Current behavior                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRY_RUN            | Actual read-only observations; separate simulated cash, orders, positions, fees, funding and drawdown. No key or transaction.                                                       |
| ASSISTED           | Public owner/operator addresses, actual account/permission observations, proposals and unsigned preflight API. Signing remains locked. Incomplete actual P&L blocks risk increases. |
| AUTONOMOUS_TESTNET | Future mode represented in the schema, but activation rejected in source/store/worker/UI. Environment variables cannot enable it.                                                   |

For assisted observation, save public owner/operator addresses and start observation. A preview is not transaction authorization. Current bounded account history is insufficient for reliable session/daily P&L; these remain null and block increases rather than becoming zero.

## Dashboard and controls

Overview shows configured/dry-run counts, observed health/heartbeat, status, market, strategy, limits, last evaluation/decision, public owner/operator, observed STT/permissions, paper resting orders and explicit absence of authored on-chain orders. Running-on-chain remains zero. Configured, simulating, awaiting authorization, disconnected, paused and emergency stopped are distinct.

Decisions include provenance and central policy results. Simulation uses stored paper fills (no explorer links), costs and recorded equity points; a curve requires at least two observations. Historical evaluation uses up to 500 actual available candles and separate chronological partitions. Thin data can yield no fills or unavailable statistics.

Permissions guides public-address onboarding and actual market-specific reads. Owners must use a Somnia Account and link a separately created dedicated operator through the official app. Legacy wallets cannot use the documented flow. Generic contract code is not proof of Somnia Account ownership. Grants are per market. Revocation does not cancel resting orders, and bots cannot arm native protective stops. Position reductions are separate opposite-side IOC proposals, without atomic reduce-only guarantees.

Deployment exports a validated nonsecret configuration and actual environment names. It does not deploy or remotely control Railway. UI commands affect only the local worker sharing its SQLite file. Evidence export separates paper fills, isolated MOCK intents and the empty real-transaction set.

## Guides

- [Architecture](AGENT-STUDIO-ARCHITECTURE.md), [design/research](AGENT-STUDIO-DESIGN.md)
- [Strategies](AGENT-STRATEGIES.md), [risk controls](AGENT-RISK-CONTROLS.md)
- [Testing](AGENT-TESTING.md), [operations](AGENT-OPERATIONS.md)
- [Railway preparation](AGENT-RAILWAY-DEPLOYMENT.md), [release report](AGENT-STUDIO-REPORT.md)
