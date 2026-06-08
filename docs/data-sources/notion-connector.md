# Notion Connector

**Status:** Planned — awaiting credentials
**Destination tables:** `document_chunks` (with embeddings)
**Source of:** Meeting transcripts (V1). Future Notion content types (knowledge base, policy pages) can extend the same connector.
**Schedule:** Daily via EventBridge cron in production

## Overview

Pulls Notion database pages — initially the meeting transcripts database — into Postgres + pgvector. Each page becomes one or more chunks in `document_chunks` with `source='notion'` and metadata identifying the page, database, content subtype, and **visibility** (see Permissioning below). Lights up the `search_conversations` and `search_by_person` MCP tools for meeting content.

This connector was chosen over Claude's native Notion connector because meeting transcripts need to participate in cross-source semantic search and entity resolution (Slack + Drive + Notion in one ranked query). The native connector siloes each source. See `memory/meeting_transcripts_sourcing_change.md` for the architectural rationale.

## API

- **Base URL:** `https://api.notion.com/v1/`
- **Auth:** Bearer token (Notion internal integration token); `Notion-Version: 2022-06-28` header required on every request
- **Docs:** https://developers.notion.com/reference/intro

## Key endpoints

| Endpoint | Purpose |
|---|---|
| `POST /databases/{db_id}/query` | List pages in the meeting transcripts database (paginated, supports filtering by last-edited time) |
| `GET /pages/{page_id}` | Fetch page properties (title, date, visibility, attendees) |
| `GET /blocks/{block_id}/children` | Fetch page block tree, paginated. Recursive — toggles and callouts have children too |

## Auth setup

Notion integrations are **scoped per-database**. The integration must be explicitly invited to each database it can read.

1. Create an internal integration at https://www.notion.so/profile/integrations
2. Capabilities: **Read content only** — uncheck Update / Insert / User capabilities. Integrations don't need write access for this connector.
3. Copy the **Internal Integration Token** → `NOTION_API_KEY`
4. In Notion, open the meeting transcripts database → `•••` → **Connections** → **Add connections** → select the integration. Without this, the connector sees zero pages.

## Database property contract

The meeting transcripts database has these properties (configured 2026-05-21):

| Property | Type | Required | Maps to `metadata.*` |
|---|---|---|---|
| `Title` (default page title) | Title | yes | becomes `document_chunks.title` |
| `Date` | Date | yes | `meeting_date` (ISO date) |
| `Visibility` | Multi-select | **yes — see Permissioning** | `visibility` (array of role tags) |
| `Attendees` | People or Multi-select | recommended | `attendees` (array of names/handles) |
| `Owner` | Person | optional | `owner` (single name) |
| `Project` | Relation or Multi-select | optional | `project` (array of names) |
| `Tags` | Multi-select | optional | `tags` (array of strings) |
| `Type` | Select | optional | `meeting_type` (e.g. `1:1`, `All-Hands`, `Board`) |
| `URL` | URL | optional | `recording_url` (string) — for the original transcript / recording link |

If the connector encounters a page **without** a `Visibility` value set, it **skips the page** and logs a warning. This is the fail-closed default — see Permissioning below.

## Sync strategy

Two-phase incremental sync:

1. **Phase 1 — list pages.** `POST /databases/{db_id}/query` filtering on `last_edited_time > <last_sync_started_at>` (rolling 24-hour window for safety on the first incremental run after each scheduled cron). Paginated via `next_cursor`.
2. **Phase 2 — per-page fetch.** For each page returned:
   a. `GET /pages/{page_id}` → read properties (title, date, visibility, attendees, type)
   b. `GET /blocks/{page_id}/children` recursively → assemble plain-text body
   c. Skip if `Visibility` is unset (fail closed)
   d. Chunk body (~1000 chars, 200-char overlap, prefer block boundaries when feasible)
   e. Embed each chunk via `@lp-ai/lib-embedding` (OpenAI `text-embedding-3-large`, 1536-dim)
   f. Upsert into `document_chunks` keyed on `sourceId='notion:<page_id>:<chunk_index>'`

Full refresh fallback monthly (no `last_edited_time` filter) to catch deletes and any pages where the timestamp didn't update for some reason.

## Chunking

- Walk the block tree depth-first, concatenating plaintext from paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, to_do, toggle, quote, and callout blocks.
- Skip: divider, image, file, embed, code (configurable later), table_row (handled at table level).
- Chunk boundary preference: don't split mid-block; aim for ~1000 chars, allow up to ~1400 to finish a block cleanly.
- 200-char overlap between consecutive chunks within the same page (so phrases at boundaries are searchable).

## `document_chunks` row shape

```ts
{
  source: 'notion',
  sourceId: 'notion:<page_id>:<chunk_idx>',  // upsert key
  title: '<page title>',
  content: '<chunk plaintext>',
  embedding: <1536-dim vector>,
  metadata: {
    subtype: 'meeting',                    // future: 'knowledge_base', 'policy', etc.
    notion_page_id: '<uuid>',
    notion_database_id: '<uuid>',
    last_edited_time: '<iso8601>',
    meeting_date: '<iso8601>',             // from Date property
    meeting_type: '<string>',              // from Type property
    attendees: ['Maria Garcia', '@christian.k', ...],
    owner: 'Christian Kunkel',             // from Owner property (single)
    project: ['WPF Grant', ...],           // from Project property (array)
    tags: ['quarterly-review', ...],       // from Tags property (array)
    recording_url: 'https://...' | null,   // from URL property
    visibility: ['all-staff'] | ['leadership'] | ['hr'],  // see Permissioning
    chunk_index: <int>,
    chunk_count: <int>,
  },
  syncedAt: <now>,
}
```

The `metadata.subtype` field is the discriminator for future Notion content types — keep `source` as `'notion'` so cross-source queries don't multiply, and discriminate further in metadata.

---

## Permissioning

**Meeting transcripts can contain sensitive content — performance reviews, HR discussions, board strategy. Not every team member should see all of it.** The system must filter what each user can query, not just what the connector ingests.

### The challenge

V1's current MCP tools have no caller identity. They run anonymously; whoever invokes the MCP server gets all results. To filter, we need three things this connector is the first to require:

1. **Per-content visibility tags** — stored at ingest time
2. **Caller identity** propagation from user → Claude client → MCP server
3. **Role mapping** — a way to know which roles a given user has

### Design

A multi-select **`Visibility`** property on the Notion page is the source of truth. Recommended values (extensible per Launchpad's org structure):

| Tag | Who can read |
|---|---|
| `all-staff` | Every authenticated `@launchpadphilly.org` user |
| `leadership` | Leadership team only |
| `program-staff` | Program staff (mentors, instructors) |
| `hr` | HR + Leadership |
| `board` | Board + Leadership |

A page can carry multiple tags (e.g. a leadership meeting that's safe for `program-staff` to read tags both). A page can carry exactly one — that's the default. **A page tagged with nothing is skipped entirely** (no ingest, not even with restricted visibility). This is the explicit "fail closed" default — the system never accidentally makes content visible.

### Required infrastructure (new in V1, beyond what this connector does)

Three pieces of infra need to land for permissioning to actually enforce anything:

#### 1. `user_roles` table

```sql
CREATE TABLE user_roles (
  user_email     TEXT PRIMARY KEY,
  roles          TEXT[] NOT NULL,         -- ['leadership', 'hr']
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seeded manually for now (V1) by an admin; later sourced from Google Workspace groups or a similar IdP. Every `@launchpadphilly.org` user gets at minimum `['all-staff']` implicitly — the table only needs entries for users with elevated roles.

#### 2. Caller identity propagation

The MCP server today has no idea who invoked a tool. To fix:

- **Streamable HTTP transport** (production via ECS Fargate): require an `X-Caller-Email` header on every tool call; reject if missing. EventBridge / scheduled jobs use a service-account email with a known set of roles.
- **stdio transport** (Claude Desktop locally): the desktop client passes the signed-in user's email via the MCP `init` handshake or via an env var (`MCP_CALLER_EMAIL`). For local dev convenience, default to a configurable `MCP_LOCAL_CALLER_EMAIL` env var so the developer doesn't have to set it each invocation.

Either way, the MCP server resolves caller email → roles via `user_roles` at the start of each tool call and stashes them in the request context.

#### 3. Query-time filter

Search tools (`search_conversations`, `search_by_person`) add a filter clause:

```sql
WHERE (metadata->'visibility' ?| ${caller_roles}::text[])
   OR (source != 'notion')
```

The `?|` operator returns true if any element in the caller's role array exists in the chunk's visibility array. Non-Notion chunks aren't gated (yet) — this scope can extend to Slack, Drive, etc. as those connectors land.

For `get_entity_brief`, no Notion content is currently surfaced, but if Notion mentions get added to that tool later, the same filter applies.

### Edge cases

- **Caller has no row in `user_roles`** → default to `['all-staff']`. Domain restriction at the auth layer means they're already a Launchpad employee.
- **External / unauthenticated caller** → tool returns `unauthorized` error envelope; no content leaks.
- **Visibility property absent from a page** → page is skipped at ingest, logged to `sync_runs.notes`.
- **Page visibility changes** → next incremental sync re-reads the property; existing chunks are upserted with the new visibility. There can be a window (< 1 day) where stale visibility is enforced — acceptable for V1.
- **Page deleted / archived in Notion** → handled by the monthly full-refresh sweep; chunks for pages no longer in the database query result are deleted. We accept up to 1-month lag on hard deletes; if faster is needed we can add a delete-detection step to the daily incremental.

### What this connector does on day 1

- Reads + enforces the `Visibility` property at ingest (skips untagged pages, stores tag list on each chunk's metadata).
- Does **not** by itself enforce query-time filtering — that's MCP-tool-layer work tracked separately.

The three pieces of infra above are tracked as their own task; the connector is forward-compatible — it stores the data the filter needs, and the filter goes live when the infra lands. Until then, the data is in `document_chunks` but the search tools still return it to any caller. **Do not enable this connector in production until at minimum #2 (caller identity) and #3 (query-time filter) are live.** It's fine to enable it locally for testing.

---

## Environment variables

```
NOTION_API_KEY=                           # Notion internal integration token
NOTION_MEETING_TRANSCRIPTS_DB_ID=         # 32-char Notion database ID
```

Future extension (when knowledge-base pages land):

```
NOTION_KNOWLEDGE_BASE_DB_ID=              # different DB, same connector, different subtype
```

## Rate limits

Notion's public limit is **3 requests/second average**. The connector inserts a 350ms delay between requests to stay safely under. Burst traffic is fine — Notion uses a rolling window, not strict per-second.

429 responses (rate limit exceeded) → exponential backoff, up to 3 retries. Other 5xx → 3 retries with backoff. Other 4xx → log and skip the page.

## Sync run notes

`sync_runs.notes` for this connector should include:
- Total pages discovered in the DB query
- Pages skipped due to missing `Visibility` tag (count)
- Pages skipped due to fetch errors (count)
- Total chunks written
- Tokens spent on embeddings (approximate)

## Implementation files (planned)

```
connectors/notion/
├── package.json                   # add @notionhq/client (or hand-rolled fetch)
└── src/
    ├── notion-client.ts           # auth + paginated GET helpers
    ├── block-walker.ts            # recursive plaintext extraction from page blocks
    ├── chunker.ts                 # block-aware chunking with overlap
    ├── sync-meetings.ts           # the actual sync logic (one DB → document_chunks)
    ├── index.ts                   # orchestrator
    └── cli.ts                     # dotenv loader, dynamic import of index
```

## Future extensions

- **Knowledge base pages**: same connector, second `sync-*.ts` module, different env var pointing at a different DB. Discriminate via `metadata.subtype='knowledge_base'`.
- **Per-attendee linkage**: `metadata.attendees` becomes a JSON array of names; in a future migration, denormalize into a `chunk_attendees` join table so `search_by_person` can do a join rather than a substring match for tighter results.
- **Native Notion connector hybrid**: for live drill-down on specific pages where freshness > cross-source search, expose a `fetch_notion_page` MCP tool that proxies directly to Notion at query time. Doesn't replace the ingest path; complements it.
