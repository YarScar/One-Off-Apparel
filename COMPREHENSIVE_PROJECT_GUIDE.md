# LP Internal AI — Comprehensive Project Guide

**Last updated:** July 2026  
**Status:** Production (Phase V1)  
**Scope:** Read-only database access maintained throughout

---

## Table of Contents

1. [What is Workflow](#what-is-workflow)
2. [System Flow Diagram](#system-flow-diagram)
3. [Documentation Overview](#documentation-overview)
4. [Infrastructure (Infra)](#infrastructure-infra)
5. [Why Two MCP Servers](#why-two-mcp-servers)
6. [Connectors: Purpose & Support](#connectors-purpose--support)
7. [What is .prettierrc](#what-is-prettierrc)
8. [What is HQ](#what-is-hq)
9. [What is Sync](#what-is-sync)
10. [What is Aplos](#what-is-aplos)

---

## What is Workflow

The **workflow** is the complete end-to-end process of how organizational data flows into Claude's context for AI queries. Here's the sequence:

### Data Flow Lifecycle

1. **Data originates** in external systems: Google Sheets, Aplos accounting, Notion, Slack, Google Drive, etc.
2. **Connectors sync data** on a schedule (hourly, daily, or on-demand):
   - Run via `pnpm sync:<name>` locally
   - Run via AWS EventBridge + ECS Fargate in production
   - Each connector calls `runSync()` which tracks the run in the `sync_runs` table
3. **Data is stored** in Postgres with Prisma ORM:
   - Structured relational data (students, outcomes, finances)
   - Vector embeddings (Google Drive docs, Slack messages) stored in pgvector
   - Entity resolution (deduplicating people across sources) via `entity_aliases` table
4. **MCP Server exposes tools** that query this data:
   - 16 data tools (e.g., `get_student_info`, `search_by_person`, `query_finances`)
   - 4 skill tools (identity resolution, text search)
   - Tools execute Prisma queries or pgvector similarity searches
5. **Claude calls tools** through the MCP protocol:
   - Via stdio transport (Claude Desktop, local development)
   - Via HTTP transport (in-application use)
6. **HQ Dashboard** provides visibility:
   - Monitor sync status (`/sync` page)
   - View tool usage logs (`/tools` page)
   - Manage admin settings (`/admin` page)

### Key Principle: Read-Only Enforcement

**The entire workflow is designed to be read-only.** At no point do connectors or tools write back to source systems. This is enforced at three levels:

- **Connector level:** Google Sheets connector has no write functions; Aplos connector is incremental pull only
- **Prisma ORM:** Used only for reads; writes are only to internal Postgres tables
- **MCP tools:** All tools are queryable only; no mutations exposed to Claude

---

## System Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES (External)                       │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Google Sheets          Google Drive          Notion                  │
│  (students, outcomes,   (docs, notes,         (meeting                │
│   attendance,           embeddings)           transcripts,            │
│   finances, donors)                           embeddings)             │
│                                                                        │
│  Aplos (accounting)     Slack (channels)      Roam (chat notes)       │
│  (transactions,         (conversations)       (team notes)            │
│   balances)                                                           │
│                                                                        │
└────────────────────┬───────────────────────────────────────────────────┘
                     │ (scheduled via EventBridge in prod, manual via pnpm)
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         CONNECTOR LAYER (9)                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────┐         │
│  │ google-sheets   │  │ aplos            │  │ notion       │         │
│  │ (sync + verify) │  │ (incremental)    │  │ (+ embed)    │         │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬─────┘         │
│           │                    │                    │                │
│  ┌────────▼────────┐  ┌────────▼─────────┐  ┌──────▼──────┐         │
│  │ google-drive    │  │ slack            │  │ roam         │         │
│  │ (+ embed)       │  │ (+ embed)        │  │ (+ embed)    │         │
│  └────────┬────────┘  └────────┬─────────┘  └──────┬───────┘         │
│           │                    │                    │                │
│           └────────────────────┼────────────────────┘                │
│                                │                                    │
│                 Each connector calls runSync()                       │
│                 which creates sync_runs table entry                  │
│                 and captures errors + timing                         │
│                                                                        │
└────────────────────┬───────────────────────────────────────────────────┘
                     │ upsert (never truncate)
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    POSTGRES 16 (Local Docker / AWS RDS)               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─ STRUCTURED DATA (Prisma ORM) ─────────────────────────────────┐  │
│  │                                                                │  │
│  │  Core tables:                                                 │  │
│  │  • students, staff, student_phase_outcomes                   │  │
│  │  • student_certifications, student_competencies              │  │
│  │  • attendance_records, enrollment_snapshots                  │  │
│  │  • finance_snapshots (budget, actuals, PEX, Rapid)          │  │
│  │  • donor_contacts, donor_gifts, donor_pipeline               │  │
│  │  • student_employment, student_postsecondary                 │  │
│  │                                                                │  │
│  │  Internal tables:                                             │  │
│  │  • sync_runs (one row per connector run)                     │  │
│  │  • usage_logs (one row per MCP tool call)                    │  │
│  │  • entity_aliases (fuzzy name deduplication)                 │  │
│  │  • mcp_users, oauth_clients, tool_permissions               │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─ VECTOR DATA (pgvector extension) ─────────────────────────────┐  │
│  │                                                                │  │
│  │  document_chunks:                                             │  │
│  │  • Google Drive docs → split into chunks → embed with       │  │
│  │    OpenAI text-embedding-3-large (1536 dimensions)          │  │
│  │  • Slack messages → chunked → embedded                       │  │
│  │  • Roam notes → chunked → embedded                           │  │
│  │  • Notion meeting transcripts → chunked → embedded           │  │
│  │                                                                │  │
│  │  Supports semantic search: tools query via pgvector           │  │
│  │  cosine similarity (<=> operator)                             │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────┬───────────────────────────────────────────────────┘
                     │
                     │ (Prisma queries + pgvector cosine search)
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        MCP SERVER (16 tools)                           │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Data Tools (13):                                                    │
│  ├─ get_student_info(name/id) → student profile + outcomes         │
│  ├─ search_by_person(query) → fuzzy name match → entity resolution │
│  ├─ get_student_certifications(name/id) → cert history             │
│  ├─ query_finances(account/fund/date range) → structured data       │
│  ├─ get_donor_info(name/id) → donor profile + giving history       │
│  ├─ search_documents(query, limit) → semantic search in pgvector   │
│  ├─ [9 more specialized tools]                                     │
│                                                                        │
│  Skill Tools (4):                                                    │
│  ├─ resolve_person_name() → entity aliases across sources           │
│  ├─ search_person_by_similarity() → fuzzy matching                 │
│  ├─ [2 more AI-specific helpers]                                    │
│                                                                        │
│  Transport Layer:                                                     │
│  ├─ STDIO: Claude Desktop local dev                                │
│  ├─ HTTP: ECS Fargate production + containerized testing           │
│                                                                        │
└────────────────────┬───────────────────────────────────────────────────┘
                     │ MCP protocol (JSON-RPC)
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            CLAUDE                                      │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  User Query: "How many students are in phase 2 this cohort?"         │
│  ↓                                                                    │
│  Claude calls:  mcp_call("get_student_info", { phase: 2, ... })     │
│  ↓                                                                    │
│  MCP Server:    SELECT * FROM students WHERE phase_id = 2           │
│  ↓                                                                    │
│  Claude:        Returns synthesized answer with context + reasoning   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      HQ DASHBOARD (Visibility)                         │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  /sync          → monitor all connector sync runs                    │
│  /tools         → view all MCP tool calls (usage_logs)              │
│  /admin         → manage user roles, tool permissions               │
│  /              → data freshness status                              │
│  /dashboard     → analytics (enrollment, donors, finances)           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Documentation Overview

The `docs/` folder is organized as follows:

| File/Folder | Purpose |
|---|---|
| **database-schema.md** | Complete Postgres schema reference: all tables, columns, constraints, indexes |
| **mcp-server-spec.md** | Full MCP tool definitions: 16 tools with input/output Zod schemas, error codes |
| **entity-resolution.md** | Algorithm for deduplicating people across data sources (fuzzy matching) |
| **data-sources/** | Per-connector documentation |
| ├─ **google-sheets-connector.md** | 12 sheet syncs, read-only enforcement, settings validation |
| ├─ **aplos-connector.md** | Accounting API, incremental sync strategy, fund balances |
| ├─ **notion-connector.md** | Meeting transcript ingestion + embeddings |
| ├─ **google-drive-connector.md** | Doc chunking + semantic embeddings |
| └─ **slack-connector.md** | Channel message ingestion + embeddings |
| **runbooks/** | Operational procedures |
| ├─ **local-dev.md** | First-time setup: Docker, Prisma, seed data, running dev servers |
| ├─ **credentials-checklist.md** | All API keys needed (Google, Aplos, Slack, etc.) and how to obtain them |
| ├─ **aws-permissions.md** | IAM roles for production (ECS, EventBridge, RDS, etc.) |
| **setup/** | Phase-by-phase bootstrap guides |
| ├─ **00-bootstrap.md** | Repo clone, Node/pnpm setup, workspace initialization |
| ├─ **01-aws-baseline.md** | VPC, subnets, security groups, networking foundation |
| ├─ **02-rds-postgres.md** | AWS RDS Postgres 16 cluster + subnet groups |
| ├─ **03-secrets-manager.md** | Store API credentials in AWS Secrets Manager |
| ├─ **04-prisma-schema.md** | Apply Prisma schema migrations to RDS |
| ├─ **05-google-connectors.md** | Google OAuth setup for Sheets, Drive, Docs |
| ├─ **06-embeddings-pgvector.md** | pgvector extension + OpenAI embedding setup |
| ├─ **07-mcp-server.md** | Deploy MCP server via ECS Fargate (stdio + HTTP) |
| ├─ **08-hq-dashboard.md** | Deploy Next.js HQ dashboard (NextAuth + RDS connection) |
| ├─ **09-ecs-express-mode.md** | HTTP express mode for local / containerized testing |
| ├─ **10-eventbridge-cron.md** | Schedule connector syncs (e.g., `rate(1 hour)`, `cron(30 3 * * ?)`) |
| ├─ **11-sentry.md** | Error monitoring + performance tracing |
| └─ ... | Other integrations (Notion, Slack, BigQuery, Metabase, etc.) |

---

## Infrastructure (Infra)

The `infra/` folder contains Infrastructure-as-Code for the production system:

| Folder | Contents |
|---|---|
| **ecs/** | ECS Fargate task definitions for all services |
| ├─ `hq-taskdef.json` | Next.js HQ dashboard service |
| ├─ `mcp-server-taskdef.json` | MCP server (stdio + HTTP) |
| ├─ `aws-mcp-server-taskdef.json` | AWS-specific MCP server variant |
| ├─ `lp-sync-google-sheets-taskdef.json` | One-off sync task for Google Sheets |
| ├─ `lp-sync-aplos-taskdef.json` | One-off sync task for Aplos |
| ├─ `lp-sync-notion-taskdef.json` | One-off sync task for Notion |
| └─ ... | Other sync task definitions |
| **iam/** | IAM roles and policies for ECS, Lambda, EventBridge |
| ├─ `ecsTaskRole.json` | Permissions for running tasks (RDS, Secrets Manager access) |
| ├─ `ecsTaskExecutionRole.json` | Permissions for ECS Agent (pull images, write logs) |
| └─ ... | Other role definitions |
| **postgres-init/** | Database initialization scripts |
| ├─ `init.sql` | Extensions (pgvector, pg_trgm), schema bootstrap |
| └─ ... | Seed data, initialization jobs |
| **scripts/** | Helper scripts for deployment, testing, monitoring |

**Key Infrastructure Concepts:**

- **ECS Fargate:** Serverless container orchestration. Each service (HQ, MCP server, sync tasks) runs as a separate task definition.
- **EventBridge:** Cron scheduler. Rules like `rate(1 hour)` or `cron(30 3 * * ? *)` trigger ECS tasks.
- **RDS Postgres:** Managed database. Stored in private subnets; accessed only by ECS tasks and bastion hosts.
- **Secrets Manager:** Stores API keys (Google, Aplos, Slack, etc.). Tasks fetch secrets at runtime via IAM roles.
- **CloudWatch:** Logs, metrics, alarms. All containers stream logs to CloudWatch Logs.

---

## Why Two MCP Servers

The system has **two separate MCP server implementations** to support different deployment contexts:

### 1. **mcp-server** (`apps/mcp-server/`)
   - **Purpose:** Primary, general-purpose MCP server
   - **Transport:** Stdio (Claude Desktop) + HTTP (Fargate containers)
   - **Use case:** Local development, Claude Desktop CLI, production web applications
   - **Tools:** All 16 data + 4 skill tools
   - **Deployed via:** Docker image → ECS Fargate task

### 2. **aws-mcp-server** (`apps/aws-mcp-server/`)
   - **Purpose:** AWS-specific variant for specialized workflows
   - **Transport:** HTTP only
   - **Use case:** Internal AWS services, resource approval workflows
   - **Tools:** Subset of core tools + AWS-specific actions (e.g., resource approval, budget checks)
   - **Deployed via:** Docker image → ECS Fargate task (separate from primary)

**Why separate?**

- **Isolation:** AWS-specific server doesn't interfere with Claude Desktop flow
- **Versioning:** Can update AWS server independently (e.g., for compliance changes)
- **Permissions:** Tighter IAM roles for AWS server (least-privilege principle)
- **Scalability:** Separate ECS task definitions allow independent auto-scaling
- **Testing:** Can test AWS workflows without impacting core MCP functionality

Both servers use the **same underlying `@lp-ai/lib-db` package** and **same Postgres connection**, so data consistency is maintained.

---

## Connectors: Purpose & Support

Connectors are the bridge between external data sources and Postgres. Each is a standalone package that implements a `sync()` function.

### Connector Summary

| Connector | Source System | Destination Tables | Status | Frequency |
|---|---|---|---|---|
| **google-sheets** | Launchpad Dashboard + 12 outcome sheets | `students`, `student_phase_outcomes`, `student_certifications`, `attendance_records`, `finance_snapshots` | ✅ Live | Hourly |
| **aplos** | Aplos nonprofit accounting API | `finance_snapshots` (accounts, funds, transactions) | ✅ Live | Daily |
| **notion** | Notion meeting transcripts DB | `document_chunks` (pgvector embeddings) | ✅ Live | Daily |
| **google-drive** | Google Drive docs folder | `document_chunks` (pgvector embeddings) | ⚠️ Skeleton | On-demand |
| **slack** | Slack channels | `document_chunks` (pgvector embeddings) | ⚠️ Skeleton | On-demand |
| **roam** | Roam daily notes | `document_chunks` (pgvector embeddings) | 🧪 Experimental | On-demand |
| **bigquery** | BigQuery project (BI data) | `finance_snapshots` + custom tables | 🧪 Experimental | On-demand |

### How Each Connector Supports the Project

1. **google-sheets:** Core operational data
   - Student records, phases, certifications
   - Attendance tracking (3 cohorts)
   - Financial data (budget, actuals, PEX cards, Rapid stipends)
   - Development CRM (donor contacts, giving history, prospects)
   - Competency scores and rubrics
   - **Support:** Enables queries like "Show all LiftOff students in Phase 2"

2. **aplos:** Financial tracking
   - Chart of accounts
   - Fund balances
   - All transactions (with date-range filtering)
   - **Support:** Enables queries like "What's our cash position in the Operating fund?"

3. **notion:** Institutional knowledge
   - Meeting transcripts
   - Chunked and embedded for semantic search
   - **Support:** Enables queries like "What was discussed about student outcomes in last month's staff meetings?"

4. **google-drive:** Internal documentation
   - Policies, SOPs, strategic docs
   - Chunked and embedded
   - **Support:** Enables queries like "What's our attendance policy?"

5. **slack:** Team communication
   - Channel messages (designated channels only)
   - Chunked and embedded
   - **Support:** Enables queries like "What have we discussed about remote work?"

6. **roam:** Ideation & quick notes
   - Personal and team daily notes
   - Embedded for similarity search
   - **Support:** Enables queries like "Find all notes tagged #student-housing"

7. **bigquery:** BI + analytical data
   - Custom SQL queries on your data warehouse
   - Sync results back to Postgres for MCP tools
   - **Support:** Enables queries like "Show me cohort enrollment trends"

### Connector Architecture

Each connector follows this pattern:

```typescript
// connectors/<name>/src/sync.ts
export async function sync(): Promise<SyncRunRecord> {
  return runSync('connector-name', async () => {
    const env = await loadEnv();
    if (!env.REQUIRED_KEY) return { status: 'noop', notes: 'key not set' };
    
    // 1. Fetch from external source
    const data = await fetchFromSource();
    
    // 2. Transform to schema
    const rows = data.map(normalize);
    
    // 3. Upsert (never truncate)
    const sourceIds = new Set();
    for (const row of rows) {
      await db.table.upsert({ sourceId: row.id, ... });
      sourceIds.add(row.id);
    }
    
    // 4. Delete stale rows (only rows NOT seen in this run)
    await db.table.deleteMany({ sourceId: { notIn: Array.from(sourceIds) } });
    
    return { status: 'ok', recordsUpserted: rows.length };
  }, {
    tables: ['table1', 'table2'],  // declare what we write to
  });
}
```

**Key safety rule:** NEVER use `deleteMany({})` or `TRUNCATE` without first upserting all current data. If the sync crashes midway, the upsert + stale-cleanup pattern ensures no data loss.

### Running Connectors

```bash
# Local development (one-off)
pnpm sync:sheets        # Google Sheets
pnpm sync:aplos         # Aplos
pnpm sync:notion        # Notion
pnpm sync:all           # All connectors in parallel

# Production (scheduled)
# EventBridge rules trigger ECS tasks on a schedule
# Logs appear in CloudWatch; status shown on HQ /sync page

# Manual one-off in production
AWS_PROFILE=lp-internal aws ecs run-task \
  --cluster lp-internal \
  --task-definition lp-sync-google-sheets:1 \
  --launch-type FARGATE \
  --network-configuration awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}
```

---

## What is .prettierrc

`.prettierrc` is the **code formatter configuration file** for the entire project. It defines how all TypeScript, JavaScript, JSON, and Markdown code is formatted.

### Current Configuration

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

| Setting | Value | Meaning |
|---|---|---|
| **semi** | `true` | Add semicolons at end of statements |
| **singleQuote** | `true` | Use single quotes instead of double quotes |
| **trailingComma** | `all` | Add trailing commas in multi-line arrays/objects |
| **printWidth** | `100` | Line length limit (wrap at 100 chars) |
| **tabWidth** | `2` | Indent with 2 spaces |

### Usage

**IDE Setup (VS Code):**
```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

**CLI:**
```bash
# Format all files
pnpm exec prettier . --write

# Check without fixing
pnpm exec prettier . --check

# Format a single file
pnpm exec prettier src/file.ts --write
```

**Pre-commit hooks (via husky):** Formatting is enforced on every commit to prevent inconsistent code style.

---

## What is HQ

**HQ** (`apps/hq/`) is the **Next.js dashboard application** that provides operational visibility and management for the entire system.

### Purpose

The HQ dashboard is the command center for:
- Monitoring connector sync status
- Viewing tool usage and errors
- Managing user permissions
- Analyzing data freshness
- Understanding system health

### Key Routes

| Route | Purpose | Audience |
|---|---|---|
| `/` | **Data Freshness Dashboard** | Operations, all users |
| | • Last sync time for each connector | |
| | • Data row counts (students, donors, etc.) | |
| | • Overall system health score | |
| `/dashboard` | **Analytics Dashboard** | Leadership, analysts |
| | • Enrollment trends by phase | |
| | • Donor giving history | |
| | • Financial snapshots (budget vs actual) | |
| | • Attendance rates by cohort | |
| `/sync` | **Sync Run History** | Operations |
| | • Table: all `sync_runs` records | |
| | • Filter by connector, date, status | |
| | • Drill into error messages | |
| | • Manual retry buttons | |
| `/tools` | **MCP Tool Usage Log** | Engineering, admins |
| | • Table: all `usage_logs` records | |
| | • Filter by tool name, user, date range | |
| | • Error tracking | |
| | • Performance metrics (query latency) | |
| `/admin` | **Permissions Matrix** | Admin only |
| | • Manage `mcp_users` roles | |
| | • Control tool access per role | |
| | • View OAuth clients | |
| | • Audit user activity | |
| `/aws-jobs/[id]` | **AWS Resource Job Details** | Finance, leadership |
| | • Approve/reject resource allocation | |
| | • Track resource budgets | |
| | • Budget impact estimates | |

### Authentication

HQ uses **NextAuth v5** (Auth.js) with **Google OAuth**:
- Domain-restricted to `@launchpadphilly.org`
- Sign-in via `/auth/signin` (Google provider)
- Session persisted in `mcp_users` table
- Roles determine tool access (see `/admin`)

### Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 14 (App Router) |
| **Database** | Postgres (via `@lp-ai/lib-db` package) |
| **Auth** | NextAuth v5 + Google OAuth |
| **UI Components** | Tailwind CSS (shadcn-style inline components) |
| **Monitoring** | Sentry (error tracking + performance) |
| **Logging** | CloudWatch (in production) |

### File Structure

```
apps/hq/
├─ auth.ts                    # NextAuth configuration
├─ auth.config.ts             # OAuth provider setup
├─ middleware.ts              # Auth gate + route protection
├─ app/
│  ├─ page.tsx               # Data freshness dashboard (/)
│  ├─ dashboard/             # Analytics dashboard (/dashboard)
│  ├─ sync/                  # Sync run history (/sync)
│  ├─ tools/                 # Tool usage log (/tools)
│  ├─ admin/                 # Permissions & user management (/admin)
│  └─ api/                   # Internal APIs
│     └─ auth/               # NextAuth routes
├─ components/               # Reusable React components
└─ public/                   # Static assets
```

---

## What is Sync

**Sync** is the process of copying data from external sources into Postgres. There are two primary sync components:

### 1. **Sync Connectors** (the "what")

Connectors are packages in `connectors/` that implement a `sync()` function:
- Each connector is responsible for one data source (Google Sheets, Aplos, Notion, etc.)
- Fetch data from the external API
- Transform to schema
- Upsert into Postgres (never truncate)
- Clean up stale records
- Report status to `sync_runs` table

### 2. **Sync Runner** (the "how")

The `packages/db/src/sync-runs.ts` module provides `runSync()` which:
- Creates a row in `sync_runs` table
- Wraps the connector's sync logic
- Captures errors and duration
- Performs a 5% integrity guard (warns if table row count drops >5%)
- Tracks start/end times

### Sync Workflow

```
User or EventBridge triggers sync
    ↓
pnpm sync:<name> OR aws ecs run-task --task-definition lp-sync-<name>
    ↓
Connector package's sync() function runs
    ↓
runSync() wrapper creates sync_runs entry
    ↓
Fetch from external source (API, sheet, DB)
    ↓
Transform to schema
    ↓
Upsert all rows (Prisma)
    ↓
Delete stale rows (only IDs not seen in this run)
    ↓
Report status (ok, error, noop, warning)
    ↓
sync_runs table updated with final status
    ↓
HQ dashboard /sync page shows status
```

### Running Syncs

**Local (development):**
```bash
pnpm sync:sheets                  # Google Sheets only
pnpm sync:aplos                   # Aplos only
pnpm sync:all                     # All connectors in parallel
```

**Production (scheduled):**
```
EventBridge Rule "lp-sync-sheets" (rate=1 hour)
    ↓
Triggers ECS Task Definition "lp-sync-google-sheets"
    ↓
Task container runs: pnpm sync:sheets
    ↓
Logs stream to CloudWatch
    ↓
Status row created in sync_runs
```

### Sync Safety

**Read-only enforcement:** Syncs never write back to source systems:
- **Google Sheets:** No sheet write API exists in connector code
- **Aplos:** Incremental pull only (no write functions)
- **All connectors:** Pull → transform → Postgres write only

**Data safety:**
- Upsert + stale-cleanup pattern: if sync crashes mid-run, existing data untouched
- 5% integrity guard: warns if table drops >5% rows (data corruption detection)
- Sync run tracking: every sync logged in `sync_runs` with errors, duration, row counts

### Monitoring Syncs

**HQ Dashboard:**
```
/sync page
    ↓
Table of all sync_runs records
    ↓
Filter by connector, date, status
    ↓
Click to see error logs, row counts, duration
```

**Direct SQL:**
```sql
SELECT 
  connector_name, 
  status, 
  started_at, 
  duration_ms, 
  notes
FROM sync_runs
ORDER BY started_at DESC
LIMIT 10;
```

---

## What is Aplos

**Aplos** is a **nonprofit accounting platform** used by Launchpad to track finances. The Aplos connector syncs financial data into the `finance_snapshots` table.

### Aplos Overview

| Property | Value |
|---|---|
| **Company** | Aplos (nonprofit accounting SaaS) |
| **URL** | https://www.aplos.com |
| **API Base** | https://www.aplos.com/apis/v1 |
| **Auth** | OAuth 2.0 (client credentials flow) |
| **Use at Launchpad** | Chart of accounts, fund balances, transaction ledger |

### What Data Aplos Provides

| Data | Endpoint | Destination Table |
|---|---|---|
| **Chart of Accounts** | `GET /accounts` | `finance_snapshots` (metadata) |
| **Funds** | `GET /funds` | `finance_snapshots` (metadata) |
| **Transactions** | `GET /transactions` | `finance_snapshots` (transactional) |
| **Fund Balances** | `GET /reports/fund-balances` | `finance_snapshots` (reporting) |

### Aplos Integration

**Connector Location:** `connectors/aplos/src/`

**Sync Strategy:**
- Incremental by date range
- Pull transactions for rolling 30-day window on each run
- Full refresh monthly to catch any corrections
- Upsert on Aplos transaction ID (stable unique key)

**Environment Variables:**
```bash
APLOS_CLIENT_ID=<your-client-id>
APLOS_API_KEY=<your-api-key>  # RSA-encrypted key in production
```

**Sync Command:**
```bash
pnpm sync:aplos      # Local
# In production: EventBridge cron(30 3 * * ? *)  (3:30 AM daily)
```

**Output:**
- Rows inserted into `finance_snapshots`
- Status + error tracking in `sync_runs`
- 5% integrity guard alerts if transaction count drops unexpectedly

### Example Queries

**Get all transactions in Operating fund (last 30 days):**
```sql
SELECT 
  transaction_date,
  account_name,
  fund_name,
  debit_amount,
  credit_amount,
  memo
FROM finance_snapshots
WHERE fund_name = 'Operating' 
  AND transaction_date >= DATE_TRUNC('day', NOW() - INTERVAL '30 days')
ORDER BY transaction_date DESC;
```

**Fund balance snapshot:**
```sql
SELECT 
  fund_name,
  beginning_balance,
  net_activity,
  ending_balance
FROM finance_snapshots
WHERE report_type = 'fund_balance'
  AND report_date = DATE(NOW());
```

### Why Aplos for MCP

The Aplos connector enables Claude queries like:
- "What's our current cash position?"
- "Show me all transactions in the Student Support fund"
- "What's our budget vs. actual for this quarter?"
- "Generate a fund balance report as of today"

Without Aplos, Claude would have no access to live financial data—HQ staff would need to manually export reports or query accounting software directly.

---

## Summary: How Everything Connects

```
Data Sources (Google Sheets, Aplos, Slack, etc.)
    ↓ (scheduled via EventBridge or manual pnpm)
Connectors (sync() functions in each package)
    ↓ (via runSync() wrapper)
Postgres 16 (structured + vector storage)
    ↓ (Prisma queries + pgvector similarity)
MCP Server (16 data tools + 4 skill tools)
    ↓ (stdio / HTTP protocol)
Claude
    ↓ (via tool calls)
User Questions Answered
    ↓ (visibility via)
HQ Dashboard (/sync, /tools, /admin, /dashboard)
```

**Core Principle:** The entire system is **read-only at all levels**. Data flows in one direction: sources → connectors → storage → Claude. No tool or connector writes back to source systems, ensuring data integrity and compliance.

---

## Quick Reference

### Commands

```bash
# Development
pnpm db:up                    # Start local Postgres
pnpm db:push                  # Apply schema
pnpm db:seed                  # Seed test data
pnpm sync:all                 # Run all connectors

# MCP Server
pnpm --filter @lp-ai/mcp-server dev       # Develop (stdio)
pnpm --filter @lp-ai/mcp-server dev:http  # Develop (HTTP)

# HQ Dashboard
pnpm --filter @lp-ai/hq dev   # Next.js dev server (http://localhost:3000)

# Testing
pnpm test                     # Run all tests
pnpm test:watch               # Watch mode

# Type checking & linting
pnpm -r typecheck
pnpm lint
```

### Key Files

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project overview (stack, commands, architecture) |
| `packages/db/prisma/schema.prisma` | Single source of truth for database schema |
| `prisma.config.ts` | Prisma configuration (schema + migration paths) |
| `apps/mcp-server/src/make-server.ts` | Register all MCP tools |
| `packages/db/src/sync-runs.ts` | `runSync()` wrapper for all connectors |
| `docs/database-schema.md` | Full Postgres schema reference |
| `docs/mcp-server-spec.md` | All 16 tool definitions with schemas |
| `.prettierrc` | Code formatter configuration |

---

**End of Comprehensive Project Guide**
