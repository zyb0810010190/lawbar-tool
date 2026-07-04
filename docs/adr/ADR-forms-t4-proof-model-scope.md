# ADR — T4 举证质证表 proof-model + scope decision foundation (FORMS-T4-S0-00)

**Date**: 2026-07-04. **Type**: ADR / decision record (documentation only — no implementation, no schema,
no code/tests). **Lane**: WI-FORMS-T4-S0-SPEC-FOUNDATION-00 (design/decision-foundation, executed). **Status**:
**DECIDED** for B1 (scope) + B2 (proof model) on explicit user authority (2026-07-04); B3 (schema/data
foundation) framed conditionally and **NOT authorized here**. Predecessor: `dev-memo/forms-t4-spec-00.md`
(FORMS-T4-SPEC-00) + `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §C/§F.

> **Binding inputs.** `dev-memo/forms-t4-spec-00.md` (T4 framing + blockers B1/B2/B3);
> `docs/product/project-requirements-brief.md` (status `READY`) §12/§14 (proof matrix = post-v1 export
> candidate, "each a separate STOP-AND-ASK ADR"); `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §C (T4
> proof-model gaps) + §F Q6 (`RECONCILIATION-NEEDED`) + Q7 (new fields → schema ADR); the completed forms-T3
> S0–S3 chain (reuse baseline); `.claude/rules/{autonomy,project-brief,evidence-genie,client-local-first}.md`.

## 1. Context

T4 (举证质证表 — proof / cross-examination matrix) was fully design-gated: its proof model did not exist as
data or as a decided rule, and its M0-vs-post-v1 scope was an unresolved `RECONCILIATION-NEEDED` between the
`READY` brief (proof matrix = post-v1 STOP-AND-ASK) and the PRD (forms as an M0 promise). The predecessor spec
note (`dev-memo/forms-t4-spec-00.md`) surfaced these as user STOP-AND-ASK decisions B1 (scope) and B2 (proof
model), and B3 (schema/data foundation). The user has now resolved B1 and B2; this ADR records those decisions
and frames B3.

## 2. Decision — B1 (scope): T4 is POST-V1, not M0 (RESOLVED)

- **T4 is post-v1.** It is **not** part of the M0 release bar. (User decision, 2026-07-04.)
- **The `READY` brief controls** over the conflicting PRD M0 implication: `docs/product/project-requirements-brief.md`
  §12 "Export (post-v1)" + §14 list the **proof matrix** among post-v1 export candidates, each a separate
  STOP-AND-ASK ADR. Per the `project-brief` authority hierarchy (a `READY` brief governs product direction),
  the brief wins.
- **Reconciliation recorded:** the forms-spec §F Q6 `RECONCILIATION-NEEDED` (brief vs PRD) is now **RESOLVED as
  accepted**: T4 is **preserved as a planned Forms slice** (the product still intends to build it) but is
  **excluded from the M0 release bar** — a deliberate, recorded divergence, not a silent drop.
- **No M0 implementation is authorized by this decision.** Any T4 implementation is post-v1 work, separately
  governed, and additionally gated by B3 below. This ADR authorizes NO implementation, no schema change, and no
  T5 work.

## 3. Decision — B2 (proof model): ISSUE-CENTRIC (RESOLVED)

T4 uses an **issue-centric proof model** (user decision, 2026-07-04) — the organizing unit is the **legal
issue / proof object (争议焦点 / 证明对象)**, NOT the evidence item. The model's elements:

- **争议焦点 / 证明对象** — the disputed point / what must be proved (the row/organizing unit).
- **supporting evidence** — the evidence items adduced for that 证明对象.
- **evidence linkage** — the (many-to-many) relation between 证明对象 and evidence items.
- **opponent challenge / 质证意见** — the opposing party's cross-examination stance on the evidence/object.
- **三性** — 真实性 / 合法性 / 关联性, each as accept / reject / **partial** (mirroring the T5 sample's stance
  vocabulary), with reasons.
- **response / rebuttal** — our reply to the 质证意见.
- **proof gap / review-needed state** — an explicit flag when a 证明对象 has insufficient/absent supporting
  evidence, or a required field is missing.

**Structural rule:** evidence rows MAY appear **under** an issue / proof object, but a merely **evidence-centric**
table (the T3 shape) is **NOT** the primary structure for T4 — the organizing unit is the legal issue / proof
object. (This distinguishes T4 from T3's flat evidence catalogue and from T5's per-evidence 质证意见 narrative.)

This is the **model shape**, not a field-level schema design. Concrete field names, enums, nullability, and the
persistence/contract encoding are the B3 schema/contract decision (a later governed ADR), NOT decided here.

## 4. B3 (schema / data foundation) — framed conditionally, NOT authorized

**What exists today (post forms-T3 S0–S3):** evidence rows per matter (`case_box_evidence_items`) with the S0
fields (`evidence_title`, `proof_statement`, `display_order`) + `exhibit_page_range` + `status`; matter
`litigation_position` + `parties`; the T3 S1 model / S2 preview / S3 DOCX export (reuse baseline).

**What is missing (the issue-centric model needs NEW persisted data — none exists today):**
- 争议焦点 / 证明对象 entities (a new per-matter sub-entity).
- 证明对象 ↔ evidence linkage (a new relation).
- per-item 质证意见 / 三性 (真实性·合法性·关联性 accept/reject/partial + reasons) — a new cross-examination model.
- response / rebuttal text.
- per-link **citation** — how each 证明对象↔evidence link cites (the A10-T1 `卷X页Y` and/or the T3-style
  `exhibit_page_range` 页码), per forms-t4-spec §2 / forms-spec §C. Carried as an explicit deferred
  subdecision for the future schema-foundation WI.
- proof-gap / review-needed derivation.

**Assessment:** future T4 work **almost certainly requires new schema/contract/persistence additions** (new
sub-entities + a linkage relation + a 质证 model), following the S0-style additive precedent — a **HIGH-RISK
persistence design**, and **post-v1**. **This ADR does NOT authorize any schema/contract/persistence change**;
`CURRENT_SCHEMA_VERSION` stays 12. Those changes require their own future governed WI + explicit approval.

## 5. Smallest safe next T4 slice (recorded; NOT queued now)

Because (a) T4 is **post-v1** (not in the M0 release bar) and (b) the issue-centric model's source data **does
not exist** (§4), **no preview-only or export slice is eligible** (a preview-only slice would be possible only
if all required data already existed — it does not). The smallest safe next T4 slice is a **post-v1
schema/contract/data-foundation DESIGN WI**: an additive schema/contract ADR for the 证明对象 / linkage / 质证
model (S0-style), which is itself HIGH-RISK persistence design requiring its own governed review chain +
explicit approval.

**This next slice is NOT queued now** (T4 is post-v1; queuing implementation-track work would pre-empt the
post-v1 prioritization). It is recorded here as the defined next step, to be authored + governed as a separate
WI **only when the user prioritizes T4 into an active track**. Until then, T4 has **no active queued WI**.

## 6. Forbidden scope (this lane + the near-term T4 track approve NONE of these)

- **No T4 implementation** (no preview, table, DOCX/PDF, IPC, DTO, renderer) in this lane.
- **No schema / migration / contract / persistence change** — `CURRENT_SCHEMA_VERSION` stays 12; B3 is a later
  post-v1 governed ADR.
- **No T5** work (質证意见 / 质证记录 narrative-vs-structured fork is its own design-gated lane).
- **No PDF; no evidence write behavior; no native; no raw client samples / tracked intake fixtures; no
  custody/marker/seal; no JS shim; no A8; no broad renderer/UI redesign.**
- **No change to the completed T3 behavior** — T4 may reuse shared safe helpers/patterns (S1 model / S3 export)
  only with explicit per-WI justification in a future slice, never a T3 behavior change.

## 7. Consequences

- The T4 scope (B1) and proof model shape (B2) are now **decided** and no longer STOP-AND-ASK. The
  `RECONCILIATION-NEEDED` (forms-spec §F Q6) is resolved (accepted divergence: planned-but-post-v1).
- T4 remains **not implementable now**: it is post-v1 and its data foundation (B3) does not exist. The next
  step is a post-v1 schema/contract-foundation design WI, authored only when the user prioritizes T4.
- The forms track state: **T3 S0–S3 complete (M0)**; **T4 decided-but-post-v1** (this ADR); **T5 design-gated**.

## 8. References
- `dev-memo/forms-t4-spec-00.md` (FORMS-T4-SPEC-00; blockers B1/B2/B3, first-slice framing).
- `docs/product/project-requirements-brief.md` (status `READY`) §12/§14 (proof matrix post-v1 STOP-AND-ASK).
- `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §C/§F (T4 proof-model gaps; Q6 reconciliation; Q7 new fields).
- `dev-memo/plan-forms-t3-evidence-catalog-00.md` + `dev-memo/adr-forms-t3-s0-schema.md` +
  `dev-memo/adr-forms-t3-s3-docx-export.md` + the S1/S2/S3 artifacts (the S0-style additive + ADR/impl chain
  pattern a future T4 schema-foundation WI will echo).
- `.claude/rules/autonomy.md` (product-direction hard stop), `.claude/rules/project-brief.md` (READY brief
  governs product direction), `.claude/rules/evidence-genie.md` (manual-truth invariant),
  `.claude/rules/client-local-first.md`.
