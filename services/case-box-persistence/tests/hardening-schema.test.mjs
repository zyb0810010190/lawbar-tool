// Hardening: applySchema smoke (B2). Split from former monolithic
// sqlite.hardening.test.mjs per B8 plan §1.7 (closes B7 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  CaseBoxPersistenceError,
} from "./hardening-common.mjs";

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
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_version'")
    .all();
  assert.equal(tables.length, 0);
  db.close();
});

test("Sqlite-B2+: applySchema upgrades a v1 DB additively to current version", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-05-22T00:00:00.000Z');
           CREATE TABLE case_box_matters (id TEXT PRIMARY KEY, payload_json TEXT);
           CREATE TABLE case_box_audit_events (event_id TEXT PRIMARY KEY);
           CREATE TABLE case_box_audit_chain_heads (matter_id TEXT PRIMARY KEY);`);
  const v = applySchema(db);
  assert.equal(v, CURRENT_SCHEMA_VERSION);
  const docsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_box_documents'")
    .get();
  assert.ok(docsTable, "case_box_documents must exist after upgrade");
  const rows = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
  const expected = [];
  for (let i = 1; i <= CURRENT_SCHEMA_VERSION; i++) expected.push(i);
  assert.deepEqual(rows.map((r) => r.version), expected);
  db.close();
});

// ---------------------------------------------------------------------------
// WI-A3-PAGE-T1: schema V9 case_box_document_pages (DocumentPage page identity).
// physical_page_index is 0-BASED (CHECK >= 0); the human citation LABEL is a
// separate concern kept in payload_json, never the machine index. No FK
// (app-layer invariant); no geometry/viewport columns; no anchor/link tables.
// ---------------------------------------------------------------------------

function insertPage(db, id, documentId, physicalPageIndex) {
  db.prepare(
    `INSERT INTO case_box_document_pages
       (id, tenant_id, matter_id, document_id, physical_page_index, created_at, payload_json)
     VALUES (?, 't1', 'm1', ?, ?, '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(id, documentId, physicalPageIndex);
}

test("A3-PAGE-T1: V9 creates case_box_document_pages with the expected columns (no geometry/viewport)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const cols = db
    .prepare("PRAGMA table_info('case_box_document_pages')")
    .all()
    .map((c) => c.name)
    .sort();
  assert.deepEqual(cols, [
    "created_at",
    "document_id",
    "id",
    "matter_id",
    "payload_json",
    "physical_page_index",
    "tenant_id",
  ]);
  // No geometry / page-box / rotation / page_ratio / viewport / screen columns.
  for (const forbidden of [
    "bounds_x", "bounds_y", "bounds_width", "bounds_height", "rotation",
    "resolved_box", "page_ratio", "geometry_captured_at", "rect_x", "rect_y",
    "viewport", "screen", "device_pixel_ratio",
  ]) {
    assert.ok(!cols.includes(forbidden), `unexpected geometry/viewport column '${forbidden}'`);
  }
  db.close();
});

test("A3-PAGE-T1: physical_page_index = 0 is accepted (0-based)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.doesNotThrow(() => insertPage(db, "p0", "doc-1", 0));
  const got = db
    .prepare("SELECT physical_page_index AS i FROM case_box_document_pages WHERE id='p0'")
    .get();
  assert.equal(got.i, 0);
  db.close();
});

test("A3-PAGE-T1: negative physical_page_index is rejected (CHECK >= 0)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.throws(() => insertPage(db, "pneg", "doc-1", -1), /CHECK|constraint/i);
  db.close();
});

test("A3-PAGE-T1: UNIQUE(document_id, physical_page_index) is enforced", () => {
  const db = new Database(":memory:");
  applySchema(db);
  insertPage(db, "p-a", "doc-1", 0);
  assert.throws(() => insertPage(db, "p-b", "doc-1", 0), /UNIQUE|constraint/i);
  // Same index on a DIFFERENT document is fine (identity is per document).
  assert.doesNotThrow(() => insertPage(db, "p-c", "doc-2", 0));
  db.close();
});

test("A3-PAGE-T1: case_box_document_pages has NO SQLite foreign keys (app-layer invariant)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const fks = db.prepare("PRAGMA foreign_key_list('case_box_document_pages')").all();
  assert.equal(fks.length, 0, "case-box convention forbids SQLite FKs; document_id is an app-layer invariant");
  db.close();
});

test("A3 foundations: the full A3 persistence surface (page, geometry, anchors, links) exists at current schema", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name),
  );
  for (const expected of [
    "case_box_document_pages",          // V9 page identity
    "case_box_document_page_geometries", // V10 geometry version
    "case_box_anchors",                  // V11 anchor
    "case_box_links",                    // V11 link
  ]) {
    assert.ok(tables.has(expected), `${expected} must exist at the current A3 schema`);
  }
  db.close();
});

test("A3-PAGE-T1: V8 -> current upgrade is additive (V9 DocumentPage present, data preserved)", () => {
  const db = new Database(":memory:");
  // Plant a V8 DB with a pre-existing document row; applySchema must apply the versions
  // above 8 (V9, and now V10) and leave the existing data intact.
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (8, '2026-06-24T00:00:00.000Z');
           CREATE TABLE case_box_documents (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
           INSERT INTO case_box_documents (id, payload_json) VALUES ('keep-me', '{}');`);
  assert.equal(applySchema(db), CURRENT_SCHEMA_VERSION);
  const kept = db.prepare("SELECT id FROM case_box_documents WHERE id='keep-me'").get();
  assert.ok(kept, "existing document row must survive the additive upgrade");
  const pages = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_box_document_pages'")
    .get();
  assert.ok(pages, "case_box_document_pages must exist after the upgrade");
  const ver = db.prepare("SELECT MAX(version) AS v FROM schema_version").get();
  assert.equal(ver.v, CURRENT_SCHEMA_VERSION);
  db.close();
});

// ---------------------------------------------------------------------------
// WI-A3-PAGE-T2: schema V10 case_box_document_page_geometries (DocumentPageGeometry).
// Geometry-version owner; UNIQUE(document_id, physical_page_index) single-current;
// bounds_x/y/width/height stored as fixed 12-dp decimal TEXT (COLLATE BINARY);
// resolved_box cropBox|mediaBox; rotation 0/90/180/270; captured_at version. No FK,
// no viewport/screen columns, no anchor/link tables.
// ---------------------------------------------------------------------------

function insertGeom(db, overrides = {}) {
  const g = {
    id: "g0",
    document_id: "doc-1",
    physical_page_index: 0,
    resolved_box: "mediaBox",
    bounds_x: "0.000000000000",
    bounds_y: "0.000000000000",
    bounds_width: "612.000000000000",
    bounds_height: "792.000000000000",
    rotation: 0,
    captured_at: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
  db.prepare(
    `INSERT INTO case_box_document_page_geometries
       (id, tenant_id, matter_id, document_id, physical_page_index, resolved_box,
        bounds_x, bounds_y, bounds_width, bounds_height, rotation, captured_at, created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, @resolved_box,
             @bounds_x, @bounds_y, @bounds_width, @bounds_height, @rotation, @captured_at,
             '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(g);
}

test("A3-PAGE-T2: V10 creates case_box_document_page_geometries with the expected columns (no viewport)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const cols = db
    .prepare("PRAGMA table_info('case_box_document_page_geometries')")
    .all()
    .map((c) => c.name)
    .sort();
  assert.deepEqual(cols, [
    "bounds_height", "bounds_width", "bounds_x", "bounds_y",
    "captured_at", "created_at", "document_id", "id", "matter_id",
    "payload_json", "physical_page_index", "resolved_box", "rotation", "tenant_id",
  ].sort());
  for (const forbidden of ["viewport", "screen", "device_pixel_ratio", "css_pixel", "page_ratio", "rect_x"]) {
    assert.ok(!cols.includes(forbidden), `unexpected viewport/anchor column '${forbidden}'`);
  }
  db.close();
});

test("A3-PAGE-T2: bounds stored as fixed 12-dp decimal TEXT, byte-identical round-trip", () => {
  const db = new Database(":memory:");
  applySchema(db);
  insertGeom(db, { id: "g-bounds", bounds_width: "612.500000000000" });
  const got = db
    .prepare("SELECT bounds_width AS w, typeof(bounds_width) AS t FROM case_box_document_page_geometries WHERE id='g-bounds'")
    .get();
  assert.equal(got.t, "text", "bounds must be stored as TEXT (byte-stable), not REAL");
  assert.equal(got.w, "612.500000000000");
  assert.match(got.w, /^\d+\.\d{12}$/);
  db.close();
});

test("A3-PAGE-T2: resolved_box CHECK rejects anything outside cropBox/mediaBox", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.doesNotThrow(() => insertGeom(db, { id: "g-crop", resolved_box: "cropBox" }));
  assert.throws(() => insertGeom(db, { id: "g-trim", resolved_box: "trimBox" }), /CHECK|constraint/i);
  db.close();
});

test("A3-PAGE-T2: rotation CHECK rejects anything outside 0/90/180/270", () => {
  const db = new Database(":memory:");
  applySchema(db);
  // Distinct physical_page_index per row so the UNIQUE(document_id, physical_page_index)
  // constraint does not collide — this test isolates the rotation CHECK.
  let pageIdx = 0;
  for (const r of [0, 90, 180, 270]) {
    assert.doesNotThrow(() => insertGeom(db, { id: `g-rot-${r}`, physical_page_index: pageIdx++, rotation: r }));
  }
  assert.throws(() => insertGeom(db, { id: "g-rot-45", physical_page_index: 99, rotation: 45 }), /CHECK|constraint/i);
  db.close();
});

test("A3-PAGE-T2: physical_page_index 0 accepted, negative rejected (0-based, consistent with V9)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.doesNotThrow(() => insertGeom(db, { id: "g-idx0", physical_page_index: 0 }));
  assert.throws(() => insertGeom(db, { id: "g-idxneg", physical_page_index: -1 }), /CHECK|constraint/i);
  db.close();
});

test("A3-PAGE-T2: required columns (document_id, physical_page_index, captured_at) are NOT NULL", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.throws(() => insertGeom(db, { id: "g-nodoc", document_id: null }), /NOT NULL|constraint/i);
  assert.throws(() => insertGeom(db, { id: "g-noidx", physical_page_index: null }), /NOT NULL|constraint/i);
  assert.throws(() => insertGeom(db, { id: "g-nover", captured_at: null }), /NOT NULL|constraint/i);
  db.close();
});

test("A3-PAGE-T2: UNIQUE(document_id, physical_page_index) — single-current geometry per page", () => {
  const db = new Database(":memory:");
  applySchema(db);
  insertGeom(db, { id: "g-a", document_id: "doc-1", physical_page_index: 0 });
  // Same (document, page) again — even with a different captured_at — is rejected (single-current).
  assert.throws(
    () => insertGeom(db, { id: "g-b", document_id: "doc-1", physical_page_index: 0, captured_at: "2026-06-25T00:00:00.000Z" }),
    /UNIQUE|constraint/i,
  );
  // Same page on a DIFFERENT document is fine.
  assert.doesNotThrow(() => insertGeom(db, { id: "g-c", document_id: "doc-2", physical_page_index: 0 }));
  db.close();
});

test("A3-PAGE-T2: geometry table has NO SQLite foreign keys (app-layer invariant)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  const fks = db.prepare("PRAGMA foreign_key_list('case_box_document_page_geometries')").all();
  assert.equal(fks.length, 0, "case-box convention forbids SQLite FKs; document/page binding is app-layer");
  db.close();
});

test("A3-PAGE-T2: V9 -> current upgrade keeps DocumentPage data + creates the geometry table", () => {
  const db = new Database(":memory:");
  // Plant a V9 DB with a pre-existing document_pages row; applySchema applies the versions
  // above 9 (V10, and now V11) and leaves the existing page data intact.
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (9, '2026-06-24T00:00:00.000Z');
           CREATE TABLE case_box_document_pages (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
           INSERT INTO case_box_document_pages (id, payload_json) VALUES ('page-keep', '{}');`);
  assert.equal(applySchema(db), CURRENT_SCHEMA_VERSION);
  const kept = db.prepare("SELECT id FROM case_box_document_pages WHERE id='page-keep'").get();
  assert.ok(kept, "existing DocumentPage row must survive the additive upgrade");
  const geom = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_box_document_page_geometries'")
    .get();
  assert.ok(geom, "case_box_document_page_geometries must exist after the upgrade");
  const ver = db.prepare("SELECT MAX(version) AS v FROM schema_version").get();
  assert.equal(ver.v, CURRENT_SCHEMA_VERSION);
  db.close();
});

// ---------------------------------------------------------------------------
// WI-A3-T1-IMPL: schema V11 case_box_anchors + case_box_links (Anchor/Link engine).
// page_ratio rect as fixed 12-dp TEXT (COLLATE BINARY); coordinate_space/origin_ref consts;
// page_rotation 0/90/180/270; geometry_captured_at NOT NULL; LinkStatus CHECK with NO DEFAULT;
// source_type enum; NO SQLite FK, NO ON DELETE cascade, no UNIQUE beyond PK; no viewport.
// ---------------------------------------------------------------------------

function insertAnchor(db, overrides = {}) {
  const a = {
    id: "a0",
    document_id: "doc-1",
    physical_page_index: 0,
    geometry_captured_at: "2026-06-24T00:00:00.000Z",
    rect_x: "0.250000000000",
    rect_y: "0.250000000000",
    rect_width: "0.500000000000",
    rect_height: "0.500000000000",
    coordinate_space: "page_ratio",
    origin_ref: "DocumentPageGeometry",
    page_rotation: 0,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO case_box_anchors
       (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation,
        created_at, payload_json)
     VALUES (@id, 't1', 'm1', @document_id, @physical_page_index, @geometry_captured_at,
             @rect_x, @rect_y, @rect_width, @rect_height, @coordinate_space, @origin_ref, @page_rotation,
             '2026-06-24T00:00:00.000Z', '{}')`,
  ).run(a);
}

function insertLink(db, overrides = {}) {
  const l = {
    id: "l0",
    source_type: "evidence",
    source_id: "ev-1",
    anchor_id: "a0",
    ...overrides,
  };
  // `status` is intentionally NOT defaulted here so a caller can omit it to prove "no implicit valid".
  const cols = ["id", "tenant_id", "matter_id", "source_type", "source_id", "anchor_id"];
  const vals = ["@id", "'t1'", "'m1'", "@source_type", "@source_id", "@anchor_id"];
  if ("status" in overrides) { cols.push("status"); vals.push("@status"); l.status = overrides.status; }
  cols.push("created_at", "payload_json");
  vals.push("'2026-06-24T00:00:00.000Z'", "'{}'");
  db.prepare(`INSERT INTO case_box_links (${cols.join(", ")}) VALUES (${vals.join(", ")})`).run(l);
}

test("A3-T1-IMPL: V11 creates case_box_anchors + case_box_links with the expected columns (no viewport)", () => {
  const db = new Database(":memory:");
  assert.equal(applySchema(db), 11);
  const anchorCols = db.prepare("PRAGMA table_info('case_box_anchors')").all().map((c) => c.name).sort();
  assert.deepEqual(anchorCols, [
    "coordinate_space", "created_at", "document_id", "geometry_captured_at", "id", "matter_id",
    "origin_ref", "page_rotation", "payload_json", "physical_page_index",
    "rect_height", "rect_width", "rect_x", "rect_y", "tenant_id",
  ].sort());
  for (const forbidden of ["viewport", "screen", "device_pixel_ratio", "bounds_x"]) {
    assert.ok(!anchorCols.includes(forbidden), `unexpected column '${forbidden}' on case_box_anchors`);
  }
  const linkCols = db.prepare("PRAGMA table_info('case_box_links')").all().map((c) => c.name).sort();
  assert.deepEqual(linkCols, [
    "anchor_id", "created_at", "id", "matter_id", "payload_json", "source_id", "source_type", "status", "tenant_id",
  ].sort());
  db.close();
});

test("A3-T1-IMPL: anchor rect stored as fixed 12-dp TEXT, byte-identical round-trip; coordinate consts enforced", () => {
  const db = new Database(":memory:");
  applySchema(db);
  insertAnchor(db, { id: "a-rect", rect_width: "0.123456789012" });
  const got = db
    .prepare("SELECT rect_width AS w, typeof(rect_width) AS t FROM case_box_anchors WHERE id='a-rect'")
    .get();
  assert.equal(got.t, "text", "page_ratio must be stored as TEXT, not REAL");
  assert.equal(got.w, "0.123456789012");
  assert.match(got.w, /^\d+\.\d{12}$/);
  // coordinate_space / origin_ref are pinned consts.
  assert.throws(() => insertAnchor(db, { id: "a-cs", coordinate_space: "viewport" }), /CHECK|constraint/i);
  assert.throws(() => insertAnchor(db, { id: "a-or", origin_ref: "OptimizedDocumentRendition" }), /CHECK|constraint/i);
  db.close();
});

test("A3-T1-IMPL: anchor geometry_captured_at is NOT NULL (no anchor without geometry provenance)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.throws(() => insertAnchor(db, { id: "a-noprov", geometry_captured_at: null }), /NOT NULL|constraint/i);
  db.close();
});

test("A3-T1-IMPL: anchor page_rotation CHECK + 0-based physical_page_index", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.doesNotThrow(() => insertAnchor(db, { id: "a-r270", page_rotation: 270 }));
  assert.throws(() => insertAnchor(db, { id: "a-r45", page_rotation: 45 }), /CHECK|constraint/i);
  assert.doesNotThrow(() => insertAnchor(db, { id: "a-idx0", physical_page_index: 0 }));
  assert.throws(() => insertAnchor(db, { id: "a-idxneg", physical_page_index: -1 }), /CHECK|constraint/i);
  db.close();
});

test("A3-T1-IMPL: Link.status CHECK enforces the enum and has NO default (no implicit valid)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  for (const s of ["valid", "needs_review", "broken"]) {
    assert.doesNotThrow(() => insertLink(db, { id: `l-${s}`, anchor_id: `anc-${s}`, status: s }));
  }
  // Unknown status rejected by CHECK.
  assert.throws(() => insertLink(db, { id: "l-bad", anchor_id: "anc-bad", status: "pending" }), /CHECK|constraint/i);
  // A row without an explicit status fails — there is NO DEFAULT 'valid'.
  assert.throws(() => insertLink(db, { id: "l-nostatus", anchor_id: "anc-x" }), /NOT NULL|constraint/i);
  db.close();
});

test("A3-T1-IMPL: Link.source_type CHECK enforces the source enum", () => {
  const db = new Database(":memory:");
  applySchema(db);
  for (const t of ["evidence", "note", "question", "calcTerm", "claimElement"]) {
    assert.doesNotThrow(() => insertLink(db, { id: `l-${t}`, source_type: t, status: "valid" }));
  }
  assert.throws(() => insertLink(db, { id: "l-badtype", source_type: "tag", status: "valid" }), /CHECK|constraint/i);
  db.close();
});

test("A3-T1-IMPL: neither case_box_anchors nor case_box_links has SQLite foreign keys (app-layer invariant)", () => {
  const db = new Database(":memory:");
  applySchema(db);
  assert.equal(db.prepare("PRAGMA foreign_key_list('case_box_anchors')").all().length, 0);
  assert.equal(db.prepare("PRAGMA foreign_key_list('case_box_links')").all().length, 0);
  db.close();
});

test("A3-T1-IMPL: V10 -> V11 upgrade preserves existing DocumentPage + geometry data", () => {
  const db = new Database(":memory:");
  // Plant a V10 DB with pre-existing page + geometry rows; applySchema applies ONLY V11.
  db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
           INSERT INTO schema_version (version, applied_at) VALUES (10, '2026-06-24T00:00:00.000Z');
           CREATE TABLE case_box_document_pages (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
           INSERT INTO case_box_document_pages (id, payload_json) VALUES ('p-keep', '{}');
           CREATE TABLE case_box_document_page_geometries (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
           INSERT INTO case_box_document_page_geometries (id, payload_json) VALUES ('g-keep', '{}');`);
  assert.equal(applySchema(db), 11);
  assert.ok(db.prepare("SELECT id FROM case_box_document_pages WHERE id='p-keep'").get(), "page row preserved");
  assert.ok(db.prepare("SELECT id FROM case_box_document_page_geometries WHERE id='g-keep'").get(), "geometry row preserved");
  for (const t of ["case_box_anchors", "case_box_links"]) {
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t),
      `${t} must exist after the V11 upgrade`,
    );
  }
  assert.equal(db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v, 11);
  db.close();
});
