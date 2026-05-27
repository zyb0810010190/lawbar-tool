import test from "node:test";
import assert from "node:assert/strict";

import {
  createMatterHandler,
  getMatterHandler,
  listMattersHandler,
  archiveMatterHandler,
  chainHeadHandler,
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
