# case-box-contract

Authoritative domain contract for the lawyer case-box product. JSON schemas + Ajv validators + state machines for the seven v1 backbone entities.

**Status**: CASE-BOX Step 1 — see `docs/adr/case-box-step-0-boundary.md` and `dev-memo/plan-case-box-step-1.md`.

## What this package is

Wire-format and semantic contract for the case-box domain layer:

- **CaseBoxMatter** — matter root (jurisdiction, parties, confidentiality_class, opt-in external flags).
- **CaseBoxDocument** — legal document registered to a matter; may reference an OCR job (read-only).
- **CaseBoxParty** — typed party shape; embedded in CaseBoxMatter.parties.
- **CaseBoxDeadline** — case-scoped deadline (statute, court order, internal, etc.).
- **CaseBoxEvidenceItem** — v1-simplified evidence binding (matter, source document, page range, lawyer weight).
- **CaseBoxOcrLink** — read-only mirror of OCR job state; `direction: "read-only"` is contractually enforced.
- **CaseBoxAuditEvent** — append-only event with hash-chain shape (chain integrity is persistence's job).
- **CaseBoxFact** — statement-level fact derived from a document, an LLM, an OCR excerpt, an import, or authored by the lawyer. Carries source + extractor provenance + review trail + supersession pointer. v1 invariant: **all facts created in status=candidate**; no auto-promote.

## What this package is NOT

- Not a persistence layer.
- Not a database schema.
- Not an HTTP API.
- Not a desktop shell.
- Not a UI.
- Not an LLM extractor.
- Not a sync bridge.

## Public exports

See `src/index.ts`. Validators, state-machine helpers, errors, semantic helpers (`isLocalOnlyActor`, `defaultsAreLocalFirst`), and schema-derived types.

## v1 invariants encoded

- `actor_user_id` and `tenant_id` are required on every persisted shape.
- `external_ocr_authorized`, `sync_grant_present`, `llm_extraction_opt_in` default to `false` (local-first by default).
- `CaseBoxOcrLink.direction === "read-only"` (OCR is a subordinate data feed).
- `CaseBoxDeadline` `missed → met` transition requires `transition_reason`.
- `CaseBoxEvidenceItem.status === "superseded"` requires `supersedes_evidence_id`.
- **`CaseBoxFact` no-auto-accept**: enforced in three layers — state machine bans `candidate → accepted`, schema requires reviewer fields for `accepted`/`rejected`/`reviewed`, and `assertValidNewFact` rejects any new fact whose `status !== "candidate"`. Machine-extracted facts (LLM / OCR excerpt / imported) MUST land as `candidate`.
- **`CaseBoxFact` supersession** is a relationship, not a row state. A new accepted fact's `supersedes_fact_id` points to the old accepted fact it replaces; both rows remain `accepted`. There is no row-level `superseded` state. Self-cycle caught by `assertFactPromotionInvariants`; broader chain-cycle detection is persistence's job.
- **`CaseBoxFact` source-type coherence**: `lawyer_authored` MUST NOT carry extractor metadata; `llm_extraction` and `imported` MUST carry `extractor_name`; `ocr_excerpt` MUST carry `source_document_id`, `source_ocr_job_id`, `source_page_number`, and `source_excerpt`.

## Test commands

```bash
npm --prefix docs/contracts/case-box-contract install
npm --prefix docs/contracts/case-box-contract test
```

## References

- `docs/adr/case-box-step-0-boundary.md` — boundary, dependency direction, invariants.
- `docs/product/product-target-architecture.md` — v1 product summary.
- `docs/contracts/` — sibling OCR contract package this one structurally mirrors.
