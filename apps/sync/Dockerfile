# syntax=docker/dockerfile:1.7
# Build context must be the repo root, not apps/sync:
#   docker build -f apps/sync/Dockerfile -t lp-sync .
#
# Single image that runs any connector's CLI as a one-off Fargate task.
# Command is overridden at run time, e.g.:
#   command: ["/bin/sh","-c","cd /workspace/connectors/google-sheets && node dist/cli.js"]

# ----- deps -------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
RUN corepack enable && corepack prepare pnpm@10.34.0 --activate
WORKDIR /workspace

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json eslint.config.mjs ./
COPY apps/aws-mcp-server/package.json apps/aws-mcp-server/package.json
COPY apps/hq/package.json apps/hq/package.json
COPY apps/mcp-server/package.json apps/mcp-server/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/embedding/package.json packages/embedding/package.json
COPY connectors/aplos/package.json connectors/aplos/package.json
COPY connectors/google-drive/package.json connectors/google-drive/package.json
COPY connectors/google-sheets/package.json connectors/google-sheets/package.json
COPY connectors/notion/package.json connectors/notion/package.json
COPY connectors/slack/package.json connectors/slack/package.json

RUN pnpm install --frozen-lockfile

# ----- builder ----------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.34.0 --activate
WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN pnpm install --frozen-lockfile --offline

RUN DATABASE_URL="postgresql://placeholder" pnpm --filter @lp-ai/lib-db generate
RUN pnpm --filter @lp-ai/lib-config build
RUN pnpm --filter @lp-ai/lib-db build
RUN pnpm --filter @lp-ai/lib-embedding build
# Build every connector — runtime image picks one per task invocation.
RUN pnpm --filter "@lp-ai/connector-*" build

# ----- runner -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /workspace
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r nodejs && useradd -r -g nodejs lpsync

COPY --from=builder --chown=lpsync:nodejs /workspace/node_modules ./node_modules
COPY --from=builder --chown=lpsync:nodejs /workspace/packages ./packages
COPY --from=builder --chown=lpsync:nodejs /workspace/connectors ./connectors
COPY --from=builder --chown=lpsync:nodejs /workspace/pnpm-workspace.yaml /workspace/package.json ./

USER lpsync

# Default to no-op; the EventBridge target overrides `command` per connector.
CMD ["node", "-e", "console.error('lp-sync: command must be provided by the caller'); process.exit(2)"]
