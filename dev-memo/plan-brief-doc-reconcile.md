# Plan: WI-brief-doc-reconcile — Document-Asset Reconciliation

**Status**: READY (revision 3 — third review-plan returned READY with Low-risk clarifications at jobId `review-plan-mpgknx49-ywpiv4`; two Lows applied opportunistically: AC#4 "two fields" → "three fields"; §8 item 2 fixture count aligned to §7).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Source brief**: `docs/product/project-requirements-brief.md` (status READY, commit `fe09ea4`) §"R-2", §"R-4", §"R-6", §"R-7", §"R-8", §"Suggested follow-up WIs" item 2.
**Predecessor closure**: R-5 chain complete at commit `adc3916` (persistence absorption) → unblocks this WI.

## Review packet (compact)

### Active plan summary

This is the **document-asset reconciliation plan-WI**. It is **plan-only**: no contract schemas, persistence implementations, ADRs, or product summaries are modified by this commit — only `dev-memo/plan-brief-doc-reconcile.md` lands. The plan resolves the three docs-level reconciliation entries the brief surfaced (R-4 multi-user demotion, R-7 original-file retention promotion, R-8 LLM indefinite-postpone) AND defines the **OCR-vs-text-extraction split** at the contract / ADR level, including a contract-shape recommendation for original-file metadata.

Scope is intentionally bounded as the brief's "Suggested follow-up WI #2" envisaged (docs reconciliation), but extended to also produce a small contract-design recommendation so that the post-v1 text-extraction work and the post-v1 mini-program download work have a single contract surface to attach to (no scattered amendments later). The contract additions themselves are NOT shipped by this plan — they are queued as the next follow-up implementation WI (WI-brief-doc-asset-impl).

### Exact target files (this plan-WI)

Plan output (CREATED):
- `dev-memo/plan-brief-doc-reconcile.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `docs/contracts/case-box-contract/**` (schemas, src, tests, fixtures).
- `services/case-box-persistence/**`.
- `docs/adr/**` (case-box-step-{0..8}, sync-bridge-architecture, client-application-surface, etc.).
- `docs/product/product-target-architecture.md`.
- `docs/product/project-requirements-brief.md`.
- Any OCR package (`services/ocr-*/**`, `docs/contracts/ocr-worker-contract/**`).
- Any UI / mini-program / sync code.

The plan **recommends** changes to several of those files via follow-up WIs (see §8). Each follow-up WI is itself a separately authorized, separately reviewed, separately committed unit.

### Exact acceptance criteria

1. The plan is committed alone (one file). No code, no schemas, no ADRs, no product-doc edits, no commit-hook bypass, no push.
2. The plan resolves R-4 + R-7 + R-8 docs-only reconciliation items by **describing** the product-summary edits a follow-up docs-only WI would make. The plan does NOT make those edits.
3. The plan defines the **OCR-vs-text-extraction split** explicitly:
   - **v1 behavior**: OCR (paddleocr-onnx local) is for **scanned/image PDFs and image files / screenshots** only. v1 day-one produces at most ONE automated artifact per document (an OCR artifact, if eligible). Files identifiable as PDF-with-text-layer / `.docx` / `.md` / other office/text formats are accepted for retention only; lawyer recourse for searchable text is the manual-paste fallback.
   - **Post-v1 dispatch policy** (engine TBD, decided in WI-brief-doc-text-extract-policy): may route a single document to OCR, to text-extraction, to both, or to neither. May support page-level or artifact-level extraction with multiple artifacts per document. v1 does NOT pre-decide.
   - Neither pipeline destroys the original. Original-file retention §4.3 invariant holds across both.
4. The plan **recommends ONE** of three options for original-file metadata modeling:
   - Option α: extend existing `CaseBoxDocument` with three new optional fields (`mime_type`, `byte_size`, `manual_extracted_text`).
   - Option β: leave `CaseBoxDocument` unchanged; defer mime/size to a future WI.
   - Option γ: introduce a new `CaseBoxFileAsset` entity; `CaseBoxDocument` references it.

   The plan picks **Option α** (additive minimal extension) with reasoning in §4.1. It does NOT ship the schema diff in this commit; that lands in the follow-up impl WI.
5. The plan declares **original-file retention** as a load-bearing v1 invariant by NAMING the four ingestion paths under which retention applies (Mac picker / URL / future WeChat upload / future scanner) and the storage shape (`storage_uri` + `content_hash` already in `CaseBoxDocument`).
6. The plan declares **authorization posture for opens vs downloads**:
   - Mac local open: no authorization gate (the Mac process IS the lawyer).
   - Mini-program download (post-v1): full gate chain (auth + sync grant + privilege resolver + confidentiality resolver + audit event).
7. The plan lists exact follow-up WIs to be opened after this plan commits (none implicitly authorized).
8. cc-suite review-plan returns READY (or only Low-risk clarifications).

### Exact out-of-scope list

- **No engine choice**. The OCR engine is unchanged (paddleocr-onnx). The text-extraction engine is STOP-AND-ASK; this plan does NOT pick it.
- **No new runtime dependency**.
- **No OCR package edits**. The contract's `ocr-worker-contract` is unchanged.
- **No mini-program code**. The post-v1 SYNC reconciliation program (R-1/R-2/R-3) remains the path for any mini-program work; this plan does not pre-empt it.
- **No sync-bridge code or design changes**. References sync-bridge-architecture.md as-is.
- **No SQLite Phase B**.
- **No ABI remediation**.
- **No auth provider choice**.
- **No cloud-vendor choice**.
- **No LLM design**.
- **No git push**.
- **No implementation of the R-5 follow-up persistence absorption** — that landed at commit `adc3916`.
- **No edits to other reviewed ADRs** (case-box-step-1..8, client-application-surface, sync-bridge-architecture, security-signoff). Those stay as-is until their own follow-up WIs.

### Essential references

- `docs/product/project-requirements-brief.md` §"R-2", §"R-6", §"R-7", §"R-8", §6, §8, §"Suggested follow-up WIs" item 2.
- `docs/adr/case-box-step-0-boundary.md` §4 (data residency), §5 (cloud / external OCR / LLM opt-in), §"Cross-cutting Invariants".
- `docs/contracts/case-box-contract/schemas/case-box-document.schema.json` (current fields: `filename`, `content_hash`, `storage_uri`, `ocr_job_id`, `doc_type`, `purpose`, `status`).
- `docs/adr/sync-bridge-architecture.md` (referenced; not changed).
- `docs/product/product-target-architecture.md` §"Data Residency", §"Future Work Items".

### Review questions for the reviewer

1. Is the OCR-vs-text-extraction split correctly described as "orthogonal pipelines triggered by mime/extension"? Could a single document legitimately need both pipelines (e.g., a PDF with both a text layer AND scanned images that need OCR)? If so, the split needs a more nuanced framing.
2. Is Option α (`mime_type` + `byte_size` on `CaseBoxDocument`) the right recommendation, or does the "file-asset is a separate entity" framing (Option γ) better fit a future world with multiple files per document (e.g., contract + redacted copy + signed version)?
3. Is the brief's `R-7` "promote original file retention to cross-cutting invariant" satisfied by appending a single bullet to `case-box-step-0-boundary.md` §"Cross-cutting Invariants", or does it deserve its own short ADR (e.g., `case-box-step-9-original-file-retention.md`)?
4. Does the `R-2` mini-program download model (gate chain: auth + grant + privilege + confidentiality + audit) need a contract surface this WI defines, or is it entirely a post-v1 SYNC reconciliation concern?
5. Are R-4 and R-8 status flips really "docs-only" — i.e., do they require any contract or persistence ramification? (Brief currently says docs-only.)

---

## §1 Context

`docs/product/project-requirements-brief.md` (status `READY`, commit `fe09ea4`) carries nine reconciliation entries (R-1..R-9). The R-5 chain (matter-type contract + persistence) is fully resolved as of commit `adc3916`. Several remaining entries are docs-only product-summary tightenings and one (R-6) is a v1/post-v1 boundary clarification with no immediate code:

- **R-4** — Single-firm-multi-user phase tightened from "near-future" to "indefinitely deferred". Status: docs-only update to `product-target-architecture.md` Future Work Items.
- **R-6** — Document text extraction (non-OCR) is post-v1; engine STOP-AND-ASK. v1 day-one supports PDF / Word / MD ingestion-and-retention + manual-paste fallback only. Status: brief is clear; ADRs and product summary need to reflect the OCR-vs-text-extraction split for discoverability.
- **R-7** — Original-file retention is load-bearing v1 invariant. Status: brief is clear; `case-box-step-0-boundary.md` already references content-hash-addressed storage but does NOT explicitly call out "retain original verbatim" as a cross-cutting invariant.
- **R-8** — AI / LLM indefinitely postponed. Status: brief is clear; `product-target-architecture.md` Future Work Items still lists `CASE-BOX Step 8 LLM extractor (feature-flagged, opt-in per case)` as a normal future WI rather than indefinitely-deferred.

This plan-WI delivers a single bounded recommendation covering all four entries plus the original-file-metadata contract shape that the post-v1 text-extraction work (R-6 follow-up) and the post-v1 mini-program download work (R-2 group) will both attach to. It does NOT make the follow-up edits — it queues them.

---

## §2 Scope

### In scope (this plan-WI)

Produce `dev-memo/plan-brief-doc-reconcile.md` covering:

1. The OCR-vs-text-extraction split definition (§3).
2. The original-file retention model recommendation (§4).
3. The R-4 + R-7 + R-8 status-flip / invariant-promotion edits a follow-up docs-only WI would make (§5).
4. The exact list of follow-up WIs and their authorization gates (§8).
5. Risk list (§9).

### Out of scope (this plan-WI)

(Restated above in §"Exact out-of-scope list".)

---

## §3 R-6 — OCR vs text-extraction split

### §3.1 Definitions (v1 product-direction; not yet ADR-promoted)

| Pipeline | Inputs | Engine (v1) | Output | Where artifacts live |
|---|---|---|---|---|
| **OCR** | Scanned PDFs (no text layer); image PDFs; image files (PNG, JPG); screenshots (WeChat upload post-v1) | `paddleocr-onnx` (local) | Page-keyed OCR text + bounding-boxes | OCR-worker pipeline; referenced via `CaseBoxDocument.ocr_job_id` (existing) |
| **Document text extraction** | PDF with text layer; Word `.docx`; Markdown `.md` | TBD — STOP-AND-ASK in WI-brief-doc-text-extract-policy (post-v1) | Plain text + (where applicable) structure | TBD; new artifact entity or extension of OCR-link-shape (decided in the future WI) |
| **Manual paste (v1 fallback)** | Any document where a lawyer wants searchable text without automated extraction | n/a (lawyer types/pastes) | Free-text content on the document row | New optional `CaseBoxDocument.manual_extracted_text` field — picked here, NOT the R-5(c) lifecycle fields (which are purpose-specific). See §3.5 for the decision rationale. |

### §3.2 v1 behavior vs post-v1 dispatch policy

The split between OCR and text-extraction has two layers, separated below to avoid confusion:

**v1 behavior** (active today):
- Every ingested file is **retained verbatim** regardless of mime/extension. Original retention is unconditional.
- Files identifiable as **image** or **scanned PDF** (PDFs without a detected text layer) are eligible for the OCR pipeline (`paddleocr-onnx`).
- Files identifiable as **PDF with text layer**, **`.docx`**, **`.md`**, **`.txt`**, **`.rtf`**, **`.xls`/`.xlsx`**, or other office/text formats are accepted for retention only — no automated extraction pipeline runs. The lawyer's recourse for searchable text is the **manual-paste fallback** (see §3.5).
- v1 does NOT model multiple automated extraction artifacts per document. A single document is dispatched to at most ONE pipeline (OCR) and at most ONE artifact-per-document is produced.

**Post-v1 dispatch policy** (deferred to WI-brief-doc-text-extract-policy):
- Will define how `mime_type`, file inspection (text-layer detection in PDFs), and lawyer override interact to route a single document to OCR vs text-extraction vs both vs none.
- Will define whether a single document can produce multiple extraction artifacts (e.g., text-layer extraction for the searchable pages + OCR for the scanned pages of a mixed PDF).
- Will assign text-layer detection to a specific component (file-type-sniffer / pre-extraction inspector / engine itself) — this plan does NOT pre-empt that decision.

This v1/post-v1 separation:
1. Keeps v1 contract surface minimal (no text-extraction engine, no automated dispatch logic, no multi-artifact-per-document model).
2. Leaves the post-v1 WI free to choose engine-specific dispatch rules without retro-fitting v1 invariants.
3. Aligns with the brief's §6 "manual-paste fallback for PDF / Word / MD" v1 acceptance criterion.

### §3.3 Manual-paste storage field decision

The brief makes manual-paste a **v1 day-one must-have**. Two candidate storage locations were considered:

1. **R-5(c) lifecycle free-text fields** (`letter_date`, `service_status`, `client_authorization_summary`, `preliminary_evidence_summary`, `review_date`, `final_version_marker`). REJECTED: these are purpose-specific (lawyer-letter / contract-review only). They are not a clean home for generic extracted text of a counsel-contract or court-procedural document.
2. **NEW optional `CaseBoxDocument.manual_extracted_text`** field — string, optional, `maxLength` ~ 200_000 (room for a long document's text). ACCEPTED.

Decision: **add `manual_extracted_text` as a third optional field in Option α** (alongside `mime_type` and `byte_size`).

Schema shape:
```json
"manual_extracted_text": {
  "type": "string",
  "maxLength": 200000,
  "description": "Lawyer-pasted extracted text for documents not yet eligible for automated text extraction (PDF text-layer / Word / MD; post-v1). v1 manual-paste fallback per project-requirements-brief §6."
}
```

No invariant links `manual_extracted_text` to any other field v1. Future text-extraction engine output uses a separate artifact entity (decided in WI-brief-doc-text-extract-policy); the manual-paste field remains valid for any document.

### §3.4 OCR as subordinate data feed (unchanged from existing ADRs)

Per `case-box-step-0-boundary.md` §"3. OCR is a subordinate data feed into case-box documents, not the whole product UI" and the product summary §"Cross-cutting Invariants" item 2, the OCR pipeline is a subordinate. R-6 does NOT change that posture for OCR. The text-extraction pipeline, when it lands, will follow the SAME subordinate-data-feed rule: case-box never FKs into the text-extraction pipeline; it references by value (per existing OCR pattern at `CaseBoxDocument.ocr_job_id`).

### §3.5 v1 acceptance bar restatement

- OCR v1 acceptance: every page that OCR cannot read with confidence is visible in S5 manual-review for lawyer correction; no silent loss. (Restated from brief §8 OCR.)
- Text-extraction v1 acceptance: none — the pipeline does NOT exist v1. The lawyer's recourse is manual paste.
- Original-file retention v1 acceptance: 100%. Every ingested file is preserved verbatim, content-hash-addressed, at a known `storage_uri`. The `storage_uri` is openable from the Mac desktop process (e.g., `open <path>`); no extraction step destroys the original.

---

## §4 R-7 — Original-file retention model

### §4.1 Three modeling options

The brief promotes original-file retention to a load-bearing v1 invariant. The contract surface that backs this invariant needs at minimum: a stable file identifier, a storage reference, an integrity check. Today's `CaseBoxDocument` already has `filename` + `content_hash` + `storage_uri` — that floor is met. The open question is whether to add **`mime_type`** + **`byte_size`** to make pipeline dispatch (OCR vs text-extraction) and mini-program download Content-Type both well-defined.

| Option | What changes | Pros | Cons |
|---|---|---|---|
| **α — Minimal additive** | Add **three** optional fields to `CaseBoxDocument`: `mime_type` (string), `byte_size` (integer ≥ 0), `manual_extracted_text` (string, maxLength 200000). | Smallest blast radius; matches existing R-5 additive-optional style; v1 manual-paste fallback has a concrete home; mini-program download can set Content-Type from `mime_type` without re-deriving from filename. | Pushes more metadata onto an already-large `CaseBoxDocument`. |
| **β — Defer entirely** | No contract changes. `mime_type` derived at runtime from filename extension; `byte_size` derived from `storage_uri` filesystem stat. | Zero contract churn. | Pipeline-dispatch logic forced to re-derive metadata at every read; mini-program download surface needs ad-hoc Content-Type derivation; future text-extraction WI will likely need these fields anyway (deferred churn). |
| **γ — New entity** | Add `CaseBoxFileAsset` with `id`, `tenant_id`, `matter_id`, `mime_type`, `byte_size`, `storage_uri`, `content_hash`, `filename`. `CaseBoxDocument.file_asset_id` references it. | Multiple files per document (signed contract + redacted copy + revision history) naturally fit. | Large surface change; persistence absorption is significantly heavier; existing fixtures all need migration; no v1 use case is currently asking for multiple files per document (R-5(d) `supersedes_document_id` already covers "second-version-of-same-document" by reference between documents). |

### §4.2 Recommendation: Option α

**Pick Option α** (additive `mime_type` + `byte_size` + `manual_extracted_text` on `CaseBoxDocument`). Rationale:

1. Smallest blast radius. **Simpler than R-5**: three optional scalars vs R-5's ten items + two cross-row invariants. No new helpers, no `allOf` blocks, no enum drift-guard.
2. No use case in the brief currently demands "multiple files per document". R-5(d) `supersedes_document_id` already handles "revised version replaces original" by creating a new document row that references the prior one — this naturally accommodates contract-review-input → contract-review-final, and would accommodate signed-vs-unsigned similarly.
3. The persistence layer absorbs three optional fields trivially (analogous to R-5 absorption at commit `adc3916`, but lighter — no invariant wiring, no dep injection).
4. The post-v1 text-extraction WI gains `mime_type` as a candidate dispatch key (the actual dispatch logic lives in that WI; this plan does NOT pre-decide it — see §3.2).
5. The post-v1 mini-program download surface gets a usable Content-Type without runtime re-derivation.
6. `manual_extracted_text` resolves the brief's v1 day-one manual-paste must-have at the contract layer; the lawyer-facing UI can write to it without a follow-on contract amendment.

**Option γ migration trigger**: switch from Option α to Option γ (new `CaseBoxFileAsset` entity) ONLY when the v1+ surface concretely demands **multiple binary assets per logical document** (e.g., signed original + redacted copy + revision history + transcript derivative all attached to one logical document). Until that need materializes, Option α holds. R-5(d) supersession by document-id reference handles single-binary versioning without a new entity.

**This plan does NOT ship the schema diff** — it queues it as `WI-brief-doc-asset-impl` (see §8 item 2).

### §4.3 Original-file retention as cross-cutting invariant

The follow-up docs-only reconciliation WI (§8 item 1) appends a single bullet to `docs/adr/case-box-step-0-boundary.md` §"Cross-cutting Invariants":

> N. **Original-file retention.** Every ingested file (Mac picker / URL / future WeChat upload / future scanner) is preserved verbatim, content-hash-addressed at a known `storage_uri`, and openable from the Mac desktop process. No extraction step (OCR, text-extraction, redaction, etc.) destroys or replaces the original. Extraction artifacts (OCR text, parsed Word, Markdown structure) are stored alongside, never in place of, the original.

And appends a parallel bullet to `docs/product/product-target-architecture.md` §"Cross-cutting Invariants (always-true, v1)".

No standalone ADR (e.g., `case-box-step-9-original-file-retention.md`) is needed. Rationale:

- The invariant introduces NO new state machine, NO new actor model, NO new enforcement layer, NO new audit kind, NO new contract type.
- It is a clarification of an already-existing Step-0 §4 commitment ("Document storage as files on local disk, identified by `content_hash`").
- Step-6 and Step-7 got standalone ADRs because each shipped new entity-level state machines (Step-6: `CaseBoxDocketEntry` + confirmation lifecycle) or new actor-posture invariants (Step-7: `local-user` sentinel rules). The original-file-retention invariant is structurally smaller than either.
- A Step-9 ADR would be a single paragraph appended to Step-0 — same effect, lower navigation cost.

If a future architectural change makes original-file retention enforce-able (e.g., a write-once filesystem layer, a hash-chain over file modifications, a per-asset encryption design), THAT change deserves its own ADR. The invariant statement itself does not. (Review question §3 answered.)

### §4.4 Authorization posture (open vs download)

| Surface | Gate | Audit | Status |
|---|---|---|---|
| Mac local open (`open <storage_uri>` from the Mac desktop main process) | None — the Mac process IS the lawyer per `case-box-step-7` | None — Mac local reads are not audited v1 | v1 day-one |
| Mac local copy-out (lawyer drags file out of `~/Library/Application Support/lawbar/` in Finder) | None — file-system permissions are the OS's job | None | v1 day-one |
| Mini-program download | Full chain: authenticated principal + sync grant exists for the doc/matter + privilege resolver passes + confidentiality `assertExternalHandlingAllowed(externalAction="sync_transmit")` passes + audit event recorded | Required write audit event | **Post-v1**; lives in the SYNC reconciliation program (R-2 follow-up) |
| External-OCR upload (future opt-in) | Existing per-document `external_ocr_authorized` flag + per-document confidentiality `normal` | Required audit | Post-v1 |
| Cloud-sync external mirror | Existing per-document sync grant + confidentiality resolver | Required audit | Post-v1 |
| Browser SPA / public download | NOT supported. v1 non-goal; indefinitely postponed (brief §3 + §19). | n/a | NOT v1 / NOT planned |

This table is product-direction recording; it does NOT add code or contract changes by itself. It is referenced by the post-v1 SYNC reconciliation program (R-1/R-2/R-3 follow-ups).

---

## §5 R-4 + R-7 + R-8 docs-only edits (queued)

These are the **edits a follow-up docs-only WI** (§8 item 1) would make. This plan-WI does NOT make them.

### §5.1 `docs/product/product-target-architecture.md`

In §"Future Work Items":

- Demote `TENANT (deferred) — Single-firm-multi-user phase` from "future" to **"indefinitely deferred"** with a note pointing to brief R-4. (Resolves R-4.)
- Demote `CASE-BOX Step 8 LLM extractor (feature-flagged, opt-in per case)` from "regular implementation WI" to **"indefinitely deferred (future policy only)"** with a note pointing to brief R-8. The follow-up docs WI MUST sweep ALL LLM mentions across `product-target-architecture.md` (not just the Future Work Items row), specifically: §"v1 Product Shape" line about "LLM candidate-fact extraction (feature-flagged off…)", §"Data Residency" table row about "LLM candidate-fact extraction", and any other surface that still implies LLM is "opt-in per case" rather than "indefinitely postponed". (Resolves R-8.)
- Demote `Browser SPA` from "deferred" to **"indefinitely deferred"** per brief §3. (Tightens existing wording.)

In §"Cross-cutting Invariants (always-true, v1)":

- Append a new invariant: **"Original-file retention"** per §4.3 wording. (Resolves R-7 at the product-summary level.)

### §5.2 `docs/adr/case-box-step-0-boundary.md`

In §"Cross-cutting Invariants" (if such a section exists, otherwise append to the §"Decision" closure):

- Append the **"Original-file retention"** bullet per §4.3 wording. (Resolves R-7 at the ADR level.)

In §"Cross-cutting Invariants" or §5 ("Cloud / external OCR / LLM extraction are opt-in"):

- Clarify that LLM extraction is **indefinitely postponed**, not merely "feature-flagged off + per-case opt-in". The Step-8 ADR (`case-box-step-8-llm-extractor-policy.md`) remains as future policy only. (Tightens R-8 at the ADR level.)

### §5.3 No other ADRs touched

- `case-box-step-8-llm-extractor-policy.md`: NOT touched. It remains as future policy; only the Future-Work-Items demotion in `product-target-architecture.md` and a one-line ADR-cross-reference note in `case-box-step-0-boundary.md` flag the policy-only status. (Editing the Step-8 ADR body is beyond a docs-only WI.)
- `case-box-step-7-multi-user-readiness.md`: NOT touched. Its invariants stand. The R-4 product-direction tightening is a product-summary edit only.
- `sync-bridge-architecture.md`: NOT touched. The post-v1 SYNC reconciliation program (R-1/R-2/R-3 follow-ups) is the path for any bridge changes.

### §5.4 The brief itself

`docs/product/project-requirements-brief.md`: NOT touched. The brief is the source of truth for the reconciliation entries; flipping R-4/R-7/R-8 entries' status to "RESOLVED" is a brief-amendment, handled by re-running `/project-brief` to write an amendment (`AMENDMENT-PENDING-REVIEW`) when the user is ready. NOT done by a follow-up docs-only WI.

---

## §6 Contract surface — recommendation summary

This plan recommends **THREE** small additive contract changes that a follow-up implementation WI would ship on `CaseBoxDocument`:

1. `mime_type` — optional string (IANA media type, e.g. `application/pdf`, `image/png`, `text/markdown`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
2. `byte_size` — optional integer ≥ 0 (file size in bytes).
3. `manual_extracted_text` — optional string, `maxLength: 200000` (v1 manual-paste fallback per §3.3).

All three are optional-omitted (matches the R-5 convention). No invariants link them to other fields v1. No `additionalProperties` tightening. No new entity. No new audit kind. The persistence absorption is simpler than R-5: contract validators accept the fields, `structuredClone` preserves them through `prepareRegisterDocument` and `getDocument` / `listDocuments`, and new conformance tests cover register-then-read. No cross-row invariants, so no `assertValidX` helper wiring is required (unlike R-5's `assertValidDocumentSupersession` / `assertValidMatterSuccessor`).

**Existing `CaseBoxDocument` fields are unchanged by this WI**:
- `custody_chain` continues as the provenance chain (append-only).
- `submission_hash` continues as the OCR-dedupe metadata (set when the OCR pipeline is invoked).
- `language` and `page_count` continue as optional extraction-derived hints.
- All R-5 additions (commit `17d8103`) — `purpose`, `work_order_status`, `supersedes_document_id`, lifecycle free-text — continue unchanged.
- `storage_uri` continues as the canonical pointer to the verbatim original file bytes on local disk; original-file retention §4.3 invariant uses `storage_uri` + `content_hash` as its identity.

**This plan does NOT ship the schema diff.** It is queued at §8 item 2.

The plan also recommends that the post-v1 text-extraction WI use `mime_type` as a candidate dispatch key (final dispatch policy is the post-v1 WI's call per §3.2), AND the post-v1 mini-program download surface use `mime_type` to set Content-Type. Both are downstream design notes, not v1 work.

---

## §7 Tests

This plan-WI ships NO tests. Tests for the contract additions (Option α) belong to the follow-up impl WI (§8 item 2). Tests for the docs reconciliation (§5) are typically not unit-testable; the follow-up docs WI (§8 item 1) relies on `/cc-suite:review-plan` for verification.

If a future implementation WI ships the `mime_type` + `byte_size` + `manual_extracted_text` fields, its test plan would include:

- Valid fixture: document with `mime_type = "application/pdf"`, `byte_size = 12345`, no `manual_extracted_text`.
- Valid fixture: document with `mime_type = "text/markdown"`, `byte_size = 4096`, `manual_extracted_text = "Paragraph 1\n\nParagraph 2"`.
- Valid fixture: document without any of the three new fields (proves optional-omitted).
- Invalid fixture: `byte_size = -1` (rejected by `minimum: 0`).
- Invalid fixture: `manual_extracted_text` exceeding `maxLength: 200000` (rejected by string length).
- Conformance: persistence preserves all three fields through register → `getDocument` → `listDocuments` round-trip.
- Conformance: separate write path that updates `manual_extracted_text` after initial registration is OUT OF SCOPE for the impl WI; v1 sets it at registration time (lawyer pastes before submitting). A future "update document metadata" API is a separate concern.

Out of scope for THIS plan.

---

## §8 Follow-up WIs

Each is a **separately authorized, separately reviewed, separately committed** unit. None is implicitly authorized by this plan-WI.

| # | WI name | Scope | v1/post-v1 | Authorization gate |
|---|---|---|---|---|
| 1 | **WI-brief-doc-reconcile-docs** | Apply §5 edits to `product-target-architecture.md` + `case-box-step-0-boundary.md`. Sweep ALL LLM mentions across the product summary (not just Future Work Items row) and update to "indefinitely postponed" per brief R-8. Append "Original-file retention" invariant per §4.3. Demote `TENANT` and Browser SPA per brief R-4 / §3. Docs-only. | v1 docs-only | cc-suite review-plan → commit. |
| 2 | **WI-brief-doc-asset-impl** | Add `mime_type` + `byte_size` + `manual_extracted_text` optional fields to `CaseBoxDocument`; regenerate TS; add fixtures per §7 (≥3 valid + ≥2 invalid: `byte_size < 0` and `manual_extracted_text` over `maxLength`); extend conformance tests for register-then-read preservation of all three fields; persistence absorption (lighter than R-5 — no invariant wiring, no dep injection). NO ADR amendment in this WI (Step-0 ADR amendment lives in item 1 only — avoids cross-WI doc churn). | v1 contract+persistence | cc-suite review-plan → cc-suite audit → commit. New runtime deps: none. |
| 3 | **WI-brief-doc-text-extract-policy** (post-v1, ADR-draft) | New ADR `docs/adr/case-box-text-extraction-policy.md`: engine selection criteria, dispatch rules (including text-layer detection responsibility — see §3.2), multi-artifact-per-document model, gating. STOP-AND-ASK runtime-dep choice for the engine. | Post-v1 | cc-suite review-plan → user explicitly authorizes engine STOP-AND-ASK → commit ADR. NO code in this WI. |
| 4 | **WI-brief-sync-reconciliation-program-WI-c** (post-v1) | Authorized original-file + extracted-text download surface on sync bridge, per brief R-2. Uses §4.4 gate chain. | Post-v1 | Whole SYNC program (R-1/R-2/R-3) is a multi-WI sequence; this is sub-WI c. |

**Sequencing**: do (1) BEFORE (2) — item 1 establishes the original-file-retention invariant in `case-box-step-0-boundary.md` that item 2's `manual_extracted_text` + `mime_type` + `byte_size` formally implement. Item 2's commit message and ADR cross-references then point back to the already-landed Step-0 amendment. (3) and (4) are post-v1, gated separately, and do NOT block items 1-2.

**R-6 resolution**: §3 of THIS plan defines the v1/post-v1 OCR-vs-text-extraction split; the engine choice + dispatch logic is item 3 (WI-brief-doc-text-extract-policy), post-v1. R-6 is therefore resolved across §3 and item 3, NOT via the §5 docs-only edits.

The brief's original `Suggested follow-up WIs` item 2 ("WI-brief-doc-reconcile") is split here into items 1 + 2 because the brief framed it as "docs-only" but this plan adds a small contract recommendation (Option α). Splitting keeps each follow-up WI bounded and reviewable.

---

## §9 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Option α → Option γ migration cost. **Cheap before any data is persisted; non-trivial after release** (data migration on stored rows, fixture rewrites, generated-type regeneration, persistence absorption, downstream UI updates). | Hold Option α until the §4.2 trigger materializes ("multiple binary assets per logical document"). If trigger fires post-release, plan a dedicated migration WI with explicit data-shape compatibility steps. |
| 2 | Low | The OCR-vs-text-extraction split's "at most one automated artifact per document" rule may be too restrictive for PDFs with mixed text + scanned regions when the post-v1 engine ships. | §3.2 explicitly addresses this: v1 day-one routes only **scanned/image PDFs and image files / screenshots** to OCR; PDFs with detected text layer and other text-bearing formats are NOT OCR-eligible v1, only retained + manual-paste eligible. v1 does NOT introduce a general PDF text-layer detector; that detector is the post-v1 WI's responsibility. When the post-v1 engine ships, it re-classifies as needed. |
| 3 | Low | The R-4/R-7/R-8 status flips queued in §5 are merely product-direction tightenings; if not landed, no v1 code breaks. | Acceptable. The follow-up docs WI #2 is low-priority but recommended for discoverability. |
| 4 | Low | The mini-program download authorization posture in §4.4 is described BEFORE the SYNC reconciliation program lands. If the program later changes the gate chain, the §4.4 table will need updating. | Acceptable. §4.4 is product-direction recording; the SYNC reconciliation program is authoritative on its own scope. |
| 5 | Low | The plan implicitly relies on the brief's R-7 wording ("retain original verbatim") being uncontested. | Brief is `READY`. If a future brief amendment changes R-7, this plan's invariant promotion would need updating. |

No Critical / High risks; one Medium risk remains (Risk 1 — Option α → Option γ post-release migration cost).

---

## §10 Required cc-suite review

This plan is plan-only with no v1 code change. cc-suite review-plan via Path 1 broker is required per `.claude/rules/cc-suite.md` §"High-risk WIs" — the plan describes follow-up WIs that touch contract surfaces and product docs, so the plan itself is high-risk-adjacent.

After cc-suite returns READY (or only Low-risk clarifications), the plan is committed. Implementation is the chain of follow-up WIs in §8.

---

## §11 References

- `docs/product/project-requirements-brief.md` (status READY, commit `fe09ea4`) §"R-2", §"R-4", §"R-6", §"R-7", §"R-8", §"Suggested follow-up WIs".
- `docs/adr/case-box-step-0-boundary.md` §4 (data residency), §5 (cloud / external OCR / LLM opt-in), §"Cross-cutting Invariants".
- `docs/contracts/case-box-contract/schemas/case-box-document.schema.json` (current fields; R-5 additions just landed).
- `docs/adr/sync-bridge-architecture.md` (referenced as-is).
- `docs/product/product-target-architecture.md` §"Data Residency", §"Cross-cutting Invariants", §"Future Work Items".
- `dev-memo/plan-brief-matter-type.md` + `dev-memo/plan-brief-matter-type-persistence.md` (R-5 precedent for additive-optional contract style).
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Required recording".
- `.claude/rules/autonomy.md` (this WI is docs-only plan; no hard-stop triggered).
- `.claude/rules/loc-guardian.md` (single docs/dev-memo file; warn 1200, fail 2000 — fine).

---

## §12 Stop condition

This plan is stale or superseded when:

- WI-brief-doc-reconcile-docs (§8 item 1) commits the product-summary + ADR edits in §5.
- WI-brief-doc-asset-impl (§8 item 2) commits and ships `mime_type` + `byte_size` + `manual_extracted_text`.
- A future brief amendment (revision 6+) changes R-6 or R-7 in a way that contradicts §3 or §4.

When either or both of items 1 and 2 land, this plan moves from `READY` to a recorded historical reference at the same path; no rename or move is required.
