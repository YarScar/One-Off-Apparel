# Phase 4 — Prisma Schema

**Goal:** Set up the `@lp-ai/lib-db` package with a Prisma schema that ports every table from V0, adds the `document_chunks` pgvector table, and runs the first migration against RDS.

**Prerequisites:**
- Phase 2 complete — RDS running, `DATABASE_URL` in `.env`
- Phase 3 complete — Secrets Manager configured
- `pnpm install` run from repo root

---

## 1. Scaffold the `@lp-ai/lib-db` package

```bash
mkdir -p "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/packages/db/prisma"
mkdir -p "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/packages/db/src"
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1/packages/db"
```

Create `packages/db/package.json`:

```json
{
  "name": "@lp-ai/lib-db",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate deploy",
    "migrate:dev": "prisma migrate dev",
    "push": "prisma db push",
    "studio": "prisma studio",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@prisma/client": "^5.15.0"
  },
  "devDependencies": {
    "prisma": "^5.15.0",
    "typescript": "^5.4.5"
  }
}
```

---

## 2. Write `prisma/schema.prisma`

This is the full schema, ported from V0's Drizzle tables. See `docs/reference/v0-migrations/` for the source SQL.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

model Student {
  id                String   @id @default(uuid())
  canonicalName     String   @map("canonical_name")
  email             String?
  phone             String?
  currentPhase      String?  @map("current_phase")
  enrollmentStatus  String?  @map("enrollment_status")
  cohort            String?
  distanceToOffice  Float?   @map("distance_to_office")
  neighborhood      String?
  graduationDate    DateTime? @map("graduation_date")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  aliases           EntityAlias[]
  certifications    StudentCertification[]
  phaseOutcomes     StudentPhaseOutcome[]
  competencies      StudentCompetency[]
  enrollmentSnaps   EnrollmentSnapshot[]
  attendanceRecords AttendanceRecord[]
  studentInfo       StudentInfo[]

  @@map("students")
}

model Staff {
  id            String   @id @default(uuid())
  canonicalName String   @map("canonical_name")
  email         String?
  role          String?
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  aliases EntityAlias[]

  @@map("staff")
}

model EntityAlias {
  id            String   @id @default(uuid())
  alias         String
  entityType    String   @map("entity_type")
  studentId     String?  @map("student_id")
  staffId       String?  @map("staff_id")
  source        String?
  createdAt     DateTime @default(now()) @map("created_at")

  student Student? @relation(fields: [studentId], references: [id], onDelete: Cascade)
  staff   Staff?   @relation(fields: [staffId], references: [id], onDelete: Cascade)

  @@unique([alias, entityType])
  @@map("entity_aliases")
}

model StudentInfo {
  id          String   @id @default(uuid())
  studentId   String   @map("student_id")
  driveFileId String   @map("drive_file_id")
  content     String
  syncedAt    DateTime @default(now()) @map("synced_at")

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("student_info")
}

model StudentCertification {
  id              String    @id @default(uuid())
  studentId       String    @map("student_id")
  certName        String    @map("cert_name")
  issuedDate      String?   @map("issued_date")
  expirationDate  String?   @map("expiration_date")
  status          String?
  syncedAt        DateTime  @default(now()) @map("synced_at")

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("student_certifications")
}

model StudentPhaseOutcome {
  id          String   @id @default(uuid())
  studentId   String   @map("student_id")
  phase       String
  outcome     String?
  exitReason  String?  @map("exit_reason")
  startDate   String?  @map("start_date")
  endDate     String?  @map("end_date")
  syncedAt    DateTime @default(now()) @map("synced_at")

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("student_phase_outcomes")
}

model StudentCompetency {
  id             String   @id @default(uuid())
  studentId      String   @map("student_id")
  competencyArea String   @map("competency_area")
  skillName      String   @map("skill_name")
  score          Float?
  rubricLevel    String?  @map("rubric_level")
  assessedDate   String?  @map("assessed_date")
  syncedAt       DateTime @default(now()) @map("synced_at")

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("student_competencies")
}

model EnrollmentSnapshot {
  id            String   @id @default(uuid())
  studentId     String   @map("student_id")
  phase         String
  status        String?
  snapshotDate  String   @map("snapshot_date")
  syncedAt      DateTime @default(now()) @map("synced_at")

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("enrollment_snapshots")
}

model AttendanceRecord {
  id           String   @id @default(uuid())
  studentId    String   @map("student_id")
  cohort       String
  weekOf       String?  @map("week_of")
  attendanceDate String? @map("attendance_date")
  status       String?
  percentage   Float?
  syncedAt     DateTime @default(now()) @map("synced_at")

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@map("attendance_records")
}

model FinanceSnapshot {
  id           String   @id @default(uuid())
  category     String
  subcategory  String?
  amount       Float
  period       String
  fundOrPhase  String?  @map("fund_or_phase")
  source       String?
  syncedAt     DateTime @default(now()) @map("synced_at")

  @@map("finance_snapshots")
}

model DonorContact {
  id               String   @id @default(uuid())
  givebutterContactId String? @map("givebutter_contact_id")
  firstName        String?  @map("first_name")
  lastName         String?  @map("last_name")
  email            String?
  phone            String?
  organizationName String?  @map("organization_name")
  syncedAt         DateTime @default(now()) @map("synced_at")

  gifts    DonorGift[]
  pipeline DonorPipeline[]

  @@map("donor_contacts")
}

model DonorGift {
  id               String   @id @default(uuid())
  donorContactId   String?  @map("donor_contact_id")
  givebutterTxId   String?  @map("givebutter_tx_id")
  amount           Float
  giftDate         String   @map("gift_date")
  campaignName     String?  @map("campaign_name")
  fund             String?
  isRecurring      Boolean  @default(false) @map("is_recurring")
  syncedAt         DateTime @default(now()) @map("synced_at")

  donorContact DonorContact? @relation(fields: [donorContactId], references: [id])

  @@map("donor_gifts")
}

model DonorPipeline {
  id             String   @id @default(uuid())
  donorContactId String?  @map("donor_contact_id")
  stage          String?
  askAmount      Float?   @map("ask_amount")
  likelihood     String?
  notes          String?
  syncedAt       DateTime @default(now()) @map("synced_at")

  donorContact DonorContact? @relation(fields: [donorContactId], references: [id])

  @@map("donor_pipeline")
}

model DonorGrant {
  id           String   @id @default(uuid())
  funder       String
  amount       Float?
  status       String?
  deadline     String?
  awardDate    String?  @map("award_date")
  fund         String?
  notes        String?
  syncedAt     DateTime @default(now()) @map("synced_at")

  @@map("donor_grants")
}

model DocumentChunk {
  id         String                  @id @default(uuid())
  source     String
  sourceId   String                  @map("source_id")
  title      String?
  content    String
  embedding  Unsupported("vector(1536)")?
  metadata   Json?
  syncedAt   DateTime                @default(now()) @map("synced_at")

  @@index([source, sourceId])
  @@map("document_chunks")
}

model UsageLog {
  id         String   @id @default(uuid())
  toolName   String   @map("tool_name")
  inputJson  Json?    @map("input_json")
  outputJson Json?    @map("output_json")
  durationMs Int?     @map("duration_ms")
  error      String?
  calledAt   DateTime @default(now()) @map("called_at")

  @@map("usage_logs")
}
```

---

## 3. Create `packages/db/src/index.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;

export { PrismaClient } from '@prisma/client';
export type { Prisma } from '@prisma/client';
```

---

## 4. Run the migration

```bash
cd "/Users/christian/Documents/Claude/Projects/LP Internal AI V1"
pnpm install
pnpm --filter @lp-ai/lib-db migrate:dev -- --name init
```

This creates the tables in RDS and generates the Prisma client.

---

## 5. Verify with Prisma Studio

```bash
pnpm db:studio
```

Opens at `http://localhost:5555`. Confirm all tables are visible.

---

## Verification checklist

- [ ] `pnpm db:migrate:dev` completes without errors
- [ ] All 17 tables visible in Prisma Studio
- [ ] `document_chunks` table has an `embedding` column of type `vector(1536)`
- [ ] `pnpm --filter @lp-ai/lib-db build` produces `dist/` without type errors

---

## Known pitfalls

- **`vector` extension not found`** — ensure Phase 2 ran `CREATE EXTENSION IF NOT EXISTS vector` before migrating
- **`Unsupported type`** — pgvector requires the `postgresqlExtensions` preview feature in `schema.prisma`; verify the generator block includes it
- **Connection refused** — check `DATABASE_URL` in `.env` and that RDS security group allows your IP

---

**Next:** [05-google-connectors.md](05-google-connectors.md)
