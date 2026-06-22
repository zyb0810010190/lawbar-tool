# Evidence workflow-scaffold lane — closeout (EVW-CLOSEOUT-00)

**Date**: 2026-06-22. **Type**: CLOSURE (documentation only; no production code).
**Lane**: BATCH-CASEBOX-EVIDENCE-WORKFLOW-PORT — port the xiaolai workflow substrate into Lawbar and
compose a Lawbar/Evidence-Genie-M0 orchestration layer on top. **Status: lane closed at the harness
contract shim.** No Swift/SwiftPM/PDFKit, no real A0.7, no hard hooks, no macOS CI, no Evidence UI, no
product implementation were built — all are correctly gated behind explicit hard-stop authorizations.

Authoritative artifacts: `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00) and
`dev-memo/plan-batch-casebox-evidence-workflow-port-00.md` (the port plan + WI sequence).

## 1. Completed EVW commits

| WI | Commit | What |
|---|---|---|
| EVW1 | `c8dc19d` | ADR EVW-00 (`docs/adr/`) + port plan (`dev-memo/`) — three-layer composition model (xiaolai substrate → Lawbar `.claude` orchestration → Evidence-Genie M0 domain gates), decisions D1–D7. |
| EVW2 | `6e0cb87` | AGENTS.md "Evidence-Genie M0 workflow composition" section (single-source; D3/D4 posture). |
| EVW3 | `0309e48` | Six least-privilege agents (`.claude/agents/`): planner, test-designer, implementer, reviewer, evidence-invariant-reviewer, release-steward (tool grants enforce separation of duties). |
| EVW4 | `9228959` | Generic Lawbar commands `/feature-workflow` + `/fix-issue` (`.claude/commands/`). |
| EVW6 | `2e2fa5b` | Evidence commands `/evidence-workflow` + `/evidence-geometry-gate` (cite `evidence-genie.md`; geometry-gate frames A0.7 as future, Class-1/Class-2). |
| EVW8 | `89df1b9` | Domain rule `.claude/rules/evidence-genie.md` (12 records) + closed deferred finding EVW-PORT-L1. |
| EVW5R | `20339dd` | Doc reconciliation: defer all five EVW5 hard hooks until after EVW7 (records the three broker NEEDS-FIX results + rationale). |
| EVW7 | `a732ece` | `native/evidence-core/` dependency-free Node deterministic-JSON harness **contract shim** (10 commands; 8 gates `not_implemented`=fail; version/healthcheck pass) + the §5 plan wording fix. |

Each commit passed per-WI gates + cc-suite review (and, for EVW7, broker audit + verify), and each is one
revertable commit logged in `dev-memo/run/log.md` with a batch-audit closeout between every three commits.

## 2. Current invariant posture

- **Evidence-M0 invariants exist as a SOFT, rule/command/agent workflow layer**, not hard enforcement:
  `.claude/rules/evidence-genie.md` (the 12 records), the read-only `evidence-invariant-reviewer` agent,
  and `/evidence-workflow` (which inserts that reviewer) + `/evidence-geometry-gate` (Class-1/Class-2).
- **Hard hooks are intentionally DEFERRED** (EVW5a/EVW5b) until real protected surfaces + marker provenance
  exist — three broker NEEDS-FIX results established that premature hooks would be unsound (marker forgery,
  Bash bypass, incomplete plist-mutation coverage, and over-blocking existing CaseBox `evidence` code).
- **`not_implemented` FAILS, never passes** — enforced by the EVW7 shim (the eight gate commands exit
  non-zero) and recorded in `evidence-genie.md` record #10.
- **No A0.7 marker exists. No fake green marker.** The shim creates nothing under `dev-memo/run/evidence/`
  and emits no green marker; `renderer-conformance` returns `not_implemented`.
- **No real PDFKit / A0.7 behavior yet.** The harness is a JS contract shim only.

## 3. Hard-stop boundary (requires explicit user authorization to cross)

- **Swift / SwiftPM / PDFKit native Evidence Core** — a new runtime/toolchain → autonomy hard-stop.
- **macOS CI** (the current CI is `ubuntu-latest` only) — requires authorization.
- **Real A0.7 renderer-conformance harness** — a SEPARATE governed lane, built only on the native core.
- Any new runtime dependency, or any write outside the JS shim's scope, likewise hard-stops.

## 4. Next recommended lane

**Native Evidence Core / A0.7 feasibility lane.** First output should be a **proposal/ADR** covering:
Swift/PDFKit adoption, SwiftPM layout, macOS CI, and the A0.7 marker **provenance/tamper** design (the
green marker generated only by the real harness, never hand-authored). **No Evidence UI before A0.7 is
green.** Implementation is authorized only after that proposal/ADR clears cc-suite review-plan and the
hard-stops are explicitly approved.

## 5. Unresolved / deferred items

- **EVW5 hard hooks (EVW5a + EVW5b)** — deferred until the real native surfaces + marker provenance exist
  (per EVW5R + port plan §4.3). When built they MUST cover Write/Edit/MultiEdit **and** Bash (incl.
  `plutil`/`PlistBuddy`/`sed -i`/`perl -i`/`cp`/`mv`/inline writers), canonical path matching, marker
  provenance/tamper protection, and concrete Evidence-Genie target paths.
- **EVW9** — arm tdd-guardian teeth (`blockCommitWithoutFreshGate`) for Evidence + the cross-model
  stop-review gate (iff a live Codex login is confirmed). Pending; depends on EVW5b.
- **Root intake files** — `Evidence-Genie-M0-Developer-Handover.md` and `xiaolai-dev-workflow-study.md`
  remain **untracked** at repo root and need a later disposition (recommended: move to a gitignored
  `dev-memo/intake/`, or a separate `docs/reference/` PR if the team wants tracked provenance). They were
  intentionally never staged in this lane.

## 6. Final verification

Run at closeout (see the closeout commit's session report for live output):

```
npm --prefix native/evidence-core test       # 8/8 pass
npm --prefix apps/lawbar-desktop test         # 610/610 pass
scripts/workflow/check-contract-integrity.sh  # PASS (14 contract docs)
scripts/workflow/check-gates.sh               # GATES OK
git status --short                            # clean except pre-existing untracked (incl. the 2 root intake files)
```

## PR / merge readiness

This lane is an **intake/governance/scaffold** deliverable: ADR + plan + AGENTS.md composition + agents +
commands + rule + the JS harness shim. It is internally consistent, fully gated, and **ready for a
PR/merge decision** as the Evidence workflow-scaffold foundation. It deliberately ships **no** Evidence
product behavior; everything past the harness shim (Swift core, A0.7, hard hooks, macOS CI, UI) is gated
behind the §3 hard-stops. **Nothing has been pushed; the merge decision is the user's.**
