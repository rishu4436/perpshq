# DoraHacks submission preparation

Draft for the team to review and rewrite in its own voice. Nothing has been posted or submitted.

## Product description draft

PerpsHQ connects the perpetual trader’s research and decision process in one dreamDEX-native workspace: discover a Hideki perp market, inspect deterministic technical evidence, create a personal risk plan, validate it against the protocol, sign an explicitly reviewed order with an external wallet, reconcile chain/indexer state and keep a journal.

The product emphasizes provenance and explainability. Candles come from actual Hideki perp fills. Technical calculations handle warm-up periods and missing data; support/resistance uses confirmed historical pivots. Opportunity scores expose their factors instead of claiming predictive accuracy. Position quantities use market-specific decimals and lot sizes. Signing stays in the user’s wallet.

## Technical outline

React/TypeScript workspace, Lightweight Charts, deterministic analysis packages, Express read/simulation API, SQLite public snapshots, browser-local personal records, official markets SDK 0.32.1 and viem. Chain: Somnia Hideki 50383. See ARCHITECTURE.md and SDK-INTEGRATION.md.

## Submission checklist

- [ ] Independently confirm current event deadline, track rules, whitelist and judging requirements on the official DoraHacks page. Web retrieval was inaccessible; the brief’s 1 November 2026 23:59 UTC deadline remains user-supplied.
- [x] Source repository available: [rishu4436/perpshq](https://github.com/rishu4436/perpshq).
- [x] Repository is publicly readable as of 21 October 2026; owner previously confirmed keeping it public. Visibility unchanged by this sprint. Review the integration branch/PR; main does not yet contain either open feature PR.
- [ ] Record a genuine, explicitly authorized testnet order and export its evidence. No authored transaction yet.
- [ ] Record the 3–5 minute demo with accurate feature labels.
- [ ] Review remaining unsupported features and avoid calling the entire original scope complete.
- [ ] Publish only approved social posts and add their actual links to README.
- [ ] Submit through the user’s whitelisted DoraHacks account after final review.

## Readiness evidence

Use [READINESS-AUDIT.md](READINESS-AUDIT.md) for code fixes and exact test results; [TESTNET-TRANSACTION-CHECKLIST.md](TESTNET-TRANSACTION-CHECKLIST.md) for the remaining funded/authorized execution; and [REVIEWER-ACCESS.md](REVIEWER-ACCESS.md) for local review and future hosting preparation. Testnet evidence folder/report format is prepared, with no authored signed transaction claimed. The official DoraHacks page was retried during this audit and remained inaccessible to the web retrieval tool; event eligibility/deadline are still unverified.

Local implementation and automated verification do not complete the bounty submission. The genuine demo, reviewer/public access requirements, approved social links and account submission remain open. Nothing has been deployed, posted or submitted.

## X post drafts

1. Product announcement: “Building PerpsHQ: a connected workspace to discover, analyze, plan and review perpetual trades on dreamDEX. Real Hideki perp data, clear risk plans, and signing that stays in your wallet. Discover. Analyze. Plan. Trade. Improve. @DreamDEXSomnia”

2. Technical features: “Inside PerpsHQ: completed-candle EMA, RSI, MACD, Bollinger, ATR and ADX; confirmed pivot zones; timeframe comparison; and an opportunity score that shows its evidence. Missing data stays missing. Built around dreamDEX Hideki perps. @DreamDEXSomnia”

3. Execution/demo draft — **hold until genuine evidence exists**: “PerpsHQ’s first authorized Hideki perp order is verified: [INSERT ACTUAL HASH / DEMO LINK AFTER VALIDATION]. From market discovery to a risk plan, wallet confirmation and order reconciliation in one workspace. Testnet funds only. @DreamDEXSomnia”

No published links exist. Do not publish the third draft with placeholders or imply that execution has already happened.

## Integrated release package, 21 October 2026

Review source: [repository](https://github.com/rishu4436/perpshq), branch `release/perpshq-final-integration`. Readiness PR #1 and Agent Studio PR #2 are still open; the consolidated review branch preserves newer main documentation and both implementations. [Final audit](FINAL-RELEASE-AUDIT.md) is the current release status. Do not review default main as if it already contained Agent Studio.

The product description above can be extended in the team's own voice: optional local Agent Studio connects four explainable strategies to actual Hideki observations, mandatory risk, a conservative paper ledger and an independent durable worker. Config versions, source timestamps and worker acknowledgements remain visible. Position exits/signing/cloud control are not implied. Technical innovation is the connected evidence → plan → exact review → reconciliation/journal workflow and shared fail-closed strategy policy, not a claimed profitable predictor.

### Current evidence checklist

- [x] Integrated manual and Agent Studio code, tests and source/reviewer instructions prepared.
- [x] Actual keyless native-worker startup, pause/resume, clean restart and forced-termination/fenced takeover checks recorded.
- [x] Actual read-only SDK/API data and unsigned simulation/guards recorded; mocks remain labelled.
- [ ] Genuine authored user-approved testnet order/receipt/fill evidence: missing. No user wallet or exact authorization provided.
- [ ] Docker runtime verification: blocked by unavailable Linux engine; no Railway deployment or observed uptime.
- [ ] Approved/recorded video and final demo link: missing; use DEMO.md plan.
- [ ] Current organizer deadline/whitelist/social/track requirements: unverified. The exact official DoraHacks page was opened again on 21 October and returned HTTP 405 to the retrieval tool. Search did not yield independently readable canonical rules. Do not treat the user-supplied 1 November 2026 23:59 UTC deadline as verified or substitute another listing's dates. Check the organizer page in the user's account before submission.
- [ ] User-reviewed X drafts, explicit posting approval and actual published URLs.
- [ ] Owner approval for any public hosting/paid resources and final DoraHacks submission.

### Local reviewer instructions

From a fresh clone, check out `origin/release/perpshq-final-integration` after fetching remote refs, then `npm ci`, `npm run build`, `npm start`. Use http://127.0.0.1:3000/app and a second `npm run agent:worker` terminal for local Agent Studio. No key or funded account is required to inspect/simulate. Manual signing requires an external user-owned wallet and separately authorized funded testnet order. There is no hosted demo URL yet.

### Additional unpublished X draft

“PerpsHQ now includes Agent Studio: four explainable strategy templates, visible risk checks, paper accounting and a separate durable worker. Hideki data in; auditable decisions out. Live agent broadcasting stays disabled while we verify the supervised trading gates. @DreamDEXSomnia”

The draft is preparation only. Do not describe zero paper fills as a successful trade, replace placeholders with someone else's transactions, publish without approval, or submit text/results before the team reviews their accuracy.
