// Hardening: B5 privilege marker invariants. Split from former
// monolithic sqlite.hardening.test.mjs per B8 plan §1.7 (closes B7 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

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
  await persistence.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await persistence.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
    to: "confirmed",
    actor_user_id: "lawyer",
    at: "2026-05-21T11:00:00.000Z",
  });
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
  const rows = db.prepare("SELECT status FROM case_box_privilege_markers WHERE matter_id = ?").all(DEFAULT_MATTER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "confirmed");
});
