# Google Drive Connector

Discovers the shared Google Drive grant corpus and records it in the `grant_documents`
catalog, so `find_grant_documents` can find files that Drive's own search cannot see.

Read **[google-drive-discovery.md](google-drive-discovery.md)** for the failure this connector
exists to answer, and for what is still unconfirmed about its root cause. This file describes what
the code does; that one describes why it does it that way.

## Purpose

**Discovery, not ingestion — plus an opt-in Docs ingestion path.** The main walk still records one
catalog row per file in `grant_documents`, no text, no embeddings. Alongside it, a **separate,
opt-in path** ingests a small explicit list of Google Docs by ID into `document_chunks` with
embeddings — see "Docs ingestion" below.

The catalog split is deliberate. Inside the shared `Grants` tree, reading a file by ID works and
always did; *finding* a file does not. Embedding the entire corpus to answer questions a catalog
query answers would be cost with no capability behind it. Instead, specific narrative docs (a
Prospecting Criteria document, a playbook, an evaluation guide) can be added to
`GOOGLE_DOC_IDS` and the ingestion path picks them up.

## Docs ingestion (opt-in)

Configured via `GOOGLE_DOC_IDS` — a comma-separated list of `id:Name` pairs. On every sync:

1. Each doc is fetched via **Docs API v1** with `includeTabsContent=true`, so every tab of a
   multi-tab document is included. `files.export?mimeType=text/plain` only reliably returns the
   first tab of a tabbed doc; this path avoids that silent loss.
2. Tab titles become markdown headers so retrieval keeps the tab context in the chunk content.
3. Body is chunked (~1000 chars, 200-char overlap) and embedded with OpenAI
   `text-embedding-3-large` (1536-dim).
4. Rows land in `document_chunks` with `source='drive'`, `source_id='drive:doc:<docId>:<i>'`, and
   metadata including `subtype='doc'`, `google_doc_id`, `doc_title`, `revision_id`, `tab_titles`.

The service account must be explicitly shared on each configured doc (`Share` → paste the
`client_email`) — same permission model as the catalog walk.

## Documents in Scope

Everything under the grant root, currently `1ZqQaFrfVZJ6kPvXNd3pPNVyaL8PpaX3S` ("Grants"),
overridable with `GOOGLE_DRIVE_GRANTS_FOLDER_ID`. Files are **not** matched by name pattern:
name-pattern search is precisely the operation that does not work for this tree.

Every file becomes a `grant_documents` row. Classification is by path, in
[`packages/grants/src/catalog.ts`](../../packages/grants/src/catalog.ts) — the same module the
local-mirror index uses, so a file classifies identically however it was discovered.

| Column | Source |
|---|---|
| `drive_file_id`, `drive_url`, `mime_type`, `size_bytes`, `modified_at` | Drive API |
| `collection`, `funder`, `year`, `doc_kind` | inferred from the path |
| — | `Templates` and `Key Statistics` are organization-level collections, not funders |
| `excluded`, `external_reference`, `archive_only` | inferred from the path (policy flags) |
| `content_class` | Drive MIME type, falling back to the file extension |
| `needs_review` | set when inference was not decisive, or the row was ambiguous |

## Sync Schedule

Not scheduled. Run it when the corpus changes:

```bash
pnpm sync:drive
```

The walk is cheap enough to schedule (see *Efficiency* below) but a catalog of a
human-curated Drive does not change hourly, and nothing yet depends on it being fresh.
Leaving it unscheduled also means the production prerequisites below can be unmet without
generating a failing task every hour.

## Deploying

The connector ships inside the shared `lp-internal/sync` image, which
[`deploy.yml`](../../.github/workflows/deploy.yml) rebuilds whenever anything under
`connectors/` or `packages/` changes. Existing task definitions pin `sync:latest`, so a new
image is picked up by the next task run.

Two things are **not** automated, and the connector will fail loudly rather than quietly if
either is missing:

1. **Register the task definition, once.** No workflow registers `infra/ecs/*.json` — every
   connector's family was registered by hand.
   ```bash
   AWS_PROFILE=lp-internal aws ecs register-task-definition \
     --cli-input-json "$(sed "s/\${AWS_ACCOUNT_ID}/851725317896/g" infra/ecs/sync-google-drive-taskdef.json)"
   ```
   Then run it the same way as any other one-off sync (see the root [CLAUDE.md](../../CLAUDE.md)).
2. **Share the tree with the service account.** This is the prerequisite that decides whether
   any of this works in production, and it needs whoever owns the `Grants` tree — the `.gdoc`
   stubs inside it record `chip@b-21.org`. Until then the run ends with an error in `sync_runs`
   naming exactly this, and the task exits non-zero.
   ```bash
   AWS_PROFILE=lp-internal aws secretsmanager get-secret-value \
     --secret-id lp-internal/google --query SecretString --output text \
     | python3 -c 'import json,sys,base64; print(json.loads(base64.b64decode(json.load(sys.stdin)["GOOGLE_SERVICE_ACCOUNT_JSON"]))["client_email"])'
   ```

Also worth knowing before the first production run:

- **`grant_documents` must exist in RDS.** The `migrate` job in `deploy.yml` *lists* applied
  migrations; it does not apply them. Without
  `migrations/20260806000000_add_grant_documents_catalog`, the sync fails on a missing relation.
- **`GOOGLE_DRIVE_GRANTS_FOLDER_ID` needs no task-definition entry.** With
  `USE_AWS_SECRETS=true`, `loadEnv` pulls the whole `lp-internal/google` secret, so adding the key
  to that JSON is enough. Omit it and the known `Grants` folder ID is used.
- **A user identity is refused in production.** `NODE_ENV=production` or `USE_AWS_SECRETS=true`
  makes `clientFromEnv` ignore the OAuth trio outright, even if it is present in Secrets Manager —
  a scheduled job must not depend on one person's Google account.
- **Every Drive request times out after 30s** and retries with backoff. gaxios has no default
  timeout, and a hung socket in a one-off Fargate task is a task that runs until someone notices.
- **The task exits non-zero when the run fails.** `runSync` records the failure and returns
  normally, so the connector's CLI sets the exit code itself; without that, a failed task reports
  success to ECS.

## Auth

Google Drive API v3, read-only scope (`drive.readonly`), and **two identities**:

| Identity | Env | Used for |
|---|---|---|
| Service account | `GOOGLE_SERVICE_ACCOUNT_JSON` — same key as the Sheets connector | Production, and the scheduled sync |
| A person's own Google account | `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` + `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN` | Local runs against the real corpus |

No identity configured → the sync returns `status: 'noop'`, as every connector does. A fully
configured user identity wins over the service account, because it is only ever set deliberately for
a local run; a half-configured one is ignored rather than used to build a client that cannot
authenticate.

> ⚠️ **The access requirement people get wrong, and the reason there are two identities.** A service
> account is a *separate identity*. It does **not** inherit the "Shared with me" access a human has,
> so being able to open the folder in your own browser proves nothing about whether the walk will
> work. For the service account, the folder must be shared with its `client_email`, **or** that
> account added as a member of the Shared Drive — which needs whoever owns the tree. A team member
> who can already open it does not need any of that, which is what the user identity is for.

### Authorizing your own account

One browser round trip, and nothing is written to disk but `.env`:

1. In the same GCP project (Drive API enabled): **APIs & Services → Credentials → Create
   credentials → OAuth client ID → Desktop app**. Add `http://127.0.0.1:5787/callback` as an
   authorized redirect URI.
2. Put `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in `.env`.
3. `node --env-file=.env --import tsx connectors/google-drive/scripts/authorize.ts`, approve in the
   browser, and paste the printed `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=` line into `.env`.
4. `node --env-file=.env --import tsx packages/grants/scripts/drive-walk-grants.ts --dry-run`

The token is personal and grants read access to everything that account can see, so it belongs in
`.env` (gitignored) and nowhere else. It must not become how production authenticates: a scheduled
job that depends on one person's account breaks when they leave.

## Sync Logic

1. `files.get` on the root, with `supportsAllDrives` — reports the folder's name and its
   **`driveId`**, which is the fact that tells you whether this is a Shared Drive at all.
2. Enumerate the tree (see *Efficiency*).
3. Refuse an empty listing. Reading the root but listing nothing inside it is the discovery bug's
   exact signature, so the connector **throws** rather than reporting a successful zero-record run.
   The same reasoning applies one level down: a folder reached through a shortcut is probed before
   being walked, so an inaccessible subtree is named, not silently read as empty.
4. Reduce to one entry per Drive file. Three files in the corpus are filed at two or three paths
   (a shortcut in an application folder, the file itself under reporting) and `drive_file_id` is
   unique, so the instance where the file lives wins and the alias paths are reported.
5. Reconcile each Drive file against the catalog — see *Identity*.
6. Upsert. Matched rows are updated; unmatched files become new rows.

### Efficiency

Drive has no recursive listing, so the obvious walk is one `files.list` per folder: ~600 calls for
this corpus, ~600 round trips, and ~600 chances to be rate-limited mid-walk. When the root is in a
Shared Drive, the connector instead sweeps the whole drive with `corpora: 'drive'` in
`ceil(n / 1000)` pages and reassembles the tree locally from each file's `parents` — same answer,
two orders of magnitude fewer calls. The per-folder walk remains as the fallback for a My Drive
root, where a drive-scoped sweep is not available.

A drive-scoped sweep needs membership of that drive, so an identity holding the folder by direct
share but not the drive gets 403 or 404. That is caught and falls back to the folder walk rather
than failing the run — slower beats nothing, and the run's notes say which path it took.

**Every Drive call sets `supportsAllDrives` and `includeItemsFromAllDrives`.** Without both, a
Shared Drive returns nothing at all — no error, just an empty list. That is why there is exactly one
module ([`drive-client.ts`](../../connectors/google-drive/src/drive-client.ts)) permitted to talk to
Drive: a single omission reintroduces the original bug silently.

Rate limits and 5xx responses are retried with exponential backoff. An unhandled 429 would truncate
the walk into a wrong answer that looks like a right one.

### Identity

The catalog was first built from a local mirror produced by *downloading* the tree, which converted
Google-native files to Office formats and rewrote characters in names — so the same document exists
under two spellings, and only one of them has a Drive ID.
[`reconcile.ts`](../../connectors/google-drive/src/reconcile.ts) resolves each Drive file to a row by
strongest evidence first:

1. **`drive_file_id`** — an ID is the file, whatever either path says.
2. **Exact path.**
3. **Normalized path**, and only when unique. Undoes the `/`→`_` and `:`→`_` substitution and the
   `.gdoc`/`.gsheet` suffix on Google-native files.
4. **Loose key**, and only when unique — punctuation collapsed to single spaces and the extension
   dropped. No single substitution rule covers what downloading did: Drive's `Meetings / Site Visit`
   came down as `Meetings - Site Visit` in one place and `Meetings _ Site Visit` in another. On the
   real corpus this tier recovers 538 rows the precise keys miss.
5. **Same filename inside the same funder folder**, and only when unique on *both* sides — the
   file-moved-deeper case, 18 rows in the real corpus. Filename alone would be reckless:
   `Launchpad Team 012023` exists under two different funders here, and matching those would stamp one
   funder's Drive ID onto the other's row.
6. **No match** → a new row.

Two candidates is never resolved by picking one — 60 files hit that on the real corpus and became new
rows flagged `needs_review`. A wrong ID silently serves the wrong document to a grant writer, which
is worse than a row a human has to look at.

**Shortcuts are resolved to `shortcutDetails.targetId`,** because a shortcut's own ID reads as empty
content. Two further facts, both measured rather than assumed:

- **A shortcut's target is often unreadable.** 10 of 22 in the corpus point at files in someone
  else's drive. The walk probes each one and records `unreadable`, which the sync stores as
  `content_class = 'unknown'` so `find_grant_documents` reports `fetchable: false` rather than
  handing over an ID that 404s.
- **A shortcut may point at a folder** (7 in the corpus). Those are traversal instructions, not
  documents, so they are followed rather than catalogued — and probed first, because an inaccessible
  folder **lists as empty rather than failing**, which is the original bug's own signature. 6 of the 7
  are inaccessible and are reported by path in the run's output.

A matched row keeps its stored `path` rather than adopting Drive's spelling, so that
`load-grant-catalog.ts` — which upserts on the mirror's spelling — stays idempotent alongside this.

## Error Handling

- Missing credentials → `status: 'noop'`, no rows touched
- Root not readable, or not a folder → the sync fails, error lands in `sync_runs`
- Root readable but empty listing → the sync fails **loudly**, naming the access requirement above
- Rate limit / 5xx → retried with backoff, then failed
- Broken shortcut (no target) → skipped
- Ambiguous identity → new row, flagged `needs_review`; nothing is overwritten

**Never deletes.** Per the sync safety rule in the root [CLAUDE.md](../../CLAUDE.md), absence from
a run is not evidence a document is gone — the thing that vanished may be the credential's access.
Rows the walk did not reach are counted in `sync_runs.notes` and left alone. The 5% integrity guard
is armed via `tables: ['grant_documents']`, so a run that shrinks the catalog says so.

## Environment Variables Required

```
GOOGLE_SERVICE_ACCOUNT_JSON=        # base64-encoded service account JSON
GOOGLE_DRIVE_GRANTS_FOLDER_ID=      # optional; defaults to the known "Grants" folder
DATABASE_URL=

# Or, for a local run as your own account, instead of the service account key:
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=   # from scripts/authorize.ts
```

`OPENAI_API_KEY` is **not** required — this connector computes no embeddings.

## Connector Location

`connectors/google-drive/`

| File | Role |
|---|---|
| `index.ts` | `sync()` — the `runSync` wrapper, the noop-when-unconfigured check |
| `drive-client.ts` | The only code that talks to Drive. Flags, retries, paging, shortcut resolution, tree reassembly |
| `reconcile.ts` | Drive file → catalog row identity. Pure |
| `scripts/authorize.ts` | One-time browser consent for a user identity. Prints a refresh token; writes nothing |
| `sync.ts` | Orchestration: walk, classify, upsert |

Classification lives in [`packages/grants/src/catalog.ts`](../../packages/grants/src/catalog.ts),
shared with `packages/grants/scripts/build-grants-index.ts`.

## Related

- [`find_grant_documents`](../mcp-server-spec.md) — the tool that reads this catalog
- [`packages/grants/scripts/drive-walk-grants.ts`](../../packages/grants/scripts/drive-walk-grants.ts)
  — CLI over the same sync, with `--dry-run` and a `data/drive-manifest.jsonl` audit trail
- The student-document ingestion this file used to describe was never built. If it is wanted, it is
  a second, separate sync — the `Grants` corpus and the student seed documents share nothing but a
  credential.
