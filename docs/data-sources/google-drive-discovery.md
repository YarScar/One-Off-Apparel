# Google Drive discovery — diagnosis and remediation

**Status:** diagnosed 2026-08-06. Discovery rebuilt on branch `fix/google-drive-discovery` the same
day; **root cause still unconfirmed**, because confirming it needs credentials this environment does
not hold (`GOOGLE_SERVICE_ACCOUNT_JSON` is empty locally).
**Owner:** the branch above. What it landed is in §5.1; what it could not is in §6 Fix 1.

Read this before touching `connectors/google-drive/` or the Drive MCP path.
[`google-drive-connector.md`](google-drive-connector.md) beside it now describes the connector as
built — it was rewritten when §7's debt was paid.

---

## 1 The symptom

Two tools were reported as "returning nothing" for grant material:

- the **Google Drive** MCP connector
- **LP Internal AI**'s `search_documents`

Both reports were accurate. They have **two unrelated causes**, and conflating them wastes a branch.

---

## 2 What was verified

Every row below is an observed result, not an inference. The Drive calls went through the Claude
Google Drive MCP connector as the signed-in user (`ddelu0068@launchpadphilly.org`).

### 2.1 Drive: reads work, discovery does not

| Call | Target | Result |
|---|---|---|
| `get_file_metadata` | `Grants` (`1ZqQaFrfVZJ6kPvXNd3pPNVyaL8PpaX3S`) | ✅ metadata, `canAddChildren: true` |
| `search_files` `parentId =` | `Grants` root | ✅ its 3 child folders |
| `get_file_metadata` | `Prospects and Proposals` (`1OzVfuplSHn5Stx5KUbm9FXYFmpBZAOs9`) | ✅ metadata, `canAddChildren: true` |
| `search_files` `parentId =` | `Prospects and Proposals` | ❌ **`{}`** |
| `search_files` `parentId =` | `Current and Past` (`1gO3K7MYyL6Cz5IIUvEQmlKt7vHvZcx94`) | ❌ **`{}`** |
| `search_files` `title contains 'Truist'` | whole corpus | ❌ one unrelated shortcut only; never the real `8_10_2026 Truist Application.docx` |
| `read_file_content` | shortcut `1R5hkoEmHmJT7g5z1DlgTF6b2LMabvORP` | ❌ `{}` |
| `read_file_content` | **`1mnx4NjQlZFHDljMgcpeSa-368C4wcYHkKsXkRQ7vRCo`** (Cambiar Thrive working response, *inside* the tree) | ✅ **full document text** |

**The shape of the bug: content is readable by ID, but nothing inside the tree is discoverable.**

That last row is the load-bearing one. The ID came from a `.gdoc` stub in the local mirror (see §3),
not from any Drive search — which is the whole point: there is currently no way to *obtain* such an ID
through Drive itself.

### 2.2 LP Internal AI: the table is empty

```
select source, count(*) from document_chunks group by source;   -- (0 rows)
```

Empty for **every** source, not just Drive — including the Notion sync that the README describes as
live. `connectors/google-drive/src/index.ts` is 16 lines returning `status: 'noop'`. Nothing has ever
been ingested locally, so `search_documents` has nothing to match. This is not a query problem and no
change to the tool will fix it.

---

## 3 What is *not* the cause

Ruled out by test. Do not re-litigate these on the branch.

- **Not the `parentId`-is-not-recursive limitation.** That is real in the Drive API, but it is not this.
  `Meeting Transcripts` (`1Y0Lb9oq2McIN3FKsJrkqxdEAIfw51KUH`) and `Project Management (do not ingest)`
  (`1mLDSjnPIkZ1kAFrdfMi__LTqlfXAkL-J`) are nested just as deep under `Launchpad Internal AI OS` and
  **list their children fine**. Recursion by repeated `parentId` calls works elsewhere in this Drive.
  *(An earlier diagnosis in this workstream claimed recursion was the cause. It was wrong.)*
- **Not a permissions failure on the folder.** Metadata reads succeed and report `canAddChildren: true`.
- **Not query syntax.** The same `parentId =` form succeeds one level up and in a sibling tree.
- **Not depth.** The failure appears at depth 1 below `Grants`, shallower than working cases elsewhere.

---

## 4 Hypotheses, and the test that settles each

Ranked by fit. **None is confirmed** — confirming requires a Drive API call with credentials that were
not available when this was diagnosed (`GOOGLE_SERVICE_ACCOUNT_JSON` is empty in `.env`, and
`USE_AWS_SECRETS=true` routes secrets through AWS Secrets Manager).

### H1 — Shared Drive queried without the shared-drive flags *(best fit)*

`files.list` omits shared-drive items unless **both** `supportsAllDrives: true` and
`includeItemsFromAllDrives: true` are set. That produces exactly this signature: get-by-ID works,
listing returns empty, shortcut resolution fails.

Consistent with `Launchpad Internal AI OS` working — it is an ordinary My Drive folder curated with
shortcuts — while `Grants` (created 2022-06-02; the `.gdoc` stubs inside it all record `chip@b-21.org`, so the
files are owned outside the caller's account) does not.

> **Decisive test.** `drive.files.get({ fileId: '<Grants id>', fields: 'driveId', supportsAllDrives: true })`.
> A non-null `driveId` means it is in a Shared Drive and H1 is confirmed.
> `packages/grants/scripts/drive-walk-grants.ts` already sets both flags and prints the `driveId`.

### H2 — The connector indexes only the caller's own corpus

The Claude Drive connector may search an index covering My Drive plus explicitly-shared items, and not
descendants that are reachable only by *inherited* permission from a shared parent. `Grants` itself was
shared directly (it has a `sharedWithMeTime` of 2026-07-27) and is therefore indexed; its descendants
were never shared individually and are not.

> **Decisive test.** If H1's `driveId` comes back null, share one deep subfolder directly with the
> account and retry `parentId =` against it. Success implicates indexing, not shared drives.
> If H1 is confirmed instead, H2 needs no separate test.

### H3 — Both

H1 explains the API; H2 explains the connector. These are not exclusive, and the fixes differ: H1 is
fixed in *our* code, H2 can only be worked around. **This is why the catalog in §5 was built rather
than waiting for a root-cause fix** — a connector-side limitation is not ours to patch.

---

## 5 Already landed — do not redo

Committed mitigation, on the assumption that discovery had to be replaced rather than repaired.

| Artifact | Purpose |
|---|---|
| `grant_documents` table (`migrations/20260806000000_…`) | Catalog: one row per file, **no document text** |
| `find_grant_documents` (`apps/mcp-server/src/tools/`) | MCP tool — filter by funder / year / kind, returns Drive file IDs |
| `migrations/20260806000100_…` | `tool_permissions` row; without it the tool fails closed for everyone |
| `packages/grants/scripts/build-grants-index.ts` | Read-only walk of `data/` → CSV / JSONL / summary |
| `packages/grants/scripts/load-grant-catalog.ts` | Index → catalog; harvests IDs from `.gdoc`/`.gsheet` stubs |
| `packages/grants/scripts/drive-walk-grants.ts` | **Backfills Drive IDs. Sets the shared-drive flags.** Never run successfully |
| `packages/grants/scripts/export-grant-catalog.ts` | Catalog → `data/grant-catalog.{json,csv}` |

The design bet: **query the catalog to find documents, then fetch by ID from Drive.** Verified sound by
the §2.1 success row. It means 3.5+ GiB stays reachable with nothing embedded.

**State when the catalog was built: 1252 rows catalogued, 9 with a Drive ID.** All 9 were Cambiar
Education `.gdoc`/`.gsheet` stubs — the only place the local mirror records an ID. The other 1243
were listable but **not fetchable**. §5.1 replaced the mechanism that produced those numbers; it has
not yet been run against Drive, so they are still the live numbers.

### 5.1 Landed 2026-08-06 on `fix/google-drive-discovery`

Discovery was rebuilt as a connector rather than left as a one-off script. The catalog table, the
`find_grant_documents` tool and the design bet above are unchanged.

| Artifact | What it does |
|---|---|
| `connectors/google-drive/src/drive-client.ts` | **The only code permitted to call Drive.** Sets `supportsAllDrives` + `includeItemsFromAllDrives` on every call, retries 429/5xx with backoff, resolves shortcuts to `targetId`, reports the root's `driveId` |
| `connectors/google-drive/src/reconcile.ts` | Drive file → catalog row identity: `drive_file_id`, then exact path, then *unique* normalized path, then a new row. Never picks between two candidates |
| `connectors/google-drive/src/sync.ts` | Walk → classify → upsert. **Throws** on a readable-but-empty listing instead of reporting `ok, 0 records` |
| `connectors/google-drive/src/index.ts` | `sync()` — real, no longer a `noop` stub. Declares `tables: ['grant_documents']` for the integrity guard |
| `packages/grants/src/catalog.ts` | Path classification, extracted from `build-grants-index.ts` so Drive-discovered and mirror-discovered files classify identically. Was untested; now 24 cases |
| `packages/grants/scripts/drive-walk-grants.ts` | Reduced to a CLI over the connector — `--dry-run` plus the manifest. Its own copy of the walk is gone |
| `connectors/google-drive/scripts/authorize.ts` | One-time browser consent for a **user** identity, so the walk can be run by someone who can already open the tree. See §6 Fix 1 |

Three behaviour changes worth knowing:

- **Enumeration is now `ceil(n/1000)` API calls, not ~600.** Where the root is in a Shared Drive,
  the connector sweeps it with `corpora: 'drive'` and reassembles paths locally from `parents`. The
  per-folder walk remains as the My Drive fallback.
- **Drive-only files now get catalog rows.** The old script could only stamp IDs onto rows the local
  mirror had already created, so the ~1243-file gap between the 1.6 GB mirror and the 3.5+ GiB corpus
  was permanently invisible. Drive is now the discovery source; the mirror is a secondary one.
- **`parseYear` fixed.** It documented `8_7_2026 GSK Grant` as handled and returned null for it —
  underscores are word characters, so `\b(20\d{2})\b` never matched. Every underscore-dated file in
  the tree was losing its year, and with it its `archive_only` decision.

## 6 The remediation, in order

### Fix 1 — Confirm the root cause *(still open, no longer blocking)*

**Not done.** It needs credentials that are not available here, so §5.1 was built to be correct under
either hypothesis rather than waiting: the shared-drive flags are set unconditionally, and the
connector reports the root's `driveId` in `sync_runs.notes` on every run. The first successful run
therefore answers this question as a side effect.

It stopped blocking, but it is still worth one deliberate call — H1 and H2 differ in whether anything
is ours to fix.

**The cheapest way to make that call, now available.** The service-account route needs the tree's
owner (`chip@b-21.org`) to share it, which no one here controls. So the connector also accepts a
*user* identity:

```bash
# once: Desktop-app OAuth client in the same GCP project, Drive API enabled,
# redirect URI http://127.0.0.1:5787/callback, client id + secret in .env
node --env-file=.env --import tsx connectors/google-drive/scripts/authorize.ts
# then, read-only, writes nothing:
node --env-file=.env --import tsx packages/grants/scripts/drive-walk-grants.ts --dry-run
```

This runs **the same human identity the Claude Drive connector failed with**, but with
`supportsAllDrives` + `includeItemsFromAllDrives` set. That makes it a direct H1/H2 discriminator:

| Result | Reading |
|---|---|
| Walk enumerates the tree | **H1 confirmed** — the flags were the bug, and they are ours, and they are fixed |
| `driveId` non-null but the sweep 403s, and the folder walk then enumerates | Shared Drive, non-member identity. H1 in substance; the fallback path is what carries it |
| Still empty from a user identity with the flags set | **H2** — the Claude connector's index, not our query. Nothing further for us to fix; the catalog is the answer |

```bash
# The service account's identity — this is the address the folder must be shared with
AWS_PROFILE=lp-internal aws secretsmanager get-secret-value \
  --secret-id lp-internal/GOOGLE_SERVICE_ACCOUNT_JSON \
  --query SecretString --output text | base64 -d | grep client_email

# Reports driveId, then walks. Writes nothing.
node --env-file=.env --import tsx packages/grants/scripts/drive-walk-grants.ts --dry-run
```

**Acceptance:** you can state whether `Grants` has a `driveId`, and whether the walk enumerates >1000
files or returns zero.

> ⚠️ **The access requirement people get wrong.** A service account is a *separate identity*. It does
> **not** inherit the "Shared with me" access a human has. Being able to open the folder in your own
> browser proves nothing about whether the walk will work. The folder must be shared with the service
> account's `client_email`, **or** that account added as a member of the Shared Drive.

### Fix 2 — Backfill Drive IDs *(mechanism landed, not yet run)*

`pnpm sync:drive`, or `drive-walk-grants.ts --dry-run` first. Identity resolution is described in
§5.1 and in the connector doc; the rule that matters is that it **skips ambiguous matches rather than
guessing**, because a wrong ID silently serves the wrong document.

**Acceptance:** `find_grant_documents({only_fetchable: true})` returns on the order of 1000 rows, not 9.
Then re-run `export-grant-catalog.ts`.

**No leftovers to chase any more.** Files Drive holds that the mirror never did become new catalog
rows rather than lines in `data/drive-unmatched.txt`. The run's `created` count is the size of that
gap, reported in `sync_runs.notes`.

### Fix 3 — Resolve shortcuts *(landed)*

`read_file_content` on a shortcut returns `{}` (§2.1), so `drive-client.ts` stores
`shortcutDetails.targetId` and records the shortcut's own ID separately. Still true for consumers:
**`find_grant_documents` callers must not assume a stored ID is a shortcut-free target** for rows
added by any path other than this connector.

### Fix 4 — Decide the connector's fate *(decided for the corpus; question 2 still open)*

**Decision on question 1: no text ingestion.** The connector discovers and catalogs; it writes no
`document_chunks` rows and needs no `OPENAI_API_KEY`. Fetch-by-ID already covers retrieval, so
embedding the corpus would be cost without capability. Revisit if semantic search over the corpus is
actually asked for — the ~360 non-excluded `application_response` rows are the subset to start with,
not the whole corpus. Question 2 is untouched.


`connectors/google-drive` is a `noop` stub, and `document_chunks` is empty for every source. Two
separate decisions, easy to conflate:

1. **Does the Drive connector still need to ingest text at all?** The catalog covers *discovery*, and
   fetch-by-ID covers *retrieval*. Full-text embedding of 3.5+ GiB may now be unnecessary. If some
   semantic search is still wanted, the 360 non-excluded `application_response` rows are the high-value subset —
   not the whole corpus.
2. **Why is `document_chunks` empty for `notion` too?** The README calls that connector live. Either it
   has never run against this database or it is broken. Unknown, and out of scope for the Drive fix, but
   it is the reason `search_documents` returns nothing for *everything*.

### Fix 5 — Reconcile the stale connector spec *(done)*

[`google-drive-connector.md`](google-drive-connector.md) was rewritten to describe the connector as
built. See §7.

---

## 7 Documentation debt this created

**Paid 2026-08-06.** [`google-drive-connector.md`](google-drive-connector.md) was rewritten to
describe the connector as built: the grant corpus, the discovery failure, the catalog, the identity
rules, and the deliberate absence of text ingestion. Its two specific defects are gone with it — the
name-pattern "Sync Logic" step that could not work for this tree, and the dead
`docs/embedding-pipeline.md` link (that link no longer exists anywhere, retiring
`packages/grants/CLAUDE.md` §4 item 2's fifth target).

**What that file used to promise and the code never did.** It described ingesting two student
documents and named one of them the primary seed source for entity resolution. No such code was ever
written — the connector was a 16-line `noop` — and entity resolution does not depend on it. The
rewritten file records that as a *possible second sync*, not as existing behaviour.

Also reconciled in the same pass, per `packages/grants/CLAUDE.md` §1 — grep for the claim, not the
filename:

```bash
grep -rn 'GOOGLE_DRIVE_FOLDER_ID\|google-drive\|skeleton' docs/ README.md CLAUDE.md packages/grants/*.md
```

| File | Claim fixed |
|---|---|
| `CLAUDE.md` | connector table: `google-drive` was "Skeleton — implementation pending"; `pnpm sync:drive` comment |
| `README.md` | connector table and the "Remaining connectors" status line |
| `docs/runbooks/local-dev.md` | `pnpm sync:drive # (skeleton)` |
| `docs/mcp-server-spec.md` | `find_grant_documents` — IDs come from the connector now, not only the script |
| `packages/grants/CLAUDE.md` §3 | connector status, test counts, the Drive discovery paragraph |
| `packages/grants/CHANGELOG.md` | the entry for all of the above |

---

## 8 Open unknowns

State these as unknown rather than guessing. Each names what would settle it.

| Unknown | What settles it |
|---|---|
| Is `Grants` in a Shared Drive? | Still unknown. Any successful `pnpm sync:drive` now prints it and records it in `sync_runs.notes` — the connector asks on every run |
| Can the service account see the tree? | Still unknown. `drive-walk-grants.ts --dry-run`. A readable root with an empty listing now fails loudly instead of looking like success |
| Does the rebuilt walk work at all against real Drive? | **Nothing here has been run against Drive.** The logic is covered by 24 unit tests with a fake client; the API path is unexercised |
| Is H2 (connector indexing) also in play? | Share one deep subfolder directly, retry `parentId =` |
| Why is `document_chunks` empty for `notion`? | Run `pnpm sync:notion` and read the `sync_runs` row |
| Do the grant `tool_permissions` rows exist in **production**? | Needs an ECS one-off task or the bastion; RDS is not publicly reachable. Pre-existing gap — `packages/grants/CLAUDE.md` §3 |
| True corpus size and file count | The walk's manifest, `data/drive-manifest.jsonl` |

---

## 9 Reproducing the diagnosis

The evidence in §2.1 is reproducible through the Drive MCP connector without any credentials:

1. `get_file_metadata` on `1OzVfuplSHn5Stx5KUbm9FXYFmpBZAOs9` → succeeds.
2. `search_files` with `parentId = '1OzVfuplSHn5Stx5KUbm9FXYFmpBZAOs9'` → `{}`.
3. `search_files` with `parentId = '1mLDSjnPIkZ1kAFrdfMi__LTqlfXAkL-J'` → succeeds. **This is the
   control** that rules out depth and recursion.
4. `read_file_content` on `1mnx4NjQlZFHDljMgcpeSa-368C4wcYHkKsXkRQ7vRCo` → full text, proving
   fetch-by-ID works inside the tree.

Steps 2 and 3 together are the finding. Run them in that order.
