// ClaimTrack IPC unit tests (WI-PTA-VS2): casebox:claimTrack:create /
// casebox:claimTrack:list. In a NEW dedicated file (the WI-704-style split rule).
// Instrumented in-memory provider + the default active tenant/actor. Mirrors
// ipc-fact-handlers.unit.test.mjs: channel-name assert, create happy path +
// authority strip, table-driven forbidden-field rejection, both preflights
// fail-closed (persistence spy NOT called), runtime projection proof, and the
// unpaginated list-array shape.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createClaimTrackHandler,
  listClaimTracksHandler,
} from "../dist/src/caseBox/claimTrackHandlers.js";
import { CHANNEL } from "../dist/src/caseBox/handlerShared.js";
import { CREATE_CLAIM_TRACK_FORBIDDEN_FIELDS } from "../dist/src/caseBox/dto.js";

const FIXED_NOW = new Date("2026-07-01T00:00:00.000Z");
const FIXED_NOW_ISO = FIXED_NOW.toISOString();
const clock = () => FIXED_NOW;

// 26-char lowercase ULIDs (^[0-9a-z]{26}$) so the handler's validateClaimTrack
// preflight passes on the happy path.
const MATTER_ID = "01jz0000000000000000000000";
const CLAIMANT_ID = "01jzclaimant00000000000000";
const RESPONDENT_ID = "01jzrespondent000000000000";
const STRANGER_ID = "01jzstranger00000000000000";
const NEW_ID = "01jzclaimtrk00000000000000";
const idFactory = () => NEW_ID;

function validCreateDto(overrides = {}) {
  return {
    matterId: MATTER_ID,
    track_type: "main_claim",
    claimant_party_id: CLAIMANT_ID,
    respondent_party_id: RESPONDENT_ID,
    our_role: "asserting",
    title: "Breach of contract — main claim",
    sort_order: 0,
    ...overrides,
  };
}

// A raw persistence claim-track row carrying the server-authority identities +
// an open-index extra — projection MUST strip tenant_id / actor_user_id / extra.
function rawClaimTrackRow(id) {
  return {
    id,
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    matter_id: MATTER_ID,
    track_type: "main_claim",
    claimant_party_id: CLAIMANT_ID,
    respondent_party_id: RESPONDENT_ID,
    our_role: "asserting",
    title: "Main claim",
    claim_summary: "",
    response_summary: "",
    legal_basis: "",
    calculation_summary: "",
    status: "active",
    sort_order: 0,
    created_at: FIXED_NOW_ISO,
    updated_at: FIXED_NOW_ISO,
    secret_extra: "should-not-cross-the-ipc-boundary",
  };
}

// Provider: getMatter returns an active-tenant matter (with two ULID-carrying
// parties) for MATTER_ID; createClaimTrack / listClaimTracks are spies that
// record their calls. The default createClaimTrack echoes the row + authority +
// an open-index extra so EVERY happy path also exercises the projection.
function makeProvider(overrides = {}) {
  const calls = { create: 0, list: 0 };
  let createdInput;
  let listQuery;
  const matter = {
    id: MATTER_ID,
    tenant_id: "default-tenant",
    status: "active",
    parties: [
      { id: CLAIMANT_ID, role: "client", display_name: "ACME Corp", party_kind: "organization" },
      { id: RESPONDENT_ID, role: "opposing", display_name: "Globex", party_kind: "organization" },
    ],
  };
  const persistence = {
    getMatter: async (id) => (id === MATTER_ID ? matter : null),
    createClaimTrack: async (input) => {
      calls.create += 1;
      createdInput = input;
      return {
        ...input,
        secret_extra: "should-not-cross-the-ipc-boundary",
      };
    },
    listClaimTracks: async (q) => {
      calls.list += 1;
      listQuery = q;
      return [];
    },
    ...(overrides.persistence ?? {}),
  };
  return {
    provide: () => ({ persistence }),
    calls,
    getCreatedInput: () => createdInput,
    getListQuery: () => listQuery,
  };
}

// --- channel names ----------------------------------------------------------

test("CHANNEL.claimTrackCreate / claimTrackList match the contract patterns", () => {
  assert.equal(CHANNEL.claimTrackCreate, "casebox:claimTrack:create");
  assert.equal(CHANNEL.claimTrackList, "casebox:claimTrack:list");
});

// --- create happy path + authority injection/strip --------------------------

test("create: happy path injects id/tenant/actor/status/timestamps; response strips authority", async () => {
  const { provide, calls, getCreatedInput } = makeProvider();
  const r = await createClaimTrackHandler(validCreateDto(), provide, clock, idFactory);
  assert.equal(r.ok, true);
  assert.equal(calls.create, 1);
  // server-authority injection reached persistence:
  const input = getCreatedInput();
  assert.equal(input.id, NEW_ID);
  assert.equal(input.tenant_id, "default-tenant");
  assert.equal(input.actor_user_id, "local-user");
  assert.equal(input.status, "active");
  assert.equal(input.created_at, FIXED_NOW_ISO);
  assert.equal(input.updated_at, FIXED_NOW_ISO);
  assert.equal(input.created_at, input.updated_at);
  // absent summaries default to "":
  assert.equal(input.claim_summary, "");
  assert.equal(input.response_summary, "");
  assert.equal(input.legal_basis, "");
  assert.equal(input.calculation_summary, "");
  // renderer-facing response: authority stripped, content preserved.
  assert.equal(r.value.id, NEW_ID);
  assert.equal(r.value.status, "active");
  assert.equal(r.value.sort_order, 0);
  assert.equal("tenant_id" in r.value, false);
  assert.equal("actor_user_id" in r.value, false);
});

test("create: renderer-supplied sort_order is passed through unchanged", async () => {
  const { provide, getCreatedInput } = makeProvider();
  const r = await createClaimTrackHandler(validCreateDto({ sort_order: 7 }), provide, clock, idFactory);
  assert.equal(r.ok, true);
  assert.equal(getCreatedInput().sort_order, 7);
  assert.equal(r.value.sort_order, 7);
});

// --- both track_type × our_role combinations --------------------------------

for (const track_type of ["main_claim", "counterclaim"]) {
  for (const our_role of ["asserting", "responding"]) {
    test(`create: ${track_type} × ${our_role} is accepted`, async () => {
      const { provide } = makeProvider();
      const r = await createClaimTrackHandler(
        validCreateDto({ track_type, our_role }),
        provide,
        clock,
        idFactory,
      );
      assert.equal(r.ok, true);
      assert.equal(r.value.track_type, track_type);
      assert.equal(r.value.our_role, our_role);
    });
  }
}

// --- forbidden-field rejection (table-driven) -------------------------------

test("create: rejects EVERY forbidden server-authority field (table-driven), persistence NOT called", async () => {
  for (const f of CREATE_CLAIM_TRACK_FORBIDDEN_FIELDS) {
    const { provide, calls } = makeProvider();
    const r = await createClaimTrackHandler(validCreateDto({ [f]: "x" }), provide, clock, idFactory);
    assert.equal(r.ok, false, `${f} should be rejected`);
    assert.equal(r.error.code, "invalid_payload", `${f} -> invalid_payload`);
    assert.equal(r.error.details?.schemaPath, f, `${f} schemaPath`);
    assert.equal(calls.create, 0, `${f} must not reach persistence`);
  }
});

test("create: client-supplied status:'withdrawn' is rejected (forbidden field)", async () => {
  const { provide, calls } = makeProvider();
  const r = await createClaimTrackHandler(validCreateDto({ status: "withdrawn" }), provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "status");
  assert.equal(calls.create, 0);
});

// --- field validation -------------------------------------------------------

test("create: unknown field -> invalid_payload, persistence NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await createClaimTrackHandler(validCreateDto({ bogus: 1 }), provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "bogus");
  assert.equal(calls.create, 0);
});

test("create: missing matterId -> invalid_payload", async () => {
  const { provide } = makeProvider();
  const dto = validCreateDto();
  delete dto.matterId;
  const r = await createClaimTrackHandler(dto, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("create: missing title -> invalid_payload", async () => {
  const { provide } = makeProvider();
  const dto = validCreateDto();
  delete dto.title;
  const r = await createClaimTrackHandler(dto, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("create: invalid track_type / our_role / sort_order -> invalid_payload", async () => {
  const { provide } = makeProvider();
  for (const bad of [
    { track_type: "settlement" },
    { our_role: "observing" },
    { sort_order: -1 },
    { sort_order: 1.5 },
    { sort_order: "0" },
  ]) {
    const r = await createClaimTrackHandler(validCreateDto(bad), provide, clock, idFactory);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} should be rejected`);
    assert.equal(r.error.code, "invalid_payload");
  }
});

// --- matter+tenant preflight fail-closed (persistence NOT reached) -----------

test("create: unknown matter -> unknown_matter, createClaimTrack NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await createClaimTrackHandler(
    validCreateDto({ matterId: "01jzunknownmatter000000000a" }),
    provide,
    clock,
    idFactory,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(calls.create, 0);
});

test("create: foreign-tenant matter -> tenant_mismatch, createClaimTrack NOT called", async () => {
  const { provide, calls } = makeProvider({
    persistence: {
      getMatter: async () => ({
        id: MATTER_ID,
        tenant_id: "other-tenant",
        status: "active",
        parties: [
          { id: CLAIMANT_ID, role: "client", display_name: "A", party_kind: "organization" },
          { id: RESPONDENT_ID, role: "opposing", display_name: "B", party_kind: "organization" },
        ],
      }),
    },
  });
  const r = await createClaimTrackHandler(validCreateDto(), provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(calls.create, 0);
});

// --- party-ref preflight fail-closed (R5, persistence NOT reached) ----------

test("create: claimant_party_id absent from matter -> unknown_party, createClaimTrack NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await createClaimTrackHandler(
    validCreateDto({ claimant_party_id: STRANGER_ID }),
    provide,
    clock,
    idFactory,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_party");
  assert.equal(calls.create, 0);
});

test("create: respondent_party_id absent from matter -> unknown_party, createClaimTrack NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await createClaimTrackHandler(
    validCreateDto({ respondent_party_id: STRANGER_ID }),
    provide,
    clock,
    idFactory,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_party");
  assert.equal(calls.create, 0);
});

// --- projection runtime proof (not just types) ------------------------------

test("create: projection strips EXTRA open-index keys + authority at runtime", async () => {
  const { provide } = makeProvider({
    persistence: {
      getMatter: async (id) =>
        id === MATTER_ID
          ? {
              id: MATTER_ID,
              tenant_id: "default-tenant",
              status: "active",
              parties: [
                { id: CLAIMANT_ID, role: "client", display_name: "A", party_kind: "organization" },
                { id: RESPONDENT_ID, role: "opposing", display_name: "B", party_kind: "organization" },
              ],
            }
          : null,
      createClaimTrack: async (input) => ({
        ...input,
        tenant_id: "default-tenant",
        actor_user_id: "local-user",
        secret_extra: "should-not-cross-the-ipc-boundary",
        another_open_index_key: 42,
        reviewer_secret: "nope",
      }),
    },
  });
  const r = await createClaimTrackHandler(validCreateDto(), provide, clock, idFactory);
  assert.equal(r.ok, true);
  for (const leaked of [
    "tenant_id",
    "actor_user_id",
    "secret_extra",
    "another_open_index_key",
    "reviewer_secret",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(r.value, leaked),
      false,
      `${leaked} leaked to renderer`,
    );
  }
  for (const keep of [
    "id",
    "matter_id",
    "track_type",
    "claimant_party_id",
    "respondent_party_id",
    "our_role",
    "title",
    "claim_summary",
    "response_summary",
    "legal_basis",
    "calculation_summary",
    "status",
    "sort_order",
    "created_at",
    "updated_at",
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(r.value, keep), `${keep} dropped`);
  }
});

// --- list ------------------------------------------------------------------

test("list: returns a projected ARRAY (authority stripped, no page wrapper)", async () => {
  let listQuery;
  const { provide } = makeProvider({
    persistence: {
      getMatter: async (id) =>
        id === MATTER_ID ? { id: MATTER_ID, tenant_id: "default-tenant", status: "active", parties: [] } : null,
      listClaimTracks: async (q) => {
        listQuery = q;
        return [rawClaimTrackRow("01jzclaimtrk0000000000000a"), rawClaimTrackRow("01jzclaimtrk0000000000000b")];
      },
    },
  });
  const r = await listClaimTracksHandler({ matterId: MATTER_ID }, provide);
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.value), "list value must be an array");
  assert.equal(r.value.length, 2);
  assert.equal("next_cursor" in r.value, false, "no page wrapper");
  assert.equal("rows" in r.value, false, "no page wrapper");
  for (const row of r.value) {
    assert.equal("tenant_id" in row, false, "authority tenant_id leaked");
    assert.equal("actor_user_id" in row, false, "authority actor_user_id leaked");
    assert.equal("secret_extra" in row, false, "open-index extra leaked");
    assert.equal(row.status, "active");
  }
  // tenant injected server-side; matter scope forwarded.
  assert.deepEqual(listQuery, { tenant_id: "default-tenant", matter_id: MATTER_ID });
});

test("list: empty result -> empty array", async () => {
  const { provide } = makeProvider();
  const r = await listClaimTracksHandler({ matterId: MATTER_ID }, provide);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, []);
});

test("list: missing matterId -> invalid_payload", async () => {
  const { provide } = makeProvider();
  const r = await listClaimTracksHandler({}, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("list: any smuggled authority/lifecycle/unknown key -> invalid_payload, listClaimTracks NOT called", async () => {
  // The list DTO is matterId-only; authority (tenant_id/actor_user_id) is
  // forbidden and every other key is unknown-field-rejected. Either way the row
  // read never runs.
  for (const field of [
    "tenant_id",
    "actor_user_id",
    "matter_id",
    "id",
    "status",
    "created_at",
    "updated_at",
    "some_unknown_key",
  ]) {
    const { provide, calls } = makeProvider();
    const r = await listClaimTracksHandler({ matterId: MATTER_ID, [field]: "x" }, provide);
    assert.equal(r.ok, false, `${field} should be rejected`);
    assert.equal(r.error.code, "invalid_payload", `${field} -> invalid_payload`);
    assert.equal(calls.list, 0, `${field} must not reach persistence`);
  }
});

// --- list preflight fail-closed (listClaimTracks NOT reached) ---------------

test("list: unknown matter -> unknown_matter, listClaimTracks NOT called", async () => {
  const { provide, calls } = makeProvider();
  const r = await listClaimTracksHandler({ matterId: "01jzunknownmatter000000000a" }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(calls.list, 0);
});

test("list: foreign-tenant matter -> tenant_mismatch, listClaimTracks NOT called", async () => {
  const { provide, calls } = makeProvider({
    persistence: {
      getMatter: async () => ({ id: MATTER_ID, tenant_id: "other-tenant", status: "active", parties: [] }),
    },
  });
  const r = await listClaimTracksHandler({ matterId: MATTER_ID }, provide);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(calls.list, 0);
});

// --- prototype-pollution hardening (own-keys-only required-field reads) ------
// A globally-polluted Object.prototype must NOT leak an inherited value into a
// DTO field that was never an actual own key. Without the own-keys-only view the
// handler would read the inherited "polluted-injected" string as matterId and
// proceed past the required-field check (surfacing unknown_matter instead of
// invalid_payload). Each test restores Object.prototype in an airtight finally.

test("create: inherited Object.prototype.matterId is NOT read as matterId (own-keys-only)", async () => {
  const { provide, calls } = makeProvider();
  const dto = validCreateDto();
  delete dto.matterId; // no OWN matterId
  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.matterId = "polluted-injected";
    const r = await createClaimTrackHandler(dto, provide, clock, idFactory);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_payload", "inherited value must be treated as MISSING matterId");
    assert.equal(calls.create, 0, "persistence must not be reached via a polluted inherited value");
  } finally {
    delete Object.prototype.matterId;
  }
  // Pollution is fully cleared.
  assert.equal("matterId" in Object.prototype, false);
});

test("list: inherited Object.prototype.matterId is NOT read as matterId (own-keys-only)", async () => {
  const { provide, calls } = makeProvider();
  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.matterId = "polluted-injected";
    const r = await listClaimTracksHandler({}, provide);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_payload", "inherited value must be treated as MISSING matterId");
    assert.equal(calls.list, 0, "persistence must not be reached via a polluted inherited value");
  } finally {
    delete Object.prototype.matterId;
  }
  // Pollution is fully cleared.
  assert.equal("matterId" in Object.prototype, false);
});
