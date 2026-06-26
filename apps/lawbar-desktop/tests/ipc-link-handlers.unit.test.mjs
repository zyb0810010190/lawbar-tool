// Evidence link IPC unit tests (WI-A3-LINK-IPC-T1): casebox:link:create /
// unlink / relink / list / export. NEW dedicated file (the WI-704-style split
// rule). Mirrors ipc-fact-handlers.unit.test.mjs: a mock LinkPersistenceProvider
// (the concrete persistence methods + a fake better-sqlite3 db) and the default
// active tenant/actor. SYNTHETIC ids/data only.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createLinkHandler,
  unlinkLinkHandler,
  relinkLinkHandler,
  listLinksHandler,
  exportLinkCitationsHandler,
} from "../dist/src/caseBox/linkHandlers.js";
import { CHANNEL } from "../dist/src/caseBox/handlerShared.js";
import {
  CREATE_LINK_FORBIDDEN_FIELDS,
  RELINK_LINK_FORBIDDEN_FIELDS,
  LINK_RESPONSE_FIELDS,
} from "../dist/src/caseBox/dto.js";
import { projectRow } from "../dist/src/caseBox/handlerShared.js";

const MID = "01jz0000000000000000000000";
const TENANT = "default-tenant";

// NOTE (WI-A3-LINK-IPC-T1): listLinks / exportLinkCitations call the REAL
// resolveLinkStatuses / buildExportCitations, which require a real better-sqlite3
// db. The desktop's better-sqlite3 binding is Electron-ABI (NODE_MODULE_VERSION
// mismatch under plain `node --test`), so — like every existing desktop IPC unit
// test — this suite mocks the db and does NOT open a real one. The list-row
// projection is unit-tested directly via projectRow below; the real-db list/export
// IPC round-trip is DEFERRED to an Electron integration test (the resolver/export
// themselves are fully unit-tested in the case-box-persistence package). See
// dev-memo/deferred-audit-findings.md.

// A synthetic active link row as the persistence layer returns it (carries the
// server-authority fields tenant_id + payload_json the projection MUST strip).
function activeRow(overrides = {}) {
  return {
    id: "L1",
    tenant_id: TENANT,
    matter_id: MID,
    source_type: "note",
    source_id: "s1",
    anchor_id: "a1",
    status: "needs_review",
    created_at: "2026-06-26T00:00:00.000Z",
    payload_json: "{}",
    unlinked_at: null,
    unlink_reason: null,
    ...overrides,
  };
}

// makeLinkProvider(overrides): a () => ({ persistence, db }) provider.
//   overrides.persistence — merge over the default spies.
//   overrides.linkExists  — when false, the scoped db preflight returns undefined.
//   overrides.rows        — what db.prepare(...).all() returns (list path).
function makeLinkProvider(overrides = {}) {
  const calls = { create: 0, unlink: 0, relink: 0 };
  const persistence = {
    getMatter: async (id) =>
      id === MID ? { id: MID, tenant_id: TENANT, status: "active" } : null,
    createLink: async (input) => {
      calls.create += 1;
      return activeRow({
        tenant_id: input.tenant_id,
        matter_id: input.matter_id,
        source_type: input.source_type,
        source_id: input.source_id,
        anchor_id: input.anchor_id,
      });
    },
    unlinkLink: async (linkId, opts) => {
      calls.unlink += 1;
      return activeRow({
        id: linkId,
        status: "broken",
        unlinked_at: "2026-06-26T01:00:00.000Z",
        unlink_reason: opts.unlink_reason,
      });
    },
    relinkLink: async (linkId) => {
      calls.relink += 1;
      return activeRow({ id: linkId, status: "valid", unlinked_at: null, unlink_reason: null });
    },
    ...(overrides.persistence ?? {}),
  };
  const db = {
    prepare: () => ({
      get: () => (overrides.linkExists === false ? undefined : { 1: 1 }),
      all: () => overrides.rows ?? [],
    }),
  };
  return { provide: () => ({ persistence, db }), calls };
}

test("CHANNEL link channels match contract patterns", () => {
  assert.equal(CHANNEL.linkCreate, "casebox:link:create");
  assert.equal(CHANNEL.linkUnlink, "casebox:link:unlink");
  assert.equal(CHANNEL.linkRelink, "casebox:link:relink");
  assert.equal(CHANNEL.linkList, "casebox:link:list");
  assert.equal(CHANNEL.linkExport, "casebox:link:export");
});

test("createLink: ok -> projected RendererLink WITHOUT tenant_id/payload_json", async () => {
  const { provide } = makeLinkProvider();
  const r = await createLinkHandler(
    { matterId: MID, sourceType: "note", sourceId: "s1", anchorId: "a1" },
    provide,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.id, "L1");
  assert.equal(r.value.source_type, "note");
  assert.equal(r.value.status, "needs_review");
  // authority / internal fields never cross the boundary:
  assert.equal("tenant_id" in r.value, false);
  assert.equal("payload_json" in r.value, false);
  assert.equal("actor_user_id" in r.value, false);
  // the projected row carries EXACTLY the allowlisted keys present on the row:
  for (const k of Object.keys(r.value)) {
    assert.ok(LINK_RESPONSE_FIELDS.includes(k), `unexpected projected field: ${k}`);
  }
});

test("createLink: forbidden field tenantId -> invalid_payload, createLink NOT called", async () => {
  const { provide, calls } = makeLinkProvider();
  const r = await createLinkHandler(
    { matterId: MID, sourceType: "note", sourceId: "s1", anchorId: "a1", tenantId: "x" },
    provide,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "tenantId");
  assert.equal(calls.create, 0);
});

test("createLink: rejects EVERY forbidden field (table-driven)", async () => {
  for (const f of CREATE_LINK_FORBIDDEN_FIELDS) {
    const { provide, calls } = makeLinkProvider();
    const r = await createLinkHandler(
      { matterId: MID, sourceType: "note", sourceId: "s1", anchorId: "a1", [f]: "x" },
      provide,
    );
    assert.equal(r.ok, false, `${f} should be rejected`);
    assert.equal(r.error.code, "invalid_payload", `${f} -> invalid_payload`);
    assert.equal(calls.create, 0, `${f} must not reach persistence`);
  }
});

test("createLink: unknown matter -> unknown_matter, NOT called", async () => {
  const { provide, calls } = makeLinkProvider();
  const r = await createLinkHandler(
    { matterId: "01jz000000000000000000zzzz", sourceType: "note", sourceId: "s1", anchorId: "a1" },
    provide,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(calls.create, 0);
});

test("createLink: wrong-tenant matter -> tenant_mismatch, NOT called", async () => {
  const { provide, calls } = makeLinkProvider({
    persistence: { getMatter: async () => ({ id: MID, tenant_id: "other-tenant", status: "active" }) },
  });
  const r = await createLinkHandler(
    { matterId: MID, sourceType: "note", sourceId: "s1", anchorId: "a1" },
    provide,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(calls.create, 0);
});

test("unlink: non-existent scoped link (linkExists:false) -> invalid_payload, unlinkLink NOT called", async () => {
  const { provide, calls } = makeLinkProvider({ linkExists: false });
  const r = await unlinkLinkHandler(
    { matterId: MID, linkId: "L1", unlinkReason: "superseded" },
    provide,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.unlink, 0, "unlinkLink must not be called on a scoped link miss");
});

test("unlink: happy path -> ok, projected row, reason forwarded, no authority fields", async () => {
  const { provide, calls } = makeLinkProvider();
  const r = await unlinkLinkHandler(
    { matterId: MID, linkId: "L1", unlinkReason: "superseded by exhibit B" },
    provide,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "broken");
  assert.equal(r.value.unlink_reason, "superseded by exhibit B");
  assert.equal("tenant_id" in r.value, false);
  assert.equal("payload_json" in r.value, false);
  assert.equal(calls.unlink, 1);
});

test("unlink: blank unlinkReason -> invalid_payload, NOT called", async () => {
  const { provide, calls } = makeLinkProvider();
  const r = await unlinkLinkHandler({ matterId: MID, linkId: "L1", unlinkReason: "   " }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.unlink, 0);
});

test("relink: forbidden field unlinkReason -> invalid_payload, relinkLink NOT called", async () => {
  const { provide, calls } = makeLinkProvider();
  const r = await relinkLinkHandler({ matterId: MID, linkId: "L1", unlinkReason: "x" }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "unlinkReason");
  assert.equal(calls.relink, 0);
});

test("relink: rejects EVERY forbidden field (table-driven)", async () => {
  for (const f of RELINK_LINK_FORBIDDEN_FIELDS) {
    const { provide, calls } = makeLinkProvider();
    const r = await relinkLinkHandler({ matterId: MID, linkId: "L1", [f]: "x" }, provide);
    assert.equal(r.ok, false, `${f} should be rejected`);
    assert.equal(r.error.code, "invalid_payload", `${f} -> invalid_payload`);
    assert.equal(calls.relink, 0, `${f} must not reach persistence`);
  }
});

test("relink: happy path -> ok, restored to active", async () => {
  const { provide, calls } = makeLinkProvider();
  const r = await relinkLinkHandler({ matterId: MID, linkId: "L1" }, provide);
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "valid");
  assert.equal(r.value.unlinked_at, null);
  assert.equal(calls.relink, 1);
});

test("relink: scoped link miss -> invalid_payload, NOT called", async () => {
  const { provide, calls } = makeLinkProvider({ linkExists: false });
  const r = await relinkLinkHandler({ matterId: MID, linkId: "L1" }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.relink, 0);
});

test("listLinks: row projection (the handler's LINK_RESPONSE_FIELDS projection) strips authority/internal fields", () => {
  // The list handler projects every resolved row through projectRow(row,
  // LINK_RESPONSE_FIELDS); test that projection directly (the real-db resolver
  // path is integration-tested — see the file header note).
  for (const row of [activeRow({ id: "L1" }), activeRow({ id: "L2", status: "valid" })]) {
    const projected = projectRow(row, LINK_RESPONSE_FIELDS);
    assert.equal("tenant_id" in projected, false);
    assert.equal("payload_json" in projected, false);
    assert.equal("actor_user_id" in projected, false);
    for (const k of Object.keys(projected)) {
      assert.ok(LINK_RESPONSE_FIELDS.includes(k), `unexpected projected field: ${k}`);
    }
    assert.equal(projected.id, row.id);
    assert.equal(projected.status, row.status);
  }
});

test("createLink: bad sourceType -> invalid_payload, createLink NOT called (audit LINK-IPC-L1)", async () => {
  const { provide, calls } = makeLinkProvider();
  const r = await createLinkHandler(
    { matterId: MID, sourceType: "bogus", sourceId: "s1", anchorId: "a1" },
    provide,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.create, 0, "persistence.createLink must not be called on a bad sourceType");
});

test("listLinks: forbidden field tenant_id -> invalid_payload", async () => {
  const { provide } = makeLinkProvider();
  const r = await listLinksHandler({ matterId: MID, tenant_id: "x" }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("listLinks: unknown matter -> unknown_matter", async () => {
  const { provide } = makeLinkProvider();
  const r = await listLinksHandler({ matterId: "01jz000000000000000000zzzz" }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
});

test("exportLinkCitations: forbidden field tenant_id -> invalid_payload (validation; real export round-trip is integration-tested)", async () => {
  // The real buildExportCitations round-trip needs a real db (deferred to an
  // Electron integration test — see the file header note). Here we cover the
  // handler's validation boundary, which does not reach the real export.
  const { provide } = makeLinkProvider();
  const r = await exportLinkCitationsHandler({ matterId: MID, tenant_id: "x" }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("DTO allowlists exclude payload_json and tenant_id", () => {
  assert.equal(LINK_RESPONSE_FIELDS.includes("payload_json"), false);
  assert.equal(LINK_RESPONSE_FIELDS.includes("tenant_id"), false);
});
