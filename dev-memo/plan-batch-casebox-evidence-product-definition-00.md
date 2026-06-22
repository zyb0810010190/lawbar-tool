# BATCH-CASEBOX-EVIDENCE-PRODUCT-DEFINITION-00 (plan packet — governed)

**Status**: governed product-definition plan packet (WI-EPD1). **Date**: 2026-06-22.
**Lane**: `evidence-m0-product-definition` (branch). **Type**: PLAN (documentation/governance only).
**Boundary**: this lane defines **what the Evidence-Genie M0 product should say and do**; it MUST NOT create
runnable Evidence product behavior. **"No Evidence UI before A0.7 green" remains binding.**

Predecessors: PR #100 (workflow-scaffold lane) merged to `main` (`6dc2526`); WI-EPD0 (`277e455`) tracked the
M0 domain reference at `docs/reference/evidence-genie-m0-developer-handover.md`.

## 1. Product content scope
Define the Evidence-Genie M0 product as documentation only: the **PRD** (problem, user, M0 boundary,
success); the manual **user workflows** (build forms, draw hyperlinks, navigate by 证据号/page, restate
pre-marked excerpts in the air-gapped hearing, freeze→snapshot→backup/restore, export with 卷页 citations);
the **legal-domain terminology** (证据目录 / 卷X页Y / 举证质证表 / 质证记录 / 证据号 / 原告·被告·法院, with
English glosses); the **screen/content inventory** (surfaces + visible copy, CN/EN — no component/code spec);
and **acceptance criteria + testable scenario examples** expressed as lawyer-observable behavior. This lane
describes intent and acceptance; it produces **no runnable Evidence behavior**.

## 2. Documents to create (in later WIs — NOT in EPD1)
- `docs/product/evidence-m0-prd.md` — M0 PRD: problem; target user (single lawyer, macOS, air-gapped
  hearing); in-scope vs out-of-scope; the manual-truth M0 boundary; success criteria; the four hard
  invariants (A1 citation identity, A3 anchor resolution, A8 snapshot integrity, A10 export
  reproducibility) restated as product promises.
- `docs/product/evidence-m0-user-flows.md` — the manual evidence + hearing workflows end-to-end.
- `docs/product/evidence-m0-content-inventory.md` — screen/content inventory + the CN↔EN terminology
  dictionary; visible copy only, no code/component spec.
- `docs/product/evidence-m0-acceptance-scenarios.md` — given/when/then scenario examples + acceptance
  criteria, each traced to an A-invariant and tagged "gated behind A0.7".

## 3. Source-of-truth references
- `docs/reference/evidence-genie-m0-developer-handover.md` — tracked M0 domain reference (EPD0).
- `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` — EVW-00 composition + invariant posture.
- `.claude/rules/evidence-genie.md` — the 12 Evidence-M0 domain invariants (product promises must not contradict).
- `AGENTS.md` — §"Evidence-Genie M0 workflow composition"; single source of truth.
- `.claude/rules/client-local-first.md` — macOS-only, local-first; forbidden v1 framings.
- `dev-memo/plan-batch-casebox-evidence-workflow-port-00.md` — port plan + WI history.
- `dev-memo/evidence-workflow-port-closeout-00.md` — lane closeout + deferred items.

## 4. Explicit non-goals
- no Evidence UI · no product behavior · no real A0.7 · no A0.7 marker · no Swift/SwiftPM/PDFKit ·
  no macOS CI · no hard hooks · no OCR/AI/VLM/cloud/auth/network behavior.

## 5. Relationship to A0.7-first (binding)
- The docs may **define intended behavior** but **do not authorize implementation**.
- **Every UI/anchor/export behavior in any doc MUST be tagged "gated behind A0.7."**
- `renderer-conformance` (A0.7) currently returns **`not_implemented`** (the `native/evidence-core` shim);
  the real harness does not exist.
- **No doc may imply A0.7 is green**, and no doc/WI creates an A0.7 marker. A0.7 remains the first real
  Evidence architecture gate; UI ships only after it is green (a separate governed lane).

## 6. Acceptance criteria (the doc lane)
- All four `docs/product/evidence-m0-*.md` exist (each in its own later WI), complete against its outline in §2.
- Internally consistent + **non-contradictory** with EVW-00, `evidence-genie.md`, `client-local-first.md`
  (manual-truth only; macOS-only/local-first; no browser-first/cloud-default framing).
- Every UI/anchor/export behavior tagged "gated behind A0.7"; no doc claims runnable behavior or a green A0.7.
- CN↔EN terminology consistent across docs; acceptance scenarios concrete + observable (given/when/then),
  each traced to an A-invariant.
- No forbidden-scope content; no `apps/**`/native/Swift/CI/marker artifacts.
- Gates green: `check-contract-integrity.sh`, `npm --prefix apps/lawbar-desktop test` (610/610, unaffected),
  `check-gates.sh`; loc-guardian advisory for long-form docs.
- **cc-suite `/review-plan` READY** on each doc WI (product direction → adversarial scope-creep + unsafe-
  cloud/UI-before-A0.7 review).

## 7. Review / gate plan
- One **governed-queue WI per doc** (EPD2..EPD5), each: governed block → `check-queue.sh` → cc-suite
  `/review-plan` → `mark-queue-reviewed` → `govern-queue` (standalone, content-bound) → exact-path commit;
  Layer-B **batch audit every 3 commits**; study packet per audit.
- **cc-suite `/review-plan` REQUIRED before commit** on every doc WI; doc-only ⇒ not high-risk, so no broker
  audit/verify unless a reviewer flags it. Self-review fallback only if cc-suite is unavailable (recorded).
- **Stop-and-report** triggers: scope creep into implementation/UI/A0.7, source-of-truth ambiguity, or any
  doc implying A0.7 green / creating a marker.
- If product direction proves whole-product (vision/business model), reconcile via `/project-brief` rather
  than overloading the PRD (`.claude/rules/project-brief.md`).

## 8. Proposed WI sequence (NOT yet governed beyond EPD1)
```
EPD2  docs/product/evidence-m0-prd.md                 (PRD)
EPD3  docs/product/evidence-m0-user-flows.md          (manual evidence + hearing workflows)
EPD4  docs/product/evidence-m0-content-inventory.md   (screens + CN/EN copy + terminology dictionary)
EPD5  docs/product/evidence-m0-acceptance-scenarios.md(given/when/then + acceptance, A0.7-gated)
EPD-CLOSEOUT  lane closeout report (doc-only)
```
Each EPD2..EPD5 is one doc-only WI through the §7 governed flow; each tags UI/anchor/export behavior
"gated behind A0.7" and weakens no Evidence invariant. EPD-CLOSEOUT summarizes the lane and the
still-pending hard-stop boundaries (Swift/PDFKit native core, macOS CI, real A0.7, hard hooks).

## 9. Root-intake disposition note
- The M0 developer handover is tracked as reference material at
  `docs/reference/evidence-genie-m0-developer-handover.md` (committed in EPD0, `277e455`).
- The **root duplicate `Evidence-Genie-M0-Developer-Handover.md` is intentionally left untracked for now**;
  its **deletion is a separate, explicit cleanup decision** (not part of this lane unless instructed).
- `xiaolai-dev-workflow-study.md` **remains out of scope** for this lane (untracked; not moved/committed).

## References
- The seven source-of-truth files in §3; `.claude/rules/cc-suite.md` (review broker), `.claude/rules/autonomy.md`
  (hard-stops), `.claude/rules/staging-hygiene.md`, `.claude/rules/loc-guardian.md`.
