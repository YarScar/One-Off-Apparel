-- Catalog of the Google Drive "Grants" tree: one row per file, no document text.
--
-- Why this table exists: Drive *discovery* is broken for that tree. Listing a
-- subfolder's children (`'<id>' in parents`) returns an empty set, and title /
-- fullText search never matches anything inside it — while fetching a file by
-- its ID returns full content. So the corpus can be read but not found.
--
-- This catalog restores the find half. `find_grant_documents` narrows ~1250 files
-- to a handful using these columns, and the caller then fetches only those from
-- Drive by `drive_file_id`. 3.5+ GiB stays reachable with nothing embedded.
--
-- `funder`, `year`, and `doc_kind` are inferred from folder names by
-- packages/grants/scripts/build-grants-index.ts. They are best-effort labels;
-- `needs_review` marks the rows where inference was not decisive.

CREATE TABLE IF NOT EXISTS "grant_documents" (
  "id"                 TEXT NOT NULL,
  -- Null until the Drive walk backfills it: the local mirror records no IDs.
  "drive_file_id"      TEXT,
  -- Stable identifier before IDs exist, and the merge key for the walk.
  "path"               TEXT NOT NULL,
  "filename"           TEXT NOT NULL,
  "drive_url"          TEXT,
  "mime_type"          TEXT,

  "collection"         TEXT NOT NULL,
  "funder"             TEXT,
  -- Year applied, not the year a multi-year grant period ends.
  "year"               INTEGER,
  "doc_kind"           TEXT NOT NULL,

  "excluded"           BOOLEAN NOT NULL DEFAULT false,
  -- Not authored by Launchpad; implies archive_only.
  "external_reference" BOOLEAN NOT NULL DEFAULT false,
  -- Reference only: never use as drafting context.
  "archive_only"       BOOLEAN NOT NULL DEFAULT false,
  "needs_review"       BOOLEAN NOT NULL DEFAULT false,

  "ext"                TEXT,
  "content_class"      TEXT,
  "size_bytes"         BIGINT,
  "modified_at"        TIMESTAMP(3),

  "synced_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "grant_documents_pkey" PRIMARY KEY ("id")
);

-- `path` is the upsert key for the local index pass; `drive_file_id` is the
-- upsert key once the Drive walk has run. Both must be unique for those
-- ON CONFLICT targets to work.
CREATE UNIQUE INDEX IF NOT EXISTS "grant_documents_path_key"
  ON "grant_documents" ("path");
CREATE UNIQUE INDEX IF NOT EXISTS "grant_documents_drive_file_id_key"
  ON "grant_documents" ("drive_file_id");

CREATE INDEX IF NOT EXISTS "grant_documents_funder_idx"     ON "grant_documents" ("funder");
CREATE INDEX IF NOT EXISTS "grant_documents_year_idx"       ON "grant_documents" ("year");
CREATE INDEX IF NOT EXISTS "grant_documents_doc_kind_idx"   ON "grant_documents" ("doc_kind");
CREATE INDEX IF NOT EXISTS "grant_documents_archive_ext_idx"
  ON "grant_documents" ("archive_only", "external_reference");
CREATE INDEX IF NOT EXISTS "grant_documents_collection_year_idx"
  ON "grant_documents" ("collection", "year");
