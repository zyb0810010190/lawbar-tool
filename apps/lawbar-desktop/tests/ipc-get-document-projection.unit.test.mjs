// Response-projection tests for the get-document IPC channel (GET-AUD-1).
//
// Like the list channels, `getDocumentHandler` returned the raw CaseBoxDocument
// entity over IPC, leaking server-authority fields (tenant_id / actor_user_id /
// custody_chain). It must project the single returned document through the
// renderer-safe GET_DOCUMENT_RESPONSE_FIELDS allowlist in the MAIN process. Each
// test asserts that:
//   - the RAW persistence document carries the authority fields, AND
//   - the handler's IPC response value OMITS every authority field, AND
//   - the response still INCLUDES every renderer-consumed (detail-view) field, AND
//   - the null paths (absent / out-of-scope document) are preserved.

import test from "node:test";
import assert from "node:assert/strict";

import { getDocumentHandler } from "../dist/src/caseBox/handlers.js";

const FIXED_ID = "01jz0000000000000000000000";
const DOC_ID = "01jzdoc0000000000000000000";

function makeProvider(overrides) {
  const persistence = {
    getMatter: async (id) =>
      id === FIXED_ID
        ? { id: FIXED_ID, tenant_id: "default-tenant", status: "active" }
        : null,
    getDocument: async () => null,
    ...overrides,
  };
  return () => ({ persistence });
}

// authority fields that MUST be stripped from the get-document response.
const DOC_AUTHORITY = ["tenant_id", "actor_user_id", "custody_chain"];
// fields the document detail view (and list columns) actually read.
const DOC_CONSUMED = [
  "id",
  "filename",
  "doc_type",
  "status",
  "received_at",
  "content_hash",
  "storage_uri",
  "page_count",
  "language",
  "mime_type",
  "byte_size",
];

function rawDocument() {
  return {
    id: DOC_ID,
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    matter_id: FIXED_ID,
    source: "uploaded",
    custody_chain: ["local-user"],
    filename: "complaint.pdf",
    content_hash: "a".repeat(64),
    storage_uri: "file:///app/case-box-documents/x/complaint.pdf",
    ocr_job_id: null,
    submission_hash: null,
    language: "en",
    page_count: 12,
    doc_type: "pleading",
    received_at: "2026-05-27T00:00:00.000Z",
    status: "registered",
    purpose: null,
    mime_type: "application/pdf",
    byte_size: 12345,
  };
}

test("getDocument: raw persistence document includes authority fields", () => {
  const raw = rawDocument();
  for (const f of DOC_AUTHORITY) {
    assert.ok(Object.prototype.hasOwnProperty.call(raw, f), `raw document missing ${f}`);
  }
});

test("getDocument: IPC response omits every authority field, keeps detail-consumed fields", async () => {
  const provide = makeProvider({ getDocument: async () => rawDocument() });
  const result = await getDocumentHandler({ matterId: FIXED_ID, documentId: DOC_ID }, provide);
  assert.equal(result.ok, true);
  assert.notEqual(result.value, null);
  const doc = result.value;
  for (const f of DOC_AUTHORITY) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(doc, f),
      false,
      `authority field ${f} leaked to renderer`,
    );
  }
  for (const f of DOC_CONSUMED) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(doc, f),
      `renderer-consumed field ${f} dropped`,
    );
  }
});

test("getDocument: a document in another matter projects to null (no leak via id)", async () => {
  const provide = makeProvider({
    getDocument: async () => ({ ...rawDocument(), matter_id: "01jzother0000000000000000z" }),
  });
  const result = await getDocumentHandler({ matterId: FIXED_ID, documentId: DOC_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test("getDocument: a document in another tenant is rejected, never projected", async () => {
  const provide = makeProvider({
    getDocument: async () => ({ ...rawDocument(), tenant_id: "tenant-evil" }),
  });
  const result = await getDocumentHandler({ matterId: FIXED_ID, documentId: DOC_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
});

test("getDocument: absent document yields null", async () => {
  const provide = makeProvider({ getDocument: async () => null });
  const result = await getDocumentHandler({ matterId: FIXED_ID, documentId: DOC_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});
