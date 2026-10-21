# PerpsHQ

Source: [rishu4436/perpshq](https://github.com/rishu4436/perpshq).

**Discover. Analyze. Plan. Trade. Improve.**

A connected dreamDEX perpetual market intelligence workspace for **Somnia Hideki testnet, chain 50383**. Built with real perpetual data, deterministic analysis, decimal-safe planning and user-controlled wallet signing.

This is a substantial working local application, **not a completed or verified trading release**. No PerpsHQ-authored signed testnet order exists yet. Native position reductions/protective orders and app-managed wallet integration remain unsupported. See the [build progress](docs/BUILD-PROGRESS.md) for precise status.

## Run locally

Requirements: Node **22.13+** (tested on **24.18**), npm, and network access to the Hideki HTTP RPC, WebSocket RPC and indexer. No keys, paid API account or .env file is required.

```powershell
cd 'D:\New folder\perpshq'
npm ci
npm run dev
```

Open the [PerpsHQ homepage](http://127.0.0.1:3000), then select **Launch app** for the [trading workspace](http://127.0.0.1:3000/app). The homepage includes a live market preview, interactive workflow, source disclosures and FAQs. Both views share the dark charcoal and lime identity, bundled fonts and responsive layouts. For a production bundle:

```powershell
npm run build
npm start
```

Use a normal browser with an injected EIP-1193 wallet when testing signing. The Codex preview may not have a wallet extension. To choose a port in PowerShell, set `$env:PORT='3001'` before starting. The API intentionally accepts only loopback Host/Origin. It is not configured for public deployment. Restart the server after backend changes; Vite handles frontend changes.

## What is implemented

- **Product website:** a full landing page at `/`, a CSS/SVG orbital hero with actual market observations, interactive live chart/discovery/planning preview, keyboard-accessible workflow tabs and FAQs. Preview links preserve the selected market into `/app`.
- **Command Center:** live discovered perp universe, actual candle chart, public market overview, watchlists and account entry point.
- **Opportunity Scanner:** search, sort, watchlist filter, six technical presets, timeframe selection, actual bucket-derived 24h stats, indicators and transparent scoring. Configurable weights persist in Settings.
- **Market Intelligence:** zoom/pan/crosshair candlesticks, volume, EMA/Bollinger overlays, confirmed pivot zones, structure, multi-timeframe assessment, momentum/volatility values, book depth estimates and funding context. Stale/missing history is explicit.
- **Explainable analysis:** fact-derived summaries, conditional scenarios, evidence coverage and a deterministic Ask PerpsHQ assistant. No LLM credential needed.
- **Historical context:** exploratory EMA crossover outcomes with next-bar entry, explicit cost/horizon assumptions and chronological exploration/holdout partitions. No predictive-edge claims.
- **Trade Planner:** manual inputs, exact decimals, tick/lot/minimum checks, risk sizing, estimated loss/reward, margin assumptions, save-to-journal and user-owned signing flow.
- **Execution integration:** official SDK ABI, `getMaxPerpOrderSize`, system/chain checks, unsigned transaction simulation, gas estimation, consent, EIP-1193 wallet request, receipt/event/order reconciliation and native order cancellation. Signed execution and cancellation are implemented but **not verified on-chain**.
- **Positions & Risk:** official margin health, indexed positions/orders, same-block live analytics, funding owed, alerts, transaction reconciliation and unknown-submission recovery.
- **Portfolio:** actual fill/change/funding records, bounded accounting and an observed equity series. Missing lifetime statistics stay unavailable.
- **Journal:** saved plans, thesis, tags, emotional context, review, transaction attachment and JSON export. Personal records persist in the browser.
- **Arena & Help:** personal preparation checklist, evidence counts, official Arena link, RPC/indexer diagnostics and source/limitation explanations.

## Agent Studio

Agent Studio adds four configurable strategies, mandatory risk checks, conservative paper accounting, historical evaluation and an independent durable worker. Open `/app#Agent%20Studio`, create/validate an agent, run `npm run agent:worker` separately and request dry run. Saving alone never starts an agent. No wallet or private key is required or accepted by the worker.

The dashboard includes explanations, recorded paper outcomes, actual permission reads, worker acknowledgements and nonsecret Railway exports. **Agent broadcasts and autonomous activation remain disabled in source.** Assisted mode is unsigned observation/preflight. Control is local SQLite; there is no authenticated Railway connection or remote kill switch. Docker/Railway files are prepared, but container verification is blocked by the unavailable Docker engine and nothing is deployed.

Read the [guide](docs/AGENT-STUDIO.md), [architecture](docs/AGENT-STUDIO-ARCHITECTURE.md), [risk controls](docs/AGENT-RISK-CONTROLS.md), [operations](docs/AGENT-OPERATIONS.md) and [release report](docs/AGENT-STUDIO-REPORT.md). Genuine keyless worker startup/pause/duplicate/restart evidence is [recorded here](docs/agent-worker-verification.json). Simulated fills are never signed testnet evidence.

## Verify

```powershell
npm run lint
npm test
npm run build
npm run test:e2e
```

Windows browser tests use the installed Microsoft Edge; other platforms use Playwright Chromium (`npx playwright install chromium`). Automated wallet tests use mocked providers and never send a chain transaction.

Read-only live unit/integration checks:

```powershell
$env:LIVE_TESTS='1'
npm test
```

Capture fresh SDK research responses with `npm run probe`. With a running local server, run the HTTP verification script:

```powershell
$env:PERPSHQ_TEST_URL='http://127.0.0.1:3000'
node node_modules/tsx/dist/cli.mjs scripts/verify-live.ts
```

For live browser smoke tests and screenshots, use `LIVE_TESTS=1` with `npm run test:e2e`; `PERPSHQ_TEST_URL` can target an already running production server. Outputs go to `docs/screenshots/`. Live checks remain read-only.

Captured evidence: [initial SDK probes](docs/probe-results.json), [API checks](docs/verification-results.json), [methodology](docs/INDICATOR-METHODOLOGY.md), and [testnet execution status](docs/TESTNET-EVIDENCE.md). These files are observations at their timestamps, not a source of live product prices.

## Website preview

The homepage at `/` introduces the product; the complete application is at `/app`. Direct preview links can pass a market ID and destination, for example `/app?market=<pool-address>#Trade%20Planner`. This handoff changes only the selected market.

The **Perspective** design system now carries through all ten workspace screens: a custom framing-corner logo, numbered navigation, a connected Discover → Analyze → Plan → Monitor → Review workflow, larger data and form text, and consistent controls. See [design refinements and screen gallery](docs/DESIGN-REFINEMENTS.md).

Current screenshots: [desktop landing page](docs/screenshots/landing-desktop.png), [mobile landing page](docs/screenshots/landing-mobile.png), [desktop workspace](docs/screenshots/live-desktop.png) and [mobile workspace](docs/screenshots/live-mobile.png). These are captures of the actual local product. The source data reflects the capture time.

## Connect to dreamDEX testnet

| Setting      | Value                                               |
| ------------ | --------------------------------------------------- |
| Network      | Somnia Hideki testnet                               |
| Chain ID     | 50383                                               |
| RPC          | `https://api.hideki2.infra.testnet.somnia.network`  |
| WebSocket    | `wss://api.hideki2.infra.testnet.somnia.network/ws` |
| Indexer      | `https://hideki-dev.smk.somnia.host/v1/graphql`     |
| Gas / margin | STT / USDso                                         |
| SDK          | `@somnia-chain/markets-sdk@0.32.1`                  |

The app discovers market pools, collateral and decimals. It does not use Shannon spot REST candles as perps. The generic staging REST request for BTC-PERP returned `market_not_found`; actual Hideki perp candles are retrieved through the SDK indexer instead.

For public account inspection, enter an address in Settings. For signing, connect the external wallet owning the perps account. Fund STT and perps collateral through the [official testnet app](https://app.testnet.dreamdex.io); a managed dreamDEX account is not automatically the same account as an external wallet. Paper USDso only permits selected markets. Never paste keys or seed phrases into this app.

## Authorize a testnet order

Select a market, manually enter the order/risk assumptions, and click **Validate on testnet**. Resolve any BLOCKED state. Review the account, pool, chain, quantity, execution bound and gas. Check the authorization box and confirm the specific order in the wallet. The planner does **not** arm the stop or target and does **not** change your account leverage.

After submission, use the actual receipt, decoded events and indexed order state to verify what happened. A successful receipt is not proof of a fill. Export the evidence and attach it to a journal entry. Unknown wallet responses lock retries until reconciliation. Cancellation is a separate, explicitly confirmed transaction.

**Transaction evidence currently available:** read-only discovery and existing public network activity only. No authored order hash, approved trade, public deployment, repository publication or social post has been fabricated.

## Persistence and security

The API has no signer or broadcast endpoint. Personal records live in browser localStorage; public snapshots and verified receipts use SQLite in ignored `data/`. This is single-device persistence. Export important records. No cloud synchronization or authenticated multi-user write API is provided.

Read [SECURITY](docs/SECURITY.md) before extending deployment or signing. The server binds to loopback, validates schemas/Host/Origin, rate limits requests, simulates orders and serves a restrictive production CSP. No mainnet feature exists.

## Readiness audit

The readiness branch hardens reviewed transaction parameters, wallet timeout/reload recovery and cancellation; suppresses stale directional scenarios; monitors each configured market/account alert independently; adds explicit side-aware planning references and preserved journal context; and keeps chart zoom across refresh/overlay changes. Browser alerts require the app to remain open and are not guaranteed background notifications.

See the [audit and exact verification results](docs/READINESS-AUDIT.md), [first authorized transaction checklist](docs/TESTNET-TRANSACTION-CHECKLIST.md), [genuine evidence folder](docs/testnet-execution/README.md), and [reviewer access preparation](docs/REVIEWER-ACCESS.md). No genuine signed order or cancellation has been executed. No public deployment or visibility change has been made.

## Demo and submission

Follow the [demo script](docs/DEMO.md). Review [architecture](docs/ARCHITECTURE.md), [SDK integration](docs/SDK-INTEGRATION.md), [research](docs/RESEARCH-AND-FEASIBILITY.md) and [submission preparation](docs/SUBMISSION.md).

Still required for the bounty: a real approved/funded testnet order and its evidence, approval for any public source release, demo recording, actual approved X posts, verified current event requirements and the user’s whitelisted DoraHacks submission. The deadline in the supplied brief is **1 November 2026 at 23:59 UTC**; web access did not independently confirm it.

## X Posts

Three unpublished drafts are in [SUBMISSION.md](docs/SUBMISSION.md), including the requested `@DreamDEXSomnia` tag. The execution announcement must wait for genuine order evidence. **Published links: none.**
