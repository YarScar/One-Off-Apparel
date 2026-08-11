# Using the LP Internal AI MCP Server

There are two ways to connect to the MCP server, depending on whether you're an
end-user or a developer.

> **MCP endpoint URL** to give Anthropic Console / Claude Desktop / any MCP
> client: **`https://mcp.launchpadinc.org/mcp`** (the `/mcp` suffix is required —
> it's the JSON-RPC endpoint per the MCP Streamable HTTP spec). OAuth discovery
> is resolved automatically from the base host. For the AWS governance server
> the equivalent URL is `https://aws-mcp.launchpadinc.org/mcp`.

---

## Path A — Anthropic Console (recommended for everyone)

This is the supported path for the whole team. One click; no scripts; no shared
tokens distributed to laptops.

### One-time per device

1. Open **Claude** (web at [claude.ai](https://claude.ai), desktop app, or
   mobile) — signed into your Anthropic account that belongs to the Launchpad
   org.
2. Go to **Connectors** (or Settings → Integrations).
3. Find **LP Internal AI** in the list and click **Connect**.
4. A popup opens at `https://mcp.launchpadinc.org/oauth/authorize?...`. The
   server redirects you to **Sign in with Google** using your
   `@launchpadphilly.org` account.
5. After Google returns, you may see a banner saying your account is **pending
   approval**. If so, ask an LP Internal AI admin (Christian to start) to
   activate you via the HQ admin page. Once activated, click Connect again
   and the OAuth flow completes silently.

### After that — just use Claude

Ask Claude things like *"Give me a brief on student John Doe"* or *"What's the
attendance trend for Cohort 3 this week?"* — Claude will pick the right tool
from the LP Internal AI server, your stored credential is used automatically.

### Refresh

Refresh tokens last 30 days. You'll be asked to reconnect once a month or so.

### Permissions

Tools you can call depend on the role assigned to your account. The full role
matrix lives in [`docs/setup/23-mcp-oauth.md`](docs/setup/23-mcp-oauth.md).
Briefly:

- `program_staff` — students / outcomes / attendance / certifications
- `development` — donors / entity briefs
- `sales` — donors / HubSpot (when wired)
- `finance` — finances / donors (read)
- `software_dev` — search / Notion / GitHub (when wired)
- `leadership` — read access across all domains
- `admin` — can manage user roles via HQ

---

## Path B — Developer / Power User: Claude Desktop Bridge

This is the **fallback** path for developers who want stdio MCP access from the
Claude Desktop app without going through the Anthropic Console. It uses a
shared `SYNC_SECRET` bearer token; the Anthropic Console path is preferred
because it's per-user-attributable in the audit log.

### `claude_desktop_config.json`

> Linux: `~/.config/Claude/config.json`
> macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
> Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "lp-internal": {
      "command": "node",
      "args": [
        "/path/to/lp-internal-ai-v1/apps/mcp-server/dist/bridge.js"
      ],
      "env": {
        "MCP_URL": "https://mcp.launchpadinc.org/mcp",
        "SYNC_SECRET": "<from 1Password>"
      }
    },
    "lp-internal-aws": {
      "command": "node",
      "args": [
        "/path/to/lp-internal-ai-v1/apps/aws-mcp-server/dist/bridge.js"
      ],
      "env": {
        "AWS_MCP_URL": "https://aws-mcp.launchpadinc.org/mcp",
        "AWS_MCP_TOKEN": "<from 1Password>"
      }
    }
  }
}
```

`SYNC_SECRET` lives in 1Password (production value) or in your local `.env`
for development.

### Build the bridges

```bash
pnpm install
pnpm --filter @lp-ai/mcp-server build
pnpm --filter @lp-ai/aws-mcp-server build
```

---

## Verification

### Service health (anyone, no auth)

```bash
curl https://mcp.launchpadinc.org/health
# → {"status":"ok","ts":"..."}

curl https://aws-mcp.launchpadinc.org/health
# → {"status":"ok","ts":"..."}
```

### OAuth discovery (anyone, no auth)

```bash
curl https://mcp.launchpadinc.org/.well-known/oauth-protected-resource
curl https://mcp.launchpadinc.org/.well-known/oauth-authorization-server
curl https://mcp.launchpadinc.org/.well-known/jwks.json
```

### Authenticated `/mcp` (needs a token)

```bash
# Without token → 401
curl -X POST https://mcp.launchpadinc.org/mcp

# With your SYNC_SECRET (power-user path) → enters JSON-RPC protocol
curl -X POST https://mcp.launchpadinc.org/mcp \
  -H "Authorization: Bearer $SYNC_SECRET" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Troubleshooting

- **Anthropic Console says "couldn't connect" or "invalid_client"** — verify the
  MCP server's OAuth client (`AUTH_GOOGLE_ID`) has
  `https://mcp.launchpadinc.org/oauth/google-callback` in its Authorized
  Redirect URIs.
- **Sign-in says "pending approval"** — your account exists but isn't ACTIVE
  yet. Ping the LP Internal AI admin (Christian) via Slack to activate it from
  the HQ `/admin` page.
- **"My role doesn't let me call X"** — admin needs to add the right role to
  your account in HQ `/admin`.
- **Claude Desktop bridge can't connect** — check your `MCP_URL` is `https://`
  and that `SYNC_SECRET` matches what's in production Secrets Manager
  (`lp-internal/sync`).

For the protocol-level details (auth flow, JWT contents, role registry, schema
changes), see [`docs/setup/23-mcp-oauth.md`](docs/setup/23-mcp-oauth.md).
