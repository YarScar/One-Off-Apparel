# HQ Local Startup Troubleshooting

Symptoms and fixes for the two startup failures you hit when running the HQ dashboard locally:

```
[auth][error] MissingSecret: Please define a `secret`.
⨯ ./app/page.tsx:1:1
Module not found: Can't resolve '@lp-ai/lib-db'
```

Both errors are bootstrap problems, not bugs in app code. A fresh clone will hit them until the
workspace libraries are generated and the root `.env` is made visible to Next.js.

## Root causes

| Symptom | Root cause |
|---|---|
| `Module not found: Can't resolve '@lp-ai/lib-db'` | `packages/db` and `packages/config` export from `./dist/` (see `packages/db/package.json`), but `dist/` doesn't exist until the packages are built. |
| Same error, `@lp-ai/lib-db` still missing after build | The Prisma client at `packages/db/generated/prisma/` has not been generated yet. `lib-db` cannot compile without it. |
| `[auth][error] MissingSecret` | Next.js loads `.env` from the app directory (`apps/hq/.env`), but the real `.env` lives at the monorepo root. `AUTH_SECRET` (and `DATABASE_URL`) are therefore invisible to the server **and** the Edge middleware. |

`dist/` and `packages/db/generated/` are gitignored build artifacts — these steps change no tracked
source files.

## Fix 1 — generate the Prisma client

```bash
pnpm db:generate
```

Writes the client to `packages/db/generated/prisma/`.

## Fix 2 — build the workspace libraries

`@lp-ai/lib-db` imports `@lp-ai/lib-config`, so build config first (or use `pnpm -r build`, which
respects the dependency order):

```bash
pnpm --filter @lp-ai/lib-config build && pnpm --filter @lp-ai/lib-db build
```

## Fix 3 — make the root `.env` visible to Next.js

The project root of the Next.js app is `apps/hq`, but the env file lives at the monorepo root.
Two options:

### Option A — load the root `.env` in `next.config.mjs` (recommended)

Add `@next/env`'s `loadEnvConfig` to `apps/hq/next.config.mjs` so Next.js picks up the root `.env`
(plus `.env.local` / `.env.development` precedence) before env is snapshotted for the server and
middleware:

```mjs
import { loadEnvConfig } from '@next/env';

const here = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(here, '..', '..');
loadEnvConfig(monorepoRoot, process.env['NODE_ENV'] !== 'production');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ...existing config...
};
```

Note: `@next/env` is shipped as a dependency of `next`, so no new install is required.

### Option B — pass env vars inline (no code change)

Equivalent to the workaround in `docs/runbooks/local-dev.md`:

```bash
AUTH_SECRET=<value from .env> \
DATABASE_URL='postgresql://lpapp:lpapp@localhost:5433/lpinternal?sslmode=disable' \
pnpm --filter @lp-ai/hq dev
```

Run it on Windows (Git Bash / MSYS):

```bash
AUTH_SECRET="$(awk -F= '/^AUTH_SECRET=/{print $2}' .env)" \
DATABASE_URL='postgresql://lpapp:lpapp@localhost:5433/lpinternal?sslmode=disable' \
pnpm --filter @lp-ai/hq dev
```

## Verify

```bash
pnpm --filter @lp-ai/hq dev
curl http://localhost:3000/api/health
```

- If `/api/health` or DB-backed pages fail to connect, ensure local Postgres is running
  (`pnpm db:up`) and the schema/seed have been applied (`pnpm db:push`, `pnpm db:seed`).
- The dashboard requires Google OAuth credentials (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` in
  `.env`). For local-only work you can set `HQ_DEV_NO_AUTH=true` to bypass sign-in, but the
  `AUTH_SECRET` fix above is still required because NextAuth initializes the middleware regardless.
