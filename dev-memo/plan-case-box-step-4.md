# CASE-BOX Step 4 — Plan: Audit-Log Shape and Helpers

**Status**: drafting (revised post plan-review thread `019e45ed`).
**Date**: 2026-05-20.
**Authorizes**: planning only. Implementation requires a follow-up authorization gate (granted by the parent user turn).
**Track**: ADR-series Step 4 (`docs/adr/case-box-step-4-audit-log-shape.md`, not yet written).
**Out of scope**: persistence, ingestion, review, sync bridge, UI, auth, cloud, LLM execution, OCR worker changes.

---

## 0. Naming acknowledgement

`docs/adr/case-box-step-0-boundary.md` ADR-series Step 4 = `case-box-step-4-audit-log-append-only.md` per the original Step-0 list; the user's authorization uses `case-box-step-4-audit-log-shape.md` (which more accurately describes the WI scope). This plan uses the user's filename. Same convention as Step 2 §0 and Step 3 §0.

---

## 1. The pre-existing problem

Step 1 shipped `CaseBoxAuditEvent` as one of the seven backbone entities. Its schema has a generic `action` enum (`create / update / delete-soft / access / export / print / share / privilege-waive`), a free-string `entity_type` field, no `additionalProperties: false` guard, and a single reason-required invariant (for `privilege-waive`). Steps 2 and 3 both depend on this event being emitted by persistence, but both ADRs hand-wave the precise mapping ("fact-accept = update audit event").

Step 4 closes the gap by:

1. Introducing a TS-level rich-vocabulary `CaseBoxAuditEventKind` enum mapped onto the existing generic `action` enum.
2. Shipping a pure canonical-hash-input function with **normalized timestamp included** (corrects v1-draft omission flagged by plan-review).
3. Shipping a pure chain-verifier that **requires** a caller-supplied `eventHashFn` (no weak fallback).
4. Adding two **tiny additive Step-1 schema changes** (justified by plan-review): `additionalProperties: false` and a constrained `entity_type` enum. Both changes preserve every existing valid fixture; both close the "raw write can corrupt the audit chain" gap that pure-TS helpers cannot.
5. Recording explicit persistence obligations for replay-tamper detection, including the documented v1 limitation that strong tamper detection requires an external anchor (export manifest with a head-hash) — the in-row chain alone detects mid-chain tampering only when *later* `prev_event_hash` values have not also been rewritten.

---

## 2. Schema modification policy: TWO tiny additive Step-1 changes

The user authorization said: "Do not change Step-1/2/3 schemas unless plan review proves a tiny additive change is required." Plan-review thread `019e45ed` proved this requirement. Specifically:

| Change | Justification | Backward-compat impact |
|---|---|---|
| Add `"additionalProperties": false` to `case-box-audit-event.schema.json` top-level | D2.1 Critical: without this, extras are not committed by the canonical hash; a writer can inject a field that consumers read but the chain doesn't protect | Existing Step-1 fixture has no extras; the privilege-waive invalid fixture has only `_invalid_reason` + `_target_schema` which are removed before validation. NO existing valid fixture rejected. |
| Constrain `entity_type` from free string to enum `["matter", "document", "deadline", "evidence_item", "ocr_link", "fact", "privilege_marker"]` | D2.2 High + D4.1 Critical: without this, persistence can write `entity_type = "wibble"` and the schema accepts it. Helper enforcement is documentation-only. | Existing Step-1 valid fixture uses `entity_type = "matter"`; in-enum. NO existing valid fixture rejected. |

Both changes are additive in the sense that every previously-valid event is still valid; they only narrow the accepted shape going forward. Both are required to make Step-4's enforcement actually load-bearing rather than advisory.

**Plan-review-aligned posture**: helpers AND schema both gate. Persistence cannot bypass either layer.

Other proposed schema changes are **rejected** for this WI:
- Adding `sequence_number`: persistence concern; ordering established by `prev_event_hash`.
- Expanding `action` enum to include rich-vocabulary values: rich vocabulary lives in TS `CaseBoxAuditEventKind`; schema stays generic for forward-compat.
- Adding `kind` field to the schema: same — would force every audit row to commit to a kind name, which obsolescence-risks more than the persistence-only column option in §10 (recorded obligation).

---

## 3. New TS helpers

All new code in a new `src/audit-log.ts` file. NO modification to existing TS files except `src/index.ts` (re-exports) and `src/loadSchemas.ts` (no change; existing audit-event schema is already loaded).

### 3.1 Entity-type vocabulary

The schema now constrains `entity_type` to an enum. The TS layer mirrors it:

```ts
export const CASE_BOX_AUDIT_ENTITY_TYPES = Object.freeze([
  "matter",
  "document",
  "deadline",
  "evidence_item",
  "ocr_link",
  "fact",
  "privilege_marker",
] as const);

export type CaseBoxAuditEntityType = typeof CASE_BOX_AUDIT_ENTITY_TYPES[number];

export function isKnownAuditEntityType(value: string): value is CaseBoxAuditEntityType {
  return (CASE_BOX_AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}
```

The schema enum and the TS enum MUST stay in sync. A test in `state-machine.test.mjs` or `exports.test.mjs` asserts the schema's `entity_type.enum` array equals `CASE_BOX_AUDIT_ENTITY_TYPES` (drift guard).

### 3.2 Lifecycle event vocabulary — rich kinds mapped to existing schema actions

Following plan-review D1.3 + D2.4 (FACT_SUPERSEDED is a CREATE; document kinds need edge specificity):

```ts
export const CASE_BOX_AUDIT_EVENT_KINDS = Object.freeze({
  // Matter
  MATTER_REGISTERED:        { action: "create",          entity_type: "matter",            reasonRequired: false },
  MATTER_ARCHIVED:          { action: "update",          entity_type: "matter",            reasonRequired: false },
  MATTER_UNARCHIVED:        { action: "update",          entity_type: "matter",            reasonRequired: false },
  // Document — edge-specific per state machine
  DOCUMENT_REGISTERED:      { action: "create",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_OCR_SUBMITTED:   { action: "update",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_OCR_COMPLETE:    { action: "update",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_OCR_FAILED:      { action: "update",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_TRIAGED:         { action: "update",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_TAGGED:          { action: "update",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_REVIEWED:        { action: "update",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_SOFT_DELETED:    { action: "delete-soft",     entity_type: "document",          reasonRequired: true  },
  // OCR link (read-only snapshot)
  OCR_LINK_SNAPSHOTTED:     { action: "create",          entity_type: "ocr_link",          reasonRequired: false },
  OCR_LINK_REFRESHED:       { action: "update",          entity_type: "ocr_link",          reasonRequired: false },
  // Deadline
  DEADLINE_REGISTERED:      { action: "create",          entity_type: "deadline",          reasonRequired: false },
  DEADLINE_MET:             { action: "update",          entity_type: "deadline",          reasonRequired: false },
  DEADLINE_MISSED:          { action: "update",          entity_type: "deadline",          reasonRequired: false },
  DEADLINE_WITHDRAWN:       { action: "update",          entity_type: "deadline",          reasonRequired: false },
  DEADLINE_MISSED_TO_MET:   { action: "update",          entity_type: "deadline",          reasonRequired: true  },
  // Evidence item
  EVIDENCE_PROPOSED:        { action: "create",          entity_type: "evidence_item",     reasonRequired: false },
  EVIDENCE_ACCEPTED:        { action: "update",          entity_type: "evidence_item",     reasonRequired: false },
  EVIDENCE_REJECTED:        { action: "update",          entity_type: "evidence_item",     reasonRequired: false },
  EVIDENCE_SUPERSEDED:      { action: "update",          entity_type: "evidence_item",     reasonRequired: false },
  // Fact (Step 2)
  FACT_PROPOSED:            { action: "create",          entity_type: "fact",              reasonRequired: false },
  FACT_REVIEWED:            { action: "update",          entity_type: "fact",              reasonRequired: false },
  FACT_ACCEPTED:            { action: "update",          entity_type: "fact",              reasonRequired: false },
  FACT_REJECTED:            { action: "update",          entity_type: "fact",              reasonRequired: true  },
  // CORRECTED per plan-review D1.3: supersession creates a NEW accepted fact row
  // (old row stays accepted; new row carries supersedes_fact_id). Audit event is
  // therefore a `create` on the new row, not an `update` on the old one.
  FACT_REPLACEMENT_ACCEPTED: { action: "create",         entity_type: "fact",              reasonRequired: false },
  // Privilege marker (Step 3)
  PRIVILEGE_MARKER_PROPOSED: { action: "create",         entity_type: "privilege_marker",  reasonRequired: false },
  PRIVILEGE_MARKER_CONFIRMED: { action: "update",        entity_type: "privilege_marker",  reasonRequired: false },
  PRIVILEGE_MARKER_DISMISSED: { action: "update",        entity_type: "privilege_marker",  reasonRequired: true  },
  PRIVILEGE_MARKER_WAIVED:   { action: "privilege-waive",entity_type: "privilege_marker",  reasonRequired: true  },
  // Confidentiality / opt-in toggles
  EXTERNAL_OCR_AUTHORIZED:  { action: "update",          entity_type: "matter",            reasonRequired: false },
  EXTERNAL_OCR_REVOKED:     { action: "update",          entity_type: "matter",            reasonRequired: true  },
  SYNC_GRANT_GRANTED:       { action: "update",          entity_type: "matter",            reasonRequired: false },
  SYNC_GRANT_REVOKED:       { action: "update",          entity_type: "matter",            reasonRequired: true  },
  LLM_EXTRACTION_OPT_IN:    { action: "update",          entity_type: "matter",            reasonRequired: false },
  LLM_EXTRACTION_OPT_OUT:   { action: "update",          entity_type: "matter",            reasonRequired: true  },
  // Operator / export
  PRIVILEGE_LOG_EXPORTED:   { action: "export",          entity_type: "matter",            reasonRequired: false },
  CASE_DATA_EXPORTED:       { action: "export",          entity_type: "matter",            reasonRequired: false },
  DOCUMENT_ACCESSED:        { action: "access",          entity_type: "document",          reasonRequired: false },
  DOCUMENT_PRINTED:         { action: "print",           entity_type: "document",          reasonRequired: false },
  DOCUMENT_SHARED:          { action: "share",           entity_type: "document",          reasonRequired: true  },
} as const);

export type CaseBoxAuditEventKind = keyof typeof CASE_BOX_AUDIT_EVENT_KINDS;
```

A test asserts every entry's `action` is in the Step-1 schema action enum (drift guard).

### 3.3 Canonical hash-input function — INCLUDES normalized timestamp + `id`

Plan-review D1.1 + D5.2 Critical: excluding `timestamp` (and arguably `id`) materially weakens tamper detection. v1 includes both. Persistence MUST normalize the timestamp before construction so equivalent representations hash identically.

**Normalization rule** (callers contract; helpers do not normalize on the caller's behalf — that's persistence's job):

- `timestamp`: persistence MUST stamp it via `new Date().toISOString()` (UTC, millisecond precision, trailing `Z`). The schema's `format: "date-time"` allows other equivalent forms (e.g., `+00:00` offset, no ms); persistence MUST normalize. The contract documents this; persistence MUST enforce.
- `id`: persistence assigns this as a ULID before construction; the value is immutable thereafter.

```ts
/**
 * Returns the canonical UTF-8 byte string to hash for an audit event's
 * `event_hash`. Persistence wraps this with the SHA-256 step.
 *
 * Properties:
 *  - Deterministic: same event always produces the same bytes.
 *  - Object-literal key order is alphabetical (the source-code order
 *    of the literal IS the JSON.stringify output order; that is the
 *    determinism mechanism. Refactors that change the literal order
 *    break the hash; pinned by exact-output test).
 *  - Includes EVERY field of the validated CaseBoxAuditEvent shape,
 *    INCLUDING `id` and `timestamp`. Plan-review D1.1/D5.2.
 *
 * Pre-conditions:
 *  - The event MUST have already passed `validateAuditEvent`. The helper
 *    throws if any required field is undefined (a guard against JSON.stringify
 *    silently omitting undefineds and corrupting the hash).
 *  - `timestamp` MUST be in normalized form per the §3.3 normalization rule.
 *    The helper does NOT normalize; it accepts the value verbatim.
 */
export function canonicalAuditEventHashInput(event: CaseBoxAuditEvent): string;
```

Implementation builds an alphabetically-ordered object literal in source code:

```ts
const canonical = {
  action: event.action,
  actor_user_id: event.actor_user_id,
  after_state_hash: event.after_state_hash,
  before_state_hash: event.before_state_hash,
  entity_id: event.entity_id,
  entity_type: event.entity_type,
  id: event.id,                                          // INCLUDED (plan-review)
  matter_id: event.matter_id,
  prev_event_hash: event.prev_event_hash,
  reason: event.reason ?? null,
  tenant_id: event.tenant_id,
  timestamp: event.timestamp,                            // INCLUDED (plan-review)
};
// Defensive: throw if any required field is undefined to prevent silent
// JSON.stringify omission (plan-review D3.2).
for (const [k, v] of Object.entries(canonical)) {
  if (v === undefined) throw new Error(`canonical field ${k} is undefined`);
}
return JSON.stringify(canonical);
```

Tests pin the EXACT canonical-output string for a known event fixture, not just equality between two object inputs (plan-review D3.1 + D4.3).

### 3.4 AuditEventHash branded type and `eventHashFn` shape

Plan-review D3.4: tighten the hash type so `eventHashFn: (event) => string` cannot accept any old string.

```ts
/**
 * A branded SHA-256 hex digest. Lowercase, exactly 64 hex characters.
 * Persistence produces these via `sha256(canonicalAuditEventHashInput(event))`.
 * Branded so a caller cannot accidentally pass a non-hash string.
 */
export type AuditEventHash = string & { readonly __brand: "AuditEventHash" };

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export function asAuditEventHash(value: string): AuditEventHash {
  if (!SHA256_HEX_RE.test(value)) {
    throw new Error(`not a valid lowercase SHA-256 hex digest (64 chars): ${JSON.stringify(value)}`);
  }
  return value as AuditEventHash;
}

export type EventHashFn = (event: CaseBoxAuditEvent) => AuditEventHash;
```

### 3.5 Reason-required helper

```ts
export class AuditEventReasonRequiredError extends Error {
  readonly kind: CaseBoxAuditEventKind;
  constructor(kind: CaseBoxAuditEventKind) {
    super(`audit event kind ${JSON.stringify(kind)} requires a non-empty reason`);
    this.name = "AuditEventReasonRequiredError";
    this.kind = kind;
  }
}

export function assertReasonForAuditEventKind(
  kind: CaseBoxAuditEventKind,
  reason: string | null | undefined,
): void {
  const meta = CASE_BOX_AUDIT_EVENT_KINDS[kind];
  if (!meta.reasonRequired) return;
  if (typeof reason !== "string" || reason.length === 0) {
    throw new AuditEventReasonRequiredError(kind);
  }
}
```

### 3.6 Builder — returns `ValidationResult` only, never throws (plan-review D1.4)

```ts
export interface BuildAuditEventInput {
  kind: CaseBoxAuditEventKind;
  id: string;
  tenant_id: string;
  actor_user_id: string;
  matter_id: string;
  entity_id: string;
  before_state_hash: string | null;
  after_state_hash: string;
  prev_event_hash: string | null;
  timestamp: string;
  reason?: string;
}

/**
 * Build a CaseBoxAuditEvent from a rich kind input. ALL violations
 * (reason-required helper rule AND schema-level rule) returned as
 * ok=false; helper never throws. Plan-review D1.4 mandated this for
 * API consistency with existing validators.
 */
export function buildCaseBoxAuditEvent(
  input: BuildAuditEventInput,
): ValidationResult<CaseBoxAuditEvent>;
```

Implementation: catch `AuditEventReasonRequiredError` from `assertReasonForAuditEventKind` and convert to `ok: false` with a synthesized error array entry that the existing `summarizeErrors` can handle. Then run `validateAuditEvent` and return its result if it fails.

### 3.7 Chain verifier — `eventHashFn` REQUIRED, tenant/matter homogeneity, head anchor

Plan-review D1.2 Critical + D2.3 High + D3.3 High:

```ts
export interface ChainVerifyOk {
  readonly ok: true;
  readonly verifiedCount: number;
  /** Hash of the last event in the chain; can be used as a head anchor. */
  readonly headHash: AuditEventHash | null;
}

export interface ChainVerifyErr {
  readonly ok: false;
  readonly errorIndex: number;
  readonly errorReason:
    | "prev_event_hash_mismatch"
    | "prev_event_hash_non_null_for_first_event"
    | "before_state_hash_not_null_on_create"
    | "missing_after_state_hash"
    | "event_schema_invalid"
    | "tenant_id_mismatch"
    | "matter_id_mismatch";
  readonly detail: string;
}

/**
 * Walk a sequence of audit events in append order and verify:
 *  - the first event has prev_event_hash === null
 *  - every subsequent event has prev_event_hash === eventHashFn(prior event)
 *  - every event passes validateAuditEvent
 *  - create-action events have before_state_hash === null
 *  - all events share the same tenant_id and matter_id (homogeneity)
 *
 * Pure; no IO. `eventHashFn` is REQUIRED — the weak-fallback comparison
 * to prior `after_state_hash` was removed per plan-review D1.2.
 *
 * Returns `headHash` (the canonical hash of the last event) on success;
 * persistence MAY use this as an anchor for an external manifest. The
 * head-hash is the v1 anchor mechanism; the ADR documents that strong
 * tamper detection requires storing this externally (e.g., in an
 * export manifest signed at export time).
 */
export function verifyAuditChain(
  events: ReadonlyArray<unknown>,
  options: { eventHashFn: EventHashFn },
): ChainVerifyOk | ChainVerifyErr;
```

The verifier is the load-bearing replay-tamper-detection helper.

### 3.8 v1 documented limitation: no on-row head anchor

Plan-review D3.3: chain verification alone is insufficient if a tamperer rewrites the WHOLE chain (every prev_event_hash). v1 mitigations:

- The contract returns `headHash` from `verifyAuditChain`.
- Persistence MUST periodically export the head hash to an external manifest (e.g., a signed manifest file produced at privilege-log export time).
- The ADR explicitly documents this v1 limitation. Stronger anchoring (per-event signature, blockchain anchor, etc.) is post-MVP.

---

## 4. Persistence obligations recorded

Same pattern as Step 2/3. Step 4 obligations:

1. **Append-only**: persistence MUST reject UPDATE or DELETE on audit-event rows.
2. **Builder-only emission**: persistence MUST emit audit events via `buildCaseBoxAuditEvent({ kind: ..., ... })`. Raw construction bypasses helper enforcement and is forbidden by code review.
3. **Hash chain integrity**: persistence MUST compute `prev_event_hash` from the previous event via `sha256(canonicalAuditEventHashInput(prev))` (or equivalent — algorithm pinned in §3.4 to SHA-256). Persistence MUST verify chain integrity with `verifyAuditChain` at every read of a matter's audit trail.
4. **Replay-tamper detection at export**: persistence MUST run `verifyAuditChain` at export time and reject any export whose chain does not verify.
5. **Head-anchor**: persistence MUST capture the `headHash` returned by `verifyAuditChain` into the export manifest and (for v1) MAY persist it alongside the audit table; the ADR documents that an external signed manifest is the v1 anchor mechanism.
6. **Timestamp normalization**: persistence MUST stamp `timestamp` via `new Date().toISOString()` (UTC, ms precision, trailing `Z`). Other equivalent representations are forbidden.
7. **Entity-type vocabulary**: persistence MUST pass `entity_type` values from `CASE_BOX_AUDIT_ENTITY_TYPES` only. Schema enum now enforces this at the wire level.
8. **`additionalProperties` strictness**: schema now rejects extras. Persistence MUST NOT write extras.
9. **Reason equality (plan-review D1.5)**: when an audit event row's `reason` is required AND the source entity carries its own reason (e.g., `CaseBoxFact.rejection_reason`, `CaseBoxPrivilegeMarker.dismissal_reason`, `CaseBoxPrivilegeMarker.waiver_reason`, `CaseBoxDeadline.transition_reason`), persistence MUST assert `auditEvent.reason === entity.rejection_reason` (etc.). Drift between the two is a persistence bug.
10. **Kind storage** (plan-review D4.2): persistence MAY store the `CaseBoxAuditEventKind` in a separate column for export self-description. The contract does NOT require this storage; the kind constant is a TS-layer discriminator that the schema's generic `action` cannot replace. If kind storage is not implemented, exports must reconstruct the kind by joining with entity history. The ADR records this as a soft recommendation, not a hard obligation.
11. **Storage separation**: persistence MAY store audit events in a separate SQLite file (per case-box-plan §2.1).
12. **Separate-store immutability**: persistence MUST prevent the audit DB file from being writable by non-audit roles (defense in depth).

---

## 5. Tests

### 5.1 Schema-change regression tests

- Existing Step-1 valid + invalid audit-event fixtures STILL pass / fail as before (additionalProperties + entity_type enum did not break them).
- New invalid fixture: `audit-event-extra-property.json` — has `_invalid_reason` + `_target_schema` + a `wibble: "foo"` extra → schema rejects (additionalProperties: false).
- New invalid fixture: `audit-event-bad-entity-type.json` — uses `entity_type = "wibble"` → schema rejects (enum).

### 5.2 Helper tests (extensions to `validators.test.mjs`)

- `canonicalAuditEventHashInput` happy path: returns the EXACT pinned canonical string for a known event fixture (insertion-order brittleness guard per plan-review D3.1/D4.3).
- Determinism: same event → same string, twice in a row.
- Includes `id` and `timestamp` (plan-review correction): canonical output contains both substrings.
- Throws on undefined required field.
- `assertReasonForAuditEventKind` truth table: reason-required kinds throw with empty/missing reason; not-required kinds don't throw.
- `buildCaseBoxAuditEvent` happy path: returns `ok: true` with correct `action` and `entity_type`.
- `buildCaseBoxAuditEvent` reason-required error path: returns `ok: false` for missing reason on reason-required kind.
- `buildCaseBoxAuditEvent` schema floor: returns `ok: false` for `PRIVILEGE_MARKER_WAIVED` with empty reason (both helper AND schema fire).
- `asAuditEventHash` rejects non-hex / wrong-length / uppercase.

### 5.3 Chain-verifier tests (extensions to `invariants.test.mjs`)

- Empty chain → `{ ok: true, verifiedCount: 0, headHash: null }`.
- Single create event with `prev_event_hash === null` → `{ ok: true, verifiedCount: 1, headHash: <sha> }`.
- First event with non-null `prev_event_hash` → `{ ok: false, errorReason: "prev_event_hash_non_null_for_first_event", errorIndex: 0 }`.
- Create-action event with non-null `before_state_hash` → `{ ok: false, errorReason: "before_state_hash_not_null_on_create" }`.
- Three-event chain with correct `prev_event_hash` via `eventHashFn` → `{ ok: true, verifiedCount: 3, headHash: <sha> }`.
- Same three-event chain with corrupted middle event → `{ ok: false, errorReason: "prev_event_hash_mismatch", errorIndex: 2 }`.
- Tenant mismatch in event 2 → `{ ok: false, errorReason: "tenant_id_mismatch", errorIndex: 1 }`.
- Matter mismatch in event 2 → `{ ok: false, errorReason: "matter_id_mismatch", errorIndex: 1 }`.
- Schema-invalid event in middle → `{ ok: false, errorReason: "event_schema_invalid", errorIndex: 1 }`.

### 5.4 Drift-guard tests

- Schema's `entity_type.enum` equals `CASE_BOX_AUDIT_ENTITY_TYPES` (a future schema change without a TS update fails this).
- Every `CASE_BOX_AUDIT_EVENT_KINDS[k].action` is in the schema's `action.enum`.
- Every `CASE_BOX_AUDIT_EVENT_KINDS[k].entity_type` is in `CASE_BOX_AUDIT_ENTITY_TYPES`.

### 5.5 Exports test (extensions to `exports.test.mjs`)

- Every new symbol from §3 listed.
- `AuditEventReasonRequiredError` constructor test.

---

## 6. Mechanical file checklist

| File | Action |
|---|---|
| `schemas/case-box-audit-event.schema.json` | **TINY ADDITIVE CHANGE**: add `additionalProperties: false`; change `entity_type` from `{type: string}` to `enum` |
| `src/audit-log.ts` | NEW — all of §3 |
| `src/index.ts` | EXTEND |
| `src/loadSchemas.ts` | UNCHANGED (schema already loaded) |
| `src/validateAuditEvent.ts` | UNCHANGED |
| `src/transitions.ts` | UNCHANGED |
| `src/invariants.ts` | UNCHANGED |
| `src/fact-invariants.ts` | UNCHANGED |
| `src/privilege-invariants.ts` | UNCHANGED |
| `src/generated/case-box-audit-event.ts` | REGENERATED (gen-types from updated schema; same shape, the enum is just narrower) |
| `fixtures/invalid/audit-event-extra-property.json` | NEW |
| `fixtures/invalid/audit-event-bad-entity-type.json` | NEW |
| `tests/contract.test.mjs` | EXTEND (2 new invalid fixtures) |
| `tests/validators.test.mjs` | EXTEND |
| `tests/invariants.test.mjs` | EXTEND |
| `tests/exports.test.mjs` | EXTEND |
| `tests/state-machine.test.mjs` | EXTEND (drift-guard tests for schema-vs-TS-vocabulary alignment) |
| `README.md` | EXTEND |
| `docs/adr/case-box-step-4-audit-log-shape.md` | NEW (co-committed) |

NOT touched:
- AGENTS.md.
- package.json (no new runtime deps).
- OCR packages.
- Persistence / ingestion / review / sync / UI / auth / cloud / LLM files.
- Step-1/2/3 schemas other than `case-box-audit-event.schema.json` (the tiny additive change is its own justified exception).

---

## 7. Public surface additions

- Constants: `CASE_BOX_AUDIT_ENTITY_TYPES`, `CASE_BOX_AUDIT_EVENT_KINDS`.
- Type guards: `isKnownAuditEntityType`.
- Functions: `canonicalAuditEventHashInput`, `assertReasonForAuditEventKind`, `buildCaseBoxAuditEvent`, `verifyAuditChain`, `asAuditEventHash`.
- Errors: `AuditEventReasonRequiredError`.
- Types: `CaseBoxAuditEntityType`, `CaseBoxAuditEventKind`, `BuildAuditEventInput`, `ChainVerifyOk`, `ChainVerifyErr`, `AuditEventHash`, `EventHashFn`.

---

## 8. Out of scope

- Persistence implementation.
- SHA-256 / SHA-3 / BLAKE3 selection (helper pins SHA-256 hex 64-char; persistence implements).
- Audit-log export format.
- Privilege-log export (Step 5/6).
- LLM execution / cloud / sync / UI / API / auth.
- Encryption of audit payloads.
- Retention policy.
- Real-time audit streaming.
- Per-event digital signatures (post-MVP anchor strengthening).
- External manifest signing (post-MVP).

---

## 9. Acceptance criteria

1. `schemas/case-box-audit-event.schema.json` has `additionalProperties: false` AND `entity_type.enum` populated.
2. `src/generated/case-box-audit-event.ts` regenerated; downstream `validateAuditEvent` still compiles.
3. `src/audit-log.ts` exists with every symbol from §3.
4. `src/index.ts` re-exports every new symbol.
5. Existing Step-1 valid/invalid fixture tests STILL pass (schema change preserves them).
6. New invalid fixtures `audit-event-extra-property.json` and `audit-event-bad-entity-type.json` reject correctly.
7. Step-3's 193 tests stay green; new tests bring the total higher.
8. OCR contract tests stay 102/102 green.
9. Zero Ajv strictRequired warnings (no conditional-then changes; baseline preserved).
10. `tsc` passes clean.
11. **Canonical-output exact-string test** — pins the exact string for a fixed event (plan-review D3.1/D4.3 brittleness guard).
12. **Canonical output INCLUDES `id` and `timestamp`** (plan-review D1.1/D5.2 correction).
13. **Canonical helper throws on undefined required field** (plan-review D3.2).
14. **`verifyAuditChain` REQUIRES `eventHashFn`** (no weak-fallback overload).
15. **Tenant/matter homogeneity test** — chain with mismatched tenant or matter in middle returns the documented error.
16. **Chain happy path** — 3-event chain with correct `prev_event_hash` returns `{ ok: true, verifiedCount: 3, headHash: <branded hash> }`.
17. **Chain tamper test** — corrupted middle event returns `{ ok: false, errorReason: "prev_event_hash_mismatch", errorIndex: 2 }`.
18. **Reason floor + ceiling test** — `PRIVILEGE_MARKER_WAIVED` empty reason fails at BOTH helper AND schema; `DEADLINE_MISSED_TO_MET` empty reason fails at helper only.
19. **Builder returns `ValidationResult` only** — verified by type-test or runtime assertion that it never throws.
20. **Action-vocabulary drift guard** — every `CASE_BOX_AUDIT_EVENT_KINDS[k].action` in schema action enum.
21. **Entity-vocabulary drift guard** — schema `entity_type.enum` equals `CASE_BOX_AUDIT_ENTITY_TYPES`.
22. **`FACT_REPLACEMENT_ACCEPTED` is a `create`** (plan-review D1.3 correction).
23. **No new runtime dependency.** (Process check.)
24. **AGENTS.md unchanged.** (Process check.)
25. **No OCR-package / persistence / ingestion / review / sync / UI / auth / cloud / LLM file modified.** (Process check.)
26. **No Step-2/3 schema modified.** (Process check.) Step-1's audit-event schema IS modified — that is the documented tiny additive exception.
27. README extended; ADR co-committed.

Criteria #23–#26 are process / git-diff checks.

---

## 10. Audit questions

1. **Tiny additive schema change limited to two fields**: `additionalProperties: false` AND `entity_type` enum only? (No other field touched.)
2. **All existing fixtures still pass**? Step-1 audit-event.valid.json + audit-event-privilege-waive-no-reason.json behave as before?
3. **Canonical hash INCLUDES `id` and `timestamp`**: exact-string test asserts both substrings present?
4. **Canonical hash determinism**: same input twice → same output? Different insertion-order construction in test produces the same canonical string?
5. **`undefined` guard**: helper throws when any canonical field is undefined?
6. **Chain verifier requires `eventHashFn`**: no overload accepts missing it?
7. **Tenant/matter homogeneity**: tests cover both mismatch cases?
8. **Head-hash returned**: `ChainVerifyOk.headHash` non-null when chain non-empty?
9. **Builder never throws**: type-level guarantee or runtime assertion?
10. **FACT_REPLACEMENT_ACCEPTED is `create`**: not `update`?
11. **Document-edge kinds**: every Step-3 document edge has a corresponding kind?
12. **Drift guards run**: schema-vs-TS alignment tests for entity_type AND action_value?
13. **Persistence obligations recorded**: append-only, builder-only emission, hash chain integrity, replay-tamper detection at export, head-anchor, timestamp normalization, entity-type vocabulary, additionalProperties strictness, reason equality, kind storage (soft recommendation), storage separation — all in the ADR?
14. **AuditEventHash branded**: helper rejects non-hex / wrong-length / uppercase?
15. **v1 limitation documented**: ADR explicitly states the chain alone is insufficient against full-chain rewrite; external anchor required for strong tamper detection?
16. **Reason equality obligation explicit**: persistence MUST assert `auditEvent.reason === entity.<corresponding>_reason` for fact rejection, privilege dismissal/waiver, deadline missed-to-met, opt-out/revocation?
17. **No persistence in this WI**: helper code purely TS; no IO / SQLite / network anywhere?

---

## 11. Risks / open items

- **Schema change is irreversible.** Once `additionalProperties: false` ships, future callers cannot add extras without a schema bump. This is intentional; documented in the ADR.
- **Schema entity_type enum needs maintenance.** Adding a new case-box entity (e.g., page-range markers later) requires updating BOTH the schema enum AND the TS constant. The drift-guard test catches divergence.
- **Canonical hash now includes `timestamp` and `id`.** Persistence MUST stamp timestamps as ISO 8601 UTC ms precision; any other format breaks tamper detection silently. The ADR documents this; persistence implementation MUST verify.
- **Builder API is non-throwing.** Existing helpers `assertValidNewFact`, `assertValidNewPrivilegeMarker`, etc. throw. Builder is intentionally different (returns ValidationResult) per plan-review D1.4; persistence must handle the difference.
- **Helper enforcement still relies on persistence using the builder.** Schema change closes the rawest gaps (entity_type, extras), but `buildCaseBoxAuditEvent` enforcement of reason-required is still bypassable if persistence constructs raw events. Persistence code review must mandate the builder.
- **Head-hash anchor is v1 mitigation only.** Without an external signed manifest, a tamperer with full DB access can rewrite the entire chain. ADR documents this explicitly.
- **No `sequence_number`.** If persistence needs explicit ordering (e.g., for SQLite query plans), it adds a column internally — not in the contract.
- **CASE_BOX_AUDIT_EVENT_KINDS grows.** Future entities will need more entries; each addition is a contract change (signaled by exports-drift test).
- **Reason equality is a persistence-layer obligation.** The contract documents it; cannot enforce it (cross-row check).

---

## 12. Plan-review thread

Codex review of the prior draft: thread `019e45ed`. Findings classified and resolved in this revision as follows:

| Codex finding | Resolution |
|---|---|
| D1.1 Critical — timestamp excluded from hash | §3.3 INCLUDES `id` and `timestamp`. Persistence normalizes timestamp; §11 documents the obligation. |
| D1.2 Critical — chain verifier weak fallback | §3.7 `eventHashFn` REQUIRED; weak fallback removed. |
| D2.1 Critical — no additionalProperties: false | §2 tiny additive Step-1 schema change: add `additionalProperties: false`. |
| D4.1 Critical — helper-only enforcement bypassable | §2 + §3.7 + §6: schema now constrains `entity_type` AND extras; persistence MUST use builder per §4 obligation. |
| D5.1 Critical — no-schema-change too load-bearing | §2 accepts two tiny additive changes; non-load-bearing posture replaced. |
| D5.2 Critical — timestamp exclusion weakens tamper detection | Same as D1.1; resolved. |
| D1.3 High — FACT_SUPERSEDED should be create | §3.2 renamed to `FACT_REPLACEMENT_ACCEPTED` with `action: "create"`. |
| D1.4 High — builder API mismatch (returns ValidationResult but calls throwing helper) | §3.6 builder ONLY returns ValidationResult; helper violations wrapped, not propagated. |
| D2.2 High — entity_type free string allows "wibble" | §2 schema change: enum. |
| D2.3 High — chain verifier lacks tenant/matter homogeneity | §3.7 + tests: tenant + matter mismatch detected. |
| D2.4 High — document kinds too generic | §3.2 adds DOCUMENT_OCR_SUBMITTED / DOCUMENT_OCR_COMPLETE / DOCUMENT_OCR_FAILED / DOCUMENT_TRIAGED / DOCUMENT_TAGGED / DOCUMENT_REVIEWED. |
| D3.1 High — JSON.stringify determinism risk | §3.3 documents the mechanism (literal source-order = output order); §5.2 pinned-exact-string test. |
| D3.2 High — undefined silently omitted | §3.3 throws on undefined required field. |
| D3.3 High — no anchored head hash | §3.7 returns `headHash`; §3.8 + ADR document v1 limitation: external manifest required for strong tamper detection. |
| D3.4 Medium — eventHashFn too loose | §3.4 introduces `AuditEventHash` branded type + `asAuditEventHash` validator. |
| D4.2 High — kind not stored in audit row | §10 persistence obligation: MAY store kind in separate column for self-description; OTHERWISE exports must reconstruct from entity history. Documented soft recommendation. |
| D4.3 High — insertion-order brittleness | §5.2 pinned-exact-output test. |
| D1.5 Medium — reason duplication can diverge | §4 obligation #9: persistence MUST assert `auditEvent.reason === entity.<corresponding>_reason`. |
| D3.5 Medium — builder error format | §3.6: helper violations wrapped into `ok: false` with synthesized error array. |
| D4.4 Medium — kinds additions break consumers | §11 risk noted; exports-drift test catches addition. |
| D4.5 Medium — timestamp normalization unspecified | §3.3 specifies `Date.toISOString()` UTC ms precision; §4 persistence obligation. |
| D5.3 High — persistence-facing design pass needed | §3.8 + §4 + ADR document the persistence contract explicitly. |
| D5.4 High — helper table obsolesces | §11 risk noted; addition pattern is established. |
| D5.5 Medium — reason equality enforcement | §4 obligation #9. |
| D2.5 Medium — more fixtures needed | §5.1 adds 2 new invalid fixtures for the new schema constraints. |

---

## 13. References

- `docs/adr/case-box-step-0-boundary.md` — boundary; cross-cutting invariant #3 ("Audit every write").
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — Step 2 consumes the audit log.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — Step 3 consumes the audit log.
- `docs/product/product-target-architecture.md` — cross-cutting invariant #3.
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` — pre-existing Step-1 schema (TINY ADDITIVE CHANGE this WI).
- `docs/contracts/case-box-contract/src/validateAuditEvent.ts` — unchanged.
- `dev-memo/plan-case-box-step-3.md` — plan structure mirror.
- `dev-memo/superseded/case-box-plan.md` — original `audit_event` shape concept.
- Codex plan-review thread: `019e45ed`.
- `AGENTS.md` — Stop-and-Ask gates.
