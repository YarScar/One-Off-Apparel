# Phase 9 — ECS (Fargate) Deployment Behind an ALB

**Goal:** Deploy the HQ dashboard and both MCP servers as containerized Fargate tasks in an ECS cluster, fronted by an Application Load Balancer with TLS terminated at an ACM certificate. Secrets are wired in from Secrets Manager via the task definition.

> **Why not App Runner?** App Runner was deprecated for new services in April 2026. ECS on Fargate is the documented replacement path and is what `mcp-setup-instructions.md` already targets.

**Prerequisites:**
- Phase 1 complete — ECR repositories created, `lp-ecs-task-role` and `lp-ecs-execution-role` exist
- Phase 8 complete — HQ dashboard builds and passes health check locally
- Phase 7 complete — MCP server builds and passes health check locally
- Docker installed locally (`docker --version`), Node 22 + pnpm 10 on the build host
- A registered domain or subdomain you control DNS for (e.g. `hq.launchpadphilly.org`)

---

## 1. Confirm Dockerfiles are current

The repo already ships production Dockerfiles for all three apps:

- `apps/hq/Dockerfile` — Next.js standalone output, Node 22, healthcheck on `:3000/api/health`
- `apps/mcp-server/Dockerfile` — Node 22, healthcheck on `:8080/health`
- `apps/aws-mcp-server/Dockerfile` — Node 22, healthcheck on `:8081/health`

Build and run them once against the local Docker Postgres to confirm — see [docs/runbooks/local-dev.md](../runbooks/local-dev.md) for the exact commands.

---

## 2. Build and push images to ECR

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1

# Authenticate Docker with ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# HQ dashboard
docker build --platform linux/amd64 -f apps/hq/Dockerfile -t lp-internal/hq .
docker tag lp-internal/hq \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lp-internal/hq:latest
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lp-internal/hq:latest

# MCP server
docker build --platform linux/amd64 -f apps/mcp-server/Dockerfile -t lp-internal/mcp-server .
docker tag lp-internal/mcp-server \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lp-internal/mcp-server:latest
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lp-internal/mcp-server:latest

# AWS MCP server (governance/Terraform job server)
docker build --platform linux/amd64 -f apps/aws-mcp-server/Dockerfile -t lp-internal/aws-mcp-server .
docker tag lp-internal/aws-mcp-server \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lp-internal/aws-mcp-server:latest
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lp-internal/aws-mcp-server:latest
```

> `--platform linux/amd64` is required if you're building on an Apple Silicon Mac. Fargate runs on amd64; the explicit flag avoids cross-arch surprises.

---

## 3. Create the ECS cluster + log groups

```bash
aws ecs create-cluster \
  --cluster-name lp-internal \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1

# CloudWatch log groups (one per task definition)
aws logs create-log-group --log-group-name /ecs/lp-internal-hq
aws logs create-log-group --log-group-name /ecs/lp-internal-mcp-server
aws logs create-log-group --log-group-name /ecs/lp-internal-aws-mcp-server

# Retention (cost control — default is "never expire")
aws logs put-retention-policy --log-group-name /ecs/lp-internal-hq --retention-in-days 30
aws logs put-retention-policy --log-group-name /ecs/lp-internal-mcp-server --retention-in-days 30
aws logs put-retention-policy --log-group-name /ecs/lp-internal-aws-mcp-server --retention-in-days 30
```

---

## 4. Register task definitions

Each task definition specifies the image, CPU/memory, the IAM role the container runs as, the execution role ECS uses to pull the image and fetch secrets, and which Secrets Manager keys to inject as environment variables.

Substitute `${AWS_ACCOUNT_ID}` before applying.

**`infra/ecs/hq-taskdef.json`** (write this file once; reuse with `register-task-definition --cli-input-json`):

```json
{
  "family": "lp-internal-hq",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/lp-ecs-execution-role",
  "taskRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/lp-ecs-task-role",
  "containerDefinitions": [{
    "name": "hq",
    "image": "${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/lp-internal/hq:latest",
    "essential": true,
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "USE_AWS_SECRETS", "value": "true" },
      { "name": "AWS_REGION", "value": "us-east-1" },
      { "name": "AUTH_TRUST_HOST", "value": "true" }
    ],
    "secrets": [
      { "name": "DATABASE_URL",       "valueFrom": "arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:lp-internal/db:DATABASE_URL::" },
      { "name": "AUTH_SECRET",        "valueFrom": "arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:lp-internal/nextauth:AUTH_SECRET::" },
      { "name": "AUTH_GOOGLE_ID",     "valueFrom": "arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:lp-internal/nextauth:AUTH_GOOGLE_ID::" },
      { "name": "AUTH_GOOGLE_SECRET", "valueFrom": "arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:lp-internal/nextauth:AUTH_GOOGLE_SECRET::" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/lp-internal-hq",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "ecs"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60
    }
  }]
}
```

> The `valueFrom` ARN format is `<secret-arn>:<json-key>::` — the trailing `::` is required and the json-key selects one field out of the JSON secret. This means each Secrets Manager value gets injected as a separate env var without the app having to parse JSON.

Register it:

```bash
envsubst < infra/ecs/hq-taskdef.json > /tmp/hq-taskdef.json
aws ecs register-task-definition --cli-input-json file:///tmp/hq-taskdef.json
```

Repeat for `infra/ecs/mcp-server-taskdef.json` (port 8080, log group `/ecs/lp-internal-mcp-server`, secrets: `DATABASE_URL`, `OPENAI_API_KEY`, `SYNC_SECRET`) and `infra/ecs/aws-mcp-server-taskdef.json` (port 8081, log group `/ecs/lp-internal-aws-mcp-server`, secrets: `DATABASE_URL`, `SYNC_SECRET`).

---

## 5. Provision the load balancer

```bash
# Reuse the default VPC + subnets, or your platform-team VPC if applicable
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
SUBNET_IDS=($(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query "Subnets[*].SubnetId" --output text))

# Security group for the ALB — open 443 to the world, 80 redirects to 443
ALB_SG=$(aws ec2 create-security-group --group-name lp-alb-sg --description "ALB for LP Internal" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 80  --cidr 0.0.0.0/0

# Security group for the ECS tasks — allow inbound only from the ALB SG
TASK_SG=$(aws ec2 create-security-group --group-name lp-ecs-task-sg --description "ECS tasks for LP Internal" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 3000 --source-group $ALB_SG
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 8080 --source-group $ALB_SG
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 8081 --source-group $ALB_SG

# Create the ALB
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name lp-internal-alb \
  --subnets ${SUBNET_IDS[@]} \
  --security-groups $ALB_SG \
  --scheme internet-facing \
  --type application \
  --query "LoadBalancers[0].LoadBalancerArn" --output text)

# Target groups (one per app, all over HTTP — ALB terminates TLS)
HQ_TG=$(aws elbv2 create-target-group \
  --name lp-hq-tg --protocol HTTP --port 3000 --target-type ip --vpc-id $VPC_ID \
  --health-check-path /api/health --health-check-interval-seconds 30 --healthy-threshold-count 2 \
  --query "TargetGroups[0].TargetGroupArn" --output text)

MCP_TG=$(aws elbv2 create-target-group \
  --name lp-mcp-tg --protocol HTTP --port 8080 --target-type ip --vpc-id $VPC_ID \
  --health-check-path /health \
  --query "TargetGroups[0].TargetGroupArn" --output text)

AWSMCP_TG=$(aws elbv2 create-target-group \
  --name lp-awsmcp-tg --protocol HTTP --port 8081 --target-type ip --vpc-id $VPC_ID \
  --health-check-path /health \
  --query "TargetGroups[0].TargetGroupArn" --output text)
```

---

## 6. Request an ACM certificate and add HTTPS listeners

```bash
# Replace with your domain(s)
CERT_ARN=$(aws acm request-certificate \
  --domain-name hq.launchpadphilly.org \
  --subject-alternative-names mcp.launchpadphilly.org aws-mcp.launchpadphilly.org \
  --validation-method DNS \
  --query CertificateArn --output text)

aws acm describe-certificate --certificate-arn $CERT_ARN \
  --query "Certificate.DomainValidationOptions[*].ResourceRecord" \
  --output table
```

Copy the `Name`/`Value` records into your DNS provider (Route 53 or external). Wait until the certificate status flips to `ISSUED`:

```bash
aws acm wait certificate-validated --certificate-arn $CERT_ARN
```

Create listeners — HTTP redirects to HTTPS; HTTPS routes by host header.

```bash
# Port 80: redirect everything to 443
aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions '[{"Type":"redirect","RedirectConfig":{"Protocol":"HTTPS","Port":"443","StatusCode":"HTTP_301"}}]'

# Port 443: default to HQ
HTTPS_LISTENER=$(aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTPS --port 443 \
  --certificates CertificateArn=$CERT_ARN \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --default-actions Type=forward,TargetGroupArn=$HQ_TG \
  --query "Listeners[0].ListenerArn" --output text)

# Host-based rules for the two MCP servers
aws elbv2 create-rule --listener-arn $HTTPS_LISTENER --priority 10 \
  --conditions Field=host-header,Values=mcp.launchpadphilly.org \
  --actions Type=forward,TargetGroupArn=$MCP_TG

aws elbv2 create-rule --listener-arn $HTTPS_LISTENER --priority 20 \
  --conditions Field=host-header,Values=aws-mcp.launchpadphilly.org \
  --actions Type=forward,TargetGroupArn=$AWSMCP_TG
```

---

## 7. Create the ECS services

```bash
PRIVATE_SUBNETS=$(echo ${SUBNET_IDS[@]} | tr ' ' ',')

aws ecs create-service \
  --cluster lp-internal \
  --service-name lp-internal-hq \
  --task-definition lp-internal-hq \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$HQ_TG,containerName=hq,containerPort=3000" \
  --health-check-grace-period-seconds 60

aws ecs create-service \
  --cluster lp-internal \
  --service-name lp-internal-mcp-server \
  --task-definition lp-internal-mcp-server \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$MCP_TG,containerName=mcp-server,containerPort=8080" \
  --health-check-grace-period-seconds 60

aws ecs create-service \
  --cluster lp-internal \
  --service-name lp-internal-aws-mcp-server \
  --task-definition lp-internal-aws-mcp-server \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$AWSMCP_TG,containerName=aws-mcp-server,containerPort=8081" \
  --health-check-grace-period-seconds 60
```

> `assignPublicIp=ENABLED` is required for Fargate tasks in **public** subnets to pull images from ECR. For production, prefer private subnets with a NAT gateway and a VPC endpoint for ECR — see §10.

Wait for each service to stabilize:

```bash
aws ecs wait services-stable --cluster lp-internal --services lp-internal-hq lp-internal-mcp-server lp-internal-aws-mcp-server
```

---

## 8. Allow ECS tasks to reach RDS

The RDS security group from Phase 2 currently only permits ingress from your laptop IP. Add the ECS task security group:

```bash
RDS_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=lp-rds-sg" --query "SecurityGroups[0].GroupId" --output text)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG --protocol tcp --port 5432 --source-group $TASK_SG
```

Then remove the public `0.0.0.0/0` rule from Phase 2:

```bash
aws ec2 revoke-security-group-ingress --group-id $RDS_SG --protocol tcp --port 5432 --cidr 0.0.0.0/0
aws rds modify-db-instance --db-instance-identifier lp-internal-db --no-publicly-accessible --apply-immediately
```

---

## 9. Point DNS at the ALB

Get the ALB hostname:

```bash
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --query "LoadBalancers[0].DNSName" --output text)
echo $ALB_DNS
```

In your DNS provider, create CNAME (or Route 53 alias) records:

| Hostname | Type | Target |
|---|---|---|
| `hq.launchpadphilly.org` | CNAME / A-alias | `$ALB_DNS` |
| `mcp.launchpadphilly.org` | CNAME / A-alias | `$ALB_DNS` |
| `aws-mcp.launchpadphilly.org` | CNAME / A-alias | `$ALB_DNS` |

If you use Route 53, prefer A-alias records — they're free and resolve faster than CNAME chains.

---

## 10. (Optional) Move tasks into private subnets

For production hardening, swap `assignPublicIp=ENABLED` in the service definitions to `DISABLED` and run tasks in private subnets that have a NAT gateway. Add a VPC endpoint for ECR (`com.amazonaws.us-east-1.ecr.api` and `com.amazonaws.us-east-1.ecr.dkr`) to avoid paying NAT egress for image pulls. Same for Secrets Manager (`com.amazonaws.us-east-1.secretsmanager`).

---

## Verification checklist

- [ ] All three images pushed to ECR (`aws ecr list-images --repository-name lp-internal/hq` shows `latest`)
- [ ] All three ECS services show `runningCount: 1, desiredCount: 1` and `deploymentStatus: PRIMARY` steady
- [ ] `curl https://hq.launchpadphilly.org/api/health` returns `{ "status": "ok" }`
- [ ] `curl https://mcp.launchpadphilly.org/health` returns `{ "status": "ok" }`
- [ ] `curl https://aws-mcp.launchpadphilly.org/health` returns `{ "status": "ok" }`
- [ ] `curl -X POST https://mcp.launchpadphilly.org/mcp` returns `401 unauthorized` (no token)
- [ ] `curl -X POST https://mcp.launchpadphilly.org/mcp -H "Authorization: Bearer $SYNC_SECRET" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` returns the tool list
- [ ] Google sign-in works on `https://hq.launchpadphilly.org` with a `@launchpadphilly.org` account
- [ ] RDS public access disabled; ECS tasks connect via `lp-ecs-task-sg`

---

## Updating an image (deploy a new version)

```bash
# 1. Rebuild + push (Step 2)
# 2. Force a new deployment — same task def, but ECS will pull the latest tag
aws ecs update-service \
  --cluster lp-internal \
  --service lp-internal-hq \
  --force-new-deployment
```

For a real release flow, tag images with the git SHA (`:$(git rev-parse --short HEAD)`) and register a new task-definition revision pointing at the new tag — that gives you a clean rollback target.

---

## Known pitfalls

- **`ResourceInitializationError: unable to pull secrets`** — the **execution role** (not the task role) needs `secretsmanager:GetSecretValue` and `kms:Decrypt` on every secret you list in `secrets[]`. See `docs/runbooks/aws-permissions.md` §4.2.
- **`CannotPullContainerError`** — Fargate task can't reach ECR. Either the subnet has no route to the internet, or ECR endpoints aren't reachable. Tasks in public subnets need `assignPublicIp=ENABLED`; private subnets need a NAT gateway or the ECR VPC endpoint.
- **ALB health checks fail with 502** — the task is running but the health endpoint isn't returning 200 in time. Increase the task's `startPeriod` (already 60s in the example) and the target group's `HealthCheckGracePeriodSeconds`.
- **TLS leaks bearer tokens on port 80** — the redirect from 80→443 must be present *before* any traffic flows. Don't leave a plain HTTP listener forwarding to a target group.
- **Apple Silicon image won't start on Fargate** — build with `--platform linux/amd64`. Symptom is `exec format error` in task logs ~10 seconds after each task starts.

---

**Next:** [10-eventbridge-cron.md](10-eventbridge-cron.md)
