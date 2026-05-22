// SQLite hardening tests for case-box-persistence Phase B1.
// Per dev-memo/plan-case-box-persistence-B1-matter.md §1.3 + rev-2 risk #7:
// B1 hardening = pragma + schema-version smoke + audit-chain-head
// invariant. B5 owns crash-injection / WAL-replay / deeper hardening.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  CaseBoxPersistenceError,
  openSqliteCaseBoxPersistence,
} from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";

// ---------------------------------------------------------------------------
// Pragma smoke
// ---------------------------------------------------------------------------

test("Sqlite-B1: pragma journal_mode is 'memory' for :memory: DBs (smoke)", () => {
  const { db } = openSqliteCaseBoxPersistence();
  // SQLite reports "memory" for journal_mode on :memory: DBs regardless of
  // the WAL pragma — this asserts the pragma was issued without error and
  // SQLite returned the in-memory-specific value.
  const mode = db.pragma("journal_mode", { simple: true });
  assert.equal(mode, "memory");
  db.close();
});

test("Sqlite-B1: pragma journal_mode is 'wal' for file-backed DBs", () => {
  const dir = mkdtempSync(join(tmpdir(), "casebox-b1-wal-"));
  try {
    const { db } = openSqliteCaseBoxPersistence({ path: join(dir, "test.db") });
    const mode = db.pragma("journal_mode", { simple: true });
    assert.equal(mode, "wal");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Sqlite-B1: pragma busy_timeout is non-zero", () => {
  const { db } = openSqliteCaseBoxPersistence();
  const timeout = db.pragma("busy_timeout", { simple: true });
  assert.ok(timeout > 0, `busy_timeout must be > 0 (got ${timeout})`);
  db.close();
});

test("Sqlite-B1: pragma foreign_keys is ON (1)", () => {
  const { db } = openSqliteCaseBoxPersistence();
  const fk = db.pragma("foreign_keys", { simple: true });
  assert.equal(fk, 1);
  db.close();
});

// ---------------------------------------------------------------------------
// applySchema smoke
// ---------------------------------------------------------------------------

test("Sqlite-B2: applySchema on empty DB applies all current versions once", () => {
  const db = new Database(":memory:");
  const v = applySchema(db);
  assert.equal(v, CURRENT_SCHEMA_VERSION);
  const rows = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  const expected = [];
  for (let i = 1; i <= CURRENT_SCHEMA_VERSION; i++) expected.push(i);
  assert.deepEqual(rows.map((r) => r.version), expected);
  db.close();
});

test("Sqlite-B2: applySchema is idempotent at vN (second call no-op)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const before = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get();
  applySchema(db);
  const after = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get();
  assert.deepEqual(after, before);
  db.close();
});

test("Sqlite-B2: applySchema refuses a future-version DB before any mutation", () => {
  const db = new Database(":memory:");
  // Plant a schema_version row at CURRENT_SCHEMA_VERSION+1; applySchema
  // must refuse before creating any other table.
  const futureVersion = CURRENT_SCHEMA_VERSION + 1;
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (${futureVersion}, '2026-05-22T00:00:00.000Z');`);
  assert.throws(() => applySchema(db), CaseBoxPersistenceError);
  // Verify no other tables were created (refusal before mutation).
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_version'")
    .all();
  assert.equal(tables.length, 0);
  db.close();
});

test("Sqlite-B2+: applySchema upgrades a v1 DB additively to current version", () => {
  const db = new Database(":memory:");
  // Plant a v1-only DB by hand (schema_version + matter + audit + chain head
  // tables, plus version row 1).
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-05-22T00:00:00.000Z');
           CREATE TABLE case_box_matters (id TEXT PRIMARY KEY, payload_json TEXT);
           CREATE TABLE case_box_audit_events (event_id TEXT PRIMARY KEY);
           CREATE TABLE case_box_audit_chain_heads (matter_id TEXT PRIMARY KEY);`);
  const v = applySchema(db);
  assert.equal(v, CURRENT_SCHEMA_VERSION);
  // Verify case_box_documents now exists (added by v2).
  const docsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_box_documents'")
    .get();
  assert.ok(docsTable, "case_box_documents must exist after upgrade");
  // schema_version rows: 1 pre-existing + each version up to current.
  const rows = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  const expected = [];
  for (let i = 1; i <= CURRENT_SCHEMA_VERSION; i++) expected.push(i);
  assert.deepEqual(rows.map((r) => r.version), expected);
  db.close();
});

// ---------------------------------------------------------------------------
// Audit-chain head invariant: event_count == COUNT(*) == MAX(sequence)
// Per B1 plan §9 parity matrix + rev-1 reviewer Dim-2 #3 / Dim-4 #1.
// ---------------------------------------------------------------------------

test("Sqlite-B1: audit-chain-head invariant after createMatter (event_count == COUNT(*) == MAX(sequence))", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard1"),
  });
  await persistence.createMatter(makeMatterInput());
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 1);
  assert.equal(count.c, 1);
  assert.equal(maxSeq.m, 1);
  db.close();
});

test("Sqlite-B2: audit-chain-head invariant after createMatter + registerDocument + archiveMatter (3 events)", async () => {
  const { makeDocumentInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3, "event_count must match committed event count");
  assert.equal(count.c, 3, "COUNT(*) must match committed event count");
  assert.equal(maxSeq.m, 3, "MAX(sequence) must match committed event count");
  db.close();
});

test("Sqlite-B1: audit-chain-head invariant after archive + unarchive (3 events)", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("hard2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await persistence.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3, "event_count must match committed event count");
  assert.equal(count.c, 3, "COUNT(*) must match committed event count");
  assert.equal(maxSeq.m, 3, "MAX(sequence) must match committed event count");
  db.close();
});

// ---------------------------------------------------------------------------
// B3 audit-chain tamper detection (per B3 plan §1.5 invariants 1, 1b, 2, 3)
// ---------------------------------------------------------------------------

async function buildChainWithTwoEvents(idPrefix) {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator(idPrefix),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  return { persistence, db };
}

test("Sqlite-B3: verifyAuditChainForMatter detects mutated event_json payload (non-final event)", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp1");
  // Mutate the FIRST (non-final) event's event_json: change actor_user_id.
  // This changes its canonical bytes → its hash differs → event[1]'s
  // prev_event_hash mismatch.
  const firstRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(firstRow.event_json);
  parsed.actor_user_id = "tampered-user";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), firstRow.event_id);
  // Re-SELECT to confirm mutation persisted (per B3 plan §5 risk #3).
  const reread = db.prepare("SELECT event_json FROM case_box_audit_events WHERE event_id = ?").get(firstRow.event_id);
  assert.notEqual(reread.event_json, firstRow.event_json);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "prev_event_hash_mismatch");
  assert.equal(result.errorIndex, 1);
  db.close();
});

test("Sqlite-B3: verifyAuditChainForMatter detects last-event tampering via head-anchor mismatch", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp1b");
  // Mutate the LAST event's event_json: change actor_user_id. The in-chain
  // prev_event_hash check cannot see it (no successor), but the verifier's
  // computed headHash will differ from the persisted head row.
  const lastRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(lastRow.event_json);
  parsed.actor_user_id = "tampered-user";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), lastRow.event_id);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "prev_event_hash_mismatch");
  assert.match(result.detail, /head-anchor mismatch/);
  db.close();
});

test("Sqlite-B3: verifyAuditChainForMatter detects broken prev_event_hash", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp2");
  // Mutate event[1]'s prev_event_hash to an arbitrary 64-hex value.
  const secondRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(secondRow.event_json);
  parsed.prev_event_hash = "0".repeat(64);
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), secondRow.event_id);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "prev_event_hash_mismatch");
  assert.equal(result.errorIndex, 1);
  db.close();
});

test("Sqlite-B3: verifyAuditChainForMatter detects wrong tenant_id mid-chain", async () => {
  const { persistence, db } = await buildChainWithTwoEvents("tamp3");
  // Mutate event[1]'s tenant_id to a value different from event[0]'s.
  const secondRow = db
    .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(DEFAULT_MATTER_ID);
  const parsed = JSON.parse(secondRow.event_json);
  parsed.tenant_id = "tenant-evil";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?").run(JSON.stringify(parsed), secondRow.event_id);
  const result = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.errorReason, "tenant_id_mismatch");
  assert.equal(result.errorIndex, 1);
  db.close();
});

test("Sqlite-B3: event_count invariant after createMatter + registerDocument + archiveMatter + unarchiveMatter (4 events)", async () => {
  const { makeDocumentInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("inv4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await persistence.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  // The 4-event sequence above (create + registerDoc + archive + unarchive)
  // is the minimal 4-event mixed-write sequence that exercises B1 + B2 write
  // paths. A second registerDocument would require an active (un-archived)
  // matter and would shift the sequence count; this fixed sequence is the
  // canonical 4-event invariant check.
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 4);
  assert.equal(count.c, 4);
  assert.equal(maxSeq.m, 4);
  db.close();
});

// ---------------------------------------------------------------------------
// B4 confidentiality classification invariants (per B4 plan §1.8)
// ---------------------------------------------------------------------------

test("Sqlite-B4: appendConfidentialityClassification rejects cross-tenant target", async () => {
  const { makeDocumentInput, makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendConfidentialityClassification(makeClassificationInput({ tenant_id: "tenant-evil" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B4: append-only history preserved across 5 sequential classifications", async () => {
  const { makeDocumentInput, makeClassificationInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // SET → UPGRADED → DOWNGRADED → RESET → SET again, 5 rows total.
  const seq = [
    { id: "01jcaseclassmockid00000a01", level: "normal", prior_level: null, change_reason_code: null, change_reason_text: null, set_at: "2026-05-21T09:00:00.000Z" },
    { id: "01jcaseclassmockid00000a02", level: "confidential", prior_level: "normal", change_reason_code: null, change_reason_text: null, set_at: "2026-05-21T10:00:00.000Z" },
    { id: "01jcaseclassmockid00000a03", level: "normal", prior_level: "confidential", change_reason_code: "change_in_legal_assessment", change_reason_text: "review complete", set_at: "2026-05-21T11:00:00.000Z" },
    { id: "01jcaseclassmockid00000a04", level: "unclassified", prior_level: "normal", change_reason_code: "reset_to_unset", change_reason_text: "matter closed phase", set_at: "2026-05-21T12:00:00.000Z" },
    { id: "01jcaseclassmockid00000a05", level: "normal", prior_level: "unclassified", change_reason_code: null, change_reason_text: null, set_at: "2026-05-21T13:00:00.000Z" },
  ];
  for (const overrides of seq) {
    await persistence.appendConfidentialityClassification(makeClassificationInput(overrides));
  }
  // All 5 rows present.
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_confidentiality_classifications WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(count.c, 5);
  // getEffectiveClassification.history has all 5.
  const eff = await persistence.getEffectiveClassification({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
  });
  assert.equal(eff.history.length, 5);
});

test("Sqlite-B4: appendConfidentialityClassification downgrade without reason → invalid_payload", async () => {
  const { makeDocumentInput, makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // SET to confidential, then downgrade WITHOUT change_reason_code.
  await persistence.appendConfidentialityClassification(makeClassificationInput({
    id: "01jcaseclassmockid00000d01",
    level: "confidential",
    prior_level: null,
  }));
  let err;
  try {
    await persistence.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000d02",
      level: "normal",
      prior_level: "confidential",
      change_reason_code: null,
      set_at: "2026-05-21T10:00:00.000Z",
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "invalid_payload");
});

test("Sqlite-B4: getEffectiveClassification deny-by-default for target with no history", async () => {
  const { makeDocumentInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const eff = await persistence.getEffectiveClassification({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
  });
  assert.equal(eff.effectiveLevel, "unclassified");
  assert.deepEqual(eff.history, []);
});

test("Sqlite-B4: audit-chain atomic update after appendConfidentialityClassification (event_count == COUNT == MAX(seq) == 3)", async () => {
  const { makeDocumentInput, makeClassificationInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("conf5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendConfidentialityClassification(makeClassificationInput());
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const maxSeq = db
    .prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3);
  assert.equal(count.c, 3);
  assert.equal(maxSeq.m, 3);
});

// ---------------------------------------------------------------------------
// B5 privilege marker invariants
// ---------------------------------------------------------------------------

test("Sqlite-B5: appendPrivilegeMarker rejects cross-tenant target", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("priv1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput({ tenant_id: "tenant-evil" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B5: appendPrivilegeMarker rejects direct status=confirmed", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("priv2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput({
      status: "confirmed",
      confirmed_actor_user_id: "lawyer",
      confirmed_at: "2026-05-21T10:00:00.000Z",
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "invalid_argument");
});

test("Sqlite-B5: transitionPrivilegeMarker confirmed-uniqueness — second confirmed for same target+kind rejected", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput, DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("priv3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // First marker proposed → confirmed.
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await persistence.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
    to: "confirmed",
    actor_user_id: "lawyer",
    at: "2026-05-21T11:00:00.000Z",
  });
  // Second marker same target+kind, proposed → confirmed should fail.
  const secondId = "01jcasemarkermockid0000002";
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput({
    id: secondId,
    proposed_at: "2026-05-21T12:00:00.000Z",
  }));
  let err;
  try {
    await persistence.transitionPrivilegeMarker(secondId, {
      to: "confirmed",
      actor_user_id: "lawyer",
      at: "2026-05-21T13:00:00.000Z",
    });
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "invalid_argument");
  assert.match(err.message, /another confirmed privilege marker/);
});

test("Sqlite-B5: audit-chain atomic update after appendPrivilegeMarker + transition (4 events)", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput, DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("priv4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await persistence.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
    to: "confirmed",
    actor_user_id: "lawyer",
    at: "2026-05-21T11:00:00.000Z",
  });
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 4);
  assert.equal(count.c, 4);
  assert.equal(maxSeq.m, 4);
});

test("Sqlite-B5: row UPDATE-in-place preserves single row (no append-only proliferation)", async () => {
  const { makeDocumentInput, makePrivilegeMarkerInput, DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("priv5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await persistence.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
    to: "confirmed",
    actor_user_id: "lawyer",
    at: "2026-05-21T11:00:00.000Z",
  });
  // Verify single row in DB; status reflects the transition.
  const rows = db.prepare("SELECT status FROM case_box_privilege_markers WHERE matter_id = ?").all(DEFAULT_MATTER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "confirmed");
});

// ---------------------------------------------------------------------------
// B6 facts invariants (per B6 plan §1.6)
// ---------------------------------------------------------------------------

test("Sqlite-B6: appendFact rejects cross-tenant source_document_id", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.appendFact(makeFactInput({
      tenant_id: "tenant-evil",
      source_document_id: DEFAULT_DOCUMENT_ID,
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B6: appendFact rejects cross-matter source_document_id", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f2"),
  });
  // Create two matters.
  const otherMatterId = "01jcasemattermockid0000002";
  await persistence.createMatter(makeMatterInput());
  await persistence.createMatter(makeMatterInput({ id: otherMatterId }));
  // Document belongs to the FIRST matter.
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // Append fact under the OTHER matter referencing the first matter's document.
  let err;
  try {
    await persistence.appendFact(makeFactInput({
      matter_id: otherMatterId,
      source_document_id: DEFAULT_DOCUMENT_ID,
    }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "matter_id_mismatch");
});

test("Sqlite-B6: transitionFact detects supersession 2-cycle via direct row mutation", async () => {
  const { makeDocumentInput, makeFactInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // Set-up: factA candidate → reviewed; factB candidate → reviewed → accepted.
  // factA stays at "reviewed" so its next transition can be "accepted"
  // with supersedes_fact_id = factB. Cycle is injected on factB by mutating
  // factB.supersedes_fact_id → factA. Walk visits factB → factA, detects
  // cursor === factId (factA), throws invalid_argument.
  const factA = "01jcasefactmockid00000aa01";
  const factB = "01jcasefactmockid00000aa02";
  await persistence.appendFact(makeFactInput({ id: factA }));
  await persistence.appendFact(makeFactInput({ id: factB }));
  await persistence.transitionFact(factA, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  await persistence.transitionFact(factB, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  await persistence.transitionFact(factB, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T16:00:00.000Z" });
  // Mutate factB.supersedes_fact_id → factA via direct SQL UPDATE.
  const rowB = db.prepare("SELECT payload_json FROM case_box_facts WHERE id = ?").get(factB);
  const parsedB = JSON.parse(rowB.payload_json);
  parsedB.supersedes_fact_id = factA;
  db.prepare("UPDATE case_box_facts SET supersedes_fact_id = ?, payload_json = ? WHERE id = ?").run(factA, JSON.stringify(parsedB), factB);
  // factA reviewed → accepted with supersedes_fact_id = factB.
  // Walk: cursor=factB → factB.supersedes_fact_id=factA → cursor=factA ===
  // factId → cycle thrown.
  let err;
  try {
    await persistence.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T17:00:00.000Z", supersedes_fact_id: factB });
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError, `expected CaseBoxPersistenceError, got ${err?.constructor?.name}`);
  assert.equal(err.code, "invalid_argument");
  assert.match(err.message, /cycle|chain/i);
});

test("Sqlite-B6: audit-chain atomic after createMatter + registerDocument + appendFact + transitionFact (4 events)", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendFact(makeFactInput());
  await persistence.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 4);
  assert.equal(count.c, 4);
  assert.equal(maxSeq.m, 4);
});

test("Sqlite-B6: row UPDATE-in-place on transition (single row; status reflects transition)", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendFact(makeFactInput());
  // candidate → reviewed → accepted (direct candidate → accepted illegal).
  await persistence.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer", at: "2026-05-21T15:30:00.000Z" });
  await persistence.transitionFact(DEFAULT_FACT_ID, { to: "accepted", reviewer_actor_user_id: "lawyer", at: "2026-05-21T16:00:00.000Z" });
  const rows = db.prepare("SELECT status FROM case_box_facts WHERE matter_id = ?").all(DEFAULT_MATTER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "accepted");
});

test("Sqlite-B6: R-5 fact fields round-trip via SQL persistence layer", async () => {
  const { makeDocumentInput, makeFactInput, DEFAULT_FACT_ID, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("f6"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  const input = makeFactInput({
    purpose: "timeline_event",
    as_of_date: "2024-03-15",
  });
  const appended = await persistence.appendFact(input);
  assert.equal(appended.purpose, "timeline_event");
  assert.equal(appended.as_of_date, "2024-03-15");
  const round = await persistence.getFact({
    tenant_id: "tenant-local-v1",
    matter_id: DEFAULT_MATTER_ID,
    fact_id: DEFAULT_FACT_ID,
  });
  assert.equal(round.purpose, "timeline_event");
  assert.equal(round.as_of_date, "2024-03-15");
});
