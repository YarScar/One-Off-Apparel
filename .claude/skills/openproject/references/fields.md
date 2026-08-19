# Work package field reference

Everything here was read from the live instance (`projects.liftofflearning.tech`, project
`internal-ai-integrations`) on 2026-08-18, not from the API docs. Where the connector and the
underlying API disagree, the connector is what you actually have.

## The full GET payload

`op_get_work_package({ id })` returns exactly these keys. Anything not listed is not available
through the connector.

| Key | Example | Notes |
|---|---|---|
| `id` | `57` | The number used in `refs #57` |
| `subject` | `"B1 — Define the answer categories…"` | |
| `type` | `"Task"` | |
| `status` | `"In progress"` | |
| `project` | `"Internal AI Integrations"` | Display name, not the identifier |
| `parent` | `{ id: 56, title: "Phase B — …" }` | `null` at top level |
| `assignee` | `"Sean"` | **Name only — no id.** See "Assignee" below |
| `startDate` / `dueDate` | `"2026-08-03"` | `null` when unscheduled |
| `percentageDone` | `20` | `null` on summary tasks and unstarted work |
| `lockVersion` | `5` | Optimistic-locking counter, handled for you |
| `createdAt` / `updatedAt` | ISO 8601 | |
| `description` | markdown | |
| `priority` | `"High"` | Writable by name |
| `version` | `null` | Writable by name; unused in this project |
| `category` | `null` | Writable by name; **no categories defined on this project** |
| `responsible` | `"Bob"` | **Accountable** in the UI. Writable by name or id |
| `spentTime` | `"PT0S"` | ISO 8601 duration; aggregate of time entries. Read-only |
| `estimatedTime` | `"PT8H"` | This is the **Work** field. Writable |
| `remainingTime` | `"PT6H24M"` | This is **Remaining work**. Writable |
| `customFields` | `[]` | Empty on every package in this project; **not writable** |
| `hoursLedger` | `{ task, sheet }` | Local hours-tool ledger. **Never sum with `spentTime`** |

`op_list_work_packages` returns the slim view — it adds `priority` but omits `description`,
`estimatedTime`, `remainingTime`, `category` and `responsible`. Use `op_get_work_package` for those.

## Enumerated values

### Types — `op_list_types({ project })`

| id | Name | Milestone |
|---|---|---|
| 1 | Task | no |
| 2 | Milestone | yes |
| 3 | Summary task | no |

`Task` is the connector default. Settable on create and on update, by name.

### Statuses — `op_list_statuses()`

| id | Name | Closes |
|---|---|---|
| 1 | New | |
| 2 | In specification | |
| 3 | Specified | |
| 4 | Confirmed | |
| 5 | To be scheduled | |
| 6 | Scheduled | |
| 7 | In progress | |
| 8 | Developed | |
| 9 | In testing | |
| 10 | Tested | |
| 11 | Test failed | |
| 12 | **Closed** | ✅ |
| 13 | On hold | |
| 14 | **Rejected** | ✅ |

In practice this project uses `New` → `In progress` → `Closed`, with `On hold` for blocked work and
`Rejected` for work that will not happen. Status is passed **by name**, and the name must match
exactly.

### Priorities — `op_list_priorities()`

| id | Name | Default |
|---|---|---|
| 7 | Low | |
| 8 | Normal | ✅ |
| 9 | High | |
| 10 | Immediate | |

Passed **by name** to `priority` on create and update.

### Categories and versions

Categories are per project and **this project defines none** —
`GET /api/v3/projects/internal-ai-integrations/categories` returns an empty collection, so every
`category` value fails until an admin creates some. Versions do exist: `Bug Backlog`,
`Product Backlog`, `Sprint 1`, `Sprint 2`, passed by name to `version`.

Neither has a list tool. Passing an unknown name returns
`Unknown category "X". Available: …` — that error *is* the enumeration.

### Time-entry activities — `op_list_time_entry_activities()`

| id | Name | Default |
|---|---|---|
| 1 | Management | ✅ |
| 2 | Specification | |
| 3 | Development | |
| 4 | Testing | |
| 5 | Support | |
| 6 | Other | |

`op_log_time` accepts the name or the id. It defaults to Management, which is usually wrong for
engineering work — pass it explicitly.

## Durations

Work, Remaining work and Time Spent are all ISO 8601 durations on read: `PT8H`, `PT6H24M`, `PT30M`,
`PT0S` for zero. `op_log_time` accepts either form — `1.25` or `"PT1H15M"`. `op_list_time_entries`
returns both `hours` (ISO) and `hoursDecimal`, plus a `totalHours`, so no arithmetic is needed
downstream.

## The progress relationship

Work-based progress. Verified by **write test** on 2026-08-18, not just by arithmetic: sending
`estimatedTime: 10, remainingTime: 2.5` read back as

```
Work            PT10H     = 10.0h
Remaining work  PT2H30M   = 2.5h
% Complete      75                  = (1 − 2.5/10) × 100
```

Any **two** of the three determine the third. Sending all three is refused locally by the connector,
because OpenProject answers a mismatched triple with
`422 % Complete does not match Work and Remaining work`. Setting Work alone on a package with no
prior progress yields `Remaining work = Work` and `% Complete = 0`.

Practical rule: **set Work once, maintain `percentageDone`, read Remaining work back.** Summary tasks
show `percentageDone: null` — their progress is aggregated from children by OpenProject, so do not
write it onto a `Summary task` by hand.

## Assignee, and the 403 that no longer matters

`GET /api/v3/users` still answers `403 You are not authorized to access this resource` on this key.
It is no longer a blocker: `op_list_users` falls back to
`/api/v3/projects/<id>/available_assignees`, which needs only project membership, and reports which
list answered in `source`.

```
op_list_users()
→ { source: "/api/v3/projects/internal-ai-integrations/available_assignees",
    users: [ { id: 18, name: "Demitri", kind: "User" }, { id: 25, name: "g-InternalAI", kind: "Group" }, … ] }
```

12 assignable principals, including two groups. `assignee` and `responsible` accept a **display
name, a login, or an id**; matching is case-insensitive, exact-first then substring. A name matching
nothing or matching several fails with the candidates listed — read the error rather than guessing an
id. Groups resolve to `/api/v3/groups/:id`, so assigning `g-InternalAI` works (a bare `/users/:id`
href would not).

Still write `**Owner** — Demitri.` into the description. It is what existing packages do and it
survives the field being cleared.

## Raw API

There is no field on this project the connector cannot reach, so the escape hatch is only for things
outside the tool surface — deletes, custom-field definitions, project admin. HTTP Basic, username the
literal string `apikey`, password `OPENPROJECT_API_KEY` from the environment. **Never read, print, or
ingest `.env` itself.**

The authoritative source for what is writable is the instance's own form schema, which validates a
payload **without saving it**:

```
POST /api/v3/work_packages/<id>/form
{ "lockVersion": <current>, "estimatedTime": "PT5H" }
→ 200 with _embedded.payload echoing the derived values, and
       _embedded.validationErrors listing anything rejected
```

That is how the table above was verified. Use it before any scripted PATCH. API reference:
<https://www.openproject.org/docs/api/>

## Connector tool index

| Tool | Purpose |
|---|---|
| `op_list_projects` | Project identifiers |
| `op_list_work_packages` | Defaults to **open** items in the default project; `status: "all"`, `project: "all"`, `search` |
| `op_get_work_package` | Full detail, including the fields the list omits |
| `op_create_work_package` | `subject` required; `type`, `description`, `assignee`, `responsible`, `priority`, `estimatedTime`, `remainingTime`, `percentageDone`, `category`, `version`, `parent`, `startDate`, `dueDate`, `project`, `notify` |
| `op_update_work_package` | `subject`, `description`, `status`, `type`, `priority`, `assignee`, `responsible`, `estimatedTime`, `remainingTime`, `percentageDone`, `category`, `version`, `parent`, dates, `notify` |
| `op_comment_work_package` | Markdown comment |
| `op_list_activities` | Comments **and** bare field-change entries (empty `comment`) |
| `op_log_time` | `workPackage`, `hours` required; `spentOn`, `activity`, `comment` |
| `op_list_time_entries` | Filter by `workPackage`, `user: "me"`, `from`/`to` (both required together) |
| `op_list_types` / `op_list_statuses` / `op_list_priorities` / `op_list_time_entry_activities` | Valid names before an update |
| `op_list_users` | Assignable principals with ids; `project: "all"` for the instance-wide list |

`notify` is `false` by default on every writing tool. Leave it off unless a human needs the email.
