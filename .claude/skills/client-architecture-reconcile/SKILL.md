---
name: client-architecture-reconcile
description: Use when client-surface, gateway, sync, or product-direction docs disagree. Resolves via plan-client-00 D2 answers; only asks user when defaults do not resolve. Docs-only output.
---

# client-architecture-reconcile

Workflow for reconciling conflicting client / gateway / sync ADRs and plans against the locked product direction in `dev-memo/plan-client-00.md`. Output is **docs-only** — no code changes.

## Trigger

Use when any of the following hold:

- A new or existing doc under [[../../rules/client-local-first]] applies-to scope conflicts with another.
- A WI requires picking among client surfaces (desktop / mini-program / browser / HTTP API).
- An ADR mentions auth provider, cloud vendor, or public deployment mode in a v1 context.
- The user asks for a "decision on the client" / "gateway shape" / "sync model".

## Preconditions

- `branch-clean` returned SAFE / DIRTY-RECOVERABLE.
- `dev-memo/plan-client-00.md` is readable.

## Steps

### 1. Discover

- Read `dev-memo/plan-client-00.md` §1 (D2 answers — authoritative).
- Read all conflict-candidate docs under [[../../rules/client-local-first]] applies-to:
  - `docs/ui/*.md`
  - `docs/adr/*client*`, `*gateway*`, `*sync*`
  - `dev-memo/plan-client-*.md`, `dev-memo/case-box-plan.md`
- Build a posture matrix per doc: primary client / data default / cloud posture / mini-program role / auth posture / HTTP-gateway role.

### 2. Detect conflicts

- Compare each doc's posture vector against the locked direction in [[../../rules/client-local-first]].
- Flag every divergence with severity:
  - **Hard conflict** — doc asserts a forbidden v1 framing (multi-firm SaaS / browser-first / default-on cloud / WeChat-primary / public HTTP API).
  - **Soft drift** — doc uses framing compatible with locked direction but ambiguous (e.g. "API" without local-loopback qualifier).
  - **Stale** — doc predates `plan-client-00.md` and is not yet reconciled.

### 3. Resolve via defaults

For each conflict, apply this resolution order:

1. **D2 answer in `plan-client-00.md`** wins. Cite the row.
2. **[[../../rules/client-local-first]] forbidden-framings list** vetoes a doc's assertion.
3. **Smallest doc edit that removes the conflict** is preferred — do not rewrite ADRs wholesale.
4. **Reject** an ADR only when there is no edit that reconciles it; in that case, propose a successor ADR that supersedes it.

### 4. Ask only if defaults do not resolve

Ask the user **only** when:

- A conflict cannot be resolved by D2 + forbidden-framings + smallest-edit.
- The conflict raises a new product question not answered in `plan-client-00.md`.
- An auth-provider or cloud-vendor question surfaces (these are hard-stop in [[../../rules/autonomy]]).

Otherwise, proceed without asking.

### 5. Draft reconciliation plan

- Write a short plan section under `dev-memo/plan-client-00.md` (or successor) listing each doc + the edit that reconciles it.
- For each edit, capture: source citation (D2 row / rule line), edit summary, files touched.

### 6. Review plan

- `/cc-suite:review-plan` on the reconciliation plan. (Slash command, NOT a Skill — never invoke via `Skill(cc-suite:review-plan)`. See [[../../rules/cc-suite]]. Reconciliation is docs-only and typically low-risk — self-review fallback is allowed per the cc-suite rule §"Low-risk WIs", provided the fallback is recorded.)
- Fix review findings.

### 7. Apply edits

- Make the minimal doc edits identified in step 5.
- **Docs only.** No code, no test, no schema, no contract change.
- If an ADR needs supersession, mark it `Status: Superseded by <new-ADR>` rather than deleting.

### 8. Commit gate

- Run [[../../commands/commit-gate]].
- Stage only the touched doc files (`docs/**`, `dev-memo/**`).
- Commit message: `docs: reconcile <doc-list> against plan-client-00`.

## Output

A single docs-only commit (or a small number of focused commits) leaving every doc under the client-local-first scope consistent with the locked direction. No code change.

Related skills: [[../security-wi-loop/SKILL]], [[../project-autopilot/SKILL]].
