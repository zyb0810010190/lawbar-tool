---
description: Evidence-Genie M0 lane orchestration — drive ONE reviewed Evidence work item through the least-privilege chain with an Evidence-invariant gate, binding to .claude/rules/evidence-genie.md. Workflow-only; implements no Evidence behavior; never auto-commits or pushes; A0.7 is the first real gate and no Evidence UI ships before it is green.
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
---

# /evidence-workflow

The Evidence-Genie M0 lane command. It **reuses the generic `/feature-workflow` posture** and adds the
Evidence-invariant gate. It is **workflow-only — it implements no Evidence behavior**. It binds to the
domain rule `.claude/rules/evidence-genie.md` (the twelve Evidence-M0 invariants) and to `AGENTS.md`
§"Evidence-Genie M0 workflow composition".

## A0.7 is the first real Evidence architecture gate
A0.7 (`renderer-conformance`) is the first reality gate and is **not built yet**. **No Evidence UI ships
before A0.7 is green.** Any Evidence-architecture WI driven by this command must respect that ordering; use
`/evidence-geometry-gate` to prepare/run A0.7. Treat an A0.7 class-2 result as an architectural STOP.

## Sequence (least-privilege — separation of duties enforced by each agent's `tools:` grant)

1. **planner** (read-only) — scope, numbered plan, risks; name the protected Evidence invariant.
2. **test-designer** (read-only) — **test design precedes implementation**; emit proposed tests as a diff.
3. **implementer** (write) — the ONLY writer; apply tests (red) then the smallest change (green); Allowed
   files only; run gates. A `not_implemented` Evidence harness is a FAIL, never a pass.
4. **evidence-invariant-reviewer** (read-only) — confirm NO Evidence invariant is weakened (see below).
5. **reviewer** (read-only) — review vs the approved plan + tests; scope/simplicity/style.
6. **release-steward** (git, **only on explicit human request**) — see "Commits".

## Evidence-M0 invariants this lane preserves (from `.claude/rules/evidence-genie.md` — never weaken)
- **Manual-truth-only**: no OCR, AI/VLM, external DBs, evidence scoring, cloud sync, auth, or network.
- **Citation identity comes only from `DocumentPage`** (byte-stable; ambiguity refused, never guessed).
- **Anchors are page-ratio against captured page geometry**, never viewport/screen pixels.
- **`OptimizedDocumentRendition` is never the canonical** citation/anchor source.
- **Snapshot manifest/seal anti-circularity** preserved (logical payload hashed, separate seal).
- **`CanonicalExportModel`, not raw `.docx`/PDF bytes by default**, is the reproducibility layer.
- A future AI suggestion layer stays build-flagged and separate from manual truth.

## Soft rule vs future hard hooks
The constraints above are recorded in `.claude/rules/evidence-genie.md` as **soft rule-level** constraints
(this lane enforces them by the invariant reviewer + reporting). The **future EVW5 Evidence hard hooks**
(`exit 2`/`deny` — no-UI-before-A0.7, citation-single-source, optimized-never-canonical, snapshot-seal
anti-circularity, offline-entitlement) are a separate WI; they are NOT yet installed. Do not assume a hard
hook blocks a violation today — the invariant reviewer is the binding check until EVW5 lands.

## Commits are human-controlled (the workflow does NOT decide to commit)
- The workflow's job is to get the gates green; the **human decides whether to commit**.
- **No autonomous `git commit`. Never `git push`.** Staging is **exact paths only**, and only when the
  human explicitly instructs a commit. Confirm `git diff --cached --name-only` first. **Stop on guard denial.**

## Queue governance is preserved
No self-authorizing queue edits. A governed WI is added/advanced only via review -> lint -> govern
(`check-queue.sh` + `/cc-suite:review-plan` + `mark-queue-reviewed.sh` + `govern-queue.sh`, run standalone).

## Gate reporting: classify hard vs soft
Report each gate **HARD** (tests/typecheck/build/contract-integrity/`exit 2`/`deny` hooks + the future
A0.7 gate + the Evidence-invariant BLOCK) vs **SOFT** (advisory — loc-guardian warn, self-review fallback).

## Hard stops
Defer to `AGENTS.md` + `.claude/rules/autonomy.md`. High-risk Evidence WIs (persistence, crypto, native,
snapshot, export) require cc-suite review/audit/verify via the broker (`.claude/rules/cc-suite.md`).
