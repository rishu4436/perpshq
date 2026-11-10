# Reviewer access

Website: https://perpshq.vercel.app · Workspace: https://perpshq.vercel.app/app.

No wallet is needed for discovery, charts, analysis or planning. For manual signing, use a browser extension wallet on Somnia Hideki chain 50383 with testnet STT and collateral. Each transaction requires an exact review and wallet confirmation. There is no server-held trading key.

The public site does not expose shared local agent controls or server backups. Agent Studio supports connected-wallet sign-in, owner-isolated saved configurations, live reviews of all four templates and exact wallet execution when a reviewed action qualifies. Persistent unresolved requests block another submission until reconciled. Recovery Center exports browser records. The local source includes independent worker controls.

Source: https://github.com/rishu4436/perpshq and the package's `source/` directory. Run Node 24, `npm ci`, `npm run build`, `npm start`, then open http://127.0.0.1:3000/app. Start `npm run agent:worker` separately for local worker observation.

Public hosting uses an exact HTTPS Host/Origin allowlist, transient public-data caching and browser-local personal records. Local-control routes are denied. Local databases, environment files and wallet/browser profiles are excluded from deployment and packaging. See [current release](RELEASE-2026-11-10.md) for verification and limitations.
