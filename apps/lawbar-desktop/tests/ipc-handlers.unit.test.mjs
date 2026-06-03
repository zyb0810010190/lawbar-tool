import test from "node:test";
import assert from "node:assert/strict";

import {
  createMatterHandler,
  getMatterHandler,
  listMattersHandler,
  archiveMatterHandler,
  chainHeadHandler,
  listAuditEventsHandler,
  listDocumentsHandler,
  getDocumentHandler,
  registerDocumentHandler,
  listDeadlinesHandler,
  CHANNEL,
} from "../dist/src/caseBox/handlers.js";
import { CaseBoxPersistenceError } from "case-box-persistence";

const FIXED_NOW = new Date("2026-05-27T00:00:00.000Z");
const FIXED_ID = "01jz0000000000000000000000";

function clock() {
  return FIXED_NOW;
}

function idFactory() {
  return FIXED_ID;
}

function makeProvider(overrides) {
  const persistence = {
    createMatter: async (m) => m,
    getMatter: async (id) =>
      id === FIXED_ID
        ? { id: FIXED_ID, tenant_id: "default-tenant", status: "active" }
        : null,
    listMatters: async (q) => ({ rows: [], next_cursor: null, query: q }),
    archiveMatter: async (id, opts) => ({
      id,
      tenant_id: "default-tenant",
      status: "archived",
      archived_at: FIXED_NOW.toISOString(),
      opts,
    }),
    getAuditChainHead: async (id) => ({ headHash: null, lastEventId: null, count: 0, _matterId: id }),
    listAuditEvents: async (q) => ({ rows: [], next_cursor: null, query: q }),
    listDocuments: async (q) => ({ rows: [], next_cursor: null, query: q }),
    getDocument: async () => null,
    registerDocument: async (_matterId, document) => document,
    listDeadlines: async (q) => ({ rows: [], next_cursor: null, query: q }),
    ...overrides,
  };
  return () => ({ persistence });
}

function validDto() {
  return {
    name: "PoC synthetic matter",
    matter_type: "litigation",
    jurisdiction: { value: "us-fed", locked: false },
    parties: [
      { role: "client", display_name: "Acme Demonstration LLC", party_kind: "organization" },
    ],
    confidentiality_class: "normal",
  };
}

test("channel names match contract pattern casebox:<scope>:<op>", () => {
  assert.equal(CHANNEL.matterCreate, "casebox:matter:create");
  assert.equal(CHANNEL.matterGet, "casebox:matter:get");
  assert.equal(CHANNEL.matterList, "casebox:matter:list");
  assert.equal(CHANNEL.matterArchive, "casebox:matter:archive");
  assert.equal(CHANNEL.auditChainHead, "casebox:audit:chainHead");
  assert.equal(CHANNEL.auditListEvents, "casebox:audit:listEvents");
  assert.equal(CHANNEL.documentList, "casebox:document:list");
  assert.equal(CHANNEL.documentGet, "casebox:document:get");
  assert.equal(CHANNEL.documentRegister, "casebox:document:register");
  assert.equal(CHANNEL.deadlineList, "casebox:deadline:list");
});

// ---------- createMatter ----------

test("createMatter happy path injects server-authority fields + validates + returns ok", async () => {
  let received;
  const provide = makeProvider({
    createMatter: async (m) => {
      received = m;
      return m;
    },
  });
  const result = await createMatterHandler(validDto(), provide, clock, idFactory);
  assert.equal(result.ok, true);
  assert.equal(received.id, FIXED_ID);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.actor_user_id, "local-user");
  assert.equal(received.status, "active");
  assert.equal(received.external_ocr_authorized, false);
  assert.equal(received.sync_grant_present, false);
  assert.equal(received.llm_extraction_opt_in, false);
  assert.equal(received.created_at, FIXED_NOW.toISOString());
});

test("createMatter shape guard: non-object → invalid_payload", async () => {
  const provide = makeProvider();
  for (const bad of [null, undefined, [], "x", 42, true]) {
    const result = await createMatterHandler(bad, provide, clock, idFactory);
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, "case_box_persistence_error");
    assert.equal(result.error.code, "invalid_payload");
  }
});

test("createMatter shape guard: non-default prototype → invalid_payload", async () => {
  const provide = makeProvider();
  const proto = Object.create(null);
  proto.name = "x";
  const result = await createMatterHandler(proto, provide, clock, idFactory);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("createMatter forbidden-field: tenant_id present → invalid_payload + schemaPath", async () => {
  const provide = makeProvider();
  const dto = { ...validDto(), tenant_id: "evil-tenant" };
  const result = await createMatterHandler(dto, provide, clock, idFactory);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("createMatter forbidden-field: external_ocr_authorized true → invalid_payload", async () => {
  const provide = makeProvider();
  const dto = { ...validDto(), external_ocr_authorized: true };
  const result = await createMatterHandler(dto, provide, clock, idFactory);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "external_ocr_authorized");
});

test("createMatter schema-violation: invalid matter_type → invalid_payload with details", async () => {
  const provide = makeProvider();
  const dto = { ...validDto(), matter_type: "not-a-real-type" };
  const result = await createMatterHandler(dto, provide, clock, idFactory);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.ok(result.error.details?.schemaPath !== undefined);
  assert.ok(result.error.details?.keyword !== undefined);
});

test("createMatter persistence error: code preserved; raw message NEVER crosses wire", async () => {
  const raw = "id 01jzSECRET_TENANT_ID already exists in shared table foo";
  const errorCalls = [];
  const origError = console.error;
  console.error = (...args) => errorCalls.push(args);
  try {
    const provide = makeProvider({
      createMatter: async () => {
        throw new CaseBoxPersistenceError("duplicate_id", raw);
      },
    });
    const result = await createMatterHandler(validDto(), provide, clock, idFactory);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "duplicate_id");
    // SAFE message; renderer NEVER sees raw err.message.
    assert.equal(result.error.message, "duplicate identifier");
    assert.equal(result.error.message.includes("SECRET"), false);
    // Raw was logged main-side for the audit trail.
    assert.ok(errorCalls.length >= 1);
    const flat = errorCalls.flat().join(" ");
    assert.match(flat, /SECRET_TENANT_ID/);
  } finally {
    console.error = origError;
  }
});

test("createMatter unknown throw → opaque not_implemented; main-side log called", async () => {
  const errorCalls = [];
  const origError = console.error;
  console.error = (...args) => errorCalls.push(args);
  try {
    const provide = makeProvider({
      createMatter: async () => {
        throw new Error("internal SQL detail leaking secret");
      },
    });
    const result = await createMatterHandler(validDto(), provide, clock, idFactory);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_implemented");
    assert.equal(result.error.message, "internal error (see main log)");
    assert.equal(errorCalls.length, 1);
    assert.match(String(errorCalls[0][0]), /casebox-ipc-handler:casebox:matter:create/);
  } finally {
    console.error = origError;
  }
});

// ---------- getMatter ----------

test("getMatter happy path returns value", async () => {
  const provide = makeProvider();
  const result = await getMatterHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.id, FIXED_ID);
  assert.equal(result.value.tenant_id, "default-tenant");
});

test("getMatter empty matterId → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await getMatterHandler({ matterId: "" }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("getMatter missing matterId → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await getMatterHandler({}, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("getMatter null value preserved", async () => {
  const provide = makeProvider({ getMatter: async () => null });
  const result = await getMatterHandler({ matterId: "01jz9999999999999999999999" }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test("getMatter forbidden field tenant_id in DTO → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await getMatterHandler({ matterId: FIXED_ID, tenant_id: "evil" }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("getMatter unknown field → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await getMatterHandler({ matterId: FIXED_ID, bogus: 1 }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("getMatter tenant mismatch → code tenant_mismatch; safe message; no raw values", async () => {
  const provide = makeProvider({
    getMatter: async () => ({
      id: FIXED_ID,
      tenant_id: "other-tenant",
      status: "active",
    }),
  });
  const result = await getMatterHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(result.error.message, "tenant mismatch");
  assert.equal(result.error.message.includes("other-tenant"), false);
  assert.equal(result.error.message.includes(FIXED_ID), false);
});

// ---------- listMatters ----------

test("listMatters injects tenant_id; renderer-supplied tenant_id rejected", async () => {
  let received;
  const provide = makeProvider({
    listMatters: async (q) => {
      received = q;
      return { rows: [], next_cursor: null };
    },
  });
  const result = await listMattersHandler({ status: "active", limit: 10 }, provide);
  assert.equal(result.ok, true);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.status, "active");
  assert.equal(received.limit, 10);
});

test("listMatters tenant_id in DTO → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await listMattersHandler({ tenant_id: "other" }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("listMatters unknown DTO field → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await listMattersHandler({ bogus: 1 }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listMatters limit > 200 capped, < 1 rejected", async () => {
  let received;
  const provide = makeProvider({
    listMatters: async (q) => {
      received = q;
      return { rows: [], next_cursor: null };
    },
  });
  const r1 = await listMattersHandler({ limit: 9999 }, provide);
  assert.equal(r1.ok, true);
  assert.equal(received.limit, 200);

  const r2 = await listMattersHandler({ limit: 0 }, provide);
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, "invalid_payload");

  const r3 = await listMattersHandler({ limit: 1.5 }, provide);
  assert.equal(r3.ok, false);
  assert.equal(r3.error.code, "invalid_payload");
});

test("listMatters cursor > 512 chars → invalid_payload", async () => {
  const provide = makeProvider();
  const longCursor = "x".repeat(513);
  const result = await listMattersHandler({ cursor: longCursor }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listMatters cursor value never logged in envelope", async () => {
  const provide = makeProvider();
  const sensitive = "y".repeat(513);
  const result = await listMattersHandler({ cursor: sensitive }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.message.includes(sensitive), false);
});

// ---------- archiveMatter ----------

test("archiveMatter injects actor_user_id; reason required", async () => {
  let received;
  const provide = makeProvider({
    archiveMatter: async (id, opts) => {
      received = { id, opts };
      return { id, archived_at: FIXED_NOW.toISOString() };
    },
  });
  const result = await archiveMatterHandler(
    { matterId: FIXED_ID, reason: "client withdrew" },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(received.id, FIXED_ID);
  assert.equal(received.opts.actor_user_id, "local-user");
  assert.equal(received.opts.reason, "client withdrew");
});

test("archiveMatter actor_user_id in DTO → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await archiveMatterHandler(
    { matterId: FIXED_ID, reason: "x", actor_user_id: "evil" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "actor_user_id");
});

test("archiveMatter tenant_id in DTO → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await archiveMatterHandler(
    { matterId: FIXED_ID, reason: "x", tenant_id: "evil" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("archiveMatter absent matter → unknown_matter; archiveMatter not called", async () => {
  let archiveCalled = false;
  const provide = makeProvider({
    getMatter: async () => null,
    archiveMatter: async () => {
      archiveCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await archiveMatterHandler(
    { matterId: "01jz9999999999999999999999", reason: "x" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(result.error.message, "unknown matter");
  assert.equal(archiveCalled, false);
});

test("archiveMatter tenant mismatch → tenant_mismatch; archiveMatter not called", async () => {
  let archiveCalled = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    archiveMatter: async () => {
      archiveCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await archiveMatterHandler(
    { matterId: FIXED_ID, reason: "x" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(archiveCalled, false);
});

test("archiveMatter missing reason → invalid_payload", async () => {
  const provide = makeProvider();
  const r1 = await archiveMatterHandler({ matterId: FIXED_ID }, provide);
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, "invalid_payload");

  const r2 = await archiveMatterHandler({ matterId: FIXED_ID, reason: "   " }, provide);
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, "invalid_payload");
});

test("archiveMatter illegal_transition: code preserved; safe message; raw stays in main log", async () => {
  const raw = "matter 01jzSECRET already archived at 2026-05-27T00:00:00Z";
  const errorCalls = [];
  const origError = console.error;
  console.error = (...args) => errorCalls.push(args);
  try {
    const provide = makeProvider({
      archiveMatter: async () => {
        throw new CaseBoxPersistenceError("illegal_transition", raw);
      },
    });
    const result = await archiveMatterHandler(
      { matterId: FIXED_ID, reason: "x" },
      provide,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "illegal_transition");
    assert.equal(result.error.message, "illegal state transition");
    assert.equal(result.error.message.includes("SECRET"), false);
    assert.ok(errorCalls.flat().join(" ").includes("SECRET"));
  } finally {
    console.error = origError;
  }
});

// ---------- chainHead ----------

test("chainHead happy path returns AuditChainHead", async () => {
  const provide = makeProvider();
  const result = await chainHeadHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.count, 0);
  assert.equal(result.value.headHash, null);
});

test("chainHead empty matterId → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await chainHeadHandler({ matterId: "" }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("chainHead forbidden field tenant_id in DTO → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await chainHeadHandler(
    { matterId: FIXED_ID, tenant_id: "evil" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("chainHead unknown field → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await chainHeadHandler(
    { matterId: FIXED_ID, bogus: 1 },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("chainHead absent matter → unknown_matter; getAuditChainHead not called", async () => {
  let chainCalled = false;
  const provide = makeProvider({
    getMatter: async () => null,
    getAuditChainHead: async () => {
      chainCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await chainHeadHandler(
    { matterId: "01jz0000000000000000000099" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(chainCalled, false);
});

test("chainHead tenant mismatch → tenant_mismatch; getAuditChainHead not called", async () => {
  let chainCalled = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    getAuditChainHead: async () => {
      chainCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await chainHeadHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(chainCalled, false);
});

// ---------- listAuditEvents ----------

test("listAuditEvents happy path returns page + injects tenant_id and matter_id", async () => {
  let received;
  const provide = makeProvider({
    listAuditEvents: async (q) => {
      received = q;
      return {
        rows: [
          {
            timestamp: "2026-05-27T00:00:00.000Z",
            action: "matter.created",
            entity_type: "matter",
            entity_id: FIXED_ID,
            after_state_hash: "h1",
          },
        ],
        next_cursor: null,
      };
    },
  });
  const result = await listAuditEventsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 1);
  assert.equal(result.value.next_cursor, null);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.matter_id, FIXED_ID);
});

test("listAuditEvents passes limit + cursor through to persistence", async () => {
  let received;
  const provide = makeProvider({
    listAuditEvents: async (q) => {
      received = q;
      return { rows: [], next_cursor: "next" };
    },
  });
  const result = await listAuditEventsHandler(
    { matterId: FIXED_ID, limit: 5, cursor: "c1" },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(received.limit, 5);
  assert.equal(received.cursor, "c1");
});

test("listAuditEvents empty matterId → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await listAuditEventsHandler({ matterId: "" }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listAuditEvents forbidden field tenant_id in DTO → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await listAuditEventsHandler(
    { matterId: FIXED_ID, tenant_id: "evil" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("listAuditEvents unknown field → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await listAuditEventsHandler(
    { matterId: FIXED_ID, bogus: 1 },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listAuditEvents non-integer limit → invalid_payload", async () => {
  const provide = makeProvider();
  const result = await listAuditEventsHandler(
    { matterId: FIXED_ID, limit: 1.5 },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listAuditEvents absent matter → unknown_matter; listAuditEvents not called", async () => {
  let listCalled = false;
  const provide = makeProvider({
    getMatter: async () => null,
    listAuditEvents: async () => {
      listCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await listAuditEventsHandler(
    { matterId: "01jz0000000000000000000099" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(listCalled, false);
});

test("listAuditEvents tenant mismatch → tenant_mismatch; listAuditEvents not called", async () => {
  let listCalled = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    listAuditEvents: async () => {
      listCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await listAuditEventsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(listCalled, false);
});

// ---------- listDocuments ----------

const DOC_ID = "01jzdoc0000000000000000000";

test("listDocuments happy path returns page + injects tenant_id and matter_id", async () => {
  let received;
  const provide = makeProvider({
    listDocuments: async (q) => {
      received = q;
      return {
        rows: [
          {
            id: DOC_ID,
            filename: "complaint.pdf",
            doc_type: "pleading",
            status: "registered",
            received_at: "2026-05-27T00:00:00.000Z",
          },
        ],
        next_cursor: null,
      };
    },
  });
  const result = await listDocumentsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 1);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.matter_id, FIXED_ID);
});

test("listDocuments passes limit + cursor through", async () => {
  let received;
  const provide = makeProvider({
    listDocuments: async (q) => {
      received = q;
      return { rows: [], next_cursor: "next" };
    },
  });
  const result = await listDocumentsHandler(
    { matterId: FIXED_ID, limit: 7, cursor: "c1" },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(received.limit, 7);
  assert.equal(received.cursor, "c1");
});

test("listDocuments empty matterId → invalid_payload", async () => {
  const result = await listDocumentsHandler({ matterId: "" }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listDocuments forbidden field tenant_id → invalid_payload", async () => {
  const result = await listDocumentsHandler(
    { matterId: FIXED_ID, tenant_id: "evil" },
    makeProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("listDocuments unknown field → invalid_payload", async () => {
  const result = await listDocumentsHandler(
    { matterId: FIXED_ID, bogus: 1 },
    makeProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listDocuments absent matter → unknown_matter; listDocuments not called", async () => {
  let listCalled = false;
  const provide = makeProvider({
    getMatter: async () => null,
    listDocuments: async () => {
      listCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await listDocumentsHandler(
    { matterId: "01jz0000000000000000000099" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(listCalled, false);
});

test("listDocuments tenant mismatch → tenant_mismatch; listDocuments not called", async () => {
  let listCalled = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    listDocuments: async () => {
      listCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await listDocumentsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(listCalled, false);
});

// ---------- getDocument ----------

test("getDocument happy path returns the in-scope document", async () => {
  const provide = makeProvider({
    getDocument: async (id) => ({
      id,
      tenant_id: "default-tenant",
      matter_id: FIXED_ID,
      filename: "complaint.pdf",
      doc_type: "pleading",
      status: "registered",
      received_at: "2026-05-27T00:00:00.000Z",
    }),
  });
  const result = await getDocumentHandler(
    { matterId: FIXED_ID, documentId: DOC_ID },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.id, DOC_ID);
  assert.equal(result.value.matter_id, FIXED_ID);
});

test("getDocument null when persistence returns null", async () => {
  const provide = makeProvider({ getDocument: async () => null });
  const result = await getDocumentHandler(
    { matterId: FIXED_ID, documentId: DOC_ID },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test("getDocument doc from another matter → value null (scoped not-found)", async () => {
  const provide = makeProvider({
    getDocument: async (id) => ({
      id,
      tenant_id: "default-tenant",
      matter_id: "01jzothermatter0000000000x",
      filename: "x.pdf",
    }),
  });
  const result = await getDocumentHandler(
    { matterId: FIXED_ID, documentId: DOC_ID },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test("getDocument doc from another tenant → tenant_mismatch", async () => {
  const provide = makeProvider({
    getDocument: async (id) => ({
      id,
      tenant_id: "other-tenant",
      matter_id: FIXED_ID,
      filename: "x.pdf",
    }),
  });
  const result = await getDocumentHandler(
    { matterId: FIXED_ID, documentId: DOC_ID },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
});

test("getDocument missing documentId → invalid_payload", async () => {
  const result = await getDocumentHandler({ matterId: FIXED_ID }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("getDocument forbidden field tenant_id → invalid_payload", async () => {
  const result = await getDocumentHandler(
    { matterId: FIXED_ID, documentId: DOC_ID, tenant_id: "evil" },
    makeProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("getDocument unknown field → invalid_payload", async () => {
  const result = await getDocumentHandler(
    { matterId: FIXED_ID, documentId: DOC_ID, bogus: 1 },
    makeProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("getDocument absent matter → unknown_matter; getDocument not called", async () => {
  let docCalled = false;
  const provide = makeProvider({
    getMatter: async () => null,
    getDocument: async () => {
      docCalled = true;
      throw new Error("should not have been called");
    },
  });
  const result = await getDocumentHandler(
    { matterId: "01jz0000000000000000000099", documentId: DOC_ID },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(docCalled, false);
});

// ---------- registerDocument ----------

const REG_DOC_ID = "01jzaaaaaaaaaaaaaaaaaaaaaa"; // valid lowercase ULID chars

function makeRegisterDeps(overrides = {}) {
  return {
    chooseFile:
      "chooseFile" in overrides
        ? overrides.chooseFile
        : async () => ({ sourcePath: "/tmp/fake/complaint.pdf", filename: "complaint.pdf" }),
    storeFile:
      overrides.storeFile ??
      (async ({ documentId, filename }) => ({
        content_hash: "a".repeat(64),
        storage_uri: "file:///app/case-box-documents/" + documentId + "/" + filename,
        byte_size: 123,
        stored_filename: filename,
      })),
    now: () => FIXED_NOW,
    idFactory: () => REG_DOC_ID,
  };
}

test("registerDocument happy path: builds full document, validates, persists, returns it", async () => {
  let registeredWith;
  const provide = makeProvider({
    registerDocument: async (matterId, document) => {
      registeredWith = { matterId, document };
      return document;
    },
  });
  const result = await registerDocumentHandler(
    { matterId: FIXED_ID, doc_type: "pleading" },
    provide,
    makeRegisterDeps(),
  );
  assert.equal(result.ok, true);
  assert.equal(registeredWith.matterId, FIXED_ID);
  const d = registeredWith.document;
  assert.equal(d.id, REG_DOC_ID);
  assert.equal(d.tenant_id, "default-tenant");
  assert.equal(d.actor_user_id, "local-user");
  assert.equal(d.matter_id, FIXED_ID);
  assert.equal(d.source, "uploaded");
  assert.equal(d.status, "registered");
  assert.equal(d.doc_type, "pleading");
  assert.equal(d.filename, "complaint.pdf");
  assert.equal(d.content_hash, "a".repeat(64));
  assert.equal(d.storage_uri, "file:///app/case-box-documents/" + REG_DOC_ID + "/complaint.pdf");
  assert.equal(result.value.id, REG_DOC_ID);
});

test("registerDocument cancelled: chooseFile null → ok+null; storeFile + registerDocument NOT called", async () => {
  let stored = false;
  let registered = false;
  const provide = makeProvider({
    registerDocument: async () => {
      registered = true;
      throw new Error("should not register");
    },
  });
  const deps = makeRegisterDeps({
    chooseFile: async () => null,
    storeFile: async () => {
      stored = true;
      throw new Error("should not store");
    },
  });
  const result = await registerDocumentHandler({ matterId: FIXED_ID, doc_type: "other" }, provide, deps);
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
  assert.equal(stored, false);
  assert.equal(registered, false);
});

test("registerDocument forbidden field tenant_id → invalid_payload", async () => {
  const result = await registerDocumentHandler(
    { matterId: FIXED_ID, doc_type: "other", tenant_id: "evil" },
    makeProvider(),
    makeRegisterDeps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("registerDocument forbidden field content_hash → invalid_payload", async () => {
  const result = await registerDocumentHandler(
    { matterId: FIXED_ID, doc_type: "other", content_hash: "x" },
    makeProvider(),
    makeRegisterDeps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "content_hash");
});

test("registerDocument unknown field → invalid_payload", async () => {
  const result = await registerDocumentHandler(
    { matterId: FIXED_ID, doc_type: "other", bogus: 1 },
    makeProvider(),
    makeRegisterDeps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("registerDocument invalid doc_type → invalid_payload", async () => {
  const result = await registerDocumentHandler(
    { matterId: FIXED_ID, doc_type: "not-a-type" },
    makeProvider(),
    makeRegisterDeps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("registerDocument empty matterId → invalid_payload", async () => {
  const result = await registerDocumentHandler(
    { matterId: "", doc_type: "other" },
    makeProvider(),
    makeRegisterDeps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("registerDocument absent matter → unknown_matter; chooseFile NOT called", async () => {
  let chooseCalled = false;
  const provide = makeProvider({ getMatter: async () => null });
  const deps = makeRegisterDeps({
    chooseFile: async () => {
      chooseCalled = true;
      throw new Error("dialog should not open for an invalid matter");
    },
  });
  const result = await registerDocumentHandler(
    { matterId: "01jz0000000000000000000099", doc_type: "other" },
    provide,
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(chooseCalled, false);
});

test("registerDocument tenant mismatch → tenant_mismatch; chooseFile NOT called", async () => {
  let chooseCalled = false;
  const provide = makeProvider({ getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }) });
  const deps = makeRegisterDeps({
    chooseFile: async () => {
      chooseCalled = true;
      throw new Error("dialog should not open");
    },
  });
  const result = await registerDocumentHandler({ matterId: FIXED_ID, doc_type: "other" }, provide, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(chooseCalled, false);
});

test("registerDocument schema violation (negative byte_size from storeFile) → invalid_payload; registerDocument NOT called", async () => {
  let registered = false;
  const provide = makeProvider({
    registerDocument: async () => {
      registered = true;
      throw new Error("should not register an invalid doc");
    },
  });
  const deps = makeRegisterDeps({
    storeFile: async ({ filename }) => ({
      content_hash: "a".repeat(64),
      storage_uri: "file:///x",
      byte_size: -5, // violates schema byte_size minimum: 0
      stored_filename: filename,
    }),
  });
  const result = await registerDocumentHandler({ matterId: FIXED_ID, doc_type: "other" }, provide, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(registered, false);
});

// ---------- listDeadlines ----------

test("listDeadlines happy path returns page + injects tenant_id and matter_id", async () => {
  let received;
  const provide = makeProvider({
    listDeadlines: async (q) => {
      received = q;
      return {
        rows: [
          {
            id: "01jzdl00000000000000000000",
            kind: "filing",
            due_at: "2026-06-30T00:00:00.000Z",
            owner_user_id: "local-user",
            status: "pending",
          },
        ],
        next_cursor: null,
      };
    },
  });
  const result = await listDeadlinesHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 1);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.matter_id, FIXED_ID);
});

test("listDeadlines passes limit + cursor through", async () => {
  let received;
  const provide = makeProvider({
    listDeadlines: async (q) => {
      received = q;
      return { rows: [], next_cursor: "next" };
    },
  });
  const result = await listDeadlinesHandler({ matterId: FIXED_ID, limit: 9, cursor: "c1" }, provide);
  assert.equal(result.ok, true);
  assert.equal(received.limit, 9);
  assert.equal(received.cursor, "c1");
});

test("listDeadlines empty matterId → invalid_payload", async () => {
  const result = await listDeadlinesHandler({ matterId: "" }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listDeadlines forbidden field tenant_id → invalid_payload", async () => {
  const result = await listDeadlinesHandler({ matterId: FIXED_ID, tenant_id: "evil" }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("listDeadlines unknown field → invalid_payload", async () => {
  const result = await listDeadlinesHandler({ matterId: FIXED_ID, bogus: 1 }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listDeadlines non-integer limit → invalid_payload", async () => {
  const result = await listDeadlinesHandler({ matterId: FIXED_ID, limit: 2.5 }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listDeadlines absent matter → unknown_matter; listDeadlines not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => null,
    listDeadlines: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await listDeadlinesHandler({ matterId: "01jz0000000000000000000099" }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(called, false);
});

test("listDeadlines tenant mismatch → tenant_mismatch; listDeadlines not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    listDeadlines: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await listDeadlinesHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(called, false);
});
