# BATCH-CASEBOX-EVIDENCE-WORKFLOW-PORT-00 (plan — proposal)

**Status**: proposal plan (untracked). The governed `dev-memo/run/queue.md` is the authority.
This plan **proposes** a WI sequence; it does not authorize execution. Promotion path in §6.
**Date**: 2026-06-22. **Type**: PLAN (intake / governance / scaffold).
**ADR**: `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00) records the
composition model + decisions D1–D7. Read it first.

## 0. Purpose & scope cut

Compose the **xiaolai workflow substrate** (Layer 1, already installed) with a **Lawbar `.claude`
orchestration** (Layer 2) into the **Evidence-Genie M0 domain gates** (Layer 3). This is the
intake/governance/scaffold PR only.

**This PR produces (and nothing else):**
1. The ADR above (composition model).
2. This plan (the AGENTS.md strategy, the four sub-plans, the proposed WI sequence).
3. A proposed WI sequence (§5) for promotion into the governed queue (§6).

**Explicitly NOT in this PR** (intake hard constraints, restated):
- No production Evidence UI.
- No anchors, export, snapshot, compression, OCR, AI/VLM, cloud sync, auth, or network behavior.
- No client-confidential PDFs committed.
- No `not_implemented` harness treated as passing.
- A0.7 stays the first real Evidence architecture gate; this PR stops before it.
- No `.claude/` agents/commands/hooks created here — those are the *future WIs* this plan proposes.
  ("No production code unless required for scaffold documentation.")

## 1. Lane-start context (echo-sleuth recap surrogate)

`.claude/rules/echo-sleuth.md` §A requires a lane-start recap before a new umbrella plan/ADR.
Loaded memory (`MEMORY.md`) supplies the recent-lane recap used here:
- CaseBox RC checkpoint (main = audit-event-kind release candidate); no Low-backlog WIs without a
  product objective — this Evidence port IS that product objective.
- WI-DPE2 + FIX1 merged (docket-edit contract + prototype-pollution hardening).
- WI-PKG1 packaging fix merged (electron-builder asar bloat).
- Operational lessons: verify branch state before "next step" plans; Codex `/implement` scope
  violations (always `git status`/`diff` before trusting a delegated report); cc-suite↔codex-cli
  version mismatch (runner patch); never bundle govern with its commit.
Per `.claude/rules/echo-sleuth.md`, the **lessons/recall pre-flight is REQUIRED** before editing any
`.claude/rules/**` file (§C) — it is the binding pre-flight for any rule-authoring WI in §5 (e.g. EVW8),
cited in that WI's pre-flight. The broader **lane-start recap** is REQUIRED before the major-lane triggers
§A enumerates (a new Phase-B sub-WI plan or impl, a new umbrella plan or revision, a new ADR, a new RCA
lane, a `/project-autopilot` or `/loop` start, or whole-project intake); for an individual WI that is not
one of those triggers it is advisory. The `MEMORY.md` checkpoints above are the recap surrogate used for
this lane's authoring. (Closes deferred finding EVW-PORT-L1: the prior wording recorded this as a generic
"SHOULD", understating the §C REQUIRED rule-edit pre-flight.)

## 2. Repo-state findings (verified 2026-06-22, not assumed)

| Intake brief said | Actual repo state | Action |
|---|---|---|
| Read `dev-memo/intake/*.md` | Files at **repo root** (`Evidence-Genie-M0-Developer-Handover.md`, `xiaolai-dev-workflow-study.md`); `dev-memo/intake/` absent | Read at actual paths; divergence recorded. A future WI may move them under `dev-memo/intake/`. |
| Run `./dev-memo/run/check-gates.sh` | **Does not exist.** Real gate: `scripts/workflow/check-gates.sh` | §7 runs the real path. |
| ADR at `dev-memo/adr/...` | Convention is `docs/adr/` (single ADR home) | Filed under `docs/adr/` to match convention (divergence resolved). |
| Port xiaolai substrate | Already installed: `cc-suite`+`echo-sleuth` on; `tdd/loc/grill/docs` off; `.mcp.json` codex-cli; `.codex/config.toml` present | Substrate porting is **done**; remaining work is composition (D1). |
| AGENTS.md single-source strategy | Already satisfied: `CLAUDE.md`/`GEMINI.md` = `@AGENTS.md`; public/committed | No migration; only add an Evidence composition **section** (WI-EVW2). |
| Least-privilege agents | `.claude/agents/` **empty** | New: WI-EVW3. |

If any artifact below does not exist, the proposed WI documents that and scaffolds the **smallest
compatible** addition — never a parallel competing mechanism.

## 3. AGENTS.md strategy (decision: keep as-is, add one section)

- `AGENTS.md` stays the single source of truth; `CLAUDE.md`/`GEMINI.md` stay exactly `@AGENTS.md`
  (verified). Public/committed config is preferred and already in force — the repo does not forbid
  it; the xiaolai study's recommended default (committed, version-controlled workflow) holds.
- The only AGENTS.md change is a new section **"Evidence-Genie M0 workflow composition"** (WI-EVW2)
  that: names the three layers (cite EVW-00); states D3 guardian-enablement posture; states D4 that
  Evidence invariants are stop-grade; points to `rules/evidence-genie.md` (WI-EVW8) and the harness
  surface (WI-EVW7). It MUST NOT exceed the 32 KiB AGENTS.md ceiling — long procedure stays in the
  rule file, per `AGENTS.md` §"Project Contract". `block-contract-corruption.sh` guards the edit.

## 4. The four sub-plans

### 4.1 xiaolai workflow plan (Layer 1 — confirm/arm, do not re-port)

Per-tool target posture (decisions in EVW-00 D3/D6):

| Tool | Current | Target posture | WI |
|---|---|---|---|
| init-workspace | bridge already built | none — bridge + tree exist | — |
| cc-suite | on | unchanged; required broker for high-risk Evidence WIs | — |
| tdd-guardian | off | enable with `blockCommitWithoutFreshGate: true` for Evidence WIs; calibrate coverage to maintainable, not 100% theater | WI-EVW9 (deferred) |
| docs-guardian | off | stay off (contract-doc integrity already covered) | — |
| loc-guardian | off (plugin) | keep Lawbar's own rule+scan; plugin stays off (single LOC authority) | — |
| grill | off | stay off; add on a real failure mode | — |
| echo-sleuth | on | unchanged; lane recap/extract per rule | — |
| stop-review gate | available (codex-cli registered) | arm iff `/cc-suite:preflight` / `/codex:setup` confirms a live Codex login; else documented unavailable, never assumed-pass | WI-EVW9 (deferred) |

### 4.2 Lawbar `.claude` plan (Layer 2 — new orchestration)

**Commands** (mirror vmark's least-privilege chain; build via WORKFLOW WIs):
- `/feature-workflow` — planner(RO) → test-designer(test/spec write) → implementer(write) →
  reviewer(RO) → release-steward(commit-only-on-ask). Generic feature lane.
- `/fix-issue` — autonomous root-cause→fix→verify loop (bounded, one issue), reusing cc-suite
  bug-analyze + the same least-privilege agents.
- `/evidence-workflow` — `/feature-workflow` specialized: inserts **evidence-invariant-reviewer**
  (RO) before code review and **requires** the geometry gate when geometry/anchor code is touched.
- `/evidence-geometry-gate` — runs A0.7 `renderer-conformance` and **classifies** each failure
  class-1 (normalization, fixable inline) vs class-2 (geometry-source instability, architectural
  stop) per `Handover §5`. Wraps the harness command (WI-EVW7).

**Least-privilege agents** (`.claude/agents/*.md`; separation of duties enforced by per-agent
`allowed_tools`, not prose — study §5):

| Agent | allowed_tools (planned) | Role |
|---|---|---|
| planner | Read, Grep, Glob | read-only numbered plan; no writes |
| test-designer | Read, Grep, Glob, Write/Edit scoped to test/spec paths | writes tests first; rejects wiring-only tests |
| implementer | Read, Grep, Glob, Write, Edit, Bash | the only writer of product code |
| reviewer | Read, Grep, Glob | read-only implementation review |
| evidence-invariant-reviewer | Read, Grep, Glob | read-only; checks A0.7/A1/A3/A8/A10/A1-T9 not weakened |
| release-steward | Read, Grep, Glob, Bash(git, explicit-path) | commits **only when explicitly asked**; never pushes |

### 4.3 Evidence hard-hook plan (Layer 3 — stop-grade enforcement; planned, not built)

Five `exit 2` / `deny` hooks (EVW-00 D4). Built only once Evidence-core paths exist to scope them:
1. **no-evidence-ui-before-a0.7** — deny edits under the Evidence UI path until A0.7 gate green.
2. **citation-single-source** — deny citation-string formatting outside the A10-T1 contract.
3. **optimized-never-canonical** — deny using `OptimizedDocumentRendition` as citation/anchor basis.
4. **snapshot-seal-anti-circularity** — deny manifest hashing of the encrypted DB holding the seal.
5. **offline-entitlement-check** — deny adding network entitlement / outbound network in Evidence surface.

Each fails closed, mirrors Lawbar's existing hook posture, and is registered in
`.claude/settings.json` (`hooks`/`permissions` carve-out per `staging-hygiene.md`).

### 4.4 Evidence harness plan (Layer 3 — deterministic-JSON surface; scaffold later)

`native/evidence-core` scaffold deferred. Command surface emits deterministic JSON. Every
unimplemented harness exits non-zero / `not_implemented` = **FAIL**, never pass (EVW-00 D5):

`renderer-conformance` · `geometry-roundtrip` · `citation-stability-gate` · `coordinate-roundtrip`
· `a3-regression` · `snapshot-verify` · `golden-export` · `compress-readability-fixtures`.

Mapped to the handover's permanent CI gates (`Handover §8`/§9). Fixtures: real messy 卷宗 are
client-confidential and MUST NOT be committed; the scaffold ships synthetic/placeholder fixtures
only, with a documented slot for counsel-supplied fixtures kept out of git.

## 5. Proposed WI sequence (NOT yet governed — see §6)

Ordered by dependency. Each is a separate WI; none auto-authorized. Risk/gates summarized; full
per-WI blocks are authored at promotion time into `queue.md`.

```
WI-EVW1  SCAFFOLD  Record substrate posture + repo-state divergences (this plan + ADR commit).
                   Allowed: docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md,
                            dev-memo/plan-batch-casebox-evidence-workflow-port-00.md.
                   Gates: scripts/workflow/check-gates.sh; loc-guardian scan (docs-only, lenient).
                   Risk: none (doc-only). Depends: none.   ◀── THIS PR.

WI-EVW2  WORKFLOW  Add "Evidence-Genie M0 workflow composition" section to AGENTS.md (cite EVW-00).
                   Allowed: AGENTS.md.  Forbidden: CLAUDE.md, GEMINI.md (stay @AGENTS.md).
                   Gates: check-contract-integrity.sh; check-gates.sh; 32 KiB ceiling.
                   Risk: contract-doc edit (block-contract-corruption guard). Depends: EVW1.

WI-EVW3  SCAFFOLD  Create least-privilege agents (.claude/agents/{planner,test-designer,
                   implementer,reviewer,evidence-invariant-reviewer,release-steward}.md).
                   Allowed: .claude/agents/**.  Gates: check-gates.sh; agent-def lint.
                   Risk: low. Depends: EVW1.

WI-EVW4  WORKFLOW  Create /feature-workflow + /fix-issue commands wiring the EVW3 agents.
                   Allowed: .claude/commands/{feature-workflow,fix-issue}.md.
                   Gates: check-gates.sh. Risk: low. Depends: EVW3.

WI-EVW8  WORKFLOW  Create .claude/rules/evidence-genie.md (domain invariant rule; the soft-rule
                   companion to the hard hooks; restates A0.7/A1/A3/A8/A10/A1-T9, never weakens).
                   Allowed: .claude/rules/evidence-genie.md.  Pre: echo-sleuth:lessons.
                   Gates: check-contract-integrity.sh (rules are contract docs); check-gates.sh.
                   Risk: contract-doc. Depends: EVW2.

WI-EVW5  SCAFFOLD  Create the 5 Evidence hard hooks (§4.3) + register in settings.json (hooks/
                   permissions carve-out only). HIGH-RISK (enforcement + settings.json):
                   broker review-plan REQUIRED before impl; broker audit+verify after.
                   Allowed: .claude/hooks/evidence/**, .claude/settings.json (hooks/permissions only),
                            .claude/hooks/tests/**.  Gates: hook unit tests; check-gates.sh.
                   Depends: EVW8 (rule defines what each hook enforces). Note: hooks reference
                   Evidence paths that may not exist yet — ship them fail-open on missing-path,
                   fail-closed on violation, with tests proving both.

WI-EVW6  WORKFLOW  Create /evidence-workflow + /evidence-geometry-gate commands.
                   Allowed: .claude/commands/{evidence-workflow,evidence-geometry-gate}.md.
                   Gates: check-gates.sh. Depends: EVW3, EVW7.

WI-EVW7  SCAFFOLD  Scaffold native/evidence-core deterministic-JSON harness command surface
                   (8 commands, §4.4) — ALL not_implemented = FAIL (exit non-zero). Synthetic
                   fixtures only; NO client PDFs. HIGH-RISK if it introduces a new runtime/native
                   toolchain → that introduction is an autonomy hard-stop (new dependency) and is
                   split out / user-authorized separately. This WI scaffolds the JS-side command
                   contract + failing stubs only; the native toolchain decision is its own WI.
                   Allowed: native/evidence-core/** (new tree), package wiring as needed.
                   Gates: each harness exits non-zero with not_implemented JSON; check-gates.sh.
                   Depends: EVW1. Risk: HIGH (toolchain) — review-plan required.

WI-EVW9  SCAFFOLD  (Deferred) Arm tdd-guardian teeth for Evidence + stop-review gate iff Codex
                   login confirmed. Allowed: .claude/settings.json (enabledPlugins + hooks),
                   tdd-guardian config. Depends: EVW5. Risk: changes enforcement posture — review.

—— A0.7 line ——  No WI past here implements Evidence architecture. The first real Evidence gate
                   (A0.7 renderer-conformance on real fixtures, class-1/2 classification) is a
                   SEPARATE governed plan authored after EVW1–EVW8 land. This PR stops here.
```

**Risk-trigger note** (autonomy Layer C): WI-EVW7 (potential new native dependency) and WI-EVW5/9
(enforcement-posture change) force an immediate batch audit and are NOT eligible for unattended
auto-advance; each is review-plan-gated.

## 6. Promotion path (queue governance — why queue.md is NOT edited here)

`AGENTS.md` §"Queue governance": *generating a queue and executing a queue are different
authorities.* The live `queue.md` is governed at a content-bound hash
(`dev-memo/run/queue.governed`). Appending the §5 WIs would silently invalidate that hash and is
itself an ungoverned act. Therefore this PR **does not modify `queue.md`** — the proposed sequence
lives here as a PLAN. Promotion (per the rule) is:

1. A follow-up turn authors the full per-WI blocks from §5 into `queue.md`.
2. Codex `/cc-suite:review-plan` reviews the proposed queue.
3. `check-queue.sh` queue-lint confirms each WI has concrete scope/allowed-files/gates/acceptance,
   no forbidden-area touch, no forward dependency, no bare "cleanup/refactor".
4. `mark-queue-reviewed.sh` + `govern-queue.sh` run **standalone** (never bundled with the commit —
   `batch-commit-guard.sh` checks pre-refresh state; `AGENTS.md` §"Never bundle govern").
5. Only then is the queue authorized for a batch run up to `AUTO_ADVANCE_MAX` (currently 3).

This keeps the closed self-authorizing loop open: this plan can *suggest* the next work; it cannot
*permit* it.

## 7. Verification (this PR)

The intake brief named `./dev-memo/run/check-gates.sh` (absent). Real commands run:

- `npm --prefix apps/lawbar-desktop test`
- `scripts/workflow/check-gates.sh` (which itself runs the desktop suite)

This PR is doc-only (ADR + this plan); it changes no source, so the gates prove only that the docs
did not perturb the build. Output attached in the session report.

## 8. Hard constraints (restated; binding on every §5 WI)

- No production Evidence UI. No anchors/export/snapshot/compression/OCR/AI/VLM/cloud/auth/network.
- No client-confidential PDFs committed (synthetic fixtures only).
- `not_implemented` harness = FAIL, never pass.
- A0.7 is the first real Evidence architecture gate; nothing past the A0.7 line builds on it here.
- Evidence-Genie M0 invariants (citation identity, anchor resolution, snapshot integrity/anti-
  circularity, export reproducibility, readable-compression, offline) are never weakened by any
  generic guardian. Conflicts resolve in favor of the invariant; surface, do not silently choose
  (`AGENTS.md` §"Source hierarchy").
- Stop before merge. Push is never automatic.

## 9. Stop condition

This plan is "done" when EVW1 (this ADR + plan) is committed. It is "outdated" when its §5 WIs are
promoted into `queue.md` and governed (then `queue.md` is the authority), or when EVW-00 is
superseded by a `docs/adr/` ADR.

## References

- `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00).
- `Evidence-Genie-M0-Developer-Handover.md`, `xiaolai-dev-workflow-study.md` (intake).
- `AGENTS.md` (queue governance, cc-suite policy, autonomy hard-stops, critical invariants).
- `.claude/rules/{cc-suite,autonomy,loc-guardian,echo-sleuth,staging-hygiene,execution-discipline}.md`.
- `dev-memo/run/queue.md` + `dev-memo/run/queue.{governed,linted,reviewed}` (governed queue mechanism).
- `scripts/workflow/check-gates.sh`, `scripts/workflow/check-queue.sh`.
