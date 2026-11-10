# Submission status — 10 November 2026

The release is published to https://perpshq.vercel.app and the source repository is https://github.com/rishu4436/perpshq. It is available for review. Complete live execution coverage is still outstanding.

## Verified

- 348 unit/integration tests passed; five optional SDK tests skipped. Type checking and lint passed.
- Twenty focused desktop/mobile browser checks passed, with mocked wallet execution explicitly labelled.
- Twenty-four actual deployed desktop/mobile screen checks passed, with zero page errors or horizontal overflow.
- Twenty-four actual production Agent Studio API checks passed: real SIWE signatures from ephemeral unfunded QA identities, nonce replay refusal, private versioned configuration persistence, four real strategy reviews, owner isolation and logout revocation. No trade was broadcast by this verification.
- Actual Postgres cross-client reads and concurrent atomic updates passed. Semantic configuration comparison handles JSONB key reordering.
- Historical real Hideki receipts establish manual BTC open/close, Trend entry and Guardian cancellation. See LIVE-STRATEGY-TESTS-2026-11-01.md.

## Remaining limits

Breakout and Mean Reversion have no qualifying live entry receipt. In the latest production review window, Trend, Breakout and Mean Reversion returned NO_ACTION; Guardian returned PAUSE_REQUIRED for the unfunded QA identity. No decision had an executable preview. These are functioning review paths, not proof that every execution path has traded on the hosted release.

The Codex in-app browser loads Agent Studio successfully but reports no EIP-1193 wallet. A new account or additional funds does not supply a browser wallet provider. The existing funded MetaMask wallet remains in Edge; Windows automation could not reliably associate that window with its URL. No private key was imported or extracted, and no replacement funded wallet was created.

Autonomous broadcasting, hosted worker control and native atomic reduce-only exits remain unavailable. Stops and targets are planning references. The demo is a disconnected product tour with separately labelled historical chain evidence; it does not claim a new live wallet trade.

The organizer page is https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail. Automated retrieval returned HTTP 405 on 10 November. Eligibility, the current deadline and submission acceptance remain unverified. No organizer submission or social post was made.
