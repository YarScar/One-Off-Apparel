# Copying the production database down to the local docker Postgres

Validated 2026-08-14. Before this was written, the copy procedure was re-derived from scratch each
time — and the previous attempt produced a **partial** copy (no student tables) that looked complete.
This runbook is the path that actually works, end to end.

## The topology, so the choices make sense

| Instance | Created | Public | Schema | Contents |
|---|---|---|---|---|
| `lp-internal-db` (prod) | 2026-06-09 | **no** — private IP only, SG allows only the ECS task group | **June-era**: 12 recorded migrations, latest `20260617000000` | everything: students, attendance, finance snapshots, usage logs |
| `lp-internal-mirror` | 2026-08-14 | yes | same June-era snapshot | same data as prod's snapshot, **minus nothing** — but it is a point-in-time copy, not live prod |
| local docker `lpinternal` | — | — | repo migrations (`migrate deploy`) | whatever you loaded into it |

Key facts learned the hard way:

- **Prod is unreachable from outside the VPC, permanently.** `PubliclyAccessible=false` means its
  endpoint resolves to a private `172.31.x.x` address with no route from a developer machine. A
  temporary security-group rule changes nothing — there is no public address to allow. Do not go
  down that path again.
- **The mirror is a snapshot restore, not a live replica.** It is stale by construction. It is
  also SG-locked to the home IP (`209.160.209.146/32`), so it is reachable only from the home
  network. Treat it as "prod as of the snapshot it was restored from", nothing more.
- **The repo's migration folder is not prod's migration history.** Prod's `_prisma_migrations`
  includes `20260610200000_create_student_postsecondary`, which is not in the repo; the repo has
  migrations prod has never run (`20260729`, `20260803`). Restoring the dump and then running
  `migrate deploy` is what reconciles the two — it applies exactly the repo migrations that are
  missing.
- **`pnpm test` wipes the database.** `apps/mcp-server/src/__tests__/tools.test.ts` calls
  `seed({ force: true })` in `beforeAll`, and the seed runs unfiltered `deleteMany()` across every
  student table. Run the suite against a throwaway copy, or re-restore afterwards. (Known, not yet
  fixed — see the seed's `force` path in `packages/db/src/seed.ts`.)

## The procedure (snapshot → temp instance → dump → delete)

Takes ~10 minutes; the temp instance exists for less than that and costs pennies. Needs the AWS
credentials from `.env` (`AWS_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1`).

```bash
# 0) One-time: load the AWS env (fish: `set -x` each key from .env, or source it)
set -x AWS_ACCESS_KEY_ID (grep -E '^AWS_ACCESS_KEY=' .env | head -1 | cut -d= -f2)
set -x AWS_SECRET_ACCESS_KEY (grep -E '^AWS_SECRET_ACCESS_KEY=' .env | head -1 | cut -d= -f2)
set -x AWS_DEFAULT_REGION (grep '^AWS_REGION=' .env | cut -d= -f2)

# 1) Find the freshest automated snapshot (daily, ~10:04 UTC, 7-day retention)
aws rds describe-db-snapshots --query \
  "DBSnapshots[?DBInstanceIdentifier=='lp-internal-db']|[0].DBSnapshotIdentifier" --output text

# 2) Restore it as a temporary PUBLIC instance (name it clearly; delete after)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier lp-internal-dev-copy \
  --db-snapshot-identifier rds:lp-internal-db-YYYY-MM-DD-HH-MM \
  --db-instance-class db.t4g.micro \
  --publicly-accessible \
  --db-subnet-group-name lp-internal-subnet-group
#    NOTE: --db-subnet-group-name default does NOT exist in this account; omitting it works.
#    Poll DBInstanceStatus until "available" (~5-10 min).

# 3) Open the instance's SG to this machine's egress IP for the few minutes of the dump.
#    Find the SG from describe-db-instances (VpcSecurityGroups[0]), then:
aws ec2 authorize-security-group-ingress --group-id <sg> --ip-permissions \
  "IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=<egress-ip>/32,Description='temp-dump-review'}]"
#    Your egress IP is what https://checkip.amazonaws.com returns.

# 4) Dump (uses the docker image's pg_dump; the host has no postgres client)
set -x PGPASSWORD (aws secretsmanager get-secret-value --secret-id lp-internal/db \
  --query SecretString --output text | jq -r '.DATABASE_URL' | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')
docker exec -e PGPASSWORD=$PGPASSWORD lp-internal-postgres pg_dump \
  -U lpapp -h <temp-endpoint> -Fc --no-owner --no-privileges -d lpinternal \
  -f /tmp/lp-prod-YYYYMMDD.dump
docker cp lp-internal-postgres:/tmp/lp-prod-YYYYMMDD.dump /tmp/opencode/

# 5) Delete the temp instance immediately (skip-final-snapshot is right here)
aws rds delete-db-instance --db-instance-identifier lp-internal-dev-copy --skip-final-snapshot
aws ec2 revoke-security-group-ingress --group-id <sg> --ip-permissions \
  "IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=<egress-ip>/32,Description='temp-dump-review'}]"
```

## Refresh the local database

```bash
docker cp /tmp/opencode/lp-prod-YYYYMMDD.dump lp-internal-postgres:/tmp/

# Full replace: drop schema, recreate the extensions the schema needs, restore.
docker exec lp-internal-postgres psql -U lpapp -d lpinternal -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; \
      CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
docker exec lp-internal-postgres pg_restore -U lpapp -d lpinternal \
  --no-owner --no-privileges --exit-on-error /tmp/lp-prod-YYYYMMDD.dump

# Reconcile the repo's migrations (prod's history differs from the repo's):
# applies exactly the pending repo migrations; their IF NOT EXISTS guards make
# re-running against prod's foreign schema harmless.
cd packages/db && pnpm exec prisma migrate deploy --config ../../prisma.config.ts
pnpm exec prisma migrate status --config ../../prisma.config.ts   # expect: up to date
```

Sanity numbers for a fresh copy (2026-08-14 snapshot): 301 students, 19,128 attendance records,
24,623 finance snapshots, 27 `tool_permissions` rows, 12 recorded migrations.

Back up the previous local state first if it matters (`pg_dump -Fc` to `/tmp/opencode/`); the
refresh is otherwise irreversible.
