# Phase 12 — Notion Knowledge Base

**Goal:** Create the Notion workspace structure for LP Internal AI V1 — architecture docs, runbooks, ADRs, and on-call notes — so institutional knowledge lives in one searchable place outside the repo.

**Prerequisites:**
- Notion account with Launchpad workspace access
- Phase 9 complete (so you have real URLs and service details to document)

---

## 1. Create the top-level section

In the Launchpad Notion workspace:

1. Create a new **top-level page**: `LP Internal AI V1`
2. Add an icon (suggested: 🧠) and a cover image
3. Set the page to **Full width**

---

## 2. Create the sub-pages

Create the following pages under `LP Internal AI V1`:

| Page | Purpose |
|---|---|
| 📐 Architecture | System diagram, data flow, tech decisions summary |
| 📋 Setup Guides | Links to each `docs/setup/*.md` file in the repo |
| 📖 Runbooks | Operational playbooks (sync failure, RDS alert, secret rotation) |
| 🗂 ADR Log | Architecture Decision Records — one entry per stack decision |
| 🔑 Credentials Index | Where each secret lives (names only — never values) |
| 📊 Data Sources | One sub-page per connector with source details and contact |
| 🐛 Known Issues | Active bugs and workarounds |
| 📅 On-Call Notes | Running log of incidents and resolutions |

---

## 3. Populate the Architecture page

Copy this summary into the Architecture page:

```
System: LP Internal AI V1
Updated: [date]

Data sources → Connectors → Postgres (RDS) + pgvector → MCP Server → Claude

CONNECTORS
- Google Sheets (hourly) → students, outcomes, finances, donors, attendance
- Google Drive (every 6h) → document chunks + embeddings
- BigQuery (hourly) → outcomes/enrollment from lp-internal-ai project
- GiveButter (daily) → donor gifts and contacts
- Aplos (daily) → finance snapshots
- Slack (hourly) → message chunks for semantic search
- Roam (hourly) → message/note chunks for semantic search

INFRASTRUCTURE
- Database: AWS RDS Postgres 16 (us-east-1) + pgvector extension
- App hosting: AWS ECS Fargate behind ALB (lp-internal-hq + lp-internal-mcp)
- Cron: AWS EventBridge → Lambda → MCP server sync endpoint (via ALB)
- Secrets: AWS Secrets Manager (prefix: lp-internal/)
- Monitoring: Sentry (lp-internal-hq, lp-internal-mcp projects)
- BI: Metabase (self-hosted on ECS Fargate)
- Automation: n8n (self-hosted on ECS Fargate)

MCP TOOLS (14)
get_student_info, query_students, query_outcomes, query_enrollment,
query_certifications, query_competency, query_finances, query_donors,
query_attendance, search_conversations, search_by_person,
get_entity_brief, get_finance_brief, search_documents
```

---

## 4. Populate the ADR Log

Create one ADR entry for each stack decision that deviated from V0 or was a meaningful choice:

**ADR template:**
```
Title: [decision]
Date: [date]
Status: Accepted

Context: [why this decision was needed]
Decision: [what was chosen]
Alternatives considered: [what was rejected]
Consequences: [what this means for the system]
```

Starter ADRs to create:
- ADR-001: Migrate from Railway to AWS ECS Fargate
- ADR-002: Migrate from Drizzle to Prisma
- ADR-003: Migrate from Pinecone to pgvector
- ADR-004: Migrate from Voyage AI to OpenAI embeddings
- ADR-005: BigQuery as source connector (not warehouse)
- ADR-006: Athena over S3 as analytics warehouse

---

## 5. Populate the Credentials Index

List where each secret lives — names only, never values:

| Secret group | Location |
|---|---|
| Database URL | AWS Secrets Manager: `lp-internal/db` |
| Anthropic API key | AWS Secrets Manager: `lp-internal/anthropic` |
| OpenAI API key | AWS Secrets Manager: `lp-internal/openai` |
| Google service account | AWS Secrets Manager: `lp-internal/google` |
| GiveButter API key | AWS Secrets Manager: `lp-internal/givebutter` |
| Aplos credentials | AWS Secrets Manager: `lp-internal/aplos` |
| Slack bot token | AWS Secrets Manager: `lp-internal/slack` |
| Roam credentials | AWS Secrets Manager: `lp-internal/roam` |
| NextAuth secret | AWS Secrets Manager: `lp-internal/nextauth` |
| Sentry DSNs | AWS Secrets Manager: `lp-internal/sentry` |

---

## Verification checklist

- [ ] `LP Internal AI V1` top-level page exists in Notion
- [ ] All 8 sub-pages created
- [ ] Architecture page has current system summary
- [ ] ADR Log has at least ADR-001 through ADR-006
- [ ] Credentials Index populated (names only)
- [ ] At least one runbook exists (suggested: "What to do when a sync fails")

---

**Next:** [13-n8n.md](13-n8n.md)
