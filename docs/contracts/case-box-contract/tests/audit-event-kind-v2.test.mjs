// audit-event-kind-v2.test.mjs — contract tests for the v2 audit-event-kind canonicalization
// (ADR docs/adr/audit-event-kind-preservation.md, Batch 1 WI-V1).
//
// Proves: v1 stays byte-identical; v2 canonical pins the two new HASHED fields; build sets them;
// the field-pair + version + consistency invariants are enforced at the verification (security)
// boundary; event_kind tampering breaks verification for v2 rows; mixed v1/v2 chains verify.
//
// NOTE: validators.test.mjs (which owns the original v1 golden) is intentionally NOT edited — the v1
// expectation is REPRODUCED here so this file independently proves v1 is byte-identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  canonicalAuditEventHashInput,
  verifyAuditChain,
  buildCaseBoxAuditEvent,
  validateAuditEvent,
  CASE_BOX_AUDIT_EVENT_KINDS,
  asAuditEventHash,
} from "../dist/index.js";

const eventHashFn = (e) =>
  asAuditEventHash(createHash("sha256").update(canonicalAuditEventHashInput(e)).digest("hex"));

const ID_A = "01jrcasebox0000000000000a1";
const ID_M = "01jrcasebox0000000000000m1";
const TS = "2026-05-20T09:00:00.000Z";

// v1 legacy event (NO audit_schema_version / event_kind).
function v1Event(over = {}) {
  return {
    id: ID_A, tenant_id: "tenant-local-v1", actor_user_id: "local-user", matter_id: ID_M,
    action: "create", entity_type: "matter", entity_id: ID_M,
    before_state_hash: null, after_state_hash: "sha256:abc", prev_event_hash: null, timestamp: TS,
    ...over,
  };
}
// v2 event — adds the two new fields; defaults to a consistent MATTER_REGISTERED (create/matter).
function v2Event(over = {}) {
  return { ...v1Event(), audit_schema_version: 2, event_kind: "MATTER_REGISTERED", ...over };
}

// --- 1. v1 byte-identical (reproduced golden; validators.test.mjs NOT touched) ---

const V1_CANONICAL =
  '{"action":"create","actor_user_id":"local-user","after_state_hash":"sha256:abc","before_state_hash":null,"entity_id":"01jrcasebox0000000000000m1","entity_type":"matter","id":"01jrcasebox0000000000000a1","matter_id":"01jrcasebox0000000000000m1","prev_event_hash":null,"reason":null,"tenant_id":"tenant-local-v1","timestamp":"2026-05-20T09:00:00.000Z"}';

test("v1: canonicalAuditEventHashInput is byte-identical for legacy events (no version)", () => {
  assert.equal(canonicalAuditEventHashInput(v1Event()), V1_CANONICAL);
});

// --- 2. v2 canonical pinned (14 fields, alphabetical, includes the two hashed fields) ---

const V2_CANONICAL =
  '{"action":"create","actor_user_id":"local-user","after_state_hash":"sha256:abc","audit_schema_version":2,"before_state_hash":null,"entity_id":"01jrcasebox0000000000000m1","entity_type":"matter","event_kind":"MATTER_REGISTERED","id":"01jrcasebox0000000000000a1","matter_id":"01jrcasebox0000000000000m1","prev_event_hash":null,"reason":null,"tenant_id":"tenant-local-v1","timestamp":"2026-05-20T09:00:00.000Z"}';

test("v2: canonicalAuditEventHashInput pins the 14-field string with audit_schema_version + event_kind", () => {
  assert.equal(canonicalAuditEventHashInput(v2Event()), V2_CANONICAL);
  // v2 differs from v1 for the same underlying event → the kind/version participate in the hash.
  assert.notEqual(canonicalAuditEventHashInput(v2Event()), V1_CANONICAL);
});

// --- 3. buildCaseBoxAuditEvent sets both v2 fields ---

test("v2: buildCaseBoxAuditEvent sets event_kind and audit_schema_version on new events", () => {
  const r = buildCaseBoxAuditEvent({
    kind: "DEADLINE_MET", id: ID_A, tenant_id: "tenant-local-v1", actor_user_id: "local-user",
    matter_id: ID_M, entity_id: ID_M, before_state_hash: "sha256:prev", after_state_hash: "sha256:post",
    prev_event_hash: null, timestamp: TS,
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.event_kind, "DEADLINE_MET");
  assert.equal(r.value.audit_schema_version, 2);
  assert.equal(r.value.action, "update");
  assert.equal(r.value.entity_type, "deadline");
});

// --- 4. field-pair: partial presence rejected (schema + canonicalizer) ---

test("v2: partial pair (event_kind without audit_schema_version) is rejected by schema", () => {
  const r = validateAuditEvent(v1Event({ event_kind: "MATTER_REGISTERED" }));
  assert.equal(r.ok, false);
});
test("v2: partial pair (audit_schema_version without event_kind) is rejected by schema", () => {
  const r = validateAuditEvent(v1Event({ audit_schema_version: 2 }));
  assert.equal(r.ok, false);
});
test("v2: canonicalAuditEventHashInput throws on a partial pair / bad version / unknown kind", () => {
  assert.throws(() => canonicalAuditEventHashInput(v1Event({ event_kind: "MATTER_REGISTERED" })), /partial v2 pair/);
  assert.throws(() => canonicalAuditEventHashInput(v1Event({ audit_schema_version: 2 })), /partial v2 pair/);
  assert.throws(() => canonicalAuditEventHashInput(v2Event({ audit_schema_version: 3 })), /unsupported audit_schema_version/);
  assert.throws(() => canonicalAuditEventHashInput(v2Event({ event_kind: "NOT_A_KIND" })), /unknown event_kind/);
});

// --- 5. consistency invariant {action, entity_type, reasonRequired} enforced at the VERIFY boundary ---

test("v2: verifyAuditChain rejects a v2 event whose event_kind action/entity_type mismatch", () => {
  // DEADLINE_MET declares {update, deadline} but this event is a create/matter → inconsistent.
  const bad = v2Event({ event_kind: "DEADLINE_MET" });
  const r = verifyAuditChain([bad], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_kind_inconsistent");
});

test("v2: verifyAuditChain rejects a reasonRequired kind with no reason (ADR §4)", () => {
  // DEADLINE_MISSED_TO_MET declares {update, deadline, reasonRequired:true}; action/entity match but reason missing.
  const bad = v2Event({
    action: "update", entity_type: "deadline", event_kind: "DEADLINE_MISSED_TO_MET",
    before_state_hash: "sha256:prev",
  });
  const r = verifyAuditChain([bad], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_kind_inconsistent");
});

test("v2: a consistent reasonRequired kind WITH a reason verifies", () => {
  const ok = v2Event({
    action: "update", entity_type: "deadline", event_kind: "DEADLINE_MISSED_TO_MET",
    before_state_hash: "sha256:prev", reason: "corrected after filing receipt",
  });
  const r = verifyAuditChain([ok], { eventHashFn });
  assert.equal(r.ok, true);
});

// --- 6. event_kind tampering breaks verification for v2 rows (the load-bearing property) ---

test("v2: tampering event_kind within the same {action,entity_type} class breaks chain verification", () => {
  // 3-event chain; tamper the MIDDLE event's kind DEADLINE_MET -> DEADLINE_MISSED (same class, still
  // consistent) WITHOUT recomputing hashes. Because event_kind is hashed in v2, the recomputed middle
  // hash changes and the successor's prev_event_hash no longer matches.
  const e1 = v2Event({ id: "01jrcasebox0000000000000a1", event_kind: "MATTER_REGISTERED" });
  const e2 = v2Event({
    id: "01jrcasebox0000000000000a2", action: "update", entity_type: "deadline",
    event_kind: "DEADLINE_MET", before_state_hash: "sha256:b2", prev_event_hash: eventHashFn(e1),
  });
  const e3 = v2Event({
    id: "01jrcasebox0000000000000a3", action: "update", entity_type: "matter",
    event_kind: "MATTER_ARCHIVED", before_state_hash: "sha256:b3", prev_event_hash: eventHashFn(e2),
  });
  assert.equal(verifyAuditChain([e1, e2, e3], { eventHashFn }).ok, true); // untampered chain verifies
  const tampered = { ...e2, event_kind: "DEADLINE_MISSED" }; // same {update,deadline}; e3.prev still = hash(e2 met)
  const r = verifyAuditChain([e1, tampered, e3], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "prev_event_hash_mismatch");
  assert.equal(r.errorIndex, 2);
});

// --- 7. mixed v1/v2 chains verify ---

test("mixed: a v1 legacy event followed by a v2 event verifies end-to-end", () => {
  const e1 = v1Event({ id: "01jrcasebox0000000000000a1" }); // legacy, no version
  const e2 = v2Event({
    id: "01jrcasebox0000000000000a2", action: "update", entity_type: "matter",
    event_kind: "MATTER_ARCHIVED", before_state_hash: "sha256:b2", prev_event_hash: eventHashFn(e1),
  });
  const r = verifyAuditChain([e1, e2], { eventHashFn });
  assert.equal(r.ok, true);
  assert.equal(r.verifiedCount, 2);
});

// --- 8. schema event_kind enum stays in sync with the TS kinds map ---

test("schema event_kind enum equals the CASE_BOX_AUDIT_EVENT_KINDS keys", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = JSON.parse(
    readFileSync(join(here, "..", "schemas", "case-box-audit-event.schema.json"), "utf8"),
  );
  const schemaEnum = [...schema.properties.event_kind.enum].sort();
  const tsKeys = Object.keys(CASE_BOX_AUDIT_EVENT_KINDS).sort();
  assert.deepEqual(schemaEnum, tsKeys);
});

// --- 9. downgrade attempts (ADR §10): strip both fields / change version ---

test("v2: stripping both fields (downgrade to v1) on a non-last event breaks chain verification", () => {
  const e1 = v2Event({ id: "01jrcasebox0000000000000a1", event_kind: "MATTER_REGISTERED" });
  const e2 = v2Event({
    id: "01jrcasebox0000000000000a2", action: "update", entity_type: "matter",
    event_kind: "MATTER_ARCHIVED", before_state_hash: "sha256:b2", prev_event_hash: eventHashFn(e1),
  });
  const e3 = v2Event({
    id: "01jrcasebox0000000000000a3", action: "update", entity_type: "matter",
    event_kind: "MATTER_UNARCHIVED", before_state_hash: "sha256:b3", prev_event_hash: eventHashFn(e2),
  });
  assert.equal(verifyAuditChain([e1, e2, e3], { eventHashFn }).ok, true);
  // Strip the v2 pair from the middle event (downgrade) without recomputing the successor link: it is
  // now hashed under v1 (12 fields, no event_kind), so its recomputed hash no longer matches e3.prev.
  const downgraded = { ...e2 };
  delete downgraded.event_kind;
  delete downgraded.audit_schema_version;
  const r = verifyAuditChain([e1, downgraded, e3], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "prev_event_hash_mismatch");
  assert.equal(r.errorIndex, 2);
});

test("v2: an unsupported audit_schema_version is rejected by verifyAuditChain (schema const 2)", () => {
  const r = verifyAuditChain([v2Event({ audit_schema_version: 3 })], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_schema_invalid");
});

// --- 10. WI-DPE2: DOCKET_ENTRY_REVISED is a first-class kind that auto-participates ---

test("DOCKET_ENTRY_REVISED is a known kind declaring {update, docket_entry, reasonRequired:false}", () => {
  const meta = CASE_BOX_AUDIT_EVENT_KINDS.DOCKET_ENTRY_REVISED;
  assert.ok(meta, "DOCKET_ENTRY_REVISED must be in CASE_BOX_AUDIT_EVENT_KINDS");
  assert.equal(meta.action, "update");
  assert.equal(meta.entity_type, "docket_entry");
  assert.equal(meta.reasonRequired, false);
});

test("v2: a DOCKET_ENTRY_REVISED event canonicalizes deterministically and verifies", () => {
  const ev = v2Event({
    action: "update", entity_type: "docket_entry", event_kind: "DOCKET_ENTRY_REVISED",
    before_state_hash: "sha256:prev",
  });
  // Auto-participates: the canonicalizer accepts it via the hasOwnProperty kind gate (no code change).
  const canonical = canonicalAuditEventHashInput(ev);
  assert.equal(canonical, canonicalAuditEventHashInput(ev)); // deterministic
  assert.match(canonical, /"event_kind":"DOCKET_ENTRY_REVISED"/);
  const r = verifyAuditChain([ev], { eventHashFn });
  assert.equal(r.ok, true);
});

// --- WI-A3-UNLINK-AUDIT-KINDS: the LINK_UNLINKED / LINK_RELINKED kinds + the `link` entity_type ---
const ID_L = "01jrcasebox0000000000000l1";

test("link audit kinds: registry declares the expected {action, entity_type, reasonRequired} tuples", () => {
  assert.deepEqual(CASE_BOX_AUDIT_EVENT_KINDS.LINK_UNLINKED, { action: "update", entity_type: "link", reasonRequired: true });
  assert.deepEqual(CASE_BOX_AUDIT_EVENT_KINDS.LINK_RELINKED, { action: "update", entity_type: "link", reasonRequired: false });
});

test("link audit kinds: a LINK_UNLINKED event (reasonRequired) WITH a reason verifies", () => {
  const ev = v2Event({
    action: "update", entity_type: "link", entity_id: ID_L, event_kind: "LINK_UNLINKED",
    before_state_hash: "sha256:prev", reason: "detached by lawyer",
  });
  const canonical = canonicalAuditEventHashInput(ev);
  assert.match(canonical, /"event_kind":"LINK_UNLINKED"/);
  assert.match(canonical, /"entity_type":"link"/);
  const r = verifyAuditChain([ev], { eventHashFn });
  assert.equal(r.ok, true);
});

test("link audit kinds: a LINK_UNLINKED event WITHOUT a reason is rejected (reasonRequired, ADR §4)", () => {
  // `reason` is OMITTED (the schema's reason is an optional string, not nullable); the reasonRequired
  // kind tuple is then enforced at the verify boundary, like DEADLINE_MISSED_TO_MET above.
  const bad = v2Event({
    action: "update", entity_type: "link", entity_id: ID_L, event_kind: "LINK_UNLINKED",
    before_state_hash: "sha256:prev",
  });
  const r = verifyAuditChain([bad], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_kind_inconsistent");
});

test("link audit kinds: a LINK_RELINKED event (reasonRequired false) WITHOUT a reason verifies", () => {
  const ev = v2Event({
    action: "update", entity_type: "link", entity_id: ID_L, event_kind: "LINK_RELINKED",
    before_state_hash: "sha256:prev",
  });
  const r = verifyAuditChain([ev], { eventHashFn });
  assert.equal(r.ok, true);
});

test("link audit kinds: a LINK_UNLINKED event whose action/entity_type mismatch the kind is rejected", () => {
  // declare LINK_UNLINKED but use the wrong (create/matter) action/entity -> tuple mismatch.
  const bad = v2Event({ event_kind: "LINK_UNLINKED", reason: "x" });
  const r = verifyAuditChain([bad], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_kind_inconsistent");
});
