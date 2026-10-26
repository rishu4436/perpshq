FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
# tsx is intentionally retained: the worker runs the reviewed TypeScript sources.
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY packages ./packages
COPY apps/agent-worker ./apps/agent-worker
RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production \
    AGENT_NETWORK=hideki \
    AGENT_MODE=DRY_RUN \
    AGENT_STORE_PATH=/data/agent-studio.sqlite
USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 CMD ["node", "--import", "tsx", "apps/agent-worker/src/healthcheck.ts"]
# No public HTTP port and no signer. A config file is optional for idle observation.
CMD ["node", "--import", "tsx", "apps/agent-worker/src/index.ts"]
