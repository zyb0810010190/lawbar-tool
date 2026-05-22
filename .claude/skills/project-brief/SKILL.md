---
name: project-brief
description: One-shot project requirements intake. Asks structured product-level questions ONCE, pre-fills from existing repo context, and writes the consolidated brief to docs/product/project-requirements-brief.md. Does NOT implement code, does NOT modify ADRs, does NOT replace cc-suite. Promote via cc-suite review-plan before the brief becomes authoritative.
---

# project-brief — Project-level requirements intake

## What project-brief IS

A focused, one-shot interview that captures the **entire product direction** the user holds in their head and persists it as a single canonical document at `docs/product/project-requirements-brief.md`. Future spark specs, WI plans, ADRs, and autopilot decisions consult that document instead of re-asking the user the same whole-project questions every turn.

## What project-brief IS NOT

- **NOT an implementation skill.** Writes one Markdown doc and stops.
- **NOT an ADR editor.** When the brief disagrees with an existing ADR or product doc, the skill marks the conflict `RECONCILIATION-NEEDED` in the brief itself and lists the conflicting source(s). It does NOT silently rewrite ADRs.
- **NOT a cc-suite replacement.** The brief becomes authoritative ONLY after `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain) per [[../../rules/cc-suite]].
- **NOT a drip interview.** All twenty question sections are presented in ONE consolidated turn. The user replies with one long answer. The skill MUST NOT spread the interview across multiple turns.
- **NOT a spark replacement.** spark is for per-feature brainstorming. project-brief is for whole-product direction. Triggers and outputs differ — see [[../spark/SKILL]].
- **NOT a hard-stop bypass.** Decisions surfaced in the brief that would trigger any [[../../rules/autonomy]] hard-stop (auth provider, cloud vendor, new runtime deps, public deploy, etc.) are recorded as `STOP-AND-ASK` decisions in §20 and NOT executed by any downstream workflow.
- **NOT an autopilot participant.** project-brief does NOT run inside `/loop`, `/project-autopilot`, or any unattended loop. User-invoked only.

## When to use project-brief

- User typed `/project-brief`.
- User says "let me state the full project requirements once."
- The repo's product direction is fragmented across many dev-memos / ADRs / plans and the user wants a single canonical intake.

Do **not** invoke project-brief for:

- Per-feature brainstorming → use [[../spark/SKILL]].
- Implementing one bounded WI → use the normal plan → cc-suite → implement flow per [[../../rules/cc-suite]].
- ADR reconciliation between two existing docs → use [[../client-architecture-reconcile/SKILL]].
- Audit / verify / review of existing code or plans → use the relevant `/cc-suite:*` slash command.

## Workflow

### Step 1 — Ground in repo context FIRST

Before asking any question, read:

- `AGENTS.md` and any `CLAUDE.md` / `GEMINI.md` it imports.
- `docs/product/` — especially `product-target-architecture.md` (current authoritative product summary).
- `docs/adr/` — index every ADR by file name; read the ones that touch product direction (client surface, sync, sandbox, persistence boundary, LLM policy, audit log, privilege, deadlines, multi-user readiness, etc.).
- `dev-memo/plan-client-00.md` — current client-surface reconciliation status.
- `dev-memo/superseded/` — at least skim file names so the skill knows what has been retired.
- Recent commits via `git log --oneline -50`.
- `.claude/rules/client-local-first.md` — locked v1 client posture.
- `.claude/rules/autonomy.md` — hard-stop list (informs §20 of the brief).

If the answer is already in the repo, USE it as a **pre-filled default**. Do not re-ask. Cite the source path inline.

### Step 2 — Detect prior brief

- If `docs/product/project-requirements-brief.md` already exists, READ it.
- Treat it as the prior intake. Pre-fill each section with the prior answer. The interview becomes a "confirm / amend" pass, not a fresh intake.
- If the prior brief has status `READY` (i.e., cc-suite-reviewed and authoritative), warn the user and ask whether they want to:
  - Open an amendment (write to `docs/product/project-requirements-brief.md` with status `AMENDMENT-PENDING-REVIEW`), or
  - Cancel and stop.

### Step 3 — Present the single consolidated interview

Use `AskUserQuestion` ONCE with the full twenty-section template below, OR present the template as a structured Markdown block the user can copy-paste-and-edit. Pick whichever is friendlier for the volume — twenty sections is too many for the `AskUserQuestion` 4-question limit, so prefer the copy-paste-and-edit Markdown approach.

For each section, supply:
- A short heading + one-sentence prompt.
- The pre-filled default from §Step 1 (or "(no prior answer in repo)" if none).
- One example answer to anchor the format.

The twenty sections, in order:

1. **Product vision** — one paragraph: what does the product DO, for whom, why now.
2. **Target users** — primary, secondary, explicitly excluded.
3. **Primary platform** — Mac desktop / WeChat mini-program / browser / other; rank.
4. **Mac app expectations** — install path, offline behavior, native conventions, packaging.
5. **WeChat mini-program expectations** — read-only / minimal write, what surfaces are exposed, what stays Mac-only.
6. **Local-first / cloud / sync expectations** — default storage location, sync triggers, opt-in granularity.
7. **Legal workflow and case management requirements** — case (matter) lifecycle, facts, issues, claims, elements, evidence, deadlines, privilege, audit.
8. **OCR requirements** — input formats, accuracy bar, engine choice, error surfacing, retry/dead-letter visibility.
9. **Document and evidence workflows** — ingestion, citation binding, redaction, export.
10. **Deadlines and docketing** — input source, computation rules, reminder model, escalation.
11. **Confidentiality / privilege / audit expectations** — privilege markers, audit-log shape, who-saw-what, tamper-evidence.
12. **AI / LLM boundaries** — what AI may do, what it MUST NOT do, on-device vs hosted, prompt-leak protections, fact-extraction policy.
13. **Collaboration / multi-user expectations** — single-lawyer-only / firm-staff-on-behalf-of-lawyer / true multi-user; auth model implications.
14. **Export / backup / archive** — formats (PDF, signed bundle, plain text), destinations, retention.
15. **Security / compliance** — threat model, key compliance regimes (e.g., 律师法 confidentiality, GDPR if any), security boundary (per `.claude/rules/security-boundary.md`).
16. **Deployment / distribution** — how the user installs/updates the Mac app; signing; auto-update policy.
17. **Business model if relevant** — pricing, licensing, free-tier, firm vs solo.
18. **Must-have vs later features** — v1-day-one list / v1-acceptable-deferred list / post-v1 list.
19. **Explicit non-goals** — framings to reject (browser-first / multi-tenant SaaS / WeChat-primary / etc.).
20. **Hard-stop decisions** — items the user wants to mark explicitly STOP-AND-ASK regardless of any other workflow (auth provider choice, cloud vendor choice, key custody, real-data migration, public deployment, secret material handling, etc.).

### Step 4 — Receive the user's consolidated answer

Wait for ONE reply that addresses all twenty sections. If the user asks to defer a section, allow `DEFERRED — (reason)` as the answer and proceed. Do NOT iterate by re-asking section-by-section.

If the user only answers a subset and asks to ship the partial brief, mark un-answered sections as `DEFERRED — pending follow-up`. Proceed.

### Step 5 — Detect conflicts with existing ADRs / product docs

For each answered section, scan the repo files listed in §Step 1. If the brief's answer disagrees with any of them:

- Append a `RECONCILIATION-NEEDED` entry to the brief's §"Reconciliation log" (see §"Brief template" below) naming the section, the conflicting source path, the prior wording, and the new wording.
- Do NOT modify the conflicting source. ADR mutations are out of scope for this skill.
- Suggest a follow-up reconciliation WI (e.g., `WI-brief-reconcile-<topic>`) in the brief's §"Suggested follow-up WIs".

### Step 6 — Write the brief

Output path: `docs/product/project-requirements-brief.md`.

Create the `docs/product/` directory if it does not exist (it already does in this repo as of 2026-05-21).

Frontmatter:

```
---
status: DRAFT-PENDING-REVIEW          # or AMENDMENT-PENDING-REVIEW if prior READY brief existed
date: YYYY-MM-DD                       # absolute date, today
author: project-brief skill (run by Claude Code on user direction)
authoritative_after: /cc-suite:review-plan returns READY (or only Low-risk clarifications remain)
supersedes: (prior brief if any; otherwise omit)
---
```

Body sections (every one required, in order):

1. **Status banner.** One sentence: "This brief is NOT authoritative until cc-suite review-plan returns READY per `.claude/rules/cc-suite.md`."
2. **One-paragraph summary** of the product.
3. **Answers to sections 1-20** — verbatim from the user's consolidated reply, with the skill's pre-filled defaults visible where the user accepted them.
4. **Reconciliation log** — list of `RECONCILIATION-NEEDED` entries from §Step 5. Each entry: section number, conflicting source file path, prior wording (1-2 lines), brief's new wording (1-2 lines), proposed resolution.
5. **Sources consulted** — bullet list of every file path the skill read in §Step 1.
6. **Suggested follow-up WIs** — bounded WI suggestions (max 5) the user may open after the brief is reviewed. Format: `WI-brief-<short>: <one-sentence scope>`.
7. **Hard-stop decisions** — verbatim restatement of §20 answers, formatted as a STOP-AND-ASK checklist autopilot will consult.
8. **Required cc-suite review** — verbatim block (see §"Required cc-suite review" below).
9. **Stop condition** — how the brief becomes "stale" (e.g., "Superseded when a later brief raises `supersedes: ...`", "Stale when product pivot lands").

### Step 7 — Stop

Report the path written and the next bounded action. Do NOT:

- Invoke `/cc-suite:review-plan` automatically.
- Modify any ADR or other doc.
- Commit the brief (the user runs `commit-gate` per [[../../rules/staging-hygiene]]).
- Implement anything.

Recommended next user action: `git add docs/product/project-requirements-brief.md && /cc-suite:review-plan docs/product/project-requirements-brief.md`.

## Required cc-suite review (§8 of every brief)

The brief MUST embed this block verbatim:

```
## Required cc-suite review

This brief is not authoritative until:
1. /cc-suite:review-plan docs/product/project-requirements-brief.md returns READY
   (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the brief is re-reviewed.
3. Each RECONCILIATION-NEEDED entry has either been resolved
   (via a follow-up WI that updates the conflicting ADR/doc) or explicitly
   accepted as a known divergence by the user.
4. Each STOP-AND-ASK item in §"Hard-stop decisions" has been seen
   and acknowledged by the user.

Review focus per .claude/rules/project-brief.md §"cc-suite review focus":
- Internal consistency across the twenty sections.
- Consistency with existing ADRs and product docs (any drift goes into
  the Reconciliation log, not silent override).
- Scope creep (v1 day-one list vs deferred list vs post-v1).
- Unsafe external-data assumptions (cloud / sync / LLM / multi-tenant).
- Hard-stop clarity (§20 items must be unambiguous STOP-AND-ASK decisions).
```

## Hard prohibitions

project-brief MUST NOT:

- Edit `docs/adr/**`, `services/**`, `docs/contracts/**`, or any file under `dev-memo/` other than (optionally) the design dev-memo `dev-memo/project-brief-00.md` if the user explicitly authorizes a design update.
- Stage, commit, or push anything. The user runs `commit-gate`.
- Invoke `/cc-suite:review-plan`, `/cc-suite:audit`, or `/cc-suite:verify`. The user runs them.
- Run inside `/project-autopilot`, `/loop`, or any unattended loop. If the autopilot loop encounters a WI that "needs the brief", autopilot stops and asks the user to run `/project-brief` manually.
- Ask multiple rounds of questions. ONE consolidated interview, ONE consolidated reply.
- Default-on any answer that triggers a [[../../rules/autonomy]] hard-stop. Hard-stop answers MUST be explicit user input.

## References

- [[../../rules/project-brief]] — authority + cc-suite review focus + downstream consumption rules.
- [[../../rules/cc-suite]] — authoritative review broker policy.
- [[../../rules/autonomy]] — hard-stop list; informs §20.
- [[../../rules/client-local-first]] — v1 client posture; pre-fills §3-§6.
- [[../../rules/spark]] — spark must consult the brief when it exists.
- [[../../rules/staging-hygiene]] — explicit-staging commit discipline.
- [[../spark/SKILL]] — per-feature brainstorming counterpart.
- [[../project-autopilot/SKILL]] — autopilot stops if a planned WI conflicts with the brief.
- [[../client-architecture-reconcile/SKILL]] — for resolving ADR ↔ brief conflicts after review.
- `docs/product/product-target-architecture.md` — current authoritative product summary; the brief either confirms or supersedes it.
- `dev-memo/project-brief-00.md` — design rationale for this skill.
