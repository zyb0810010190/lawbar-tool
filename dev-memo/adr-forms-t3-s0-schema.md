# ADR — T3 S0 schema design: lawyer-entered catalog fields (FORMS-T3-S0-SCHEMA-00)

**Date**: 2026-07-03. **Type**: ADR / schema DESIGN (documentation only — no schema implementation,
no migration file, no `CURRENT_SCHEMA_VERSION` change, no code/tests). **Lane**:
WI-FORMS-T3-S0-SCHEMA-ADR-00. **Status**: design decision record for the LATER T3 schema
implementation WI — **not** implementation-authorizing. Parent plan:
`dev-memo/plan-forms-t3-evidence-catalog-00.md` (slice S0).

> **Binding inputs.** `dev-memo/plan-forms-t3-evidence-catalog-00.md` §3 verdict (T3 blocked pending
> this ADR; 证据名称 + 证明内容 + 提交人诉讼地位 have no persisted source; §4 S0 must also decide the
> lawyer-controlled display order and the submitter-selection rule) and
> `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §H DR-00 (internal lawyer trial-review; 证明内容
> label; 页码 = physical bundle page range first, 卷X页Y supporting-only; DOCX renderer is a separate
> decision; T4/T5 gated; no custody/seal/A8).

## Review packet (compact)

1. **Summary**: design the minimal persisted-data change that unblocks T3 证据目录及说明. Finding:
   because the case-box architecture stores the **canonical row in `payload_json`** and lifts SQLite
   columns **only for indexing**, all required T3 fields can land as **additive optional contract
   properties** (evidence: `evidence_title`, `proof_statement`, `display_order`; matter:
   `litigation_position`) with **NO new SQLite columns, NO DDL, and NO `CURRENT_SCHEMA_VERSION`
   increment** in the later implementation WI (§5, Option A). This lane writes ONE ADR + queue
   governance artifacts; it implements nothing.
2. **Exact target files (this lane)**: `dev-memo/adr-forms-t3-s0-schema.md` (this file),
   `dev-memo/run/queue.md` + `queue.linted` + `queue.reviewed` + `queue.governed` +
   `dev-memo/run/reviews/queue-review-121.md`.
3. **Acceptance criteria (this lane)**: ADR records problem, required persisted data, scope
   boundary, candidate schema shape (options + one recommendation), migration implications,
   contract/API implications, test obligations, explicit non-decisions; docs/governance-only diff;
   raw samples untracked; check-queue + check-contract-integrity pass; broker review-plan READY.
4. **Out of scope**: any schema/contract/code/test/migration implementation;
   `CURRENT_SCHEMA_VERSION` change; renderer/DOCX/PDF; custody/seal/A8; T4/T5 schema or design;
   raw-sample commit.
5. **Essential references**: `services/case-box-persistence/src/sqlite/schema.ts` (V12 additive
   precedent + canonical-source rule); `docs/contracts/case-box-contract/schemas/`
   `case-box-evidence-item.schema.json` + `case-box-matter.schema.json`;
   `dev-memo/plan-forms-t3-evidence-catalog-00.md`.
6. **Review questions**: (a) is the payload-only Option A sound under the canonical-source rule, or
   does any T3 access path force a lifted column + DDL now? (b) are nullability/backfill/validation
   choices safe for existing rows? (c) does the ADR leak any implementation authorization or T4/T5
   design? (d) is the 卷X页Y supporting-only boundary preserved?

## 1. Problem

T3 证据目录及说明 needs four visible columns (序号, 证据名称, 证明内容, 页码) plus a submitter header
(提交人诉讼地位 ☑原告/被告, 名称/姓名). The current schema cannot honestly produce three of these:

- `case_box_evidence_items` (contract + SQLite V7 table) has **no evidence name/title field** and
  **no dedicated proof-statement field**. The generic optional `notes` is not semantically bound to
  证明内容, and a linked document's `filename` is a machine artifact, not a lawyer-facing 证据名称
  (and `source_document_id` is nullable).
- Neither matter nor party carries the procedural position 原告/被告. `Party.role`
  (`client|opposing|third_party`) encodes the relationship to the firm; a client can be the
  defendant.

Deriving these from `notes`/`filename`/`role` would fabricate lawyer-entered truth — contrary to
DR-00's manual-truth posture (`.claude/rules/evidence-genie.md` invariant 2). The fields must be
**explicit, lawyer-entered, persisted data**.

## 2. Required T3 persisted data

| Field | Where | New? | Notes |
|---|---|---|---|
| 证据名称 (`evidence_title`) | evidence item | **NEW** | lawyer-entered display name; required for a catalog-ready row |
| 证明内容 (`proof_statement`) | evidence item | **NEW** | lawyer-entered free text, multi-clause Chinese preserved verbatim |
| 提交人诉讼地位 (`litigation_position`) | matter | **NEW** | procedural position of the client party: enum `plaintiff \| defendant` (原告/被告) in M0; extensible later by a follow-up ADR (第三人, appeal roles) |
| Lawyer-controlled display order (`display_order`) | evidence item | **NEW (optional)** | optional non-negative integer, **absence-only** (the property is either present or absent; explicit `null` is not part of the shape); when absent, fallback order = `created_at ASC, id ASC` (the existing seek order). Resolves plan review Low L2 |
| Submitter selection | T3 export input (not persisted) | rule | submitter = the single `role === "client"` party; if a matter has zero or >1 client parties, T3 **refuses and prompts for explicit selection** — never guesses (mirrors the A1 ambiguous-citation posture). `Party` has no stable id, so the export-time selection input identifies the chosen party by its **index in the matter's `parties` array plus a `display_name` echo** (the model refuses if the echo no longer matches, catching reordered/edited parties). **M0 invariant: the matter-level `litigation_position` applies to ALL client parties of the matter; if a matter's client parties could hold different procedural positions, T3 refuses** — a per-party position field would be a follow-up ADR, not silently improvised. Resolves plan review Low L1 |
| 页码 physical page range | evidence item | existing | **`exhibit_page_range` is sufficient**: free-form string (`"1-5"`, `"7"`), nullable; T3 passes it through verbatim; null renders as an explicit blank/needs-input marker, never invented. No format constraint added in M0 |

## 3. Scope boundary

- **Internal lawyer trial-review only** (DR-00 Q1). Not court filing; no official-template
  compliance claim.
- **No seal/custody/tamper-evidence and no A8** (DR-00 consequences).
- **No DOCX/PDF renderer decision in this ADR** — that remains the separate decision recorded in
  the parent plan §2.
- **No T4/T5 schema design** — no 证明对象/三性/proof-gap/contradiction-link fields of any kind.
  T4 stays under-specified; T5 stays design-gated.

## 4. Candidate schema shape

Architecture fact that shapes the design: in `case_box_*` tables **`payload_json` is the canonical
source**; SQLite columns are lifted **only** where an index needs them (schema.ts canonical-source
rule, restated at V5/V6/V8). The V12 precedent (`unlinked_at`/`unlink_reason`) is the repo's model
for additive change: forward-only, nullable, no DEFAULT, cross-column invariants enforced at the
repository layer (no-cross-column-CHECK convention), never a table rebuild.

**Option A (RECOMMENDED) — payload-only additive contract properties; no DDL.**

- `case-box-evidence-item.schema.json`: add optional properties `evidence_title` (string,
  minLength 1), `proof_statement` (string, minLength 1 — a blank proof statement is expressed by
  ABSENCE, never an empty string), `display_order` (integer, minimum 0; absence-only, no `null`
  branch). Not added to `required`.
- `case-box-matter.schema.json`: add optional property `litigation_position`
  (enum `plaintiff|defendant`). Not added to `required`.
- Regenerate contract types (`src/generated/`), extend the AJV validators, bump the contract
  package version (additive minor).
- **No new SQLite columns, no new indexes, no DDL_STATEMENTS_V13, and no
  `CURRENT_SCHEMA_VERSION` increment.** The existing write paths persist the enlarged payload
  unchanged; reads return it from `payload_json` as canonical.
- 序号/ordering: the T3 catalog adapter (plan slice S1) reads the full per-matter evidence list via
  the existing seek-ordered list API, then orders rows by `display_order ASC` (rows without the
  property sort last; ties and absent values fall back to `created_at ASC, id ASC`). This is
  bounded per-matter presentation logic in
  the export model — it does not re-sort a persistence read to mask a persistence bug, and the list
  API's stable seek order is unchanged.

**Option B (NOT recommended now) — additionally lift `display_order` into a SQLite column + index.**
DDL_STATEMENTS_V13 (`ALTER TABLE case_box_evidence_items ADD COLUMN display_order INTEGER;` + a
`(matter_id, display_order, created_at, id)` index) and a `CURRENT_SCHEMA_VERSION` bump to 13.
Only needed if a future surface must paginate/query by lawyer order at SQL level (e.g. a large
sorted catalog UI). T3 export does not need it (whole-matter read, bounded). Defer; if later
required it follows the V12 additive pattern exactly.

Why A over B: mechanism — the only consumer of the new fields (the T3 logical model) reads whole
matters, so an index buys nothing; payload-only keeps the later implementation WI smaller, avoids a
migration entirely, and preserves the option to lift a column later without rework (lifting from
canonical payload is the established V6-style move).

Relation of existing records to T3 rows: **one evidence item = one T3 catalog row** (status filter
decided in S1, default `accepted`; supersession chains show only the live row). No new table; no FK
changes; no join semantics change.

## 5. Migration implications

- **`CURRENT_SCHEMA_VERSION`: no increment required** under Option A (no DDL). It stays 12 in the
  later implementation WI. (Option B, if ever chosen, bumps to 13 with a forward-only additive
  ALTER per the V12 precedent.)
- **Migration/backfill: none.** New properties are optional; existing `payload_json` rows remain
  valid as-is and read as "field absent". No rewrite of existing rows, no data transform, no
  DEFAULT injection.
- **Existing data stays valid**: validators accept the enlarged schema (additive optional);
  round-trip of an old row through the repository preserves it byte-stably.
- **Validation rules (repository layer, per the no-cross-column-CHECK convention)**:
  `evidence_title`, when present, is a non-empty string; `proof_statement`, when present, a
  non-empty string (empty input is rejected or normalized to ABSENT — blank proof content is the
  needs-input state, never a stored empty string); `display_order`, when present, a non-negative
  integer (absence-only — no `null`; no uniqueness constraint — ties resolve deterministically by
  the fallback order); `litigation_position`, when present, one of the enum values. A catalog row missing `evidence_title`/`proof_statement` is **valid data but
  incomplete-for-T3**: the T3 model marks it needs-input; nothing is auto-filled.

## 6. Contract/API implications

- **DTO/export surface (later WIs)**: `CaseBoxEvidenceItem` gains the three optional fields;
  `CaseBoxMatter` gains `litigation_position`. The existing list API
  (`ListEvidenceItemsQuery`/`ListEvidenceItemsPage`) exposes them automatically since rows carry
  full items — no API shape change.
- **Internal-only**: `display_order` raw values are an internal ordering input; T3 exposes the
  computed sequential 序号 (1..n), not the raw order numbers. Submitter selection is an export-time
  input, not persisted on the matter.
- **A10 CanonicalExportModel relationship**: the future `T3CatalogModel` (plan slice S1) is a
  **sibling logical model** that **mirrors the A10-T6 deterministic-serialization pattern**
  (stable sorted-key JSON + sha256 reproducibility unit). Note: `stableStringify` is
  module-private in `a10CanonicalExportModel.ts` and `serializeCanonicalExportModel` is typed to
  `CanonicalExportModel`, so S1 either duplicates the small pattern locally or extracts a shared
  helper in its own governed WI — it does not extend or modify `a10CanonicalExportModel.ts` or the
  A10 citation contract by default.
- **卷X页Y stays supporting-only**: if S1 attaches A10 citation metadata it rides in
  clearly-advisory fields; the `页码` column is always `exhibit_page_range` passthrough and is
  never replaced by a citation (DR-00 Q4 preserved).

## 7. Test obligations for later implementation

- **Schema/contract tests**: enlarged schemas accept new optional fields and still accept legacy
  rows (no `required` growth); generated types match; validator round-trip byte-stable for old rows.
- **Migration tests**: applySchema on a v12 DB is a no-op for Option A (version unchanged, tree
  untouched); conformance suite still green. (If Option B ever lands: V13 forward-only ALTER tests
  per the V12 pattern.)
- **Validation tests**: reject empty `evidence_title`, negative/non-integer `display_order`,
  out-of-enum `litigation_position`.
- **T3 row construction tests (S1)**: 序号 assignment deterministic; `display_order` ordering with
  absent-property fallback to `created_at ASC, id ASC`; byte-stable re-export.
- **Missing-field behavior**: absent `evidence_title`/`proof_statement`/`exhibit_page_range`/
  `litigation_position` produce explicit needs-input/blank markers — never derived from
  filename/notes/role, never guessed.
- **证明内容 preservation**: multi-clause Chinese text verbatim (NFC-normalized only).
- **Submitter selection**: single-client matter auto-selects; zero or multi-client matter refuses
  and requires explicit selection; a selection whose `display_name` echo no longer matches the
  party at the given index refuses (stale selection); a multi-client matter whose client parties
  cannot share the matter-level `litigation_position` refuses.
- **No T4/T5 leakage**: regression asserts no proof-model/三性/质证 fields appear in contract,
  persistence, or the T3 model.
- **Fixture policy**: raw samples under `dev-memo/run/intake/**` are never committed fixtures
  unless separately redacted AND explicitly authorized; tests use synthetic data.

## 8. Explicit non-decisions (this lane approves NONE of these)

- **No schema implementation** (no contract edit, no validator edit, no generated-type change).
- **No `CURRENT_SCHEMA_VERSION` change** and **no migration file / DDL**.
- **No app/native/test/package change.**
- **No renderer/DOCX/PDF generation** (separate decision per the parent plan §2).
- **No custody/seal/tamper-evidence, no A8.**
- **No T4/T5 implementation or schema design.**
- **No raw sample commit.**
- **No new runtime dependency.**

## Effect on gating

With this ADR reviewed and merged, the plan's S0 blocking condition is **design-resolved**: the
later T3 schema implementation WI (contract properties + validators + tests, per §4 Option A) can be
queued as its own governed high-risk WI (persistence category — full broker review-plan + audit +
verify). S1 (T3 logical model) stays blocked until that implementation WI ships. DOCX generation
stays separately blocked on the renderer decision. T4/T5 remain gated.

## References
- `dev-memo/plan-forms-t3-evidence-catalog-00.md` (parent plan; §3 verdict, §4 slices, review Lows).
- `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` (§A sample, §E non-decisions, §H DR-00).
- `services/case-box-persistence/src/sqlite/schema.ts` (`CURRENT_SCHEMA_VERSION = 12`; V7 evidence
  DDL; V12 additive precedent; canonical-source rule).
- `docs/contracts/case-box-contract/schemas/case-box-evidence-item.schema.json`,
  `case-box-matter.schema.json` (current contract state).
- `apps/lawbar-desktop/src/caseBox/export/a10CanonicalExportModel.ts` (the deterministic-
  serialization pattern S1 mirrors; not modified, per §6).
- `.claude/rules/evidence-genie.md` (manual-truth invariant 2), `.claude/rules/cc-suite.md`
  (persistence = high-risk review category).
