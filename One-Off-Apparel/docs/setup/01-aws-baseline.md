# Phase 1 — AWS Account + IAM Baseline

**Goal:** Get your IAM user configured, CLI working locally, and base service roles created so every subsequent phase can run without touching the root account.

**Prerequisites:**
- AWS account exists for Launchpad (already done)
- Admin has created your IAM user with `AdministratorAccess` and provided:
  - Access key ID + secret access key
  - Temporary console password
  - 12-digit AWS account ID
- AWS CLI installed locally (`aws --version` — install via `brew install awscli` if missing)

---

## 1. First console login + secure root account

> Skip this section if the root account is already secured by your admin.

1. Log into the AWS Console at [console.aws.amazon.com](https://console.aws.amazon.com) with your IAM user credentials
2. Reset your temporary password when prompted
3. Enable MFA on your IAM user:
   - Top-right menu → **Security credentials** → **Assign MFA device**
   - Choose **Authenticator app** → scan QR code with Authenticator app (Google Authenticator, 1Password, etc.)
   - Enter two consecutive codes to verify

---

## 2. Configure the AWS CLI locally

```bash
aws configure --profile lp-internal
```

Enter when prompted:
```
AWS Access Key ID:     <your access key ID>
AWS Secret Access Key: <your secret access key>
Default region name:   us-east-1
Default output format: json
```

Verify it works:

```bash
aws sts get-caller-identity --profile lp-internal
```

Expected output:
```json
{
  "UserId": "AIDA...",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/christian-kunkel"
}
```

Set as default profile for this session (add to your shell profile to make it permanent):

```bash
export AWS_PROFILE=lp-internal
```

---

## 3. Note your account ID and region

```bash
aws sts get-caller-identity --query Account --output text
```

Save this — you'll need it throughout the setup. Set it as an env var:

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1
```

---

## 4. Create the ECS task + execution roles

ECS on Fargate splits responsibilities into two roles:

- **Execution role** (`lp-ecs-execution-role`) — used by the ECS agent to pull the image from ECR, fetch Secrets Manager values for injection, and write CloudWatch logs. The container itself never assumes this role.
- **Task role** (`lp-ecs-task-role`) — assumed by the running container; this is what application code uses when it calls AWS APIs at runtime.

Both trust the ECS task service principal.

```bash
# Trust policy (shared by both roles)
cat > /tmp/ecs-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "${AWS_ACCOUNT_ID}" }
      }
    }
  ]
}
EOF
envsubst < /tmp/ecs-trust.json > /tmp/ecs-trust-resolved.json

# Execution role
aws iam create-role \
  --role-name lp-ecs-execution-role \
  --assume-role-policy-document file:///tmp/ecs-trust-resolved.json

# Attach the AWS-managed execution policy (ECR pulls + CloudWatch logs)
aws iam attach-role-policy \
  --role-name lp-ecs-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Allow the execution role to fetch lp-internal/* secrets for env injection
# (See docs/runbooks/aws-permissions.md §4.2 for the scoped policy JSON)
envsubst < infra/iam/lp-ecs-execution-policy.json > /tmp/lp-ecs-execution-policy.json
aws iam create-policy \
  --policy-name lp-ecs-execution-policy \
  --policy-document file:///tmp/lp-ecs-execution-policy.json
aws iam attach-role-policy \
  --role-name lp-ecs-execution-role \
  --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-execution-policy

# Task role — runtime identity for the container
aws iam create-role \
  --role-name lp-ecs-task-role \
  --assume-role-policy-document file:///tmp/ecs-trust-resolved.json

envsubst < infra/iam/lp-ecs-task-policy.json > /tmp/lp-ecs-task-policy.json
aws iam create-policy \
  --policy-name lp-ecs-task-policy \
  --policy-document file:///tmp/lp-ecs-task-policy.json
aws iam attach-role-policy \
  --role-name lp-ecs-task-role \
  --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-task-policy
```

---

## 5. Create the RDS monitoring role

```bash
cat > /tmp/rds-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "monitoring.rds.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name rds-monitoring-role \
  --assume-role-policy-document file:///tmp/rds-trust.json

aws iam attach-role-policy \
  --role-name rds-monitoring-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole
```

---

## 6. Create ECR repositories for app images

```bash
aws ecr create-repository --repository-name lp-internal/hq --region us-east-1
aws ecr create-repository --repository-name lp-internal/mcp-server --region us-east-1
aws ecr create-repository --repository-name lp-internal/aws-mcp-server --region us-east-1
```

---

## Verification checklist

- [ ] `aws sts get-caller-identity` returns your user ARN
- [ ] MFA enabled on your IAM user
- [ ] `lp-ecs-execution-role` and `lp-ecs-task-role` visible in IAM → Roles
- [ ] `rds-monitoring-role` visible in IAM → Roles
- [ ] All three ECR repositories visible in ECR console

---

## Teardown

```bash
aws iam detach-role-policy --role-name lp-ecs-execution-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam detach-role-policy --role-name lp-ecs-execution-role --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-execution-policy
aws iam delete-role --role-name lp-ecs-execution-role
aws iam detach-role-policy --role-name lp-ecs-task-role --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-task-policy
aws iam delete-role --role-name lp-ecs-task-role
aws iam delete-policy --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-execution-policy
aws iam delete-policy --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-task-policy
aws iam detach-role-policy --role-name rds-monitoring-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole
aws iam delete-role --role-name rds-monitoring-role
aws ecr delete-repository --repository-name lp-internal/hq --force
aws ecr delete-repository --repository-name lp-internal/mcp-server --force
aws ecr delete-repository --repository-name lp-internal/aws-mcp-server --force
```

---

## Known pitfalls

- **"Unable to locate credentials"** — run `aws configure --profile lp-internal` again; check `~/.aws/credentials` exists
- **Role already exists** — safe to skip; check with `aws iam get-role --role-name lp-ecs-task-role`
- **Region mismatch** — all resources must be in the same region; double-check every command uses `us-east-1`

---

**Next:** [02-rds-postgres.md](02-rds-postgres.md)
