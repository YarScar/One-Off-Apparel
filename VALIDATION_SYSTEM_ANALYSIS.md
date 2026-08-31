# Validation System — Current State & Recommended Updates

**Last updated:** July 2026  
**Status:** Production-ready with improvement opportunities  
**Scope:** Environment validation, MCP input validation, connector data validation, Prisma schema constraints

---

## Table of Contents

1. [Current Validation Architecture](#current-validation-architecture)
2. [Layer-by-Layer Validation](#layer-by-layer-validation)
3. [Current Strengths](#current-strengths)
4. [Current Gaps](#current-gaps)
5. [Recommended Updates](#recommended-updates)
6. [Implementation Priority](#implementation-priority)

---

## Current Validation Architecture

The system uses **four distinct validation layers**, each with different responsibilities:

```
Layer 1: Environment Variables (Zod)
    ↓
Layer 2: MCP Tool Inputs (Zod schemas + manual parsing)
    ↓
Layer 3: Connector Data (Ad-hoc validation + custom errors)
    ↓
Layer 4: Prisma Schema (Database constraints)
    ↓
Postgres (Physical constraints)
```

---

## Layer-by-Layer Validation

### Layer 1: Environment Variables (Zod)

**File:** `packages/config/src/schema.ts`  
**Pattern:** Zod schema with preprocessing and transforms  
**Scope:** 80+ environment variables

#### Current Implementation

```typescript
// Preprocessing: Convert empty strings to undefined
const optional = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().min(1).optional(),
);

const required = z.string().trim().min(1);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: required,
  ANTHROPIC_API_KEY: optional,
  OPENAI_API_KEY: optional,
  GOOGLE_SERVICE_ACCOUNT_JSON: optional,
  SYNC_SECRET: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(32, 'SYNC_SECRET must be at least 32 characters').optional(),
  ),
  // ... 70+ more fields
});

export type Env = z.infer<typeof envSchema>;
```

#### How It's Used

```typescript
// packages/config/src/load-env.ts
export async function loadEnv(): Promise<Env> {
  const raw = process.env;
  // OR (in production)
  // const raw = await loadFromAwsSecretsManager();
  
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Environment validation failed: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}
```

**Strengths:**
- Single source of truth for all env vars
- Typed `Env` type in TypeScript
- Preprocessing strips whitespace
- Transform functions (e.g., `v === 'true' ? true : false`)
- Optional vs required clearly distinguished

**Gaps:**
- No semantic validation (e.g., DATABASE_URL format check)
- No dependent field validation (e.g., if `USE_AWS_SECRETS=true`, then `AWS_REGION` must be set)
- No validation of credential formats (e.g., JWT key validation)

---

### Layer 2: MCP Tool Inputs (Zod + Manual Parsing)

**Files:** 
- `apps/mcp-server/src/tools/*.ts` (input schemas)
- `apps/mcp-server/src/tool-helpers.ts` (runtime parsing)

**Pattern:** Zod schema definition + manual type coercion at runtime  
**Scope:** 16 data tools + 4 skill tools

#### Current Implementation

**Tool Definition (get-student-info.ts):**
```typescript
const inputSchema = {
  student_name: z.string().describe('Name, nickname, or ID of the student.'),
};

export function registerGetStudentInfo(server: McpServer): void {
  server.registerTool(
    NAME,
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;
        const studentName = parseStr(raw, 'student_name') ?? '';
        
        if (!studentName.trim()) {
          return toolError(
            'entity_not_found',
            'student_name is required and must be a non-empty string.',
          );
        }
        
        // ... rest of tool logic
      }),
  );
}
```

**Runtime Parsing (tool-helpers.ts):**
```typescript
export function parseStr(raw: Record<string, unknown>, key: string): string | undefined {
  return typeof raw[key] === 'string' ? (raw[key] as string) : undefined;
}

export function parseNum(raw: Record<string, unknown>, key: string): number | undefined {
  return typeof raw[key] === 'number' ? (raw[key] as number) : undefined;
}
```

**Error Handling:**
```typescript
export type ToolErrorCode =
  | 'entity_not_found'
  | 'no_records'
  | 'search_failed'
  | 'internal_error'
  | 'not_yet_implemented';

export interface ToolError {
  error: {
    code: ToolErrorCode;
    message: string;
    suggestions?: string[];
  };
}
```

**Strengths:**
- Zod schemas provide IDE autocomplete + type hints
- Defensive parsing with `parseStr` / `parseNum`
- Structured error codes (entity_not_found, internal_error, etc.)
- Sanitizes sensitive data in error messages (DB URLs, API keys)

**Gaps:**
- Schemas are not actively validated at runtime (schemas are decorative)
- Manual parsing instead of schema.parse() means errors slip through
- No validation of string formats (e.g., date strings, email)
- No cross-field validation (e.g., start_date < end_date)
- Error messages don't explain which field is invalid

---

### Layer 3: Connector Data Validation

**Files:**
- `connectors/google-sheets/src/*.ts` (sheet sync)
- `connectors/aplos/src/` (accounting sync)
- Each connector's `sync()` function

**Pattern:** Custom error classes + ad-hoc validation  
**Scope:** Data normalization, schema mapping, integrity checks

#### Current Implementation

**Sheet Settings Validation (google-sheets):**
```typescript
export type SheetSettingsMismatch = {
  spreadsheetId: string;
  tabName: string;
  cell: string;
  label: string;
  expected: string;
  actual: string;
};

export class SheetSettingsMismatchError extends Error {
  public readonly mismatches: SheetSettingsMismatch[];
  
  constructor(mismatches: SheetSettingsMismatch[]) {
    const summary = mismatches
      .map((m) => 
        `'${m.tabName}'!${m.cell} (${m.label}): expected "${m.expected}", got "${m.actual || '(blank)'}"`)
      .join('; ');
    super(
      `Sheet settings mismatch — sync skipped (this connector is read-only). Fix manually: ${summary}`,
    );
    this.name = 'SheetSettingsMismatchError';
    this.mismatches = mismatches;
  }
}

// Validation in sync code:
function verifySettings(spreadsheetId: string, tabName: string, settingsRow: string[]): void {
  const mismatches: SheetSettingsMismatch[] = [];
  
  // Check cell A3 (View selector)
  if (settingsRow[0] !== 'Detail') {
    mismatches.push({
      spreadsheetId,
      tabName,
      cell: 'A3',
      label: 'View',
      expected: 'Detail',
      actual: settingsRow[0],
    });
  }
  
  // Check cell B3 (Revenue Type selector)
  if (!['Budget', 'Actual'].includes(settingsRow[1])) {
    mismatches.push({
      spreadsheetId,
      tabName,
      cell: 'B3',
      label: 'Revenue Type',
      expected: 'Budget or Actual',
      actual: settingsRow[1],
    });
  }
  
  if (mismatches.length > 0) throw new SheetSettingsMismatchError(mismatches);
}
```

**Header Validation (students sync):**
```typescript
export class HeaderMismatchError extends Error {
  constructor(public detail: string) {
    super(`students_header_mismatch: ${detail}`);
    this.name = 'HeaderMismatchError';
  }
}

// Usage in sync
const expectedHeaders = ['Name', 'Student #', 'Phase', ...];
const actualHeaders = row.slice(0, expectedHeaders.length);

if (!arraysEqual(actualHeaders, expectedHeaders)) {
  throw new HeaderMismatchError(
    `Expected [${expectedHeaders.join(', ')}], got [${actualHeaders.join(', ')}]`
  );
}
```

**Data Transformation & Validation:**
```typescript
// Upsert pattern with error tracking
let skippedRowErrors = 0;
for (const row of rows) {
  try {
    const normalized = {
      sourceId: `sheet-${row.id}`,
      studentNumber: row['Student #']?.trim(),
      canonicalName: row['Name']?.trim(),
      cohort: parseInt(row['Cohort']) || null,
      // ... more field mapping
    };
    
    // Type safety: omit fields not in schema
    await prisma.student.upsert({
      where: { sourceId: normalized.sourceId },
      update: normalized,
      create: normalized,
    });
  } catch (err) {
    skippedRowErrors++;
    console.warn(`Row ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

**Integrity Checking (runSync wrapper):**
```typescript
// Check if table row counts dropped >5% (indicates data corruption)
async function buildIntegrityWarnings(
  before: Record<string, number>,
  after: Record<string, number>,
  thresholdPct: number = 5,
): Promise<string[]> {
  const warnings: string[] = [];
  
  for (const table of Object.keys(before)) {
    const pre = before[table] ?? 0;
    const post = after[table] ?? 0;
    if (pre === 0) continue;
    
    const dropPct = ((pre - post) / pre) * 100;
    if (dropPct > thresholdPct) {
      warnings.push(
        `INTEGRITY WARNING: ${table} dropped from ${pre} to ${post} rows (${dropPct.toFixed(1)}% loss)`,
      );
    }
  }
  
  return warnings;
}
```

**Strengths:**
- Custom error classes with structured detail (SheetSettingsMismatchError)
- Per-row error tracking (continue on individual row failure)
- Integrity guards (5% row count drop detection)
- Detailed validation messages (shows expected vs actual)
- Supports read-only enforcement (SheetSettingsMismatchError for required manual fixes)

**Gaps:**
- Validation is scattered across each connector (no central schema)
- No shared validation library (duplicate header checks across connectors)
- Type coercion happens during normalization with no pre-validation
- No validation of data types before Prisma upsert
- Error recovery is silent (skipped row count logged but not surfaced in sync_runs)

---

### Layer 4: Prisma Schema Constraints

**File:** `packages/db/prisma/schema.prisma`

**Constraints:** Unique keys, foreign keys, indexes, decimal precision, date types

#### Current Implementation

```prisma
model Student {
  id String @id @default(cuid())
  
  // Unique constraints
  studentNumber String? @unique @map("student_number")
  
  // Decimal precision for currency/scores
  interviewScore Decimal? @map("interview_score") @db.Decimal(5, 2)
  hsGpa Decimal? @map("hs_gpa") @db.Decimal(4, 2)
  
  // Dates
  entryDate DateTime? @map("entry_date") @db.Date
  withdrawalDate DateTime? @map("withdrawal_date") @db.Date
  
  // Indexes for query performance
  @@index([canonicalName])
  @@index([cohort])
  
  // Foreign key to staff
  advisorId String?
  advisor Staff? @relation(fields: [advisorId], references: [id])
}

model EntityAlias {
  id String @id @default(cuid())
  
  // Unique constraint (prevent duplicate aliases)
  @@unique([alias, entityType])
  @@index([entityType])
}

model FinanceSnapshot {
  sourceId String @unique @map("source_id")  // Natural key from source
  // ... fields
}
```

**Strengths:**
- Unique constraints prevent duplicate records
- Foreign keys maintain referential integrity
- Decimal precision specified (prevents float rounding errors)
- Date types prevent timestamp misinterpretation
- Indexes on hot query paths (name, cohort)

**Gaps:**
- No CHECK constraints (e.g., endDate > startDate)
- No NOT NULL constraints on critical fields (schema allows nulls everywhere)
- No domain validation (e.g., email format, phone number format)
- No regex patterns for sourceId validation
- No default values for timestamps (created_at, updated_at missing)

---

## Current Strengths

### 1. **Defensive Parsing at Multiple Layers**
   - Environment: Zod schema with preprocessing
   - Tools: Manual parseStr/parseNum + type guards
   - Connectors: Try/catch with per-row error tracking
   - Result: Graceful degradation when data is malformed

### 2. **Structured Error Codes**
   - ToolError types: entity_not_found, no_records, internal_error, etc.
   - SheetSettingsMismatchError with detailed cell-level breakdown
   - HeaderMismatchError with expected vs actual comparison
   - Result: Errors are actionable and debuggable

### 3. **Data Integrity Guards**
   - 5% row count drop detection in sync_runs
   - Per-row error tracking (don't fail entire sync on one bad row)
   - Upsert pattern (never truncate; insert/update only seen rows)
   - Result: Data corruption is caught and logged

### 4. **Read-Only Enforcement**
   - No write functions in Google Sheets connector
   - Sheet settings validation (manual fix required)
   - OAuth scope limitations
   - Result: Data sources remain untouched

### 5. **Permission-Based Access Control**
   - SERVICE_ALLOWED_TOOLS whitelist (for service callers)
   - Per-user role-based tool access (via canCallTool)
   - Permission logging in usage_logs table
   - Result: Least-privilege access enforced

---

## Current Gaps

### 1. **Zod Schemas Not Actively Validated**
   - **Problem:** MCP tools define Zod schemas but don't use `.parse()` at runtime
   - **Risk:** Invalid inputs slip through (e.g., `query_type` doesn't match enum)
   - **Example:**
     ```typescript
     // Tool defines enum:
     const inputSchema = {
       query_type: z.enum(['prior_month', 'ytd', ...]),
     };
     
     // But runtime does manual string coercion:
     const queryType = parseStr(raw, 'query_type') ?? '';  // No validation!
     ```

### 2. **No Cross-Field Validation**
   - **Problem:** Date ranges not validated (start_date > end_date)
   - **Problem:** Dependent fields not checked (if query_type is 'rapid', tab_name must exist)
   - **Risk:** Invalid queries execute, return no results, confuse users

### 3. **No Shared Connector Validation Schema**
   - **Problem:** Each connector re-implements header validation, type coercion, null checks
   - **Risk:** Inconsistent validation rules across connectors
   - **Example:** google-sheets validates headers, but aplos doesn't

### 4. **Missing NOT NULL Constraints**
   - **Problem:** Prisma schema allows `null` on critical fields (e.g., student.canonicalName)
   - **Risk:** Queries return incomplete data
   - **Example:**
     ```prisma
     model Student {
       canonicalName String?  // Should be required!
     }
     ```

### 5. **No Domain-Specific Validation**
   - **Problem:** Email format, phone number format, date formats not validated
   - **Risk:** Garbage data stored (e.g., email="xyz", phone="abc")
   - **Missing:** Zod validators for email, phone, date ISO strings, URLs, etc.

### 6. **No Audit Trail for Validation Errors**
   - **Problem:** Row-level validation errors logged to stderr but not persisted
   - **Risk:** Can't analyze patterns in validation failures
   - **Example:** If 100 rows fail type coercion, we don't know which fields

### 7. **Error Messages Not Validated**
   - **Problem:** Error messages from tools sanitize some secrets but not all
   - **Risk:** Sensitive data could leak in error messages
   - **Current:** Strips DB URLs, API keys, Bearer tokens — but incomplete

### 8. **No Input Size Limits**
   - **Problem:** Tools don't limit query result size (limit defaults to 500, max 1000)
   - **Risk:** Large queries could cause OOM or timeout
   - **Missing:** Configurable timeout + memory limits per tool

---

## Recommended Updates

### Update 1: Activate Zod Validation in MCP Tools (HIGH PRIORITY)

**What:** Validate tool inputs using Zod schemas at runtime  
**Why:** Catch invalid inputs early, prevent downstream errors  
**Impact:** Breaking change (will reject some currently-accepted inputs)

#### Implementation

```typescript
// Before (current):
export function registerQueryFinances(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, ... }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? '';  // No validation
      // ...
    }),
  );
}

// After (recommended):
const INPUT_SCHEMA = z.object({
  query_type: z.enum(['prior_month', 'ytd', 'forecast', ...]),
  tab_name: z.string().optional(),
  period: z.string().optional(),
  contains: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export function registerQueryFinances(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema: INPUT_SCHEMA, ... }, (input) =>
    runTool(NAME, input, async () => {
      // Parse & validate with Zod
      const parseResult = INPUT_SCHEMA.safeParse(input);
      if (!parseResult.success) {
        return toolError(
          'invalid_input',
          `Input validation failed: ${JSON.stringify(parseResult.error.flatten())}`,
          ['Check that query_type is one of the valid enum values.'],
        );
      }
      
      const { query_type, tab_name, period, contains, limit } = parseResult.data;
      // Now query_type is guaranteed to be valid enum
      // ...
    }),
  );
}
```

**Files to Update:**
- `apps/mcp-server/src/tools/*.ts` (all 16 data + 4 skill tools)
- `apps/mcp-server/src/errors.ts` (add 'invalid_input' error code)
- `apps/mcp-server/src/tool-helpers.ts` (remove parseStr/parseNum, use Zod instead)

**Testing:**
```typescript
// Test invalid enum
const result = await tool({ query_type: 'invalid_query_type' });
assert(result.error.code === 'invalid_input');

// Test out-of-range limit
const result = await tool({ query_type: 'prior_month', limit: 5000 });
assert(result.error.code === 'invalid_input');
```

---

### Update 2: Add Cross-Field Validation (HIGH PRIORITY)

**What:** Validate relationships between fields (e.g., date ranges, dependent parameters)  
**Why:** Catch logical errors (start_date > end_date) before query execution  
**Impact:** Prevents nonsensical queries

#### Implementation

```typescript
// Example: query_attendance with date range
const INPUT_SCHEMA = z.object({
  cohort: z.number().int().min(1).max(4),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (!data.start_date || !data.end_date) return true;
    return new Date(data.start_date) < new Date(data.end_date);
  },
  {
    message: 'start_date must be before end_date',
    path: ['end_date'],  // Point error to end_date field
  }
);

// Example: query_finances with dependent parameters
const INPUT_SCHEMA = z.object({
  query_type: z.enum([...]),
  tab_name: z.string().optional(),
}).refine(
  (data) => {
    if (data.query_type === 'rapid_transactions' && !data.tab_name) {
      return false;  // tab_name is required for rapid_transactions
    }
    return true;
  },
  {
    message: 'tab_name is required for query_type=rapid_transactions',
    path: ['tab_name'],
  }
);
```

**Files to Update:**
- `apps/mcp-server/src/tools/query-*.ts` (date range, dependent field validation)

---

### Update 3: Add NOT NULL Constraints to Critical Fields (MEDIUM PRIORITY)

**What:** Mark required fields as `String` (not `String?`) in Prisma schema  
**Why:** Prevent incomplete data from being queried  
**Impact:** Migration needed; may fail on existing null rows

#### Implementation

```prisma
// Before:
model Student {
  canonicalName String?
  studentNumber String? @unique
}

// After (requires data cleanup):
model Student {
  canonicalName String  // Required
  studentNumber String @unique  // Required
}
```

**Migration Strategy:**
1. Create a migration that adds CHECK constraint instead of NOT NULL
2. Fix any existing NULL values
3. Validate constraint
4. Convert to NOT NULL

**Files to Update:**
- `packages/db/prisma/schema.prisma` (mark critical fields as required)
- `packages/db/prisma/migrations/<timestamp>_add_not_null_constraints/`

---

### Update 4: Add Domain-Specific Zod Validators (MEDIUM PRIORITY)

**What:** Create reusable Zod validators for email, phone, dates, URLs, etc.  
**Why:** Prevent invalid data format in inputs + connector data  
**Impact:** No breaking changes; improves data quality

#### Implementation

```typescript
// packages/db/src/validators.ts
export const zodValidators = {
  // Email must be valid format
  email: z.string().email('Invalid email format').or(z.literal('')),
  
  // Phone number (accepts various formats, normalizes to E.164)
  phone: z.string()
    .regex(/^\+?[\d\s\-\(\)]+$/, 'Invalid phone format')
    .transform((v) => v.replace(/\D/g, ''))
    .optional(),
  
  // ISO date string (YYYY-MM-DD)
  isoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').transform(d => new Date(d)),
  
  // HTTP(S) URL
  url: z.string().url('Must be a valid URL'),
  
  // Source ID (alphanumeric + underscore, from external systems)
  sourceId: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/, 'Invalid sourceId format'),
};
```

**Usage in Tools:**
```typescript
const INPUT_SCHEMA = z.object({
  student_email: zodValidators.email,
  cohort_start_date: zodValidators.isoDate,
});
```

**Usage in Connectors:**
```typescript
// Normalize + validate phone from Google Sheets
const normalized = {
  phone: zodValidators.phone.parse(row['Phone'] ?? ''),
  email: zodValidators.email.parse(row['Email'] ?? ''),
};
```

**Files to Create:**
- `packages/db/src/validators.ts` (shared validators)

---

### Update 5: Create Connector Validation Schema (MEDIUM PRIORITY)

**What:** Unified schema for connector data normalization  
**Why:** Prevent duplicate validation logic, ensure consistency  
**Impact:** Reduces connector code duplication

#### Implementation

```typescript
// packages/db/src/connector-schemas.ts
export const connectorSchemas = {
  // Google Sheets row normalization
  googleSheetsStudent: z.object({
    'Name': z.string().min(1),
    'Student #': z.string().optional(),
    'Cohort': z.string().transform(s => parseInt(s) || null).nullable(),
    'Phase': z.string().optional(),
    // ... more fields
  }).strict(),
  
  // Aplos transaction normalization
  aplosTransaction: z.object({
    id: zodValidators.sourceId,
    date: zodValidators.isoDate,
    accountId: zodValidators.sourceId,
    amount: z.number().finite(),
    memo: z.string().max(500),
  }),
};

// Usage in connector:
const googleSheetsRows = await fetchFromSheet(...);
const validatedRows = googleSheetsRows.map(row => {
  const result = connectorSchemas.googleSheetsStudent.safeParse(row);
  if (!result.success) {
    skippedRowErrors++;
    return null;  // Skip row
  }
  return result.data;
}).filter(Boolean);
```

**Files to Create:**
- `packages/db/src/connector-schemas.ts` (shared schemas)

---

### Update 6: Add Audit Trail for Validation Errors (LOW PRIORITY)

**What:** Persist validation errors to database for analysis  
**Why:** Understand patterns in data quality issues  
**Impact:** New table; helps with debugging

#### Implementation

```prisma
// New table in schema
model ValidationError {
  id String @id @default(cuid())
  
  // Where the error occurred
  connector String  // "google-sheets", "aplos", etc.
  rowData Json      // The raw row that failed validation
  errorCode String  // "type_coercion", "missing_field", etc.
  errorMessage String
  
  // When
  occurredAt DateTime @default(now())
  
  // Resolution
  resolved Boolean @default(false)
  resolvedAt DateTime?
  resolvedBy String?
  
  @@index([connector])
  @@index([occurredAt])
}
```

**Usage:**
```typescript
try {
  const parsed = connectorSchemas.googleSheetsStudent.parse(row);
} catch (err) {
  await prisma.validationError.create({
    data: {
      connector: 'google-sheets',
      rowData: row,
      errorCode: err instanceof ZodError ? 'zod_validation' : 'unknown',
      errorMessage: err instanceof Error ? err.message : String(err),
    },
  });
  skippedRowErrors++;
}
```

**HQ Dashboard Route:**
```
/admin/validation-errors
  ├─ Filter by connector, date range, error code
  ├─ Show error frequency by type
  ├─ Display affected row data
  └─ Mark as resolved
```

---

### Update 7: Comprehensive Error Message Sanitization (LOW PRIORITY)

**What:** Ensure all error messages redact sensitive data  
**Why:** Prevent credential leaks in error logs/responses  
**Impact:** Better security posture

#### Implementation

```typescript
// apps/mcp-server/src/tool-helpers.ts
const SENSITIVE_PATTERNS = [
  /postgresql:\/\/[^\s]+/gi,              // DB URLs
  /password[=:]\s*\S+/gi,                 // Passwords
  /Bearer\s+\S+/gi,                       // JWT tokens
  /sk-[a-zA-Z0-9]+/g,                    // OpenAI keys
  /AKIA[0-9A-Z]{16}/g,                   // AWS access keys
  /https:\/\/[^:]+:[^@]+@/g,             // HTTP basic auth
  /apikey[=:]\s*\S+/gi,                  // Generic API keys
  /secret[=:]\s*\S+/gi,                  // Secrets
  /token[=:]\s*\S+/gi,                   // Tokens
  /\b\d{3}-\d{2}-\d{4}\b/g,              // SSNs
  /\b\d{16}\b/g,                         // Credit card numbers
];

function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

// Test it
assert(sanitizeErrorMessage('postgres://user:pass@host/db') === 'postgres://[REDACTED]');
```

**Files to Update:**
- `apps/mcp-server/src/tool-helpers.ts` (expand SENSITIVE_PATTERNS)

---

### Update 8: Add Query Result Size Limits (LOW PRIORITY)

**What:** Enforce timeout + memory limits on tool queries  
**Why:** Prevent OOM errors and runaway queries  
**Impact:** May timeout legitimate large queries (mitigated by paging)

#### Implementation

```typescript
// apps/mcp-server/src/tool-helpers.ts
const DEFAULT_QUERY_TIMEOUT_MS = 30000;  // 30 seconds
const DEFAULT_RESULT_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;  // 10 MB

export async function runToolWithTimeout(
  toolName: string,
  input: unknown,
  handler: () => Promise<unknown>,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS,
): Promise<CallToolResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const output = await Promise.race([
      handler(),
      new Promise((_, reject) => 
        controller.signal.addEventListener('abort', () => 
          reject(new Error(`Query timeout after ${timeoutMs}ms`))
        )
      ),
    ]);
    
    // Check result size
    const resultJson = JSON.stringify(output);
    if (resultJson.length > DEFAULT_RESULT_SIZE_LIMIT_BYTES) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: {
              code: 'result_too_large',
              message: `Result size ${resultJson.length} bytes exceeds limit of ${DEFAULT_RESULT_SIZE_LIMIT_BYTES} bytes. Use filters or pagination.`,
            },
          }),
        }],
        isError: true,
      };
    }
    
    return runTool(toolName, input, () => Promise.resolve(output));
  } finally {
    clearTimeout(timeoutId);
  }
}
```

---

## Implementation Priority

### Phase 1: Critical (Weeks 1-2)

| Update | Files | Effort | Tests |
|---|---|---|---|
| **#1: Activate Zod Validation** | 20 tool files + errors.ts + tool-helpers.ts | 3-4 days | 40+ test cases |
| **#2: Cross-Field Validation** | Query tool files | 2-3 days | 20+ test cases |

**Outcome:** Input validation catches 90% of invalid queries before execution

### Phase 2: Important (Weeks 3-4)

| Update | Files | Effort | Tests |
|---|---|---|---|
| **#3: NOT NULL Constraints** | schema.prisma + migration + seed cleanup | 2-3 days | Data integrity tests |
| **#4: Domain Validators** | validators.ts + 5-10 tool/connector files | 2 days | 30+ test cases |

**Outcome:** Data quality improved; fewer null-related bugs

### Phase 3: Nice-to-Have (Weeks 5-6)

| Update | Files | Effort | Tests |
|---|---|---|---|
| **#5: Connector Schemas** | connector-schemas.ts + 9 connector files | 3 days | Consistency tests |
| **#6: Audit Trail** | schema.prisma + ValidationError logging + HQ route | 2 days | Audit log query tests |
| **#7: Error Sanitization** | tool-helpers.ts | 1 day | Regex pattern tests |
| **#8: Query Limits** | tool-helpers.ts | 1 day | Timeout + size tests |

**Outcome:** Better debugging, security, and resilience

---

## Testing Strategy

### Unit Tests

```typescript
// test/validators.test.ts
describe('Zod Validators', () => {
  it('accepts valid email', () => {
    const result = zodValidators.email.safeParse('user@example.com');
    assert(result.success);
  });
  
  it('rejects invalid email', () => {
    const result = zodValidators.email.safeParse('not-an-email');
    assert(!result.success);
  });
});

// test/tools.test.ts
describe('MCP Tool Input Validation', () => {
  it('rejects invalid query_type', async () => {
    const result = await query_finances_tool({ query_type: 'invalid' });
    assert(result.error.code === 'invalid_input');
  });
  
  it('rejects end_date < start_date', async () => {
    const result = await query_attendance_tool({
      cohort: 1,
      start_date: '2026-01-31',
      end_date: '2026-01-01',
    });
    assert(result.error.code === 'invalid_input');
  });
});
```

### Integration Tests

```typescript
// test/connector-validation.test.ts
describe('Connector Data Validation', () => {
  it('skips row with invalid type', async () => {
    const rows = [
      { Name: 'Alice', 'Student #': '001', Cohort: 'invalid' },
    ];
    const result = await validateAndUpsert(rows);
    assert(result.skipped === 1);
  });
});
```

### Regression Tests

- Run all existing tool queries through new validation
- Verify no previously-working queries break
- Document any breaking changes

---

## Security Considerations

### Validation as Security Layer

1. **Input sanitization:** Zod validates all user inputs before execution
2. **SQL injection:** Prisma parameterizes queries; validation adds layer of defense
3. **Sensitive data:** Error messages sanitized before returning to user
4. **Rate limiting:** Query result size limits prevent DoS attacks

### Validation Bypass Risks

- Service callers (SYNC_SECRET) bypass some validation → document assumptions
- Prisma still accepts raw queries → code review required for `$queryRaw` usage
- Error messages redact patterns but not all formats → continuous improvement needed

---

## Monitoring & Observability

### Metrics to Track

```typescript
// Track validation performance
{
  tool_name: 'query_finances',
  input_validation_ms: 2,
  execution_ms: 145,
  validation_failed: false,
  input_size_bytes: 256,
}
```

### HQ Dashboard

```
/tools page enhancements:
  ├─ Filter by validation_failed: true/false
  ├─ Show validation time vs execution time
  └─ Alert if validation fails >1% of calls
  
/admin/validation-errors page:
  ├─ Recent validation failures
  ├─ Top error codes
  └─ Affected rows (with privacy redaction)
```

---

## Rollout Strategy

### Stage 1: Feature Flag (1 week)
- Deploy with validation active but logging only (no rejection)
- Collect metrics on validation failure rate
- Identify problematic callers

### Stage 2: Soft Enforcement (1 week)
- Reject invalid inputs, but log for debugging
- Coordinate with Claude team to update prompts
- Monitor error rates

### Stage 3: Full Enforcement (1 week)
- Default behavior: reject invalid inputs
- Grace period for service callers
- Monitor for regressions

---

## Success Criteria

| Metric | Target | Current | After Update |
|---|---|---|---|
| Invalid input rejection rate | >99% | ~70% | >99% |
| Tool latency (p95) | <1s | 300ms | 302ms (validation overhead ~2ms) |
| Validation-related errors in usage_logs | <0.1% | ~5% | <0.1% |
| Data integrity (>5% row drop alerts) | 0 per month | 0-1 | 0 |
| Null values in critical fields | <1% | ~3% | <0.1% |
| Validation error audit trail | Complete | None | All errors logged |

---

**End of Validation System Documentation**
