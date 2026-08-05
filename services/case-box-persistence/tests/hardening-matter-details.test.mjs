// matter-details-edit Phase B — updateMatterDetails hardening (in-memory +
// pure-core + SQLite atomicity).
//
// Covers the D5 strict-patch contract (unknown/frozen reject, domain-gated
// clear, canonicalize-before-no-op), the sorted `changed_fields` (D5a), the D4a
// fail-closed continuity against the LATEST PRIOR matter event (incl. the
// interleaving case where a non-matter event is the global head), and
// transactional atomicity (a failed continuity check writes NO event + NO row).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  InMemoryCaseBoxPersistence,
  openSqliteCaseBoxPersistence,
} from "../dist/index.js";
import { prepareMatterDetailsUpdate } from "../dist/inMemoryMatter.js";
import {
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeClock,
  makeDocumentInput,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import {
  entityStateHash,
  eventHashFn,
  setStoredMatterPartiesInMemoryNoRealign,
  setStoredMatterPartiesSqliteNoRealign,
  stripPartyIds,
} from "./internals.mjs";

const ISO = "2026-05-22T09:00:00.000Z";

function makeInMem(prefix = "mdu") {
  return new InMemoryCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(prefix),
  });
}

function makeSqlite(prefix = "mdusq") {
  return openSqliteCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(prefix),
  });
}

async function listEvents(p) {
  return (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows;
}

const OPTS = (patch, reason = "corrected per client instruction") => ({
  patch,
  actor_user_id: "editor-user",
  reason,
});

// ---------------------------------------------------------------------------
// Happy path + changed_fields
// ---------------------------------------------------------------------------

test("MDU: a name edit appends exactly one MATTER_DETAILS_UPDATED event", async () => {
  const p = makeInMem("mdu01");
  await p.createMatter(makeMatterInput());
  const updated = await p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Corrected Caption" }));
  assert.equal(updated.name, "Corrected Caption");

  const rows = await listEvents(p);
  assert.equal(rows.length, 2);
  const ev = rows[1];
  assert.equal(ev.event_kind, "MATTER_DETAILS_UPDATED");
  assert.equal(ev.action, "update");
  assert.equal(ev.entity_type, "matter");
  assert.equal(ev.actor_user_id, "editor-user");
  assert.equal(ev.reason, "corrected per client instruction");
  assert.deepEqual(ev.changed_fields, ["name"]);
  // after_state_hash covers the rewritten matter; event_count invariant holds.
  const stored = await p.getMatter(DEFAULT_MATTER_ID);
  assert.equal(ev.after_state_hash, entityStateHash(stored));
  const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(head.count, rows.length);
  const verify = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(verify.ok, true);
  assert.equal(verify.verifiedCount, 2);
});

test("MDU: changed_fields is ascending-sorted + unique (name sorts AFTER descriptors)", async () => {
  const p = makeInMem("mdu02");
  await p.createMatter(makeMatterInput());
  await p.updateMatterDetails(
    DEFAULT_MATTER_ID,
    OPTS({ name: "New Name", case_type_text: "contract dispute", retainer_scope: "full rep" }),
  );
  const rows = await listEvents(p);
  const ev = rows[1];
  // Iteration order of the allowlist is name-first, but the emitted array MUST be
  // alphabetically sorted — so "name" lands last, proving the emitter sorts.
  assert.deepEqual(ev.changed_fields, ["case_type_text", "name", "retainer_scope"]);
  // Sorted invariant: strictly ascending.
  const sorted = [...ev.changed_fields].sort();
  assert.deepEqual(ev.changed_fields, sorted);
});

test("MDU: only actually-changed fields appear in changed_fields", async () => {
  const p = makeInMem("mdu03");
  await p.createMatter(makeMatterInput({ name: "Keep Me", retainer_scope: "keep scope" }));
  // name unchanged (same value), retainer_scope changed, case_type_text newly set.
  await p.updateMatterDetails(
    DEFAULT_MATTER_ID,
    OPTS({ name: "Keep Me", retainer_scope: "new scope", case_type_text: "tort" }),
  );
  const rows = await listEvents(p);
  assert.deepEqual(rows[1].changed_fields, ["case_type_text", "retainer_scope"]);
});

// ---------------------------------------------------------------------------
// No-op rejection (canonicalize-before-no-op)
// ---------------------------------------------------------------------------

test("MDU: a patch that changes nothing → no_editable_change (no event)", async () => {
  const p = makeInMem("mdu04");
  await p.createMatter(makeMatterInput({ name: "Same" }));
  const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Same" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "no_editable_change",
  );
  const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(headAfter.count, headBefore.count, "no-op must not append an event");
});

test("MDU: trim-only difference is canonicalized away → no_editable_change", async () => {
  const p = makeInMem("mdu05");
  await p.createMatter(makeMatterInput({ name: "Trimmed" }));
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "  Trimmed  " })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "no_editable_change",
  );
});

test("MDU: re-clearing an already-empty optional descriptor is a no-op", async () => {
  const p = makeInMem("mdu06");
  await p.createMatter(makeMatterInput()); // retainer_scope absent
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ retainer_scope: "" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "no_editable_change",
  );
});

test("MDU: trim IS applied on write (untrimmed stored value → trimmed value is a change)", async () => {
  const p = makeInMem("mdu07");
  await p.createMatter(makeMatterInput({ name: "  padded name  " }));
  const updated = await p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "padded name" }));
  assert.equal(updated.name, "padded name");
  const rows = await listEvents(p);
  assert.deepEqual(rows[1].changed_fields, ["name"]);
});

// ---------------------------------------------------------------------------
// Strict PATCH validation (D5): unknown / frozen keys, clear rules, types
// ---------------------------------------------------------------------------

test("MDU: an unknown key in the patch → invalid_payload", async () => {
  const p = makeInMem("mdu08");
  await p.createMatter(makeMatterInput());
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x", not_a_field: "y" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
});

for (const frozen of ["id", "tenant_id", "status", "parties", "jurisdiction", "matter_type", "confidentiality_class", "successor_matter_id", "external_ocr_authorized", "actor_user_id"]) {
  test(`MDU: a frozen key (${frozen}) present in the patch → invalid_payload`, async () => {
    const p = makeInMem("mf" + frozen.slice(0, 4));
    await p.createMatter(makeMatterInput());
    await assert.rejects(
      () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x", [frozen]: "whatever" })),
      (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
    );
  });
}

test("MDU: __proto__ as an own patch key → invalid_payload (no prototype pollution)", async () => {
  const p = makeInMem("mdu09");
  await p.createMatter(makeMatterInput());
  const patch = JSON.parse('{"__proto__": {"polluted": true}, "name": "x"}');
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS(patch)),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
  assert.equal({}.polluted, undefined, "Object.prototype must not be polluted");
});

test("MDU: clearing the required name ('' or null) → invalid_payload", async () => {
  const p = makeInMem("mdu10");
  await p.createMatter(makeMatterInput({ name: "Has Name" }));
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: null })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
});

test("MDU: clearing an optional descriptor to '' is allowed", async () => {
  const p = makeInMem("mdu11");
  await p.createMatter(makeMatterInput({ retainer_scope: "old scope" }));
  const updated = await p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ retainer_scope: "" }));
  assert.equal(updated.retainer_scope, "");
  const rows = await listEvents(p);
  assert.deepEqual(rows[1].changed_fields, ["retainer_scope"]);
  const stored = await p.getMatter(DEFAULT_MATTER_ID);
  assert.equal(stored.retainer_scope, "");
});

test("MDU: clearing an optional descriptor via null is allowed", async () => {
  const p = makeInMem("mdu12");
  await p.createMatter(makeMatterInput({ case_type_text: "prior" }));
  const updated = await p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ case_type_text: null }));
  assert.equal(updated.case_type_text, "");
});

test("MDU: a non-string / non-null patch value → invalid_payload", async () => {
  const p = makeInMem("mdu13");
  await p.createMatter(makeMatterInput());
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: 42 })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
});

test("MDU: a non-object patch → invalid_payload", async () => {
  const p = makeInMem("mdu14");
  await p.createMatter(makeMatterInput());
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS([])),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
});

// ---------------------------------------------------------------------------
// Reason + actor + lifecycle + existence guards
// ---------------------------------------------------------------------------

test("MDU: an empty reason → invalid_payload", async () => {
  const p = makeInMem("mdu15");
  await p.createMatter(makeMatterInput());
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x" }, "")),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
  // whitespace-only reason is rejected identically to the empty string
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x" }, "   ")),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
});

test("MDU: SQLite — a whitespace-only reason → invalid_payload", async () => {
  const { persistence: sqlite } = makeSqlite("mdu15sq");
  await sqlite.createMatter(makeMatterInput());
  await assert.rejects(
    () => sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x" }, "   ")),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_payload",
  );
});

test("MDU: an empty actor_user_id → invalid_argument", async () => {
  const p = makeInMem("mdu16");
  await p.createMatter(makeMatterInput());
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, { patch: { name: "x" }, actor_user_id: "", reason: "r" }),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "invalid_argument",
  );
});

test("MDU: editing an archived matter → matter_archived (no event)", async () => {
  const p = makeInMem("mdu17");
  await p.createMatter(makeMatterInput());
  await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "u", reason: "archiving" });
  const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "matter_archived",
  );
  const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(headAfter.count, headBefore.count, "archived reject must not append an event");
});

test("MDU: unknown matter → unknown_matter", async () => {
  const p = makeInMem("mdu18");
  await assert.rejects(
    () => p.updateMatterDetails("01nonexistmatter00000000xx", OPTS({ name: "x" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "unknown_matter",
  );
});

// ---------------------------------------------------------------------------
// D4a — continuity against the LATEST PRIOR matter event (interleaving)
// ---------------------------------------------------------------------------

test("MDU: D4a chains state off the latest MATTER event, prev off the GLOBAL head", async () => {
  const p = makeInMem("mdu19");
  await p.createMatter(makeMatterInput());
  // Interleave a NON-matter event (document) so the global head is NOT a matter event.
  await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "After Doc" }));

  const rows = await listEvents(p);
  assert.equal(rows.length, 3);
  const registered = rows[0];
  const docEvent = rows[1];
  const mdu = rows[2];
  assert.equal(registered.event_kind, "MATTER_REGISTERED");
  assert.equal(docEvent.event_kind, "DOCUMENT_REGISTERED");
  assert.equal(mdu.event_kind, "MATTER_DETAILS_UPDATED");

  // before_state_hash comes from the LATEST MATTER event (MATTER_REGISTERED),
  // NOT the intervening document event.
  assert.equal(mdu.before_state_hash, registered.after_state_hash);
  assert.notEqual(mdu.before_state_hash, docEvent.after_state_hash);
  // prev_event_hash chains off the GLOBAL head (the document event).
  assert.equal(mdu.prev_event_hash, eventHashFn(docEvent));
  // after_state_hash covers the rewritten matter.
  const stored = await p.getMatter(DEFAULT_MATTER_ID);
  assert.equal(mdu.after_state_hash, entityStateHash(stored));

  const verify = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(verify.ok, true);
});

// ---------------------------------------------------------------------------
// D4a fail-closed — pure core (deterministic continuity branches)
// ---------------------------------------------------------------------------

async function validMatterFor(prefix) {
  const p = makeInMem(prefix);
  await p.createMatter(makeMatterInput());
  const matter = await p.getMatter(DEFAULT_MATTER_ID);
  const registered = (await listEvents(p))[0]; // real MATTER_REGISTERED event
  return { matter, registered };
}

function pureDeps(over = {}) {
  return {
    generateId: () => "01jdetailseventmockid00001",
    nowIso: () => "2026-05-22T10:00:00.000Z",
    storedAuditEventsForMatter: () => [],
    latestPriorMatterEvent: () => undefined,
    ...over,
  };
}

test("MDU pure: no prior matter event → audit_chain_desync", async () => {
  const { matter } = await validMatterFor("mdup1");
  assert.throws(
    () => prepareMatterDetailsUpdate(matter, OPTS({ name: "Changed" }), pureDeps({ latestPriorMatterEvent: () => undefined })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "audit_chain_desync",
  );
});

test("MDU pure: prior matter event with malformed after_state_hash → audit_chain_desync", async () => {
  const { matter, registered } = await validMatterFor("mdup2");
  const prior = { sequence: 1, event: { ...registered, after_state_hash: null } };
  assert.throws(
    () => prepareMatterDetailsUpdate(matter, OPTS({ name: "Changed" }), pureDeps({ latestPriorMatterEvent: () => prior })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "audit_chain_desync",
  );
});

test("MDU pure: stored payload hash ≠ prior after_state_hash → audit_chain_desync", async () => {
  const { matter, registered } = await validMatterFor("mdup3");
  const prior = { sequence: 1, event: { ...registered, after_state_hash: "0".repeat(64) } };
  assert.throws(
    () => prepareMatterDetailsUpdate(matter, OPTS({ name: "Changed" }), pureDeps({ latestPriorMatterEvent: () => prior })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "audit_chain_desync",
  );
});

test("MDU pure: matching continuity → before = prior after_state_hash, after = hash(next)", async () => {
  const { matter, registered } = await validMatterFor("mdup4");
  const currentHash = entityStateHash(matter);
  const prior = { sequence: 1, event: registered }; // registered.after_state_hash === currentHash
  const result = prepareMatterDetailsUpdate(
    matter,
    OPTS({ name: "Fixed" }),
    pureDeps({
      latestPriorMatterEvent: () => prior,
      storedAuditEventsForMatter: () => [prior],
    }),
  );
  assert.equal(result.audit.event.before_state_hash, currentHash);
  assert.equal(result.audit.event.after_state_hash, entityStateHash(result.next));
  assert.deepEqual(result.audit.event.changed_fields, ["name"]);
  assert.equal(result.audit.event.event_kind, "MATTER_DETAILS_UPDATED");
});

// ---------------------------------------------------------------------------
// Atomicity — a failed continuity check writes NOTHING
// ---------------------------------------------------------------------------

test("MDU: in-memory desync fails closed (audit_chain_desync, no event, no payload rewrite)", async () => {
  const p = makeInMem("mdud1");
  await p.createMatter(makeMatterInput());
  // Rewrite the stored payload WITHOUT re-aligning the seed event → desync.
  setStoredMatterPartiesInMemoryNoRealign(p, DEFAULT_MATTER_ID, stripPartyIds(makeMatterInput().parties));
  const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  const storedBefore = await p.getMatter(DEFAULT_MATTER_ID);

  await assert.rejects(
    () => p.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Should Not Land" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "audit_chain_desync",
  );

  const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(headAfter.count, headBefore.count, "no head advance on desync");
  assert.equal(headAfter.headHash, headBefore.headHash, "head hash unchanged on desync");
  assert.deepEqual(await p.getMatter(DEFAULT_MATTER_ID), storedBefore, "no payload rewrite on desync");
});

test("MDU: SQLite desync fails closed; BEGIN IMMEDIATE rolls back (no row, no head, no payload)", async () => {
  const { persistence: sqlite, db } = makeSqlite("mdud2");
  await sqlite.createMatter(makeMatterInput());
  setStoredMatterPartiesSqliteNoRealign(db, DEFAULT_MATTER_ID, stripPartyIds(makeMatterInput().parties));

  const headBefore = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).event_count;
  const payloadBefore = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(DEFAULT_MATTER_ID).payload_json;

  await assert.rejects(
    () => sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Should Not Land" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "audit_chain_desync",
  );

  const headAfter = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).event_count;
  const payloadAfter = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(DEFAULT_MATTER_ID).payload_json;
  const rowCount = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).c;
  assert.equal(headAfter, headBefore, "no head advance on desync");
  assert.equal(rowCount, headBefore, "no audit-event row inserted on desync");
  assert.equal(payloadAfter, payloadBefore, "no payload rewrite on desync");
});

test("MDU: SQLite corrupted audit head (event_count drift) fails closed; atomic rollback", async () => {
  // audit finding H — a stale/corrupted head row (event_count out of step with the
  // events table) must be refused BEFORE deriving the next sequence, SQLite-only.
  const { persistence: sqlite, db } = makeSqlite("mdud3");
  await sqlite.createMatter(makeMatterInput());
  // Corrupt the head: inflate event_count so it no longer equals COUNT(*)/MAX(sequence).
  db.prepare("UPDATE case_box_audit_chain_heads SET event_count = event_count + 50 WHERE matter_id = ?")
    .run(DEFAULT_MATTER_ID);

  const headBefore = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).event_count;
  const rowsBefore = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).c;
  const payloadBefore = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(DEFAULT_MATTER_ID).payload_json;

  await assert.rejects(
    () => sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Should Not Land" })),
    (e) => e instanceof CaseBoxPersistenceError && e.code === "audit_chain_desync",
  );

  const headAfter = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).event_count;
  const rowsAfter = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).c;
  const payloadAfter = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(DEFAULT_MATTER_ID).payload_json;
  assert.equal(rowsAfter, rowsBefore, "no audit-event row inserted on corrupted head");
  assert.equal(headAfter, headBefore, "the edit must not advance the (already-corrupt) head");
  assert.equal(payloadAfter, payloadBefore, "no payload rewrite on corrupted head");
});
