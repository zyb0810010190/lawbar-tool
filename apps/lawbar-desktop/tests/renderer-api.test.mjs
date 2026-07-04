// Renderer-side api wrapper tests.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 Slice 2 scope:
//   - one function per channel
//   - strips extra DTO fields (defense-in-depth)
//   - calls the matching client method with the stripped DTO
//   - passes the envelope (success + error) through unchanged

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCaseBoxApi,
  stripDtoFields,
} from "../dist/renderer/api.js";
import {
  RENDERER_CREATE_MATTER_DTO_FIELDS,
} from "../dist/renderer/types.js";

const VALID_ULID = "01jzabcdef0123456789ghjkmn";

function makeMockClient() {
  const calls = [];
  const mk = (name) => async (dto) => {
    calls.push({ name, dto });
    return { ok: true, value: { ok: name, dto } };
  };
  return {
    calls,
    client: {
      createMatter: mk("createMatter"),
      getMatter: mk("getMatter"),
      listMatters: mk("listMatters"),
      archiveMatter: mk("archiveMatter"),
      chainHead: mk("chainHead"),
      createFact: mk("createFact"),
      createDocketEntry: mk("createDocketEntry"),
      confirmDocketEntry: mk("confirmDocketEntry"),
      editDocketEntry: mk("editDocketEntry"),
      transitionFact: mk("transitionFact"),
      createLink: mk("createLink"),
      unlinkLink: mk("unlinkLink"),
      relinkLink: mk("relinkLink"),
      listLinks: mk("listLinks"),
      exportLinkCitations: mk("exportLinkCitations"),
      previewT3Catalog: mk("previewT3Catalog"),
      exportT3Docx: mk("exportT3Docx"),
    },
  };
}

function makeErrorClient(error) {
  return {
    createMatter: async () => ({ ok: false, error }),
    getMatter: async () => ({ ok: false, error }),
    listMatters: async () => ({ ok: false, error }),
    archiveMatter: async () => ({ ok: false, error }),
    chainHead: async () => ({ ok: false, error }),
  };
}

// --- stripDtoFields ---

test("stripDtoFields: keeps allowlisted keys, drops others", () => {
  const out = stripDtoFields(
    { name: "matter-fixture-A", id: "01abc", evil_field: true },
    ["name"],
  );
  assert.deepEqual(out, { name: "matter-fixture-A" });
});

test("stripDtoFields: empty DTO yields empty object", () => {
  assert.deepEqual(stripDtoFields({}, ["name"]), {});
});

test("stripDtoFields: preserves nested values verbatim", () => {
  const dto = {
    name: "matter-fixture-A",
    jurisdiction: { value: "test-jx", locked: false },
    parties: [{ role: "client", display_name: "syn-A" }],
  };
  const out = stripDtoFields(dto, ["name", "jurisdiction", "parties"]);
  assert.deepEqual(out, dto);
});

test("stripDtoFields: drops server-authority fields (defense-in-depth)", () => {
  const out = stripDtoFields(
    {
      name: "matter-fixture-A",
      id: "01abc",
      tenant_id: "default-tenant",
      actor_user_id: "local-user",
      created_at: "2026-01-01T00:00:00Z",
      external_ocr_authorized: true,
    },
    RENDERER_CREATE_MATTER_DTO_FIELDS,
  );
  assert.deepEqual(out, { name: "matter-fixture-A" });
});

// --- createCaseBoxApi: per-channel wiring ---

test("createCaseBoxApi: createMatter calls client.createMatter with stripped DTO", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  const dto = {
    name: "matter-fixture-A",
    matter_type: "litigation",
    jurisdiction: { value: "test-jx", locked: false },
    parties: [{ role: "client", display_name: "syn-A", party_kind: "individual" }],
    confidentiality_class: "normal",
    id: "01abc", // should be stripped
    tenant_id: "default-tenant", // should be stripped
  };
  const env = await api.createMatter(dto);
  assert.equal(env.ok, true);
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "createMatter");
  assert.equal(m.calls[0].dto.name, "matter-fixture-A");
  assert.equal("id" in m.calls[0].dto, false);
  assert.equal("tenant_id" in m.calls[0].dto, false);
});

test("createCaseBoxApi: getMatter passes only matterId", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.getMatter({ matterId: VALID_ULID });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "getMatter");
  assert.deepEqual(m.calls[0].dto, { matterId: VALID_ULID });
});

test("createCaseBoxApi: listMatters preserves status + limit + cursor", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.listMatters({ status: "active", limit: 20, cursor: "opaque-cursor-A" });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "listMatters");
  assert.deepEqual(m.calls[0].dto, {
    status: "active",
    limit: 20,
    cursor: "opaque-cursor-A",
  });
});

test("createCaseBoxApi: archiveMatter passes matterId + reason", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.archiveMatter({
    matterId: VALID_ULID,
    reason: "synthetic-archive-reason-fixture",
  });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "archiveMatter");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    reason: "synthetic-archive-reason-fixture",
  });
});

test("createCaseBoxApi: chainHead passes only matterId", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.chainHead({ matterId: VALID_ULID });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "chainHead");
  assert.deepEqual(m.calls[0].dto, { matterId: VALID_ULID });
});

test("createCaseBoxApi: createFact forwards only the 4 allowlisted fields", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.createFact({
    matterId: VALID_ULID,
    statement_text: "Defendant filed answer.",
    purpose: "timeline_event",
    as_of_date: "2026-06-15",
  });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "createFact");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    statement_text: "Defendant filed answer.",
    purpose: "timeline_event",
    as_of_date: "2026-06-15",
  });
});

test("createCaseBoxApi: createFact drops a smuggled server-authority field", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.createFact({
    matterId: VALID_ULID,
    statement_text: "x",
    // not in RENDERER_CREATE_FACT_DTO_FIELDS — must be stripped before invoke:
    tenant_id: "evil",
    status: "accepted",
    actor_user_id: "evil",
  });
  assert.deepEqual(m.calls[0].dto, { matterId: VALID_ULID, statement_text: "x" });
});

test("createCaseBoxApi: createDocketEntry forwards only the allowlisted fields", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.createDocketEntry({
    matterId: VALID_ULID,
    proposed_kind: "filing",
    proposed_due_at: "2026-06-15T17:00:00.000Z",
    proposed_due_at_timezone: "America/New_York",
    proposed_owner_user_id: "01jzowner000000000000000000",
    // smuggled server-authority fields must be stripped:
    tenant_id: "evil",
    actor_user_id: "evil",
    confirmation_state: "confirmed",
  });
  assert.equal(m.calls[0].name, "createDocketEntry");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    proposed_kind: "filing",
    proposed_due_at: "2026-06-15T17:00:00.000Z",
    proposed_due_at_timezone: "America/New_York",
    proposed_owner_user_id: "01jzowner000000000000000000",
  });
});

test("createCaseBoxApi: confirmDocketEntry forwards only matterId + entryId", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.confirmDocketEntry({
    matterId: VALID_ULID,
    entryId: "01jzentry000000000000000000",
    // smuggled fields stripped:
    confirmation_actor_user_id: "evil",
    deadline_id: "evil",
  });
  assert.equal(m.calls[0].name, "confirmDocketEntry");
  assert.deepEqual(m.calls[0].dto, { matterId: VALID_ULID, entryId: "01jzentry000000000000000000" });
});

test("createCaseBoxApi: editDocketEntry forwards only matterId/entryId + the six content fields", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.editDocketEntry({
    matterId: VALID_ULID,
    entryId: "01jzentry000000000000000000",
    proposed_kind: "hearing",
    proposed_due_at: "2026-06-20T16:00:00.000Z",
    proposed_due_at_kind: "datetime",
    proposed_due_at_timezone: "America/New_York",
    proposed_owner_user_id: "01jzowner000000000000000000",
    reminder_offsets: null,
    // smuggled authority/provenance/lifecycle fields must be stripped:
    tenant_id: "evil",
    matter_id: "evil",
    entry_id: "evil",
    editor_actor_user_id: "evil",
    revised_at: "2099-01-01T00:00:00.000Z",
    confirmation_state: "confirmed",
  });
  assert.equal(m.calls[0].name, "editDocketEntry");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    entryId: "01jzentry000000000000000000",
    proposed_kind: "hearing",
    proposed_due_at: "2026-06-20T16:00:00.000Z",
    proposed_due_at_kind: "datetime",
    proposed_due_at_timezone: "America/New_York",
    proposed_owner_user_id: "01jzowner000000000000000000",
    reminder_offsets: null,
  });
});

test("createCaseBoxApi: transitionFact forwards only matterId/factId/to/rejection_reason", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.transitionFact({
    matterId: VALID_ULID,
    factId: "01jzfact00000000000000000a",
    to: "rejected",
    rejection_reason: "out of scope",
    // smuggled server-authority / lifecycle fields must be stripped:
    reviewer_actor_user_id: "evil",
    at: "2026-01-01T00:00:00Z",
    status: "accepted",
    tenant_id: "evil",
  });
  assert.equal(m.calls[0].name, "transitionFact");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    factId: "01jzfact00000000000000000a",
    to: "rejected",
    rejection_reason: "out of scope",
  });
});

// --- envelope passthrough ---

test("createCaseBoxApi: success envelope passes through unchanged", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  const env = await api.getMatter({ matterId: VALID_ULID });
  assert.deepEqual(env, {
    ok: true,
    value: { ok: "getMatter", dto: { matterId: VALID_ULID } },
  });
});

test("createCaseBoxApi: error envelope passes through unchanged (safe message preserved)", async () => {
  const safeError = {
    kind: "case_box_persistence_error",
    code: "unknown_matter",
    message: "unknown matter",
  };
  const client = makeErrorClient(safeError);
  const api = createCaseBoxApi(client);
  const env = await api.getMatter({ matterId: VALID_ULID });
  assert.equal(env.ok, false);
  assert.deepEqual(env.error, safeError);
});

test("createCaseBoxApi: error envelope with details preserved", async () => {
  const safeError = {
    kind: "case_box_persistence_error",
    code: "invalid_payload",
    message: "invalid payload",
    details: { schemaPath: "/properties/name", keyword: "type" },
  };
  const client = makeErrorClient(safeError);
  const api = createCaseBoxApi(client);
  const env = await api.createMatter({
    name: "x",
    matter_type: "litigation",
    jurisdiction: { value: "jx", locked: false },
    parties: [],
    confidentiality_class: "normal",
  });
  assert.equal(env.ok, false);
  assert.deepEqual(env.error.details, { schemaPath: "/properties/name", keyword: "type" });
});

// --- isolation: wrapper does not retry or transform ---

test("createCaseBoxApi: each call invokes the client exactly once (no retry)", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.listMatters({ status: "active" });
  await api.listMatters({ status: "archived" });
  assert.equal(m.calls.length, 2);
});

test("createCaseBoxApi: success envelope value object reference passes through unchanged", async () => {
  const valueObj = { rows: [], next_cursor: null };
  const client = {
    createMatter: async () => ({ ok: true, value: valueObj }),
    getMatter: async () => ({ ok: true, value: valueObj }),
    listMatters: async () => ({ ok: true, value: valueObj }),
    archiveMatter: async () => ({ ok: true, value: valueObj }),
    chainHead: async () => ({ ok: true, value: valueObj }),
  };
  const api = createCaseBoxApi(client);
  const env = await api.listMatters({ status: "active" });
  assert.equal(env.ok, true);
  assert.equal(env.value, valueObj, "wrapper must pass the value reference through");
});

// --- Evidence link channels (WI-A3-LINK-UI-T1) ---

test("createCaseBoxApi: createLink forwards only the 4 allowlisted fields, drops identity", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.createLink({
    matterId: VALID_ULID,
    sourceType: "evidence",
    sourceId: "src-1",
    anchorId: "anc-1",
    // renderer must never forward server-authority identity:
    tenantId: "evil-tenant",
    actorUserId: "evil-actor",
    status: "valid",
  });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "createLink");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    sourceType: "evidence",
    sourceId: "src-1",
    anchorId: "anc-1",
  });
  assert.equal("tenantId" in m.calls[0].dto, false);
  assert.equal("actorUserId" in m.calls[0].dto, false);
});

test("createCaseBoxApi: unlinkLink forwards { matterId, linkId, unlinkReason }, drops identity", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.unlinkLink({
    matterId: VALID_ULID,
    linkId: "01jzlink00000000000000000a",
    unlinkReason: "superseded",
    tenantId: "evil",
    actorUserId: "evil",
  });
  assert.equal(m.calls[0].name, "unlinkLink");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    linkId: "01jzlink00000000000000000a",
    unlinkReason: "superseded",
  });
});

test("createCaseBoxApi: relinkLink forwards only { matterId, linkId } (no reason)", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.relinkLink({
    matterId: VALID_ULID,
    linkId: "01jzlink00000000000000000a",
    unlinkReason: "should-be-stripped",
    actorUserId: "evil",
  });
  assert.equal(m.calls[0].name, "relinkLink");
  assert.deepEqual(m.calls[0].dto, { matterId: VALID_ULID, linkId: "01jzlink00000000000000000a" });
});

test("createCaseBoxApi: listLinks + exportLinkCitations forward only matterId", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.listLinks({ matterId: VALID_ULID, tenantId: "evil" });
  await api.exportLinkCitations({ matterId: VALID_ULID, actorUserId: "evil" });
  assert.equal(m.calls[0].name, "listLinks");
  assert.deepEqual(m.calls[0].dto, { matterId: VALID_ULID });
  assert.equal(m.calls[1].name, "exportLinkCitations");
  assert.deepEqual(m.calls[1].dto, { matterId: VALID_ULID });
});

// --- T3 证据目录及说明 preview channel (WI-FORMS-T3-S2-CATALOG-PREVIEW) ---

test("createCaseBoxApi: previewT3Catalog forwards matterId + submitterSelection, strips authority", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.previewT3Catalog({
    matterId: VALID_ULID,
    submitterSelection: { partyIndex: 0, displayNameEcho: "孙乐驰" },
    // forbidden server-authority fields must be stripped before invoke:
    tenant_id: "evil",
    actor_user_id: "evil",
  });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "previewT3Catalog");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    submitterSelection: { partyIndex: 0, displayNameEcho: "孙乐驰" },
  });
  assert.equal("tenant_id" in m.calls[0].dto, false);
  assert.equal("actor_user_id" in m.calls[0].dto, false);
});

// --- T3 证据目录及说明 DOCX export channel (WI-FORMS-T3-S3-DOCX-EXPORT) ---

test("createCaseBoxApi: exportT3Docx forwards matterId + submitterSelection, strips authority", async () => {
  const m = makeMockClient();
  const api = createCaseBoxApi(m.client);
  await api.exportT3Docx({
    matterId: VALID_ULID,
    submitterSelection: { partyIndex: 1, displayNameEcho: "王二" },
    // forbidden server-authority fields must be stripped before invoke:
    tenant_id: "evil",
    actor_user_id: "evil",
  });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].name, "exportT3Docx");
  assert.deepEqual(m.calls[0].dto, {
    matterId: VALID_ULID,
    submitterSelection: { partyIndex: 1, displayNameEcho: "王二" },
  });
  assert.equal("tenant_id" in m.calls[0].dto, false);
  assert.equal("actor_user_id" in m.calls[0].dto, false);
});
