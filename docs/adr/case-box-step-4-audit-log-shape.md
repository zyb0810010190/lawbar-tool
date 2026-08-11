# ADR: Case-Box Step 4 — Audit-Log Shape and Helpers

## Status

**Accepted** — 2026-05-20. Implements ADR-series Step 4 per `docs/adr/case-box-step-0-boundary.md` (originally titled "audit-log-append-only" in the Step-0 list; this ADR uses the user-authorized filename "audit-log-shape" which more accurately describes scope). Co-committed with the helpers and the tiny additive Step-1 schema change.

Planning record: `dev-memo/plan-case-box-step-4.md` (revised after Codex plan-review thread `019e45ed`).

This ADR is **mostly additive** to `docs/contracts/case-box-contract/`. The exception is two tiny additive changes to `schemas/case-box-audit-event.schema.json` (Step-1 schema), both explicitly required by plan-review to make helper-layer enforcement load-bearing instead of advisory. No other Step-1/2/3 schema is touched. No OCR package, persistence, ingestion, review, sync, UI, auth, cloud, or LLM code is added.

## Context

Step 1 shipped `CaseBoxAuditEvent` with a deliberately generic `action` enum and a free-string `entity_type` field. Steps 2 and 3 both rely on persistence emitting audit events for fact lifecycle and privilege-marker lifecycle, but both ADRs hand-wave the mapping ("fact-accept = update audit event"). A `case-box-persistence` implementer would have to re-derive the mapping AND invent canonical-hash-input bytes AND build a chain verifier, all without contract help — and almost certainly inconsistently across writers.

Codex plan-review thread `019e45ed` surfaced five Critical findings on the original Step-4 draft:

1. **Timestamp exclusion from hash** materially weakens tamper detection in legal workflows.
2. **Chain verifier weak fallback** mixed entity-state hash with audit-event hash; silently validates wrong chains.
3. **No `additionalProperties: false`** on the schema lets extras stay uncommitted by the canonical hash.
4. **Helper-only enforcement is bypassable** because the schema is permissive.
5. **No-schema-change stance is too load-bearing** — at minimum, extras and entity_type vocabulary need schema-level constraint to be safe.

Plus six High findings. The plan was revised; this ADR ships the revision.

## Decision

### 1. Tiny additive Step-1 schema change (twice)

The `case-box-audit-event.schema.json` (Step 1) is amended with two narrow additions:

- `"additionalProperties": false` at the top level. Extras (e.g. `wibble`) are now rejected at the wire layer; persistence cannot inject unhashed fields.
- `entity_type` enum constrained to `["matter", "document", "deadline", "evidence_item", "ocr_link", "fact", "privilege_marker"]`. Schema rejects unknown values; persistence cannot write `entity_type = "wibble"`.

Both changes preserve every previously-valid event (existing Step-1 valid fixture uses `entity_type = "matter"` and has no extras). They only narrow forward writes — exactly the "tiny additive change" the user authorization permits when plan-review proves it's required. Plan-review proved it (D2.1 Critical + D2.2 High + D4.1 Critical + D5.1 Critical).

Future case-box entities (e.g. page-range markers) requiring audit support will need a coordinated schema-enum + TS-constant update. A drift-guard test asserts the schema's `entity_type.enum` array exactly matches the TS `CASE_BOX_AUDIT_ENTITY_TYPES` constant.

### 2. Rich event vocabulary (TS only)

`CASE_BOX_AUDIT_EVENT_KINDS` is a TS-only mapping from rich kinds (`FACT_ACCEPTED`, `PRIVILEGE_MARKER_WAIVED`, etc.) to the existing schema's generic `action` + `entity_type` + a `reasonRequired` flag. Persistence callers emit events via `buildCaseBoxAuditEvent({ kind: ..., ... })`; the helper resolves to the schema-level `action` and `entity_type`.

The rich kind enum includes (in summary):

- Matter: REGISTERED, ARCHIVED, UNARCHIVED.
- Document (one per state-machine edge per plan-review D2.4): REGISTERED, OCR_SUBMITTED, OCR_COMPLETE, OCR_FAILED, TRIAGED, TAGGED, REVIEWED, SOFT_DELETED.
- OCR link: SNAPSHOTTED, REFRESHED.
- Deadline: REGISTERED, MET, MISSED, WITHDRAWN, MISSED_TO_MET.
- Evidence item: PROPOSED, ACCEPTED, REJECTED, SUPERSEDED.
- Fact: PROPOSED, REVIEWED, ACCEPTED, REJECTED, REPLACEMENT_ACCEPTED (= the new accepted row carrying `supersedes_fact_id`; per plan-review D1.3, this is `action: "create"`, not "update").
- Privilege marker: PROPOSED, CONFIRMED, DISMISSED, WAIVED.
- Confidentiality opt-in toggles: EXTERNAL_OCR_AUTHORIZED/REVOKED, SYNC_GRANT_GRANTED/REVOKED, LLM_EXTRACTION_OPT_IN/OPT_OUT.
- Operator/export: PRIVILEGE_LOG_EXPORTED, CASE_DATA_EXPORTED, DOCUMENT_ACCESSED/PRINTED/SHARED, DOCUMENT_SOFT_DELETED.

`reasonRequired: true` for: privilege-waive, privilege-dismissal, fact-rejection, deadline missed→met, soft-delete, document-shared, external-OCR-revoked, sync-grant-revoked, LLM-extraction-opt-out. This is the **ceiling** beyond the schema's single `privilege-waive` reason-required **floor**.

### 3. Canonical hash input — includes id + timestamp

`canonicalAuditEventHashInput(event): string` returns a UTF-8 byte string with alphabetically-ordered keys and INCLUDES `id` AND `timestamp` (plan-review D1.1/D5.2 correction). Persistence wraps this with SHA-256 to produce an `AuditEventHash`.

**Determinism mechanism**: the function constructs a fresh object literal in source-code alphabetical order; `JSON.stringify` preserves insertion order; refactors that change literal order break the hash; a pinned-exact-output test catches drift.

**Pre-conditions**: caller MUST normalize `timestamp` to `Date.toISOString()` format (UTC, ms precision, trailing `Z`); the helper does NOT normalize. Required fields are checked for `undefined` and the helper throws if any required field is missing (plan-review D3.2 guard against JSON.stringify silently omitting undefined).

### 4. Branded `AuditEventHash` and `EventHashFn`

`AuditEventHash` is a branded type (`string & { __brand: "AuditEventHash" }`) representing a lowercase 64-character hex SHA-256 digest. `asAuditEventHash(value)` validates and brands; bad values throw.

`EventHashFn = (event: CaseBoxAuditEvent) => AuditEventHash`. Persistence wraps `sha256(canonicalAuditEventHashInput(event))` and passes the function to the chain verifier.

### 5. Builder — returns ValidationResult only

`buildCaseBoxAuditEvent(input): ValidationResult<CaseBoxAuditEvent>` resolves `input.kind` to the schema's generic `action` + `entity_type`, runs the reason-required helper (wrapping its violation into `ok: false` rather than throwing — plan-review D1.4 API consistency), and then calls `validateAuditEvent`. Returns ok/err per the existing repo `ValidationResult` shape. **Never throws.**

### 6. Chain verifier — `eventHashFn` required + tenant/matter homogeneity

`verifyAuditChain(events, { eventHashFn })` walks an append-ordered sequence and verifies:

- first event has `prev_event_hash === null`;
- every subsequent event has `prev_event_hash === eventHashFn(prior event)` — `eventHashFn` is REQUIRED (plan-review D1.2 removed the weak fallback);
- every event passes `validateAuditEvent`;
- create-action events have `before_state_hash === null`;
- all events share the same `tenant_id` and `matter_id` (plan-review D2.3).

Returns `{ ok: true, verifiedCount, headHash }` on success — `headHash` is the v1 anchor mechanism. On failure, returns `{ ok: false, errorIndex, errorReason, detail }` with one of the documented `ChainVerifyErrorReason` values.

### 7. v1 limitation: external manifest required for strong tamper detection

Plan-review D3.3: the in-row chain alone detects **only mid-chain tampering** if later `prev_event_hash` values have NOT also been rewritten. A tamperer with full DB write access can rewrite the entire chain and the verifier still passes.

**v1 mitigation**: `verifyAuditChain` returns `headHash`. Persistence MUST periodically capture this head-hash into an EXTERNAL signed manifest (export-time, e.g., privilege-log export). Comparing the current chain's head-hash against the historical manifest detects whole-chain rewrites.

Stronger anchoring (per-event signature, append-only WAL outside the DB, blockchain anchor) is post-MVP.

## Persistence obligations recorded

These obligations are part of this ADR; `case-box-persistence` (future WI) MUST honor them:

1. **Append-only**: REJECT every UPDATE or DELETE on audit-event rows. Only INSERT.
2. **Builder-only emission**: emit events via `buildCaseBoxAuditEvent({ kind: ..., ... })`. Raw construction is forbidden by code review.
3. **Timestamp normalization**: stamp via `new Date().toISOString()`; reject other formats before hashing.
4. **Hash chain integrity**: compute `prev_event_hash = sha256(canonicalAuditEventHashInput(previousEvent))`; algorithm pinned to SHA-256 hex lowercase 64 chars (per `AuditEventHash` brand).
5. **Replay-tamper detection at export time**: run `verifyAuditChain` against the matter's audit trail at every audit / privilege-log export; reject the export if verification fails.
6. **Head-anchor capture**: capture the `headHash` returned by `verifyAuditChain` into an external manifest at export time. Comparing current head against historical manifest is the v1 strong-tamper-detection mechanism.
7. **Entity-type vocabulary**: pass only `CASE_BOX_AUDIT_ENTITY_TYPES` values. Schema enum now enforces this.
8. **`additionalProperties` strictness**: do NOT write extras. Schema rejects them.
9. **Reason equality** (plan-review D1.5): when an audit event row's `reason` is required AND the source entity carries its own reason field (e.g. `CaseBoxFact.rejection_reason`, `CaseBoxPrivilegeMarker.dismissal_reason`, `CaseBoxPrivilegeMarker.waiver_reason`, `CaseBoxDeadline.transition_reason`), MUST assert `auditEvent.reason === entity.<corresponding>_reason`. Drift between the two is a persistence bug.
10. **Kind storage** (soft recommendation per plan-review D4.2): MAY store the `CaseBoxAuditEventKind` in a separate column for export self-description. Without it, exports must reconstruct the kind by joining with entity history. The contract does NOT require this storage; the kind is a TS-layer discriminator.
11. **Storage separation**: MAY store audit events in a separate SQLite file (per case-box-plan §2.1) so app-DB corruption cannot silently corrupt the audit chain.
12. **Step-2 carry-over**: the fact-supersession graph-cycle detection obligation from Step-2 is NOT weakened by this ADR.
13. **Step-3 carry-over**: privilege-marker creation-rule enforcement and marker uniqueness obligations from Step-3 are NOT weakened by this ADR.

## Consequences

### Positive

- Audit-event vocabulary is rich (43 kinds in v1) yet wire-format generic (existing 8 actions); future kinds add to the TS constant without schema change.
- Hash chain commits to `id` and `timestamp`; tampering either breaks the chain.
- Chain verifier requires a real hash function; no weak fallback that silently validates wrong chains.
- Schema-level enforcement closes the rawest gaps; persistence cannot bypass `entity_type` constraint or inject untracked extras.
- Tenant/matter homogeneity guard catches accidental cross-matter audit splicing.
- v1 limitation documented explicitly with the head-hash anchor mechanism.

### Negative

- Schema is now stricter; any pre-existing caller writing extras or unknown entity_type values fails (none exist in v1; would-be future callers must update with the schema).
- `CASE_BOX_AUDIT_EVENT_KINDS` is a TS-layer discriminator; without optional persistence-side kind storage, exports must reconstruct via entity history.
- Helper-layer reason-required ceiling depends on persistence using the builder; raw-event construction bypasses the ceiling (schema floor remains).
- `Date.toISOString()` normalization is a persistence obligation; misformatted timestamps silently change the hash. Persistence MUST verify the format.
- v1 has no on-row head anchor; full-chain rewrite is undetectable without the external manifest.

### Neutral

- OCR pipeline unchanged.
- AGENTS.md unchanged.
- No new runtime dependency.
- Step-2/3 schemas unchanged.

## Cross-references

- `docs/adr/case-box-step-0-boundary.md` — boundary and cross-cutting invariant #3 ("Audit every write").
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — Step 2 fact lifecycle that consumes the audit log.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — Step 3 privilege-marker lifecycle that consumes the audit log.
- `docs/product/project-requirements-brief.md Appendix A` — cross-cutting invariant #3.
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` — pre-existing Step-1 schema, TINY ADDITIVE CHANGE in this WI.
- `docs/contracts/case-box-contract/src/audit-log.ts` — all Step-4 TS helpers.
- `docs/contracts/case-box-contract/tests/*.test.mjs` — full coverage including pinned canonical-output, chain happy path with real SHA-256, tamper detection, tenant/matter homogeneity, branded-hash validation, drift guards.
- `dev-memo/plan-case-box-step-4.md` — implementation plan (revised post plan-review).
- Codex plan-review thread `019e45ed`.

## Not in scope

- Persistence implementation (`case-box-persistence` is a future WI; this ADR records obligations).
- Hash algorithm selection beyond SHA-256 (post-MVP).
- Audit-log export format (privilege-log export is a `case-box-review` concern).
- LLM execution / cloud / sync / UI / API / auth.
- Encryption of audit-event payloads.
- Per-event digital signatures.
- External manifest signing (a v1 mitigation hook; the contract returns `headHash` but does not sign or store).
- Retention policy.
- Cross-tenant audit-event aggregation.
- Real-time audit-event streaming.

## Open questions deliberately deferred

1. Persistence-side `kind` column: soft-recommended, not required.
2. External manifest format and signing mechanism: a v1 mitigation hook; the helper returns `headHash` but does not define the manifest shape.
3. Algorithm pinning vs negotiation: v1 pins SHA-256 hex 64-char.
4. `sequence_number` for query performance: persistence concern.
5. Multi-tenant audit-event aggregation rules: future evolution.
