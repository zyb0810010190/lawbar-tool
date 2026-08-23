# T3 证据目录及说明 — implementation plan (FORMS-T3-PLAN-00)

**Date**: 2026-07-03. **Type**: PLAN (documentation / design / governance only — no product code, no
schema, no renderer, no tests, no fixtures). **Lane**: WI-FORMS-T3-IMPLEMENTATION-PLAN-00.
**Status**: plan for a *future* T3 implementation — **not** implementation-authorizing. The future
implementation is **BLOCKED pending a schema ADR** (see §3 verdict).

> **Binding inputs.** `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` (FORMS-SPEC-A10-T3-T5-00) §A
> sample structure + §H **DR-00** (2026-07-02): T3 is an **internal lawyer trial-review tool**, NOT a
> court-filing artifact this phase; **DOCX-first** direction with **no renderer implementation
> authorized**; description column label is **`证明内容`**; **`页码` = physical bundle page range
> first**, the A10 `卷X页Y` citation is supporting metadata later only and never replaces `页码`. T4
> remains under-specified; T5 remains design-gated; no custody/seal/A8 requirement is implied.

## Review packet (compact)

1. **Summary**: plan the narrowest future implementation of the T3 evidence catalogue + description
   form (证据目录及说明) for internal lawyer trial review, per DR-00. This lane writes ONE plan doc +
   queue governance artifacts; it implements nothing. Key finding: two of the four required columns
   (证据名称, 证明内容) and the header litigation-status field have **no persisted source today**, so
   the first implementation slice is **blocked pending a schema ADR** (§3).
2. **Exact target files (this lane)**: `dev-memo/plan-forms-t3-evidence-catalog-00.md` (this file),
   `dev-memo/run/queue.md` + `queue.linted` + `queue.reviewed` + `queue.governed` +
   `dev-memo/run/reviews/queue-review-120.md` (governance artifacts).
3. **Acceptance criteria (this lane)**: plan records product target, output target, data-model
   verdict (schema mutation required → future impl blocked pending schema ADR), staged slice
   proposal, expected tests, and explicit non-decisions; committed diff is docs/governance only; raw
   samples stay untracked; check-queue + check-contract-integrity pass; review-plan READY.
4. **Out of scope**: any T3/T4/T5 implementation, schema mutation, renderer/DOCX/PDF implementation,
   custody/seal/A8, IPC, fixtures, tests, app/native source, raw-sample commit.
5. **Essential references**: `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` (§A, §E, §H DR-00);
   `docs/adr/ADR-evidence-a10-court-fileable-export.md` (A10-DESIGN-00 §10 — forms gated behind a
   form-spec); `docs/product/evidence-m0-content-inventory.md` (surface 4 证据目录).
6. **Review questions**: (a) does the plan stay implementation-free? (b) is the schema-blocked
   verdict correctly derived from the current contract/schema state? (c) do the staged slices keep
   T4/T5 gated and §E non-decisions intact? (d) is the DOCX renderer decision correctly recorded as
   a separate future decision rather than made here?

## 1. Product target

- **Internal lawyer trial-review 证据目录及说明** (DR-00 Q1): a fast evidence lookup / review /
  argument-preparation aid used by the lawyer during trial preparation and in the courtroom.
- **NOT a court-submission artifact in this phase.** No official court-template compliance claim, no
  signature/seal placement requirement, no custody/tamper-evidence requirement (DR-00 consequences).
  The sample's signature/sign-off footer (提交人签名及电话 / 提交时间 / 签收人 / 签收时间) is
  layout reference only — for internal review it may render as blank labels or be omitted; that is a
  rendering-phase choice, not a compliance requirement.
- Fidelity target is the *content shape* of the real sample
  (`dev-memo/run/intake/forms-samples/示例-证据目录及说明-一审.pdf`, read-only input, never
  committed): title, submitter litigation status (☑原告/被告), submitter name, 4-column table,
  sequential rows, copies/originals footer note.

## 2. Output target

- **DOCX-first direction** (DR-00 Q2): lawyers edit/annotate the output. No PDF requirement this
  phase.
- **The repo has NO DOCX generation mechanism today.** No `docx`/`docxtemplater`/`officegen`/JSZip
  or similar dependency exists in any `package.json`, and no PDF writer either. Therefore a **later
  renderer choice is REQUIRED before any T3 DOCX slice** and is recorded here as an open decision,
  NOT made in this plan:
  - candidate A — a pure-JS DOCX library (e.g. `docx` npm package): new **runtime dependency** →
    [[autonomy]] hard-stop, needs explicit approval + cc-suite review;
  - candidate B — DOCX-XML template fill (hand-built OOXML from a vendored template): no new
    dependency but more bespoke code surface;
  - candidate C — app preview/table surface first, DOCX later (defers the choice; preview is a
    `Type: UI` WI needing a concrete `Design artifact:` per `UI-GATES.md`).
- Until that decision, the implementable layer is the **logical export model** (§4 slice S1), which
  is renderer-independent by design.

## 3. Data model assumptions and verdict

Required visible columns (DR-00; sample §A):

| # | Column | Persisted source today | Verdict |
|---|--------|------------------------|---------|
| 1 | `序号` | none — no order field on `case_box_evidence_items` | **synthesizable** (deterministic sort `created_at ASC, id ASC` → row index + 1); ordering rule must be fixed in the impl WI. Review note (Low): this is a stable *technical* order, not necessarily the lawyer-intended catalogue order — the S0 ADR must decide whether T3 needs a lawyer-controlled display-order field |
| 2 | `证据名称` | **missing** — evidence items have no title/name field; contract `case-box-evidence-item.schema.json` has no such property | **schema mutation required** |
| 3 | `证明内容` | **missing** — no dedicated proof-statement field; generic optional `notes` is not semantically bound to 证明内容 | **schema mutation required** |
| 4 | `页码` | `exhibit_page_range` (free-form string, e.g. `"1-5"`, `"7"`, nullable) — `services/case-box-persistence/src/sqlite/schema.ts` V7 table, contract schema | **supported today**; missing/null must render as an explicit blank/unknown, never invented |

Header fields:

- **名称/姓名 (submitter name)** — derivable from `CaseBoxMatter.parties` (`role === "client"`,
  `display_name`). Supported today. Review note (Low): the schema does not enforce a single
  `client` party nor identify the exporting submitter — the S0 ADR (or S1 model) must define an
  explicit submitter-selection rule or export-request field for multi-client matters.
- **提交人诉讼地位 (☑原告/被告)** — **missing**. `Party.role` is `client | opposing | third_party`
  (relationship to the firm) and `party_side` on evidence is `our | opposing`; neither encodes the
  procedural position 原告/被告 (a client can be the defendant). Inferring 原告 from `client` would
  fabricate a court-facing-shaped fact — contrary to the manual-truth posture
  (`.claude/rules/evidence-genie.md` invariant 2). **Schema/contract addition required** (a
  lawyer-entered litigation-position field at matter or export-request level).

Supporting metadata:

- The A10 `卷X页Y` citation (A10-T1 `a10CitationContract.ts`, sourced from `DocumentPage` via
  `buildExportCitations`) MAY appear later as **supporting-only** metadata (e.g. an extra advisory
  column or tooltip) and MUST NOT replace `页码` (DR-00 Q4).

**Verdict: T3 CANNOT proceed without schema mutation.** 证据名称 and 证明内容 (and the header
litigation-status field) have no persisted, lawyer-entered source. Repurposing `notes` or deriving a
name from the linked document's `filename` (a machine filename; also nullable link) would violate
DR-00's lawyer-entered-truth intent. Per this lane's instruction, the future implementation WI is
marked **BLOCKED pending a schema ADR** — no direct code is planned around the gap. The schema ADR
(slice S0) must decide field names, nullability, contract + `CURRENT_SCHEMA_VERSION` bump, and
migration; it requires explicit approval per forms-spec §E and cc-suite review-plan (persistence =
high-risk category).

## 4. Implementation slice proposal (future WIs — none authorized here)

Staged, narrowest-first; each slice is its own governed WI with its own review:

- **S0 — schema ADR + migration (BLOCKING; first)**: ADR proposing `case_box_evidence_items`
  additions for evidence display name + 证明内容 proof statement, and the submitter
  litigation-position field (placement decided in the ADR: matter-level vs export-request-level).
  The ADR must also decide (per review-plan Lows): a lawyer-controlled display-order field vs the
  synthesized `created_at ASC, id ASC` order, and the submitter-selection rule for multi-client
  matters. Contract schema + generated types + `CURRENT_SCHEMA_VERSION` bump + migration +
  conformance tests. High-risk (persistence): broker review-plan + audit + verify required. **All later slices
  are blocked until S0 ships.**
- **S1 — T3 logical export model / adapter**: a deterministic `T3CatalogModel` (rows: 序号,
  证据名称, 证明内容, 页码; header: title, litigation status, submitter name; footer note) built
  from persisted data, mirroring the A10-T6 pattern (`a10CanonicalExportModel.ts`:
  `stableStringify` + sha256 reproducibility). Renderer-independent; no DOCX. Optional supporting
  `卷X页Y` metadata carried as clearly-advisory fields, excluded from replacing 页码.
- **S2 — T3 review table / preview surface (optional, after S1)**: in-app read-only table over the
  S1 model. `Type: UI` WI — requires a concrete `Design artifact:` reference per `UI-GATES.md`.
- **S3 — T3 DOCX generation (LAST; double-gated)**: only after (a) the renderer decision (§2) is
  made and approved — candidate A implies a new runtime dependency (autonomy hard-stop) — and (b)
  S1 is shipped so DOCX is a pure rendering of the logical model.

This plan does **NOT** authorize T4 or T5 work of any kind, and does not expand their design.

## 5. Tests expected for later implementation (recorded for S1+; none written here)

- **Row ordering**: deterministic 序号 assignment from the fixed sort; stable across re-export
  (byte-stable serialization per the A10-T6 pattern).
- **Physical page range handling**: `页码` passthrough of `exhibit_page_range`; missing/null/unknown
  ranges render as explicit blank/unknown markers, never guessed or invented.
- **证明内容 preservation**: the lawyer-entered proof statement round-trips verbatim (multi-clause
  Chinese text, e.g. `1、…；2、…`), NFC-normalized only per the canonical-model convention.
- **卷X页Y supporting-only**: when A10 citation metadata is present it appears only in advisory
  fields; assert `页码` still equals the physical range and the citation never substitutes for it.
- **No T4/T5 behavior**: regression tests assert the T3 surface introduces no 举证质证表 proof-model
  fields and no structured 质证记录 output.
- **Fixture policy**: raw samples under `dev-memo/run/intake/**` MUST NOT become test fixtures.
  Fixtures are synthetic, or separately redacted AND explicitly authorized first.
- Test placement follows existing patterns: persistence behavior in
  `services/case-box-persistence/tests/*.test.mjs` (B8 hardening style), export-model golden tests
  in `apps/lawbar-desktop/tests/*.unit.test.mjs` (A10-T6 golden style).

## 6. Explicit non-decisions (this lane approves NONE of these)

- **No forms implementation** in this lane (no T3 code of any slice).
- **No schema mutation** (S0 is proposed, not performed; `CURRENT_SCHEMA_VERSION` unchanged).
- **No renderer/DOCX/PDF implementation** and no renderer choice made (§2 records candidates only).
- **No custody/seal/tamper-evidence** and **no A8** (DR-00: not implicated for internal review).
- **No T4/T5 implementation or design expansion** (T4 stays under-specified; T5 stays design-gated).
- **No raw sample commit** (input-only under `dev-memo/run/intake/forms-samples/`).
- **No new runtime dependency** (candidate A would need explicit approval later).

## 7. Blocked/ready state

- **Future T3 implementation WI: BLOCKED pending the S0 schema ADR** (证据名称 + 证明内容 +
  litigation-position fields). Nothing else about T3 is blocked: the ordering rule, 页码 source,
  submitter-name source, logical-model shape, and test plan above are ready inputs for S0/S1
  planning.
- **DOCX generation: additionally blocked on the renderer decision** (§2) — a separate future
  decision record.

## References
- `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` (§A sample structure; §E non-decisions; §H DR-00).
- `docs/adr/ADR-evidence-a10-court-fileable-export.md` (A10-DESIGN-00 §7/§10/§13).
- `docs/product/evidence-m0-content-inventory.md` (surface 4 证据目录; surface 10 export package).
- `docs/contracts/case-box-contract/schemas/case-box-evidence-item.schema.json` (current evidence
  contract — no title / proof-statement fields).
- `services/case-box-persistence/src/sqlite/schema.ts` (`CURRENT_SCHEMA_VERSION = 12`; V7
  `case_box_evidence_items` DDL).
- `apps/lawbar-desktop/src/caseBox/export/a10CanonicalExportModel.ts` (deterministic-serialization
  pattern S1 mirrors) + `a10CitationContract.ts` (卷X页Y supporting metadata source).
- `.claude/rules/evidence-genie.md` (manual-truth invariant 2; A10 invariant 9),
  `.claude/rules/autonomy.md` (new-runtime-dependency hard stop), `UI-GATES.md` (S2 design-artifact
  gate).
