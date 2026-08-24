---
name: openproject
description: Create and maintain OpenProject work packages for this repo, which CLAUDE.md makes mandatory for every change. Covers what a package needs at creation (Subject, Owner/Assignee, Priority, Work, Category, Type, description), what must be kept current while the work runs (Status, Remaining Work, % Complete, Time Spent, Comments), how the openproject MCP connector writes each of them, and the `refs #<id>` commit convention. Use before starting any tracked work, when opening or updating a work package, when logging time, or when closing one out.
---

# OpenProject work packages

| | |
|---|---|
| Instance | `https://projects.liftofflearning.tech` |
| Default project | `internal-ai-integrations` ("Internal AI Integrations") |
| Access | `openproject` MCP connector; `OPENPROJECT_API_KEY` in `.env` for raw API (HTTP Basic, username literal `apikey`) |

Every change to this repo needs a work package **before work starts**. No package, no commit. The
only exception is housekeeping that touches nothing in the repo.

Read [`references/fields.md`](references/fields.md) for the exhaustive field table and the valid
values for every enumerated field.

## The connector writes every field the API allows

Verified against the live instance's own form schema on 2026-08-18. Nothing here needs the web UI.

| Field | Read | Write via MCP | How to set it |
|---|---|---|---|
| Subject | ✅ | ✅ | `op_create_work_package` / `op_update_work_package` |
| Type | ✅ | ✅ | `type` by name, on create **and** update |
| Description | ✅ | ✅ | markdown; update **replaces the whole body** |
| Status | ✅ | ✅ | `status` on update, by name |
| Assignee (Owner) | ✅ name | ✅ | `assignee` — a display name, a login, or an id |
| Accountable | ✅ name | ✅ | `responsible` — same forms as `assignee` |
| Parent | ✅ | ✅ | `parent` id, or `null` to clear |
| Start / Due date | ✅ | ✅ | `YYYY-MM-DD` |
| Priority | ✅ | ✅ | `priority` by name; `op_list_priorities` enumerates them |
| Work (`estimatedTime`) | ✅ | ✅ | decimal hours, an ISO duration, or `null` to clear |
| Remaining work (`remainingTime`) | ✅ | ✅ | same forms — but see the progress rule below |
| % Complete | ✅ | ✅ | `percentageDone` |
| Category | ✅ | ✅ | `category` by name — **none defined on this project yet** |
| Version | ✅ | ✅ | `version` by name, e.g. "Sprint 2" |
| Time Spent (`spentTime`) | ✅ | via `op_log_time` | never set directly; it aggregates time entries |
| Comments | ✅ | ✅ | `op_comment_work_package` |

Names are resolved against the instance, and an unknown one fails with the valid values listed. That
error message is the discovery path — there is no `op_list_categories` or `op_list_versions` tool.

Packages created before 2026-08-18 **carry Owner and Estimate in the description body** —
`**Owner** — Sean. **Estimate** — 8h.` — because the structured fields were unreachable then. Keep
writing that line: it is the human-readable record, and it is what the existing packages look like.
But now set the structured fields **as well**, in the same call.

## Creating a work package

### 1. Look before you create

```
op_list_work_packages({ search: "<keywords>", status: "all" })
```

Duplicates are worse than a slightly wrong package. If something covers the work, update it instead.

### 2. What every new package needs

- **Subject** — required, and the only truly required field. Write the outcome, not the activity.
  Real subjects in this project read like `B6 — Matcher quality review` for planned phase work, or
  `Harden live-figure fetching: cut catalogue in the grant-writing skill` for discovered work.
  Phase-child tasks carry their `<Letter><Number> — ` prefix.
- **Type** — `Task` by default. `Summary task` for a phase container that holds children.
  `Milestone` for a dated checkpoint with no duration. Changeable later via `type` on update, but
  a Milestone carries no duration, so switching drops the dates.
- **Description** — see the template below. This is where the package earns its keep.
- **Owner** — the assignee, by name (`assignee: "Demitri"`). Name the owner in the description too.
- **Priority** — `Low`, `Normal` (default), `High`, `Immediate`. Pass it on create; state it in the
  description too when it is not Normal.
- **Work** — the estimate, as `estimatedTime`. Decimal hours (`8`) or an ISO duration (`"PT8H"`).
  Also record it as `**Estimate** — 8h` in the description.
- **Category** — `category` by name, but **this project defines none**, so the field has no valid
  values yet. An admin has to create them in project settings first.
- **Parent** — attach discovered work to the package it came from, or to its phase summary task.
  Discovered work gets its *own* package related to the parent; it is never folded silently into the
  package you were working on.
- **Start / Due date** — set both when the work is scheduled into a phase. Leave both null for
  reactive work that is being done now.

```
op_create_work_package({
  subject: "…",
  type: "Task",
  parent: 121,
  description: "…",
  assignee: "Demitri",        // a name, a login, or an id
  priority: "High",
  estimatedTime: 8,           // Work, in decimal hours
  startDate: "2026-08-18",
  dueDate: "2026-08-22"
})
```

`notify` defaults to `false`. Leave it off unless a human needs the email.

### 3. Description template

Markdown. The shape below is what the well-formed packages in this project use:

```markdown
<One paragraph: what is wrong or needed, and why it matters now.>

**Scope** — what is in, and explicitly what is out.

**Acceptance**
- <A checkable condition, not an activity.>
- <Another.>

**Source** — where this came from: a document and section, a review finding, a package id.

**Owner** — <name>. **Estimate** — <Nh>. **Follows** — <package or condition>.
```

Two rules that come from the packages already here: acceptance conditions are checkable ("both
questions match confidently"), never activities ("review the matcher"); and anything you could not
verify goes in the description as an open question rather than being quietly assumed.

## Maintaining a work package

### Status

Set **In progress** the moment you start. 14 statuses exist; only `Closed` and `Rejected` close a
package. The full list is in [`references/fields.md`](references/fields.md).

```
op_update_work_package({ id: 291, status: "In progress", startDate: "2026-08-18" })
```

`lockVersion` is fetched automatically, so a concurrent edit fails loudly instead of overwriting.
If an update errors on the lock version, re-read the package — someone else changed it.

### Work, Remaining work and % Complete are one quantity in three views

This instance runs **work-based progress**: any two of the three determine the third, and OpenProject
recomputes it for you. Verified live — writing `estimatedTime: 10, remainingTime: 2.5` came back as
`PT10H / PT2H30M / 75%`.

So:

- **Pass at most two of the three.** All three at once is refused before the request goes out, because
  OpenProject rejects an inconsistent triple with *"% Complete does not match Work and Remaining
  work"*.
- Set Work once, at creation. After that, **maintain `percentageDone`** and let Remaining work follow.
- If Work is empty, `percentageDone` is a bare judgement call. Use round numbers and do not pretend
  to precision the estimate does not support.
- Never reconcile Remaining work by hand-arithmetic against a number you computed outside
  OpenProject — write one of the pair and read the third back.

### Time Spent

`spentTime` is an aggregate of time entries. Never treat it as a field to set — log time instead:

```
op_log_time({
  workPackage: 291,
  hours: 1.25,                  // decimal hours, or "PT1H15M"
  spentOn: "2026-08-18",
  activity: "Development",
  comment: "What the time actually went on."
})
```

- The entry is **always attributed to the API key's own user**. OpenProject makes that field
  read-only, so you cannot log time for someone else. Do not try.
- Pass `activity` explicitly — `Management` is the instance default and is rarely the right one for
  work here. Valid values: Management, Specification, Development, Testing, Support, Other.
- The `comment` is the record of what was done. Write it as a sentence someone can read in a weekly
  review, the way the existing entries do — what changed and where, not "worked on task".
- **`hoursLedger` is a separate ledger.** `op_get_work_package` and `op_log_time` return a
  `hoursLedger.sheet` block from the local hours tool. It is reported alongside `spentTime`
  specifically so double-logging is visible. **Never sum the two.** If the sheet already holds the
  time, logging it again in OpenProject double-counts it.

### Assignee

Pass `assignee: "Demitri"` — a display name or login, matched case-insensitively, or a numeric id if
you have one. `responsible` (Accountable in the UI) takes the same forms.

`op_list_users` no longer needs `/api/v3/users`, which 403s on this key; it falls back to the
project's assignable list and reports which list answered in `source`. Groups are assignable too
(`g-InternalAI`, `g-Elevate215`) and resolve correctly.

A name that matches nothing, or more than one principal, fails with the candidates listed — so read
the error rather than guessing an id. Still name the owner in the description
(`**Owner** — Demitri.`); it is what existing packages do and it survives a field being cleared.

### Comments

Comments are the audit trail, and in this project they carry real weight — findings, measurements,
decisions that a description edit would erase. Use `op_comment_work_package`, not a description
rewrite, for anything that happened *during* the work.

```
op_comment_work_package({ id: 291, comment: "**Review done 2026-08-18.** …" })
```

Comment when you: start something that was blocked (say what unblocked it), finish a piece of
acceptance, land a measurement, or hit something that needs a decision you cannot make. Lead with a
bolded one-line verdict, then the detail. Read history with `op_list_activities({ id })` — note that
it returns bare field-change entries with empty `comment` strings alongside real comments.

## Closing out

1. Every acceptance condition is met, or the ones that are not are named explicitly. Half-met
   acceptance keeps the package **open** — see WP #62, held open on one of two conditions with the
   decision it needs written into a comment.
2. Time is logged.
3. A closing comment says what landed and where.
4. `op_update_work_package({ id, status: "Closed" })`. Use `Rejected` for work that will not be done,
   with a comment saying why.
5. Discovered work that came out of it exists as its own package, parented appropriately.

## Commits

Reference the package in the commit body — OpenProject parses these and links the commit:

- `refs #291` — touches the package
- `closes #291` — finishes it

## Gotchas

- **`description` on update replaces the entire body.** Read the current description first, or you
  will silently delete it.
- **`op_list_work_packages` defaults to open items in the default project.** Pass `status: "all"` to
  see closed ones, `project: "all"` to search across projects.
- **`activity` comes back `null`** from `op_list_time_entries` even on entries logged with one, so do
  not use that list to confirm the activity took. Verify in the web UI if it matters.
- **`customFields` is empty** on this project's packages, and the connector cannot write custom
  fields. If a field you need is not in the table above, it does not exist here — do not invent one.
- **No categories are defined on this project.** `category` is writable, but every value fails until
  an admin creates some in project settings.
- **Never read, print, or ingest `.env`.** Reference `OPENPROJECT_API_KEY` through the environment.
