// TEST-ONLY seed for the OCR acceptance tests (product plan R3, WI-12).
//
// CONTAINMENT (do not weaken) — the same discipline as documentOpenSeed.ts:
// - Imported ONLY by the env-gated globalThis hook in electron/main.ts (installed iff
//   LAWBAR_OCR_TEST_HOOK === "true"). Never imported by product/renderer/IPC/preload code; inert
//   in a production launch, because main never imports it when the variable is unset.
// - Exposes NO IPC channel, NO preload surface, NO renderer global of its own.
// - Accepts NO arguments: no SQL, no path, no payload. Everything it writes is a FIXED synthetic
//   fixture with no real client content, into main's already-open runtime and store directory.
//
// WHY A PDF, AND WHY A REAL ONE. The OCR ladder's first tier reads a PDF text layer, so a text
// file would prove nothing: the helper would refuse it as unreadable and the test would pass
// without ever exercising the path it exists to check. The bytes below are a hand-written,
// minimal, uncompressed PDF — one page, one line of ASCII text drawn with a standard font — so
// PDFKit finds a real text layer and the seeded document travels the exact route a registered
// original does: stored content-addressed by `storeDocumentFile`, registered through the real
// `registerDocument`, audit event and all.
//
// The text is deliberately long enough to clear the layer-usable threshold, so the seeded document
// exercises TIER 0. A test that wants tier 1 asks for a document with no layer.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getCaseBoxRuntime } from "../caseBoxRuntime.js";
import { storeDocumentFile } from "../documentStorage.js";
import { getActiveTenantId } from "../../security/activeTenant.js";

// Crockford ULIDs (no i, l, o, u), 26 chars, obviously synthetic.
const MATTER_ID = "01j00000000000000000c0m0tt";
const DOCUMENT_ID = "01j00000000000000000c0d0cs";
const FILENAME = "synthetic-text-layer.pdf";
const SEED_AT = "2026-09-12T00:00:00.000Z";
const ACTOR = "local-user";

/** The one line of text the seeded PDF draws. Long enough to be a usable layer, obviously fake. */
export const OCR_SEED_TEXT = "SYNTHETIC TEXT LAYER FOR OCR ACCEPTANCE - NOT A CLIENT DOCUMENT";

/**
 * A minimal one-page PDF with a real, uncompressed text layer. Written by hand rather than
 * generated so the fixture has no toolchain behind it and no dependency to drift: PDFKit reads
 * `page.string` from exactly these bytes.
 */
function buildTextLayerPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export interface OcrSeedResult {
  readonly matterId: string;
  readonly documentId: string;
  readonly filename: string;
  readonly expectedText: string;
}

/** Seed one matter and one born-digital PDF, through the real persistence and storage paths. */
export async function seedOcrFixture(): Promise<OcrSeedResult> {
  const runtime = getCaseBoxRuntime();
  const { persistence } = runtime;
  const tenantId = getActiveTenantId();
  const userDataDir = path.dirname(runtime.dbPath ?? ".");
  const storageRoot = path.join(userDataDir, "case-box-documents");

  await persistence.createMatter({
    id: MATTER_ID,
    tenant_id: tenantId,
    actor_user_id: ACTOR,
    name: "Synthetic matter — OCR acceptance",
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

  mkdirSync(userDataDir, { recursive: true });
  const sourcePath = path.join(userDataDir, "ocr-seed-source.pdf");
  writeFileSync(sourcePath, buildTextLayerPdf(OCR_SEED_TEXT));
  const stored = await storeDocumentFile({ sourcePath, storageRoot, documentId: DOCUMENT_ID, filename: FILENAME });

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

  return { matterId: MATTER_ID, documentId: DOCUMENT_ID, filename: stored.stored_filename, expectedText: OCR_SEED_TEXT };
}
