// SQLite schema for CaseBoxPersistence (Phase B1).
//
// Design notes (mirrors services/ocr-persistence/src/sqlite/schema.ts):
//
// 1. Payload JSON is the canonical source. Columns lifted out of the JSON
//    exist for indexing/filtering only; on read we always return the JSON
//    payload, never re-derive it from columns. This preserves the
//    canonical-source rule from the in-memory impl and avoids field drift.
//
// 2. Timestamps are ISO-8601 UTC strings with COLLATE BINARY so
//    lexicographic byte order matches chronological order (required by
//    cursor pagination tuples in future sub-WIs).
//
// 3. NO FOREIGN KEY constraints between tables. case_box_audit_events
//    references matter_id by value (per parent §"Dependency direction is
//    one-way"). The pragma `foreign_keys = ON` is set defensively in
//    openSqliteCaseBoxPersistence but is irrelevant in practice (no FK).
//
// 4. The schema is versioned via `schema_version`. `applySchema` is
//    idempotent: reads MAX(version); refuses (throws
//    CaseBoxPersistenceError) if the DB is at a version *newer* than
//    this build supports before any mutation; otherwise applies each
//    missing migration in a single BEGIN/COMMIT and records the version
//    via a prepared INSERT.
//
// 5. B1 ships v1: matter + audit_event + audit_chain_heads tables.
//    B2 ships v2: case_box_documents table + 2 mixed-order indices.
//    B4 ships v3: case_box_confidentiality_classifications + 3 indices.
//    B5 ships v4: case_box_privilege_markers + 3 indices (mutable rows;
//    UPDATE on transition, not append-only).
//    B6 ships v5: case_box_facts + 3 indices (mutable rows; transition
//    UPDATEs in place; supersession-chain walks via supersedes_fact_id
//    index).
//    B7 ships v6: case_box_docket_entries + case_box_deadlines + 6 indices.
//    Mode B confirmDocketEntry: atomic docket UPDATE + deadline INSERT
//    + 2 audit events + chain-head update, all inside one BEGIN IMMEDIATE.
//    B8 ships v7: case_box_evidence_items + 3 indices. Single-table
//    persistence; transitions are single-row UPDATE + 1 audit event
//    (no Mode B atomicity).
//    B9 ships v8: case_box_ocr_links + 2 indices. PK is document_id
//    (NOT id); upsert is 3-way (create/refresh/idempotent-replay);
//    by-value mirror of OCR state — no cross-package dependency.
//    (B3 audit observability ships read APIs without new schema.)
//    Future sub-WIs add DDL_STATEMENTS_V{N} arrays + map entries;
//    existing DDL is NEVER modified once shipped.

import type { Database } from "better-sqlite3";

import { CaseBoxPersistenceError } from "../errors.js";

export const CURRENT_SCHEMA_VERSION = 13;

// ---------------------------------------------------------------------------
// Per-version DDL.
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V1: ReadonlyArray<string> = [
  // Version table.
  `CREATE TABLE IF NOT EXISTS schema_version (
     version    INTEGER PRIMARY KEY,
     applied_at TEXT NOT NULL
   );`,

  // Matter rows. payload_json carries the full validated matter; columns
  // lifted only for indexing/filtering.
  `CREATE TABLE IF NOT EXISTS case_box_matters (
     id                     TEXT    PRIMARY KEY,
     tenant_id              TEXT    NOT NULL,
     actor_user_id          TEXT    NOT NULL,
     status                 TEXT    NOT NULL CHECK (status IN ('active','archived')),
     archived_at            TEXT,
     created_at             TEXT    NOT NULL COLLATE BINARY,
     matter_type            TEXT    NOT NULL,
     successor_matter_id    TEXT,
     payload_json           TEXT    NOT NULL
   );`,

  // Supports future listMatters (B10) seek-pagination by (tenant, status,
  // created_at, id).
  `CREATE INDEX IF NOT EXISTS idx_case_box_matters_by_tenant
     ON case_box_matters (tenant_id, status, created_at, id);`,

  // Audit events. event_json carries the full event; columns lifted for
  // chain verification + future listAuditEvents seek pagination.
  `CREATE TABLE IF NOT EXISTS case_box_audit_events (
     event_id          TEXT    PRIMARY KEY,
     tenant_id         TEXT    NOT NULL,
     matter_id         TEXT    NOT NULL,
     sequence          INTEGER NOT NULL,
     action            TEXT    NOT NULL,
     entity_type       TEXT    NOT NULL,
     entity_id         TEXT,
     actor_user_id     TEXT    NOT NULL,
     timestamp         TEXT    NOT NULL COLLATE BINARY,
     before_state_hash TEXT,
     after_state_hash  TEXT,
     prev_event_hash   TEXT,
     event_hash        TEXT    NOT NULL,
     reason            TEXT,
     event_json        TEXT    NOT NULL,
     UNIQUE (matter_id, sequence)
   );`,

  // Supports listAuditEvents seek pagination by (matter_id, sequence).
  `CREATE INDEX IF NOT EXISTS idx_case_box_audit_events_by_matter
     ON case_box_audit_events (matter_id, sequence);`,

  // Per-matter audit chain head. Updated in the SAME transaction as the
  // event insert. Load-bearing replay-safety invariant:
  //   event_count == COUNT(*) == MAX(sequence) for the same matter_id.
  `CREATE TABLE IF NOT EXISTS case_box_audit_chain_heads (
     matter_id     TEXT    PRIMARY KEY,
     head_hash     TEXT,
     last_event_id TEXT,
     event_count   INTEGER NOT NULL DEFAULT 0,
     updated_at    TEXT    NOT NULL COLLATE BINARY
   );`,
];

// ---------------------------------------------------------------------------
// Version 2 (Phase B2): document entity persistence.
//
// Adds case_box_documents table + 2 indices supporting listDocuments
// seek-pagination (ORDER BY received_at DESC, id ASC) AND optional
// status + doc_type filter narrowing. Mixed-order indices match the
// query's ORDER BY exactly so SQLite can walk the index without an
// extra sort step (per B2 plan §1.1 rev-1 reviewer Dim-3 #1).
//
// R-5 (purpose / work_order_status / lifecycle free-text) and R-6
// (mime_type / byte_size / manual_extracted_text) fields stay in
// payload_json (canonical-source rule); only supersedes_document_id
// is lifted to a column for the R-5(d) supersession-invariant lookup.
//
// NO FOREIGN KEY across the case-box internal tables — SQLite ALTER
// flexibility + application-layer invariants enforce correctness.
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V2: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_documents (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     actor_user_id            TEXT    NOT NULL,
     status                   TEXT    NOT NULL,
     received_at              TEXT    NOT NULL COLLATE BINARY,
     doc_type                 TEXT    NOT NULL,
     supersedes_document_id   TEXT,
     payload_json             TEXT    NOT NULL
   );`,

  // Seek pagination index: matches ORDER BY received_at DESC, id ASC
  // exactly (mixed-order; received_at descending, id ascending).
  `CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter
     ON case_box_documents (tenant_id, matter_id, received_at DESC, id ASC);`,

  // Filter-narrowing index: same mixed-order tail; covers
  // (tenant, matter, status, doc_type) filter combinations.
  `CREATE INDEX IF NOT EXISTS idx_case_box_documents_by_matter_filter
     ON case_box_documents (tenant_id, matter_id, status, doc_type, received_at DESC, id ASC);`,
];

// ---------------------------------------------------------------------------
// Version 3 (Phase B4): confidentiality classification persistence.
//
// Adds case_box_confidentiality_classifications table + 3 indices per
// B4 plan §1.1:
//   - per-target latest-lookup (DESC matching the centralized
//     set_at DESC, id ASC comparator).
//   - per-matter chronological list seek (unfiltered).
//   - filtered-target list seek (with target_type + target_id keys
//     before sort tail).
//
// Step-5 fields (level / prior_level / target_type / target_id /
// set_at / change_reason_code / actor_user_id) lifted to columns for
// index efficiency; payload_json carries canonical source. NO FK to
// case_box_matters or case_box_documents (application-layer
// enforcement via resolveDocumentTarget inside the transaction).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V3: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_confidentiality_classifications (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     target_type              TEXT    NOT NULL CHECK (target_type IN ('document','fact')),
     target_id                TEXT    NOT NULL,
     level                    TEXT    NOT NULL,
     prior_level              TEXT,
     set_at                   TEXT    NOT NULL COLLATE BINARY,
     actor_user_id            TEXT    NOT NULL,
     change_reason_code       TEXT,
     payload_json             TEXT    NOT NULL
   );`,

  // Per-target latest-lookup. Mixed-order DESC/ASC matches the
  // centralized comparator (set_at DESC, id ASC tiebreak). Walked by
  // findLatestForTarget on every append (prior-row resolution) AND by
  // getEffectiveClassification.
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_target
     ON case_box_confidentiality_classifications
       (matter_id, target_type, target_id, set_at DESC, id ASC);`,

  // Per-matter chronological list seek (unfiltered matter-wide).
  // listConfidentialityClassifications without target_type/target_id
  // filters walks this index. ORDER BY set_at ASC, id ASC.
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_seek
     ON case_box_confidentiality_classifications
       (matter_id, set_at ASC, id ASC);`,

  // Filtered-target list seek. listConfidentialityClassifications WITH
  // target_type (+optional target_id) walks this index.
  `CREATE INDEX IF NOT EXISTS idx_case_box_classifications_by_matter_target_seek
     ON case_box_confidentiality_classifications
       (matter_id, target_type, target_id, set_at ASC, id ASC);`,
];

// ---------------------------------------------------------------------------
// Version 4 (Phase B5): privilege marker persistence.
//
// Privilege markers are MUTABLE rows (status: proposed → confirmed →
// waived OR proposed → dismissed). Unlike confidentiality (append-only),
// privilege transitions UPDATE the row in place + emit a separate audit
// event for each transition. payload_json carries the canonical row;
// columns lifted: status / kind / target_type / target_id / proposed_at
// for index + filter efficiency.
//
// 3 indices:
//   - by_target (matter_id, target_type, target_id, kind, status, id) —
//     scans for confirmed-uniqueness check inside transition + per-
//     target lookups in getPrivilegeStatus.
//   - by_matter_seek (matter_id, proposed_at ASC, id ASC) — unfiltered
//     chronological list.
//   - by_matter_filter_seek (matter_id, target_type, target_id, status,
//     kind, proposed_at ASC, id ASC) — filtered list seek.
//
// No FK constraints (consistent posture from B1/B2/B3/B4).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V4: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_privilege_markers (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     target_type              TEXT    NOT NULL CHECK (target_type IN ('document','fact')),
     target_id                TEXT    NOT NULL,
     kind                     TEXT    NOT NULL,
     status                   TEXT    NOT NULL CHECK (status IN ('proposed','confirmed','dismissed','waived')),
     proposed_at              TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  // Per-target confirmed-uniqueness check + per-target lookup.
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_target
     ON case_box_privilege_markers
       (matter_id, target_type, target_id, kind, status, id);`,

  // Per-matter chronological list seek (unfiltered).
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_matter_seek
     ON case_box_privilege_markers
       (matter_id, proposed_at ASC, id ASC);`,

  // Filtered list seek.
  `CREATE INDEX IF NOT EXISTS idx_case_box_privilege_markers_by_matter_filter_seek
     ON case_box_privilege_markers
       (matter_id, target_type, target_id, status, kind, proposed_at ASC, id ASC);`,
];

// ---------------------------------------------------------------------------
// Version 5 (Phase B6): facts persistence.
//
// Facts are MUTABLE rows (status: candidate → reviewed → accepted /
// rejected; accepted-fact supersession is a new-row relationship per
// Step 2 ADR §3). Transition UPDATEs the row in place + emits an audit
// event (FACT_REVIEWED / FACT_ACCEPTED / FACT_REJECTED /
// FACT_REPLACEMENT_ACCEPTED per the contract).
//
// Step-2 + R-5 fields lifted as columns:
//   status / source_type — list filter keys per ListFactsQuery.
//   source_document_id — list filter + reverse-lookup.
//   supersedes_fact_id — supersession-chain walks.
//   purpose / as_of_date — R-5 fact fields (lifted for future filter;
//     v1 list API does not filter by purpose).
//   created_at — list ORDER BY.
// payload_json is the canonical source on read.
//
// NO FK constraints (consistent with B1-B5).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V5: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_facts (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_document_id       TEXT,
     source_type              TEXT    NOT NULL,
     status                   TEXT    NOT NULL,
     purpose                  TEXT,
     as_of_date               TEXT,
     supersedes_fact_id       TEXT,
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  // Per-matter chronological list seek (ORDER BY created_at ASC, id ASC).
  `CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_matter_seek
     ON case_box_facts (matter_id, created_at ASC, id ASC);`,

  // Filtered list seek per ListFactsQuery (status / source_type /
  // source_document_id). Matches the filter-seek pattern from B2/B4/B5.
  `CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_matter_filter_seek
     ON case_box_facts (matter_id, status, source_type, source_document_id, created_at ASC, id ASC);`,

  // Supersession-chain walk + reverse lookup on supersedes_fact_id.
  `CREATE INDEX IF NOT EXISTS idx_case_box_facts_by_supersedes
     ON case_box_facts (matter_id, supersedes_fact_id, id);`,
];

// ---------------------------------------------------------------------------
// Version 6 (Phase B7): docket entries + deadline materialization.
//
// Mode B confirmDocketEntry atomically: UPDATE docket entry + INSERT
// deadline + INSERT 2 audit events (DOCKET_ENTRY_CONFIRMED + DEADLINE_REGISTERED)
// + UPDATE audit chain head. All inside one BEGIN IMMEDIATE.
//
// Column-name alignment with the contract schema (per B7 plan rev-1
// reviewer M D1#3): public ListDocketEntriesQuery filters are
// `confirmation_state` + `source_type`. Lifted columns mirror those
// names exactly so the filter index matches the runtime filter keys.
//
// `case_box_deadlines.source_docket_entry_id` is derived from the
// originating docket entry's id during the Mode B INSERT (NOT from
// payload_json); the lifted column exists purely to index the reverse-
// lookup "which deadline materialized from this docket entry?".
//
// NO FK constraints (consistent with B1-B6).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V6: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_docket_entries (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_document_id       TEXT,
     source_type              TEXT    NOT NULL,
     proposed_kind            TEXT    NOT NULL,
     confirmation_state       TEXT    NOT NULL,
     proposed_at              TEXT    NOT NULL COLLATE BINARY,
     confirmed_deadline_id    TEXT,
     payload_json             TEXT    NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS case_box_deadlines (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_docket_entry_id   TEXT    NOT NULL,
     kind                     TEXT    NOT NULL,
     status                   TEXT    NOT NULL,
     due_at                   TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  `CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_matter_seek
     ON case_box_docket_entries (matter_id, proposed_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_matter_filter_seek
     ON case_box_docket_entries (matter_id, confirmation_state, source_type, proposed_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_docket_entries_by_confirmed_deadline
     ON case_box_docket_entries (matter_id, confirmed_deadline_id);`,

  `CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_matter_seek
     ON case_box_deadlines (matter_id, due_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_matter_filter_seek
     ON case_box_deadlines (matter_id, status, kind, due_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_deadlines_by_source_docket
     ON case_box_deadlines (matter_id, source_docket_entry_id, id);`,
];

// ---------------------------------------------------------------------------
// Version 7 (Phase B8): evidence items.
//
// Single-table mirror of Phase A6. Lifted columns match the filter
// shape of `ListEvidenceItemsQuery` (status + source_document_id) plus
// the R-5 `party_side` round-trip column. `supersedes_evidence_id`
// lifted for reverse-lookup indexing during the accepted→superseded
// transition.
//
// Per B8 plan rev-1 reviewer M D1#1: `EvidenceTransitionOpts.replacement_evidence_id`
// is the option key; this DDL's `supersedes_evidence_id` column is the
// LIFTED ROW COLUMN that the helper populates from that option value.
//
// NO FK constraints (consistent with B1-B7).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V7: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_evidence_items (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_document_id       TEXT,
     status                   TEXT    NOT NULL,
     party_side               TEXT,
     supersedes_evidence_id   TEXT,
     lawyer_weight            TEXT,
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  `CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_matter_seek
     ON case_box_evidence_items (matter_id, created_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_matter_filter_seek
     ON case_box_evidence_items (matter_id, status, source_document_id, created_at ASC, id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_evidence_items_by_supersedes
     ON case_box_evidence_items (matter_id, supersedes_evidence_id, id);`,
];

// ---------------------------------------------------------------------------
// Version 8 (Phase B9): OCR links — read-only mirror by value.
//
// PRIMARY KEY is `document_id` (NOT `id`). The contract's
// `CaseBoxOcrLink` schema has no `id` field — uniqueness is per
// document. Upsert mutates the single row in place.
//
// `matter_id` is LIFTED as a column even though the contract schema
// does not include it: the helper derives matter_id from the linked
// document at upsert time, and matter-scoped list queries require
// the lifted column to avoid joining against case_box_documents.
//
// `actor_user_id` stays in payload_json only — it records who
// recorded the snapshot, not a query key.
//
// B9 stores OCR state BY VALUE; this table does NOT reference or
// query services/ocr-persistence or services/ocr-worker (cross-
// package boundary per B9 plan §3 + lane authorization).
//
// NO FK constraints (consistent with B1-B8).
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V8: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_ocr_links (
     document_id              TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     ocr_job_id               TEXT    NOT NULL,
     direction                TEXT    NOT NULL,
     status_snapshot          TEXT    NOT NULL,
     last_seen_at             TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  // Per-matter list seek. Order: last_seen_at DESC, document_id ASC
  // (matches inMemoryOcrLink.ts listOcrLinks at line 286 — per B9 plan
  // rev-1 reviewer M D1#2).
  `CREATE INDEX IF NOT EXISTS idx_case_box_ocr_links_by_matter_seek
     ON case_box_ocr_links (matter_id, last_seen_at DESC, document_id ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_ocr_links_by_matter_filter_seek
     ON case_box_ocr_links (matter_id, status_snapshot, last_seen_at DESC, document_id ASC);`,
];

// ---------------------------------------------------------------------------
// Version 9 (Evidence-Genie A3 foundation, WI-A3-PAGE-T1): case_box_document_pages.
//
// The DocumentPage page-identity owner — the prerequisite for the A3 anchor/link
// engine (A3-PAGE-00; A3-SCHEMA-00 §6). Page identity only; NO geometry (that is
// WI-A3-PAGE-T2 / a later version), NO anchors/links, NO viewport/screen coordinates.
//
// `physical_page_index` is 0-BASED (CHECK >= 0): the first physical page is index 0
// (user decision 2026-06-24). It is the MACHINE identity; the human-facing citation
// page LABEL (citationPageLabel / citationVolume / citationPageSortKey / isCitable /
// note) lives in payload_json (case-box canonical-source rule) and is NEVER conflated
// with the machine index. `(document_id, physical_page_index)` is the canonical page
// identity (UNIQUE). `document_id` is globally unique (= case_box_documents.id PRIMARY
// KEY), so the UNIQUE needs no tenant/matter scoping.
//
// NO FOREIGN KEY (case-box convention, schema.ts header §3 / V2 note): document_id ->
// case_box_documents.id is an APP-LAYER invariant enforced by the repository layer,
// not a SQLite FK.
// ---------------------------------------------------------------------------
const DDL_STATEMENTS_V9: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_document_pages (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     document_id              TEXT    NOT NULL,
     physical_page_index      INTEGER NOT NULL CHECK (physical_page_index >= 0),
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL,
     UNIQUE (document_id, physical_page_index)
   );`,

  // By-document page lookup, tenant/matter-scoped, ordered by physical page index.
  `CREATE INDEX IF NOT EXISTS idx_case_box_document_pages_by_document
     ON case_box_document_pages (tenant_id, matter_id, document_id, physical_page_index ASC);`,
];

// ---------------------------------------------------------------------------
// Version 10 (Evidence-Genie A3 foundation, WI-A3-PAGE-T2): case_box_document_page_geometries.
//
// The DocumentPageGeometry geometry-version owner — the second A3 prerequisite,
// after DocumentPage (V9) and before the anchor/link engine (A3-PAGE-00 decision 6).
// Geometry provenance only; NO anchors/links, NO viewport/screen coordinates, NO
// rendering/transform model beyond what anchors need.
//
// App-layer identity invariant (A3-PAGE-00): a geometry row's
// `(document_id, physical_page_index)` references the SAME canonical page identity
// owned by V9 `case_box_document_pages` — ONE page-identity owner, no parallel path.
// `physical_page_index` is 0-BASED (CHECK >= 0), consistent with V9.
//
// UNIQUE(document_id, physical_page_index): SINGLE-CURRENT geometry per page (per the
// merged A3-PAGE-00 ADR + handover §10). `captured_at` is that row's geometry VERSION
// (= the anchor's geometryCapturedAt); a re-capture updates the row, and an anchor whose
// version != the current `captured_at` resolves to `needs_review` (INV-A3-6). Version
// history is intentionally NOT modelled here.
//
// `bounds_x/bounds_y/bounds_width/bounds_height` are stored as FIXED-DECIMAL TEXT with
// exactly 12 fractional decimal places (canonical strings like "612.000000000000"),
// COLLATE BINARY — byte-stable, consistent with the A3-SCHEMA-00 page_ratio 12-dp TEXT
// decision; preserves fractional PDF user-space points; avoids SQLite REAL float drift.
// The canonical 12-dp format and width/height positivity are APP-LAYER invariants
// (TEXT decimals do not take a numeric SQLite CHECK in the case-box style), enforced by
// the geometry-capture/repository layer.
//
// NO FOREIGN KEY (case-box convention): document_id -> case_box_documents.id and the
// page-identity binding are APP-LAYER invariants, not SQLite FKs.
// ---------------------------------------------------------------------------
const DDL_STATEMENTS_V10: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_document_page_geometries (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     document_id              TEXT    NOT NULL,
     physical_page_index      INTEGER NOT NULL CHECK (physical_page_index >= 0),
     resolved_box             TEXT    NOT NULL CHECK (resolved_box IN ('cropBox', 'mediaBox')),
     bounds_x                 TEXT    NOT NULL COLLATE BINARY,
     bounds_y                 TEXT    NOT NULL COLLATE BINARY,
     bounds_width             TEXT    NOT NULL COLLATE BINARY,
     bounds_height            TEXT    NOT NULL COLLATE BINARY,
     rotation                 INTEGER NOT NULL CHECK (rotation IN (0, 90, 180, 270)),
     captured_at              TEXT    NOT NULL COLLATE BINARY,
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL,
     UNIQUE (document_id, physical_page_index)
   );`,

  // By-document geometry lookup, tenant/matter-scoped, ordered by physical page index.
  `CREATE INDEX IF NOT EXISTS idx_case_box_document_page_geometries_by_document
     ON case_box_document_page_geometries (tenant_id, matter_id, document_id, physical_page_index ASC);`,
];

// ---------------------------------------------------------------------------
// Version 11 (Evidence-Genie A3, WI-A3-T1-IMPL): case_box_anchors + case_box_links.
//
// The Anchor/Link engine schema (A3-SCHEMA-00 §3 + A3-CONTRACT-00 §4), the final A3
// foundation lane — built on V9 case_box_document_pages (page identity) + V10
// case_box_document_page_geometries (geometry version). SCHEMA ONLY: no resolver,
// no status-transition logic, no replacement/quarantine, no export, no UI.
//
// case_box_anchors — a page region anchored to a captured geometry version:
//   - document_id + physical_page_index bind the V9 page identity (app-layer invariant; NO FK).
//   - geometry_captured_at is NOT NULL (provenance required) and immutable per stored anchor
//     (app-layer invariant -> a V10 ...geometries.captured_at for the same page) — an anchor
//     can never be persisted without resolved geometry provenance (INV-A3-2/7).
//   - rect_x/y/width/height are canonical page_ratio components stored as fixed 12-dp decimal
//     TEXT COLLATE BINARY (byte-stable, identical form to V10 bounds / A3-T2 page_ratio; NO REAL,
//     NO viewport/screen). The 12-dp format + [0,1] domain are APP-LAYER invariants (no numeric
//     SQLite CHECK, per the V10 bounds decision). coordinate_space/origin_ref are pinned consts.
//   - page_rotation == the geometry version's rotation (0/90/180/270).
//   - Multiple anchors per page are allowed (no UNIQUE beyond the PK).
//
// case_box_links — a work-product source -> anchor target with an explicit status:
//   - status is CHECK valid|needs_review|broken, NOT NULL, NO DEFAULT — no implicit `valid`
//     (INV-A3-8; A3-SCHEMA-00 decision 3). The resolver/status transitions are a LATER WI.
//   - anchor_id -> case_box_anchors.id is an app-layer invariant (NO FK).
//
// NO SQLite FOREIGN KEY and NO ON DELETE cascade on either table: the case-box no-FK convention,
// and the anchor-delete cascade policy is UNRESOLVED (A3-SCHEMA-00 decision 5 / A3-CONTRACT-00
// decision 9) — not invented here.
// ---------------------------------------------------------------------------
const DDL_STATEMENTS_V11: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_anchors (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     document_id              TEXT    NOT NULL,
     physical_page_index      INTEGER NOT NULL CHECK (physical_page_index >= 0),
     geometry_captured_at     TEXT    NOT NULL COLLATE BINARY,
     rect_x                   TEXT    NOT NULL COLLATE BINARY,
     rect_y                   TEXT    NOT NULL COLLATE BINARY,
     rect_width               TEXT    NOT NULL COLLATE BINARY,
     rect_height              TEXT    NOT NULL COLLATE BINARY,
     coordinate_space         TEXT    NOT NULL CHECK (coordinate_space = 'page_ratio'),
     origin_ref               TEXT    NOT NULL CHECK (origin_ref = 'DocumentPageGeometry'),
     page_rotation            INTEGER NOT NULL CHECK (page_rotation IN (0, 90, 180, 270)),
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  // By-page anchor lookup, tenant/matter-scoped.
  `CREATE INDEX IF NOT EXISTS idx_case_box_anchors_by_document
     ON case_box_anchors (tenant_id, matter_id, document_id, physical_page_index ASC);`,

  `CREATE TABLE IF NOT EXISTS case_box_links (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     source_type              TEXT    NOT NULL CHECK (source_type IN ('evidence', 'note', 'question', 'calcTerm', 'claimElement')),
     source_id                TEXT    NOT NULL,
     anchor_id                TEXT    NOT NULL,
     status                   TEXT    NOT NULL CHECK (status IN ('valid', 'needs_review', 'broken')),
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  // By-source link lookup (work-product -> links) and by-anchor lookup (anchor -> links).
  `CREATE INDEX IF NOT EXISTS idx_case_box_links_by_source
     ON case_box_links (tenant_id, matter_id, source_type, source_id, id);`,
  `CREATE INDEX IF NOT EXISTS idx_case_box_links_by_anchor
     ON case_box_links (anchor_id, id);`,
];

// ---------------------------------------------------------------------------
// Version 12 (Evidence-Genie A3, WI-A3-UNLINK-SCHEMA-01): durable-unlink marker.
//
// The durable-unlink schema mechanism chosen by A3-UNLINK-SCHEMA-00 §2 — a forward-only
// ADDITIVE migration that adds two nullable marker columns to case_box_links so an explicit
// unlink/break-link is durable + schema-backed (A3-UNLINK-00's load-bearing finding: a
// status-only `broken` is non-durable because the resolver recomputes it to `valid`).
//
//   - `unlinked_at` — the durable marker, a byte-stable timestamp TEXT COLLATE BINARY (same
//     style as created_at/captured_at). A link is explicitly unlinked IFF unlinked_at IS NOT
//     NULL. Nullable; existing rows default NULL (= not unlinked).
//   - `unlink_reason` — the why/reason, plain nullable TEXT. The app-layer invariant
//     "unlink_reason required IFF unlinked_at IS NOT NULL" is enforced by the future operation
//     WI's repository layer (the case-box no-cross-column-CHECK convention; ADR §5/§9), NOT a
//     SQLite CHECK — a cross-column iff CHECK cannot be added via ALTER without a table rebuild.
//
// SCHEMA-ONLY (A3-UNLINK-SCHEMA-00 §11): no resolver/export marker-awareness and no
// unlink/relink operation here — both are separate future A0.7-gated WIs (WI-A3-UNLINK-RESOLVE,
// WI-A3-UNLINK-T1). anchor_id stays NOT NULL; LinkStatus stays valid|needs_review|broken (no
// `unlinked` value). No FK, no ON DELETE cascade, no index on the marker columns (a future WI
// adds an index if a query needs one). Additive ALTER ADD COLUMN with no DEFAULT: existing rows
// read NULL; applySchema is version-gated (current+1..CURRENT) so the ALTER runs exactly once.
// ---------------------------------------------------------------------------
const DDL_STATEMENTS_V12: ReadonlyArray<string> = [
  `ALTER TABLE case_box_links ADD COLUMN unlinked_at TEXT COLLATE BINARY;`,
  `ALTER TABLE case_box_links ADD COLUMN unlink_reason TEXT;`,
];

// ---------------------------------------------------------------------------
// Version 13 (Pre-trial/Trial ClaimTrack, WI-PTA-VS1): case_box_claim_tracks.
//
// The first PTA persistence table — a matter's claim/counterclaim reasoning
// tracks (CaseBoxClaimTrack, contract shipped in PTA-04). Create/get/list only;
// no update/withdraw/resolve/delete path (a later slice), so only the
// CLAIM_TRACK_CREATED audit kind is ever emitted. Single-table mirror of the
// facts/evidence-item shape.
//
// Lifted columns are filter/seek keys only; `payload_json` is canonical
// (read = JSON.parse(payload_json), never re-derived). The
// (matter_id, sort_order, created_at, id) index matches the deterministic list
// ORDER BY sort_order ASC, created_at ASC, id ASC exactly (the in-memory
// comparator uses the same 3-key order; parity is tested). `created_at` is the
// only lifted timestamp (seek key); `updated_at` stays canonical in
// payload_json (createClaimTrack requires updated_at === created_at at create,
// so a later update slice owns updated_at's lifting + parity).
//
// No value CHECKs (validation is validateClaimTrack; mirrors facts/evidence).
// NO FOREIGN KEY (case-box convention, schema.ts header §3): matter_id ->
// case_box_matters.id and the claimant/respondent party-in-matter existence are
// APP-LAYER invariants (prepareCreateClaimTrack), not SQLite FKs.
// ---------------------------------------------------------------------------

const DDL_STATEMENTS_V13: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS case_box_claim_tracks (
     id                       TEXT    PRIMARY KEY,
     tenant_id                TEXT    NOT NULL,
     matter_id                TEXT    NOT NULL,
     track_type               TEXT    NOT NULL,
     status                   TEXT    NOT NULL,
     sort_order               INTEGER NOT NULL,
     created_at               TEXT    NOT NULL COLLATE BINARY,
     payload_json             TEXT    NOT NULL
   );`,

  // Per-matter deterministic list seek. Matches ORDER BY sort_order ASC,
  // created_at ASC, id ASC exactly (lawyer-controlled order first, then a
  // fully-deterministic tiebreak).
  `CREATE INDEX IF NOT EXISTS idx_case_box_claim_tracks_by_matter_sort
     ON case_box_claim_tracks (matter_id, sort_order, created_at, id);`,
];

const DDL_BY_VERSION: ReadonlyMap<number, ReadonlyArray<string>> = new Map([
  [1, DDL_STATEMENTS_V1],
  [2, DDL_STATEMENTS_V2],
  [3, DDL_STATEMENTS_V3],
  [4, DDL_STATEMENTS_V4],
  [5, DDL_STATEMENTS_V5],
  [6, DDL_STATEMENTS_V6],
  [7, DDL_STATEMENTS_V7],
  [8, DDL_STATEMENTS_V8],
  [9, DDL_STATEMENTS_V9],
  [10, DDL_STATEMENTS_V10],
  [11, DDL_STATEMENTS_V11],
  [12, DDL_STATEMENTS_V12],
  [13, DDL_STATEMENTS_V13],
]);

/**
 * Read the highest applied schema version. Returns 0 when the
 * `schema_version` table does not yet exist (fresh DB).
 *
 * This is the only non-mutating read that runs BEFORE the migration
 * transaction so the "newer-than-supported" precondition can refuse
 * without any write.
 */
export function readMaxSchemaVersion(db: Database): number {
  const tableRow = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
    )
    .get();
  if (tableRow === undefined) return 0;
  const row = db
    .prepare("SELECT MAX(version) AS v FROM schema_version")
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

/**
 * Idempotently apply the current schema to `db`. Records each applied
 * version in `schema_version` via a prepared statement. Safe to call
 * multiple times.
 *
 * Refuses to mutate if the DB is already at a version *newer* than
 * `CURRENT_SCHEMA_VERSION` — the caller's binary is too old to operate
 * safely on that DB. The check runs before BEGIN, so a refusal leaves
 * the DB byte-identical to its pre-call state.
 *
 * @returns the schema version now present in the DB.
 */
export function applySchema(
  db: Database,
  now: () => Date = () => new Date(),
): number {
  const current = readMaxSchemaVersion(db);
  if (current > CURRENT_SCHEMA_VERSION) {
    throw new CaseBoxPersistenceError(
      "invalid_payload",
      `schema version ${current} on disk is newer than supported ${CURRENT_SCHEMA_VERSION}; refusing to apply migration`,
    );
  }
  if (current === CURRENT_SCHEMA_VERSION) {
    return CURRENT_SCHEMA_VERSION;
  }

  db.exec("BEGIN");
  try {
    for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      const statements = DDL_BY_VERSION.get(v);
      if (statements === undefined) {
        throw new CaseBoxPersistenceError(
          "invalid_payload",
          `no DDL registered for schema version ${v}`,
        );
      }
      for (const stmt of statements) {
        db.exec(stmt);
      }
      // Prepare AFTER DDL runs (v1 creates schema_version table; preparing
      // before would fail with "no such table: schema_version").
      db.prepare(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(v, now().toISOString());
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ROLLBACK best-effort; original error wins.
    }
    throw err;
  }
  return CURRENT_SCHEMA_VERSION;
}
