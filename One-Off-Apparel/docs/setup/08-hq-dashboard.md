# Phase 8 — HQ Dashboard (Next.js + NextAuth)

**Goal:** Scaffold the Next.js 14 HQ dashboard with Google SSO restricted to `@launchpadphilly.org`, shadcn/ui, and the core pages: sync status, recent tool calls, and data freshness.

**Prerequisites:**
- Phase 4 complete — Prisma client generated
- Phase 7 complete — `usage_logs` being populated by the MCP server
- Google OAuth credentials created (see step 1)

---

## 1. Create Google OAuth credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: `LP Internal AI HQ`
5. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (local dev)
   - `https://hq.launchpadinc.org/api/auth/callback/google` (production — add once Phase 9 deploys)
6. Copy the **Client ID** and **Client Secret** → store in `.env` as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
7. Generate an `AUTH_SECRET`: `openssl rand -base64 32`

---

## 2. Scaffold the Next.js app

```bash
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/apps"
pnpm create next-app@latest hq \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*"
```

Update `apps/hq/package.json` to add workspace dependencies:

```json
{
  "dependencies": {
    "@lp-ai/lib-db": "workspace:*",
    "@lp-ai/lib-config": "workspace:*",
    "next-auth": "^5.0.0-beta",
    "@auth/prisma-adapter": "^2.0.0"
  }
}
```

---

## 3. Install shadcn/ui

```bash
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/apps/hq"
pnpm dlx shadcn@latest init
```

Choose: **Default** style, **Slate** base color, CSS variables: **yes**.

Add the components you'll need:

```bash
pnpm dlx shadcn@latest add card table badge button skeleton
```

---

## 4. Configure NextAuth

**`apps/hq/auth.ts`:**
```typescript
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@lp-ai/lib-db';

const ALLOWED_DOMAIN = process.env['AUTH_ALLOWED_DOMAIN'] ?? 'launchpadphilly.org';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env['AUTH_GOOGLE_ID']!,
      clientSecret: process.env['AUTH_GOOGLE_SECRET']!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email ?? '';
      return email.endsWith(`@${ALLOWED_DOMAIN}`);
    },
  },
});
```

**`apps/hq/app/api/auth/[...nextauth]/route.ts`:**
```typescript
import { handlers } from '@/auth';
export const { GET, POST } = handlers;
```

---

## 5. Core pages

**Pages to build:**

| Route | Purpose |
|---|---|
| `/` | Dashboard home — data freshness cards + recent tool calls |
| `/sync` | Sync status — last run time + row counts per connector |
| `/tools` | Tool call log — searchable `usage_logs` table |
| `/api/health` | Health check endpoint (used by ALB target group) |

The health endpoint is critical for the ALB target group health checks:

**`apps/hq/app/api/health/route.ts`:**
```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@lp-ai/lib-db';

export async function GET(): Promise<NextResponse> {
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({ status: 'ok', ts: new Date().toISOString() });
}
```

---

## 6. Run locally

```bash
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1"
pnpm --filter @lp-ai/hq dev
```

Open `http://localhost:3000`. Sign in with your `@launchpadphilly.org` Google account.

---

## Verification checklist

- [ ] `pnpm --filter @lp-ai/hq dev` starts without errors
- [ ] Google sign-in works with `@launchpadphilly.org` account
- [ ] Sign-in blocked for non-`@launchpadphilly.org` accounts
- [ ] `/api/health` returns `{ status: 'ok' }`
- [ ] Dashboard home shows at least one data freshness card
- [ ] `/tools` page shows rows from `usage_logs`

---

## Known pitfalls

- **"redirect_uri_mismatch"** — the redirect URI in Google Console must exactly match what NextAuth sends. For local dev, ensure `http://localhost:3000/api/auth/callback/google` is in the authorized list.
- **NextAuth v5 beta** — the API differs from v4. Use the `auth.ts` pattern above (not the old `[...nextauth].ts` pages router style).
- **Prisma adapter needs auth tables** — add `Account`, `Session`, `VerificationToken` models to `prisma/schema.prisma` before running the dashboard. These are standard NextAuth schema additions.

---

**Next:** [09-ecs-express-mode.md](09-ecs-express-mode.md)
