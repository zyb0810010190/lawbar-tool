// TEST-ONLY seed for the document-open packaged acceptance test (product plan R1, WI-7).
//
// CONTAINMENT (do not weaken) — the same discipline as linkRoundtripSeed.ts:
// - Imported ONLY by the env-gated globalThis hook in electron/main.ts (installed iff
//   LAWBAR_DOCUMENT_OPEN_TEST_HOOK === "true"). Never imported by product/renderer/IPC/preload
//   code; inert in a production launch (env var unset → main never imports it).
// - Exposes NO IPC channel, NO preload/contextBridge surface, NO renderer global.
// - Accepts NO arguments at all: no raw SQL, no path, no payload. Everything it writes is a FIXED
//   synthetic fixture with no real client, matter or evidence content, into main's already-open
//   runtime (getCaseBoxRuntime()) and the store directory that runtime already resolves.
//
// WHAT IT PRODUCES, and why each part goes the way it does:
// - One matter, through the REAL persistence API (`createMatter`), so the matter view renders a
//   record the product itself would have written, audit event included.
// - One original, placed in the store through the REAL `storeDocumentFile`, so the on-disk layout
//   (<store>/<documentId>/<filename>, content-addressed, destination hashed) is production's and
//   the open path verifies exactly what production would verify.
// - One document record, through the REAL `registerDocument` — the production handler's path
//   minus the native file chooser no test can drive — so the record is validated and the audit
//   event is written exactly as they would be for a real registration.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getCaseBoxRuntime } from "../caseBoxRuntime.js";
import { storeDocumentFile } from "../documentStorage.js";
import { getActiveTenantId } from "../../security/activeTenant.js";

// Crockford ULIDs (no i, l, o, u), 26 chars, obviously synthetic.
const MATTER_ID = "01j0000000000000000d0c0pen";
const DOCUMENT_ID = "01j0000000000000000d0c0d0c";
const FILENAME = "synthetic-original.txt";
const SEED_AT = "2026-09-08T00:00:00.000Z";
const ACTOR = "local-user";
// Obviously-fake bytes; the point is that they are content-addressed like a real exhibit.
const FIXTURE_BYTES = Buffer.from(
  "SYNTHETIC ORIGINAL — document-open packaged acceptance fixture. Not a client document.\n",
  "utf8",
);

export interface DocumentOpenSeedResult {
  readonly matterId: string;
  readonly documentId: string;
  readonly filename: string;
  readonly contentHash: string;
}

export async function seedDocumentOpenFixture(): Promise<DocumentOpenSeedResult> {
  const runtime = getCaseBoxRuntime();
  const { persistence, db, dbPath } = runtime;
  if (db === null || dbPath === null || dbPath === ":memory:") {
    throw new Error("seedDocumentOpenFixture: SQLite runtime not materialized on disk");
  }
  const tenantId = getActiveTenantId();
  const userDataDir = path.dirname(dbPath);
  const storageRoot = path.join(userDataDir, "case-box-documents");

  await persistence.createMatter({
    id: MATTER_ID,
    tenant_id: tenantId,
    actor_user_id: ACTOR,
    name: "Synthetic matter — document-open acceptance",
    jurisdiction: { value: "cn-sh", locked: false },
    matter_type: "litigation",
    parties: [{ role: "client", display_name: "Synthetic Client Co", party_kind: "organization" }],
    confidentiality_class: "normal",
    status: "active",
    external_ocr_authorized: false,
    sync_grant_present: false,
    llm_extraction_opt_in: false,
    created_at: SEED_AT,
  });

  // The fixture source lives beside the store, not inside it: storeDocumentFile copies it IN.
  mkdirSync(userDataDir, { recursive: true });
  const sourcePath = path.join(userDataDir, "document-open-seed-source.txt");
  writeFileSync(sourcePath, FIXTURE_BYTES);
  const stored = await storeDocumentFile({ sourcePath, storageRoot, documentId: DOCUMENT_ID, filename: FILENAME });

  // Through the REAL persistence API — it validates the record against the contract and writes
  // the audit event, exactly as production registration does after the file chooser. The twelve
  // fields below are the twelve the production handler writes; nothing the detail view might like
  // to see is added, because production rows do not carry it either.
  await persistence.registerDocument(MATTER_ID, {
    id: DOCUMENT_ID,
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

  return { matterId: MATTER_ID, documentId: DOCUMENT_ID, filename: stored.stored_filename, contentHash: stored.content_hash };
}
