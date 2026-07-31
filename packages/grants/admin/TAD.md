# Grant Writing Layer — Technical Architecture Design

| Field | Value |
|---|---|
| Subject | Architecture, security, compliance, and data governance for the grant writing layer |
| Prepared for | The VP of Technology |
| Date | 2026-07-28 |
| Status | For review |
| Companion documents | `PROPOSAL.md` (scope and deliverables), `SPEC.md` (build detail) |

**What this document is for.** `PROPOSAL.md` states what we build and why. This document states how it fits the platform, how it stays inside our access controls, and which data rules it must not break. `SPEC.md` holds the module-level build detail. Read this document for the design decisions and their reasons. Read `SPEC.md` for the work.

---

## 1 Architecture

### 1.1 Where the layer sits

The platform has three existing layers. The grant work adds to two of them and adds nothing new to the stack.

| Layer | What is there today | What this work adds |
|---|---|---|
| Data | Postgres with vector search. Seven connectors write to it. | Nothing. The layer reads through existing tools only. |
| Tools | An MCP server with 16 data tools and 4 skill tools. | Three grant tools, and a shared logic package that they consume. |
| Guidance | Skill prompts that instruct Claude. | A rewritten grant writing skill that calls the three tools. |

The layer introduces no new service, no new datastore, no new runtime, and no new external dependency. It is a package plus three tools inside the existing MCP server.

That last claim was at risk while decision 6 in section 5 called for an Anthropic client. It no longer is: as revised, the layer makes no outbound call at all, so `@lp-ai/lib-grants` depends on `zod` and nothing else.

### 1.2 Components

| Component | Role | State |
|---|---|---|
| `packages/grants` | The deterministic logic and the seed data. Not a tool. The tools consume it. | Five support modules exist. |
| `grant_match_question` | Connects a funder question to a question bank entry. Pure. | To build. |
| `grant_build_draft` | Runs the write path. Returns a draft package and a figure work order. | To build. |
| `grant_resize_answer` | Shortens an answer to a limit. The one call to Claude. | To build. |
| `skill_grant_writing` | The drafting guidance. Calls the three tools, then orders the figure checks. | Exists. To rewrite. |

All three tools are read-only and non-destructive, matching the annotations on the existing `query_*` tools.

### 1.3 Language and toolchain

**The layer is TypeScript throughout.** The prototype is Python, and no Python survives into the platform.

The reason is consistency. Every other part of the repository is TypeScript in strict mode — the MCP server, the HQ app, all seven connectors, and the shared packages. A Python module here would need its own runtime, dependency manager, test runner, and container layer, and would sit outside every convention the team already follows.

The layer therefore adopts the platform toolchain without exception: strict mode, explicit return types on exports, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` on, no `any`, named exports only, zod validation on all external data, vitest for tests, and `tsc` to build.

One consequence matters at review time: the tools register through the same `runTool` wrapper as the 16 existing data tools, so they inherit the platform's error envelopes and usage logging at no cost.

### 1.4 Data flow

```
Funder form (captured to a fixture)
        │
        ▼
grant_build_draft ──── reads ───▶ packages/grants seed data (question bank, knowledge base)
        │
        ├──▶ draft package (Markdown, per-answer verdict, provenance)
        └──▶ figure work order  ── a LIST of calls, never executed here
                     │
                     ▼
        the CALLER runs each query_* tool under its own identity
                     │
                     ▼
        ACL check ──▶ usage log ──▶ live figure with an asOf date
                     │
                     ▼
        staff review, edit, submit
```

The break in that chain between the work order and the connector calls is the central security control. Section 2.3 explains it.

---

## 2 Security and compliance

### 2.1 Threat model in one line

The layer reads organizational data — including finance, donor, and student data — and produces text that leaves the organization. The two risks that matter are **a read that escapes its access control** and **an output that reaches a funder without review**.

### 2.2 Controls

| # | Control | Mechanism | Failure mode if absent |
|---|---|---|---|
| 1 | Role-based access on every tool | A `tool_permissions` record names the roles allowed to call each tool. | The tool is denied to everyone. Refer to section 2.4. |
| 2 | Audit of every call | The `runTool` wrapper writes each call to the usage log against the caller. | No record of who read what. |
| 3 | No privilege widening by the layer | The layer returns a list of data calls. It never makes one. Refer to section 2.3. | Restricted data reclassified as a grant read. |
| 4 | Safe degradation on denial | On a denied figure check, the draft records that the data is unavailable. | A stale figure presented as confirmed. |
| 5 | No sensitive data at rest in the repository | Only questions and limits are stored. No personal data. Refer to section 2.5. | Personal data in the version history, permanently. |
| 6 | No send path | The layer produces drafts only. Nothing addresses a funder. | An unreviewed application reaches a funder. |
| 7 | Provenance on every figure | Each confirmed figure carries its source tool and its measurement date. | An out-of-date number in a filed application. |

### 2.3 The layer lists data calls and never makes them

`grant_build_draft` returns a **figure work order**: 15 checks, each naming the claim, the exact tool to call, and the exact arguments. The caller runs them. The layer does not.

**This is a security requirement, not a style choice.** The `runTool` wrapper checks permission against the inbound tool name. A grant tool that read the database directly would present its own name to that check, and the check would then authorise finance and donor data as a grant read. That moves restricted data past the classifier under the wrong label.

Because the caller makes each call under its own name, each call is checked against the role ACL and written to the usage log for that person. Access stays where it belongs.

Two checks read restricted data and may be denied: the finance query and the donor query. On a denial, the draft records `[DATA UNAVAILABLE]`. It never quotes the stored figure as confirmed.

### 2.4 Access control fails closed

The ACL registry reads the `tool_permissions` table and denies any tool it does not find:

```ts
const allowed = c.rolesByTool.get(toolName);
if (!allowed) return false;
```

An unregistered tool is therefore **denied to every user**, not open to them. "Open access" is not the consequence of skipping the permission record — `permission_denied` on every call is.

Each of the three tools needs a `ToolPermission` row and a seed migration. `SPEC.md` holds the migration template and the closest existing example.

Recommended roles: leadership and administrator. Recommended category: `grants`. Note that `skill_grant_writing` already holds a row with leadership, administrator, development, and finance.

One further decision belongs here. `SERVICE_ALLOWED_TOOLS` is a hardcoded set, separate from the table, that scopes what a service caller with a sync secret may invoke. It currently excludes every skill tool. Decide whether a service caller may run the grant tools. If the answer is no, change nothing — the default already denies.

### 2.5 Data handling posture

**We trust the platform for a query, and we store nothing.** The layer reads live data through existing tools and uses the result in a draft. It does not cache, mirror, or persist any figure or record that could raise a privacy concern.

What stays out of the repository, permanently:

| Excluded | Why |
|---|---|
| The prototype's source data folder (~5.6 MB) | Real customer records, transaction records, student personal data, and meeting transcripts. The platform serves all of it live, under each person's own permissions. It must never enter the version history. |
| Generated draft outputs | Working artifacts that contain organizational detail. Not platform code. |
| Prototype research and working notes | Superseded by these documents. |

What the layer does hold: form fixtures containing questions and length limits only, and a knowledge base of approved organizational answers. No personal data in either.

### 2.6 Where Claude is involved, and where it is not

| Step | Deterministic | Claude |
|---|---|---|
| Match a question to the question bank | Yes | No |
| Retrieve a stored answer | Yes | No |
| Count an answer against a limit | Yes | No |
| Decide the verdict for an answer | Yes | No |
| Shorten an answer to fit a limit | No | Yes |
| Draft prose from the guidance | No | Yes |

The arithmetic is arithmetic. A language model cannot count its own words reliably, and a funder rejects an application that exceeds a stated cap, so the count must never be a judgement.

Where Claude does write, it uses the platform's existing Anthropic client and the platform's usage log. It does not open a separate path. The resize prompt forbids inventing a fact or a figure, and that guardrail carries over from the prototype verbatim.

---

## 3 Data governance

These rules are mandatory. They exist because breaking one puts a wrong number, or a misrepresentation, into a filed application.

### 3.1 Precedence: live data beats a filed figure

Live platform data supersedes filed application material. On a conflict, the newer figure wins.

A field marked `verified:false` is a genuine unknown. Never present it as confirmed. Four of the 29 stored answers carry that mark.

### 3.2 Stored figures go out of date, and some move daily

The `verified` mark does not measure age. It means "grounded in filed material". It does not mean "current". The mark also points the wrong way: it fires on an answer that holds no figures, and stays silent on the answer that holds five.

Total participant wages, measured:

| Source | Figure | Measured |
|---|---|---|
| A filed application narrative | $350,268 | At the filing date |
| A knowledge base reconciliation note | $360,487 | 2026-07-23 |
| Live platform data | $362,030.26 | 2026-07-27 |
| Live platform data | $362,361.82 | 2026-07-28 |

An application quoting the stored figure would understate our results by about $12,000.

**This figure is a moving target by construction.** The employment query calculates earnings for each active job up to the current date. Seven jobs are active, so the total changes every day. The last two rows are one day apart and differ by $331.56. **No wage figure stays confirmed.**

This is the reason for control 7 in section 2.2. Stamp every confirmed figure with its source tool and the `asOf` date the tool returned, put both in the draft next to the figure, and re-confirm any figure measured more than three days before submission.

The same caution applies to counts. The knowledge base claims 88 jobs; live data returned 86 on 2026-07-28. Confirm the count with the figure.

### 3.3 A definitional conflict does not resolve automatically

A drift conflict resolves to live data by recency. A **definitional** conflict does not. It must reach a person. Two real examples:

1. "145 served" and "301 enrollment records" are both correct. They count different populations.
2. A 92% certification pass rate per cohort and 54.2% all-time are both correct. They use different denominators.

A silent choice between two such figures is the most damaging action this layer could take. State the population or the denominator in the sentence itself.

### 3.4 A person always reviews

Never submit. Never send anything to a funder. Every output is a draft for staff to accept or edit, with its sources shown. A `verified:true` mark does not authorise submission.

### 3.5 New framing supersedes old framing

The organization moved from a 12-month model to a model of about 6 months for AI engineers. Text describing the old model must never enter a new draft. The knowledge base metadata carries the recency register and the reconciliation cross-check that support this.

### 3.6 Compression has a floor

The answer fitter refuses to compress an answer below a quarter of its length. Above that ratio, compression is not compression — it is a decision about which facts to remove, and a person must make it. The verdict returned is `compression_infeasible`.

The case is real: one question maps to a 1403-character stored answer against a 30-character funder cap, a ratio of 46.8. The correct answer is the organization's name. No automatic method finds that.

---

## 4 Access path for application records

### 4.1 The rule

The Development teamspace in Notion is the record of our grant applications: each funder's questions, each limit, each deadline, the status, and the text we filed. Treat it as authoritative for the application itself.

**Reach it through the platform, not through Notion.** The platform's Notion connector already copies Notion pages into the vector store, and the platform can search them by meaning.

| Want | Path |
|---|---|
| Teamspace material, by meaning | The document search tool, scoped to the Notion source |
| A current figure | The paired `query_*` tool. Refer to section 2.3. |

Do not add a direct Notion API call, a direct Notion MCP call, or a manual page read to the write path. Three reasons:

1. The ACL and the usage log only see a call that arrives as a platform tool. A direct read bypasses both, so no record shows who read what.
2. A direct read creates a second copy of the truth and a second failure mode.
3. The platform search returns ranked passages, which is what a drafter needs.

The two sources of truth do not compete. The teamspace is authoritative for the application. Live platform data is authoritative for a current figure, per section 3.1.

### 4.2 The guidance lives in the platform, not in the page

Our Playbook holds the drafting craft. It must reach every draft, and it must not reach a draft through a manual page read.

**As of 2026-07-29 it is in the repository at `docs/PLAYBOOK.md`**, which satisfies the version-control argument below directly rather than by transcription. The two-step rule still stands: G5 authors the durable guidance into the skill, and the skill — not the file — is what a draft consults.

Note that the Playbook as supplied asks for behaviour this document does not currently sanction, including writes back to the Notion Grant Applications database. Those conflicts are recorded in `HANDOFF.md` and deliberately left open until the draft pipeline exists and can be assessed against them.

1. **At draft time, consult the platform skill.** The skill is the authority on how to draft.
2. **At authoring time, consult the Playbook.** The team reads it, decides which guidance is durable, and writes that guidance into the skill.

Four reasons:

- **Version control.** The skill lives in the repository. Each change gets a review and a commit. A Notion page has no equivalent record inside the platform.
- **Consistency.** A skill reaches every draft in the same form. A manual read depends on who reads.
- **Testability.** We can test written instructions. We cannot test a habit.
- **Cost and reliability.** A per-draft retrieval adds a step and a failure mode. Guidance already in the prompt cannot fail.

When the skill and the Playbook disagree after the skill is authored, the skill is wrong. Correct the skill and record the reason.

### 4.3 Open finding: the two sources are not yet reaching the platform

**The rule in section 4.1 does not work today.** A probe on 2026-07-28 found that the platform does not copy the two Notion sources the layer needs. This is the external dependency in `PROPOSAL.md` section 8.1.

Evidence:

1. Notion is copied, and the record format matches the design exactly. Example identifier: `notion:38bbc938-2180-81d6-af79-f93b59029a60:0`.
2. A document search scoped to Notion, on the Playbook's own subject matter, returned no passage from the Playbook page.
3. Three unrelated Notion databases do appear: Glossary, People & Entities, and a meeting-transcript database. The Grant Applications database does not.
4. Funder records in People & Entities carry a relation to their grant applications, but the copy flattens it to a title string. It carries no question, no limit, no deadline, and no filed text.

**Revised 2026-07-29. Two corrections and a hand-off.**

1. **"Configuration, not code" was only half right.** `syncDatabases()` iterates `queryDatabase(db.id)`, which posts to `/databases/{id}/query`; a page id sent there fails. The Grant Applications database genuinely is a one-line change to the environment variable. The Playbook is a page and could never have been reached that way.
2. **The Playbook no longer needs the connector.** It now lives at `docs/PLAYBOOK.md` in this package — the version-controlled home section 4.2 argues for anyway, so this closes the half of the gap that needed code.
3. **A third source turned up.** `docs/PLAYBOOK.md` names a Research Wiki database (`33779abd-443f-8075-8a47-000b973f8eba`) and instructs Claude to search it before responding. It appears in none of the four review documents. Same rule as the others.

**This item is handed off and is no longer a gate on this package.** It is connector work, it needs the owner `PROPOSAL.md` section 8.1 asks for, and holding a release gate open on another team's queue would have stalled the build for no benefit. Until it lands, a teamspace fact in a draft is unsourced, and the skill must say so rather than assert it.

**Do not answer this gap with a direct Notion read.** A gap is a fault in the copy process. A direct read hides the fault and bypasses both the ACL and the usage log. Extend the connector instead.

---

## 5 Architectural decisions on record

| # | Decision | Rationale | Revisit when |
|---|---|---|---|
| 1 | TypeScript throughout; no Python in the platform. | Consistency with every other package. Refer to section 1.3. | Never. |
| 2 | File-based seed data first; database models deferred. | The move costs work and delivers nothing new by itself. Keeps the first build small. | The tools pass their test bar. |
| 3 | The layer lists data calls; the caller executes them. | Security. Refer to section 2.3. | Never. |
| 4 | Seed files load at runtime, lazily and memoised. | A malformed file fails inside a tool call as a structured error, rather than stopping the server at boot. | Never. |
| 5 | Guidance is authored into the skill, not retrieved per draft. | Version control, consistency, testability, reliability. Refer to section 4.2. | Never. |
| 6 | **Revised 2026-07-29: there is no Claude call. No SDK, no client, no network.** The resize tool returns the source answer, the limit, the measurement, and the guardrail instructions; the calling Claude rewrites and calls back to re-measure. | The original decision said to reuse "the platform Anthropic client", which does not exist — `@anthropic-ai/sdk` is in no `package.json` here, and `ANTHROPIC_API_KEY` is declared in `packages/config/src/schema.ts` but never read. Building one would solve the wrong problem: the prototype needs `ClaudeResizer` because a Python CLI has no model in the loop, but an MCP tool is invoked *by* Claude. Dropping the call keeps section 1.1's "no new external dependency" true, keeps the whole layer unit-testable with no mocking, and leaves the usage log as the only audit path. | Never. |
| 7 | Carry the unused "reframe" hook as a seam, unconnected. | The prototype has it. Connecting it now adds an untested Claude call to the path. | After release. |

---

## 6 Non-functional posture

| Property | Position |
|---|---|
| Availability | The layer adds no new service. It inherits the MCP server's availability. |
| Performance | The path is arithmetic over 82 questions and 211 wordings, loaded once and memoised. Measured 2026-07-29: 6.0 ms to match one question against the full bank (293 candidates, each scored with a `difflib`-equivalent block search), and 102 ms for the whole 17-question Truist form. There is no network call left in the layer to dominate that. |
| Cost | No Claude call, no embedding cost, no new infrastructure. Refer to section 5, decision 6. |
| Failure behaviour | A malformed seed file, a denied figure check, and a failed resize each surface as a structured error or an explicit gap in the draft. None produces a silent wrong answer. |
| Testability | The whole layer is testable with no network and no mocking, since decision 6 removed the only outbound call. 45 tests were the stated bar; G1 and G2 alone landed 43, because parity is asserted against fixtures generated from the prototype rather than against hand-written expectations. Refer to `SPEC.md` section 5. |
| Observability | Every tool call is in the usage log and visible on the HQ tools page. Seed data integrity is reported at load time. |

---

## 7 References

| Item | Contents |
|---|---|
| `PROPOSAL.md` | Scope, deliverables, timeline, and the three decisions. |
| `SPEC.md` | The build detail, the module map, the parity gates, and the migration template. |
| `packages/grants/docs/PLAYBOOK.md` | The drafting craft: the four intake steps, the style rules, and the non-negotiables. The source G5 authors the skill from, per section 4.2. |
| `packages/grants/seed/QUESTIONS-SCHEMA.md` | The question bank structure and its growth rules. |
| `apps/mcp-server/src/permissions.ts` | The ACL registry. It fails closed. Refer to section 2.4. |
| `apps/mcp-server/src/tool-helpers.ts` | `runTool`, the usage log, and `SERVICE_ALLOWED_TOOLS`. |
| `apps/mcp-server/src/tools/search-documents.ts` | The read path for teamspace material. |
| `connectors/notion/src/sync-databases.ts` | The copy process. Refer to section 4.3. |
| `CLAUDE.md` (repository root) | Platform architecture and tool conventions. |
