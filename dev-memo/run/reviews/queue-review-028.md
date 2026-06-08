QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-AUDIT-EVENT-KIND-V2-CONTRACT-00 (WI-V1 SOURCE, WI-V2 TEST)

Batch 1 of 2: implement the accepted ADR `docs/adr/audit-event-kind-preservation.md` at the audit-event
CONTRACT + HASH CHAIN (security boundary) — persist a tamper-evident `event_kind` + `audit_schema_version`
for new events via versioned canonicalization (v1 byte-identical; v2 hashed; mixed chains verify). UI
deferred to Batch 2. HIGH-RISK → broker review-plan + per-WI audit/verify.

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
- `review-plan-mq56p18y-k49h91`: **CONDITIONAL PASS** — H: the event_kind↔{action,entity_type}
  consistency check must run at the verification boundary, not builder-only (else tampered v2 payloads
  pass). M: the invariant is many-to-one (declared-equals-event, not uniqueness). M: the canonicalizer
  (called directly by eventHashFn) must throw on a malformed/unsupported version. → all adopted.
- `review-plan-mq56s5b6-edpv7w`: **FAIL** — H: the fix named `validateAuditEvent` (its own file, not in
  Allowed) and would create a circular import (audit-log.ts imports validateAuditEvent; the kinds map
  lives in audit-log.ts). → relocated the check into `verifyAuditChain`'s loop in audit-log.ts (kinds
  map already in scope; no new file; no cycle).
- `review-plan-mq56wfd5-e3uwcy`: **FAIL** — H (source conflict): the queue narrowed the ADR §4 invariant
  to {action,entity_type}; ADR §4 requires {action,entity_type,reasonRequired}. → conformed the queue to
  the authoritative ADR (added reasonRequired enforcement at the verify boundary; noted it is stronger
  than the schema's privilege-waive-only reason rule).
- `review-plan-mq56z86t-0to6sg`: **PASS / GOVERNABLE** — only a Low (a stale item-(5) phrase reading as a
  contradiction with item (4)). → cleaned up.
- `review-plan-mq571l86-53z2sm` (confirm, final bytes): **PASS / GOVERNABLE — no findings.**

## Confirmations
- Queue-lint PASSED (2 WIs; WI-V2 depends on WI-V1; no later-dep).
- WI-V1 (HIGH-RISK SOURCE): schema (optional event_kind enum + audit_schema_version const 2 +
  dependentRequired field-pair, additionalProperties:false) → regen type (`npm run gen:types`) →
  `canonicalAuditEventHashInput` v1/v2 branch (v1 byte-identical; v2 = 14 fields alphabetical; throws on
  malformed/unsupported version) → buildCaseBoxAuditEvent sets both fields → consistency invariant
  {action,entity_type,reasonRequired} enforced in `verifyAuditChain` (audit-log.ts, no cycle) → new
  `tests/audit-event-kind-v2.test.mjs` registered in package.json `scripts.test` (one line; user-authorized
  2026-06-08). `validators.test.mjs` FORBIDDEN/untouched (over-LOC; its v1 golden is the proof).
- WI-V2 (TEST, no src): extend the already-listed `hardening-audit.test.mjs` — event_json round-trip,
  legacy/v2/mixed verify, head-anchor, tamper. No persistence src/migration/column/package change.
- No forbidden-path intersection with `dev-memo/run/forbidden-paths.txt`.
- Governance follows the documented rule: mark-reviewed + govern STANDALONE, content-bind verified, THEN
  commit separately. WI-V1 high-risk → per-WI cc-suite audit + verify at impl.
