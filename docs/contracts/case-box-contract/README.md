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
- **CaseBoxPrivilegeMarker** — privilege assertion on a CaseBoxDocument or CaseBoxFact. Single mutable row per marker; status advances `proposed → confirmed → waived` OR `proposed → dismissed`. Machine sources MUST start `proposed`; lawyer sources MAY start `confirmed`. **Unmarked targets are legally undetermined — neither privileged nor cleared-for-disclosure.** See `effectivePrivilegeStatus` resolver.
- **Audit-log helpers (Step 4)** — `CaseBoxAuditEvent` schema (Step 1) now also has `additionalProperties: false` and `entity_type` constrained to a v1 enum (Step 5 widened by one to include `confidentiality_classification`; Step 6 widened by one to include `docket_entry`). New TS helpers in `src/audit-log.ts`: `CASE_BOX_AUDIT_EVENT_KINDS` (rich vocabulary mapped onto schema actions), `canonicalAuditEventHashInput` (deterministic hash input INCLUDING id + timestamp), `buildCaseBoxAuditEvent` (returns `ValidationResult`, never throws), `assertReasonForAuditEventKind` (reason-required ceiling beyond schema's `privilege-waive` floor), `verifyAuditChain` (REQUIRES `eventHashFn`; checks tenant/matter homogeneity; returns `headHash` for external anchor), and the branded `AuditEventHash` type. **v1 limitation**: in-row chain alone does NOT detect full-chain rewrites; external manifest with head-hash required for strong tamper detection.
- **CaseBoxDocketEntry (Step 6)** — proposal-and-confirmation companion to `CaseBoxDeadline`. Carries provenance (`manual | court_order_excerpt | llm_extraction | imported`) + authoritative date semantics (`proposed_due_at_kind: "datetime" | "date_only"` + `proposed_due_at_timezone`) + confirmation lifecycle (`proposed → confirmed | dismissed`). **ALL entries start `proposed`**; direct-confirm is forbidden for every source type. Confirmation safety lives in `assertValidDocketEntryConfirmation(entry, actor)` — REQUIRES the full entry and rejects `date_only` confirmation in v1 (no jurisdiction/timezone resolver). After Step 6, `CaseBoxDeadline` (Step 1) becomes a **materialized-view projection** — consumers needing legal date semantics MUST query the docket entry via `confirmed_deadline_id`. `assertValidIanaTimezone` uses `Intl.supportedValuesOf("timeZone")` + UTC allowlist + denylist-first for deprecated aliases (`America/Buenos_Aires` always rejected). Reminder offsets are shape-only (no notification execution). **Step 6 ships the contract layer only**; runtime no-auto-confirm safety awaits the future `case-box-persistence` WI, which must forbid raw `CaseBoxDeadline` insertion and route all writes through the docket-entry confirmation path. `DEADLINE_CONTINUED` audit kind deferred. See `docs/adr/case-box-step-6-deadline-docketing-rules.md`. Source-type vocabulary across Steps 2/3/6 is documented as accepted v1 tech debt (see ADR §15).
- **CaseBoxConfidentialityClassification (Step 5)** — per-target (document or fact) data-handling classification. Append-only history; latest row by `set_at` (id tiebreak) = current effective level. Levels: `unclassified` (default; outside ordinal lattice; operationally most restrictive) | `normal` | `confidential` | `highly_confidential` | `restricted`. Matter-level confidentiality (`CaseBoxMatter.confidentiality_class`) is a separate vocabulary on the matter row. **`unclassified` is the legal default** — empty classifications → external handling DENIED. `assertExternalHandlingAllowed` is the load-bearing resolver: structured input (matter + classifications + `PrivilegeReviewState` + three action-specific opt-in flags) → `HandlingDecision` with `allowed: boolean` + `denialReasons` + `evidence`. **NO `safeToProcess`/`canTransmit`/`approvedForExternal`/`isPrivileged` field** — callers MUST check `allowed === true` explicitly. v1 hard-denies `confidential` for ALL actions (Step 8 LLM ADR may revisit). v1 categorically denies external handling for `heightened`/`sealed` matters per Step-0 §confidentiality posture. v1 categorically denies `privileged_with_waiver` (per-action waiver is post-MVP). Downgrade transitions and reset-to-unclassified require non-null `change_reason_code` (validator-helper enforced); `change_reason_code === "other"` requires non-empty `change_reason_text` (schema enforced).

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
- **`CaseBoxPrivilegeMarker` no-auto-privilege**: state machine bans non-`lawyer` actors from any promotion; `assertValidNewPrivilegeMarker` rejects machine-sourced markers in initial state `confirmed`; schema requires reviewer fields for `confirmed`/`dismissed`/`waived`.
- **`CaseBoxPrivilegeMarker` resolver safety**: `effectivePrivilegeStatus` returns a structured `PrivilegeResolution` object with `hasProtectiveAssertion: boolean` + `activeConfirmedMarkers: Marker[]` + `historyHas: {...}` + `allTargetMarkers: Marker[]`. **There is NO `isPrivileged`, `safeToDisclose`, `disclosureClearance`, or `notPrivileged` field.** Callers MUST check `hasProtectiveAssertion` explicitly and MUST NOT infer disclosure safety from any other return field.
- **`CaseBoxPrivilegeMarker` reason invariants**: `proposed → dismissed` AND `confirmed → waived` both require a non-empty reason at the state-machine layer; the schema's M3/M4 require non-null `dismissal_reason` / `waiver_reason` respectively.
- **`CaseBoxPrivilegeMarker` basis preservation**: `kind` and `basis_text` are top-level required on every row, so a `dismissed` or `waived` marker preserves what was originally proposed/protected (privilege-log reproducibility).
- **`CaseBoxPrivilegeMarker` source-type coherence**: `lawyer_authored` MUST NOT carry extractor metadata; `llm_suggested` and `imported` MUST carry `extractor_name`.

## Test commands

```bash
npm --prefix docs/contracts/case-box-contract install
npm --prefix docs/contracts/case-box-contract test
```

## References

- `docs/adr/case-box-step-0-boundary.md` — boundary, dependency direction, invariants.
- `docs/product/product-target-architecture.md` — v1 product summary.
- `docs/contracts/` — sibling OCR contract package this one structurally mirrors.
