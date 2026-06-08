// Response-projection tests for the three list IPC channels (FACTS-AUD-3).
//
// `renderer/api.ts` strips only the outgoing REQUEST DTO, not the response, so
// the list handlers MUST project every persistence row through a renderer-safe
// allowlist in the MAIN process before returning. Each block asserts that:
//   - the RAW persistence row carries the server-authority fields, AND
//   - the handler's IPC response value OMITS every authority field, AND
//   - the response still INCLUDES every renderer-consumed field, AND
//   - next_cursor passes through unchanged.

import test from "node:test";
import assert from "node:assert/strict";

import {
  listDocumentsHandler,
  listDeadlinesHandler,
  listFactsHandler,
  listAuditEventsHandler,
  createMatterHandler,
  getMatterHandler,
  listMattersHandler,
  archiveMatterHandler,
  registerDocumentHandler,
} from "../dist/src/caseBox/handlers.js";

const FIXED_ID = "01jz0000000000000000000000";
const FIXED_NOW = new Date("2026-05-27T00:00:00.000Z");
const clock = () => FIXED_NOW;
const idFactory = () => FIXED_ID;

function makeProvider(overrides) {
  const persistence = {
    getMatter: async (id) =>
      id === FIXED_ID
        ? { id: FIXED_ID, tenant_id: "default-tenant", status: "active" }
        : null,
    createMatter: async (m) => m,
    listMatters: async (q) => ({ rows: [], next_cursor: null, query: q }),
    archiveMatter: async (id, opts) => ({ id, tenant_id: "default-tenant", status: "archived", opts }),
    listDocuments: async (q) => ({ rows: [], next_cursor: null, query: q }),
    getDocument: async () => null,
    registerDocument: async (_matterId, document) => document,
    listDeadlines: async (q) => ({ rows: [], next_cursor: null, query: q }),
    listFacts: async (q) => ({ rows: [], next_cursor: null, query: q }),
    listAuditEvents: async (q) => ({ rows: [], next_cursor: null, query: q }),
    ...overrides,
  };
  return () => ({ persistence });
}

// ---------- facts ----------

// authority fields that MUST be stripped from the fact response row.
const FACT_AUTHORITY = ["tenant_id", "actor_user_id", "reviewer_actor_user_id"];
// fields the renderer screen actually reads.
const FACT_CONSUMED = [
  "id",
  "statement_text",
  "status",
  "source_type",
  "created_at",
  "as_of_date",
  "extraction_confidence",
];

function rawFactRow() {
  return {
    id: "01jzfact00000000000000000a",
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    matter_id: FIXED_ID,
    statement_text: "Defendant filed answer on 2026-06-01.",
    status: "accepted",
    source_type: "lawyer_authored",
    source_document_id: null,
    source_page_number: null,
    source_excerpt: null,
    source_ocr_job_id: null,
    extractor_name: null,
    extractor_version: null,
    extraction_confidence: 0.92,
    reviewer_actor_user_id: "local-user",
    reviewed_at: "2026-06-01T00:00:00.000Z",
    accepted_at: "2026-06-01T00:00:00.000Z",
    rejected_at: null,
    rejection_reason: null,
    supersedes_fact_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    purpose: null,
    as_of_date: "2026-06-01",
  };
}

test("listFacts: raw persistence row includes authority fields", () => {
  const raw = rawFactRow();
  for (const f of FACT_AUTHORITY) {
    assert.ok(Object.prototype.hasOwnProperty.call(raw, f), `raw row missing ${f}`);
  }
});

test("listFacts: IPC response omits every authority field on EVERY row, keeps renderer-consumed fields", async () => {
  // Two rows so a regression that only projects rows[0] is caught.
  const provide = makeProvider({
    listFacts: async () => ({
      rows: [rawFactRow(), { ...rawFactRow(), id: "01jzfact00000000000000000b" }],
      next_cursor: "next-cur",
    }),
  });
  const result = await listFactsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 2);
  for (const row of result.value.rows) {
    for (const f of FACT_AUTHORITY) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(row, f),
        false,
        `authority field ${f} leaked to renderer`,
      );
    }
    for (const f of FACT_CONSUMED) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(row, f),
        `renderer-consumed field ${f} dropped`,
      );
    }
  }
  // next_cursor passes through unchanged.
  assert.equal(result.value.next_cursor, "next-cur");
});

// ---------- documents ----------

const DOC_AUTHORITY = ["tenant_id", "actor_user_id", "custody_chain"];
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

function rawDocumentRow() {
  return {
    id: "01jzdoc0000000000000000000",
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

test("listDocuments: raw persistence row includes authority fields", () => {
  const raw = rawDocumentRow();
  for (const f of DOC_AUTHORITY) {
    assert.ok(Object.prototype.hasOwnProperty.call(raw, f), `raw row missing ${f}`);
  }
});

test("listDocuments: IPC response omits every authority field on EVERY row, keeps renderer-consumed fields", async () => {
  const provide = makeProvider({
    listDocuments: async () => ({
      rows: [rawDocumentRow(), { ...rawDocumentRow(), id: "01jzdoc0000000000000000001" }],
      next_cursor: "doc-cur",
    }),
  });
  const result = await listDocumentsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 2);
  for (const row of result.value.rows) {
    for (const f of DOC_AUTHORITY) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(row, f),
        false,
        `authority field ${f} leaked to renderer`,
      );
    }
    for (const f of DOC_CONSUMED) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(row, f),
        `renderer-consumed field ${f} dropped`,
      );
    }
  }
  assert.equal(result.value.next_cursor, "doc-cur");
});

// ---------- deadlines ----------

const DEADLINE_AUTHORITY = ["tenant_id", "actor_user_id"];
const DEADLINE_CONSUMED = [
  "id",
  "kind",
  "due_at",
  "status",
  "owner_user_id",
  "source_rule_citation",
];

function rawDeadlineRow() {
  return {
    id: "01jzdl00000000000000000000",
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    matter_id: FIXED_ID,
    kind: "filing",
    source_rule_citation: "FRCP 12(a)",
    due_at: "2026-06-30T00:00:00.000Z",
    owner_user_id: "local-user",
    status: "pending",
    met_at: null,
    previous_status: null,
    transition_reason: null,
  };
}

test("listDeadlines: raw persistence row includes authority fields", () => {
  const raw = rawDeadlineRow();
  for (const f of DEADLINE_AUTHORITY) {
    assert.ok(Object.prototype.hasOwnProperty.call(raw, f), `raw row missing ${f}`);
  }
});

test("listDeadlines: IPC response omits every authority field on EVERY row, keeps renderer-consumed fields", async () => {
  const provide = makeProvider({
    listDeadlines: async () => ({
      rows: [rawDeadlineRow(), { ...rawDeadlineRow(), id: "01jzdl00000000000000000001" }],
      next_cursor: "dl-cur",
    }),
  });
  const result = await listDeadlinesHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 2);
  for (const row of result.value.rows) {
    for (const f of DEADLINE_AUTHORITY) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(row, f),
        false,
        `authority field ${f} leaked to renderer`,
      );
    }
    for (const f of DEADLINE_CONSUMED) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(row, f),
        `renderer-consumed field ${f} dropped`,
      );
    }
  }
  assert.equal(result.value.next_cursor, "dl-cur");
});

// ---------- audit events (AUDIT-AUD-1) ----------

// authority/internal fields that MUST be stripped from the audit response row.
const AUDIT_AUTHORITY = ["tenant_id", "actor_user_id", "id", "matter_id"];
// fields the renderer audit panel actually reads (viewMatterAudit.ts renderAuditEventRow).
// event_kind (v2, ADR audit-event-kind-preservation) is the humanized-label source — display
// metadata that MUST cross the boundary. audit_schema_version is internal and must NOT be projected.
const AUDIT_CONSUMED = ["timestamp", "action", "entity_type", "entity_id", "reason", "event_kind"];

function rawAuditRow() {
  return {
    id: "01jzaud00000000000000000a",
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    matter_id: FIXED_ID,
    action: "update",
    entity_type: "deadline",
    entity_id: "01jzdl00000000000000000000",
    before_state_hash: null,
    after_state_hash: "sha256:abc",
    prev_event_hash: null,
    timestamp: "2026-06-07T10:30:00.000Z",
    reason: "missed -> met: clerk error",
    // v2 fields: event_kind is projected (display); audit_schema_version is internal (must NOT leak).
    event_kind: "DEADLINE_MET",
    audit_schema_version: 2,
    // open-index extra (CaseBoxAuditEvent has `[k: string]: unknown`) — must NOT leak.
    secret_extra: "should-not-cross-the-ipc-boundary",
  };
}

test("listAuditEvents: raw persistence row includes authority + open-index fields", () => {
  const raw = rawAuditRow();
  for (const f of [...AUDIT_AUTHORITY, "secret_extra"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(raw, f), `raw row missing ${f}`);
  }
});

test("listAuditEvents: IPC response omits authority + open-index fields on EVERY row, keeps consumed + cursor", async () => {
  const provide = makeProvider({
    listAuditEvents: async () => ({
      rows: [rawAuditRow(), { ...rawAuditRow(), id: "01jzaud00000000000000000b" }],
      next_cursor: "aud-cur",
    }),
  });
  const result = await listAuditEventsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 2);
  for (const row of result.value.rows) {
    // authority/open-index fields + the INTERNAL audit_schema_version must all be stripped.
    for (const f of [...AUDIT_AUTHORITY, "secret_extra", "audit_schema_version"]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(row, f),
        false,
        `authority/open-index/internal field ${f} leaked to renderer`,
      );
    }
    for (const f of AUDIT_CONSUMED) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(row, f),
        `renderer-consumed field ${f} dropped`,
      );
    }
    // the projected event_kind value crosses intact.
    assert.equal(row.event_kind, "DEADLINE_MET");
  }
  assert.equal(result.value.next_cursor, "aud-cur");
});

// ---------- matter create / get / list / archive (MATTER-AUD-1) ----------

const MATTER_AUTHORITY = ["tenant_id", "actor_user_id"];
const MATTER_CONSUMED = ["id", "name", "matter_type", "status", "created_at", "jurisdiction", "parties"];

function validMatterDto() {
  return {
    name: "PoC synthetic matter",
    matter_type: "litigation",
    jurisdiction: { value: "us-fed", locked: false },
    parties: [{ role: "client", display_name: "Acme Demonstration LLC", party_kind: "organization" }],
    confidentiality_class: "normal",
  };
}

// A raw persistence matter carrying authority + an open-index extra that must be stripped.
function rawMatterRow(id = FIXED_ID) {
  return {
    id,
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    name: "PoC synthetic matter",
    matter_type: "litigation",
    jurisdiction: { value: "us-fed", locked: false },
    parties: [{ role: "client", display_name: "Acme", party_kind: "organization" }],
    confidentiality_class: "normal",
    status: "active",
    created_at: FIXED_NOW.toISOString(),
    secret_extra: "should-not-cross-the-ipc-boundary",
  };
}

function assertMatterProjected(value) {
  for (const f of [...MATTER_AUTHORITY, "secret_extra"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(value, f), false, `matter authority/open-index field ${f} leaked`);
  }
  for (const f of MATTER_CONSUMED) {
    assert.ok(Object.prototype.hasOwnProperty.call(value, f), `matter consumed field ${f} dropped`);
  }
}

test("createMatter: IPC response omits authority + open-index fields, keeps consumed", async () => {
  const provide = makeProvider({ createMatter: async (m) => ({ ...m, secret_extra: "x" }) });
  const result = await createMatterHandler(validMatterDto(), provide, clock, idFactory);
  assert.equal(result.ok, true);
  assertMatterProjected(result.value);
});

test("getMatter: raw row has authority; IPC response omits them, keeps consumed", async () => {
  const raw = rawMatterRow();
  assert.ok(Object.prototype.hasOwnProperty.call(raw, "tenant_id"));
  const provide = makeProvider({ getMatter: async () => raw });
  const result = await getMatterHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assertMatterProjected(result.value);
});

test("getMatter: null (absent) path preserved (value:null, not projected)", async () => {
  const provide = makeProvider({ getMatter: async () => null });
  const result = await getMatterHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test("listMatters: every row omits authority + open-index, keeps consumed, cursor preserved", async () => {
  const provide = makeProvider({
    listMatters: async () => ({
      rows: [rawMatterRow("01jz0000000000000000000001"), rawMatterRow("01jz0000000000000000000002")],
      next_cursor: "m-cur",
    }),
  });
  const result = await listMattersHandler({}, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 2);
  for (const row of result.value.rows) assertMatterProjected(row);
  assert.equal(result.value.next_cursor, "m-cur");
});

test("archiveMatter: IPC response omits authority + open-index, keeps consumed", async () => {
  const provide = makeProvider({
    archiveMatter: async () => rawMatterRow(),
  });
  const result = await archiveMatterHandler({ matterId: FIXED_ID, reason: "duplicate filing" }, provide);
  assert.equal(result.ok, true);
  assertMatterProjected(result.value);
});

// ---------- document register (REGDOC-AUD-1) ----------

const REGDOC_AUTHORITY = ["tenant_id", "actor_user_id", "custody_chain"];
const REGDOC_CONSUMED = ["id", "filename", "doc_type", "status", "matter_id"];

function makeRegisterDeps() {
  return {
    chooseFile: async () => ({ sourcePath: "/tmp/fake/complaint.pdf", filename: "complaint.pdf" }),
    storeFile: async ({ documentId, filename }) => ({
      content_hash: "a".repeat(64),
      storage_uri: "file:///app/case-box-documents/" + documentId + "/" + filename,
      byte_size: 123,
      stored_filename: filename,
    }),
    now: () => FIXED_NOW,
    idFactory: () => "01jzaaaaaaaaaaaaaaaaaaaaaa",
  };
}

test("registerDocument: IPC response omits authority (incl. custody_chain) + open-index, keeps consumed", async () => {
  const provide = makeProvider({
    // echo the handler-built document (it injects tenant_id/actor_user_id/custody_chain) + an open-index extra
    registerDocument: async (_matterId, document) => ({ ...document, custody_chain: [{ actor: "x" }], secret_extra: "x" }),
  });
  const result = await registerDocumentHandler({ matterId: FIXED_ID, doc_type: "pleading" }, provide, makeRegisterDeps());
  assert.equal(result.ok, true);
  for (const f of [...REGDOC_AUTHORITY, "secret_extra"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.value, f), false, `register authority/open-index field ${f} leaked`);
  }
  for (const f of REGDOC_CONSUMED) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.value, f), `register consumed field ${f} dropped`);
  }
});

// ---------- cross-cutting: empty page projects to empty rows, cursor preserved ----------

test("projection: empty page yields empty rows and preserves null cursor", async () => {
  const provide = makeProvider();
  for (const handler of [listFactsHandler, listDocumentsHandler, listDeadlinesHandler]) {
    const result = await handler({ matterId: FIXED_ID }, provide);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.rows, []);
    assert.equal(result.value.next_cursor, null);
  }
});
