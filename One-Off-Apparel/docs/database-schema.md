# Postgres Database Schema

ORM: **Prisma**. The schema lives in `packages/db/prisma/schema.prisma`. The generated Prisma client is output to `packages/db/generated/prisma/` (non-standard path). Migrations are created with `pnpm --filter @lp-ai/lib-db migrate:dev` and applied with `pnpm db:migrate`.

Extensions: `pgvector` (vector similarity), `pg_trgm` (trigram fuzzy matching).

## Tables (31 models)

### Student & Staff Core

#### `students`

Canonical student records. Sourced from the `Students` tab of the "Student Information for Launchpad LLMs" Google Sheet (V1 and V2 versions).

**PII exclusions:** `dob` is stored but was historically excluded; `phone` is stored but should not be exposed via MCP tools. The connector enforces column-level allowlists.

Key columns: `id` (UUID PK), `student_number` (LP#### format, unique), `canonical_name`, `email`, `current_phase`, `enrollment_status`, `cohort`, `gender`, `race_ethnicity`, `school_name`, `hs_graduation_year`, `entry_date`, `withdrawal_date`, `withdrawal_code`, plus academic scores (`interview_score`, `hs_gpa`, `algebra1_grade`, `geometry_grade`), post-program fields (`college_enroll`, `university`, `major`), and V2 additions (`dob`, `suffix`, `rapid_account_number`, `algebra_keystone_score`, `works_outside_launchpad`, etc.).

Indexes: `canonical_name`, `cohort`.

#### `staff`

Canonical staff records. Minimal: `id` (UUID PK), `canonical_name`, `email`, `role`.

Index: `canonical_name`.

#### `entity_aliases`

Maps every known name/handle/ID for a student or staff member back to their canonical record. This is the entity resolution graph.

Key columns: `id` (UUID PK), `alias`, `entity_type` ('student' | 'staff'), `student_id` (FK → students), `staff_id` (FK → staff), `source`, `confidence` (0.00–1.00, default 1.0).

Unique constraint: `(alias, entity_type)`. Index: `entity_type`.

#### `pending_aliases`

Aliases that couldn't be auto-resolved (fuzzy confidence < 0.85). Queued for manual review.

Key columns: `id` (UUID PK), `alias`, `entity_type`, `source`, `context`.

### Student Outcomes & Competency

#### `student_info`

Drive document content per student. Key columns: `id` (UUID PK), `student_id` (FK → students), `drive_file_id`, `content`, `synced_at`.

#### `student_certifications`

Phase completion records. Sourced from the `Certifications` tab. Key columns: `id` (UUID PK), `source_id` (unique, e.g. SP001), `student_id` (FK → students), `type`, `date`, `result`, `score`, `phase`.

Indexes: `student_id`, `phase`, `type`, `date`.

#### `student_phase_outcomes`

Program phase progression per student. One row per student (upsert on `student_id`, unique). Phases: Foundations, Phase 101, Lightspeed, LiftOff — each with `status`, `start_date`, `end_date`.

Index: `student_id`.

#### `student_competencies`

Per-student competency assessments. Key columns: `id` (UUID PK), `source_id` (unique), `student_number`, `competency`, `portfolio`, `baseline`, `performance_level`, `growth`, `progress`, `total_er`, `completed_er`, `missed_er`, `total_opportunities`.

Indexes: `student_number`, `competency`.

#### `student_employment`

Post-program employment data. Key columns: `id` (UUID PK), `source_id` (unique), `student_number` (FK → students via student_number), `employer_name`, `employment_type`, `job_title`, `start_date`, `end_date`, `hourly_wage`, `weekly_hours`, `total_earned`, `exit_code`, `notes`.

Indexes: `student_number`, `employer_name`, `exit_code`.

#### `student_postsecondary`

College enrollment tracking from National Student Clearinghouse. Key columns: `id` (UUID PK), `source_id` (unique), `student_number` (FK → students), `institution`, `institution_length`, `institution_type`, `enrollment_begin`, `enrollment_end`, `enrollment_status` (F/Q/H/L/A/W/D codes), `class_level` (F/S/J/R/C/N/B/M/D/P/L/G/A/T codes), `enrollment_major_1`, `enrollment_major_2`, `graduated`, `graduation_date`, `degree_title`, `degree_major_1/2/3`.

Indexes: `student_number`, `institution`, `enrollment_status`.

### Operational Data

#### `enrollment_snapshots`

Monthly enrollment counts by phase. Key columns: `source_id` (PK), `period_month` (Date), `phase`, `count`.

Indexes: `period_month`, `phase`.

#### `attendance_records`

Unified storage for three Launchpad cohort attendance sheets. Each cohort has a different shape; common fields are promoted to columns and the full source row is preserved in `row_data`.

Key columns: `id` (UUID PK), `source_id` (unique), `cohort` (1|2|3), `student_number` (LP####), `date`, `start_date`, `end_date`, `code` (P/A/E), `percentage` (cohort 1 only), `row_data` (JSON).

Indexes: `student_number`, `(cohort, date)`, `date`.

#### `finance_snapshots`

Generic JSON store for tabular financial and CRM data ingested from multiple Google Sheets. Each row is one source-sheet row; column shapes vary by tab.

Key columns: `id` (UUID PK), `source_id` (unique, format `"{tab_name}:{rowNumber}"`), `tab_name`, `period`, `row_data` (JSON).

Indexes: `tab_name`, `period`.

**Tabs ingested:**

| Source sheet | Stored `tab_name` values |
|---|---|
| Launchpad Dashboard | `Prior Month Budget vs Actual`, `YTD Budget vs Actual`, `Rolling Forecast`, `Monthly`, `Combined Funds`, `Annual` |
| Phase Budget Dashboard | `phase_dashboard:2025 actuals`, `phase_dashboard:monthly liftoff only`, `phase_dashboard:monthly hs only` |
| Phase Actuals Q3 2026 | `q3_2026_actuals:global %`, `q3_2026_actuals:Human capital %`, `q3_2026_actuals:actuals by phase` |
| Phase Actuals 2025 | `phase_actuals_2025:global %`, `phase_actuals_2025:Human capital %`, `phase_actuals_2025:actuals by phase` |
| Rapid stipends | `rapid:Dashboard`, `rapid:FY2023`, `rapid:FY2024`, `rapid:FY2025` |
| PEX stipends | `pex:Dashboard`, `pex:FY2022`, `pex:FY2023`, `pex:FY2024`, `pex:FY2025`, `pex:FY2026` |
| Building21 Development CRM | `development:contacts`, `development:giving history`, `development:prospect pipeline`, `development:denied`, `development:launchpad pipeline`, `development:grants tracker` |

### Donor / Finance

#### `donor_contacts`

Donor contact records from the Development CRM. Key columns: `id` (UUID PK), `givebutter_contact_id`, `first_name`, `last_name`, `email`, `phone`, `organization_name`, `synced_at`.

Relations: `gifts` (DonorGift[]), `pipeline` (DonorPipeline[]).

Index: `organization_name`.

#### `donor_gifts`

Individual gift records. Key columns: `id` (UUID PK), `donor_contact_id` (FK → donor_contacts), `givebutter_tx_id` (legacy, may be null), `amount` (Float), `gift_date`, `campaign_name`, `fund`, `is_recurring`.

#### `donor_pipeline`

Donor prospect pipeline stages. Key columns: `id` (UUID PK), `donor_contact_id` (FK → donor_contacts), `stage`, `ask_amount`, `likelihood`, `notes`.

#### `donor_grants`

Grant tracking records. Key columns: `id` (UUID PK), `funder`, `amount`, `status`, `deadline`, `award_date`, `fund`, `notes`.

### Vector Search & Logging

#### `document_chunks`

Embedded document chunks for semantic search. Key columns: `id` (UUID PK), `source` ('notion', 'drive', 'slack', etc.), `source_id`, `title`, `content`, `embedding` (vector(1536) via pgvector), `metadata` (JSON), `synced_at`.

Index: `(source, source_id)`.

#### `usage_logs`

MCP tool call audit log. Every tool invocation is recorded. Key columns: `id` (UUID PK), `tool_name`, `input_json`, `output_json`, `duration_ms`, `error`, `called_at`, `anthropic_user_id`, `anthropic_user_email`, `anthropic_workspace`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `model`.

Indexes: `tool_name`, `called_at`, `anthropic_user_id`, `anthropic_user_email`.

#### `sync_runs`

One row per connector sync run. Used by HQ dashboard `/sync` page.

Key columns: `id` (UUID PK), `connector`, `status` ('ok' | 'error' | 'noop'), `started_at`, `finished_at`, `records_upserted` (default 0), `error`, `notes`.

Index: `(connector, started_at)`.

### Auth (NextAuth v5)

#### `users`

NextAuth user records for HQ sign-in. Key columns: `id` (cuid PK), `name`, `email` (unique), `email_verified`, `image`.

#### `accounts`

OAuth provider accounts linked to users. Unique: `(provider, provider_account_id)`.

#### `sessions`

NextAuth sessions. Key column: `session_token` (unique).

#### `verification_tokens`

Email verification tokens. Unique: `(identifier, token)`.

### MCP OAuth 2.0 (Phase 23)

These tables gate MCP tool access independently of HQ auth.

#### `mcp_users`

MCP OAuth users, keyed by email. Key columns: `email` (PK), `status` (PENDING | ACTIVE | DISABLED), `roles` (String[]), `last_login`.

Index: `status`.

#### `oauth_clients`

Registered OAuth client applications. Key columns: `client_id` (PK), `client_name`, `redirect_uris` (String[]), `token_lifetime_s` (default 3600).

#### `oauth_authorization_codes`

PKCE authorization codes for the OIDC flow. Key columns: `code` (PK), `client_id`, `user_email`, `redirect_uri`, `code_challenge`, `scopes` (String[]), `expires_at`, `used_at`.

Index: `expires_at`.

#### `oauth_refresh_tokens`

Refresh token storage. Key columns: `token_id` (PK), `client_id`, `user_email`, `expires_at`, `revoked_at`.

Indexes: `user_email`, `expires_at`.

#### `tool_permissions`

Tool-level ACL, editable from HQ `/admin`. The MCP server reads this table (cached ~60s) instead of a static TS registry, so admins can change who can call what without a code deploy.

Key columns: `tool_name` (PK), `allowed_roles` (String[]), `category` ('students' | 'donor_finance' | 'search' | 'future' | 'other'), `description`.

### AWS Infrastructure

#### `aws_resource_jobs`

AWS resource creation requests with approval workflow. Key columns: `id` (UUID PK), `developer`, `action_type` (CREATE | UPDATE | DELETE), `resource_type`, `parameters` (JSON), `plan_output`, `status` (PENDING_APPROVAL | APPROVED | REJECTED | IN_PROGRESS | SUCCEEDED | FAILED), `error`, `approver`.

Indexes: `developer`, `status`.

## Migration Strategy

- Schema source of truth: `packages/db/prisma/schema.prisma`
- Prisma client output: `packages/db/generated/prisma/`
- Config: `prisma.config.ts` (repo root)
- Dev iteration: `pnpm db:push` (no migration file; uses `prisma db push`)
- Production: `pnpm db:migrate` (tracked migrations via `prisma migrate deploy`)
- Create new migration: `pnpm --filter @lp-ai/lib-db migrate:dev`
- Never edit a migration file after it has been applied to any environment — create a new one instead

## Upsert Pattern

All connectors use Prisma's `upsert` method for idempotent syncs:

```ts
await prisma.student.upsert({
  where: { studentNumber: row.studentNumber },
  update: { ...row, updatedAt: new Date() },
  create: row,
});
```

The `source_id` or equivalent unique column holds the primary key from the upstream source.
