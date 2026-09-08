# Phase 21 — Athena over S3 (Analytics Warehouse)

**Goal:** Set up S3 + Glue + Athena as the analytics warehouse layer, connect Metabase to it, and create the first cross-source analytics view combining Postgres and raw S3 data.

**Prerequisites:**
- Phase 1 complete — AWS CLI configured
- Phase 14 complete — Metabase running
- Phase 4 complete — Postgres tables populated with real data

---

## 1. Create the S3 bucket

```bash
aws s3 mb s3://lp-internal-analytics --region us-east-1

# Block all public access
aws s3api put-public-access-block \
  --bucket lp-internal-analytics \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket lp-internal-analytics \
  --versioning-configuration Status=Enabled

# Create folder structure
aws s3api put-object --bucket lp-internal-analytics --key raw/
aws s3api put-object --bucket lp-internal-analytics --key exports/postgres/
aws s3api put-object --bucket lp-internal-analytics --key athena-results/
```

---

## 2. Create the Glue catalog database

```bash
aws glue create-database \
  --database-input '{
    "Name": "lp_internal_analytics",
    "Description": "LP Internal AI analytics warehouse"
  }'
```

---

## 3. Set up Athena workgroup

```bash
aws athena create-work-group \
  --name lp-internal \
  --configuration '{
    "ResultConfiguration": {
      "OutputLocation": "s3://lp-internal-analytics/athena-results/"
    },
    "EnforceWorkGroupConfiguration": true,
    "PublishCloudWatchMetricsEnabled": true,
    "BytesScannedCutoffPerQuery": 1073741824
  }' \
  --description "LP Internal AI analytics queries"
```

> The `BytesScannedCutoffPerQuery` limit (1 GB) prevents runaway query costs.

---

## 4. Export Postgres tables to S3 for Athena

Athena reads from S3, not directly from Postgres. Set up a nightly export job that dumps key tables to S3 as Parquet files.

Create a Lambda (or an ECS-scheduled task) for the export:

```typescript
import { prisma } from '@lp-ai/lib-db';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-1' });

export async function exportStudentsToS3(): Promise<void> {
  const students = await prisma.student.findMany({
    include: {
      phaseOutcomes: true,
      enrollmentSnaps: true,
      competencies: true,
    },
  });

  const date = new Date().toISOString().split('T')[0];
  await s3.send(new PutObjectCommand({
    Bucket: 'lp-internal-analytics',
    Key: `exports/postgres/students/${date}.json`,
    Body: JSON.stringify(students),
    ContentType: 'application/json',
  }));

  console.warn(`Exported ${students.length} students to S3`);
}
```

Add an EventBridge rule for nightly export at 2am UTC:
```bash
aws events put-rule \
  --name lp-export-to-s3 \
  --schedule-expression "cron(0 2 * * ? *)" \
  --state ENABLED
```

---

## 5. Register Glue tables for Athena

After the first export runs, register the S3 paths as Glue catalog tables so Athena can query them:

```bash
aws glue create-table \
  --database-name lp_internal_analytics \
  --table-input '{
    "Name": "students",
    "StorageDescriptor": {
      "Location": "s3://lp-internal-analytics/exports/postgres/students/",
      "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
      "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
      "SerdeInfo": {
        "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe"
      },
      "Columns": [
        {"Name": "id", "Type": "string"},
        {"Name": "canonical_name", "Type": "string"},
        {"Name": "current_phase", "Type": "string"},
        {"Name": "enrollment_status", "Type": "string"},
        {"Name": "cohort", "Type": "string"}
      ]
    }
  }'
```

---

## 6. Connect Metabase to Athena

1. In Metabase: **Admin → Databases → Add database**
2. Type: **Amazon Athena**
3. Configure:
   - Region: `us-east-1`
   - S3 staging directory: `s3://lp-internal-analytics/athena-results/`
   - Workgroup: `lp-internal`
   - AWS access key / secret: use a dedicated IAM user with Athena + S3 + Glue read permissions
4. Save and sync

---

## 7. Create the first cross-source analytics question

In Metabase, create a native Athena query:

```sql
SELECT
  s.current_phase,
  COUNT(*) as student_count,
  AVG(CAST(a.percentage AS double)) as avg_attendance
FROM lp_internal_analytics.students s
JOIN lp_internal_analytics.attendance_records a
  ON s.id = a.student_id
WHERE s.enrollment_status = 'active'
GROUP BY s.current_phase
ORDER BY student_count DESC
```

Add this to the Enrollment Overview dashboard.

---

## Verification checklist

- [ ] S3 bucket `lp-internal-analytics` created with public access blocked
- [ ] Glue database `lp_internal_analytics` created
- [ ] Athena workgroup `lp-internal` created with query result location set
- [ ] At least one nightly export has run and JSON files appear in S3
- [ ] Glue tables registered for exported tables
- [ ] Metabase Athena connection test passes
- [ ] At least one cross-source Athena query runs successfully in Metabase

---

## Known pitfalls

- **Athena can't query Postgres directly** — it reads only from S3/Glue. The nightly export is required.
- **JSON SerDe vs Parquet** — JSON is simpler to start but Parquet is faster and cheaper at scale. Migrate to Parquet when query performance becomes a concern.
- **Glue crawler as alternative** — instead of manually registering tables, you can use a Glue Crawler to auto-discover schema from S3. Useful once you have many tables.
- **Query cost** — Athena charges $5/TB scanned. Partition your S3 data by date to minimize scan cost on time-range queries.

---

## This completes the V1 setup.

Return to [README.md](README.md) and mark all phases complete. Next steps:
- Run through `docs/runbooks/` and create runbooks for the top 3 failure scenarios
- Schedule the quarterly stack review (next: August 2026)
- Begin onboarding the second Launchpad team member to the system using these docs
