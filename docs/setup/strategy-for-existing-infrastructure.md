# Strategy for Deploying Into Existing Client Infrastructure

**Purpose:** This document captures the engagement model for delivering LP Internal AI V1 into a client environment where we (the implementer) are **not** the root or admin holder. The existing `docs/setup/` phase guides assume greenfield deployment with full administrative access; this document is the parallel track for the more common case: a small-to-medium client who already runs most of these systems and will only grant scoped, audited access.

The voice throughout is the **client CTO's** perspective on what they will and will not grant, what they expect from us, and how each phase of the existing setup guide changes when applied inside their org. Treat it as the negotiation position to design toward.

This is a living document. Next section to be added: **data access policies** (who can query what, PII handling, retention, audit).

---

## 0. Framing: what "no root" actually means

Three principles the client CTO operates by, which shape every section below:

1. **Everything that survives the engagement is IaC.** No hand-rolled console clicks. No one-shot `aws iam create-role` commands. If it exists in production, it exists in Terraform (or CDK) in a repo the client owns, applied by a pipeline. The artifact we hand over is a reviewable module, not a wiki page of CLI invocations.
2. **We assume the client's primitives; we don't bring our own.** Their VPC, their KMS keys, their Secrets Manager hierarchy, their logging account, their CI runners. If we need a primitive they don't have, we negotiate — but the answer is rarely "stand up our own."
3. **Vendor identities go through SSO.** No IAM users. Engineers federate in via the client's IdP into a permission set scoped to the workload account, MFA enforced by the IdP. Service identities are roles, never long-lived keys, with OIDC trust where the trust origin is verifiable (GitHub Actions OIDC, the client's CI).

---

## 1. AWS

### What the client already has

- An AWS Organization with at least four accounts: `mgmt` (root/billing), `security-audit` (CloudTrail + Config aggregator), `shared-services` (ECR, central DNS, transit gateway), and per-workload accounts (`dev`, `prod`).
- Service Control Policies that deny: root user actions, region use outside `us-east-1` / `us-east-2`, disabling CloudTrail/GuardDuty, IAM user creation in workload accounts, public S3 buckets.
- IAM Identity Center as the only human entry point. Permission sets are git-controlled.
- A platform Terraform repo that owns VPCs, transit gateway, baseline IAM roles, KMS keys, CMK rotation schedules.
- A FinOps tagging contract: every taggable resource has `CostCenter`, `Application`, `Environment`, `Owner`. Untagged resources get flagged in a weekly report.

### What the client will grant us

- **A dedicated workload account**, `lp-internal-prod` (and `-dev`). We operate inside it. We do **not** get anything in `mgmt` or `security-audit`.
- **One SSO permission set** mapped to our engineers — `LPInternalAppDeveloper`. It is `PowerUserAccess` *minus* IAM, *minus* Organizations, *minus* account-level CloudTrail/Config, scoped to the workload account only. Our engineers do exploratory work and console debugging through this, never via static keys.
- **A GitHub OIDC trust** so our CI in our repo can assume a deploy role in the workload account. The deploy role is the *only* identity that gets to mutate production resources, and its policy is tight — it can manage exactly the resources Terraform owns.
- **A pre-provisioned VPC** with public/private/database subnet tiers, NAT, route tables, baseline security groups, all tagged. We consume the VPC and subnet IDs as Terraform variables; we don't create networking.
- **A KMS CMK** (`alias/lp-internal`) with rotation enabled. We use this for RDS storage, Secrets Manager, and any S3 buckets. The policy already grants `kms:Decrypt` to the runtime roles we'll create.
- **A Secrets Manager prefix** `lp-internal/*` carved out for us. Our runtime roles read from it; our CI role can write to it; nothing else in the account can touch it.

### What the client wants from us

- The current `docs/runbooks/aws-permissions.md` is the right shape but conflates **build-time IAM** with **runtime IAM**. The client only cares about the runtime policies — build-time happens through Terraform PRs against the workload account's IaC repo, where the platform team reviews and merges. The "builder IAM user" section is stripped out of the handover; it's replaced by the Terraform module that defines all six runtime roles.
- The six JSON policies in `infra/iam/` are good. Two changes required before merge:
  - Replace the inline `kms:ViaService: secretsmanager.us-east-1.amazonaws.com` condition with a `kms:KeyArn` condition naming the client's CMK ARN. "Any key Secrets Manager uses" is broader than "the key the client gave us."
  - Add `aws:ResourceTag/Application: lp-internal` conditions to the S3 and CloudWatch Logs statements in `lp-sync-task-policy.json`. Tag-based scoping is how the client enforces blast radius across the whole account.
- An **egress inventory**: every external host our app talks to (OpenAI, Anthropic, GitHub raw, GiveButter, Aplos, Slack, Notion, Google APIs). If the list is short and stable, the client will consider VPC endpoints / PrivateLink where they exist (Secrets Manager, S3, ECR). For everything else we go through the client's egress firewall, and they will need to allowlist destinations.
- An **incident playbook**: who do they call when the app is on fire at 2 AM? What metric do they watch? What's the rollback procedure?

### How the existing setup docs change

| Phase | Greenfield (current) | Existing-infra (this strategy) |
|---|---|---|
| 1 — AWS baseline | Create IAM user, ECS task role, RDS monitoring role, ECR repos via CLI | **Deleted.** Consume the workload account; Terraform module describes the role and is applied by client CI |
| 2 — RDS Postgres | Create RDS instance | We don't create RDS. Client DBA Terraform module produces it. We hand over a schema requirement: Postgres 16, `pgvector`, `pg_trgm`, a parameter group they review, sizing assumption. They produce the instance and a Secrets Manager secret containing the connection string |
| 3 — Secrets Manager | Create secrets, attach policies | Consume the prefix. `@lp-ai/lib-config` already supports this |
| 9 — ECS Fargate | Create ECS cluster, services, ALB, and broad role from scratch | ECS Fargate behind an ALB. The client's platform team usually owns ECS clusters; we contribute the task definitions and service definitions as IaC and submit them as PRs. Our Terraform module declares the task definitions, service definitions, target groups, and listener rules; platform team reviews the security group attachments and ALB integration |
| 10 — EventBridge | Create rules and broad role | Submit IaC. Invoke role policies are exactly the `infra/iam/lp-eventbridge-*` docs |

---

## 2. Google Workspace (Sheets + Drive + BigQuery)

### What the client already has

- Workspace tenant with strict admin controls. SecOps owns service account creation.
- A separate GCP project for analytics (`mycompany-analytics`) where BigQuery datasets live.
- A Shared Drive structure with team OUs. Document sharing is audited.

### What the client will grant us

- **One service account** they create. They deliver the JSON key to us via 1Password (or the standard secrets handoff process) — not email, not Slack.
- **Scopes restricted at creation**: `drive.readonly`, `spreadsheets.readonly`, `bigquery.dataViewer`, `bigquery.jobUser`. No `bigquery.admin`. No write scopes anywhere.
- **Surgical access**: the service account is added as a member to a *specific* Shared Drive folder we'll work from, not domain-wide. Same for the specific Sheets — added per-file. If a sheet isn't in the explicit allowlist, we can't read it.
- **BigQuery**: dataset-level IAM, not project-level. We read `analytics.lp_internal_*` views. If we need new fields, the client's data engineering team adds them; we don't create tables.

### What the client wants from us

- A list of **exactly which Sheet IDs and Drive folder IDs** we need. They attach them in the admin console rather than handing us broader access.
- A key rotation contract: client rotates every 90 days. Our app re-reads the secret from Secrets Manager on a SIGHUP or restart — no app code change.
- The 12-Sheet pattern in our current sheets connector is fine, but it must surface a *missing-access* error clearly — if the client revokes a sheet, our sync should fail loudly into `sync_runs`, not silently skip.

### How the existing setup docs change

- **Phase 5 (Google connectors):** rip out the "create your own service account" parts. Replace with "consume the SA JSON the security team provides." Add a section on key rotation. Add a section on what to do when a Sheet ID changes.
- **Phase 20 (BigQuery):** no project creation. Consume `mycompany-analytics:lp_internal_views.*`. Document the dataset schema we depend on.

---

## 3. Slack

### What the client already has

- A single Slack workspace, admin-gated. Installing apps requires Workspace Owner approval.
- A small allowlist of approved third-party apps. Custom internal apps are reviewed individually.

### What the client will grant us

- Permission to ship a **Slack App manifest**, which they install in their workspace as a private, non-distributed app. We don't get a personal user token; we get a bot token tied to that app.
- Bot scopes they'll accept: `channels:history`, `groups:history`, `users:read`, `users:read.email`, `team:read`. Anything else (`chat:write`, `files:read`) requires justification.
- Channel allowlist: the bot is invited to a specific set of channels. It cannot read channels it hasn't been invited to.

### What the client wants from us

- **The manifest, in YAML or JSON, in our repo.** They review it like code.
- A clear statement about what is stored from Slack. If we're embedding messages into pgvector, the client's legal team needs to know the retention policy.
- We do not request `users:read.email` if we can get away without it — PII grants are reviewed.

### How the existing setup docs change

- **Phase 18 (Slack connector):** replace "create a Slack app" with "submit a Slack manifest PR for review." Add a data-handling note: messages from private channels stay in pgvector inside the workload account, never leave, retention is X days.

---

## 4. Notion (replaces the Drive meeting-transcripts path)

### What the client already has

- A Notion workspace with workspace-level admin. Internal integrations are scoped to specific pages.

### What the client will grant us

- An **internal integration** in their Notion workspace, scoped to a specific top-level page tree (e.g. `Meetings/`).
- An integration token, delivered via the same secrets path as Google.

### What the client wants from us

- The exact page tree we need. They don't grant workspace-wide.
- Same rotation expectation as the Google SA.

### How the existing setup docs change

- **Phase 12 (Notion):** "create your own integration" → "consume the token your admin provisioned." Document which page trees are in scope.

---

## 5. GiveButter & Aplos

These are easier — the client is the customer of both. They own those accounts.

### What the client will grant us

- A dedicated API key in each, generated by their finance ops team, with the narrowest available scope. For GiveButter that's a read-only token; for Aplos it's whatever the Aplos roles allow on their read-only side.
- The RSA decryption flow we already implemented for Aplos (per memory `aplos_connector_live.md`) is fine — keep the private key in Secrets Manager, not the repo.

### What the client wants from us

- A clear note in the runbook for when GiveButter or Aplos rotates keys: who pages whom, how long the sync can be down before it's an incident.
- Specifically for Aplos: capture the `--security-revert` flag gotcha in `docs/runbooks/connector-aplos.md`, not in private memory the client can't see.

### How the existing setup docs change

Minimal — Phases 16 and 17 already assume the client owns the accounts. Add the rotation runbook.

---

## 6. Roam

Small enough that this is the most negotiable. The client provisions an API key from their Roam org and gives it to us. Same secrets handoff. No structural change to Phase 19.

---

## 7. OpenAI + Anthropic (LLM and embedding billing)

This one the client pushes back on hard.

### What the client already has

- An Anthropic Console org with a usage cap and a finance owner.
- An OpenAI org, same shape.

### What the client will grant us

- An API key in **their** Anthropic org, scoped to a workspace called `lp-internal-ai`, with a monthly spend cap. Same for OpenAI.
- Per-key spend visibility in their finance dashboard.

### What the client will not accept

- A vendor-owned key, even temporarily. Billing has to land on their org from day one, because rebilling LLM spend through invoices is a finance nightmare and obscures cost trends. Our `.env.example` lists `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` — fine, but the production values come from *the client's* orgs.

### What the client wants from us

- An **estimate of token spend at steady-state** so they can set the cap correctly. Per-tool, per-sync.
- Behavior when the cap is hit: hard fail with a clear `sync_runs` error, not silent degradation.
- A note on model selection: they want to know if we'll bump models when new versions ship, or pin. Pin and let them decide upgrades.

---

## 8. Sentry

### What the client already has

- A Sentry org with multiple projects and an SSO-only access policy.

### What the client will grant us

- A project `lp-internal-ai`, with separate DSNs for HQ, MCP server, and sync workers.
- Team-level access to our engineers via their SSO.

### What the client wants from us

- Use `release` tagging so they can correlate errors to deploys.
- Filter out noisy errors (rate limits from GiveButter, expected 404s from missing Roam records) at the SDK level — they're watching error-budget burn rate, and our noise pollutes it.

No structural change to Phase 11, just a "consume, don't create" reframing.

---

## 9. Self-hosted services: n8n, Metabase, Airbyte

This is the conditional one — depends on whether the client already has them.

**If the client already has them** (likely for Metabase, possible for the other two): we don't deploy. We ask for a workspace/environment/project inside their existing instance, we ship connector configs, and their platform team reviews them like any other change. Phases 13/14/15 become "configuration on existing infrastructure."

**If the client doesn't have them**: easier for us, but we still deploy via Terraform in the workload account, and they review the modules for the same reasons as any other infra. We don't put them on EC2 unless we can defend it — ECS Fargate is the default for stateless workloads, RDS for state. n8n's persistence specifically — use managed Postgres, not the embedded SQLite, because backups matter.

---

## 10. GitHub

### What the client already has

- A GitHub Enterprise Cloud org. Branch protection on default branches across all repos. SSO-mandated for org members. Required 2FA.
- GitHub Actions OIDC to AWS already configured for other vendors — the trust pattern is ready.

### What the client will grant us

- A repo in their org (`mycompany-org/lp-internal-ai`) owned by a team they add our engineers to.
- Write access. PR review required. Default branch protected.
- Org-level secret entries for the AWS deploy role ARN, OpenAI/Anthropic project IDs — repo-level secrets only for repo-specific values.

### What the client wants from us

- CODEOWNERS file that maps to our team plus their platform team for `infra/` and `.github/workflows/`.
- A CI pipeline that includes their mandatory checks: dependency scanning (Dependabot or Snyk), license check, SAST (CodeQL is free), secret scanning. Required by their AppSec policy.
- No `--no-verify` on commits. We already saw the block on direct pushes to the default branch — same culture applies everywhere.

---

## 11. The handover shape

What the client wants at the end of the engagement, in order of importance:

1. **A Terraform module** at `infra/terraform/` in the repo that, given the client's VPC ID, subnet IDs, KMS key ARN, and tags, stands the whole thing up in a new workload account. No "click these buttons in the console" anywhere.
2. **A runbook per data source** (`docs/runbooks/connector-{name}.md`) covering: what credential is needed, who issues it, what happens on rotation, what failure looks like in `sync_runs`, and who pages whom.
3. **An incident playbook** at `docs/runbooks/incident.md`: top 5 failure modes, the dashboard to check, the Sentry query to run, the rollback command.
4. **A SBOM** for both apps so the client's AppSec team can scan it during onboarding and ongoing.
5. **A trust boundary diagram** — what data crosses what boundary. Legal will ask, and they want a one-page answer.

What the client does *not* want: a doc that says "first, create an IAM user with AdministratorAccess." That doc gets the engagement rejected at the security review stage.

---

## 12. Concrete shifts to plan for now

Three things to start working on before any rewriting of the existing phase guides:

1. **Promote `infra/iam/*.json` to a Terraform module.** Static JSON is a stepping stone; the deliverable is `infra/terraform/modules/iam/` that emits those role/policy resources with input variables. Same for VPC connector, ECS task/service definitions, EventBridge, RDS parameter group, ECR, Secrets Manager.
2. **Replace `docs/setup/01–21` with two parallel tracks.** One track is "self-hosted greenfield" (close to what we have now, for the no-existing-infra case). The other is "client-provisioned" (this document — consume primitives, ship IaC). Most clients will be the second; keep the first as the dev/demo path.
3. **Treat secrets as inputs, not as something the app fetches by name.** Right now `@lp-ai/lib-config` fetches by name. That's fine, but document the *contract*: "given a secret at path `lp-internal/database/url` containing JSON `{ url: string }`, the app will work." The client then wires our contract into their secret-naming conventions without us having to know what they are.

---

## 13. Likely friction points

When this strategy meets a real client conversation, three places consistently cause pushback:

- **LLM billing.** Vendors always want to bring their own keys (simpler, no procurement). Clients always want billing on their org (cost tracking, finance hygiene). The client wins this one; design for it from the start.
- **The IaC requirement.** If our team hasn't shipped Terraform before, this is a real lift. Budget time for it explicitly during scoping.
- **Slack manifest review.** Usually surfaces scope creep — we always think we need more scopes than we actually do. Build the manifest minimally and add scopes only with justification.

---

## Next sections to add

- **Data access policies** — who can query what through the MCP server; PII handling; query audit logs; row-level vs. tool-level authorization; retention policies per data class.
- *(Add subsequent sections here as they are discussed.)*
