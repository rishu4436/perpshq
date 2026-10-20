# Reviewer access and deployment preparation

The repository is private: [rishu4436/perpshq](https://github.com/rishu4436/perpshq). Reviewers need GitHub access granted by the owner. No public hosting or visibility change has been authorized or performed.

For an accessible local review, clone with authorized GitHub access, use Node 22.13+ (verified on Node 24), run `npm ci`, `npm run build`, `npm start`, and open `http://127.0.0.1:3000`. The homepage is `/`; the workspace is `/app`. Use the [demo script](DEMO.md) and [audit report](READINESS-AUDIT.md). Public chain reads require Hideki RPC, WebSocket and indexer connectivity; personal drafts remain in that browser. External-wallet support requires a browser extension. Tests use mocked providers rather than the reviewer's wallet.

Before any later public deployment, prepare a concrete hosting review covering authenticated personal persistence (if desired), approved origins/Host/proxy handling, TLS and wallet compatibility, CSP, API rate limits/caching, RPC connectivity, storage lifecycle and monitoring. The owner must approve the exact hosting target and publication scope. Keep the current loopback restrictions until that work is authorized; exposing the dev server or removing Origin checks is not a deployment procedure. Never add a funded server key.

Submission materials remain drafts: recording, real execution evidence, approved social links, verified event requirements and submission through the owner's eligible account are still outstanding. A local passing test suite does not establish public uptime, organizer eligibility or a signed trade.
