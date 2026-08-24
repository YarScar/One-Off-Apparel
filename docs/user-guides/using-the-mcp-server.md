# Using Your MCP Server

This guide covers how to connect to your MCP server, explore what's available, and interact with it across Claude Desktop, Claude.ai, and Claude Code (CLI).

> **Before sending to a customer:** Replace all `[PLACEHOLDER]` values in this document with the customer's actual URLs, org name, and email domain. Search for `[PLACEHOLDER` to find them all.

---

## What Is the MCP Server?

The MCP (Model Context Protocol) server gives Claude live access to your organization's data — people profiles, program outcomes, attendance, finances, donor records, meeting transcripts, and more. When you ask Claude a question like "What's Jordan's attendance rate?" or "Generate a board packet for Q2," the MCP server is what lets Claude look up the answer from real data instead of guessing.

You don't interact with the MCP server directly. You talk to Claude normally, and Claude calls the server's tools behind the scenes.

---

## Connecting to the MCP Server

### Claude.ai (Web) and Claude Desktop

Your organization's MCP integration has already been added to your Claude account. Once an admin has activated your account and assigned your roles in HQ, the tools are available automatically — no configuration needed on your end.

To connect:

1. Sign in to Claude at [claude.ai](https://claude.ai) (or open Claude Desktop) using your `[PLACEHOLDER: @yourorg.org]` Google account
2. Start a new conversation — if the integration is enabled, you'll see the available tools listed when you click the integrations icon
3. Ask a question that uses your organization's data and Claude will call the appropriate tool

If you don't see the integration, contact your admin to confirm your account has been activated.

### Claude Code (CLI)

For developers using the CLI, connect to the MCP server's HTTP endpoint:

```
[PLACEHOLDER: https://mcp.yourorg.example.com/mcp]
```

---

## Discovering What's Available

### Ask Claude Directly

The simplest way to learn what's available is to ask:

- "What tools do you have access to?"
- "What data can you look up about our participants?"
- "What financial data is available?"
- "What skills can you run?"

Claude will list the tools it can see and describe what each one does.

### Tools at a Glance

The system includes two types of tools:

#### Data Query Tools

These return data directly from the database. Typical query tools include:

| Tool | What It Does |
|---|---|
| `get_student_info` | Full profile — demographics, cohort, program phase, status, goals, aliases |
| `query_students` | Population-level analytics — averages, breakdowns, filtered lists |
| `query_enrollment` | Enrollment headcounts, phase breakdowns, cohort summaries |
| `query_attendance` | Per-person or aggregate attendance rates by phase, cohort, demographic |
| `query_outcomes` | Program outcomes — baseline, performance level, growth, progress |
| `query_competency` | Per-person competency analytics or org-wide growth aggregates |
| `query_certifications` | Certification pass/fail rates, scores, breakdowns |
| `query_employment` | Employment records — earnings, hours, exit codes |
| `query_postsecondary` | Post-program education enrollment and outcomes |
| `query_finances` | Financial snapshots — monthly, YTD, forecasts, budgets, fund balances |
| `query_donors` | Donor profiles, gift history, pipeline, grants tracker |
| `get_finance_brief` | High-level financial overview (fund balances + recent gifts) |
| `get_entity_brief` | Comprehensive brief on a person across all data sources |
| `search_conversations` | Semantic search across messaging and meeting transcripts |
| `search_by_person` | Find all conversations about or involving a specific person |
| `search_documents` | General semantic search across all ingested documents |

> Your system may have additional tools beyond these, or some may be named differently. Ask Claude "What tools do you have?" for the current list.

#### Skill Tools

These don't return raw data. Instead, they give Claude a structured workflow to follow — Claude then calls multiple data tools and produces a polished output.

| Skill | What It Does |
|---|---|
| `skill_board_reporting` | Generates board packets, KPI scorecards, program updates, fundraising reports |
| `skill_finance_audit` | Produces audit-ready financials — monthly close, funder spend reports, reconciliation |
| `skill_grant_prospecting` | Finds and ranks potential funders based on giving history and alignment (interactive, checkpoint-based) |
| `skill_grant_sourcing_evaluation` | Sources and scores grant opportunities against a fixed weighted rubric, immediately, in a table plus a downloadable spreadsheet and PDF (non-interactive) |
| `skill_grant_writing` | Assembles grant proposals or funder reports using live data and your org's voice |

### Clarifying What Data Is Available

If you're unsure whether the system has what you need, ask Claude to describe the data behind a specific tool:

- "What fields are available in the participants table?"
- "What types of financial queries can you run?"
- "What attendance data do you have — daily events or just rates?"
- "Do you have donor data for foundations or just individuals?"

Claude will explain what fields exist, what filters are supported, and what the data looks like.

---

## How to Interact Effectively

### Start Broad, Then Narrow

For people-related questions, start with a profile lookup before diving into specifics:

> "Tell me about Jordan Smith."

Claude will pull the full profile. From there, you can ask follow-ups:

> "What's their attendance rate this semester?"
> "How did they do on competency assessments?"
> "Have they earned any certifications?"

### Use Natural Language

You don't need to know tool names or parameters. Just ask your question naturally:

- "How many participants are currently enrolled?" (triggers `query_enrollment`)
- "What has the Lenfest Foundation given us?" (triggers `query_donors`)
- "Summarize what was discussed about the gala in recent meetings" (triggers `search_conversations`)
- "Generate a board report for Q2" (triggers `skill_board_reporting`)

### Working with Skills

Skills are more involved — they orchestrate multi-step workflows. To use one:

1. Ask for the output you want: "Create a board packet for the upcoming board meeting"
2. Claude calls the skill tool, which returns step-by-step instructions
3. Claude follows those instructions, calling data tools along the way
4. Claude assembles the final output (narrative, tables, CSV data)

You can guide the process:

- "Focus the board packet on program outcomes and attendance"
- "Include a fundraising summary but skip the financial details"
- "Generate a grant proposal for the XYZ Foundation — here's the RFP link: ..."

### Tips

- **Be specific about time ranges** when asking about attendance, finances, or enrollment: "attendance for Cohort 3 in January 2026" gets better results than "recent attendance."
- **Name matching is fuzzy** — the system resolves aliases across data sources, so first names, partial names, and full names all work.
- **Ask for CSV** if you want data you can paste into a spreadsheet: "Give me a CSV of all participants with their attendance rates and competency growth."

---

## Permissions and Access Control

### How Permissions Work

Not everyone can access every tool. Access is controlled by **roles** assigned to your account:

| Role | Typical Access |
|---|---|
| `program_staff` | Participant data, attendance, outcomes, certifications, competency |
| `development` | Donor data, gift history, pipeline, grant tools |
| `finance` | Financial snapshots, audit tools, fund balances |
| `sales` | Subset of enrollment and participant data |
| `leadership` | Broad access across most tools |
| `admin` | Full access to all tools + HQ admin panel |
| `software_dev` | Technical access for development and debugging |

If you try to use a tool your role doesn't permit, Claude will tell you the request was denied and suggest who to contact.

### Your Account Lifecycle

1. **Sign in** with your `[PLACEHOLDER: @yourorg.org]` Google account
2. Your account starts as **PENDING** — you can sign in but can't call any tools
3. An **admin** activates your account and assigns roles in HQ
4. Once **ACTIVE**, you can use any tool your roles permit

If your account is **DISABLED**, all access is revoked and any active sessions are invalidated.

---

## The HQ Dashboard

HQ is your operations dashboard at **[PLACEHOLDER: https://hq.yourorg.example.com]**. It provides visibility into how the system is running.

### Pages You Can See

| Page | URL | What It Shows |
|---|---|---|
| **Home** | [PLACEHOLDER: https://hq.yourorg.example.com/] | Data freshness — when each data source was last synced and how many records it has. Also shows Claude token usage and recent tool calls. |
| **Dashboard** | [PLACEHOLDER: https://hq.yourorg.example.com/dashboard] | Analytic charts — enrollment by cohort, attendance trends, competency scatter plots, and a competency-by-attendance heatmap. |
| **Sync** | [PLACEHOLDER: https://hq.yourorg.example.com/sync] | Connector health — status of each data sync (Google Sheets, donation platform, accounting system, etc.) with recent run history. |
| **Tool Log** | [PLACEHOLDER: https://hq.yourorg.example.com/tools] | Every MCP tool call — which tool, who called it, how long it took, whether it succeeded. Filterable by tool name or error status. |

### Admin Page (Admin Role Required)

The **Admin** page at **[PLACEHOLDER: https://hq.yourorg.example.com/admin]** is only visible to users with the `admin` role. It has three sections:

1. **User Management** — View all users, activate pending accounts, assign roles, disable or delete accounts.

2. **Add User** — Pre-create an active account for a new team member before they sign in. Assign their roles upfront so they're ready to go on first login.

3. **Permissions Matrix** — An interactive grid showing every tool crossed with every role. Toggle checkboxes to grant or revoke access. Changes take effect within about 60 seconds (no server restart needed).

### Checking Data Freshness

The Home page is your first stop when something looks off. If a query returns stale data, check:

- When the relevant connector last ran successfully
- Whether the last run shows an error
- How many records were upserted in the most recent sync

If a connector is failing, check the Sync page for error details and contact your admin or developer.

---

## Troubleshooting

| Problem | What to Check |
|---|---|
| "Permission denied" on a tool call | Ask an admin to check your roles at [PLACEHOLDER: https://hq.yourorg.example.com/admin] |
| Data seems stale or missing | Check HQ Home page for sync timestamps; check [PLACEHOLDER: https://hq.yourorg.example.com/sync] for errors |
| Claude says it can't find a person | Try alternate name spellings; the system does fuzzy matching but may miss unusual aliases |
| A skill produces incomplete output | Try being more specific about what you want, or break it into smaller requests |
| Claude doesn't seem to have the tools | Confirm the integration is enabled in your Claude conversation; contact your admin if not |
