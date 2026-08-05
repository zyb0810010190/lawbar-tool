// audit-event-kind-matter-details.test.mjs — contract tests for the MATTER_DETAILS_UPDATED audit
// kind + the narrow structured `changed_fields` (plan-matter-details-edit Phase A; D5a).
//
// Proves:
//   1. #1 INVARIANT — byte-preservation: an event WITHOUT changed_fields canonicalizes byte-identically
//      to before this WI (no "changed_fields" token in the canonical string for any existing/absent case).
//   2. Tamper-evidence: a MATTER_DETAILS_UPDATED event WITH changed_fields includes it in the canonical
//      string in the correct alphabetical slot (before_state_hash < changed_fields < entity_id); two such
//      events differing ONLY in changed_fields hash DIFFERENTLY.
//   3. Kind registration + reasonRequired enforced at the verify (security) boundary.
//   4. Schema: accepts a valid changed_fields on MATTER_DETAILS_UPDATED; REJECTS it on every other kind;
//      rejects non-allowlisted / empty / duplicate values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  canonicalAuditEventHashInput,
  verifyAuditChain,
  validateAuditEvent,
  CASE_BOX_AUDIT_EVENT_KINDS,
  asAuditEventHash,
} from "../dist/index.js";

const eventHashFn = (e) =>
  asAuditEventHash(createHash("sha256").update(canonicalAuditEventHashInput(e)).digest("hex"));

const ID_A = "01jrcasebox0000000000000a1";
const ID_M = "01jrcasebox0000000000000m1";
const TS = "2026-08-04T09:00:00.000Z";

// A v2 MATTER_DETAILS_UPDATED base event (action:update, entity_type:matter, reasonRequired:true).
function mduEvent(over = {}) {
  return {
    id: ID_A, tenant_id: "tenant-local-v1", actor_user_id: "local-user", matter_id: ID_M,
    action: "update", entity_type: "matter", entity_id: ID_M,
    before_state_hash: "sha256:prev", after_state_hash: "sha256:post", prev_event_hash: null,
    timestamp: TS, reason: "corrected caption",
    audit_schema_version: 2, event_kind: "MATTER_DETAILS_UPDATED",
    ...over,
  };
}

const EDITABLE_FIELDS = [
  "name", "retainer_scope", "case_type_text",
  "case_progress_text", "court_contact_text", "contention_summary_text",
];

// --- 1. kind registration ---

test("MATTER_DETAILS_UPDATED is a known kind declaring {update, matter, reasonRequired:true}", () => {
  const meta = CASE_BOX_AUDIT_EVENT_KINDS.MATTER_DETAILS_UPDATED;
  assert.ok(meta, "MATTER_DETAILS_UPDATED must be in CASE_BOX_AUDIT_EVENT_KINDS");
  assert.equal(meta.action, "update");
  assert.equal(meta.entity_type, "matter");
  assert.equal(meta.reasonRequired, true);
});

// --- 2. #1 INVARIANT: byte-preservation — no changed_fields => no "changed_fields" token ---

test("byte-preservation: a MATTER_DETAILS_UPDATED event WITHOUT changed_fields has NO changed_fields token", () => {
  const canonical = canonicalAuditEventHashInput(mduEvent());
  assert.ok(!canonical.includes("changed_fields"),
    "an event without changed_fields must not introduce the token (byte-preservation)");
});

test("byte-preservation: an existing-kind v2 event canonicalizes with NO changed_fields token", () => {
  // MATTER_ARCHIVED is a pre-existing kind; its canonical string must be unchanged by this WI.
  const archived = {
    id: ID_A, tenant_id: "tenant-local-v1", actor_user_id: "local-user", matter_id: ID_M,
    action: "update", entity_type: "matter", entity_id: ID_M,
    before_state_hash: "sha256:prev", after_state_hash: "sha256:post", prev_event_hash: null,
    timestamp: TS, audit_schema_version: 2, event_kind: "MATTER_ARCHIVED",
  };
  const canonical = canonicalAuditEventHashInput(archived);
  assert.ok(!canonical.includes("changed_fields"));
  // Explicitly pin the exact 14-field string (byte-identical to the pre-change v2 shape).
  assert.equal(
    canonical,
    '{"action":"update","actor_user_id":"local-user","after_state_hash":"sha256:post","audit_schema_version":2,"before_state_hash":"sha256:prev","entity_id":"01jrcasebox0000000000000m1","entity_type":"matter","event_kind":"MATTER_ARCHIVED","id":"01jrcasebox0000000000000a1","matter_id":"01jrcasebox0000000000000m1","prev_event_hash":null,"reason":null,"tenant_id":"tenant-local-v1","timestamp":"2026-08-04T09:00:00.000Z"}',
  );
});

test("byte-preservation: an explicit changed_fields:undefined is NOT serialized (conditional spread)", () => {
  const canonical = canonicalAuditEventHashInput(mduEvent({ changed_fields: undefined }));
  assert.ok(!canonical.includes("changed_fields"));
});

// --- 3. tamper-evidence: changed_fields is hashed in the correct alphabetical slot ---

test("tamper-evidence: changed_fields appears in the canonical string between before_state_hash and entity_id", () => {
  const canonical = canonicalAuditEventHashInput(mduEvent({ changed_fields: ["name"] }));
  assert.match(canonical, /"changed_fields":\["name"\]/);
  const iBefore = canonical.indexOf('"before_state_hash"');
  const iChanged = canonical.indexOf('"changed_fields"');
  const iEntity = canonical.indexOf('"entity_id"');
  assert.ok(iBefore >= 0 && iChanged >= 0 && iEntity >= 0);
  assert.ok(iBefore < iChanged, "changed_fields must sort AFTER before_state_hash");
  assert.ok(iChanged < iEntity, "changed_fields must sort BEFORE entity_id");
});

test("tamper-evidence: two MATTER_DETAILS_UPDATED events differing ONLY in changed_fields hash differently", () => {
  const a = mduEvent({ changed_fields: ["name"] });
  const b = mduEvent({ changed_fields: ["retainer_scope"] });
  assert.notEqual(canonicalAuditEventHashInput(a), canonicalAuditEventHashInput(b));
  assert.notEqual(eventHashFn(a), eventHashFn(b));
});

// --- audit finding M: the canonicalizer (a security boundary) rejects changed_fields on any non-MDU event ---

test("guard (audit M): canonicalizer THROWS on changed_fields on a non-MATTER_DETAILS_UPDATED v2 kind", () => {
  const archivedWithCf = {
    id: ID_A, tenant_id: "tenant-local-v1", actor_user_id: "local-user", matter_id: ID_M,
    action: "update", entity_type: "matter", entity_id: ID_M,
    before_state_hash: "sha256:prev", after_state_hash: "sha256:post", prev_event_hash: null,
    timestamp: TS, audit_schema_version: 2, event_kind: "MATTER_ARCHIVED",
    changed_fields: ["name"],
  };
  assert.throws(
    () => canonicalAuditEventHashInput(archivedWithCf),
    /changed_fields is only allowed on MATTER_DETAILS_UPDATED/,
  );
});

test("guard (audit M): canonicalizer THROWS on changed_fields on a v1 legacy event (no version/kind)", () => {
  const v1WithCf = {
    id: ID_A, tenant_id: "tenant-local-v1", actor_user_id: "local-user", matter_id: ID_M,
    action: "update", entity_type: "matter", entity_id: ID_M,
    before_state_hash: "sha256:prev", after_state_hash: "sha256:post", prev_event_hash: null,
    timestamp: TS,
    changed_fields: ["name"],
  };
  assert.throws(
    () => canonicalAuditEventHashInput(v1WithCf),
    /changed_fields is only allowed on MATTER_DETAILS_UPDATED/,
  );
});

// --- audit finding L: changed_fields hashing is ORDER-SENSITIVE (the Phase-B emitter MUST emit sorted) ---

test("order-sensitivity (audit L): unsorted vs sorted changed_fields hash DIFFERENTLY — emitter must sort", () => {
  // Same semantic SET, different order → different canonical/hash. This is exactly WHY the Phase-B
  // persistence emitter MUST emit changed_fields in canonical sorted order (schema description + ADR).
  const sorted = mduEvent({ changed_fields: ["case_type_text", "name"] });
  const unsorted = mduEvent({ changed_fields: ["name", "case_type_text"] });
  assert.notEqual(canonicalAuditEventHashInput(sorted), canonicalAuditEventHashInput(unsorted));
});

test("tamper-evidence: same event with vs without changed_fields hashes differently", () => {
  const withCf = mduEvent({ changed_fields: ["name"] });
  const withoutCf = mduEvent();
  assert.notEqual(canonicalAuditEventHashInput(withCf), canonicalAuditEventHashInput(withoutCf));
});

// --- 4. reasonRequired + chain verification ---

test("verify: a MATTER_DETAILS_UPDATED event WITH a reason + changed_fields verifies", () => {
  const ev = mduEvent({ changed_fields: ["name", "retainer_scope"] });
  const r = verifyAuditChain([ev], { eventHashFn });
  assert.equal(r.ok, true);
});

test("verify: a MATTER_DETAILS_UPDATED event WITHOUT a reason is rejected (reasonRequired)", () => {
  const bad = mduEvent({ reason: undefined, changed_fields: ["name"] });
  const r = verifyAuditChain([bad], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_kind_inconsistent");
});

test("verify: a MATTER_DETAILS_UPDATED event whose action mismatches the kind is rejected", () => {
  const bad = mduEvent({ action: "create", before_state_hash: null });
  const r = verifyAuditChain([bad], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_kind_inconsistent");
});

// --- 5. schema: changed_fields shape + per-kind restriction ---

test("schema: ACCEPTS a valid changed_fields on a MATTER_DETAILS_UPDATED event", () => {
  const r = validateAuditEvent(mduEvent({ changed_fields: EDITABLE_FIELDS }));
  assert.equal(r.ok, true);
});

test("schema: ACCEPTS a MATTER_DETAILS_UPDATED event with NO changed_fields (optional)", () => {
  const r = validateAuditEvent(mduEvent());
  assert.equal(r.ok, true);
});

test("schema: REJECTS changed_fields on a non-MATTER_DETAILS_UPDATED kind (MATTER_ARCHIVED)", () => {
  const bad = mduEvent({ event_kind: "MATTER_ARCHIVED", reason: undefined, changed_fields: ["name"] });
  const r = validateAuditEvent(bad);
  assert.equal(r.ok, false);
});

test("schema: REJECTS changed_fields on a v1 legacy event (no event_kind)", () => {
  const bad = {
    id: ID_A, tenant_id: "tenant-local-v1", actor_user_id: "local-user", matter_id: ID_M,
    action: "update", entity_type: "matter", entity_id: ID_M,
    before_state_hash: "sha256:prev", after_state_hash: "sha256:post", prev_event_hash: null,
    timestamp: TS, changed_fields: ["name"],
  };
  const r = validateAuditEvent(bad);
  assert.equal(r.ok, false);
});

test("schema: REJECTS a non-allowlisted changed_fields value", () => {
  const r = validateAuditEvent(mduEvent({ changed_fields: ["litigation_position"] }));
  assert.equal(r.ok, false);
});

test("schema: REJECTS an empty changed_fields array (minItems 1)", () => {
  const r = validateAuditEvent(mduEvent({ changed_fields: [] }));
  assert.equal(r.ok, false);
});

test("schema: REJECTS duplicate changed_fields values (uniqueItems)", () => {
  const r = validateAuditEvent(mduEvent({ changed_fields: ["name", "name"] }));
  assert.equal(r.ok, false);
});

// --- 6. schema event_kind enum picks up the new kind (sync with TS map) ---

test("schema event_kind enum contains MATTER_DETAILS_UPDATED", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = JSON.parse(
    readFileSync(join(here, "..", "schemas", "case-box-audit-event.schema.json"), "utf8"),
  );
  assert.ok(schema.properties.event_kind.enum.includes("MATTER_DETAILS_UPDATED"));
});
