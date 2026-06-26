// WI-A3-T5-RESOLVE: A3 link-status resolver behavior.
//
// Proves the A3-RESOLVE-00 §3 precedence ladder (broken > needs_review > valid;
// valid NEVER a default) over the merged V9-V11 schema + case_box_documents, plus
// determinism + idempotence (A3-RESOLVE-00 §5) and the Option 1 document-replacement
// reconciliation (supersedes_document_id reverse lookup; OCR/triage status does NOT
// trigger Evidence replacement). Status-only: the resolver writes case_box_links.status
// and emits no audit event. See docs/adr/ADR-evidence-a3-resolver-status-transitions.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { applySchema } from "./hardening-common.mjs";
import { resolveLinkStatuses } from "../dist/index.js";

const GEOM_VERSION = "2026-06-24T00:00:00.000Z";

function freshDb() {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

function insertDoc(db, overrides = {}) {
  const d = { id: "doc-1", status: "reviewed", supersedes_document_id: null, ...overrides };
  db.prepare(
    `INSERT INTO case_box_documents
       (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type,
        supersedes_document_id, payload_json)
     VALUES (@id, 't1', 'm1', 'u1', @status, '2026-06-24T00:00:00.000Z', 'exhibit',
             @supersedes_document_id, '{}')`,
  ).run(d);
}

function insertPage(db, overrides = {}) {
  const p = { id: "p0", document_id: "doc-1", physical_page_index: 0, ...overrides };
  db.prepare(
    `INSERT INTO case_box_document_pages
       (id, tenant_id, matter_id, document_id, physical_page_index, created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(p);
}

function insertGeom(db, overrides = {}) {
  const g = {
    id: "g0",
    document_id: "doc-1",
    physical_page_index: 0,
    captured_at: GEOM_VERSION,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO case_box_document_page_geometries
       (id, tenant_id, matter_id, document_id, physical_page_index, resolved_box,
        bounds_x, bounds_y, bounds_width, bounds_height, rotation, captured_at, created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, 'mediaBox',
             '0.000000000000', '0.000000000000', '612.000000000000', '792.000000000000',
             0, @captured_at, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(g);
}

function insertAnchor(db, overrides = {}) {
  const a = {
    id: "a0",
    document_id: "doc-1",
    physical_page_index: 0,
    geometry_captured_at: GEOM_VERSION,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO case_box_anchors
       (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation,
        created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, @geometry_captured_at,
             '0.250000000000', '0.250000000000', '0.500000000000', '0.500000000000',
             'page_ratio', 'DocumentPageGeometry', 0, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(a);
}

function insertLink(db, overrides = {}) {
  const l = {
    id: "l0", source_type: "evidence", source_id: "ev-1", anchor_id: "a0", status: "valid",
    unlinked_at: null, unlink_reason: null, ...overrides,
  };
  db.prepare(
    `INSERT INTO case_box_links
       (id, tenant_id, matter_id, source_type, source_id, anchor_id, status, created_at, payload_json,
        unlinked_at, unlink_reason)
     VALUES (@id, 't1', 'm1', @source_type, @source_id, @anchor_id, @status,
             '2026-06-24T00:00:00.000Z', '{}', @unlinked_at, @unlink_reason)`,
  ).run(l);
}

function statusOf(db, linkId) {
  return db.prepare("SELECT status FROM case_box_links WHERE id = ?").get(linkId).status;
}

const SCOPE = { tenant_id: "t1", matter_id: "m1" };

// A fully-valid baseline: document (not superseded), page, current geometry, anchor
// at the current version, link -> anchor.
function seedValid(db) {
  insertDoc(db);
  insertPage(db);
  insertGeom(db);
  insertAnchor(db);
}

test("A3-T5: missing anchor target -> broken (rung 1)", () => {
  const db = freshDb();
  seedValid(db);
  insertLink(db, { id: "l-noanchor", anchor_id: "anchor-does-not-exist", status: "valid" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-noanchor"), "broken");
  db.close();
});

test("A3-T5: missing page identity -> broken (rung 1)", () => {
  const db = freshDb();
  insertDoc(db);
  // geometry present but NO V9 page row for (doc-1, 0)
  insertGeom(db);
  insertAnchor(db);
  insertLink(db, { id: "l-nopage", status: "valid" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-nopage"), "broken");
  db.close();
});

test("A3-T5: missing geometry record -> broken (rung 1)", () => {
  const db = freshDb();
  insertDoc(db);
  insertPage(db);
  // NO V10 geometry row for (doc-1, 0)
  insertAnchor(db);
  insertLink(db, { id: "l-nogeom", status: "valid" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-nogeom"), "broken");
  db.close();
});

test("A3-T5: geometry captured_at mismatch -> needs_review (rung 2, INV-A3-6)", () => {
  const db = freshDb();
  insertDoc(db);
  insertPage(db);
  insertGeom(db, { captured_at: "2026-07-01T00:00:00.000Z" }); // current version moved on
  insertAnchor(db, { geometry_captured_at: GEOM_VERSION }); // anchor pinned to the OLD version
  insertLink(db, { id: "l-stale", status: "valid" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-stale"), "needs_review");
  db.close();
});

test("A3-T5: document superseded via reverse supersedes_document_id -> needs_review (Option 1)", () => {
  const db = freshDb();
  insertDoc(db, { id: "doc-1" }); // the anchored document
  insertDoc(db, { id: "doc-2", supersedes_document_id: "doc-1" }); // a newer doc supersedes doc-1
  insertPage(db);
  insertGeom(db);
  insertAnchor(db); // anchors doc-1, geometry matches
  insertLink(db, { id: "l-superseded", status: "valid" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-superseded"), "needs_review");
  db.close();
});

test("A3-T5: OCR/triage status alone does NOT force Evidence replacement (Option 1) -> valid", () => {
  const db = freshDb();
  // ocr_failed / ocr_pending are OCR-pipeline statuses, not Evidence-replacement signals.
  insertDoc(db, { id: "doc-1", status: "ocr_failed" });
  insertPage(db);
  insertGeom(db);
  insertAnchor(db);
  insertLink(db, { id: "l-ocrfailed", status: "needs_review" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-ocrfailed"), "valid");
  // a second OCR status, same conclusion
  insertDoc(db, { id: "doc-x", status: "ocr_pending" });
  insertPage(db, { id: "p-x", document_id: "doc-x" });
  insertGeom(db, { id: "g-x", document_id: "doc-x" });
  insertAnchor(db, { id: "a-x", document_id: "doc-x" });
  insertLink(db, { id: "l-ocrpending", anchor_id: "a-x", status: "needs_review" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-ocrpending"), "valid");
  db.close();
});

test("A3-T5: combined missing-target + supersession -> broken wins (rung 1)", () => {
  const db = freshDb();
  insertDoc(db, { id: "doc-1" });
  insertDoc(db, { id: "doc-2", supersedes_document_id: "doc-1" });
  insertPage(db);
  insertGeom(db);
  // anchor MISSING (link points at a non-existent anchor) AND the doc is superseded
  insertLink(db, { id: "l-both", anchor_id: "ghost-anchor", status: "valid" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-both"), "broken");
  db.close();
});

test("A3-T5: geometry-mismatch + supersession -> needs_review (rung 2)", () => {
  const db = freshDb();
  insertDoc(db, { id: "doc-1" });
  insertDoc(db, { id: "doc-2", supersedes_document_id: "doc-1" });
  insertPage(db);
  insertGeom(db, { captured_at: "2026-07-01T00:00:00.000Z" });
  insertAnchor(db, { geometry_captured_at: GEOM_VERSION });
  insertLink(db, { id: "l-mm-sup", status: "valid" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-mm-sup"), "needs_review");
  db.close();
});

test("A3-T5: all present + version matches + not superseded -> valid (rung 3)", () => {
  const db = freshDb();
  seedValid(db);
  insertLink(db, { id: "l-good", status: "needs_review" }); // start non-valid to prove promotion
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-good"), "valid");
  db.close();
});

test("A3-T5: valid is NEVER a default — broken inputs with a stale 'valid' get corrected", () => {
  const db = freshDb();
  // No anchor/page/geometry at all; the link carries a stale 'valid' from before.
  insertLink(db, { id: "l-stalevalid", anchor_id: "none", status: "valid" });
  const res = resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-stalevalid"), "broken");
  assert.equal(res.byStatus.valid, 0);
  assert.equal(res.byStatus.broken, 1);
  db.close();
});

test("A3-T5: deterministic + idempotent — second run on unchanged inputs writes nothing", () => {
  const db = freshDb();
  seedValid(db);
  insertDoc(db, { id: "doc-2", supersedes_document_id: "doc-3" }); // superseded target doc-3 absent; irrelevant
  insertLink(db, { id: "l-a", status: "broken" }); // valid inputs -> should become valid
  insertLink(db, { id: "l-b", anchor_id: "ghost", status: "valid" }); // -> broken
  const first = resolveLinkStatuses(db, SCOPE);
  assert.equal(first.updated, 2);
  assert.equal(statusOf(db, "l-a"), "valid");
  assert.equal(statusOf(db, "l-b"), "broken");
  const second = resolveLinkStatuses(db, SCOPE);
  assert.equal(second.updated, 0, "idempotent: no writes on unchanged inputs");
  assert.equal(second.scanned, 2);
  // statuses unchanged
  assert.equal(statusOf(db, "l-a"), "valid");
  assert.equal(statusOf(db, "l-b"), "broken");
  db.close();
});

test("A3-T5: an already-correct link is not rewritten (updated excludes unchanged)", () => {
  const db = freshDb();
  seedValid(db);
  insertLink(db, { id: "l-already", status: "valid" }); // already at its computed status
  insertLink(db, { id: "l-change", anchor_id: "ghost", status: "valid" }); // -> broken
  const res = resolveLinkStatuses(db, SCOPE);
  assert.equal(res.updated, 1, "only the changed link is written");
  assert.equal(res.scanned, 2);
  db.close();
});

test("A3-T5: resolver rejects an empty scope (invalid_argument)", () => {
  const db = freshDb();
  assert.throws(() => resolveLinkStatuses(db, { tenant_id: "", matter_id: "m1" }), /invalid_argument|tenant_id/);
  assert.throws(() => resolveLinkStatuses(db, { tenant_id: "t1", matter_id: "" }), /invalid_argument|matter_id/);
  db.close();
});

test("A3-T5: tenant/matter isolation — cross-scope anchor not matched; out-of-scope supersession ignored", () => {
  const db = freshDb();
  // in-scope (t1,m1): a fully-valid link.
  seedValid(db);
  insertLink(db, { id: "l-inscope", status: "needs_review" });
  // a link in (t1,m1) whose anchor exists ONLY in another tenant/matter (t2,m2):
  // the anchor join is tenant/matter-scoped, so it must NOT match -> broken.
  db.prepare(
    `INSERT INTO case_box_anchors
       (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation,
        created_at, payload_json)
     VALUES ('a-foreign', 't2', 'm2', 'doc-1', 0, @v,
             '0.250000000000', '0.250000000000', '0.500000000000', '0.500000000000',
             'page_ratio', 'DocumentPageGeometry', 0, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run({ v: GEOM_VERSION });
  insertLink(db, { id: "l-crossanchor", anchor_id: "a-foreign", status: "valid" });
  // an OUT-OF-SCOPE supersession: a (t2,m2) document supersedes doc-1; the scoped
  // supersession subquery must ignore it, so the in-scope link stays valid.
  db.prepare(
    `INSERT INTO case_box_documents
       (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type,
        supersedes_document_id, payload_json)
     VALUES ('doc-foreign', 't2', 'm2', 'u1', 'reviewed', '2026-06-24T00:00:00.000Z', 'exhibit',
             'doc-1', '{}')`,
  ).run();
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-inscope"), "valid", "out-of-scope supersession must not affect in-scope link");
  assert.equal(statusOf(db, "l-crossanchor"), "broken", "cross-tenant/matter anchor must not be matched");
  db.close();
});

test("A3-T5: writes ONLY case_box_links.status — no audit events, no other table mutated", () => {
  const db = freshDb();
  seedValid(db);
  insertLink(db, { id: "l-w", status: "broken" }); // valid inputs -> will flip to valid
  const counts = () => ({
    audit: db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events").get().c,
    anchors: db.prepare("SELECT COUNT(*) AS c FROM case_box_anchors").get().c,
    pages: db.prepare("SELECT COUNT(*) AS c FROM case_box_document_pages").get().c,
    geometries: db.prepare("SELECT COUNT(*) AS c FROM case_box_document_page_geometries").get().c,
    documents: db.prepare("SELECT COUNT(*) AS c FROM case_box_documents").get().c,
  });
  const before = counts();
  const anchorBefore = db.prepare("SELECT * FROM case_box_anchors WHERE id = 'a0'").get();
  resolveLinkStatuses(db, SCOPE);
  const after = counts();
  assert.deepEqual(after, before, "resolver adds/removes no rows outside case_box_links");
  assert.equal(after.audit, 0, "resolver emits NO audit events (status-only)");
  assert.deepEqual(
    db.prepare("SELECT * FROM case_box_anchors WHERE id = 'a0'").get(),
    anchorBefore,
    "the anchor row is not mutated",
  );
  assert.equal(statusOf(db, "l-w"), "valid", "the link status itself DID change");
  db.close();
});

// ---------------------------------------------------------------------------
// WI-A3-UNLINK-RESOLVE: the V12 durable explicit-unlink marker (case_box_links.unlinked_at)
// is the HIGHEST-precedence resolver rung -> 'broken'; never recomputed to valid; durable.
// ---------------------------------------------------------------------------

test("A3-UNLINK-RESOLVE: an unlinked link (unlinked_at set) with otherwise-valid structure -> broken, never valid", () => {
  const db = freshDb();
  seedValid(db);
  insertLink(db, { id: "l-unlinked", status: "valid", unlinked_at: "2026-06-26T12:00:00.000Z", unlink_reason: "detached by lawyer" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-unlinked"), "broken", "explicit unlink resolves non-clean regardless of structure");
  db.close();
});

test("A3-UNLINK-RESOLVE: marker takes precedence over a structurally-valid link (durable, not recomputed to valid)", () => {
  const db = freshDb();
  // Stored status starts 'valid' (stale), structure is clean, and the link is explicitly unlinked.
  seedValid(db);
  insertLink(db, { id: "l-mark", status: "valid", unlinked_at: "2026-06-26T12:00:00.000Z", unlink_reason: "superseded" });
  const first = resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-mark"), "broken", "first resolve flips valid -> broken via the marker");
  assert.equal(first.updated, 1, "first run wrote the changed status");
  // Re-run: the unlinked status is durable + stable; no spurious write (review L2).
  const second = resolveLinkStatuses(db, SCOPE);
  assert.equal(second.updated, 0, "second run is idempotent (no recompute to valid)");
  assert.equal(statusOf(db, "l-mark"), "broken");
  // The unlinked row REMAINS in storage (the resolver never deletes rows).
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM case_box_links WHERE id='l-mark'").get().c, 1, "row preserved");
  db.close();
});

test("A3-UNLINK-RESOLVE: a legacy NULL-marker link with valid structure is unchanged (still valid)", () => {
  const db = freshDb();
  seedValid(db);
  insertLink(db, { id: "l-legacy", status: "needs_review" }); // unlinked_at defaults NULL
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-legacy"), "valid", "NULL-marker rows follow the existing ladder (valid)");
  db.close();
});

test("A3-UNLINK-RESOLVE: unlinked marker wins over structural needs_review (combined)", () => {
  const db = freshDb();
  // geometry mismatch (would be needs_review) AND explicitly unlinked -> broken (marker rung 0 wins).
  insertDoc(db);
  insertPage(db);
  insertGeom(db, { captured_at: "2026-07-01T00:00:00.000Z" });
  insertAnchor(db, { geometry_captured_at: GEOM_VERSION });
  insertLink(db, { id: "l-both", status: "valid", unlinked_at: "2026-06-26T12:00:00.000Z", unlink_reason: "x" });
  resolveLinkStatuses(db, SCOPE);
  assert.equal(statusOf(db, "l-both"), "broken", "marker precedence over needs_review");
  db.close();
});
