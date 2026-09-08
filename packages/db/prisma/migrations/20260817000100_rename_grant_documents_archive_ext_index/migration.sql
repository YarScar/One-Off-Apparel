-- Rename grant_documents_archive_ext_idx to the name Prisma derives from schema.prisma.
--
-- Work package #256, and it is the same class of defect as #254 arriving from a different branch.
-- 20260806000000_add_grant_documents_catalog hand-wrote the index as
-- `grant_documents_archive_ext_idx`. schema.prisma declares `@@index([archiveOnly, externalReference])`
-- on model GrantDocument, from which Prisma derives
-- `grant_documents_archive_only_external_reference_idx`. So `prisma migrate diff --from-migrations`
-- reported a RenameIndex on every run, and a developer running `prisma migrate dev` on a migrate-built
-- database got a drift prompt.
--
-- Why a new migration rather than an edit to 20260806000000: that migration is APPLIED IN PRODUCTION.
-- It was deployed from fix/google-drive-discovery on 2026-08-06, before main became the only deploy
-- branch, so its checksum is recorded on RDS and editing it is what `prisma migrate deploy` refuses on
-- principle.
--
-- A rename is metadata only. No index is rebuilt, no table is locked beyond the catalog update, and no
-- query plan changes.
--
-- Idempotent: guarded on the old name existing, so it is a no-op wherever the rename has already
-- happened or the catalog was built from schema.prisma directly via `db push`.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'grant_documents_archive_ext_idx' AND relkind = 'i'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'grant_documents_archive_only_external_reference_idx' AND relkind = 'i'
  ) THEN
    ALTER INDEX "grant_documents_archive_ext_idx"
      RENAME TO "grant_documents_archive_only_external_reference_idx";
  END IF;
END $$;
