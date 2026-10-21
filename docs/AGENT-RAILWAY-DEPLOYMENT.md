# Railway worker preparation — no deployment performed

Supplied: `apps/agent-worker/Dockerfile`, `apps/agent-worker/railway.toml`, `.dockerignore` and validated environment schema. No Railway service, domain, secret, grant or trade was created. **Container startup is unverified**: the actual `docker build` could not connect to Docker Desktop's Linux engine (`dockerDesktopLinuxEngine` pipe missing). Native Node verification does not validate a container or cloud uptime.

## Reviewed sources

Official [perps](https://github.com/somnia-chain/dreamdex-bot-kit/blob/25798660bbe4674a6f83a960b202852896e2fed4/docs/perps.md), [operations](https://github.com/somnia-chain/dreamdex-bot-kit/blob/25798660bbe4674a6f83a960b202852896e2fed4/docs/24-7-operations.md), [Railway guide](https://github.com/somnia-chain/dreamdex-bot-kit/blob/25798660bbe4674a6f83a960b202852896e2fed4/docs/railway.md), Dockerfile and config were inspected at the pinned commit. Railway's [configuration reference](https://docs.railway.com/config-as-code/reference) documents the Dockerfile builder/path and ON_FAILURE fields. The [official template](https://railway.com/deploy/pE6EIF) page could not be retrieved; it is not a PerpsHQ deployment or compatibility proof.

## Actual environment schema

| Variable              | Default / allowed value                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AGENT_NETWORK         | `hideki` only                                                                                                                                                                  |
| AGENT_MODE            | `DRY_RUN` only; assisted configs are local observation, not an env execution mode                                                                                              |
| AGENT_STORE_PATH      | `data/agent-studio.sqlite` local; `/data/agent-studio.sqlite` container                                                                                                        |
| AGENT_CONFIG_FILE     | Optional nonsecret config/export, array or `{agents:[...]}` path. New DRY_RUN configs initially queue start; existing matching configs retain state. Conflicting imports fail. |
| AGENT_POLL_MS         | 30000; integer 10000–300000                                                                                                                                                    |
| AGENT_LEASE_TTL_MS    | 45000; integer 30000–120000                                                                                                                                                    |
| AGENT_DATA_TIMEOUT_MS | 20000; integer 1000–60000                                                                                                                                                      |
| AGENT_MAX_CYCLES      | Optional integer 1–1000000 for bounded verification                                                                                                                            |
| AGENT_WORKER_ID       | Optional 1–80 word/hyphen characters; otherwise random identity                                                                                                                |

`NETWORK`/`DRY_RUN`, if set, must be `hideki`/`true`. `AGENT_LIVE_ENABLED` cannot be true. `PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY`, `AGENT_PRIVATE_KEY` cause safe failure without logging values. Official bot-kit key examples are **not** this worker's settings. Do not add a key to exports, build args, URLs, databases or this release's Railway environment. A future approved signer requires isolated secret management, never the owner's main key.

## Local container verification when an engine is available

From repository root:

```sh
docker build -f apps/agent-worker/Dockerfile -t perpshq-agent-worker:local .
docker volume create perpshq-agent-data
docker run --rm --name perpshq-agent-worker -v perpshq-agent-data:/data perpshq-agent-worker:local
```

An empty store starts an idle read-only worker. To simulate, put the exported `config` at `/data/agent.json` and set `AGENT_CONFIG_FILE=/data/agent.json`. Use the same volume on restart; do not erase a DB to bypass pause/unknown intent. Verify nonroot `node` ownership, SIGTERM, restart, duplicate rejection and durable data before claiming container readiness.

Root build context is required. Start command: `node --import tsx apps/agent-worker/src/index.ts`. Node 24/tsx with retained dev dependencies is intentional. No HTTP port is exposed. Docker health reads heartbeat, not profit/fill correctness.

## Future owner-approved Railway procedure

After separate deployment approval, select the private repo and explicitly choose `apps/agent-worker/railway.toml`. Keep root context, **one replica** and persistent `/data`; verify ownership. Upload only nonsecret config and use actual env names above. No domain/HTTP ingress is needed. ON_FAILURE retries ten times; exhaustion needs attention and does not guarantee uptime.

Do not configure an HTTP healthcheck path: there is no listener. Railway process/log monitoring and the heartbeat CLI are distinct from Docker HEALTHCHECK; do not assume Railway consumes its status. Inspect `worker-started`, `cycle-complete`, `cycle-unavailable`, `worker-stopped`. Run `npm run agent:health` with the service's volume to check heartbeat.

A local browser cannot pause/edit cloud SQLite. **No authenticated cloud control exists.** Deployment tab reports integration unavailable. Use owner-controlled service operations and verify actual stop; inspect exposure separately. Do not expose the loopback API or bypass Host/Origin checks. Remote mutation needs a new authenticated, audited control plane first.
