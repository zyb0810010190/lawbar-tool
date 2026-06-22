---
description: Command surface for PREPARING and running the FUTURE A0.7 renderer-conformance gate. A0.7 does not exist yet — this command does not implement it. Stricter than /evidence-workflow: planner + evidence-invariant-reviewer before implementation, test design first, and mandatory Class-1 vs Class-2 failure classification (Class 2 = stop downstream).
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
---

# /evidence-geometry-gate

The command surface for **preparing and running the future A0.7 renderer-conformance gate**. It binds to
`.claude/rules/evidence-genie.md` and `AGENTS.md` §"Evidence-Genie M0 workflow composition".

## A0.7 does not exist yet
**A0.7 is not built and is not green. This command does NOT implement A0.7** — it is the orchestration
surface for the WI that eventually will (the `native/evidence-core` `renderer-conformance` harness is a
later WI; until it exists, its `not_implemented` status is a FAIL, never a pass). **A0.7 is the first real
Evidence architecture gate**, and **no Evidence UI ships before A0.7 is green.** Nothing downstream (A3
anchors, A5 forms, UI) may be built on top of A0.7 until it passes.

## Stricter sequence (read-only domain review BEFORE any implementation)
1. **planner** (read-only) — scope the A0.7 harness/fixtures plan; name the geometry invariant; no writes.
2. **evidence-invariant-reviewer** (read-only) — BEFORE implementation, confirm the plan does not weaken
   A0.7 / citation / anchor / snapshot / export invariants and stays manual-truth-only.
3. **test-designer** (read-only) — **test design precedes implementation**; design the conformance fixtures
   + the byte-identical `ratio -> page-space -> ratio` round-trip assertions; emit as a proposed diff.
4. **implementer** (write) — the ONLY writer; apply tests then the minimal change; Allowed files only.
5. **reviewer** (read-only) — review vs the approved plan + tests.
6. **release-steward** (git, **only on explicit human request**) — see "Commits".

## Mandatory A0.7 failure classification (the load-bearing step)
When A0.7 runs, every failure MUST be classified — not merely flagged:
- **Class 1 — normalization bug (fixable inline).** Page identity + persisted geometry are stable, but a
  rect lands shifted/inverted/scaled (box origin not subtracted, y-axis inversion, wrong rotation,
  cropBox/mediaBox mismatch, viewport leak). Response: fix the A3-T2 normalization/conversion math and
  re-run A0.7 — **no architecture reset.**
- **Class 2 — geometry-source instability (architectural STOP).** The same unmodified file, reopened,
  yields unstable `physicalPageIndex`, page count, `resolvedBox`, bounds, rotation, or geometry hash.
  Response: **STOP downstream work — do not build A3/A5/UI on top — and reassess the geometry-source /
  renderer / page-identity assumptions** (PDF canonicalization at import, a different renderer, page
  fingerprinting, or binding anchors to a stronger page identity than `physicalPageIndex` alone).

## Evidence-M0 invariants preserved (from `.claude/rules/evidence-genie.md` — never weaken)
Manual-truth-only (no OCR, AI/VLM, external DBs, scoring, cloud sync, auth, network); citation identity
only from `DocumentPage`; anchors page-ratio against captured geometry (never viewport/screen pixels);
`OptimizedDocumentRendition` never canonical; snapshot manifest/seal anti-circularity; `CanonicalExportModel`
not raw bytes by default; `not_implemented` harness FAILS, never passes.

## Soft rule vs future hard hooks
The above live in `.claude/rules/evidence-genie.md` as **soft rule-level** constraints; the **future EVW5
hard hooks** (`exit 2`/`deny`, incl. no-UI-before-A0.7) are a separate, not-yet-installed WI. Until EVW5,
the evidence-invariant-reviewer is the binding check.

## Commits + queue governance
Human-controlled commits: **no autonomous `git commit`, never `git push`**, exact-path staging only on
explicit instruction, **stop on guard denial**. Queue governance preserved — no self-authorizing queue
edits; governed changes only via review -> lint -> govern (standalone). **Report gates HARD vs SOFT.** The
workflow gets gates green; the **human decides whether to commit**.
