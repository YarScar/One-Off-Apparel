-- WP #323: register the new get_grant_document_text tool in the editable ACL table.
--
-- The registry fails closed (apps/mcp-server/src/permissions.ts): no row means denied to everyone,
-- including admin. Same role scope as find_grant_documents — this is the very next step in the same
-- workflow (a catalog hit -> the document's own text), so anyone who can search the catalog should
-- be able to read what it points at. `DO UPDATE`, per root CLAUDE.md's add-mcp-tool rule, not
-- `DO NOTHING` — see 20260806000100_add_find_grant_documents_permission for why `DO NOTHING` is the
-- wrong default here.

INSERT INTO "tool_permissions" ("tool_name", "allowed_roles", "category", "description", "updated_at")
VALUES (
  'get_grant_document_text',
  ARRAY['program_staff','development','finance','leadership','admin'],
  'grants',
  'Fetch the extracted text of a grant document by drive_file_id, for a find_grant_documents hit. Supports Google Docs/Slides and .docx/.dotx today.',
  NOW()
)
ON CONFLICT ("tool_name") DO UPDATE SET
  "allowed_roles" = EXCLUDED."allowed_roles",
  "category"      = EXCLUDED."category",
  "description"   = EXCLUDED."description",
  "updated_at"    = NOW();
