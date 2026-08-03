# Grant Writing Tools — Proposal

| Field | Value |
|---|---|
| Subject | A grant writing layer for the LP Internal AI platform |
| Prepared for | The project manager and the VP of Technology |
| Date | 2026-07-28 |
| Status | For review. Not yet approved. Not yet released. |
| Duration | Six weeks from approval |
| Decisions needed | Three. Refer to section 8. |
| Companion documents | `TAD.md` (architecture and security), `SPEC.md` (build detail) |

## 1 Summary

LaunchPad staff answer the same grant questions many times each year. Each funder asks for the same facts, but uses different words, a different length limit, and a different emphasis. Staff rewrite the same answers for each application. The work is slow, and the results are not consistent.

We propose a grant writing layer for the LP Internal AI platform. The layer changes a funder's application form into a draft answer package. Staff then review the draft, edit it, and submit the application. **The system never sends anything to a funder.**

A working prototype proves the method. It runs today, and it has produced complete draft packages for real funder applications. This proposal moves that proven method onto the platform, where staff can use it directly and where every data read is controlled and recorded. We are not testing an idea. We are productising one that works.

## 2 Scope

### 2.1 In scope

| Item | What it covers |
|---|---|
| The question bank | Our list of the questions that funders ask, with the recorded wording that each funder uses. |
| The knowledge base | Our store of approved answers. Each answer is written one time and used many times. |
| The three tools | The question matcher, the draft builder, and the answer fitter. Refer to section 3. |
| The drafting guidance | Our own guidance on how to write these applications, held inside the platform. |
| The figure checks | A required check of every number in a draft against live LaunchPad data. |
| Access control and audit | A permission record for each tool, and a log of every use. Refer to `TAD.md`. |

The scope is one path: **a funder's form in, a reviewable draft out.**

### 2.2 Out of scope

| Item | Why, and who owns it |
|---|---|
| Funder prospecting | Funder eligibility and fit scoring are a separate scope under the Data and Prospecting team. The prototype holds that logic and stays the record until that team writes its own plan. This layer can be offered to other teams for assistance, but this proposal does not use it. |
| Submission to funders | The layer has no send path, by design. A person always submits. |
| Moving the question bank into the platform database | Deferred. The data stays in files for now. Refer to section 8.3. |
| Sensitive source data | No customer records, transactions, student personal data, or transcripts come into the platform code. Refer to section 5. |

## 3 Deliverables

Six deliverables. Each one has a result that you can check for yourself.

| # | Deliverable | What it does | Complete when |
|---|---|---|---|
| 1 | The question bank and the knowledge base | Holds our questions and our approved answers. | The data loads with no warning. |
| 2 | The question matcher | Connects a funder's question to an entry in the question bank. | A funder question returns the correct entry. |
| 3 | The draft builder | Runs the whole path and returns a draft package with a figure check list. | A complete funder form returns a full draft package. |
| 4 | The answer fitter | Makes an answer shorter to meet a funder's length limit. | An answer above the limit comes back inside the limit. |
| 5 | The drafting guidance in the platform | Carries our craft into every draft, in the same form each time. | A person writes a good draft from the platform alone. |
| 6 | Access control, audit, and release | Puts the layer in front of staff, under permission and with a use log. | Staff use the layer on the platform and confirm the result. |

Deliverables 2, 3, and 4 each carry a test bar. The prototype has an automatic test suite, so we already know the bar: 45 tests cover this path. We do not call a deliverable complete until its tests pass. `SPEC.md` holds the test detail.

**Deliverable 1 is already built and checked.** It holds 87 questions, 11 categories, 29 approved answers, and 247 recorded funder wordings. The knowledge base is a prototype build. It is sufficient to go forward now, and it will be expanded once the Data team finalises its work.

## 4 How it works

1. Find the funder's application through the platform.
2. Record the funder's questions and length limits.
3. The draft builder matches each question, gets each answer, and counts each answer against its limit.
4. The tool marks each answer as "fits", "too long", or "needs a person".
5. The tool returns a list of figure checks. Staff run every check against live LaunchPad data.
6. Any answer that is too long goes to the answer fitter.
7. A person reads the draft, edits it, and submits the application.

Steps 3, 4, and 6 replace work that staff do by hand today. Step 5 protects us from a wrong number. Step 7 keeps a person in control.

The question matcher and the draft builder make sure that a question we have already answered, or a question we can answer easily, reaches the right stored answer. The answer fitter is the only place where the system writes text, and it writes only to meet a length limit. It never invents a fact or a figure.

## 5 Security and compliance

This section is a summary. `TAD.md` holds the full model, the controls, and the reasons.

| Concern | Our position |
|---|---|
| **Sensitive data does not get copied.** | The platform carries personal and company data. None of it comes into the grant code, and none of it enters the version history. We trust what the platform returns for a query. We do not cache or store any data that could raise a privacy concern. |
| **Every read is permission-checked.** | Each tool carries a permission record naming the roles that may use it. The platform refuses any tool without one. Access fails closed by design. |
| **Every read is recorded.** | The platform logs each use against the person who made it. |
| **The layer cannot widen its own access.** | The layer lists the data checks that a draft needs. It never runs them. Staff run each check under their own permissions, so restricted finance and donor data stays behind its own control. |
| **Restricted data degrades safely.** | If a person lacks the role for a figure, the draft says so. It never presents a stored figure as confirmed. |
| **A person always reviews.** | Every output is a draft. The layer has no path to a funder. |
| **Numbers carry their source and date.** | Every confirmed figure records where it came from and when we measured it. Refer to section 6. |

## 6 Data integrity commitments

These four rules are not negotiable. `TAD.md` holds the reasoning and the measured evidence.

1. **Live data beats a filed figure.** On a conflict, the newer number wins. An answer marked as not yet verified is a true unknown, and we never present it as confirmed.

2. **Some figures move every day.** Participant wages, for one, change daily, because the platform calculates earnings up to the current date. A stored figure was recently about $12,000 below the live figure. No number is ever permanently confirmed. Every confirmed figure therefore carries its source and its measurement date, and we re-check any figure measured more than three days before submission.

3. **Two correct figures reach a person.** Some pairs of numbers are both right, because each counts a different group. The layer must never choose silently between them. It escalates.

4. **New framing replaces old framing.** Text describing a retired programme model must never enter a new draft.

## 7 Timeline

Six weeks from approval. Five milestones.

| Week | Milestone | Delivers |
|---|---|---|
| 1 | Preparation and access setup | Deliverable 1 verified. Permission records in place. |
| 2 | The question matcher | Deliverable 2 |
| 3 to 4 | The draft builder | Deliverable 3. **This is the main benefit.** |
| 5 | The answer fitter and the drafting guidance | Deliverables 4 and 5 |
| 6 | Release and a pilot on one real application | Deliverable 6 |

Staff get the largest part of the value at the end of week 4. A complete draft package for any funder form is the core of the work. Weeks 5 and 6 add the length handling, the drafting quality, and the release.

One risk can move these dates. The question matcher rebuilds a text-comparison function that our platform language does not supply. We schedule it in week 2 for that reason: a problem found in week 2 costs two weeks, and the same problem found in week 5 costs five. Refer to section 9.

## 8 Decisions needed

### 8.1 Approve a platform configuration change, and name an owner

Our design requires every read of the Development teamspace in Notion to arrive through the platform, so that each read is permission-checked and recorded. That rule works only if the platform copies the Notion sources we need. It does not copy them today. We tested this and confirmed the gap.

**Updated 2026-07-29.** Two things changed since this section was written.

- **The Playbook is no longer part of the ask.** It is now held in our own package, under version control, which is where our design wanted it anyway. That removes the harder half of this request: the Playbook is a page rather than a database, and the platform's copy process reads databases only, so it would have needed code and not configuration.
- **What remains is genuinely configuration.** Add the Grant Applications database, and a Research Wiki database that our drafting guidance also depends on, to the platform's copy list and run the copy again. `TAD.md` holds the evidence and `SPEC.md` holds the identifiers.

**This is platform work, not grant work, so it still needs an owner.** Until it is done, any teamspace fact in a draft is unsourced and a draft must say so rather than assert it. This is the only external dependency in the plan, and it no longer holds up our own build — we removed it from the week 1 gate so that the work below it could proceed.

### 8.2 Approve who may use the grant tools

Every tool on this platform needs a permission record. Without one, the platform refuses the tool for every user. This is the correct behaviour, and it makes the decision mandatory rather than optional.

**Our recommendation:** the leadership and administrator roles. The existing grant writing skill already uses those roles, plus finance.

One related question needs an answer at the same time. The platform keeps a separate list of tools that automatic background jobs may run. Decide whether a background job may run the grant tools. If the answer is no, we change nothing — the default already refuses.

### 8.3 Confirm that the data stays in files for now

The question bank and the knowledge base sit in files today. The end state is to hold them in the platform database. That change costs work and delivers nothing new by itself.

**Our recommendation:** keep the files until the tools pass their test bar, then review. This also keeps the first build small.

## 9 Risks

| Risk | Effect | Control |
|---|---|---|
| A text-comparison function must be rebuilt for our platform language. | A different result changes every match. This is the largest technical risk. | Build it first, in week 2, and prove it against the 13 existing tests before anything is built on top. |
| The platform configuration change is not made. | The drafting guidance cannot reach the platform. Teamspace facts stay unsourced. | Section 8.1. Name an owner at approval. |
| A figure in a draft is out of date. | An application understates our results or states a wrong number. | Section 6. Check every figure, and record the date of each check. |
| Two correct figures reach a draft and the layer picks one. | An application misrepresents a population. | Section 6. The layer escalates. It never chooses. |
| Something reaches a funder without review. | Serious reputational harm. | Section 5. The layer has no send path, and every output is a draft. |
| A grant tool reads restricted finance or donor data. | Restricted data passes its access control. | Section 5. The layer lists data checks. It never runs them. |

## 10 Terms

| Term | Meaning |
|---|---|
| Funder | An organization that gives grant money. |
| Question bank | Our list of the questions that funders ask. |
| Knowledge base | Our store of approved answers. |
| Figure | A number in an answer, such as total participant wages. |
| Tool | A single function that the platform makes available. |
| Teamspace | The Development teamspace in Notion. It holds the record of our applications. |
| Playbook | Our Grant Writing Playbook. It holds our drafting guidance. |
| Prototype | The working program that proves this method. |

## 11 The document set

| Document | Read it for | Audience |
|---|---|---|
| `PROPOSAL.md` | This document. Scope, deliverables, timeline, decisions. | The project manager, the VP of Technology, and any stakeholder |
| `TAD.md` | The architecture, the security and compliance model, and the data governance rules. | The VP of Technology |
| `SPEC.md` | The build detail and the release gates. | The developer who does the work |
| `README.md` | The guide to the folder. | Anyone who opens the folder |

This document follows ASD-STE100 Simplified Technical English: short sentences, active voice, and one meaning for each term. Refer to https://www.asd-ste100.org/. Proper names keep their exact form.
