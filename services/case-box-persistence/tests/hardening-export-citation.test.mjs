// WI-A3-EXPORT-T1: headless export-citation builder behavior.
//
// Proves the A3-EXPORT-00 export-degradation contract over the merged V9-V11 schema +
// the resolver: resolver-first (status source of truth), the exportFlag precedence
// (broken->BROKEN; needs_review->NEEDS_REVIEW; valid->clean unless NON_CITABLE/AMBIGUOUS),
// A10 no-drop, citation-from-DocumentPage (payload_json), determinism + idempotence, and
// tenant/matter isolation. See docs/adr/ADR-evidence-a3-export-degradation.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { applySchema } from "./hardening-common.mjs";
import { buildExportCitations } from "../dist/index.js";

const GEOM_VERSION = "2026-06-25T00:00:00.000Z";
const SCOPE = { tenant_id: "t1", matter_id: "m1" };

function freshDb() {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

function insertDoc(db, overrides = {}) {
  const d = { id: "doc-1", status: "reviewed", supersedes_document_id: null, ...overrides };
  db.prepare(
    `INSERT INTO case_box_documents
       (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type, supersedes_document_id, payload_json)
     VALUES (@id, 't1', 'm1', 'u1', @status, '2026-06-25T00:00:00.000Z', 'exhibit', @supersedes_document_id, '{}')`,
  ).run(d);
}

// A V9 page; its citation identity (citationVolume/citationPageLabel/isCitable) lives in payload_json.
function insertPage(db, overrides = {}) {
  const {
    id = "p0",
    document_id = "doc-1",
    physical_page_index = 0,
    citationVolume = "1",
    citationPageLabel = "5",
    isCitable = true,
    rawPayload, // when set, used verbatim (malformed-payload test)
  } = overrides;
  const payload_json =
    rawPayload !== undefined ? rawPayload : JSON.stringify({ citationVolume, citationPageLabel, isCitable });
  db.prepare(
    `INSERT INTO case_box_document_pages
       (id, tenant_id, matter_id, document_id, physical_page_index, created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, '2026-06-25T00:00:00.000Z', @payload_json)`,
  ).run({ id, document_id, physical_page_index, payload_json });
}

function insertGeom(db, overrides = {}) {
  const g = { id: "g0", document_id: "doc-1", physical_page_index: 0, captured_at: GEOM_VERSION, ...overrides };
  db.prepare(
    `INSERT INTO case_box_document_page_geometries
       (id, tenant_id, matter_id, document_id, physical_page_index, resolved_box,
        bounds_x, bounds_y, bounds_width, bounds_height, rotation, captured_at, created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, 'mediaBox',
             '0.000000000000', '0.000000000000', '612.000000000000', '792.000000000000',
             0, @captured_at, '2026-06-25T00:00:00.000Z', '{}')`,
  ).run(g);
}

function insertAnchor(db, overrides = {}) {
  const a = { id: "a0", document_id: "doc-1", physical_page_index: 0, geometry_captured_at: GEOM_VERSION, ...overrides };
  db.prepare(
    `INSERT INTO case_box_anchors
       (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation, created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, @geometry_captured_at,
             '0.250000000000', '0.250000000000', '0.500000000000', '0.500000000000',
             'page_ratio', 'DocumentPageGeometry', 0, '2026-06-25T00:00:00.000Z', '{}')`,
  ).run(a);
}

function insertLink(db, overrides = {}) {
  const l = { id: "l0", source_type: "evidence", source_id: "ev-1", anchor_id: "a0", status: "valid", ...overrides };
  db.prepare(
    `INSERT INTO case_box_links
       (id, tenant_id, matter_id, source_type, source_id, anchor_id, status, created_at, payload_json)
     VALUES (@id, 't1', 'm1', @source_type, @source_id, @anchor_id, @status, '2026-06-25T00:00:00.000Z', '{}')`,
  ).run(l);
}

// A clean baseline: document, citable page, current geometry, matching anchor.
function seedCitable(db) {
  insertDoc(db);
  insertPage(db);
  insertGeom(db);
  insertAnchor(db);
}

function byLink(result, linkId) {
  return result.citations.find((c) => c.linkId === linkId);
}

test("A3-EXPORT-T1: resolver runs first — a stale stored status is refreshed before derivation", () => {
  const db = freshDb();
  // valid inputs but the link carries a stale 'broken' status: the resolver must flip it to valid first.
  seedCitable(db);
  insertLink(db, { id: "l-stale", status: "broken" });
  const res = buildExportCitations(db, SCOPE);
  assert.equal(byLink(res, "l-stale").linkStatus, "valid", "resolver refreshed the status before export");
  assert.equal(db.prepare("SELECT status FROM case_box_links WHERE id='l-stale'").get().status, "valid");
  db.close();
});

test("A3-EXPORT-T1: valid + citable + unambiguous -> clean citation (卷X页Y from DocumentPage)", () => {
  const db = freshDb();
  seedCitable(db);
  insertLink(db, { id: "l-clean", status: "needs_review" });
  const c = byLink(buildExportCitations(db, SCOPE), "l-clean");
  assert.equal(c.linkStatus, "valid");
  assert.equal(c.exportFlag, null);
  assert.deepEqual(c.citation, { citationVolume: "1", citationPageLabel: "5", text: "卷1页5" });
  assert.equal(c.documentId, "doc-1");
  assert.equal(c.physicalPageIndex, 0);
  db.close();
});

test("A3-EXPORT-T1: valid + non-citable identity (isCitable false) -> NON_CITABLE, no clean citation", () => {
  const db = freshDb();
  insertDoc(db);
  insertPage(db, { isCitable: false });
  insertGeom(db);
  insertAnchor(db);
  insertLink(db, { id: "l-noncit", status: "valid" });
  const c = byLink(buildExportCitations(db, SCOPE), "l-noncit");
  assert.equal(c.linkStatus, "valid");
  assert.equal(c.exportFlag, "NON_CITABLE");
  assert.equal(c.citation, null);
  db.close();
});

test("A3-EXPORT-T1: valid + missing citation fields -> NON_CITABLE", () => {
  const db = freshDb();
  insertDoc(db);
  insertPage(db, { rawPayload: JSON.stringify({ note: "no citation fields" }) });
  insertGeom(db);
  insertAnchor(db);
  insertLink(db, { id: "l-nofields", status: "valid" });
  assert.equal(byLink(buildExportCitations(db, SCOPE), "l-nofields").exportFlag, "NON_CITABLE");
  db.close();
});

test("A3-EXPORT-T1: valid + malformed payload_json -> NON_CITABLE (deterministic, no crash) [L1]", () => {
  const db = freshDb();
  insertDoc(db);
  insertPage(db, { rawPayload: '{"citationVolume": ' }); // malformed JSON
  insertGeom(db);
  insertAnchor(db);
  insertLink(db, { id: "l-malformed", status: "valid" });
  const c = byLink(buildExportCitations(db, SCOPE), "l-malformed");
  assert.equal(c.exportFlag, "NON_CITABLE");
  assert.equal(c.citation, null);
  db.close();
});

test("A3-EXPORT-T1: valid + ambiguous label (maps to >1 physical page in document scope) -> AMBIGUOUS [L2]", () => {
  const db = freshDb();
  insertDoc(db);
  // two pages in the same document share the same (volume,label) -> ambiguous citation.
  insertPage(db, { id: "p0", physical_page_index: 0, citationVolume: "1", citationPageLabel: "5" });
  insertPage(db, { id: "p1", physical_page_index: 1, citationVolume: "1", citationPageLabel: "5" });
  insertGeom(db, { id: "g0", physical_page_index: 0 });
  insertAnchor(db, { id: "a0", physical_page_index: 0 });
  insertLink(db, { id: "l-amb", anchor_id: "a0", status: "valid" });
  const c = byLink(buildExportCitations(db, SCOPE), "l-amb");
  assert.equal(c.linkStatus, "valid");
  assert.equal(c.exportFlag, "AMBIGUOUS");
  assert.equal(c.citation, null);
  db.close();
});

test("A3-EXPORT-T1: needs_review -> NEEDS_REVIEW flag, never a clean citation", () => {
  const db = freshDb();
  insertDoc(db);
  insertPage(db);
  insertGeom(db, { captured_at: "2026-08-01T00:00:00.000Z" }); // current version moved on
  insertAnchor(db, { geometry_captured_at: GEOM_VERSION }); // anchor pinned to old version -> needs_review
  insertLink(db, { id: "l-nr", status: "valid" });
  const c = byLink(buildExportCitations(db, SCOPE), "l-nr");
  assert.equal(c.linkStatus, "needs_review");
  assert.equal(c.exportFlag, "NEEDS_REVIEW");
  assert.equal(c.citation, null);
  assert.equal(c.documentId, "doc-1"); // DocumentPage identity preserved best-effort
  db.close();
});

test("A3-EXPORT-T1: broken -> BROKEN flag, never a clean citation", () => {
  const db = freshDb();
  insertDoc(db);
  insertPage(db);
  // no geometry row -> resolver = broken
  insertAnchor(db);
  insertLink(db, { id: "l-brk", status: "valid" });
  const c = byLink(buildExportCitations(db, SCOPE), "l-brk");
  assert.equal(c.linkStatus, "broken");
  assert.equal(c.exportFlag, "BROKEN");
  assert.equal(c.citation, null);
  db.close();
});

test("A3-EXPORT-T1: missing anchor/page/geometry -> deterministic BROKEN object, NEVER omitted (A10)", () => {
  const db = freshDb();
  // a link pointing at a non-existent anchor: still produces exactly one BROKEN object.
  insertLink(db, { id: "l-missing", anchor_id: "ghost", status: "valid" });
  const res = buildExportCitations(db, SCOPE);
  assert.equal(res.citations.length, 1, "the link is not dropped");
  const c = byLink(res, "l-missing");
  assert.equal(c.exportFlag, "BROKEN");
  assert.equal(c.citation, null);
  assert.equal(c.documentId, null); // no anchor -> no document/page identity, but still emitted
  assert.equal(c.sourceId, "ev-1"); // best-effort source identity preserved
  db.close();
});

test("A3-EXPORT-T1: valid NEVER yields REPLACED; REPLACED is not emitted (deferred)", () => {
  const db = freshDb();
  // a superseded document -> resolver makes the link needs_review (never valid); export -> NEEDS_REVIEW, not REPLACED.
  insertDoc(db, { id: "doc-1" });
  insertDoc(db, { id: "doc-2", supersedes_document_id: "doc-1" });
  insertPage(db);
  insertGeom(db);
  insertAnchor(db);
  insertLink(db, { id: "l-sup", status: "valid" });
  const res = buildExportCitations(db, SCOPE);
  const c = byLink(res, "l-sup");
  assert.equal(c.linkStatus, "needs_review");
  assert.equal(c.exportFlag, "NEEDS_REVIEW");
  // no citation ever carries a REPLACED flag in this WI
  for (const cit of res.citations) assert.notEqual(cit.exportFlag, "REPLACED");
  db.close();
});

test("A3-EXPORT-T1: tenant/matter isolation — cross-scope anchor not matched", () => {
  const db = freshDb();
  seedCitable(db);
  insertLink(db, { id: "l-in", status: "valid" });
  // an anchor that exists only in another tenant/matter; the in-scope link referencing it must be BROKEN.
  db.prepare(
    `INSERT INTO case_box_anchors
       (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation, created_at, payload_json)
     VALUES ('a-foreign', 't2', 'm2', 'doc-1', 0, @v, '0.250000000000','0.250000000000','0.500000000000','0.500000000000',
             'page_ratio','DocumentPageGeometry',0,'2026-06-25T00:00:00.000Z','{}')`,
  ).run({ v: GEOM_VERSION });
  insertLink(db, { id: "l-cross", anchor_id: "a-foreign", status: "valid" });
  const res = buildExportCitations(db, SCOPE);
  assert.equal(byLink(res, "l-in").exportFlag, null, "in-scope clean");
  assert.equal(byLink(res, "l-cross").exportFlag, "BROKEN", "cross-scope anchor not matched");
  db.close();
});

test("A3-EXPORT-T1: deterministic ordering by link id + byFlag summary", () => {
  const db = freshDb();
  seedCitable(db);
  insertLink(db, { id: "l-c", status: "valid" }); // clean
  insertLink(db, { id: "l-a", anchor_id: "ghost", status: "valid" }); // broken
  insertLink(db, { id: "l-b", status: "valid" }); // clean
  const res = buildExportCitations(db, SCOPE);
  assert.deepEqual(res.citations.map((c) => c.linkId), ["l-a", "l-b", "l-c"], "ordered by link id");
  assert.equal(res.byFlag.CLEAN, 2);
  assert.equal(res.byFlag.BROKEN, 1);
  db.close();
});

test("A3-EXPORT-T1: idempotent — a repeated export call yields identical objects", () => {
  const db = freshDb();
  seedCitable(db);
  insertLink(db, { id: "l1", status: "needs_review" });
  insertLink(db, { id: "l2", anchor_id: "ghost", status: "valid" });
  const first = buildExportCitations(db, SCOPE);
  const second = buildExportCitations(db, SCOPE);
  assert.deepEqual(second, first, "same DB state + scope -> identical result");
  db.close();
});

test("A3-EXPORT-T1: builder mutates only case_box_links.status — no other table touched, no audit events", () => {
  const db = freshDb();
  seedCitable(db);
  insertLink(db, { id: "l-w", status: "broken" }); // valid inputs -> resolver flips to valid
  const counts = () => ({
    audit: db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events").get().c,
    anchors: db.prepare("SELECT COUNT(*) AS c FROM case_box_anchors").get().c,
    pages: db.prepare("SELECT COUNT(*) AS c FROM case_box_document_pages").get().c,
    geometries: db.prepare("SELECT COUNT(*) AS c FROM case_box_document_page_geometries").get().c,
    documents: db.prepare("SELECT COUNT(*) AS c FROM case_box_documents").get().c,
  });
  const before = counts();
  const anchorBefore = db.prepare("SELECT * FROM case_box_anchors WHERE id='a0'").get();
  buildExportCitations(db, SCOPE);
  assert.deepEqual(counts(), before, "no rows added/removed outside case_box_links");
  assert.equal(counts().audit, 0, "no audit events emitted");
  assert.deepEqual(db.prepare("SELECT * FROM case_box_anchors WHERE id='a0'").get(), anchorBefore, "anchor unchanged");
  assert.equal(db.prepare("SELECT status FROM case_box_links WHERE id='l-w'").get().status, "valid", "link status refreshed");
  db.close();
});

test("A3-EXPORT-T1: rejects an empty scope (invalid_argument)", () => {
  const db = freshDb();
  assert.throws(() => buildExportCitations(db, { tenant_id: "", matter_id: "m1" }), /invalid_argument|tenant_id/);
  assert.throws(() => buildExportCitations(db, { tenant_id: "t1", matter_id: "" }), /invalid_argument|matter_id/);
  db.close();
});
