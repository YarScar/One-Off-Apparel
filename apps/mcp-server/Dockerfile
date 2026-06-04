# syntax=docker/dockerfile:1.7
# Build context must be the repo root, not apps/mcp-server:
#   docker build -f apps/mcp-server/Dockerfile -t lp-mcp .

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
COPY connectors/bigquery/package.json connectors/bigquery/package.json
COPY connectors/givebutter/package.json connectors/givebutter/package.json
COPY connectors/google-drive/package.json connectors/google-drive/package.json
COPY connectors/google-sheets/package.json connectors/google-sheets/package.json
COPY connectors/roam/package.json connectors/roam/package.json
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
RUN pnpm --filter @lp-ai/mcp-server build

# ----- runner -----------------------------------------------------------------
# Carries the full workspace (built dist + node_modules with Prisma engines)
# so the generated client and pnpm symlinks remain intact at runtime.
FROM node:22-bookworm-slim AS runner
WORKDIR /workspace
ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r nodejs && useradd -r -g nodejs mcp

COPY --from=builder --chown=mcp:nodejs /workspace/node_modules ./node_modules
COPY --from=builder --chown=mcp:nodejs /workspace/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=builder --chown=mcp:nodejs /workspace/apps/mcp-server/node_modules ./apps/mcp-server/node_modules
COPY --from=builder --chown=mcp:nodejs /workspace/apps/mcp-server/package.json ./apps/mcp-server/package.json
COPY --from=builder --chown=mcp:nodejs /workspace/packages ./packages
COPY --from=builder --chown=mcp:nodejs /workspace/pnpm-workspace.yaml /workspace/package.json ./

WORKDIR /workspace/apps/mcp-server
USER mcp
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/serve-http.js"]
