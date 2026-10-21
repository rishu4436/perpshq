# DoraHacks submission preparation

Draft for the team to review and rewrite in its own voice. Nothing has been posted or submitted.

## Product description draft

PerpsHQ connects the perpetual trader’s research and decision process in one dreamDEX-native workspace: discover a Hideki perp market, inspect deterministic technical evidence, create a personal risk plan, validate it against the protocol, sign an explicitly reviewed order with an external wallet, reconcile chain/indexer state and keep a journal.

The product emphasizes provenance and explainability. Candles come from actual Hideki perp fills. Technical calculations handle warm-up periods and missing data; support/resistance uses confirmed historical pivots. Opportunity scores expose their factors instead of claiming predictive accuracy. Position quantities use market-specific decimals and lot sizes. Signing stays in the user’s wallet.

## Technical outline

React/TypeScript workspace, Lightweight Charts, deterministic analysis packages, Express read/simulation API, SQLite public snapshots, browser-local personal records, official markets SDK 0.32.1 and viem. Chain: Somnia Hideki 50383. See ARCHITECTURE.md and SDK-INTEGRATION.md.

## Submission checklist

- [ ] Independently confirm current event deadline, track rules, whitelist and judging requirements on the official DoraHacks page. Web retrieval was inaccessible; the brief’s 1 November 2026 23:59 UTC deadline remains user-supplied.
- [x] Private source repository created: [rishu4436/perpshq](https://github.com/rishu4436/perpshq).
- [ ] Owner grants reviewer access or separately authorizes any required public source release. Repository visibility remains private.
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
