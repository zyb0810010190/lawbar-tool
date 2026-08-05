// updateMatterDetails IPC unit tests (matter-details-edit Phase C):
// casebox:matter:updateDetails. In a NEW dedicated file (the WI-704-style split
// rule). Instrumented in-memory provider + the default active tenant/actor.
// Mirrors ipc-claim-track-handlers.unit.test.mjs: channel-name assert, happy
// path + server-authority injection/strip, table-driven forbidden-field
// rejection, unknown-field + patch-field validation, matter/tenant preflight
// fail-closed (persistence spy NOT called), each persistence outcome surfaced as
// a SAFE code (no raw message crosses the wire), runtime projection proof, and
// prototype-pollution hardening on BOTH the top-level DTO and the patch.

import test from "node:test";
import assert from "node:assert/strict";
import { updateMatterDetailsHandler } from "../dist/src/caseBox/matterHandlers.js";
import { CHANNEL } from "../dist/src/caseBox/handlerShared.js";
import { UPDATE_MATTER_DETAILS_FORBIDDEN_FIELDS } from "../dist/src/caseBox/dto.js";
import { CaseBoxPersistenceError } from "case-box-persistence";

const FIXED_NOW_ISO = "2026-07-01T00:00:00.000Z";
const MATTER_ID = "01jz0000000000000000000000";

function validDto(overrides = {}) {
  return {
    matterId: MATTER_ID,
    patch: { retainer_scope: "Updated retainer scope" },
    reason: "correcting the retainer scope",
    ...overrides,
  };
}

// A raw persistence matter row carrying the server-authority identities + an
// open-index extra — projection MUST strip tenant_id / actor_user_id / extras and
// keep exactly the MATTER_RESPONSE_FIELDS display set.
function rawUpdatedRow(extra = {}) {
  return {
    id: MATTER_ID,
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    name: "ACME v Globex",
    matter_type: "litigation",
    jurisdiction: { value: "CN-Beijing", locked: false },
    parties: [],
    confidentiality_class: "normal",
    status: "active",
    created_at: FIXED_NOW_ISO,
    archived_at: null,
    retainer_scope: "Updated retainer scope",
    case_type_text: "",
    case_progress_text: "",
    court_contact_text: "",
    contention_summary_text: "",
    secret_extra: "should-not-cross-the-ipc-boundary",
    ...extra,
  };
}

// Provider: getMatter returns an active-tenant matter for MATTER_ID;
// updateMatterDetails is a spy that records (matterId, opts) and echoes a raw row
// (authority + open-index extra) so every happy path also exercises projection.
function makeProvider(overrides = {}) {
  const calls = { get: 0, update: 0 };
  let updateArgs;
  const matter = {
    id: MATTER_ID,
    tenant_id: "default-tenant",
    status: "active",
    name: "ACME v Globex",
  };
  const persistence = {
    getMatter: async (id) => {
      calls.get += 1;
      return id === MATTER_ID ? matter : null;
    },
    updateMatterDetails: async (id, opts) => {
      calls.update += 1;
      updateArgs = { id, opts };
      return rawUpdatedRow();
    },
    ...(overrides.persistence ?? {}),
  };
  return {
    provide: () => ({ persistence }),
    calls,
    getUpdateArgs: () => updateArgs,
  };
}

// --- channel name -----------------------------------------------------------

test("CHANNEL.matterUpdateDetails matches the contract pattern", () => {
  assert.equal(CHANNEL.matterUpdateDetails, "casebox:matter:updateDetails");
});

// --- happy path: server authority injected + response strips authority -------

test("happy path: injects server actor + forwards {patch, reason}; response strips authority", async () => {
  const { provide, calls, getUpdateArgs } = makeProvider();
  const r = await updateMatterDetailsHandler(validDto(), provide);
  assert.equal(r.ok, true);
  assert.equal(calls.get, 1);
  assert.equal(calls.update, 1);
  const { id, opts } = getUpdateArgs();
  assert.equal(id, MATTER_ID);
  // patch forwarded, own-keys only (exactly the one supplied editable field):
  assert.equal(Object.keys(opts.patch).length, 1);
  assert.equal(opts.patch.retainer_scope, "Updated retainer scope");
  // SERVER AUTHORITY: actor injected here, never from the renderer.
  assert.equal(opts.actor_user_id, "local-user");
  assert.equal(opts.reason, "correcting the retainer scope");
  // renderer-facing response: authority stripped, content preserved.
  assert.equal(r.value.id, MATTER_ID);
  assert.equal(r.value.status, "active");
  assert.equal("tenant_id" in r.value, false);
  assert.equal("actor_user_id" in r.value, false);
  assert.equal("secret_extra" in r.value, false);
});

test("happy path: an explicit null (clear) survives forwarding to persistence", async () => {
  const { provide, getUpdateArgs } = makeProvider();
  const r = await updateMatterDetailsHandler(
    validDto({ patch: { case_type_text: null } }),
    provide,
  );
  assert.equal(r.ok, true);
  const { opts } = getUpdateArgs();
  assert.equal(Object.prototype.hasOwnProperty.call(opts.patch, "case_type_text"), true);
  assert.equal(opts.patch.case_type_text, null);
});

// --- forbidden-field rejection (table-driven) -------------------------------

test("rejects EVERY forbidden server/lifecycle/frozen field (table-driven), persistence NOT called", async () => {
  for (const f of UPDATE_MATTER_DETAILS_FORBIDDEN_FIELDS) {
    const { provide, calls } = makeProvider();
    const r = await updateMatterDetailsHandler(validDto({ [f]: "x" }), provide);
    assert.equal(r.ok, false, `${f} should be rejected`);
    assert.equal(r.error.code, "invalid_payload", `${f} -> invalid_payload`);
    assert.equal(r.error.details?.schemaPath, f, `${f} schemaPath`);
    assert.equal(calls.update, 0, `${f} must not reach persistence`);
    assert.equal(calls.get, 0, `${f} must not reach the preflight read`);
  }
});

test("client-supplied actor_user_id is rejected (server-authority field), persistence NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await updateMatterDetailsHandler(validDto({ actor_user_id: "attacker" }), provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "actor_user_id");
  assert.equal(calls.update, 0);
});

// --- field validation -------------------------------------------------------

test("unknown top-level field -> invalid_payload, persistence NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await updateMatterDetailsHandler(validDto({ bogus: 1 }), provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "bogus");
  assert.equal(calls.update, 0);
});

test("missing matterId -> invalid_payload", async () => {
  const { provide, calls } = makeProvider();
  const dto = validDto();
  delete dto.matterId;
  const r = await updateMatterDetailsHandler(dto, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.update, 0);
});

test("missing / blank reason -> invalid_payload", async () => {
  const { provide, calls } = makeProvider();
  for (const reason of [undefined, "", "   "]) {
    const dto = validDto();
    if (reason === undefined) delete dto.reason;
    else dto.reason = reason;
    const r = await updateMatterDetailsHandler(dto, provide);
    assert.equal(r.ok, false, `reason=${JSON.stringify(reason)} should be rejected`);
    assert.equal(r.error.code, "invalid_payload");
  }
  assert.equal(calls.update, 0);
});

test("patch that is not a plain object -> invalid_payload, persistence NOT called", async () => {
  const { provide, calls } = makeProvider();
  for (const patch of [null, [], "x", 3]) {
    const r = await updateMatterDetailsHandler(validDto({ patch }), provide);
    assert.equal(r.ok, false, `patch=${JSON.stringify(patch)} should be rejected`);
    assert.equal(r.error.code, "invalid_payload");
  }
  assert.equal(calls.update, 0);
});

test("patch with a non-editable / unknown key -> invalid_payload, persistence NOT called", async () => {
  for (const key of ["status", "tenant_id", "matter_type", "id", "bogus"]) {
    const { provide, calls } = makeProvider();
    const r = await updateMatterDetailsHandler(validDto({ patch: { [key]: "x" } }), provide);
    assert.equal(r.ok, false, `patch.${key} should be rejected`);
    assert.equal(r.error.code, "invalid_payload", `patch.${key} -> invalid_payload`);
    assert.equal(r.error.details?.schemaPath, key, `patch.${key} schemaPath`);
    assert.equal(calls.update, 0, `patch.${key} must not reach persistence`);
  }
});

// --- matter + tenant preflight fail-closed (updateMatterDetails NOT reached) --

test("unknown matter -> unknown_matter, updateMatterDetails NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await updateMatterDetailsHandler(
    validDto({ matterId: "01jzunknownmatter000000000a" }),
    provide,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(calls.update, 0);
});

test("foreign-tenant matter -> tenant_mismatch, updateMatterDetails NOT called", async () => {
  const { provide, calls } = makeProvider({
    persistence: {
      getMatter: async () => ({ id: MATTER_ID, tenant_id: "other-tenant", status: "active" }),
    },
  });
  const r = await updateMatterDetailsHandler(validDto(), provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(calls.update, 0);
});

// --- each persistence outcome surfaced as a SAFE code (no raw message) -------

test("each persistence error is surfaced with a safe message; no raw detail crosses", async () => {
  const LEAK = "tenant=acme-123 /Users/lawyer/case-box.sqlite <secret>";
  // Exhaustive over every code this handler can surface via mapThrownError. The
  // mock getMatter returns an ACTIVE matter whose tenant_id MATCHES the active
  // tenant, so the tenant preflight passes and a THROWN tenant_mismatch reaches
  // mapThrownError (rather than being short-circuited by the preflight).
  for (const code of [
    "unknown_matter",
    "tenant_mismatch",
    "matter_archived",
    "no_editable_change",
    "invalid_payload",
    "audit_chain_desync",
  ]) {
    const { provide } = makeProvider({
      persistence: {
        getMatter: async () => ({ id: MATTER_ID, tenant_id: "default-tenant", status: "active" }),
        updateMatterDetails: async () => {
          throw new CaseBoxPersistenceError(code, `raw ${code}: ${LEAK}`);
        },
      },
    });
    const r = await updateMatterDetailsHandler(validDto(), provide);
    assert.equal(r.ok, false, `${code} should surface as an error`);
    assert.equal(r.error.code, code, `${code} code preserved`);
    // The renderer NEVER sees the raw diagnostic message — only the safe static string.
    assert.doesNotMatch(
      r.error.message,
      /acme-123|Users\/lawyer|case-box\.sqlite|secret/,
      `${code} must not leak raw detail`,
    );
  }
});

// --- projection runtime proof (not just types) ------------------------------

test("projection strips EXTRA open-index keys + authority at runtime", async () => {
  const { provide } = makeProvider({
    persistence: {
      getMatter: async () => ({ id: MATTER_ID, tenant_id: "default-tenant", status: "active" }),
      updateMatterDetails: async () =>
        rawUpdatedRow({
          another_open_index_key: 42,
          reviewer_secret: "nope",
          custody_chain: [{ actor: "x" }],
        }),
    },
  });
  const r = await updateMatterDetailsHandler(validDto(), provide);
  assert.equal(r.ok, true);
  for (const leaked of [
    "tenant_id",
    "actor_user_id",
    "secret_extra",
    "another_open_index_key",
    "reviewer_secret",
    "custody_chain",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(r.value, leaked),
      false,
      `${leaked} leaked to renderer`,
    );
  }
  for (const keep of [
    "id",
    "name",
    "matter_type",
    "jurisdiction",
    "parties",
    "confidentiality_class",
    "status",
    "created_at",
    "archived_at",
    "retainer_scope",
    "case_type_text",
    "case_progress_text",
    "court_contact_text",
    "contention_summary_text",
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(r.value, keep), `${keep} dropped`);
  }
});

// --- prototype-pollution hardening (own-keys-only reads) ---------------------
// A globally-polluted Object.prototype must NOT leak an inherited value into a
// DTO field or a patch key that was never an actual own key. Each test restores
// Object.prototype in an airtight finally.

test("top-level: inherited Object.prototype.matterId is NOT read as matterId", async () => {
  const { provide, calls } = makeProvider();
  const dto = validDto();
  delete dto.matterId; // no OWN matterId
  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.matterId = "polluted-injected";
    const r = await updateMatterDetailsHandler(dto, provide);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_payload", "inherited value must be treated as MISSING matterId");
    assert.equal(calls.update, 0, "persistence must not be reached via a polluted inherited value");
  } finally {
    delete Object.prototype.matterId;
  }
  assert.equal("matterId" in Object.prototype, false);
});

test("patch: an inherited Object.prototype editable key is NOT forwarded to persistence", async () => {
  const { provide, calls, getUpdateArgs } = makeProvider();
  // Empty OWN patch; the ONLY retainer_scope is the inherited pollution.
  const dto = validDto({ patch: {} });
  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.retainer_scope = "polluted-injected";
    const r = await updateMatterDetailsHandler(dto, provide);
    assert.equal(r.ok, true);
    assert.equal(calls.update, 1);
    // The inherited retainer_scope must NEVER reach the forwarded patch.
    assert.equal(
      Object.prototype.hasOwnProperty.call(getUpdateArgs().opts.patch, "retainer_scope"),
      false,
      "inherited retainer_scope leaked into the forwarded patch",
    );
  } finally {
    delete Object.prototype.retainer_scope;
  }
  assert.equal("retainer_scope" in Object.prototype, false);
});
