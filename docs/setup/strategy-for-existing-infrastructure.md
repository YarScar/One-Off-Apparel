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

Most clients we work with are small-to-medium nonprofits, not enterprises with multi-account AWS Organizations. The AWS setup needs to accommodate two realities: the client we typically encounter, and the more sophisticated client who brings their own infrastructure.

### Typical client (most engagements)

**What they have:**
- A single AWS account, often newly created for this project. No Organization, no SCPs, no multi-account hierarchy.
- One IAM user with broad permissions (often `AdministratorAccess`) used by whoever set up the account. No IAM Identity Center, no SSO federation.
- No existing VPC, ECS cluster, or infrastructure primitives. We build everything.

**How we actually set it up (current reality):**

This is how our reference deployment is configured:

| Resource | What exists | How it was created |
|---|---|---|
| **IAM user** | `userID` — used for CLI access during setup | Created manually in console. Scoped permissions (not full IAM admin — cannot create OIDC providers, for example). |
| **IAM roles (5)** | `lp-ecs-execution-role`, `lp-ecs-task-role`, `lp-ecs-infra-role`, `lp-ecs-task-execution-role`, `lp-eventbridge-invoke-role` | Created via CLI during setup phases. Policies defined in `infra/iam/*.json`. |
| **ECS cluster** | `lp-internal` | One cluster, three long-running services (mcp-server, hq, aws-mcp-server), plus on-demand sync tasks. |
| **ECS services (3)** | `lp-internal-mcp-server` (1 task), `lp-internal-hq` (1 task), `lp-internal-aws-mcp-server` (1 task) | All Fargate ARM64, behind ALB target groups. Task definitions in `infra/ecs/*.json` with `${AWS_ACCOUNT_ID}` placeholders. |
| **ECR repos (4)** | `lp-internal/mcp-server`, `lp-internal/hq`, `lp-internal/aws-mcp-server`, `lp-internal/sync` | Created during setup. Images built locally or in CI, pushed to ECR, deployed to ECS. |
| **Secrets Manager** | `lp-internal/*` prefix | 10+ secrets covering database, API keys, OAuth, JWT. Runtime roles have read access; builder user has write access. |
| **RDS** | Postgres 16 with pgvector | Single instance, `us-east-1`. Connection string in Secrets Manager. |
| **GitHub Actions OIDC** | Pending setup | `lp-github-deploy` role and policy defined in `infra/iam/lp-github-deploy-*.json`. OIDC provider creation requires IAM admin permissions (blocked on approval). |

**Key gap: no Terraform.** The current setup was done via CLI commands following the `docs/setup/` phase guides. The `infra/iam/*.json` and `infra/ecs/*.json` files define the resources declaratively but are applied manually, not through a pipeline. This is acceptable for a single deployment but doesn't scale to multiple clients. The path forward is `infra/terraform/` modules (see section 12).

**Key gap: IAM user, not federated identity.** The builder IAM user (`userID`) has static access keys and scoped (not admin) permissions. For production client handoffs, this should be replaced with IAM Identity Center or at minimum time-limited credentials. For the initial buildout with a small client, a single IAM user with scoped permissions and MFA is pragmatically fine.

### Sophisticated client (enterprise engagements)

These clients bring their own infrastructure and expect us to consume it, not create our own:

- An AWS Organization with workload accounts, SCPs, IAM Identity Center, and a platform team.
- A pre-provisioned VPC with public/private/database subnets, NAT, and tagged security groups.
- A KMS CMK for encryption at rest. They expect us to use it, not the AWS-managed key.
- A Terraform or CDK repo where all infrastructure changes are reviewed as PRs.
- A FinOps tagging requirement on every resource.

**What they grant us:**
- A dedicated workload account (or namespace within one). We operate inside it, nothing in mgmt or security accounts.
- An SSO permission set for our engineers — `PowerUserAccess` minus IAM, scoped to the workload account.
- A GitHub OIDC trust for our CI deploy role — the only identity that can mutate production.
- A Secrets Manager prefix (`lp-internal/*`) and KMS key grants for our runtime roles.

**What they want from us:**
- The policies in `infra/iam/` adapted to their conventions: `kms:KeyArn` conditions referencing their specific CMK (not the broad `kms:ViaService` pattern), `aws:ResourceTag/Application: lp-internal` conditions on S3 and CloudWatch statements for blast-radius scoping.
- An **egress inventory**: every external host the app contacts (OpenAI, Anthropic, GiveButter, Aplos, Slack, Notion, Google APIs, Sentry). Their egress firewall needs to allowlist these.
- An **incident playbook**: who to call, what to watch, how to roll back.
- Infrastructure delivered as Terraform modules, not CLI scripts.

### Secure credential provisioning during onboarding

During setup, the client gathers API keys, service account credentials, and connection strings from their various systems. These secrets ultimately live in AWS Secrets Manager at runtime — the question is how they get there.

There are two paths depending on the client's infrastructure maturity. **Option A is preferred** because the implementation team never sees the credentials at all.

---

#### Option A: Client provisions secrets directly into AWS (preferred)

This is the right path when the client has AWS infrastructure and an ops person who can use the Secrets Manager console or CLI.

**How it works:**

1. We provide the client a **secrets contract** — the exact Secrets Manager paths and key names the application expects (see table below).
2. The client's team provisions each credential from the source system (GiveButter admin panel, Google Workspace admin, Aplos account settings, etc.) and writes it directly into Secrets Manager under the `lp-internal/*` prefix.
3. The implementation team **never sees the credentials**. We see only whether the secret exists and whether the app can read it successfully at startup.
4. For secrets we generate (AUTH_SECRET, JWT keys, SYNC_SECRET), we generate them, write them to Secrets Manager, and provide the client the Secrets Manager paths so they can access them if needed for rotation or disaster recovery.

**Why this is preferred:** zero credential exposure to the implementation team. The client provisions from source → AWS directly. No intermediary, no shared vault, no transfer step. The blast radius of a compromise is smaller because the credentials never exist outside the source system and Secrets Manager.

**The secrets contract:**

| Secrets Manager Path | Key(s) | Source | Who provisions |
|---|---|---|---|
| `lp-internal/db` | `DATABASE_URL` | RDS / client DBA | Client |
| `lp-internal/google` | `GOOGLE_SERVICE_ACCOUNT_JSON` | Client Workspace admin | Client |
| `lp-internal/openai` | `OPENAI_API_KEY` | Client's OpenAI org | Client |
| `lp-internal/anthropic` | `ANTHROPIC_API_KEY` | Client's Anthropic org | Client |
| `lp-internal/givebutter` | `GIVEBUTTER_API_KEY` | Client's GiveButter admin | Client |
| `lp-internal/aplos` | `APLOS_CLIENT_ID`, `APLOS_API_KEY` | Client's Aplos admin | Client |
| `lp-internal/slack` | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Client's Slack admin | Client |
| `lp-internal/notion` | `NOTION_API_KEY` | Client's Notion admin | Client |
| `lp-internal/roam` | `ROAM_API_KEY`, `ROAM_GRAPH_NAME` | Client's Roam admin | Client |
| `lp-internal/sentry` | `SENTRY_DSN_HQ`, `SENTRY_DSN_MCP` | Client's Sentry project | Client |
| `lp-internal/nextauth` | `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | OAuth setup + client GCP | Both |
| `lp-internal/jwt-signing` | `JWT_PRIVATE_KEY`, `JWT_KID` | Generated during setup | Implementation team |
| `lp-internal/sync` | `SYNC_SECRET` | Generated during setup | Implementation team |

We provide this table to the client as a checklist. They check each one off as they provision it. We verify the app starts cleanly.

---

#### Option B: Shared password manager (for clients without AWS infrastructure)

This is the path when we are setting up AWS infrastructure on behalf of the client — they don't yet have Secrets Manager, or they don't have anyone who can provision secrets into it. In this case, the client needs a secure way to transfer credentials to the implementation team so we can wire them into the infrastructure we're building.

**Secrets must never travel through email, Slack, text, or any unencrypted channel.**

**Required: a shared password manager vault.**

The client creates a shared vault in their password manager (1Password, Bitwarden, LastPass, or equivalent) dedicated to the engagement. Both parties access it through their own authenticated accounts. This is the **only** approved channel for credential transfer.

**Process:**

1. **Client creates the vault.** Name it something obvious: `Internal AI — Credentials`. Invite the implementation team's designated contact(s) — not the whole team, just whoever is wiring secrets into infrastructure.
2. **Client adds credentials as they're provisioned.** Each entry should include:
   - The credential itself (API key, JSON key file, connection string, etc.)
   - Which service it's for (e.g., "GiveButter API Key — read-only")
   - Who issued it and when
   - Expiration or rotation schedule if applicable
   - Any scope restrictions ("read-only", "scoped to lp-internal-* datasets", etc.)
3. **Implementation team reads credentials from the vault and provisions them into AWS Secrets Manager** under the `lp-internal/*` prefix. Once a secret is in Secrets Manager, the running application reads it from there — the password manager is the human handoff channel, not the runtime path.
4. **After production go-live, remove implementation team access to the vault.** The client retains it for their own rotation schedule. Future rotations: client updates the vault entry, notifies the ops team, who updates Secrets Manager.

Secrets generated by the implementation team (AUTH_SECRET, JWT keys, SYNC_SECRET) are placed in the vault so the client has them for continuity after handoff.

**If the client does not have a password manager:** this is the first thing to set up. A 1Password Teams account ($4/user/month) or Bitwarden Organization (free for small teams) is the minimum viable starting point. Do not proceed with credential sharing until this is in place.

---

#### Key rotation (both options)

Regardless of which path is used for initial provisioning, the rotation process is the same:

1. Client rotates the credential in the source system.
2. Client (Option A) or ops team (Option B) updates the value in Secrets Manager.
3. ECS services pick up the new value on their next deployment or task restart. No application code change required — `@lp-ai/lib-config` reads from Secrets Manager at startup.
4. Verify the affected connector or service starts cleanly after rotation.

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

- **One service account** they create. They provision the JSON key directly into Secrets Manager (Option A above) or deliver it via the shared password manager vault (Option B) — never email, never Slack.
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
