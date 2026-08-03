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

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  openSqliteCaseBoxPersistence,
  makeClock,
  makeIdGenerator,
} from "./hardening-common.mjs";
import { resolveLinkStatuses, buildExportCitations } from "../dist/index.js";

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

// ===========================================================================
// WI-A3-UNLINK-T1 — audited durable unlink/relink OPERATION.
//
// The OPERATION (vs the marker-awareness tested above): unlinkLink sets the
// V12 markers + emits LINK_UNLINKED; relinkLink clears them + emits
// LINK_RELINKED; each is one BEGIN IMMEDIATE (marker UPDATE + one audit
// append). SQLite-only concrete-class methods. Marker-only; the row is
// preserved (no DELETE). The audit event validates matter_id + entity_id
// against the ULID pattern, so these fixtures use 26-char ULID-shaped matter
// + link ids (the resolver-only tests above can use short ids because they
// build no audit event). Fixtures use only synthetic ids (no private evidence
// content). See dev-memo/plan-batch-casebox-evidence-a3-unlink-operation-00.md.
// ===========================================================================

const T0 = "2026-06-26T10:00:00.000Z";
// 26-char [0-9a-z] ULID-shaped id from a short synthetic label (audit matter_id/entity_id pattern).
const mkid = (label) => (label + "00000000000000000000000000").slice(0, 26);
const MID = mkid("mtr1");
const OP_SCOPE = { tenant_id: "t1", matter_id: MID };

function opSetup(clockStart = T0) {
  return openSqliteCaseBoxPersistence({
    now: makeClock(clockStart),
    generateId: makeIdGenerator("ul"),
  });
}

// Seed a fully-valid doc/page/geom/anchor under the ULID matter MID (parallels seedValid,
// but matter-parameterized so the resolver/export scope OP_SCOPE matches the link's matter).
function opSeedValid(db) {
  db.prepare(
    `INSERT INTO case_box_documents (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type, supersedes_document_id, payload_json)
     VALUES ('doc-1', 't1', ?, 'u1', 'reviewed', '2026-06-24T00:00:00.000Z', 'exhibit', NULL, '{}')`,
  ).run(MID);
  db.prepare(
    `INSERT INTO case_box_document_pages (id, tenant_id, matter_id, document_id, physical_page_index, created_at, payload_json)
     VALUES ('p0', 't1', ?, 'doc-1', 0, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(MID);
  db.prepare(
    `INSERT INTO case_box_document_page_geometries (id, tenant_id, matter_id, document_id, physical_page_index, resolved_box,
        bounds_x, bounds_y, bounds_width, bounds_height, rotation, captured_at, created_at, payload_json)
     VALUES ('g0', 't1', ?, 'doc-1', 0, 'mediaBox', '0.000000000000', '0.000000000000', '612.000000000000', '792.000000000000', 0, ?, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(MID, GEOM_VERSION);
  db.prepare(
    `INSERT INTO case_box_anchors (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation, created_at, payload_json)
     VALUES ('a0', 't1', ?, 'doc-1', 0, ?, '0.250000000000', '0.250000000000', '0.500000000000', '0.500000000000', 'page_ratio', 'DocumentPageGeometry', 0, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(MID, GEOM_VERSION);
}

// Insert a link under MID. `o` may override { anchor_id, status, unlinked_at, unlink_reason }.
function opLink(db, id, o = {}) {
  const l = { source_type: "evidence", source_id: "ev-1", anchor_id: "a0", status: "valid", unlinked_at: null, unlink_reason: null, ...o };
  db.prepare(
    `INSERT INTO case_box_links (id, tenant_id, matter_id, source_type, source_id, anchor_id, status, created_at, payload_json, unlinked_at, unlink_reason)
     VALUES (?, 't1', ?, ?, ?, ?, ?, '2026-06-24T00:00:00.000Z', '{}', ?, ?)`,
  ).run(id, MID, l.source_type, l.source_id, l.anchor_id, l.status, l.unlinked_at, l.unlink_reason);
  return id;
}

function linkRow(db, linkId) {
  return db.prepare("SELECT * FROM case_box_links WHERE id = ?").get(linkId);
}
function eventsFor(db) {
  return db
    .prepare("SELECT entity_type, reason, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence")
    .all(MID);
}
function chainCounts(db) {
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(MID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(MID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(MID);
  return { event_count: head?.event_count ?? 0, count: count.c, maxSeq: maxSeq.m ?? 0 };
}

// 1. Unlink sets both unlinked_at and unlink_reason (single shared stamp).
test("A3-UNLINK-T1: unlink sets unlinked_at + unlink_reason (single shared stamp = T0)", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lu1"));
  const ret = await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "wrong anchor" });
  const row = linkRow(db, id);
  assert.equal(row.unlinked_at, T0, "unlinked_at = the single nowIso() stamp");
  assert.equal(row.unlink_reason, "wrong anchor");
  assert.equal(ret.unlinked_at, T0);
  assert.equal(ret.unlink_reason, "wrong anchor");
  db.close();
});

// 2. Empty/blank/missing/null unlink reason rejected; row unchanged; no event.
test("A3-UNLINK-T1: blank/empty/missing unlink_reason -> invalid_argument, row unchanged, no event", async () => {
  for (const bad of ["", "   ", undefined, null]) {
    const { persistence, db } = opSetup();
    const id = opLink(db, mkid("lbad"));
    await assert.rejects(
      () => persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: bad }),
      (e) => e.code === "invalid_argument",
    );
    const row = linkRow(db, id);
    assert.equal(row.unlinked_at, null, "row unchanged on rejected reason");
    assert.equal(row.unlink_reason, null);
    assert.equal(chainCounts(db).count, 0, "no audit event appended");
    db.close();
  }
});

// 3. Unlink preserves the link row + the related anchor row (no DELETE).
test("A3-UNLINK-T1: unlink preserves the link row and the related anchor row", async () => {
  const { persistence, db } = opSetup();
  opSeedValid(db);
  const id = opLink(db, mkid("lpres"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  assert.ok(linkRow(db, id), "link row still present");
  assert.ok(db.prepare("SELECT 1 FROM case_box_anchors WHERE id='a0'").get(), "anchor row still present");
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM case_box_links WHERE id=?").get(id).c, 1);
  db.close();
});

// 4. Unlink emits exactly one LINK_UNLINKED event (entity_type link, entity_id, reason).
test("A3-UNLINK-T1: unlink emits exactly one LINK_UNLINKED event (entity_type link, entity_id, reason)", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lev"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "dup" });
  const evs = eventsFor(db);
  assert.equal(evs.length, 1, "exactly one event");
  const e = JSON.parse(evs[0].event_json);
  assert.equal(evs[0].entity_type, "link");
  assert.equal(e.event_kind, "LINK_UNLINKED");
  assert.equal(e.action, "update");
  assert.equal(e.entity_id, id);
  assert.equal(e.reason, "dup");
  assert.equal(e.audit_schema_version, 2);
  db.close();
});

// 5. Unlink event carries before/after hashes (differ); timestamp == unlinked_at.
test("A3-UNLINK-T1: unlink event before/after hashes differ; timestamp == row.unlinked_at", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lh"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  const e = JSON.parse(eventsFor(db)[0].event_json);
  assert.ok(typeof e.before_state_hash === "string" && e.before_state_hash.length === 64, "before hash present");
  assert.ok(typeof e.after_state_hash === "string" && e.after_state_hash.length === 64, "after hash present");
  assert.notEqual(e.before_state_hash, e.after_state_hash, "state changed -> hashes differ");
  assert.equal(e.timestamp, linkRow(db, id).unlinked_at, "event timestamp equals row unlinked_at (single stamp)");
  db.close();
});

// 5b. before_state_hash EXCLUDES the resolver-derived `status` (audit L2): two links
// identical in every authoritative field but differing only in `status` hash identically.
test("A3-UNLINK-T1: before_state_hash excludes the resolver-derived status column", async () => {
  async function beforeHashFor(status) {
    const { persistence, db } = opSetup();
    const id = opLink(db, mkid("lstatus"), { status }); // same id + matter + markers; only status differs
    await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
    const h = JSON.parse(eventsFor(db)[0].event_json).before_state_hash;
    db.close();
    return h;
  }
  const hValid = await beforeHashFor("valid");
  const hBroken = await beforeHashFor("broken");
  assert.equal(hValid, hBroken, "status is NOT part of the audited state hash input");
});

// 5c. relink rejects a passed reason (audit L1) — does not silently ignore it.
test("A3-UNLINK-T1: relink rejects unlink_reason/reason -> invalid_argument (not silently ignored)", async () => {
  for (const bad of [{ unlink_reason: "x" }, { reason: "x" }]) {
    const { persistence, db } = opSetup();
    const id = opLink(db, mkid("lrjr"), { unlinked_at: "2026-06-20T00:00:00.000Z", unlink_reason: "old" });
    await assert.rejects(
      () => persistence.relinkLink(id, { actor_user_id: "lawyer", ...bad }),
      (e) => e.code === "invalid_argument",
    );
    assert.equal(linkRow(db, id).unlinked_at, "2026-06-20T00:00:00.000Z", "row unchanged on rejected relink");
    assert.equal(chainCounts(db).count, 0, "no event on rejected relink");
    db.close();
  }
});

// 6. Marker write + audit append atomic: event_count == COUNT == MAX(sequence) == 1.
test("A3-UNLINK-T1: unlink is atomic — event_count == COUNT(*) == MAX(sequence) == 1", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("latom"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  const c = chainCounts(db);
  assert.equal(c.event_count, 1);
  assert.equal(c.count, 1);
  assert.equal(c.maxSeq, 1);
  db.close();
});

// 7. Unlink drives resolver status to marker-precedence 'broken'.
test("A3-UNLINK-T1: after unlink, resolveLinkStatuses -> 'broken' (marker precedence)", async () => {
  const { persistence, db } = opSetup();
  opSeedValid(db);
  const id = opLink(db, mkid("lres"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  resolveLinkStatuses(db, OP_SCOPE);
  assert.equal(statusOf(db, id), "broken");
  db.close();
});

// 8. Unlink drives export flag to 'UNLINKED'.
test("A3-UNLINK-T1: after unlink, buildExportCitations -> exportFlag 'UNLINKED'", async () => {
  const { persistence, db } = opSetup();
  opSeedValid(db);
  const id = opLink(db, mkid("lexp"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  const cite = buildExportCitations(db, OP_SCOPE).citations.find((c) => c.linkId === id);
  assert.equal(cite.exportFlag, "UNLINKED");
  db.close();
});

// 9. Relink clears both marker columns.
test("A3-UNLINK-T1: relink clears unlinked_at + unlink_reason to NULL", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lrel"), { unlinked_at: "2026-06-20T00:00:00.000Z", unlink_reason: "old" });
  const ret = await persistence.relinkLink(id, { actor_user_id: "lawyer" });
  const row = linkRow(db, id);
  assert.equal(row.unlinked_at, null);
  assert.equal(row.unlink_reason, null);
  assert.equal(ret.unlinked_at, null);
  assert.equal(ret.unlink_reason, null);
  db.close();
});

// 10. Relink emits exactly one LINK_RELINKED event (entity_type link, no reason).
test("A3-UNLINK-T1: relink emits exactly one LINK_RELINKED event (entity_type link, no reason)", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lrev"), { unlinked_at: "2026-06-20T00:00:00.000Z", unlink_reason: "old" });
  await persistence.relinkLink(id, { actor_user_id: "lawyer" });
  const evs = eventsFor(db);
  assert.equal(evs.length, 1);
  const e = JSON.parse(evs[0].event_json);
  assert.equal(evs[0].entity_type, "link");
  assert.equal(e.event_kind, "LINK_RELINKED");
  assert.equal(e.action, "update");
  assert.equal(e.entity_id, id);
  assert.equal(e.reason, undefined, "relink mandates no reason");
  db.close();
});

// 11. Relink event carries before/after hashes (differ).
test("A3-UNLINK-T1: relink event before/after hashes differ (marker cleared)", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lrh"), { unlinked_at: "2026-06-20T00:00:00.000Z", unlink_reason: "old" });
  await persistence.relinkLink(id, { actor_user_id: "lawyer" });
  const e = JSON.parse(eventsFor(db)[0].event_json);
  assert.equal(e.before_state_hash.length, 64);
  assert.equal(e.after_state_hash.length, 64);
  assert.notEqual(e.before_state_hash, e.after_state_hash);
  db.close();
});

// 12. Relink restores normal resolver/export for a structurally valid link.
test("A3-UNLINK-T1: relink restores normal behavior — status valid, exportFlag not UNLINKED", async () => {
  const { persistence, db } = opSetup();
  opSeedValid(db);
  const id = opLink(db, mkid("lrestore"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  await persistence.relinkLink(id, { actor_user_id: "lawyer" });
  resolveLinkStatuses(db, OP_SCOPE);
  assert.equal(statusOf(db, id), "valid", "marker cleared -> structural ladder applies (valid)");
  const cite = buildExportCitations(db, OP_SCOPE).citations.find((c) => c.linkId === id);
  assert.notEqual(cite.exportFlag, "UNLINKED", "no longer flagged UNLINKED after relink");
  db.close();
});

// 13. Relink does NOT fabricate validity (missing anchor -> still broken).
test("A3-UNLINK-T1: relink does NOT fabricate validity — a structurally broken link stays broken", async () => {
  const { persistence, db } = opSetup();
  opSeedValid(db);
  const id = opLink(db, mkid("lstruct"), { anchor_id: "missing-anchor" });
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  await persistence.relinkLink(id, { actor_user_id: "lawyer" });
  resolveLinkStatuses(db, OP_SCOPE);
  assert.equal(statusOf(db, id), "broken", "missing anchor -> structural broken after relink");
  db.close();
});

// 14. Legacy NULL-marker rows remain compatible (unlink works NULL -> set).
test("A3-UNLINK-T1: legacy NULL-marker row unlinks normally (NULL -> set)", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lleg2"), { status: "needs_review" }); // both markers default NULL
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  assert.equal(linkRow(db, id).unlinked_at, T0);
  db.close();
});

// 15. Deterministic / stable: re-running resolver after unlink keeps broken; marker stable.
test("A3-UNLINK-T1: deterministic — re-resolve after unlink is stable (broken; marker unchanged)", async () => {
  const { persistence, db } = opSetup();
  opSeedValid(db);
  const id = opLink(db, mkid("ldet"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  const at1 = linkRow(db, id).unlinked_at;
  resolveLinkStatuses(db, OP_SCOPE);
  resolveLinkStatuses(db, OP_SCOPE);
  assert.equal(statusOf(db, id), "broken");
  assert.equal(linkRow(db, id).unlinked_at, at1, "marker unchanged by repeated resolution");
  db.close();
});

// 16. Re-unlink / re-relink rejected (illegal_transition); missing link -> invalid_argument.
test("A3-UNLINK-T1: re-unlink, re-relink rejected (illegal_transition); missing link -> invalid_argument", async () => {
  const { persistence, db } = opSetup();
  const id = opLink(db, mkid("lidem"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  await assert.rejects(
    () => persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "again" }),
    (e) => e.code === "illegal_transition",
  );
  await persistence.relinkLink(id, { actor_user_id: "lawyer" });
  await assert.rejects(
    () => persistence.relinkLink(id, { actor_user_id: "lawyer" }),
    (e) => e.code === "illegal_transition",
  );
  await assert.rejects(
    () => persistence.unlinkLink(mkid("nope"), { actor_user_id: "lawyer", unlink_reason: "r" }),
    (e) => e.code === "invalid_argument",
  );
  assert.equal(chainCounts(db).count, 2, "only the successful unlink + relink appended events");
  db.close();
});

// 17. No schema version bump: operation does not change CURRENT_SCHEMA_VERSION (currently 13 via VS-1).
test("A3-UNLINK-T1: operation performs no schema bump (CURRENT_SCHEMA_VERSION == 13)", async () => {
  const { persistence, db } = opSetup();
  assert.equal(CURRENT_SCHEMA_VERSION, 13);
  const id = opLink(db, mkid("lnos"));
  await persistence.unlinkLink(id, { actor_user_id: "lawyer", unlink_reason: "r" });
  assert.equal(applySchema(db), CURRENT_SCHEMA_VERSION, "applySchema idempotent; version unchanged");
  db.close();
});

// ===========================================================================
// WI-A3-LINK-CREATE-T1 — audited createLink OPERATION.
//
// Inserts a durable active case_box_links row (provisional needs_review; NULL
// markers) + emits EXACTLY ONE LINK_CREATED chain event in one BEGIN IMMEDIATE.
// Concrete-class method; SQLite-only. Validates matter/tenant/source/anchor +
// evidence existence (source_type='evidence'). Reuses MID/OP_SCOPE/opSetup.
// Fixtures synthetic-only. See dev-memo/plan-batch-casebox-evidence-a3-link-create-t1-00.md.
// ===========================================================================

const EVID = mkid("ev1"); // a synthetic evidence-item id (ULID-shaped, audit not required but keep consistent)

// Insert the matter MID (required by createLink's requireMatterTenant).
function opMatter(db) {
  db.prepare(
    `INSERT INTO case_box_matters (id, tenant_id, actor_user_id, status, archived_at, created_at, matter_type, successor_matter_id, payload_json)
     VALUES (?, 't1', 'u1', 'active', NULL, '2026-06-24T00:00:00.000Z', 'litigation', NULL, '{}')`,
  ).run(MID);
}
// Insert an evidence_item under MID (for source_type='evidence' creates).
function opEvidence(db, id = EVID) {
  db.prepare(
    `INSERT INTO case_box_evidence_items (id, tenant_id, matter_id, source_document_id, status, party_side, supersedes_evidence_id, lawyer_weight, created_at, payload_json)
     VALUES (?, 't1', ?, NULL, 'proposed', NULL, NULL, NULL, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(id, MID);
}
function createInput(over = {}) {
  return { tenant_id: "t1", matter_id: MID, source_type: "note", source_id: "src-1", anchor_id: "a0", actor_user_id: "lawyer", ...over };
}
function linkRowsFor(db) {
  return db.prepare("SELECT * FROM case_box_links WHERE matter_id = ?").all(MID);
}
// opSeedValid with a CITABLE page (citationVolume/citationPageLabel/isCitable in payload_json),
// so a created link over anchor a0 resolves valid AND exports a clean citation.
function opSeedCitable(db) {
  db.prepare(
    `INSERT INTO case_box_documents (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type, supersedes_document_id, payload_json)
     VALUES ('doc-1', 't1', ?, 'u1', 'reviewed', '2026-06-24T00:00:00.000Z', 'exhibit', NULL, '{}')`,
  ).run(MID);
  db.prepare(
    `INSERT INTO case_box_document_pages (id, tenant_id, matter_id, document_id, physical_page_index, created_at, payload_json)
     VALUES ('p0', 't1', ?, 'doc-1', 0, '2026-06-24T00:00:00.000Z', ?)`,
  ).run(MID, JSON.stringify({ citationVolume: "1", citationPageLabel: "5", isCitable: true }));
  db.prepare(
    `INSERT INTO case_box_document_page_geometries (id, tenant_id, matter_id, document_id, physical_page_index, resolved_box,
        bounds_x, bounds_y, bounds_width, bounds_height, rotation, captured_at, created_at, payload_json)
     VALUES ('g0', 't1', ?, 'doc-1', 0, 'mediaBox', '0.000000000000', '0.000000000000', '612.000000000000', '792.000000000000', 0, ?, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(MID, GEOM_VERSION);
  db.prepare(
    `INSERT INTO case_box_anchors (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation, created_at, payload_json)
     VALUES ('a0', 't1', ?, 'doc-1', 0, ?, '0.250000000000', '0.250000000000', '0.500000000000', '0.500000000000', 'page_ratio', 'DocumentPageGeometry', 0, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(MID, GEOM_VERSION);
}

// 1+2. createLink inserts one row with expected fields + needs_review + NULL markers.
test("A3-LINK-CREATE-T1: createLink inserts one row (generated id, needs_review, NULL markers, single stamp)", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); opSeedValid(db); // opSeedValid provides anchor a0 under MID
  const ret = await persistence.createLink(createInput());
  const rows = linkRowsFor(db);
  assert.equal(rows.length, 1, "exactly one link row");
  const row = rows[0];
  assert.equal(row.id, ret.id);
  assert.match(row.id, /^[0-9a-z]{26}$/, "generated ULID id");
  assert.equal(row.status, "needs_review", "provisional status (valid never a default)");
  assert.equal(row.unlinked_at, null);
  assert.equal(row.unlink_reason, null);
  assert.equal(row.created_at, T0, "created_at = the single stamp");
  assert.equal(row.source_type, "note");
  assert.equal(row.anchor_id, "a0");
  // deterministic payload_json = canonical link identity (audit L1).
  assert.equal(
    row.payload_json,
    JSON.stringify({ id: row.id, tenant_id: "t1", matter_id: MID, source_type: "note", source_id: "src-1", anchor_id: "a0", created_at: T0 }),
  );
  db.close();
});

// 3+4+5. emits exactly one LINK_CREATED event (action create, entity_type link, before null, after present); atomic.
test("A3-LINK-CREATE-T1: createLink emits exactly one LINK_CREATED event (atomic, before null)", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); opSeedValid(db);
  const ret = await persistence.createLink(createInput());
  const evs = eventsFor(db);
  assert.equal(evs.length, 1, "exactly one event");
  const e = JSON.parse(evs[0].event_json);
  assert.equal(evs[0].entity_type, "link");
  assert.equal(e.event_kind, "LINK_CREATED");
  assert.equal(e.action, "create");
  assert.equal(e.entity_id, ret.id);
  assert.equal(e.before_state_hash, null, "create -> before_state_hash null");
  assert.equal(e.after_state_hash.length, 64);
  assert.equal(e.timestamp, ret.created_at, "event timestamp == created_at (single stamp)");
  assert.equal(e.reason, undefined, "create needs no reason");
  const c = chainCounts(db);
  assert.equal(c.event_count, 1);
  assert.equal(c.count, 1);
  assert.equal(c.maxSeq, 1);
  db.close();
});

// 7. Missing evidence (source_type='evidence') is rejected; no row/event.
test("A3-LINK-CREATE-T1: missing evidence (source_type evidence) -> invalid_argument, no row/event", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); opSeedValid(db); // no evidence_item inserted
  await assert.rejects(
    () => persistence.createLink(createInput({ source_type: "evidence", source_id: EVID })),
    (e) => e.code === "invalid_argument",
  );
  assert.equal(linkRowsFor(db).length, 0, "no link row");
  assert.equal(chainCounts(db).count, 0, "no event");
  db.close();
});

// evidence present -> create succeeds (the evidence-existence happy path).
test("A3-LINK-CREATE-T1: source_type evidence with an existing evidence_item creates normally", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); opSeedValid(db); opEvidence(db);
  const ret = await persistence.createLink(createInput({ source_type: "evidence", source_id: EVID }));
  assert.equal(linkRowsFor(db).length, 1);
  assert.equal(ret.source_type, "evidence");
  db.close();
});

// 8. Missing anchor is rejected; no row/event.
test("A3-LINK-CREATE-T1: missing anchor -> invalid_argument, no row/event", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); // no anchor inserted
  await assert.rejects(
    () => persistence.createLink(createInput({ anchor_id: "no-such-anchor" })),
    (e) => e.code === "invalid_argument",
  );
  assert.equal(linkRowsFor(db).length, 0);
  assert.equal(chainCounts(db).count, 0);
  db.close();
});

// 9. Unknown matter / tenant mismatch rejected; no row/event.
test("A3-LINK-CREATE-T1: unknown matter and tenant mismatch are rejected, no row/event", async () => {
  // unknown matter (none inserted)
  let { persistence, db } = opSetup();
  opSeedValid(db);
  await assert.rejects(() => persistence.createLink(createInput()), (e) => e.code === "unknown_matter");
  assert.equal(linkRowsFor(db).length, 0);
  assert.equal(chainCounts(db).count, 0);
  db.close();
  // tenant mismatch (matter exists under t1; input claims t2)
  ({ persistence, db } = opSetup());
  opMatter(db); opSeedValid(db);
  await assert.rejects(() => persistence.createLink(createInput({ tenant_id: "t2" })), (e) => e.code === "tenant_mismatch");
  assert.equal(linkRowsFor(db).length, 0);
  assert.equal(chainCounts(db).count, 0);
  db.close();
});

// bad source_type / empty fields rejected; no row/event.
test("A3-LINK-CREATE-T1: bad source_type / empty actor / empty source_id -> invalid_argument, no row/event", async () => {
  for (const over of [{ source_type: "bogus" }, { actor_user_id: "" }, { source_id: "" }, { tenant_id: "" }, { matter_id: "" }, { anchor_id: "" }]) {
    const { persistence, db } = opSetup();
    opMatter(db); opSeedValid(db);
    await assert.rejects(() => persistence.createLink(createInput(over)), (e) => e.code === "invalid_argument");
    assert.equal(linkRowsFor(db).length, 0);
    assert.equal(chainCounts(db).count, 0);
    db.close();
  }
});

// 6. Duplicate generated-id -> duplicate_id (deterministic), no second row/event.
test("A3-LINK-CREATE-T1: a generated-id collision -> duplicate_id, leaves the first row only", async () => {
  const FIXED = mkid("dup");
  const { persistence, db } = openSqliteCaseBoxPersistence({ now: makeClock(T0), generateId: () => FIXED });
  opMatter(db); opSeedValid(db);
  await persistence.createLink(createInput()); // first: id = FIXED
  await assert.rejects(() => persistence.createLink(createInput()), (e) => e.code === "duplicate_id");
  assert.equal(linkRowsFor(db).length, 1, "only the first row");
  assert.equal(chainCounts(db).count, 1, "only the first event");
  db.close();
});

// 10+11. Created structurally valid link resolves valid + exports a clean citation.
test("A3-LINK-CREATE-T1: a created structurally-valid link resolves valid + exports a clean citation", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); opSeedCitable(db); // doc + citable page + geom + anchor under MID
  const ret = await persistence.createLink(createInput());
  resolveLinkStatuses(db, OP_SCOPE);
  assert.equal(statusOf(db, ret.id), "valid");
  const cite = buildExportCitations(db, OP_SCOPE).citations.find((c) => c.linkId === ret.id);
  assert.equal(cite.exportFlag, null, "clean citation, no flag");
  db.close();
});

// 12. A created link can subsequently be unlinked + relinked through the live ops.
test("A3-LINK-CREATE-T1: a created link can be unlinked then relinked", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); opSeedValid(db);
  const ret = await persistence.createLink(createInput());
  await persistence.unlinkLink(ret.id, { actor_user_id: "lawyer", unlink_reason: "wrong" });
  assert.notEqual(linkRow(db, ret.id).unlinked_at, null, "unlinked");
  await persistence.relinkLink(ret.id, { actor_user_id: "lawyer" });
  assert.equal(linkRow(db, ret.id).unlinked_at, null, "relinked");
  // create + unlink + relink = 3 events on the chain.
  assert.equal(chainCounts(db).count, 3);
  db.close();
});

// 14. No schema version bump from createLink.
test("A3-LINK-CREATE-T1: createLink performs no schema bump (CURRENT_SCHEMA_VERSION == 13)", async () => {
  const { persistence, db } = opSetup();
  opMatter(db); opSeedValid(db);
  await persistence.createLink(createInput());
  assert.equal(applySchema(db), CURRENT_SCHEMA_VERSION);
  assert.equal(CURRENT_SCHEMA_VERSION, 13);
  db.close();
});
