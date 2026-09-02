# Phase 5 — Google Connectors (Sheets + Drive)

**Goal:** Set up Google service-account access, configure the connector environment, run the Sheets and Drive syncs against RDS, and authorize calendar access for the HQ meeting router.

**Prerequisites:**
- Phase 4 complete — Prisma schema migrated, all tables exist
- A Google Cloud project (`lp-internal-ai`) with a service account and JSON key
- The Google Sheet IDs and Drive folder ID for the data you're ingesting

---

## 1. Service account credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **IAM & Admin → Service Accounts**.
2. Confirm the service account exists (`lp-internal-ai-os@lp-internal-ai.iam.gserviceaccount.com`) and has a JSON key. If not: **Actions → Manage keys → Add key → JSON** → download.
3. Base64-encode the key:

```bash
base64 -i path/to/service-account.json | tr -d '\n'
```

Store the result as `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`, and mirror it to `lp-internal/google` in AWS Secrets Manager for production.

---

## 2. Grant the service account access

Notion integrations and Google APIs are both deny-by-default — the service account only sees resources explicitly shared with it.

- **Each Google Sheet:** open the sheet → **Share** → add the service account email with **Viewer** access. Repeat for every spreadsheet listed in your `GOOGLE_SHEETS_*` env vars.
- **Drive folder:** give the service account **Viewer** access on the Drive docs folder (`GOOGLE_DRIVE_FOLDER_ID`).

---

## 3. Configure environment variables

Set the resource IDs the connectors read. The full list is in `packages/config/src/schema.ts`; the Google ones are:

- `GOOGLE_SERVICE_ACCOUNT_JSON` — base64 key from step 1
- `GOOGLE_DRIVE_FOLDER_ID` — Drive docs folder
- `GOOGLE_SHEETS_*` — one ID per source spreadsheet (Dashboard, Outcomes, attendance cohorts, finance workbook, etc.)

Only the IDs you set are synced; an unset sheet is skipped.

---

## 4. Run the Sheets sync

```bash
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1"
pnpm --filter @lp-ai/connector-google-sheets build
pnpm sync:sheets
```

Expected output: per-tab row counts (students, enrollment, certifications, attendance, competency, donors, …).

Spot-check in Prisma Studio:

```bash
pnpm db:studio
```

Open the `students` table and confirm rows match the source Google Sheet.

---

## 5. Run the Drive sync

```bash
pnpm --filter @lp-ai/connector-google-drive build
pnpm sync:drive
```

The Drive connector writes chunked document content (and, once embeddings are configured in Phase 6, vector embeddings) into `document_chunks` with `source = 'google-drive'`. It is currently a skeleton — wire up the implementation before relying on its output.

---

## 6. Calendar access for the meeting router (domain-wide delegation)

The HQ meeting router (`apps/hq/app/api/notion/meeting-router`) enriches each recorded
meeting with calendar context: it reads the **organizer** of the meeting's Google
Calendar event (to set the `Track`) and the **attendees** (to link them to People &
Entities). It does this by having the service account **impersonate the user who
recorded the meeting** and read that user's calendar — standard domain-wide delegation
(DWD). This is an **org-wide, one-time admin setup with no per-user action**.

### One-time setup (Google Workspace admin)

1. **Authorize the service account for domain-wide delegation:**
   Google Workspace Admin console → **Security → Access and data control → API controls
   → Domain-wide delegation → Add new**:
   - **Client ID:** `116086895776038458504`
     (service account `lp-internal-ai-os@lp-internal-ai.iam.gserviceaccount.com`)
   - **OAuth scopes:** `https://www.googleapis.com/auth/calendar.readonly`
2. **Enable the Calendar API** in the Google Cloud project `lp-internal-ai`:
   APIs & Services → Library → **Google Calendar API** → Enable.
   (Hosting is on AWS, but Google API auth always runs through a Google Cloud project.)

No per-user step is required; new employees are covered automatically.

### Related env vars

| Var | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account key (from step 1; reused for calendar) |
| `NOTION_MEETING_TRANSCRIPTS_DB_ID` | The unified Meetings DB the router writes to |
| `NOTION_PEOPLE_DB_ID` | People & Entities DB (attendee→People linking, query by Email) |
| `NOTION_WEBHOOK_SECRET` | Notion webhook signature verification token |

### How it works at runtime

Recording lands in the Meetings DB (via Notion AI Meeting Notes) → Notion webhook hits
the router → router impersonates `note.created_by`, lists events ±2h around the note's
timestamp, matches the event, and writes back `Track` (from organizer), `Attendees`
(matched People) + `Attendee Emails` (raw, lossless), and `Calendar Event ID`.
`Visibility` is left unset on purpose (the ingest connector fail-closes on missing
visibility, so transcripts aren't searchable until a human tags them).

---

## Verification checklist

- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` set in `.env` and `lp-internal/google` secret
- [ ] Service account shared (Viewer) on every source Sheet and the Drive folder
- [ ] `pnpm sync:sheets` completes without errors
- [ ] `students`, `attendance_records`, `student_competencies`, `enrollment_snapshots` populated in Prisma Studio
- [ ] `donor_contacts`, `donor_gifts` populated from the Development CRM sheet
- [ ] `pnpm sync:drive` completes without errors
- [ ] (When the meeting router is in use) DWD authorized + Calendar API enabled

---

## Known pitfalls

- **403 on Sheets API** — the service account must be shared on each Google Sheet explicitly (open sheet → Share → paste the service account email).
- **Drive folder access** — the service account must have Viewer access on the Drive folder.
- **Upsert key conflicts** — every sync upserts on a stable natural key (e.g. canonical name for students), never an auto-generated row ID. See the sync-safety rule in `CLAUDE.md`.

---

**Next:** [06-embeddings-pgvector.md](06-embeddings-pgvector.md)
