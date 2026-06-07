// Case-box ENTITY IPC unit tests — listDeadlines / listFacts (read) + docket
// create/confirm (WI-601) + fact create (WI-602) write handlers. Split out of
// ipc-handlers.unit.test.mjs (which was 1534 LOC, over the loc-guardian critical
// line) by WI-805, mirroring the WI-704 renderer-fact-write split. The moved tests
// are VERBATIM; only the shared harness (copied below) + imports were added.

import test from "node:test";
import assert from "node:assert/strict";
import {
  listDeadlinesHandler,
  listFactsHandler,
} from "../dist/src/caseBox/handlers.js";
import {
  createDocketEntryHandler,
  confirmDocketEntryHandler,
  listDocketEntriesHandler,
  dismissDocketEntryHandler,
} from "../dist/src/caseBox/docketHandlers.js";
import { createFactHandler } from "../dist/src/caseBox/factHandlers.js";
import { CHANNEL } from "../dist/src/caseBox/handlerShared.js";

// Local copy of the shared IPC test harness (the host's harness is inline, not a
// shared module; WI-805 duplicates only the helpers the moved tests use — validDto
// is not used by these tests and stays in the host).
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
    listFacts: async (q) => ({ rows: [], next_cursor: null, query: q }),
    listDocketEntries: async (q) => ({ rows: [], next_cursor: null, query: q }),
    getDocketEntry: async () => null,
    dismissDocketEntry: async (id, opts) => ({ id, confirmation_state: "dismissed", ...opts }),
    ...overrides,
  };
  return () => ({ persistence });
}


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

// ---------- listDocketEntries (WI-D1) ----------

const FULL_DOCKET_ROW = Object.freeze({
  id: "01jzdk00000000000000000000",
  // authority identities that MUST be stripped by projection:
  tenant_id: "default-tenant",
  actor_user_id: "local-user",
  confirmation_actor_user_id: "local-user",
  dismissal_actor_user_id: "local-user",
  // renderer-safe fields that MUST survive:
  matter_id: "01jz0000000000000000000000",
  source_type: "manual",
  proposed_kind: "filing",
  proposed_due_at: "2026-06-30T00:00:00.000Z",
  proposed_due_at_kind: "datetime",
  proposed_due_at_timezone: "America/New_York",
  confirmation_state: "proposed",
  proposed_at: "2026-06-01T00:00:00.000Z",
  created_at: "2026-06-01T00:00:00.000Z",
});

test("listDocketEntries happy path returns page + injects tenant_id and matter_id", async () => {
  let received;
  const provide = makeProvider({
    listDocketEntries: async (q) => {
      received = q;
      return { rows: [FULL_DOCKET_ROW], next_cursor: null };
    },
  });
  const result = await listDocketEntriesHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 1);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.matter_id, FIXED_ID);
});

test("listDocketEntries projects rows: authority identities are NOT leaked", async () => {
  const provide = makeProvider({
    listDocketEntries: async () => ({ rows: [FULL_DOCKET_ROW], next_cursor: null }),
  });
  const result = await listDocketEntriesHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  const row = result.value.rows[0];
  // authority identities stripped:
  assert.equal("tenant_id" in row, false);
  assert.equal("actor_user_id" in row, false);
  assert.equal("confirmation_actor_user_id" in row, false);
  assert.equal("dismissal_actor_user_id" in row, false);
  // renderer-safe fields retained:
  assert.equal(row.id, FULL_DOCKET_ROW.id);
  assert.equal(row.confirmation_state, "proposed");
  assert.equal(row.proposed_kind, "filing");
});

test("listDocketEntries proposed filter reaches persistence + returns the proposed entry", async () => {
  let received;
  const provide = makeProvider({
    listDocketEntries: async (q) => {
      received = q;
      return { rows: [FULL_DOCKET_ROW], next_cursor: null };
    },
  });
  const result = await listDocketEntriesHandler(
    { matterId: FIXED_ID, confirmation_state: "proposed" },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(received.confirmation_state, "proposed");
  assert.equal(result.value.rows[0].confirmation_state, "proposed");
});

test("listDocketEntries passes source_type + limit + cursor through; limit bounded", async () => {
  let received;
  const provide = makeProvider({
    listDocketEntries: async (q) => {
      received = q;
      return { rows: [], next_cursor: "next" };
    },
  });
  const result = await listDocketEntriesHandler(
    { matterId: FIXED_ID, source_type: "manual", limit: 999, cursor: "c1" },
    provide,
  );
  assert.equal(result.ok, true);
  assert.equal(received.source_type, "manual");
  assert.equal(received.limit, 200); // bounded to MAX_LIST_LIMIT
  assert.equal(received.cursor, "c1");
  assert.equal(result.value.next_cursor, "next");
});

test("listDocketEntries empty matterId → invalid_payload", async () => {
  const result = await listDocketEntriesHandler({ matterId: "" }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listDocketEntries forbidden field tenant_id → invalid_payload", async () => {
  const result = await listDocketEntriesHandler(
    { matterId: FIXED_ID, tenant_id: "evil" },
    makeProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("listDocketEntries unknown field → invalid_payload", async () => {
  const result = await listDocketEntriesHandler({ matterId: FIXED_ID, bogus: 1 }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listDocketEntries invalid confirmation_state → invalid_payload", async () => {
  const result = await listDocketEntriesHandler(
    { matterId: FIXED_ID, confirmation_state: "bogus" },
    makeProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "confirmation_state");
});

test("listDocketEntries invalid source_type → invalid_payload", async () => {
  const result = await listDocketEntriesHandler(
    { matterId: FIXED_ID, source_type: "bogus" },
    makeProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "source_type");
});

test("listDocketEntries absent matter → unknown_matter; listDocketEntries not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => null,
    listDocketEntries: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await listDocketEntriesHandler(
    { matterId: "01jz0000000000000000000099" },
    provide,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(called, false);
});

test("listDocketEntries tenant mismatch → tenant_mismatch; listDocketEntries not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    listDocketEntries: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await listDocketEntriesHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(called, false);
});

// ---------- dismissDocketEntry (WI-D2) ----------

const PROPOSED_ENTRY = Object.freeze({ ...FULL_DOCKET_ROW, confirmation_state: "proposed" });
const VALID_DISMISS_DTO = Object.freeze({
  matterId: FIXED_ID,
  entryId: PROPOSED_ENTRY.id,
  dismissal_reason: "duplicate of an existing deadline",
});

test("dismissDocketEntry happy path: proposed entry dismissed; server injects actor + timestamp", async () => {
  let opts;
  const provide = makeProvider({
    getDocketEntry: async () => PROPOSED_ENTRY,
    dismissDocketEntry: async (id, o) => {
      opts = { id, ...o };
      return { ...PROPOSED_ENTRY, confirmation_state: "dismissed", dismissed_at: o.dismissed_at, dismissal_reason: o.dismissal_reason };
    },
  });
  const result = await dismissDocketEntryHandler({ ...VALID_DISMISS_DTO }, provide, clock);
  assert.equal(result.ok, true);
  assert.equal(result.value.confirmation_state, "dismissed");
  // server-injected: timestamp from the clock, reason passed through
  assert.equal(opts.dismissed_at, FIXED_NOW.toISOString());
  assert.equal(opts.dismissal_reason, "duplicate of an existing deadline");
  assert.equal(typeof opts.dismissal_actor_user_id, "string");
  assert.ok(opts.dismissal_actor_user_id.length > 0);
});

test("dismissDocketEntry projects result: authority identities are NOT leaked", async () => {
  const provide = makeProvider({
    getDocketEntry: async () => PROPOSED_ENTRY,
    dismissDocketEntry: async () => ({
      ...FULL_DOCKET_ROW,
      confirmation_state: "dismissed",
      // persistence row carries authority identities that MUST be stripped:
      tenant_id: "default-tenant",
      actor_user_id: "local-user",
      confirmation_actor_user_id: "local-user",
      dismissal_actor_user_id: "local-user",
    }),
  });
  const result = await dismissDocketEntryHandler({ ...VALID_DISMISS_DTO }, provide, clock);
  assert.equal(result.ok, true);
  const row = result.value;
  assert.equal("tenant_id" in row, false);
  assert.equal("actor_user_id" in row, false);
  assert.equal("confirmation_actor_user_id" in row, false);
  assert.equal("dismissal_actor_user_id" in row, false);
  assert.equal(row.confirmation_state, "dismissed");
});

test("dismissDocketEntry CONFIRMED entry cannot be dismissed; dismiss not called", async () => {
  let called = false;
  const provide = makeProvider({
    getDocketEntry: async () => ({ ...FULL_DOCKET_ROW, confirmation_state: "confirmed" }),
    dismissDocketEntry: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await dismissDocketEntryHandler({ ...VALID_DISMISS_DTO }, provide, clock);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(result.error.details?.schemaPath, "confirmation_state");
  assert.equal(called, false);
});

test("dismissDocketEntry ALREADY-DISMISSED entry cannot be dismissed; dismiss not called", async () => {
  let called = false;
  const provide = makeProvider({
    getDocketEntry: async () => ({ ...FULL_DOCKET_ROW, confirmation_state: "dismissed" }),
    dismissDocketEntry: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await dismissDocketEntryHandler({ ...VALID_DISMISS_DTO }, provide, clock);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(called, false);
});

test("dismissDocketEntry cross-matter/tenant entry → fail closed; dismiss not called", async () => {
  let called = false;
  const provide = makeProvider({
    getDocketEntry: async () => null, // scoped preflight finds nothing under this matter/tenant
    dismissDocketEntry: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await dismissDocketEntryHandler({ ...VALID_DISMISS_DTO }, provide, clock);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(called, false);
});

test("dismissDocketEntry unknown matter → unknown_matter; getDocketEntry not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => null,
    getDocketEntry: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await dismissDocketEntryHandler(
    { ...VALID_DISMISS_DTO, matterId: "01jz0000000000000000000099" },
    provide,
    clock,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(called, false);
});

test("dismissDocketEntry tenant mismatch → tenant_mismatch; getDocketEntry not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    getDocketEntry: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await dismissDocketEntryHandler({ ...VALID_DISMISS_DTO }, provide, clock);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(called, false);
});

// Provider whose persistence WRITE (and the scoped read) THROW if reached — used
// to prove validation/authority rejections never touch persistence.
function neverCalledProvider() {
  return makeProvider({
    getDocketEntry: async () => {
      throw new Error("getDocketEntry should not be called on a validation reject");
    },
    dismissDocketEntry: async () => {
      throw new Error("dismissDocketEntry should not be called on a validation reject");
    },
  });
}

test("dismissDocketEntry empty dismissal_reason → invalid_payload; persistence not called", async () => {
  const result = await dismissDocketEntryHandler(
    { matterId: FIXED_ID, entryId: PROPOSED_ENTRY.id, dismissal_reason: "" },
    neverCalledProvider(),
    clock,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "dismissal_reason");
});

test("dismissDocketEntry missing dismissal_reason → invalid_payload; persistence not called", async () => {
  const result = await dismissDocketEntryHandler(
    { matterId: FIXED_ID, entryId: PROPOSED_ENTRY.id },
    neverCalledProvider(),
    clock,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "dismissal_reason");
});

test("dismissDocketEntry rejects client-supplied authority/timestamp/state fields; persistence not called", async () => {
  for (const f of [
    "tenant_id",
    "actor_user_id",
    "dismissal_actor_user_id",
    "dismissed_at",
    "confirmation_state",
    "confirmation_actor_user_id",
    "confirmed_at",
    "confirmed_deadline_id",
  ]) {
    const result = await dismissDocketEntryHandler(
      { ...VALID_DISMISS_DTO, [f]: "evil" },
      neverCalledProvider(),
      clock,
    );
    assert.equal(result.ok, false, `${f} should be rejected`);
    assert.equal(result.error.details?.schemaPath, f, `${f} schemaPath`);
  }
});

test("dismissDocketEntry unknown field → invalid_payload; persistence not called", async () => {
  const result = await dismissDocketEntryHandler(
    { ...VALID_DISMISS_DTO, bogus: 1 },
    neverCalledProvider(),
    clock,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

// ---------- listFacts ----------

test("listFacts happy path returns page + injects tenant_id and matter_id", async () => {
  let received;
  const provide = makeProvider({
    listFacts: async (q) => {
      received = q;
      return {
        rows: [
          {
            id: "01jzfact00000000000000000a",
            statement_text: "Defendant filed answer on 2026-06-01.",
            status: "accepted",
            source_type: "lawyer_authored",
            created_at: "2026-06-01T00:00:00.000Z",
          },
        ],
        next_cursor: null,
      };
    },
  });
  const result = await listFactsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 1);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.matter_id, FIXED_ID);
});

test("listFacts passes limit + cursor through", async () => {
  let received;
  const provide = makeProvider({
    listFacts: async (q) => {
      received = q;
      return { rows: [], next_cursor: "next" };
    },
  });
  const result = await listFactsHandler({ matterId: FIXED_ID, limit: 4, cursor: "c1" }, provide);
  assert.equal(result.ok, true);
  assert.equal(received.limit, 4);
  assert.equal(received.cursor, "c1");
});

test("listFacts empty matterId → invalid_payload", async () => {
  const result = await listFactsHandler({ matterId: "" }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listFacts forbidden field tenant_id → invalid_payload", async () => {
  const result = await listFactsHandler({ matterId: FIXED_ID, tenant_id: "evil" }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.details?.schemaPath, "tenant_id");
});

test("listFacts unknown field → invalid_payload", async () => {
  const result = await listFactsHandler({ matterId: FIXED_ID, bogus: 1 }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listFacts non-integer limit → invalid_payload", async () => {
  const result = await listFactsHandler({ matterId: FIXED_ID, limit: 3.3 }, makeProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("listFacts absent matter → unknown_matter; listFacts not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => null,
    listFacts: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await listFactsHandler({ matterId: "01jz0000000000000000000099" }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_matter");
  assert.equal(called, false);
});

test("listFacts tenant mismatch → tenant_mismatch; listFacts not called", async () => {
  let called = false;
  const provide = makeProvider({
    getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant" }),
    listFacts: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  const result = await listFactsHandler({ matterId: FIXED_ID }, provide);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_mismatch");
  assert.equal(called, false);
});

// ===========================================================================
// WI-601 — docket-entry create + confirm IPC (deadline write path)
// ===========================================================================
const ENTRY_ID = "01jz000000000000000000ent0";
const DEADLINE_ID = "01jz0000000000000000000dl0";

// A docket-aware provider. getMatter returns an active-tenant matter for FIXED_ID.
// appendDocketEntry echoes the input as the stored row (+ extra authority field to
// prove projection strips it). getDocketEntry is SCOPED: returns the proposed entry
// only when tenant+matter+entry all match the seeded values; null otherwise.
// confirmDocketEntry is a spy that records invocation.
function makeDocketProvider(overrides = {}) {
  const calls = { confirm: 0 };
  const seeded = overrides.seededEntry; // { tenant_id, matter_id, entry_id } or undefined
  const persistence = {
    getMatter: async (id) =>
      id === FIXED_ID ? { id: FIXED_ID, tenant_id: "default-tenant", status: "active" } : null,
    appendDocketEntry: async (input) => ({
      ...input,
      // server-authority field present on the stored row — projection MUST strip it:
      tenant_id: "default-tenant",
      actor_user_id: "local-user",
    }),
    getDocketEntry: async (q) => {
      if (
        seeded &&
        q.tenant_id === seeded.tenant_id &&
        q.matter_id === seeded.matter_id &&
        q.entry_id === seeded.entry_id
      ) {
        return { id: q.entry_id, matter_id: q.matter_id, confirmation_state: "proposed", tenant_id: q.tenant_id };
      }
      return null;
    },
    confirmDocketEntry: async (entryId, opts) => {
      calls.confirm += 1;
      return {
        entry: { id: entryId, matter_id: FIXED_ID, confirmation_state: "confirmed", confirmed_deadline_id: opts.deadline_id, tenant_id: "default-tenant", actor_user_id: "local-user", confirmation_actor_user_id: opts.confirmation_actor_user_id },
        deadline: { id: opts.deadline_id, matter_id: FIXED_ID, kind: "filing", due_at: "2026-06-15T17:00:00.000Z", owner_user_id: "local-user", status: "pending", tenant_id: "default-tenant", actor_user_id: "local-user" },
        idempotent: false,
      };
    },
    ...(overrides.persistence ?? {}),
  };
  return { provide: () => ({ persistence }), calls };
}

const validCreateDto = {
  matterId: FIXED_ID,
  proposed_kind: "filing",
  proposed_due_at: "2026-06-15T17:00:00.000Z",
  proposed_due_at_timezone: "America/New_York",
};

test("docketCreate: valid matter -> ok, projected PROPOSED entry, authority stripped", async () => {
  const { provide } = makeDocketProvider();
  const r = await createDocketEntryHandler(validCreateDto, provide, clock, idFactory);
  assert.equal(r.ok, true);
  assert.equal(r.value.confirmation_state, "proposed");
  assert.equal(r.value.source_type, "manual");
  assert.equal(r.value.extractor_name, null);
  assert.equal(r.value.proposed_kind, "filing");
  // server-authority fields must NOT cross the boundary
  assert.equal("tenant_id" in r.value, false);
  assert.equal("actor_user_id" in r.value, false);
});

test("docketCreate: unknown matter -> unknown_matter", async () => {
  const { provide } = makeDocketProvider();
  const r = await createDocketEntryHandler({ ...validCreateDto, matterId: "01jz0000000000000000000xxx" }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
});

test("docketCreate: wrong-tenant matter -> tenant_mismatch", async () => {
  const { provide } = makeDocketProvider({
    persistence: { getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant", status: "active" }) },
  });
  const r = await createDocketEntryHandler(validCreateDto, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
});

test("docketCreate: forbidden server-authority field -> invalid_payload", async () => {
  const { provide } = makeDocketProvider();
  const r = await createDocketEntryHandler({ ...validCreateDto, tenant_id: "x" }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("docketCreate: missing proposed_kind -> invalid_payload", async () => {
  const { provide } = makeDocketProvider();
  const { proposed_kind, ...noKind } = validCreateDto;
  const r = await createDocketEntryHandler(noKind, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("docketConfirm: valid -> ok, materialized deadline projected (authority stripped)", async () => {
  const { provide, calls } = makeDocketProvider({
    seededEntry: { tenant_id: "default-tenant", matter_id: FIXED_ID, entry_id: ENTRY_ID },
  });
  const r = await confirmDocketEntryHandler({ matterId: FIXED_ID, entryId: ENTRY_ID }, provide, clock, idFactory);
  assert.equal(r.ok, true);
  assert.equal(calls.confirm, 1);
  assert.equal(r.value.deadline.kind, "filing");
  assert.equal("tenant_id" in r.value.deadline, false);
  assert.equal("actor_user_id" in r.value.deadline, false);
  assert.equal("tenant_id" in r.value.entry, false);
  assert.equal("confirmation_actor_user_id" in r.value.entry, false);
});

test("docketConfirm: UNKNOWN entry_id -> invalid_payload, confirmDocketEntry NOT called", async () => {
  const { provide, calls } = makeDocketProvider({ seededEntry: undefined }); // getDocketEntry always null
  const r = await confirmDocketEntryHandler({ matterId: FIXED_ID, entryId: ENTRY_ID }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.confirm, 0);
});

test("docketConfirm: WRONG-MATTER entry_id -> invalid_payload, confirm NOT called", async () => {
  // entry seeded under a DIFFERENT matter; confirm requested under FIXED_ID -> scoped miss
  const { provide, calls } = makeDocketProvider({
    seededEntry: { tenant_id: "default-tenant", matter_id: "01jz000000000000000000oth0", entry_id: ENTRY_ID },
  });
  const r = await confirmDocketEntryHandler({ matterId: FIXED_ID, entryId: ENTRY_ID }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.confirm, 0);
});

test("docketConfirm: WRONG-TENANT entry_id -> invalid_payload, confirm NOT called", async () => {
  // entry seeded under a DIFFERENT tenant; active tenant is default-tenant -> scoped miss
  const { provide, calls } = makeDocketProvider({
    seededEntry: { tenant_id: "other-tenant", matter_id: FIXED_ID, entry_id: ENTRY_ID },
  });
  const r = await confirmDocketEntryHandler({ matterId: FIXED_ID, entryId: ENTRY_ID }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.confirm, 0);
});

test("docketConfirm: unknown matter -> unknown_matter (before entry preflight)", async () => {
  const { provide, calls } = makeDocketProvider({ seededEntry: { tenant_id: "default-tenant", matter_id: FIXED_ID, entry_id: ENTRY_ID } });
  const r = await confirmDocketEntryHandler({ matterId: "01jz0000000000000000000xxx", entryId: ENTRY_ID }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(calls.confirm, 0);
});

// ===========================================================================
// WI-602 — fact create IPC (claims / timeline write path)
// ===========================================================================

// A fact-aware provider. getMatter returns an active-tenant matter for FIXED_ID.
// appendFact records the constructed input and echoes it as the stored row, plus
// the server-authority identities (tenant_id / actor_user_id /
// reviewer_actor_user_id) to prove the projection strips them. A scoped spy
// records whether appendFact was reached (the matter/tenant guards must run first).
function makeFactProvider(overrides = {}) {
  const calls = { append: 0 };
  let received;
  const persistence = {
    getMatter: async (id) =>
      id === FIXED_ID ? { id: FIXED_ID, tenant_id: "default-tenant", status: "active" } : null,
    appendFact: async (input) => {
      calls.append += 1;
      received = input;
      return {
        ...input,
        // server-authority fields present on the stored row — projection MUST strip:
        tenant_id: "default-tenant",
        actor_user_id: "local-user",
        reviewer_actor_user_id: null,
      };
    },
    ...(overrides.persistence ?? {}),
  };
  return { provide: () => ({ persistence }), calls, getReceived: () => received };
}

const validFactDto = { matterId: FIXED_ID, statement_text: "Defendant filed answer on 2026-06-01." };

test("CHANNEL.factCreate matches contract pattern casebox:fact:create", () => {
  assert.equal(CHANNEL.factCreate, "casebox:fact:create");
});

test("factCreate: valid (no purpose) -> ok, candidate lawyer_authored, authority stripped", async () => {
  const { provide, getReceived } = makeFactProvider();
  const r = await createFactHandler(validFactDto, provide, clock, idFactory);
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "candidate");
  assert.equal(r.value.source_type, "lawyer_authored");
  assert.equal(r.value.statement_text, validFactDto.statement_text);
  assert.equal(r.value.matter_id, FIXED_ID);
  // provenance + review fields null on a manual candidate fact
  assert.equal(r.value.source_document_id, null);
  assert.equal(r.value.reviewed_at, null);
  // server-authority identities must NOT cross the boundary
  assert.equal("tenant_id" in r.value, false);
  assert.equal("actor_user_id" in r.value, false);
  assert.equal("reviewer_actor_user_id" in r.value, false);
  // server-injected authority on the persistence INPUT
  const received = getReceived();
  assert.equal(received.id, FIXED_ID);
  assert.equal(received.tenant_id, "default-tenant");
  assert.equal(received.actor_user_id, "local-user");
  assert.equal(received.created_at, FIXED_NOW.toISOString());
  // no purpose / as_of_date supplied => not injected (persistence defaults purpose)
  assert.equal("purpose" in received, false);
  assert.equal("as_of_date" in received, false);
});

test("factCreate: purpose=timeline_event WITHOUT as_of_date -> invalid_payload, appendFact NOT called", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await createFactHandler({ ...validFactDto, purpose: "timeline_event" }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.append, 0);
});

test("factCreate: purpose=timeline_event WITH valid as_of_date -> ok, fields passed through", async () => {
  const { provide, getReceived } = makeFactProvider();
  const r = await createFactHandler(
    { ...validFactDto, purpose: "timeline_event", as_of_date: "2026-06-15" },
    provide,
    clock,
    idFactory,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.purpose, "timeline_event");
  assert.equal(r.value.as_of_date, "2026-06-15");
  const received = getReceived();
  assert.equal(received.purpose, "timeline_event");
  assert.equal(received.as_of_date, "2026-06-15");
});

test("factCreate: malformed as_of_date (time component) under non-timeline purpose -> invalid_payload", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await createFactHandler(
    { ...validFactDto, purpose: "claim", as_of_date: "2026-06-15T17:00:00Z" },
    provide,
    clock,
    idFactory,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.append, 0);
});

test("factCreate: malformed as_of_date with NO purpose -> invalid_payload (format rule applies always)", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await createFactHandler({ ...validFactDto, as_of_date: "not-a-date" }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.append, 0);
});

test("factCreate: invalid purpose -> invalid_payload", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await createFactHandler({ ...validFactDto, purpose: "nonsense" }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.append, 0);
});

test("factCreate: unknown matter -> unknown_matter; appendFact NOT called", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await createFactHandler({ ...validFactDto, matterId: "01jz0000000000000000000xxx" }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(calls.append, 0);
});

test("factCreate: wrong-tenant matter -> tenant_mismatch; appendFact NOT called", async () => {
  const { provide, calls } = makeFactProvider({
    persistence: { getMatter: async () => ({ id: FIXED_ID, tenant_id: "other-tenant", status: "active" }) },
  });
  const r = await createFactHandler(validFactDto, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(calls.append, 0);
});

test("factCreate: forbidden server-authority field (actor_user_id) -> invalid_payload", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await createFactHandler({ ...validFactDto, actor_user_id: "evil" }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "actor_user_id");
  assert.equal(calls.append, 0);
});

test("factCreate: missing statement_text -> invalid_payload", async () => {
  const { provide } = makeFactProvider();
  const r = await createFactHandler({ matterId: FIXED_ID }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("factCreate: unknown field -> invalid_payload", async () => {
  const { provide } = makeFactProvider();
  const r = await createFactHandler({ ...validFactDto, bogus: 1 }, provide, clock, idFactory);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});
