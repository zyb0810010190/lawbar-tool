# Plan: WI-brief-doc-asset-impl — Document asset metadata (Option α)

**Status**: READY (revision 1 — review-plan attempt 1 TIMEOUT; attempt 2 with compact packet returned READY (Low-risk) at jobId `review-plan-mpgmc1yg-1tw0u7`; 2 invalid fixtures added per attempt-2 Lows; ready to implement).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Source plan**: `dev-memo/plan-brief-doc-reconcile.md` (READY, commit `d5444ac`) §4.1 + §4.2 + §6 + §8 item 2.
**Source brief**: `docs/product/project-requirements-brief.md` (READY, commit `fe09ea4`) §"R-6", §"R-7".

## Review packet (compact)

### Active plan summary

Three optional fields added to `CaseBoxDocument` (`mime_type`, `byte_size`, `manual_extracted_text`) per Option α of the reviewed doc-reconcile plan. Contract + persistence absorb additively; no cross-row invariants, no helpers, no `allOf` blocks, no new entity, no `additionalProperties` tightening. The persistence-absorption is mechanically lighter than the R-5 chain (commits `17d8103` + `adc3916`): no helper imports, no dep injection in `prepareRegisterDocument`, no new error class. `structuredClone` + `validateDocument` preserve the three fields end-to-end; `factCanonicalProjection`-equivalent canonical comparison for documents — there isn't one today, but R-5 conformance test R5.16/17/18 pattern shows the precedent; for documents, the existing `prepareRegisterDocument` already throws `duplicate_id` on any second registration with the same id, so the Once-style canonical comparison is N/A for documents (no `registerDocumentOnce` exists). The plan therefore drops the "Once canonical comparison" test row that the doc-reconcile plan's §7 anticipated as a generic obligation — there is no `registerDocumentOnce` v1 surface to test against.

### Exact target files

Schemas — `docs/contracts/case-box-contract/schemas/`:
- `case-box-document.schema.json` (add three optional fields).

TS types — `docs/contracts/case-box-contract/src/generated/`:
- `case-box-document.ts` (regenerated via `npm run gen:types`).

Fixtures — `docs/contracts/case-box-contract/fixtures/`:
- `valid/document-with-mime-and-size.valid.json` — all three fields populated.
- `valid/document-with-manual-extracted-text.valid.json` — markdown document with extracted text.
- `valid/document-omits-asset-fields.valid.json` — proves all three fields are optional-omitted.
- `invalid/document-negative-byte-size.json` — `byte_size = -1` rejected by `minimum: 0`.
- `invalid/document-manual-extracted-text-over-maxlength.json` — string of length > 200000 rejected by `maxLength`.

Contract tests — `docs/contracts/case-box-contract/tests/`:
- `contract.test.mjs` — 3 valid + 2 invalid sweep entries.

Persistence tests — `services/case-box-persistence/tests/conformance/`:
- `runCaseBoxPersistenceConformance.mjs` — append "R-6 doc-asset" section with cases R6.1..R6.3 covering register→get→list preservation for the three fields.

NOT touched (per user instruction + plan §10):
- `docs/contracts/case-box-contract/src/*.ts` (validators recompile via Ajv automatically with the new optional fields; no source edits needed).
- `docs/contracts/case-box-contract/src/index.ts` (no new exports).
- `services/case-box-persistence/src/**.ts` (no helper additions; absorption is structural via existing `validateDocument` + `structuredClone`).
- `docs/adr/**` (Step-0 addendum already landed in commit `b534db0`; no further ADR amendment needed for the field additions).
- `docs/product/**` (already updated in `b534db0`).
- OCR packages.
- Any UI / mini-program / sync / SQLite / ABI.

### Exact acceptance criteria

1. Three new optional fields land on `CaseBoxDocument` schema: `mime_type` (string), `byte_size` (integer ≥ 0), `manual_extracted_text` (string, `maxLength: 200000`). No `additionalProperties` tightening. No invariant linking them to other fields.
2. Generated TS type for `CaseBoxDocument` includes all three fields as optional.
3. Three new valid fixtures + two new invalid fixtures cover the v1 acceptance bar per §7 of the doc-reconcile plan.
4. `npm --prefix docs/contracts/case-box-contract test` is green; no Ajv `strictRequired` warning is logged.
5. Persistence conformance covers register→get→list preservation of all three fields. `npm --prefix services/case-box-persistence test` is green.
6. `npm --prefix docs/contracts test` (OCR contract) stays green (no regression).
7. No new runtime dependency added.
8. No new persistence interface method added.
9. `loc-guardian:scan` reports 0 over fail.

### Exact out-of-scope list

- No new entity (no `CaseBoxFileAsset` — Option γ deliberately deferred).
- No extraction engine. No text-layer detection. No mime-type sniffer. No file-size derivation from disk.
- No file-storage engine; `storage_uri` continues as the existing canonical pointer.
- No write API for updating `manual_extracted_text` after initial registration. v1 sets the field at registration time (lawyer pastes before submit). A future "update document metadata" API is OUT OF SCOPE.
- No mini-program upload/download.
- No sync bridge code.
- No API/gateway/UI.
- No SQLite / `better-sqlite3` / native modules.
- No auth/cloud/LLM.
- No `additionalProperties: false` tightening on any case-box schema.
- No invariant link between `mime_type` and any other field (e.g., NO "if mime_type == application/pdf then ocr_job_id must be set" — that's text-extraction-dispatch logic, post-v1).
- No git push.

### Essential references

- `dev-memo/plan-brief-doc-reconcile.md` §4.1 (three options), §4.2 (Option α picked), §6 (contract surface summary), §7 (test sketch), §8 item 2 (this WI's scope).
- `docs/contracts/case-box-contract/schemas/case-box-document.schema.json` — base for the three additions (current fields verified at commit `b534db0`).
- `dev-memo/plan-brief-matter-type.md` + `dev-memo/plan-brief-matter-type-persistence.md` — R-5 precedent for additive-optional style.

### Review questions for the reviewer

1. The plan claims "no Once canonical comparison test" because no `registerDocumentOnce` exists today. Verify by code reading `services/case-box-persistence/src/inMemoryDocument.ts` + `inMemoryRepo.ts` + `types.ts` — does any "Once"-style document write API exist that would need the three new fields included in its canonical projection?
2. The plan adds no helpers, no dep injection, no new error classes. Is this absorption-by-omission correct, or does any aggregation path (`inMemoryAggregations.ts` `getDocumentDetail`) silently drop the fields?
3. Is `maxLength: 200000` for `manual_extracted_text` defensible? Existing free-text fields in the contract use much smaller maxLengths (`maxLength: 4000` for matter free-text; `maxLength: 2000` for some document lifecycle text fields). The doc-reconcile plan §3.3 recommended 200000; this is a long-document allowance.
4. Should `byte_size` carry an upper bound? The schema currently has no `maximum`. A pathological caller could submit `byte_size = Number.MAX_SAFE_INTEGER`. The plan does NOT bound it because the integer is descriptive (it doesn't allocate memory); but the reviewer may disagree.
5. Per the R-5-persistence chain precedent, the absorption WI should also update `inMemoryAggregations.ts` `getDocumentDetail` and any read paths that hand-project the document row. The plan asserts none do — confirm.

---

## §1 Context

The doc-reconcile plan committed at `d5444ac` recommended **Option α** (minimal additive: three optional fields on `CaseBoxDocument`) and queued the implementation as WI-brief-doc-asset-impl. The doc reconciliation itself landed at `b534db0` — product-target-architecture and case-box-step-0 boundary now reference the original-file-retention invariant + the OCR-vs-text-extraction split. This WI delivers the three contract fields the doc-reconcile plan reserves.

The persistence absorption is **lighter than the R-5 chain**:
- R-5 ten contract changes including two cross-row invariants → R-5-persistence wired `assertValidDocumentSupersession` + `assertValidMatterSuccessor` at `prepareCreateMatter` / `prepareRegisterDocument` with dep injection.
- This WI three optional scalars with NO invariants → no helper wiring, no dep injection, no new error class. `structuredClone` + `validateDocument` preserve the fields automatically.

The previous `b534db0` commit established the original-file-retention invariant at the docs level. This WI gives the invariant **two metadata-supporting fields** (`mime_type` + `byte_size`) and the **manual-paste fallback storage** (`manual_extracted_text`) at the contract level. The invariant itself remains a product-direction statement, not a schema-enforced rule.

---

## §2 Per-file diff

### §2.1 `docs/contracts/case-box-contract/schemas/case-box-document.schema.json`

Add to `properties`:

```json
"mime_type": {
  "type": "string",
  "maxLength": 255,
  "description": "Optional IANA media type of the retained original file (e.g. application/pdf, image/png, text/markdown, application/vnd.openxmlformats-officedocument.wordprocessingml.document). Lawyer-pickable hint; v1 has no automated sniffer. R-7 metadata."
},
"byte_size": {
  "type": "integer",
  "minimum": 0,
  "description": "Optional file size in bytes of the retained original. Lawyer-supplied or derived at ingestion time (engine choice deferred to post-v1 text-extraction WI). R-7 metadata."
},
"manual_extracted_text": {
  "type": "string",
  "maxLength": 200000,
  "description": "Optional lawyer-pasted extracted text for documents not eligible for automated text extraction (PDF text-layer / Word / MD; post-v1). v1 manual-paste fallback per project-requirements-brief §6 + plan-brief-doc-reconcile §3.3. NOT an extractor output."
}
```

No `required` change. No `allOf` change. No cross-field invariant.

### §2.2 `docs/contracts/case-box-contract/src/generated/case-box-document.ts`

Regenerated via `npm run gen:types`. Diff is mechanical (three new optional properties on the TypeScript interface).

### §2.3 Fixtures (new files)

Valid (`fixtures/valid/`):

- `document-with-mime-and-size.valid.json` — `purpose: "engagement_contract"`, `mime_type: "application/pdf"`, `byte_size: 102400`, no `manual_extracted_text`.
- `document-with-manual-extracted-text.valid.json` — `purpose: "contract_review_input"`, `mime_type: "text/markdown"`, `byte_size: 4096`, `manual_extracted_text: "Paragraph 1\n\nParagraph 2 with the legal-document body."`.
- `document-omits-asset-fields.valid.json` — minimal document with NONE of the three new fields (proves they remain optional-omitted).

Invalid (`fixtures/invalid/`):

- `document-negative-byte-size.json` — `byte_size: -1` rejected by `minimum: 0`. Carries `_invalid_reason` + `_target_schema`.
- `document-manual-extracted-text-over-maxlength.json` — `manual_extracted_text` of length 200001 rejected by `maxLength`. Carries `_invalid_reason` + `_target_schema`.
- `document-mime-type-over-maxlength.json` — `mime_type` of length 256 rejected by `maxLength: 255`. Added per attempt-2 review Low #1.
- `document-byte-size-non-integer.json` — `byte_size: 12.5` rejected by `type: "integer"`. Added per attempt-2 review Low #2.

### §2.4 `docs/contracts/case-box-contract/tests/contract.test.mjs`

Append five entries under a new section labeled "WI-brief-doc-asset-impl — R-6/R-7 Option α":

- 3 valid fixture sweep tests.
- 4 invalid fixture sweep tests (byte_size negative + non-integer; manual_extracted_text + mime_type over maxLength).

### §2.5 `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs`

Append three cases under a new "R-6 doc-asset" section:

- **R6.1** — registerDocument preserves `mime_type` + `byte_size` through `getDocument` AND `listDocuments`.
- **R6.2** — registerDocument preserves `manual_extracted_text` through `getDocument` AND `listDocuments`.
- **R6.3** — registerDocument with NONE of the three fields stores them as undefined; `getDocument` returns the row without the fields (proves optional-omitted survives the round-trip).

No invariants test needed (no cross-row invariants in this WI). No new helpers to test.

### §2.6 No other files

Explicitly not touched (verified by code reading at this commit):
- `inMemoryDocument.ts` — `prepareRegisterDocument` already validates via the recompiled `validateDocument` and stores via `structuredClone`. No code edit.
- `inMemoryAggregations.ts` — `getDocumentDetail` returns `structuredClone(document)` directly; new fields ride along automatically.
- `inMemoryRepo.ts` — no new dep, no new method.
- `types.ts` — `ListDocumentsQuery` does NOT add a `mime_type` filter (out of scope for this WI; filters can be added later if a use case demands).
- `case-box-document.ts` (generated) — regenerated only.

---

## §3 Test plan

### §3.1 Contract tests (5 new)

In `tests/contract.test.mjs`:

```js
test("valid: document-with-mime-and-size passes", () => {
  assert.equal(validateDocument(readJson(join(validDir, "document-with-mime-and-size.valid.json"))), true, errs(validateDocument));
});
// ... 4 more
```

### §3.2 Persistence conformance tests (3 new — R6.1, R6.2, R6.3)

Each follows the existing R5.* pattern: seed matter+doc; register with overrides; assert `getDocument` and `listDocuments` round-trip.

### §3.3 No fact-side / no evidence-side / no docket-side new tests

These entities are unaffected.

### §3.4 No Ajv strictRequired warnings

The three new fields are all in `properties`, none are in `required`. No `if/then/else` references them. Verify by running `npm --prefix services/case-box-persistence test` and grepping for `strictRequired` in stderr.

---

## §4 LOC budget

| File | Pre-WI | Post-WI delta | Threshold | Status |
|---|---|---|---|---|
| `case-box-document.schema.json` | 162 | +~30 (3 properties) | schemas warn 600 / fail 1000 | fine |
| `case-box-document.ts` (generated) | regenerated | +~6 | exempt | exempt |
| `contract.test.mjs` | 708 | +~25 (5 tests) | tests warn 700 / fail 1200 | warning-zone (already), well under fail |
| `runCaseBoxPersistenceConformance.mjs` | ~3700 | +~45 (3 cases) | shared-harness exempt | exempt per `.claude/rules/loc-guardian.md` |
| 3 new valid fixtures | 0 | +~50 total | fixtures warn 800 / fail 1500 | each <30 LOC |
| 2 new invalid fixtures | 0 | +~30 total | fixtures warn 800 / fail 1500 | each <30 LOC |

No file approaches a fail threshold. No extraction needed.

---

## §5 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Low | A future text-extraction WI may need `mime_type` to be required, not optional. | Defer to the post-v1 text-extraction WI. v1 contract surface stays optional; required-when-extraction logic is the post-v1 ADR's responsibility. |
| 2 | Low | `maxLength: 200000` for `manual_extracted_text` is large; a single document could carry up to ~200KB of text. | Acceptable. Legal documents are commonly large; truncation is worse than retention. Persistence storage is the user's local Mac. |
| 3 | Low | A second-registration of the same document id would now silently differ in `mime_type` etc., but `registerDocument` already throws `duplicate_id` on second-write — the new fields ride along but cannot cause "successful divergence". | No mitigation needed. The plan §"Active plan summary" already documents this. |
| 4 | Low | `inMemoryAggregations.ts` `getDocumentDetail` does `structuredClone(document)` per code reading; new fields preserved. If a future read-path is added that hand-projects, the new fields could be dropped silently. | Document the round-trip preservation in R6.1/R6.2 conformance tests. Future read-paths must add similar coverage. |
| 5 | Low | `byte_size` has no upper bound. Pathological caller could send `Number.MAX_SAFE_INTEGER`. | Acceptable. Descriptive integer; no memory allocation. Future API-shape work may add bounds. |

No Critical / High / Medium risks.

---

## §6 Sequencing (within this WI)

Test-first inside the same commit, per the R-5-persistence precedent:

1. Add the 5 new fixtures (`fixtures/valid/` + `fixtures/invalid/`) — files exist, schema not yet updated, so fixture sweep tests would fail.
2. Edit `case-box-document.schema.json` (add three properties).
3. Run `npm --prefix docs/contracts/case-box-contract run gen:types` to regenerate TS.
4. Add the 5 contract.test.mjs entries.
5. Add the 3 R6.* conformance cases.
6. Run all three test commands.
7. LOC scan (manual `wc -l`).
8. cc-suite audit (mini, Path 1).
9. Fix Critical/High/Medium findings; record any deferred Low in `dev-memo/deferred-audit-findings.md`; cc-suite verify with audit artifact if fixes applied.
10. Commit (plan + impl in one commit, per the R-5-persistence precedent).

---

## §7 References

- `dev-memo/plan-brief-doc-reconcile.md` (READY at commit `d5444ac`; jobId `review-plan-mpgknx49-ywpiv4`).
- `docs/contracts/case-box-contract/schemas/case-box-document.schema.json` (current shape post-R-5).
- `dev-memo/plan-brief-matter-type-persistence.md` (R-5-persistence precedent for additive absorption).
- `.claude/rules/cc-suite.md` §"High-risk WIs" (not triggered: this is a small additive contract change without security/cross-row implications) + §"Required recording".
- `.claude/rules/autonomy.md` (no hard-stop triggered).
- `.claude/rules/loc-guardian.md` (all touched files within thresholds).

---

## §8 Stop condition

This plan is stale or superseded when:

- The WI commits — file moves from `DRAFT-PENDING-REVIEW` to a recorded historical reference at the same path.
- A future R-6 amendment in the brief alters the field set or types.
- The post-v1 text-extraction WI (`WI-brief-doc-text-extract-policy`) lands and supersedes the manual-paste model.
