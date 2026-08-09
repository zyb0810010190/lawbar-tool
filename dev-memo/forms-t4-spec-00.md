# Forms-spec design note — T4 举证质证表 (proof / cross-examination table) (FORMS-T4-SPEC-00)

**Date**: 2026-07-04. **Type**: design/spec note (documentation only — no implementation, no schema, no
code/tests, no product-scope decision made here). **Lane**: WI-FORMS-T4-SPEC-GOVERNANCE (design/spec +
governed-WI authoring). **Status**: framing note for the still-gated T4 form — **NOT
implementation-authorizing** and **NOT a product-scope decision**. Predecessor: `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md`
§C (T4 is "fully design-gated"; the proof model does not exist as data or as a decided rule) + §F Q6/Q7.

> **Binding inputs.** `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §C (T4 proof-model gaps) + §F Q6
> (M0-vs-post-v1 `RECONCILIATION-NEEDED`) + Q7 (new persisted fields need a schema ADR + explicit approval);
> `docs/product/project-requirements-brief.md` (status `READY`) §12 "Export (post-v1)" + §14 "Post-v1 export
> candidates" — **"PDF chronology / proof matrix / privilege log … each is a separate STOP-AND-ASK ADR"**;
> the completed forms-T3 track (S0–S3) as the reuse baseline; `.claude/rules/{autonomy,project-brief,evidence-genie,client-local-first}.md`.

## 0. Scope of THIS note (and what it does NOT do)

This note **frames** T4 so a future lane can proceed *once the blockers below are resolved by the user*. It
does **not** implement T4, does **not** design the proof-model fields (that would be invention, forbidden by
`ADR-evidence-a10-court-fileable-export.md` §10 and forms-spec §E), and does **not** decide whether T4 is in
M0 or post-v1 (that is a product-scope decision reserved to the user — see §4 Blocker B1). It records the
target, the source-data gaps, candidate structure (decision-pending), the hard blockers, and the smallest safe
first slice.

## 1. Purpose (from the real-sample context)

举证质证表 is a **proof / cross-examination matrix**: it organizes the case's evidence by what each piece is
meant to prove and captures the opposing party's 质证 (cross-examination) stance on it. Where T3 (证据目录及说明)
is a flat catalogue of one party's evidence, T4 adds the **argument structure** — 争议焦点 / 证明对象 →
supporting evidence → 对方质证意见 (三性 stance + reasons). Per DR-00 (forms-spec §H), T4 — like T3/T5 — is an
**internal lawyer trial-review work product**, NOT a court-filing artifact in this phase; the audience +
court-facing/export scope are part of the B1 product-scope decision (§4), not assumed here. The T5 sample (`【一审】质证意见-示例20260629.docx`, a narrative 质证意见 brief) shows the *content* of a
质证 stance (三性: 真实性/合法性/关联性 as accept/reject/partial + reasons cross-referencing evidence numbers) but
NOT a normalized table.

## 2. Source data — what exists vs what is missing

**Exists today (post forms-T3 S0–S3):**
- Evidence rows per matter (`case_box_evidence_items`) with the S0 fields (`evidence_title`, `proof_statement`,
  `display_order`) + `exhibit_page_range` + `status`; the S1 `T3CatalogModel` + S2 preview + S3 DOCX export.
- Matter `litigation_position` (原告/被告) and `parties`.

**Missing — none of these exist as data OR as a decided rule (forms-spec §C):**
- **争议焦点 / claim / issue** — the disputed points the table is organized around.
- **证明对象** — what each claim/element must prove (distinct from the per-item `proof_statement`, which is the
  lawyer's free-text purpose for ONE evidence item, not a claim-level proof target).
- **evidence↔证明对象 linkage** — which evidence items support each 证明对象 (a many-to-many relation).
- **对方质证意见 (三性 stance)** — per opposing item: 真实性/合法性/关联性 as accept/reject/partial + reasons. No
  persisted 质证 model exists; `party_side` marks who introduced an item, not a cross-examination stance.
- **proof-gap rule** — the rule flagging a 证明对象 with insufficient/absent supporting evidence.
- **citation** — 卷X页Y (A10-T1) and/or the T3-style 页码 range, per link.

**Consequence:** T4 cannot be a table "over existing data" the way T3 was. It requires **new persisted data +
a new proof model**, not just a rendering.

## 3. Candidate structure (DECISION-PENDING — not designed here)

Recorded as candidates to frame the decision, NOT as an approved design (the real column set + field semantics
are the proof-model decision, §4 B2):
- A proof-matrix row is plausibly keyed by **证明对象 / 争议焦点**, listing the linked evidence (序号 + 证据名称),
  the 证明目的/证明对象 text, and the opposing 质证意见 (三性 + reasons), possibly with a proof-gap flag.
- OR (the T5 fork) the cross-examination could be a **narrative 质证意见 brief** rather than a structured table
  (forms-spec §F Q5). Whether T4 is a *structured matrix* vs a *narrative* is itself part of the proof-model
  decision and overlaps T5.
- No column set, enum, or field name is approved by this note.

## 4. Hard blockers (must be resolved by the USER before any T4 implementation)

**B1 — Product scope: M0 vs post-v1 (STOP-AND-ASK + RECONCILIATION-NEEDED).** The `READY` project brief
(`docs/product/project-requirements-brief.md` §12 "Export (post-v1)" + §14) explicitly lists the **proof
matrix** among **post-v1 export candidates, "each a separate STOP-AND-ASK ADR."** The PRD/forms-spec treated the
three forms as an M0 promise (forms-spec §F Q6 flagged this exact conflict as `RECONCILIATION-NEEDED`). Per the
`project-brief` authority hierarchy, the `READY` brief governs → **T4 is post-v1 + STOP-AND-ASK by default**.
This is a product-direction decision reserved to the user (autonomy hard-stop); it is NOT decided here and MUST
be resolved (M0-in-scope vs post-v1, and the STOP-AND-ASK cleared) before any T4 implementation WI.

**B2 — Proof-model product/legal decision.** The 争议焦点/证明对象/linkage/质证-三性/proof-gap model (§2) is a
product+legal decision, not an engineering one. Designing these fields absent that decision would be invention
(forbidden). Overlaps the T5 structured-vs-narrative fork (forms-spec §F Q5).

**B3 — Schema/contract additions (forms-spec §F Q7).** Once B1+B2 resolve, the new persisted fields (证明对象,
per-opposing 三性, evidence↔object links, proof-gap) require their own **schema/contract ADR + explicit
approval**, following the S0-style additive precedent — a HIGH-RISK persistence lane, not part of this note.

## 5. Verdict — smallest safe first slice

Because B1 is an unresolved **post-v1 STOP-AND-ASK** in the `READY` brief and B2 (the proof model) does not
exist, **no T4 implementation slice (preview or DOCX export) is eligible**, and even a schema ADR is premature
(it would presume B1+B2). The smallest safe first slice is therefore a **design/decision-foundation** lane, NOT
implementation:

> **First T4 slice = produce a T4 proof-model + scope-reconciliation DECISION ADR** (design-only) that (a)
> surfaces the B1 M0-vs-post-v1 STOP-AND-ASK for the user to resolve against the `READY` brief, (b) frames the
> B2 proof-model product/legal options (structured matrix vs narrative; the 证明对象/争议焦点/三性/proof-gap
> model) for a user/legal decision, and (c) specifies the B3 schema additions *conditionally* (only if/after
> B1+B2 resolve). It writes ONE ADR + governance; it implements nothing, changes no schema, and makes no
> product-scope decision on the agent's own authority. **The ADR's ONLY decision is the status itself — "T4
> remains blocked pending the user's resolution of B1 (M0-vs-post-v1 STOP-AND-ASK) and B2 (proof model)";**
> every option in §3/§4 is *recorded, not selected*. It is a decision-*foundation* / STOP-AND-ASK packet, not a
> final product decision.

This mirrors the T3 chain (spec/DR-00 → plan → S0 schema ADR → impl) but starts one step earlier because T4's
product scope + proof model are still open, whereas T3's were resolved by DR-00.

## 6. Forbidden scope (the first T4 WI approves NONE of these)

- **No T4 implementation** (no preview, no DOCX/PDF, no table code) — design/decision only.
- **No product-scope decision by the agent** — B1 (M0 vs post-v1) is a user STOP-AND-ASK per the `READY` brief.
- **No proof-model field design as final** — B2 is a user/legal decision; candidates in §3 are non-binding.
- **No schema/migration/contract/persistence change** — `CURRENT_SCHEMA_VERSION` stays 12; B3 is a later ADR.
- **No T5** work (the narrative 质证意见 / structured 质证记录 fork is its own gated design lane).
- **No PDF; no native; no custody/marker/seal; no JS shim; no A8; no raw client samples / tracked intake
  fixtures; no broad renderer/UI redesign.**
- **No change to the completed T3 behavior** except reuse of shared safe helpers (e.g. the S1 model / S3 export
  patterns) *if explicitly justified* in a future slice — never a T3 behavior change.

## 7. References
- `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §C/§E/§F (T4 proof-model gaps; non-decisions; open questions).
- `docs/product/project-requirements-brief.md` (status `READY`) §12/§14 (proof matrix = post-v1 STOP-AND-ASK).
- `dev-memo/plan-forms-t3-evidence-catalog-00.md` + `dev-memo/adr-forms-t3-s0-schema.md` + the S1/S2/S3
  artifacts (the reuse baseline + the ADR/schema/impl chain pattern T4 will echo one step later).
- `.claude/rules/autonomy.md` (product-direction + new-runtime-dependency hard stops),
  `.claude/rules/project-brief.md` (authority hierarchy; `READY` brief governs product direction),
  `.claude/rules/evidence-genie.md` (manual-truth invariant), `.claude/rules/client-local-first.md`.
