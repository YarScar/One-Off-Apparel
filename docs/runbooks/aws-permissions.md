# AWS Account-Level Permissions for LP Internal AI V1

**Audience:** the AWS account admin (or anyone reviewing what we plan to do in the account) and the engineer who will run the setup guides.

**Scope:** every AWS service the V1 stack touches, what permissions are needed and why, and what to *grant once* vs. what becomes a *durable runtime role*.

---

## 1. The three permission boundaries

There are three distinct identities to authorize. Conflating them is the most common cause of overly permissive accounts.

| Boundary | Who/what holds it | Lifetime | Example |
|---|---|---|---|
| **Builder IAM user** | The human running setup (Christian) | Months — only during build/maintenance | Creates roles, RDS, ECS services |
| **Service roles** | Assumed by AWS services themselves | Permanent | RDS enhanced monitoring, EventBridge Scheduler |
| **Application runtime roles** | Assumed by ECS tasks at runtime | Permanent — actively used by running code | ECS execution role injecting secrets at container start, task role fetching secrets at runtime |

The current `docs/setup/01-aws-baseline.md` assumes the builder gets `AdministratorAccess`. That's fine for the initial buildout, but the **runtime** roles should be tight from day one — they are the credentials that actually live inside the running system and would matter if compromised.

---

## 2. Per-service permission map

### 2.1 IAM (foundation — required before any other phase)

**Why:** every phase creates roles, policies, and trust relationships.

**Builder grants:**
- `IAMFullAccess` (managed), or scoped policy with: `iam:CreateRole`, `iam:DeleteRole`, `iam:AttachRolePolicy`, `iam:DetachRolePolicy`, `iam:PassRole`, `iam:GetRole`, `iam:ListRoles`, `iam:CreatePolicy`, `iam:CreateServiceLinkedRole` on `lp-*` and `rds-monitoring-role`.

**Service-linked roles** (AWS auto-creates these on first use of the service): `AWSServiceRoleForRDS`, `AWSServiceRoleForECS`, `AWSServiceRoleForElasticLoadBalancing`, `AWSServiceRoleForAmazonEventBridge`.

**One-time admin actions:** enable MFA on the builder user; reset the temporary console password.

### 2.2 STS

Trivial but required: `sts:GetCallerIdentity`. Included in nearly every managed policy.

### 2.3 RDS — Postgres with pgvector (Phase 2)

**Why:** production database. Replaces the local Docker Postgres.

**Builder grants:**
- `AmazonRDSFullAccess` (managed) — `rds:CreateDBInstance`, `rds:ModifyDBInstance`, `rds:CreateDBParameterGroup` (needed to enable `pgvector` and `pg_trgm`), `rds:CreateDBSubnetGroup`, snapshots.
- `AmazonVPCFullAccess` (managed) — to create the VPC, subnets, and security groups RDS lives in. Read-only if the admin pre-provisions the VPC.
- KMS: use the AWS-managed `aws/rds` key for storage encryption to avoid needing KMS write perms.

**Service role:** `rds-monitoring-role` — trusts `monitoring.rds.amazonaws.com`, attaches `AmazonRDSEnhancedMonitoringRole` (managed). Required for Performance Insights.

### 2.4 Secrets Manager (Phase 3)

**Why:** production secrets for `DATABASE_URL`, all connector API keys (Aplos, Slack, OpenAI, Anthropic), NextAuth secrets, Sentry DSN. `@lp-ai/lib-config` already has the fetch path stubbed.

**Builder grants:** `SecretsManagerReadWrite` (managed) — create/update/tag/rotate.

**KMS:** use `aws/secretsmanager` (the AWS-managed key) to avoid managing a customer-managed key.

**Runtime grant:** `secretsmanager:GetSecretValue` scoped by ARN to `arn:aws:secretsmanager:us-east-1:<account>:secret:lp-internal/*`. Both the ECS execution role (for `secrets[]` injection at container start) and the ECS task role (for `loadEnv()` calls at runtime) carry this scoped grant — never the broader managed `SecretsManagerReadWrite`. See §4 below for the scoped JSON.

### 2.5 ECR — container registry (Phases 1 + 9)

**Why:** the production Docker images (`lp-internal/hq`, `lp-internal/mcp-server`, `lp-internal/aws-mcp-server`) live here. The ECS execution role pulls from ECR at task-start; engineer or CI pushes.

**Builder grants:** `AmazonEC2ContainerRegistryFullAccess` (managed).

**CI grant** (when GitHub Actions gets push rights): a dedicated IAM user or an OIDC-federated role with `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload` scoped to the two repo ARNs.

**Runtime grant:** `AmazonEC2ContainerRegistryReadOnly` (already attached in Phase 1).

### 2.6 ECS Fargate + ALB (Phase 9)

**Why:** hosts the HQ Next.js app and both MCP servers (`apps/mcp-server/src/serve-http.ts`, `apps/aws-mcp-server/src/serve-http.ts`) as Fargate tasks behind an Application Load Balancer.

**Builder grants:**
- `AmazonECS_FullAccess` (managed) — `ecs:CreateCluster`, `ecs:RegisterTaskDefinition`, `ecs:CreateService`, `ecs:UpdateService`, `ecs:DescribeTasks`.
- `ElasticLoadBalancingFullAccess` (managed) — ALB + target groups + listeners.
- `AWSCertificateManagerFullAccess` (managed) — ACM cert for HTTPS termination.
- `iam:PassRole` scoped to `lp-ecs-task-role` and `lp-ecs-execution-role` — **commonly missed**. Without it `RegisterTaskDefinition` cannot hand the role to the task at start time.

**Service roles:**
- `lp-ecs-task-role` — the container's runtime identity. Trusts `ecs-tasks.amazonaws.com`. See §4.1 + §4.2.
- `lp-ecs-execution-role` — the ECS agent's identity for image pulls and secret injection. Trusts the same principal, attaches the managed `AmazonECSTaskExecutionRolePolicy` plus the scoped policy in §4.2b.

### 2.7 EventBridge — cron scheduling (Phase 10)

**Why:** schedules the connector syncs (`sync:sheets`, `sync:drive`, `sync:aplos`, `sync:slack`).

**Builder grants:** `AmazonEventBridgeFullAccess` (managed) — `events:PutRule`, `events:PutTargets`, `scheduler:CreateSchedule`.

**Service role:** `lp-eventbridge-invoke-role` trusts `scheduler.amazonaws.com`. The inline policy depends on the target: ECS task (most likely) vs. Lambda. See §4.3.

### 2.8 CloudWatch

**Why:** ECS, RDS, EventBridge, and ALB write logs and metrics here by default.

**Builder grants:** `CloudWatchLogsFullAccess` + `CloudWatchFullAccess` (managed).

**Runtime grant:** the task role needs `logs:CreateLogStream` and `logs:PutLogEvents` on the `/ecs/lp-internal-*` log groups (and any custom group like `/lp-internal/app`). The Fargate awslogs driver itself uses the execution role's CloudWatch logs perms granted by `AmazonECSTaskExecutionRolePolicy`.

### 2.9 S3 + Athena + Glue (Phase 21 — analytics warehouse)

**Why:** Athena queries Parquet files on S3 for cross-source visualization.

**Builder grants:**
- `AmazonS3FullAccess` (managed) — for `lp-internal-warehouse`, `lp-internal-athena-results`.
- `AmazonAthenaFullAccess` (managed) — workgroup creation, query execution.
- `AWSGlueConsoleFullAccess` (managed) — Athena uses the Glue Data Catalog.

**Runtime grant** (for whichever code writes to S3 — likely an ECS sync task): scoped `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on the warehouse bucket ARN. See §4.4.

### 2.10 Self-hosted services — n8n, Metabase, Airbyte (Phases 13–15)

These run in our account but aren't managed AWS services. Most likely target is ECS Fargate behind an Application Load Balancer.

**Builder grants (one-time):** `AmazonECS_FullAccess`, `ElasticLoadBalancingFullAccess`, `AmazonRoute53FullAccess`, `AWSCertificateManagerFullAccess` (managed).

If the admin prefers a single EC2 host instead of ECS, swap ECS for `AmazonEC2FullAccess`.

### 2.11 Explicitly not needed

To preempt the obvious questions, the V1 spec **does not** require:

- **Lambda** — ECS Fargate is the chosen compute. (Lambda is only an *option* for sync tasks in Phase 10; ECS RunTask is the default.)
- **Amazon Bedrock** — Claude is accessed via the Anthropic API directly, not Bedrock.
- **SageMaker / OpenSearch / Aurora** — pgvector on RDS replaces all of these.
- **Cognito** — NextAuth + Google handles auth.

---

## 3. The "ask the admin once" bundle

Paste-able request for the AWS account owner:

> Please attach the following AWS-managed policies to my IAM user `christian-kunkel` (or to an `lp-builders` group):
>
> - `IAMFullAccess`
> - `AmazonRDSFullAccess`
> - `AmazonVPCFullAccess`
> - `SecretsManagerReadWrite`
> - `AmazonEC2ContainerRegistryFullAccess`
> - `AmazonECS_FullAccess`
> - `ElasticLoadBalancingFullAccess`
> - `AWSCertificateManagerFullAccess`
> - `AmazonRoute53FullAccess`
> - `AmazonEventBridgeFullAccess`
> - `CloudWatchLogsFullAccess`
> - `AmazonS3FullAccess`
> - `AmazonAthenaFullAccess`
> - `AWSGlueConsoleFullAccess`
>
> Plus: enable MFA on the user, confirm a console password reset on first login, and confirm the account has no SCP that blocks `us-east-1`.

`AdministratorAccess` is the lazy substitute and is what the current Phase 1 guide assumes — acceptable for the initial buildout, but tighten to the list above before handing the keys to anyone else or wiring up CI.

---

## 4. Scoped JSON policies for runtime roles

These are the policies that **must** be tight from day one — they describe what the running system can do, not what a human is allowed to set up. All policies live in [`infra/iam/`](../../infra/iam/) and use `${AWS_ACCOUNT_ID}` as a placeholder that must be substituted before applying.

### 4.1 `lp-ecs-task-role` / `lp-ecs-execution-role` — trust policy

Both runtime roles trust the ECS task service principal, with an `aws:SourceAccount` confused-deputy guard.

[`infra/iam/lp-ecs-task-trust-policy.json`](../../infra/iam/lp-ecs-task-trust-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEcsTasksAssume",
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "${AWS_ACCOUNT_ID}" }
      }
    }
  ]
}
```

### 4.2 `lp-ecs-task-role` — task (runtime) policy

The runtime identity assumed by the container. Reads its own secrets at runtime (for `loadEnv()` calls), and writes application logs.

[`infra/iam/lp-ecs-task-policy.json`](../../infra/iam/lp-ecs-task-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadAppSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:lp-internal/*"
    },
    {
      "Sid": "DecryptSecretsViaSecretsManager",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.us-east-1.amazonaws.com"
        }
      }
    },
    {
      "Sid": "WriteApplicationLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": [
        "arn:aws:logs:us-east-1:${AWS_ACCOUNT_ID}:log-group:/ecs/lp-internal-hq:*",
        "arn:aws:logs:us-east-1:${AWS_ACCOUNT_ID}:log-group:/ecs/lp-internal-mcp-server:*",
        "arn:aws:logs:us-east-1:${AWS_ACCOUNT_ID}:log-group:/ecs/lp-internal-aws-mcp-server:*",
        "arn:aws:logs:us-east-1:${AWS_ACCOUNT_ID}:log-group:/lp-internal/app:*"
      ]
    }
  ]
}
```

### 4.2b `lp-ecs-execution-role` — execution policy (scoped Secrets Manager + KMS)

Attach this alongside the AWS-managed `AmazonECSTaskExecutionRolePolicy` (which already covers ECR pulls and CloudWatch logs for the awslogs driver). The scoped Secrets Manager grant lets the ECS agent fetch each secret listed in the task definition's `secrets` block at container-start time and inject them as environment variables.

[`infra/iam/lp-ecs-execution-policy.json`](../../infra/iam/lp-ecs-execution-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FetchSecretsForEnvInjection",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:lp-internal/*"
    },
    {
      "Sid": "DecryptSecretsViaSecretsManager",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.us-east-1.amazonaws.com"
        }
      }
    }
  ]
}
```

**Notes:**
- The execution role and task role have an identical Secrets Manager grant because they run at different lifecycle stages: the execution role fetches at container start (for `secrets[]` injection in the task definition), the task role fetches at runtime (for `loadEnv()` calls inside Node code). Splitting them keeps the blast radius diagram clean even though the policies look duplicate.
- The KMS statement uses the `kms:ViaService` condition so each role can decrypt *only* keys used by Secrets Manager — even if more KMS keys are added later, these policies don't grant decrypt on them.
- ECR pull permissions live in the AWS-managed `AmazonECSTaskExecutionRolePolicy` already attached to `lp-ecs-execution-role`; the scoped repo restriction can be re-added with an inline deny-by-default policy if AppSec demands it.

### 4.3 `lp-eventbridge-invoke-role` — trust policy

Trusts EventBridge Scheduler with an `aws:SourceAccount` confused-deputy guard.

[`infra/iam/lp-eventbridge-scheduler-trust-policy.json`](../../infra/iam/lp-eventbridge-scheduler-trust-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEventBridgeScheduler",
      "Effect": "Allow",
      "Principal": {
        "Service": "scheduler.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": "${AWS_ACCOUNT_ID}"
        }
      }
    }
  ]
}
```

### 4.3a `lp-eventbridge-invoke-role` — ECS target policy (default Phase 10 path)

Lets Scheduler run any task definition named `lp-sync-*` on the `lp-internal` cluster, and pass exactly the two task roles required.

[`infra/iam/lp-eventbridge-invoke-ecs-policy.json`](../../infra/iam/lp-eventbridge-invoke-ecs-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RunSyncTaskDefinitions",
      "Effect": "Allow",
      "Action": "ecs:RunTask",
      "Resource": "arn:aws:ecs:us-east-1:${AWS_ACCOUNT_ID}:task-definition/lp-sync-*:*",
      "Condition": {
        "ArnLike": {
          "ecs:cluster": "arn:aws:ecs:us-east-1:${AWS_ACCOUNT_ID}:cluster/lp-internal"
        }
      }
    },
    {
      "Sid": "PassSyncTaskRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/lp-sync-task-role",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/lp-sync-execution-role"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ecs-tasks.amazonaws.com"
        }
      }
    }
  ]
}
```

### 4.3b `lp-eventbridge-invoke-role` — Lambda target policy (alternative)

Use this **instead of** §4.3a if Phase 10 ends up using Lambda for sync invocations.

[`infra/iam/lp-eventbridge-invoke-lambda-policy.json`](../../infra/iam/lp-eventbridge-invoke-lambda-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeSyncLambdas",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:us-east-1:${AWS_ACCOUNT_ID}:function:lp-sync-*"
    }
  ]
}
```

### 4.4 `lp-sync-task-role` — the role the sync code itself runs as

This is what each connector sync process assumes when it runs. It reads connector credentials from Secrets Manager, writes logs, and (eventually) writes Parquet exports to the analytics warehouse bucket.

[`infra/iam/lp-sync-task-policy.json`](../../infra/iam/lp-sync-task-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadConnectorSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:lp-internal/*"
    },
    {
      "Sid": "DecryptSecretsViaSecretsManager",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.us-east-1.amazonaws.com"
        }
      }
    },
    {
      "Sid": "WriteSyncRunLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:us-east-1:${AWS_ACCOUNT_ID}:log-group:/lp-internal/sync/*"
    },
    {
      "Sid": "WriteWarehouseExports",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:AbortMultipartUpload",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::lp-internal-warehouse",
        "arn:aws:s3:::lp-internal-warehouse/*"
      ]
    }
  ]
}
```

---

## 5. How to apply these

Substitute `${AWS_ACCOUNT_ID}` (e.g. via `envsubst` or `sed`) before passing to the AWS CLI.

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Example: create the scoped ECS task policy and attach it
envsubst < infra/iam/lp-ecs-task-policy.json > /tmp/lp-ecs-task-policy.json

aws iam create-policy \
  --policy-name lp-ecs-task-policy \
  --policy-document file:///tmp/lp-ecs-task-policy.json

aws iam attach-role-policy \
  --role-name lp-ecs-task-role \
  --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-task-policy

# And the execution-role policy for secret injection at container start
envsubst < infra/iam/lp-ecs-execution-policy.json > /tmp/lp-ecs-execution-policy.json

aws iam create-policy \
  --policy-name lp-ecs-execution-policy \
  --policy-document file:///tmp/lp-ecs-execution-policy.json

aws iam attach-role-policy \
  --role-name lp-ecs-execution-role \
  --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/lp-ecs-execution-policy
```

The same pattern applies to the EventBridge and sync-task policies once Phases 9–10 are reached.

---

## 6. Audit checklist before going to production

- [ ] Builder IAM user has MFA enabled.
- [ ] `lp-ecs-task-role` and `lp-ecs-execution-role` use the scoped policies in §4.2 / §4.2b — no broad managed policies on either.
- [ ] Secrets in Secrets Manager are all prefixed `lp-internal/` so the ARN scoping works.
- [ ] `aws:SourceAccount` condition is present on every service trust policy that supports it.
- [ ] No IAM users or roles have `*:*` on `Resource: "*"` (other than ECR auth token and KMS-conditioned decrypt).
- [ ] CloudTrail is enabled in the account so role assumption is auditable.
- [ ] Sentry alerts cover IAM-related Node SDK errors (`AccessDeniedException`).
