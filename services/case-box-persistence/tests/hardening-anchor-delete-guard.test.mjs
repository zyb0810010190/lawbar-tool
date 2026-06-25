// WI-A3-DELETE-T1: referenced-anchor-delete REFUSAL guard behavior.
//
// Proves the A3-CASCADE-00 §2/§9 refusal: a referenced anchor cannot be deleted through the
// persistence API. NEGATIVE-PATH only — the guard throws a typed refusal and performs NO
// physical delete; an unreferenced anchor is "allowed" but nothing is deleted. Tenant/matter
// scoped; no audit events; no mutation. See docs/adr/ADR-evidence-a3-anchor-delete-policy.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { applySchema, CURRENT_SCHEMA_VERSION, CaseBoxPersistenceError } from "./hardening-common.mjs";
import { assertCanDeleteAnchor } from "../dist/index.js";

function freshDb() {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

function insertAnchor(db, overrides = {}) {
  const a = {
    id: "a0",
    tenant_id: "t1",
    matter_id: "m1",
    document_id: "doc-1",
    physical_page_index: 0,
    geometry_captured_at: "2026-06-25T00:00:00.000Z",
    ...overrides,
  };
  db.prepare(
    `INSERT INTO case_box_anchors
       (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation, created_at, payload_json)
     VALUES (@id, @tenant_id, @matter_id, @document_id, @physical_page_index, @geometry_captured_at,
             '0.250000000000', '0.250000000000', '0.500000000000', '0.500000000000',
             'page_ratio', 'DocumentPageGeometry', 0, '2026-06-25T00:00:00.000Z', '{}')`,
  ).run(a);
}

function insertLink(db, overrides = {}) {
  const l = {
    id: "l0",
    tenant_id: "t1",
    matter_id: "m1",
    source_type: "evidence",
    source_id: "ev-1",
    anchor_id: "a0",
    status: "valid",
    ...overrides,
  };
  db.prepare(
    `INSERT INTO case_box_links
       (id, tenant_id, matter_id, source_type, source_id, anchor_id, status, created_at, payload_json)
     VALUES (@id, @tenant_id, @matter_id, @source_type, @source_id, @anchor_id, @status, '2026-06-25T00:00:00.000Z', '{}')`,
  ).run(l);
}

const SCOPE = { tenant_id: "t1", matter_id: "m1", anchor_id: "a0" };

function anchorCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM case_box_anchors").get().c;
}
function linkCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM case_box_links").get().c;
}
function auditCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events").get().c;
}

test("A3-DELETE-T1: referenced anchor -> guard REFUSES (typed anchor_referenced), nothing deleted/changed", () => {
  const db = freshDb();
  insertAnchor(db, { id: "a0" });
  insertLink(db, { id: "l0", anchor_id: "a0", status: "valid" });
  const aBefore = anchorCount(db), lBefore = linkCount(db), audBefore = auditCount(db);
  let err;
  try {
    assertCanDeleteAnchor(db, SCOPE);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof CaseBoxPersistenceError, "throws a typed CaseBoxPersistenceError");
  assert.equal(err.code, "anchor_referenced", "deterministic code: anchor_referenced");
  // no mutation: anchor + link + status all intact, no audit event.
  assert.equal(anchorCount(db), aBefore, "anchor row remains");
  assert.equal(linkCount(db), lBefore, "link row remains");
  assert.equal(db.prepare("SELECT status FROM case_box_links WHERE id='l0'").get().status, "valid", "link status unchanged");
  assert.equal(auditCount(db), audBefore, "no audit event");
  db.close();
});

test("A3-DELETE-T1: refusal holds for EVERY link status (valid | needs_review | broken)", () => {
  // The guard counts all scoped links regardless of status — a referenced anchor is refused even
  // when its only link is needs_review or broken (a future regression must not refuse only `valid`).
  for (const status of ["valid", "needs_review", "broken"]) {
    const db = freshDb();
    insertAnchor(db, { id: "a0" });
    insertLink(db, { id: "l0", anchor_id: "a0", status });
    let err;
    try {
      assertCanDeleteAnchor(db, SCOPE);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof CaseBoxPersistenceError && err.code === "anchor_referenced", `status=${status} -> anchor_referenced`);
    assert.equal(anchorCount(db), 1, `status=${status}: anchor remains`);
    assert.equal(linkCount(db), 1, `status=${status}: link remains`);
    assert.equal(db.prepare("SELECT status FROM case_box_links WHERE id='l0'").get().status, status, `status=${status}: unchanged`);
    db.close();
  }
});

test("A3-DELETE-T1: referenced by multiple links -> still refused; all links remain", () => {
  const db = freshDb();
  insertAnchor(db, { id: "a0" });
  insertLink(db, { id: "l0", anchor_id: "a0" });
  insertLink(db, { id: "l1", anchor_id: "a0", source_id: "ev-2" });
  assert.throws(() => assertCanDeleteAnchor(db, SCOPE), (e) => e instanceof CaseBoxPersistenceError && e.code === "anchor_referenced");
  assert.equal(linkCount(db), 2, "both links remain");
  assert.equal(anchorCount(db), 1, "anchor remains");
  db.close();
});

test("A3-DELETE-T1: unreferenced existing anchor -> allowed (no throw), and NOTHING is deleted", () => {
  const db = freshDb();
  insertAnchor(db, { id: "a0" });
  assert.doesNotThrow(() => assertCanDeleteAnchor(db, SCOPE), "unreferenced anchor is allowable");
  assert.equal(anchorCount(db), 1, "the guard performs NO physical delete");
  db.close();
});

test("A3-DELETE-T1: missing/unknown scoped anchor -> deterministic invalid_argument refusal, no mutation", () => {
  const db = freshDb();
  insertAnchor(db, { id: "a0" });
  const aBefore = anchorCount(db);
  let err;
  try {
    assertCanDeleteAnchor(db, { tenant_id: "t1", matter_id: "m1", anchor_id: "ghost" });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "invalid_argument", "missing anchor -> invalid_argument");
  assert.equal(anchorCount(db), aBefore, "no mutation");
  db.close();
});

test("A3-DELETE-T1: tenant/matter isolation — a cross-scope link does NOT block the scoped guard", () => {
  const db = freshDb();
  insertAnchor(db, { id: "a0", tenant_id: "t1", matter_id: "m1" });
  // a link in a DIFFERENT tenant/matter referencing the same anchor_id (inconsistent in its own scope).
  insertLink(db, { id: "l-foreign", tenant_id: "t2", matter_id: "m2", anchor_id: "a0" });
  // the scoped guard for (t1,m1) sees no in-scope link -> allowed.
  assert.doesNotThrow(() => assertCanDeleteAnchor(db, { tenant_id: "t1", matter_id: "m1", anchor_id: "a0" }));
  // conversely, an in-scope link DOES block.
  insertLink(db, { id: "l-inscope", tenant_id: "t1", matter_id: "m1", anchor_id: "a0" });
  assert.throws(() => assertCanDeleteAnchor(db, { tenant_id: "t1", matter_id: "m1", anchor_id: "a0" }), (e) => e.code === "anchor_referenced");
  db.close();
});

test("A3-DELETE-T1: empty scope fields -> invalid_argument", () => {
  const db = freshDb();
  assert.throws(() => assertCanDeleteAnchor(db, { tenant_id: "", matter_id: "m1", anchor_id: "a0" }), /invalid_argument|tenant_id/);
  assert.throws(() => assertCanDeleteAnchor(db, { tenant_id: "t1", matter_id: "", anchor_id: "a0" }), /invalid_argument|matter_id/);
  assert.throws(() => assertCanDeleteAnchor(db, { tenant_id: "t1", matter_id: "m1", anchor_id: "" }), /invalid_argument|anchor_id/);
  db.close();
});

test("A3-DELETE-T1: idempotent — repeated guard calls yield the same outcome and write nothing", () => {
  const db = freshDb();
  insertAnchor(db, { id: "a0" });
  insertLink(db, { id: "l0", anchor_id: "a0" });
  const snap = () => ({ a: anchorCount(db), l: linkCount(db), aud: auditCount(db), s: db.prepare("SELECT status FROM case_box_links WHERE id='l0'").get().status });
  const before = snap();
  assert.throws(() => assertCanDeleteAnchor(db, SCOPE));
  assert.throws(() => assertCanDeleteAnchor(db, SCOPE));
  assert.deepEqual(snap(), before, "no writes across repeated refusals");
  db.close();
});

test("A3-DELETE-T1: guard adds no schema / FK / version bump (CURRENT_SCHEMA_VERSION stays 11)", () => {
  const db = freshDb();
  assert.equal(CURRENT_SCHEMA_VERSION, 11, "no schema version bump");
  // foreign_keys behavior is unaffected; the guard is app-layer (no FK relied upon).
  assert.equal(applySchema(db), 11, "applySchema idempotent at v11");
  db.close();
});
