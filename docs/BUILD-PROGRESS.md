# Build progress

Updated 20 October 2026. Statuses reflect observed behavior, not simply the presence of files. **The original definition of done is not fully met because no authored signed testnet transaction has been authorized or executed.**

| Phase / capability               | Status             | Evidence / outstanding work                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: SDK/data feasibility    | Complete           | SDK 0.32.1 inspected and installed; 21 live perps; actual history, funding, depth, account and system reads. JSON probes retained. Competition rules independently unverified.                                                                                                                                         |
| Phase 1: Foundation              | Complete           | React/TypeScript + Express + SQLite + modular engines, lint, formatting, tests, CI configuration. Production starts and browser checks pass. CI is configured for GitHub Actions; local verification results are recorded below.                                                                                       |
| Phase 2: Real market data        | Complete           | Live discovery, source normalization, quality policy, six intervals, controlled polling, request coalescing, actual 24h bucket stats and failure states.                                                                                                                                                               |
| Phase 3: Intelligence cockpit    | Partially complete | Actual candlesticks, required indicators and warm-up states, all requested MA overlay toggles, confirmed zones/structure, timeframe matrix, deterministic summaries and quality warnings. Custom indicator periods/RSI thresholds remain unexposed.                                                                    |
| Phase 4: Scanner                 | Partially complete | Search/sort/presets/watchlist, technical factors, actual volume/change, configurable weights, missing-data behavior and market handoff tested. Scanner has no cross-timeframe factor until entering the cockpit.                                                                                                       |
| Phase 5: Trade planning          | Complete           | Manual inputs, exact decimals, tick/lot/minimum, risk/slippage/reward/margin checks, persistent plans and journal connection tested. Planning leverage does not change protocol settings.                                                                                                                              |
| Phase 6: Real execution          | Partially complete | Official ABI + sizing + simulation/gas checks + wallet consent + receipt recovery implemented. Mocked browser paths pass. Unsigned real simulation reached the STT guard; ready-to-sign and signed execution remain unverified. No real authored hash.                                                                 |
| Phase 7: Monitoring / management | Partially complete | Actual public populated-account reads verified, position analytics and funding, order history, persistent in-app alerts and reconciliation. Native cancellation preparation/revalidation is mock-tested; actual signed cancellation remains unverified. Reduce/close/protective orders unsupported.                    |
| Phase 8: Analytics / journal     | Partially complete | Actual fills/changes/funding, observed equity, bounded accounting, local journal and exports. No closed-position win rate, lifetime equity reconstruction, robust drawdown/cash-flow attribution or synchronized multi-device storage.                                                                                 |
| Phase 9: Assistant / Arena       | Partially complete | Deterministic fact-based assistant and preparation companion implemented. LLM layer not configured; Arena scoring/eligibility not inferred or verified.                                                                                                                                                                |
| Phase 10: Polish / submission    | Partially complete | Responsive desktop/mobile, production browser suite, screenshots, source formatting, security review and documents. Private GitHub repository created with user authorization. Hosting, public source release, demo recording, real trade evidence, posting and submission still await authorization / account access. |
| Historical evaluator             | Complete           | Real-candle, exploratory fixed-horizon EMA crossover observations with cost assumptions and chronological partitions. Tested; no validated trading-edge claim.                                                                                                                                                         |

## Website redesign

The root route now presents a complete product website with large editorial typography, a charcoal/lime palette, a native CSS/SVG orbital hero, actual live market observations, and an interactive product preview. The connected terminal remains at `/app` and shares the refined visual identity. Homepage preview links preserve the market selection into the planner or analysis view.

Desktop and mobile layouts, mobile menu/Escape behavior, keyboard workflow tabs, FAQ disclosure, source failure states and selected-market handoff were verified in the production browser suite. Fonts are bundled locally, and reduced-motion preferences are respected. Current landing and workspace captures are retained in `docs/screenshots/`.

The final inner-app polish adds a shared perspective mark and wordmark, clearer typography and contrast, numbered navigation and workflow links, larger chart labels, structured planning sections, meaningful draft guidance, account onboarding, journal cards, visible checklist progress, compact score settings and expandable diagnostic details. Wide market tables keep their market column visible while scrolling; desktop action columns remain visible too. See [design refinements](DESIGN-REFINEMENTS.md).

## Original baseline verification record

- **52 unit / SDK integration tests passed**, including five read-only live tests. The default offline run skips those five.
- **30 production browser tests passed**: 16 mocked application workflows, six homepage interaction/handoff cases, two workflow/keyboard/draft-state checks, and six read-only live homepage/dashboard/all-screen checks across desktop and mobile. The all-screen review also checks 320px, 768px and 1024px widths. Mocked signatures/hashes are explicitly test-only.
- Lint and TypeScript/build checks pass. Production bundles split chart and React chunks and bundle fonts locally.
- Live API checks cover discovery, cockpit/history/matrix/book, scan statistics, funding, empty/public-active accounts, diagnostics, invalid schemas, origin restrictions, unknown market and collateral/gas rejection paths. See timestamped JSON results.
- Initial ready-preview attempt failed at the STT guard and is retained, not represented as a signed or ready-to-sign success.
- Dependency audit reported zero known vulnerabilities after upgrading the test runner.
- Actual live desktop/mobile screenshots are in `docs/screenshots/`.

## External blockers

1. **Mandatory authored order evidence:** no user wallet, gas/margin funding or specific transaction authorization provided. Never bypass this by trading a public account or inventing a hash.
2. **Public publishing:** the user authorized private GitHub publication to [rishu4436/perpshq](https://github.com/rishu4436/perpshq). Public source release, deployment, X posts and DoraHacks submission remain unapproved.
3. **Event rules:** supplied DoraHacks page could not be independently fetched. Verify deadline, whitelist and current track requirements in the user’s account.

## Next implementation priorities

1. Complete one specific approved external-wallet testnet order, verify its real receipt/order/fill state and journal its evidence.
2. Validate cancellation with an approved resting order; implement native reduce-only closing and protective orders using confirmed SDK capabilities and per-action authorization.
3. Expose custom indicator periods/thresholds and broaden alert types (EMA crossover, position loss, order-state changes). Current rules cover mark, RSI, ATR and account maintenance buffer for each configured market while the browser remains open.
4. Add robust complete-position accounting and cash-flow-adjusted equity/drawdown before publishing lifetime performance statistics.
5. Review deployment/authentication requirements, publish only after approval, record the demo and finalize the user’s submission.

## Resume instructions

Start with README.md and TESTNET-EVIDENCE.md. Run `npm ci`, `npm test`, `npm run lint`, `npm run build`, then the local production server. Do not treat captured JSON as current live data or mocked CI hashes as execution evidence. Backend edits require restart. Personal state is browser-local; public SQLite data is ignored. There is no server private key to recover or configure.

## Readiness audit, 20 October 2026

The separate `fix/perpshq-hackathon-readiness` branch adds complete reviewed-parameter comparison, stable calldata/expiry, persistent timeout/late-hash recovery, identity revision checks, Web Locks where available, stricter receipt matching and cancellation preflight. Stale/insufficient scenarios are suppressed; market/account alerts run independently; explicit side-aware Planner context and original journal snapshots are preserved; ordinary chart refresh and overlays retain zoom.

See [READINESS-AUDIT.md](READINESS-AUDIT.md) for the current verification commands/counts and per-defect findings. Earlier 52/30 counts above describe the baseline only. The original full trading/submission scope remains incomplete until genuine specifically authorized execution and publication/submission requirements are satisfied. This audit does not authorize signing or public deployment.

## Agent Studio, 20 October 2026

Implemented schema-v1 four-strategy builder, deterministic explanations, central risk, conservative paper costs/depth, chronological history, permission/unsigned delegated adapter, independent Node worker and SQLite versions/commands/leases/fencing/recovery. The Agent Studio screen preserves Perspective design and the manual workflow. See [release report](AGENT-STUDIO-REPORT.md) and [testing](AGENT-TESTING.md) for current counts/limits.

Actual keyless Hideki startup, heartbeat, duplicate protection, pause/resume acknowledgement, shutdown and restart/ledger/cursor recovery were verified. Synthetic public-address grant reads returned false; these are not user-wallet authorization. No authored agent transaction exists. Assisted increases are blocked by incomplete actual loss history; signer/broadcast/autonomous activation remain disabled.

Docker/Railway files are prepared; container startup is unverified because Docker Desktop's Linux engine is unavailable. No deployment, domain, funding, grant or trade occurred. Native local verification is not 24/7 cloud uptime. This feature depends on still-open readiness fixes; neither PR is automatically merged.

On 21 October 2026 GitHub reported the existing repository PUBLIC. The owner explicitly instructed “Keep public and push”; Agent Studio publication follows that authorization. No visibility setting was changed by this implementation.
