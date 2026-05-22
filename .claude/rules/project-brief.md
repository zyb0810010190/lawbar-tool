## project-brief — Authority, downstream consumption, conflict handling

This rule governs `docs/product/project-requirements-brief.md` (the "brief") and how the rest of the workflow consults it. The skill that produces the brief is `.claude/skills/project-brief/SKILL.md`; the slash command is `/project-brief`.

## Authority hierarchy

When two sources disagree on product direction, prefer the higher entry in this list:

1. **Reviewed ADRs under `docs/adr/`** that are not marked superseded — authoritative for the technical decision they document.
2. **`docs/product/project-requirements-brief.md` with status `READY`** — authoritative for whole-project product direction not yet captured in any ADR.
3. `docs/product/product-target-architecture.md` — authoritative product-summary pointer until the brief reaches `READY`; afterward, the brief is the canonical intake and the architecture summary becomes a derived view.
4. `dev-memo/plan-client-00.md` — client-surface reconciliation source; remains valid until folded into the brief.
5. Brief with status `DRAFT-PENDING-REVIEW` or `AMENDMENT-PENDING-REVIEW` — non-authoritative INPUT to cc-suite review; never used to override ADRs.
6. spark specs under `dev-memo/spark/` — non-authoritative; never override anything.

Item 1 ranks above item 2 deliberately: a reviewed ADR has already been through `/cc-suite:review-plan` and represents a locked technical decision. If the brief wants to change an ADR-locked decision, the brief logs `RECONCILIATION-NEEDED`; the ADR is changed only by a follow-up WI that itself runs through cc-suite review-plan.

## Hard prohibitions

The project-brief skill MUST NOT:

- Edit any file under `docs/adr/**`, `services/**`, `docs/contracts/**`, or `dev-memo/plan-*.md`. The brief is intake; downstream WIs do the editing.
- Edit `docs/product/product-target-architecture.md`. If the brief supersedes the product summary, that supersession is recorded in the brief's frontmatter and resolved by a follow-up reconciliation WI, not by silent overwrite.
- Stage, commit, or push.
- Invoke `/cc-suite:review-plan`, `/cc-suite:audit`, `/cc-suite:verify`, or any cc-suite slash command. The user runs them.
- Run inside `/project-autopilot`, `/loop`, or any unattended loop.
- Default-on any answer that triggers a [[autonomy]] hard-stop. Hard-stop items in §20 MUST come from explicit user input.

## cc-suite review focus

When the user runs `/cc-suite:review-plan docs/product/project-requirements-brief.md`, the reviewer evaluates:

1. **Internal consistency** — sections 1-20 must not contradict each other. Example: §3 "Mac primary" cannot coexist with §13 "browser-first multi-tenant".
2. **Consistency with reviewed ADRs and product docs** — every conflict the brief surfaces in its `Reconciliation log` is acknowledged; nothing is silently overridden. Reviewer flags MISSING reconciliation entries (brief contradicts an ADR but didn't log it).
3. **Scope creep** — v1 day-one list (§18 must-haves) is bounded; ambitious post-v1 items are clearly separated; deferred items don't drift into day-one by accident.
4. **Unsafe external-data assumptions** — any cloud, sync, LLM, multi-tenant, public-network surface is explicit, opt-in, and not assumed-on. The brief MUST default-respect [[client-local-first]].
5. **Hard-stop clarity** — §20 items are unambiguous STOP-AND-ASK decisions (auth provider, cloud vendor, key custody, real-data migration, public deployment, secret material, new runtime deps). Vague items are flagged.
6. **Promotion safety** — the brief does not authorize any concrete WI by existing. The "Suggested follow-up WIs" list is suggestions, not pre-approvals.

Reviewer verdict patterns:

- `READY` — brief may be promoted to authoritative; frontmatter `status:` flips to `READY` in the next commit.
- `READY (Low-risk clarifications)` — brief may be promoted as-is; clarifications recorded but non-blocking.
- `NEEDS-FIX` — Critical or High findings; brief stays `DRAFT-PENDING-REVIEW` until fixed and re-reviewed.
- `NEEDS-RECONCILIATION` — Reconciliation log has unresolved entries that block promotion; user opens a follow-up reconciliation WI before re-review.

## Downstream consumption rules

### spark (`.claude/skills/spark/SKILL.md`, [[spark]])

- spark's Step 1 grounding MUST read `docs/product/project-requirements-brief.md` when the file exists.
- spark MUST surface the brief's `status:` in the spark spec's §2 "Existing context used".
- If the brief is `DRAFT-PENDING-REVIEW` or `AMENDMENT-PENDING-REVIEW`, spark may still consult it but MUST note its non-authoritative status.
- spark MUST NOT ask whole-project questions answered by the brief. If a spark idea conflicts with a `READY` brief, the spec's §8 "Hard stops" lists the conflict and §10 prepends the HARD STOP block.

### WI plans (`dev-memo/plan-*.md`)

- New WI plans MUST cite `docs/product/project-requirements-brief.md` in their "Existing context used" / "Sources" section when the file exists.
- A WI plan that contradicts a `READY` brief is NOT eligible for `/cc-suite:review-plan` until either the WI scope is narrowed to align OR a reconciliation WI updates the brief (and the brief is re-reviewed to `READY` again).

### project-autopilot (`.claude/skills/project-autopilot/SKILL.md`, [[../skills/project-autopilot/SKILL]])

- The autopilot loop's "Read plan corpus" step MUST include `docs/product/project-requirements-brief.md` when present.
- BEFORE selecting the next WI, autopilot MUST check: does the candidate WI conflict with the brief? Conflict triggers a stop. The stop reason is `BRIEF-CONFLICT` and the report names the conflicting section.
- Autopilot MUST NOT run `/project-brief` itself. If a WI requires the brief and the brief is missing, autopilot stops and asks the user to run `/project-brief` manually.

### client-architecture-reconcile

- When the brief logs `RECONCILIATION-NEEDED` and the user wants to resolve it by updating an ADR or product doc, the resolution path is a docs-only WI that uses [[../skills/client-architecture-reconcile/SKILL]] for the reconciliation pass, then runs cc-suite review-plan on the resulting ADR diff.

## Conflict handling — brief disagrees with an existing source

If the brief's answer in section N disagrees with `docs/adr/<file>.md` or `docs/product/product-target-architecture.md` or any other authoritative source:

1. The brief logs the conflict in its `Reconciliation log` (section number, conflicting source path, prior wording, brief's new wording, proposed resolution).
2. The conflicting source is **not** silently edited.
3. The brief's `Suggested follow-up WIs` proposes a bounded reconciliation WI.
4. cc-suite review-plan flags the brief as `NEEDS-RECONCILIATION` until the user either:
   - Opens the reconciliation WI, gets it through review-plan, and merges the ADR update; or
   - Explicitly accepts the divergence as a known gap, recorded in the brief's `Reconciliation log` with `RESOLUTION: accepted-as-known-divergence` and the user's acknowledgement.

## Status lifecycle

```
(no brief)
   │ /project-brief
   ▼
DRAFT-PENDING-REVIEW
   │ /cc-suite:review-plan returns READY
   ▼
READY  ←─── (authoritative)
   │ /project-brief amendments
   ▼
AMENDMENT-PENDING-REVIEW
   │ /cc-suite:review-plan returns READY
   ▼
READY (revised)
```

Status flips happen in a normal commit (status field edited by hand or by a follow-up turn), gated by the cc-suite review verdict. The project-brief skill itself NEVER flips status to `READY` — only a post-review commit does that.

## File policy

- `docs/product/project-requirements-brief.md` — the brief. Single file. Always lives at this path.
- `docs/product/product-target-architecture.md` — pre-existing product summary. The brief either confirms it (no Reconciliation entry) or supersedes it (Reconciliation entry + follow-up WI to align).
- No multi-file split. No `docs/product/project-brief/` subdirectory. One canonical doc.

## Commit policy for brief outputs

The brief file is workflow / documentation artifact. It MAY be committed alone via explicit staging per [[staging-hygiene]]. It MUST NOT be committed in the same commit as product code. Commit message convention: `docs: <add | update> project requirements brief` (status flip commits use `chore: promote project brief to READY` and include only the status field flip).

The skill itself does NOT commit. The user (or a follow-up turn) commits when ready.

## Conflict with existing skills

- `/spark` — spark is for per-feature brainstorming. project-brief is for whole-product direction. If a user request reads like "the entire product direction", prefer `/project-brief`. If it reads like "this one feature", prefer `/spark`.
- `client-architecture-reconcile` — for reconciling two existing docs. project-brief is for capturing the user's intent; reconciliation is the follow-up.
- cc-suite commands — never replaced. The brief is INPUT to `/cc-suite:review-plan`, never an output of cc-suite.

## References

- [[cc-suite]] — authoritative review broker.
- [[autonomy]] — hard-stop list.
- [[client-local-first]] — v1 client posture; pre-fills brief defaults.
- [[spark]] — spark must consult the brief when it exists.
- [[security-boundary]] — security-sensitive scopes; the brief's §15 surfaces compliance + threat model.
- [[staging-hygiene]] — commit discipline.
- [[loc-guardian]] — orthogonal; the brief is a doc, not a hand-source file.
- `.claude/skills/project-brief/SKILL.md` — skill body.
- `.claude/commands/project-brief.md` — slash command surface.
- `dev-memo/project-brief-00.md` — design rationale.
