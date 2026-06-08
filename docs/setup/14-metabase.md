# Phase 14 — Metabase BI Dashboards (Self-Hosted)

**Goal:** Deploy Metabase on AWS ECS Fargate, connect it to a read-only Postgres user, and build the first three dashboards: enrollment by phase, attendance trend, and donor pipeline.

**Prerequisites:**
- Phase 4 complete — all tables in RDS with real data
- Phase 5 complete — Sheets sync has run at least once

---

## 1. Create a read-only Metabase DB user

```bash
psql "postgresql://lpadmin:<password>@<DB_HOST>:5432/lpinternal"
```

```sql
CREATE ROLE metabase WITH LOGIN PASSWORD '<generate-password>';
GRANT CONNECT ON DATABASE lpinternal TO metabase;
GRANT USAGE ON SCHEMA public TO metabase;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO metabase;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO metabase;
\q
```

Store the credentials:
```bash
aws secretsmanager create-secret \
  --name lp-internal/metabase \
  --secret-string '{
    "MB_DB_TYPE": "postgres",
    "MB_DB_HOST": "<rds-host>",
    "MB_DB_PORT": "5432",
    "MB_DB_DBNAME": "metabase",
    "MB_DB_USER": "metabaseapp",
    "MB_DB_PASS": "<generate-password>",
    "MB_READ_ONLY_USER": "metabase",
    "MB_READ_ONLY_PASS": "<password-from-above>"
  }'
```

Create a Metabase application database (separate from the data it reads):
```sql
CREATE DATABASE metabase;
CREATE ROLE metabaseapp WITH LOGIN PASSWORD '<generate-password>';
GRANT ALL PRIVILEGES ON DATABASE metabase TO metabaseapp;
```

---

## 2. Deploy Metabase on ECS Fargate

Follow the same task-definition + service pattern from Phase 9, using `metabase/metabase:latest` as the container image, port 3000, and the `lp-ecs-task-role` for runtime access to Secrets Manager. Set the following runtime environment variables (pulled from `lp-internal/metabase` via the task definition's `secrets` block):

```
MB_DB_TYPE=postgres
MB_DB_HOST=<rds-host>
MB_DB_PORT=5432
MB_DB_DBNAME=metabase
MB_DB_USER=metabaseapp
MB_DB_PASS=<password>
```

Recommended task size: **1 vCPU / 2 GB RAM** — Metabase requires at least this to start reliably.

Add an ALB listener rule that routes `metabase.launchpadphilly.org` to this service's target group.

---

## 3. Initial Metabase setup

1. Open the Metabase URL in a browser
2. Create an admin account
3. **Admin → Databases → Add database**:
   - Type: PostgreSQL
   - Host: `<rds-host>`
   - Port: 5432
   - Database name: `lpinternal`
   - Username: `metabase` (read-only)
   - Password: `<read-only password>`
   - **SSL: Required**
4. Click **Save** — Metabase will scan the schema

---

## 4. Build the starter dashboards

### Dashboard 1: Enrollment Overview

Questions to add:
- **Current enrollment by phase** — `SELECT current_phase, COUNT(*) FROM students WHERE enrollment_status = 'active' GROUP BY current_phase`
- **Enrollment trend (monthly)** — from `enrollment_snapshots`, group by `snapshot_date` + `phase`
- **Retention rate** — students who completed phase / students who started

### Dashboard 2: Attendance Trends

Questions to add:
- **Average attendance by cohort** — `SELECT cohort, AVG(percentage) FROM attendance_records GROUP BY cohort`
- **Weekly attendance trend** — group `attendance_records` by `week_of`
- **Students below 80% attendance** — filter `percentage < 0.8`, list names

### Dashboard 3: Donor Pipeline

Questions to add:
- **Total giving YTD** — `SELECT SUM(amount) FROM donor_gifts WHERE gift_date >= date_trunc('year', now())`
- **Gifts by campaign** — group `donor_gifts` by `campaign_name`
- **Pipeline by stage** — group `donor_pipeline` by `stage`, sum `ask_amount`

---

## 5. Set up scheduled email reports

In Metabase:
1. Open any dashboard
2. **Subscriptions → Email** → add `christian@launchpadphilly.org`
3. Schedule: **Weekly, Monday 8am**

---

## Verification checklist

- [ ] Metabase accessible at its ALB-fronted URL
- [ ] Admin account created
- [ ] `lpinternal` database connected (read-only user)
- [ ] All 17 tables visible in the schema browser
- [ ] Enrollment Overview dashboard shows real data
- [ ] Attendance Trends dashboard shows real data
- [ ] Donor Pipeline dashboard shows real data
- [ ] Weekly email subscription configured

---

## Known pitfalls

- **Metabase first startup is slow** — allow 3–5 minutes for initial load on first boot
- **SSL required** — RDS requires SSL. In Metabase, enable "Use a secure connection (SSL)" in the database settings
- **Read-only user can't see new tables** — after adding tables to the schema, re-run `GRANT SELECT ON ALL TABLES IN SCHEMA public TO metabase`

---

**Next:** [15-airbyte.md](15-airbyte.md)
