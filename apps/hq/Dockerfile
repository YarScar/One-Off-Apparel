# syntax=docker/dockerfile:1.7
# Build context must be the repo root, not apps/hq:
#   docker build -f apps/hq/Dockerfile -t lp-hq .

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
# Re-link workspace symlinks now that source is in place.
RUN pnpm install --frozen-lockfile --offline

RUN DATABASE_URL="postgresql://placeholder" pnpm --filter @lp-ai/lib-db generate
RUN pnpm --filter @lp-ai/lib-config build
RUN pnpm --filter @lp-ai/lib-db build
RUN pnpm --filter @lp-ai/lib-embedding build
# Next.js calls fs.stat() on .env during build for change tracking and
# crashes if missing. The host's .env is excluded via .dockerignore (correct —
# it holds secrets), so create an empty stub here. This file does not reach
# the runner stage.
RUN touch apps/hq/.env
RUN pnpm --filter @lp-ai/hq build

# ----- runner -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r nodejs && useradd -r -g nodejs next

# Next.js standalone bundle (server.js + minimal node_modules)
COPY --from=builder --chown=next:nodejs /workspace/apps/hq/.next/standalone ./
COPY --from=builder --chown=next:nodejs /workspace/apps/hq/.next/static ./apps/hq/.next/static
COPY --from=builder --chown=next:nodejs /workspace/apps/hq/public ./apps/hq/public

# Prisma 7 driver-adapter client: the generated client and its wasm query
# compiler live at the workspace path (packages/db/generated/prisma/, set via
# the `output` directive in schema.prisma). Next.js standalone tracing does
# not reliably pick up the .wasm artifact, so copy the directory explicitly.
COPY --from=builder --chown=next:nodejs \
  /workspace/packages/db/generated \
  ./packages/db/generated

USER next
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "apps/hq/server.js"]
