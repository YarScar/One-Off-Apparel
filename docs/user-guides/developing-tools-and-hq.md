# Developing Tools, Data Sources, and HQ

This guide covers how to create and modify MCP tools, update skill definitions, manage data connectors, configure permissions, and extend the HQ dashboard — all through natural language instructions in Claude Code.

> **Before sending to a customer:** Replace all `[PLACEHOLDER]` values in this document with the customer's actual URLs, org name, and email domain. Search for `[PLACEHOLDER` to find them all.

---

## Getting Started

There are two ways to work with the project: the **Claude Code desktop app** (simplest) or the **terminal/IDE approach** (more control).

### Option A: Claude Code Desktop App

This is the easiest way to get started — no terminal or IDE required.

1. **Install the Claude Code desktop app** from [claude.ai/code](https://claude.ai/code)
2. **Open the app** and start a new session
3. **Clone the project** by telling Claude Code:

> "Clone the repository at `[PLACEHOLDER: https://github.com/your-org/your-repo.git]` and open it."

Claude Code will download the project and set up your working environment. From there, just describe the changes you want in plain English.

### Option B: Terminal / IDE

If you prefer working in a terminal or have an IDE like VS Code or Cursor:

1. **Install Git** — [git-scm.com/downloads](https://git-scm.com/downloads) if you don't already have it
2. **Install Claude Code CLI** — follow the instructions at [claude.ai/code](https://claude.ai/code)
3. **Clone the repository** in your terminal:

> `git clone [PLACEHOLDER: https://github.com/your-org/your-repo.git]`

4. **Navigate into the project folder:**

> `cd [PLACEHOLDER: your-repo]`

5. **Start Claude Code** by typing `claude` in your terminal

From there, describe the change you want in plain English — Claude Code has full access to the codebase and understands the project's conventions.

### Making Changes

Whether you're using the desktop app or the terminal, the workflow is the same: describe what you want in plain English. You don't need to write code yourself, but understanding what the system can do and how to describe changes clearly will help you get better results.

### Saving and Pushing Your Changes

After Claude Code makes a change, you'll want to save it back to the shared repository so it can be deployed. Tell Claude Code:

> "Commit these changes with a descriptive message and push to the repository."

Or if you'd prefer to review first:

> "Show me a summary of what changed."

Then when you're ready:

> "Commit and push these changes."

If your organization uses pull requests for review, tell Claude Code:

> "Create a pull request with these changes."

Claude Code will commit your changes, push them to the repository, and open a PR for your team to review before the changes go live.

---

## Adding a New Query Tool

A query tool lets Claude look up a specific type of data from your database. To add one, tell Claude Code:

> "Add a new MCP tool called `query_volunteers` that looks up volunteer records. It should accept optional filters for status, date range, and program. It should return the matching volunteer records with name, email, hours logged, and program assignment."

Claude Code will:
- Create the tool file with the correct registration pattern
- Register it in the server's main file
- Create a database migration so the tool is accessible to the roles you specify
- Update the test file

**Important details to include in your request:**
- The tool name (use `snake_case`, prefix with `query_` for data lookups or `get_` for single-record retrieval)
- What data it should return
- What filters or parameters it should accept
- Which roles should have access (e.g., "program_staff, leadership, and admin")
- What category it belongs to: `students`, `donor_finance`, `search`, `skills`, `future`, or `other`

After Claude Code creates the tool, ask it to run the type checker and tests to verify everything works.

---

## Adding or Modifying a Skill

Skills are different from query tools. Instead of returning raw data, they return a structured set of instructions that Claude follows step by step — calling multiple data tools along the way to produce a polished output like a board packet, audit report, or grant proposal.

### Adding a New Skill

Tell Claude Code what the skill should produce and what data it needs:

> "Add a new skill called `skill_annual_report` that generates an annual report. It should instruct Claude to gather enrollment data, attendance trends, competency outcomes, certification pass rates, employment outcomes, and financial summaries, then produce a formatted narrative with data tables suitable for an annual report to stakeholders."

Claude Code will create both the prompt builder (the instructions template) and the tool registration.

### Fixing a Skill That Produces Bad Output

If a skill generates incorrect, incomplete, or poorly formatted results, the fix is in the **prompt builder** — the file that contains the instructions Claude follows. Tell Claude Code what's wrong:

> "The board reporting skill is missing donor data in its output. Update it to include a step that calls `query_donors` to pull recent gifts and includes a fundraising summary section in the final report."

> "The grant writing skill formats the budget section as a bullet list but it should be a table. Update the formatting instructions."

> "The finance audit skill references a column called `account_type` but the actual column is `account_category`. Fix the reference."

Common issues and how to describe them:
- **Missing data**: "The skill doesn't include [X data]. Add a step that calls [tool name] and includes the results in [section]."
- **Wrong format**: "The output should be [format] instead of [current format]."
- **Stale references**: "The skill references [old name] but it should be [new name]."

---

## Fixing an Incorrectly Defined Tool

### Claude Is Misusing a Tool

If Claude calls a tool when it shouldn't, or doesn't call it when it should, the tool's description needs updating. The description is what Claude reads to decide when to use a tool.

> "Update the description for `query_attendance` to clarify that it only has data for the current program year, not historical years."

> "The `get_entity_brief` tool description should mention that it also returns donor information when the person is in the Development CRM."

### A Tool Returns Wrong Data

If a tool returns incorrect or incomplete results, the query logic needs fixing:

> "The `query_enrollment` tool is counting inactive students in the total headcount. Fix it to only count students with an active enrollment status."

> "The `query_finances` tool is returning all finance snapshots instead of filtering by the requested time period. Fix the query to respect the `time_period` parameter."

Ask Claude Code to run the tests after any fix to make sure nothing else broke.

### A Tool Has Wrong Permissions

If a tool is accessible to the wrong roles, or blocked for roles that should have access:

**Quick fix (no code change):** Use the HQ Admin page at **[PLACEHOLDER: https://hq.yourorg.example.com/admin]**. The Permissions Matrix lets you toggle which roles can access which tools. Changes take effect within about 60 seconds.

**Permanent fix (survives database resets):** Tell Claude Code:

> "Update the permissions for `query_donors` so that `development`, `leadership`, and `admin` roles can access it, but not `program_staff`."

Claude Code will create a database migration with the updated permissions.

---

## Managing Permissions

### Via the HQ Admin UI (No Code Required)

Sign in to HQ at **[PLACEHOLDER: https://hq.yourorg.example.com]** with an admin account and navigate to the Admin page.

**User management:**
- **Activate** a pending user so they can start using tools
- **Assign roles** to control what data they can access
- **Disable** an account to immediately revoke all access
- **Add a user** before they sign in, so their roles are ready on first login

**Permissions Matrix:**
- An interactive grid showing every tool crossed with every role
- Toggle checkboxes to grant or revoke access
- Changes take effect within about 60 seconds — no server restart needed
- The `admin` role always has full access (cannot be toggled off)
- The `pending` role never has access (cannot be toggled on)

### Via Claude Code (Persistent Changes)

For permission changes that should survive database resets or new environment deployments, ask Claude Code to create a migration:

> "Create a migration that gives the `development` role access to `query_finances` and `get_finance_brief`."

### Role Definitions

Roles are customizable per organization. The default set is:

| Role | Intended For |
|---|---|
| `pending` | New sign-ups before admin review (cannot call any tools) |
| `program_staff` | Front-line program team |
| `development` | Fundraising and donor relations |
| `sales` | Sales roles |
| `finance` | Accounting and financial reporting |
| `software_dev` | Engineering team |
| `leadership` | Executive leadership (broad access) |
| `admin` | System administrators (full access, always granted) |

### Adding a New Role

Tell Claude Code:

> "Add a new role called `board_member` with read-only access to `get_finance_brief`, `query_enrollment`, and `skill_board_reporting`."

Claude Code will add the role to both the MCP server and HQ admin panel, and create a migration to grant the appropriate tool permissions.

---

## Adding Data Sources (Connectors)

Connectors sync data from external systems (spreadsheets, APIs, databases) into the central database so that MCP tools can query it.

### Adding a New Connector

Tell Claude Code what data source you want to connect and what data it provides:

> "Add a new connector for Salesforce that syncs contact records into a `contacts` table. It should pull name, email, phone, organization, and last activity date. Use the Salesforce REST API with an OAuth token from the environment."

Claude Code will:
- Create the connector with the standard sync pattern
- Add any new database tables needed
- Register a sync script so it can be run on a schedule
- The new connector will appear on the HQ Sync page at **[PLACEHOLDER: https://hq.yourorg.example.com/sync]**

### Updating Existing Data Mappings

If the source data shape changes (e.g., a spreadsheet adds a column, an API response adds a field):

> "The Google Sheet for attendance now has a `tardiness_minutes` column. Add that column to the attendance table and make it queryable through `query_attendance`."

Claude Code will update the connector's parsing logic, the database schema, and the relevant MCP tool.

---

## Extending the HQ Dashboard

### Adding a New Page

Describe what the page should show:

> "Add a new HQ page at `/reports` that shows a summary table of all active participants with their attendance rate, current program phase, and most recent competency score. Add a link to it in the navigation bar."

The page will be accessible at **[PLACEHOLDER: https://hq.yourorg.example.com/reports]** and protected by the same authentication as all other HQ pages.

### Adding Charts and Visualizations

The dashboard uses Recharts for data visualization. Describe what you want to see:

> "Add a bar chart to the dashboard that shows monthly donation totals for the current fiscal year."

> "Add a line chart showing certification pass rates over time, broken down by certification type."

> "Add a table to the home page that shows the top 10 donors by total giving amount."

### Modifying Existing Dashboard Pages

The current dashboard pages are:

| Page | URL | What It Shows |
|---|---|---|
| **Home** | [PLACEHOLDER: https://hq.yourorg.example.com/] | Data freshness, token usage, recent tool calls |
| **Dashboard** | [PLACEHOLDER: https://hq.yourorg.example.com/dashboard] | Enrollment, attendance trends, competency charts, heatmaps |
| **Sync** | [PLACEHOLDER: https://hq.yourorg.example.com/sync] | Connector sync run history and status |
| **Tool Log** | [PLACEHOLDER: https://hq.yourorg.example.com/tools] | MCP tool call audit log |
| **Admin** | [PLACEHOLDER: https://hq.yourorg.example.com/admin] | User management and permissions matrix |

To modify an existing page:

> "On the dashboard page, replace the competency scatter chart with a grouped bar chart that shows average competency growth by program phase."

> "On the sync page, add a column showing how long each sync took in seconds."

> "On the home page, add a section showing the number of active users and their last login dates."

### Adding Admin Features

The admin page can be extended with new management capabilities:

> "Add a section to the admin page that shows an audit log of all permission changes — who changed what role's access to which tool, and when."

> "Add a bulk user import feature to the admin page that accepts a CSV of email addresses and roles."

### Making a Page Public

By default, all HQ pages require authentication. If you need a page accessible without sign-in (e.g., a status page or embed):

> "Make the `/api/health` endpoint and a new `/status` page accessible without authentication."

---

## Verifying Changes

After any change, ask Claude Code to verify the work:

> "Run the type checker and all tests to make sure everything passes."

> "Build the MCP server and start it to verify the new tool works."

> "Start the HQ dev server so I can preview the dashboard changes."

Claude Code will run the appropriate commands and report any issues.
