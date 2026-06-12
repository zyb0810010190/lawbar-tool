// WI-DPE4 — editDocketEntry IPC handler unit tests. Sibling split from
// ipc-casebox-handlers.unit.test.mjs (loc-guardian: that file is at the 1200
// test-fail line). Edit PROJECTION assertions also live in the happy-path test
// here + in ipc-list-projection.unit.test.mjs; the DTO/forbidden-list contract
// lives in dto-contract.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { editDocketEntryHandler } from "../dist/src/caseBox/docketHandlers.js";
import { CHANNEL } from "../dist/src/caseBox/handlerShared.js";
import { EDIT_DOCKET_FORBIDDEN_FIELDS } from "../dist/src/caseBox/dto.js";
import { CaseBoxPersistenceError } from "case-box-persistence";

const FIXED_NOW = new Date("2026-05-27T00:00:00.000Z");
const FIXED_MATTER = "01jz0000000000000000000000";
const FIXED_ENTRY = "01jzdock000000000000000000";
function clock() {
  return FIXED_NOW;
}

const PROPOSED_ENTRY = Object.freeze({
  id: FIXED_ENTRY, tenant_id: "default-tenant", actor_user_id: "local-user", matter_id: FIXED_MATTER,
  source_type: "manual", proposed_kind: "filing", proposed_due_at: "2026-06-15T17:00:00.000Z",
  proposed_due_at_kind: "datetime", proposed_due_at_timezone: "America/New_York",
  proposed_owner_user_id: "local-user", source_rule_citation: null, extractor_name: null,
  extractor_version: null, extraction_confidence: null, source_document_id: null, source_page_number: null,
  source_excerpt: null, reminder_offsets: [], confirmation_state: "proposed",
  proposed_at: "2026-05-21T20:00:00.000Z", confirmation_actor_user_id: null, confirmed_at: null,
  confirmed_deadline_id: null, dismissal_actor_user_id: null, dismissed_at: null, dismissal_reason: null,
  created_at: "2026-05-21T20:00:00.000Z",
});

const VALID_EDIT_DTO = Object.freeze({
  matterId: FIXED_MATTER, entryId: FIXED_ENTRY, proposed_kind: "hearing",
  proposed_due_at: "2026-06-15T17:00:00.000Z", proposed_due_at_kind: "datetime",
  proposed_due_at_timezone: "America/New_York", proposed_owner_user_id: "local-user", reminder_offsets: [],
});

function makeProvider(overrides = {}) {
  const persistence = {
    getMatter: async (id) =>
      id === FIXED_MATTER ? { id: FIXED_MATTER, tenant_id: "default-tenant", status: "active" } : null,
    getDocketEntry: async () => null,
    editDocketEntry: async (opts) => ({
      ...PROPOSED_ENTRY, proposed_kind: opts.proposed_kind, revised_at: FIXED_NOW.toISOString(),
    }),
    ...overrides,
  };
  return () => ({ persistence });
}

test("editDocketEntry happy path: server injects scope+actor; six content fields forwarded; revised_at server-derived; authority stripped", async () => {
  let opts;
  const provide = makeProvider({
    getDocketEntry: async () => PROPOSED_ENTRY,
    editDocketEntry: async (o) => {
      opts = o;
      return { ...PROPOSED_ENTRY, proposed_kind: o.proposed_kind, revised_at: FIXED_NOW.toISOString() };
    },
  });
  const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO }, provide, clock);
  assert.equal(r.ok, true);
  // server-injected / boundary-converted
  assert.equal(opts.tenant_id, "default-tenant");
  assert.equal(opts.matter_id, FIXED_MATTER); // from matterId
  assert.equal(opts.entry_id, FIXED_ENTRY); // from entryId
  assert.equal(typeof opts.editor_actor_user_id, "string");
  assert.ok(opts.editor_actor_user_id.length > 0);
  assert.equal(opts.proposed_kind, "hearing");
  assert.equal(opts.revised_at, undefined); // NOT passed — persistence derives it
  // projection: revised_at present, authority identities stripped
  assert.equal(r.value.proposed_kind, "hearing");
  assert.equal(r.value.revised_at, FIXED_NOW.toISOString());
  assert.ok(!("tenant_id" in r.value));
  assert.ok(!("actor_user_id" in r.value));
  assert.ok(!("confirmation_actor_user_id" in r.value));
});

test("editDocketEntry rejects every EDIT_DOCKET_FORBIDDEN_FIELDS entry (incl. tenant_id/matter_id/entry_id/editor_actor_user_id/revised_at)", async () => {
  const provide = makeProvider({ getDocketEntry: async () => PROPOSED_ENTRY });
  for (const f of EDIT_DOCKET_FORBIDDEN_FIELDS) {
    const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO, [f]: "x" }, provide, clock);
    assert.equal(r.ok, false, `forbidden field ${f} should be rejected`);
    assert.equal(r.error.code, "invalid_payload");
  }
});

test("editDocketEntry rejects unknown fields", async () => {
  const provide = makeProvider({ getDocketEntry: async () => PROPOSED_ENTRY });
  const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO, bogus: 1 }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("editDocketEntry rejects adversarial __proto__ / constructor / prototype JSON payloads", async () => {
  const provide = makeProvider({ getDocketEntry: async () => PROPOSED_ENTRY });
  const base = `"matterId":"${FIXED_MATTER}","entryId":"${FIXED_ENTRY}","proposed_kind":"hearing","proposed_due_at":"2026-06-15T17:00:00.000Z","proposed_due_at_kind":"datetime","proposed_due_at_timezone":"America/New_York","proposed_owner_user_id":"local-user","reminder_offsets":[]`;
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const raw = JSON.parse(`{${base},"${key}":{"polluted":true}}`);
    const r = await editDocketEntryHandler(raw, provide, clock);
    assert.equal(r.ok, false, `${key} payload should be rejected`);
    assert.equal(r.error.code, "invalid_payload");
  }
  // sanity: prototype not polluted by the test
  assert.equal(({}).polluted, undefined);
});

test("editDocketEntry shape guard: non-plain payloads rejected", async () => {
  const provide = makeProvider();
  for (const bad of [null, undefined, 42, "x", [], new Date()]) {
    const r = await editDocketEntryHandler(bad, provide, clock);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_payload");
  }
});

test("editDocketEntry preflight: unknown matter → unknown_matter, no write", async () => {
  let wrote = false;
  const provide = makeProvider({ getMatter: async () => null, editDocketEntry: async () => { wrote = true; } });
  const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(wrote, false);
});

test("editDocketEntry preflight: tenant mismatch → tenant_mismatch, no write", async () => {
  let wrote = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_MATTER, tenant_id: "other-tenant", status: "active" }),
    editDocketEntry: async () => { wrote = true; },
  });
  const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(wrote, false);
});

test("editDocketEntry preflight: unknown/cross-tenant entry → invalid_payload (no disclosure), no write", async () => {
  let wrote = false;
  const provide = makeProvider({ getDocketEntry: async () => null, editDocketEntry: async () => { wrote = true; } });
  const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(wrote, false);
  assert.ok(!r.error.message.includes(FIXED_ENTRY)); // no entry id disclosure
});

test("editDocketEntry proposed-only: a confirmed entry is rejected fail-closed BEFORE the write", async () => {
  let wrote = false;
  const provide = makeProvider({
    getDocketEntry: async () => ({ ...PROPOSED_ENTRY, confirmation_state: "confirmed" }),
    editDocketEntry: async () => { wrote = true; },
  });
  const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(wrote, false);
});

test("editDocketEntry no-leak: a thrown persistence error maps to a static safe message", async () => {
  const provide = makeProvider({
    getDocketEntry: async () => PROPOSED_ENTRY,
    editDocketEntry: async () => {
      throw new CaseBoxPersistenceError("tenant_mismatch", "SECRET tenant=acme matter=01jzleak entry leak");
    },
  });
  const r = await editDocketEntryHandler({ ...VALID_EDIT_DTO }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(r.error.message, "tenant mismatch"); // static; raw message never surfaced
  assert.ok(!r.error.message.includes("SECRET"));
});

test("editDocketEntry validates matterId/entryId are non-empty strings", async () => {
  const provide = makeProvider({ getDocketEntry: async () => PROPOSED_ENTRY });
  for (const bad of [{ ...VALID_EDIT_DTO, matterId: "" }, { ...VALID_EDIT_DTO, entryId: "" }]) {
    const r = await editDocketEntryHandler(bad, provide, clock);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_payload");
  }
});

test("editDocketEntry channel constant is casebox:docket:edit", () => {
  assert.equal(CHANNEL.docketEdit, "casebox:docket:edit");
});
