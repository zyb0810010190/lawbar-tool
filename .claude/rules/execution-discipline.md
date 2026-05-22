# Execution Discipline

Behavioral floor for every implementation WI in this repo. This rule is a
**floor**, not a ceiling and not a bypass — every other authoritative rule
still applies. See §"Relationship to existing rules" below for the
authority hierarchy.

## Attribution

The four principles below are adapted from the **andrej-karpathy-skills**
repository:

- Upstream: https://github.com/forrestchang/andrej-karpathy-skills (may
  redirect to https://github.com/multica-ai/andrej-karpathy-skills).
- License: MIT (per upstream).
- Inspiration: Andrej Karpathy's published observations on persistent
  LLM coding failures — wrong-assumption-then-charge-ahead,
  overcomplication, drive-by edits to code the model doesn't understand.

Only the principles are adapted here. **The plugin is NOT installed**;
**no global `~/.claude` files are modified**; **no upstream CLAUDE.md is
appended wholesale**. The text below is rewritten to fit this repo's
existing workflow (cc-suite broker, project-autopilot loop, spark /
project-brief intake, rollback / night-run policies, loc-guardian
budget).

---

## §1 Think before coding

Before ANY code edit on a non-trivial WI:

1. **Confirm the active WI scope**. Read the reviewed plan (`dev-memo/plan-*.md`
   or `dev-memo/spark/*.md` promoted via the spark workflow), the parent
   plan, and the umbrella plan if one exists. Restate the WI's exact
   target files, acceptance criteria, and out-of-scope list before
   writing any code.
2. **State assumptions explicitly**. If the plan's review packet leaves a
   load-bearing fact under-specified, surface it before coding. Don't
   silently pick one interpretation.
3. **Identify hard stops**. Cross-check the WI against `.claude/rules/autonomy.md`
   §"Hard-stop list" + the active lane authorization (if overnight mode)
   per `dev-memo/night-run-00.md`. If the WI would trigger a hard stop,
   stop and ask the user before coding.
4. **Route ambiguity to the right channel**:
   - Product / architecture ambiguity → use `/project-brief` (whole
     product) or `/spark` (single feature) per the [[spark]] rule and
     [[project-brief]] rule. NOT ad-hoc clarifying questions during
     impl.
   - Plan-shape ambiguity → request `/cc-suite:review-plan` BEFORE
     coding per [[cc-suite]] §"High-risk WIs".
   - Code-level uncertainty inside a READY plan → ask ONE targeted
     question, or proceed with the smallest reversible slice and let
     cc-suite audit catch drift.
5. **Don't ask questions already answered by**:
   - `docs/product/project-requirements-brief.md` (if status is `READY`).
   - Reviewed ADRs under `docs/adr/`.
   - The reviewed plan corpus under `dev-memo/`.
   - The contract package under `docs/contracts/` (vocabulary owner).
   - The conformance harness under `services/case-box-persistence/tests/conformance/`.

Quoting Karpathy: "The models make wrong assumptions on your behalf and
just run along with them without checking." This section exists to
prevent that.

## §2 Simplicity first

The smallest slice that satisfies the reviewed plan IS the right slice.

**Do**:

- Implement exactly what the WI plan §"Acceptance criteria" requires.
- Reuse existing helpers, types, fixtures, and validators rather than
  rewriting them.
- Mirror established patterns (e.g., B1's matterRepoQueries.ts → B2's
  documentRepoQueries.ts) rather than inventing new abstractions.
- When LOC guardrails require extraction per `.claude/rules/loc-guardian.md`,
  keep the extraction **mechanical and narrow** — move SQL helpers to a
  sibling file with the same shape as the precedent, not into a new
  abstraction layer.

**Don't**:

- Add features beyond the WI plan.
- Build speculative abstractions ("we might need this in B5...").
- Introduce future-proofing unless the reviewed plan explicitly
  authorizes it.
- Add configuration knobs, plugin points, or extension hooks the plan
  did not call for.
- Generalize a working concrete function into a generic one "just in
  case." Two similar lines beats one generic abstraction.

Senior-engineer test: would a careful reviewer call this
overcomplicated? If yes, simplify before the audit catches it.

## §3 Surgical changes

The WI's authored file list is the ONLY edit boundary.

**Always**:

- Touch only files in the WI plan's "Exact target files" list. If a
  required edit lies outside, stop and either (a) update the plan
  (which requires cc-suite review-plan re-pass for high-risk WIs) or
  (b) open a bounded follow-up WI.
- Match existing style — naming conventions, JSDoc shape, error-message
  format, import ordering — even when you would code differently.
- Remove dead code **created by this WI** (e.g., a helper you wrote
  then realized was unused).

**Never**:

- Drive-by refactor an adjacent file ("while I'm here…").
- Reformat unrelated code, reorder unrelated imports, rewrite unrelated
  comments, or rename unrelated variables.
- Delete pre-existing dead code unless the WI explicitly authorizes
  cleanup. Pre-existing dead code is someone else's WI.
- Mass-rename across files outside scope.
- Touch fixture files, conformance harnesses, or contract schemas
  unless the WI plan explicitly includes them.
- Add backward-compatibility shims or "removed in X" comments for code
  this WI didn't change.

Unrelated issues found while implementing → record in
`dev-memo/deferred-audit-findings.md` or open a separate WI plan. Do
NOT fold them into the active diff.

## §4 Goal-driven execution

Every WI is a verifiable goal, not an imperative checklist.

**Required before implementation**:

1. **Acceptance checks exist in the WI plan**. Each acceptance criterion
   must be testable: an exit-0 test command, a specific assertion, a
   concrete LOC budget, a cc-suite verdict expectation.
2. **Tests prove the changed behavior**. New tests must fail BEFORE the
   implementation lands (red), pass AFTER (green). Existing tests must
   stay green throughout.
3. **The independent quality gate runs**. cc-suite audit on the impl
   commit's scope per [[cc-suite]] §"Audit remediation policy"; verify
   if fixes were applied.

**The flip**:

- Instead of "add tenant-mismatch validation to registerDocument",
  the plan says "registerDocument throws CaseBoxPersistenceError with
  code='tenant_mismatch' when document.tenant_id !== matter.tenant_id
  AND the conformance test 6.1.17 passes against SQLite."
- Instead of "make the audit chain work in SQLite", the plan says
  "after createMatter + registerDocument + archiveMatter, the
  invariant `event_count == COUNT(*) == MAX(sequence) == 3` holds in
  `case_box_audit_chain_heads`."

Karpathy's strategic insight: declarative verification beats
imperative instruction.

**Do not commit until acceptance checks pass.** A failed test, a
missing audit, a LOC overrun, or an unresolved Critical/High audit
finding all block commit per the existing
[[../rules/cc-suite]] §"Audit remediation policy".

## §5 Relationship to existing rules

This rule is a **floor**, not a ceiling and not a bypass. Authority
hierarchy (higher entries win on conflict):

1. **`.claude/rules/autonomy.md` §"Hard-stop list"** — absolute global
   hard stops (push, secrets, deploy, reset --hard, etc.). NEVER
   bypassed.
2. **`dev-memo/rollback-00.md`** (committed rollback policy) +
   **`dev-memo/night-run-00.md`** (overnight lane policy). Lane
   authorization defines what's allowed during overnight runs.
3. **Reviewed ADRs under `docs/adr/`** that are not marked superseded.
4. **`docs/product/project-requirements-brief.md`** with status `READY`
   per [[project-brief]].
5. **`.claude/rules/cc-suite.md`** — cc-suite is the broker for plan
   review, audit, and verify. This rule does NOT replace cc-suite as
   the independent quality gate.
6. **`.claude/rules/loc-guardian.md`** — LOC fail/warn thresholds.
7. **`.claude/rules/staging-hygiene.md`** — explicit-staging commit
   discipline.
8. **`.claude/rules/security-boundary.md`** — security-sensitive
   workflow.
9. **`.claude/rules/client-local-first.md`** — v1 client posture.
10. **`.claude/rules/spark.md`** + **`.claude/rules/project-brief.md`**
    — brainstorming + intake workflows.
11. **THIS rule** — execution-discipline floor.

Specific non-overrides:

- This rule does NOT authorize bypass of `/cc-suite:review-plan` for
  high-risk WIs.
- This rule does NOT relax the loc-guardian fail thresholds.
- This rule does NOT permit "surgical change" justifications to evade
  hard stops (e.g., "the smallest slice is to push to main" — push is
  forbidden regardless).
- This rule does NOT replace the project-autopilot loop's
  branch-clean → loc-guardian → plan-review → impl → audit → verify
  → commit sequence.

## References

- Upstream principles: https://github.com/forrestchang/andrej-karpathy-skills
  (MIT).
- [[autonomy]] — global hard-stop list.
- [[cc-suite]] — review-plan / audit / verify broker.
- [[loc-guardian]] — LOC budget guardrail.
- [[staging-hygiene]] — explicit-staging discipline.
- [[security-boundary]] — security-sensitive WI loop.
- [[client-local-first]] — v1 client posture.
- [[spark]] — per-feature brainstorming intake.
- [[project-brief]] — whole-product intake.
- `dev-memo/rollback-00.md` — committed rollback policy.
- `dev-memo/night-run-00.md` — overnight lane policy.
- `.claude/skills/project-autopilot/SKILL.md` — autopilot loop.
