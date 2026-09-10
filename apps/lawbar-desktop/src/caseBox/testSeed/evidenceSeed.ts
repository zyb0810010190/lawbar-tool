// TEST-ONLY seed for the evidence packaged acceptance test (product plan R2, WI-10).
//
// CONTAINMENT (do not weaken) — the same discipline as documentOpenSeed.ts and linkRoundtripSeed.ts:
// - Imported ONLY by the env-gated globalThis hook in electron/main.ts (installed iff
//   LAWBAR_EVIDENCE_TEST_HOOK === "true"). Never imported by product/renderer/IPC/preload code;
//   inert in a production launch (env var unset → main never imports it).
// - Exposes NO IPC channel, NO preload/contextBridge surface, NO renderer global.
// - Accepts NO arguments: no raw SQL, no path, no payload. Everything it writes is a FIXED
//   synthetic fixture with no real client, matter or evidence content.
//
// WHAT IT PRODUCES, and why: R2's exit evidence names "a new two-client matter with both-side
// material". This seeds ONE matter with a client party and an opposing party, and THREE registered
// originals through the REAL storeDocumentFile + registerDocument path (the production handler's
// path minus the native file chooser no test can drive). It seeds NO evidence items — creating,
// adopting and excluding them is the very thing the test drives through the shipped UI.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getCaseBoxRuntime } from "../caseBoxRuntime.js";
import { storeDocumentFile } from "../documentStorage.js";
import { getActiveTenantId } from "../../security/activeTenant.js";

// Crockford ULIDs (no i, l, o, u), 26 chars, obviously synthetic.
const MATTER_ID = "01j00000000000000000ev1dnc";
const DOCUMENT_IDS = ["01j00000000000000000ev1d0a", "01j00000000000000000ev1d0b", "01j00000000000000000ev1d0c"] as const;
const FILENAMES = ["synthetic-contract.txt", "synthetic-invoice.txt", "synthetic-letter.txt"] as const;
const SEED_AT = "2026-09-10T00:00:00.000Z";
const ACTOR = "local-user";

export interface EvidenceSeedResult {
  readonly matterId: string;
  readonly documents: ReadonlyArray<{ readonly id: string; readonly filename: string }>;
}

export async function seedEvidenceFixture(): Promise<EvidenceSeedResult> {
  const runtime = getCaseBoxRuntime();
  const { persistence, db, dbPath } = runtime;
  if (db === null || dbPath === null || dbPath === ":memory:") {
    throw new Error("seedEvidenceFixture: SQLite runtime not materialized on disk");
  }
  const tenantId = getActiveTenantId();
  const userDataDir = path.dirname(dbPath);
  const storageRoot = path.join(userDataDir, "case-box-documents");

  await persistence.createMatter({
    id: MATTER_ID,
    tenant_id: tenantId,
    actor_user_id: ACTOR,
    name: "Synthetic matter — evidence acceptance",
    jurisdiction: { value: "cn-sh", locked: false },
    matter_type: "litigation",
    parties: [
      { role: "client", display_name: "Synthetic Client Co", party_kind: "organization" },
      { role: "opposing", display_name: "Synthetic Counterparty Ltd", party_kind: "organization" },
    ],
    confidentiality_class: "normal",
    status: "active",
    external_ocr_authorized: false,
    sync_grant_present: false,
    llm_extraction_opt_in: false,
    created_at: SEED_AT,
  });

  mkdirSync(userDataDir, { recursive: true });
  const documents: Array<{ id: string; filename: string }> = [];
  for (let i = 0; i < DOCUMENT_IDS.length; i += 1) {
    const documentId = DOCUMENT_IDS[i];
    const filename = FILENAMES[i];
    const sourcePath = path.join(userDataDir, `evidence-seed-source-${i}.txt`);
    writeFileSync(sourcePath, Buffer.from(`SYNTHETIC ORIGINAL ${i + 1} — evidence acceptance fixture. Not a client document.\n`, "utf8"));
    const stored = await storeDocumentFile({ sourcePath, storageRoot, documentId, filename });
    await persistence.registerDocument(MATTER_ID, {
      id: documentId,
      tenant_id: tenantId,
      actor_user_id: ACTOR,
      matter_id: MATTER_ID,
      source: "uploaded",
      filename: stored.stored_filename,
      content_hash: stored.content_hash,
      storage_uri: stored.storage_uri,
      doc_type: "exhibit",
      received_at: SEED_AT,
      status: "registered",
      byte_size: stored.byte_size,
    });
    documents.push({ id: documentId, filename: stored.stored_filename });
  }
  return { matterId: MATTER_ID, documents };
}
