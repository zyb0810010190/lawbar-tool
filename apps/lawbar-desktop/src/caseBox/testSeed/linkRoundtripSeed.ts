// TEST-ONLY seed for the D1 link round-trip Electron integration test
// (WI-A3-LINK-D1-ROUNDTRIP-T1; ADR-evidence-a3-link-d1-roundtrip-closure rev-1 §0/§11).
//
// CONTAINMENT (do not weaken):
// - Imported ONLY by the env-gated globalThis hook in electron/main.ts (installed
//   iff LAWBAR_CASEBOX_LINK_SEED_TEST_HOOK==="true"). Never imported by
//   product/renderer/IPC/preload code; inert in a production launch (env var unset →
//   main never imports it).
// - Exposes NO IPC channel, NO preload/contextBridge surface, NO renderer global.
// - Accepts NO raw SQL, NO arbitrary DB path (reuses main's already-open handle via
//   getCaseBoxRuntime().db), and NO caller-supplied row payload — only fixed scope ids
//   (matterId/documentId). The inserted rows are FIXED synthetic fixtures (no real
//   client/matter/evidence content).
//
// It seeds the minimal real-DB dependency set createLink + resolveLinkStatuses +
// buildExportCitations need for a CLEAN, `valid` round-trip:
//   case_box_document_pages (synthetic citation identity)
//   case_box_document_page_geometries (captured_at == the anchor's geometry_captured_at)
//   case_box_anchors (page_ratio / DocumentPageGeometry)
//   case_box_evidence_items (scoped, for source_type 'evidence')
// scoped to the matter's main-injected tenant_id + a SYNTHETIC documentId (createLink/
// resolver/export require no case_box_documents row; registerDocument is interactive).

import { getCaseBoxRuntime } from "../caseBoxRuntime.js";

const SEED_AT = "2026-06-28T00:00:00.000Z";
const GEOMETRY_CAPTURED_AT = SEED_AT;
const PHYSICAL_PAGE_INDEX = 0;
const CITATION_VOLUME = "1";
const CITATION_PAGE_LABEL = "5";
const ANCHOR_ID = "d1rt-anchor-0";
const PAGE_ID = "d1rt-page-0";
const GEOMETRY_ID = "d1rt-geom-0";
const EVIDENCE_ID = "d1rt-evidence-0";

export interface LinkRoundtripSeedInput {
  readonly matterId: string;
  readonly documentId: string;
}

export interface LinkRoundtripSeedResult {
  readonly anchorId: string;
  readonly evidenceId: string;
  readonly physicalPageIndex: number;
  readonly citationVolume: string;
  readonly citationPageLabel: string;
}

/**
 * Seed the fixed synthetic round-trip fixture into main's already-open SQLite DB.
 * Throws if the SQLite runtime is not materialized (the test calls a casebox IPC
 * op first) or the matter does not exist.
 */
export function seedLinkRoundtripFixture(
  input: LinkRoundtripSeedInput,
): LinkRoundtripSeedResult {
  const runtime = getCaseBoxRuntime();
  const db = runtime.db;
  if (db === null) {
    throw new Error(
      "seedLinkRoundtripFixture: SQLite runtime not initialized (call a casebox IPC op first)",
    );
  }

  const matter = db
    .prepare("SELECT tenant_id FROM case_box_matters WHERE id = ?")
    .get(input.matterId) as { tenant_id: string } | undefined;
  if (matter === undefined) {
    throw new Error(`seedLinkRoundtripFixture: unknown matter ${input.matterId}`);
  }
  const tenantId = matter.tenant_id;

  const pagePayload = JSON.stringify({
    citationVolume: CITATION_VOLUME,
    citationPageLabel: CITATION_PAGE_LABEL,
    isCitable: true,
  });

  db.prepare(
    `INSERT INTO case_box_document_pages
       (id, tenant_id, matter_id, document_id, physical_page_index, created_at, payload_json)
     VALUES (@id, @tenant_id, @matter_id, @document_id, @physical_page_index, @created_at, @payload_json)`,
  ).run({
    id: PAGE_ID,
    tenant_id: tenantId,
    matter_id: input.matterId,
    document_id: input.documentId,
    physical_page_index: PHYSICAL_PAGE_INDEX,
    created_at: SEED_AT,
    payload_json: pagePayload,
  });

  db.prepare(
    `INSERT INTO case_box_document_page_geometries
       (id, tenant_id, matter_id, document_id, physical_page_index, resolved_box,
        bounds_x, bounds_y, bounds_width, bounds_height, rotation, captured_at, created_at, payload_json)
     VALUES (@id, @tenant_id, @matter_id, @document_id, @physical_page_index, 'mediaBox',
             '0.000000000000', '0.000000000000', '612.000000000000', '792.000000000000',
             0, @captured_at, @created_at, '{}')`,
  ).run({
    id: GEOMETRY_ID,
    tenant_id: tenantId,
    matter_id: input.matterId,
    document_id: input.documentId,
    physical_page_index: PHYSICAL_PAGE_INDEX,
    captured_at: GEOMETRY_CAPTURED_AT,
    created_at: SEED_AT,
  });

  db.prepare(
    `INSERT INTO case_box_anchors
       (id, tenant_id, matter_id, document_id, physical_page_index, geometry_captured_at,
        rect_x, rect_y, rect_width, rect_height, coordinate_space, origin_ref, page_rotation,
        created_at, payload_json)
     VALUES (@id, @tenant_id, @matter_id, @document_id, @physical_page_index, @geometry_captured_at,
             '0.250000000000', '0.250000000000', '0.500000000000', '0.500000000000',
             'page_ratio', 'DocumentPageGeometry', 0, @created_at, '{}')`,
  ).run({
    id: ANCHOR_ID,
    tenant_id: tenantId,
    matter_id: input.matterId,
    document_id: input.documentId,
    physical_page_index: PHYSICAL_PAGE_INDEX,
    geometry_captured_at: GEOMETRY_CAPTURED_AT,
    created_at: SEED_AT,
  });

  db.prepare(
    `INSERT INTO case_box_evidence_items
       (id, tenant_id, matter_id, source_document_id, status, party_side, supersedes_evidence_id, lawyer_weight, created_at, payload_json)
     VALUES (@id, @tenant_id, @matter_id, @document_id, 'proposed', NULL, NULL, NULL, @created_at, '{}')`,
  ).run({
    id: EVIDENCE_ID,
    tenant_id: tenantId,
    matter_id: input.matterId,
    document_id: input.documentId,
    created_at: SEED_AT,
  });

  return {
    anchorId: ANCHOR_ID,
    evidenceId: EVIDENCE_ID,
    physicalPageIndex: PHYSICAL_PAGE_INDEX,
    citationVolume: CITATION_VOLUME,
    citationPageLabel: CITATION_PAGE_LABEL,
  };
}
