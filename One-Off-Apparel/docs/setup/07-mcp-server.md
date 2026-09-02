# Phase 7 — MCP Server

**Goal:** Port all 13 MCP tools from V0 to V1 (Drizzle → Prisma), add the `search_documents` tool backed by pgvector, and verify each tool locally using MCP Inspector.

**Prerequisites:**
- Phase 4 complete — Prisma client generated
- Phase 5 complete — data in Postgres (students, outcomes, finances, etc.)
- Phase 6 complete — embeddings in `document_chunks`

---

## 1. Scaffold `apps/mcp-server`

```bash
mkdir -p "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/apps/mcp-server/src/tools"
```

**`apps/mcp-server/package.json`:**
```json
{
  "name": "@lp-ai/mcp-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --env-file=../../.env --watch dist/index.js",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@lp-ai/lib-db": "workspace:*",
    "@lp-ai/lib-config": "workspace:*",
    "@lp-ai/lib-embedding": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

---

## 2. Tool inventory

All 26 tools are registered. Tool names and descriptions must remain **identical** — Claude's internal prompting depends on them.

| Tool | V0 source file | Primary table(s) |
|---|---|---|
| `get_student_info` | `tools/get-student-info.ts` | `student_info`, `students` |
| `query_students` | `tools/query-students.ts` | `students` |
| `query_outcomes` | `tools/query-outcomes.ts` | `student_phase_outcomes` |
| `query_enrollment` | `tools/query-enrollment.ts` | `enrollment_snapshots` |
| `query_certifications` | `tools/query-certifications.ts` | `student_certifications` |
| `query_competency` | `tools/query-competency.ts` | `student_competencies` |
| `query_finances` | `tools/query-finances.ts` | `finance_snapshots` |
| `query_donors` | `tools/query-donors.ts` | `donor_contacts`, `donor_gifts`, `donor_pipeline` |
| `query_attendance` | `tools/query-attendance.ts` | `attendance_records` |
| `search_conversations` | `tools/search-conversations.ts` | `document_chunks` (source = slack/notion) |
| `search_by_person` | `tools/search-by-person.ts` | `entity_aliases` → multiple |
| `get_entity_brief` | `tools/get-entity-brief.ts` | multiple |
| `get_finance_brief` | `tools/get-finance-brief.ts` | `finance_snapshots` |
| `search_documents` | **new** | `document_chunks` (pgvector) |

---

## 3. Key migration pattern (Drizzle → Prisma)

**V0 (Drizzle):**
```typescript
const rows = await db
  .select()
  .from(students)
  .where(eq(students.enrollmentStatus, 'active'))
  .limit(100);
```

**V1 (Prisma):**
```typescript
const rows = await prisma.student.findMany({
  where: { enrollmentStatus: 'active' },
  take: 100,
});
```

For raw SQL (used in `query_students` for percentiles and aggregations):

```typescript
const result = await prisma.$queryRaw<{ avg_attendance: number }[]>`
  SELECT AVG(percentage) as avg_attendance
  FROM attendance_records
  WHERE cohort = ${cohort}
`;
```

---

## 4. MCP server entry point

**`apps/mcp-server/src/index.ts`:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerGetStudentInfo } from './tools/get-student-info.js';
import { registerQueryStudents } from './tools/query-students.js';
// ... import all tools

const server = new McpServer({
  name: 'lp-internal-ai',
  version: '1.0.0',
});

registerGetStudentInfo(server);
registerQueryStudents(server);
// ... register all tools

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 5. Test locally with MCP Inspector

```bash
# Install MCP Inspector globally
npm install -g @modelcontextprotocol/inspector

# Build first
pnpm --filter @lp-ai/mcp-server build

# Launch inspector
npx @modelcontextprotocol/inspector node "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/apps/mcp-server/dist/index.js"
```

Opens a browser UI at `http://localhost:5173`. Test each tool manually.

---

## 6. Connect to Claude Desktop (local testing)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lp-internal-v1": {
      "command": "node",
      "args": ["/Users/christian/Documents/Claude/Projects/LP Internal AI V1/apps/mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "<your local DATABASE_URL>",
        "OPENAI_API_KEY": "<key>"
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear in the tool picker.

---

## Verification checklist

- [ ] `pnpm --filter @lp-ai/mcp-server build` completes without errors
- [ ] All 26 tools registered in MCP Inspector
- [ ] `get_student_info` returns a real student record
- [ ] `query_finances` returns current finance snapshot data
- [ ] `search_documents` returns semantically relevant chunks
- [ ] `usage_logs` table gets a row after each tool call

---

## Known pitfalls

- **Tool name drift** — never rename a tool without updating the V1 MCP spec in `docs/mcp-server-spec.md`
- **Prisma client not generated** — run `pnpm db:generate` after any schema change before building the MCP server
- **`$queryRaw` type safety** — Prisma's `$queryRaw` returns `unknown`; always cast with `as YourType[]` and validate with Zod

---

**Next:** [08-hq-dashboard.md](08-hq-dashboard.md)
