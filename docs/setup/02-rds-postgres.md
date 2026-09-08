# Phase 2 — AWS RDS Postgres + pgvector

**Goal:** Provision a managed Postgres 16 instance on RDS with the pgvector extension enabled, an app database, and a least-privilege app user.

**Prerequisites:**
- Phase 1 complete — AWS CLI configured, `AWS_PROFILE=lp-internal`
- `psql` installed locally (`brew install postgresql` if missing)

---

## 1. Create a VPC security group for RDS

```bash
# Get the default VPC ID
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" \
  --output text)

echo "VPC ID: $VPC_ID"

# Create a security group for RDS
SG_ID=$(aws ec2 create-security-group \
  --group-name lp-rds-sg \
  --description "LP Internal AI — RDS Postgres access" \
  --vpc-id $VPC_ID \
  --query "GroupId" \
  --output text)

echo "Security Group ID: $SG_ID"
```

Allow your local IP (for setup) and the ECS task security group (added later in Phase 9):

```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)

aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr ${MY_IP}/32
```

---

## 2. Create a DB subnet group

```bash
# Get subnet IDs from the default VPC
SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[*].SubnetId" \
  --output text | tr '\t' ',')

echo "Subnets: $SUBNET_IDS"

aws rds create-db-subnet-group \
  --db-subnet-group-name lp-internal-subnet-group \
  --db-subnet-group-description "LP Internal AI subnet group" \
  --subnet-ids $(echo $SUBNET_IDS | tr ',' ' ')
```

---

## 3. Create the RDS instance

> This takes 5–10 minutes to provision. The command returns immediately; use `aws rds describe-db-instances` to check status.

```bash
aws rds create-db-instance \
  --db-instance-identifier lp-internal-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version "16.3" \
  --master-username lpadmin \
  --master-user-password "$(openssl rand -base64 24 | tr -d '=/+')" \
  --allocated-storage 20 \
  --storage-type gp3 \
  --storage-encrypted \
  --db-name lpinternal \
  --vpc-security-group-ids $SG_ID \
  --db-subnet-group-name lp-internal-subnet-group \
  --backup-retention-period 7 \
  --no-multi-az \
  --no-publicly-accessible \
  --deletion-protection
```

> **Important:** Save the master password — it won't be shown again. Store it in 1Password or Secrets Manager immediately.

Wait for the instance to be available:

```bash
aws rds wait db-instance-available --db-instance-identifier lp-internal-db
echo "RDS is ready"
```

Get the endpoint:

```bash
DB_HOST=$(aws rds describe-db-instances \
  --db-instance-identifier lp-internal-db \
  --query "DBInstances[0].Endpoint.Address" \
  --output text)

echo "DB Host: $DB_HOST"
```

---

## 4. Enable public access temporarily for setup

The instance was created without public access. For initial setup from your local machine, temporarily enable it:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr 0.0.0.0/0

aws rds modify-db-instance \
  --db-instance-identifier lp-internal-db \
  --publicly-accessible \
  --apply-immediately

aws rds wait db-instance-available --db-instance-identifier lp-internal-db
```

> Remove public access after Phase 9 (ECS Fargate) is set up and can reach RDS through the VPC.

---

## 5. Connect and set up the database

```bash
psql "postgresql://lpadmin:<master-password>@${DB_HOST}:5432/lpinternal"
```

Once connected, run:

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- Create the app role (Prisma will use this)
CREATE ROLE lpapp WITH LOGIN PASSWORD '<generate-a-strong-password>';
GRANT CONNECT ON DATABASE lpinternal TO lpapp;
GRANT CREATE ON SCHEMA public TO lpapp;

-- Verify
\du

\q
```

> Store the `lpapp` password in Secrets Manager (Phase 3).

---

## 6. Build your DATABASE_URL

```
postgresql://lpapp:<lpapp-password>@<DB_HOST>:5432/lpinternal?sslmode=require
```

Add this to your `.env` file as `DATABASE_URL`.

---

## Verification checklist

- [ ] `aws rds describe-db-instances` shows `DBInstanceStatus: available`
- [ ] `psql` connects successfully with the master user
- [ ] `SELECT extname FROM pg_extension WHERE extname = 'vector';` returns one row
- [ ] `lpapp` role exists and can connect
- [ ] `DATABASE_URL` in `.env` connects successfully

---

## Teardown

```bash
aws rds delete-db-instance \
  --db-instance-identifier lp-internal-db \
  --skip-final-snapshot \
  --delete-automated-backups

aws rds delete-db-subnet-group --db-subnet-group-name lp-internal-subnet-group
aws ec2 delete-security-group --group-id $SG_ID
```

---

## Known pitfalls

- **"Password must contain..."** — RDS master password can't start with `/`, `@`, or `"`. Use the `openssl rand` command above.
- **Can't connect locally** — check that public access is enabled and your IP is in the security group. Run `curl https://checkip.amazonaws.com` again; your IP may have changed.
- **pgvector not available** — Postgres 16 on RDS supports pgvector natively. If `CREATE EXTENSION vector` fails, verify the engine version is 16.x.
- **db.t4g.micro not available in your region** — use `db.t3.micro` as fallback.

---

**Next:** [03-secrets-manager.md](03-secrets-manager.md)
