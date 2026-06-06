// Fact-transition IPC unit tests (WI-802): casebox:fact:transition / review,
// accept, reject. In a NEW dedicated file (the WI-704-style split rule) — the
// monolithic ipc-handlers.unit.test.mjs is at the loc-guardian cap and is NOT
// touched. Instrumented in-memory persistence + the default active tenant/actor.

import test from "node:test";
import assert from "node:assert/strict";
import { transitionFactHandler } from "../dist/src/caseBox/factHandlers.js";
import { CHANNEL } from "../dist/src/caseBox/handlerShared.js";
import { CaseBoxPersistenceError } from "case-box-persistence";

const FIXED_NOW = new Date("2026-05-27T00:00:00.000Z");
const FIXED_NOW_ISO = FIXED_NOW.toISOString();
function clock() {
  return FIXED_NOW;
}

const MATTER_ID = "01jz0000000000000000000000";
const FACT_ID = "01jzfact00000000000000000a";

// A fact-aware provider. getMatter returns an active-tenant matter for MATTER_ID.
// getFact is SCOPED: returns the seeded fact only when tenant+matter+fact match.
// transitionFact is a spy that records the opts and echoes a transitioned fact
// (+ server-authority fields, to prove the projection strips them).
function makeFactProvider(overrides = {}) {
  const calls = { transition: 0 };
  let receivedOpts;
  const seeded = "seededFact" in overrides
    ? overrides.seededFact
    : { tenant_id: "default-tenant", matter_id: MATTER_ID, fact_id: FACT_ID };
  const persistence = {
    getMatter: async (id) =>
      id === MATTER_ID ? { id: MATTER_ID, tenant_id: "default-tenant", status: "active" } : null,
    getFact: async (q) => {
      if (
        seeded &&
        q.tenant_id === seeded.tenant_id &&
        q.matter_id === seeded.matter_id &&
        q.fact_id === seeded.fact_id
      ) {
        return { id: q.fact_id, matter_id: q.matter_id, status: "candidate", tenant_id: q.tenant_id };
      }
      return null;
    },
    transitionFact: async (factId, opts) => {
      calls.transition += 1;
      receivedOpts = opts;
      return {
        id: factId,
        matter_id: MATTER_ID,
        statement_text: "a fact",
        status: opts.to,
        source_type: "lawyer_authored",
        reviewed_at: opts.to === "reviewed" ? opts.at : null,
        accepted_at: opts.to === "accepted" ? opts.at : null,
        rejected_at: opts.to === "rejected" ? opts.at : null,
        rejection_reason: opts.rejection_reason ?? null,
        created_at: "2026-06-01T00:00:00.000Z",
        // server-authority fields present on the stored row — projection MUST strip:
        tenant_id: "default-tenant",
        actor_user_id: "local-user",
        reviewer_actor_user_id: opts.reviewer_actor_user_id,
      };
    },
    ...(overrides.persistence ?? {}),
  };
  return { provide: () => ({ persistence }), calls, getOpts: () => receivedOpts };
}

test("CHANNEL.factTransition matches contract pattern casebox:fact:transition", () => {
  assert.equal(CHANNEL.factTransition, "casebox:fact:transition");
});

test("transition: candidate -> reviewed -> ok, server injects reviewer+at, authority stripped", async () => {
  const { provide, getOpts } = makeFactProvider();
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "reviewed" }, provide, clock);
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "reviewed");
  // server injected the reviewer + timestamp:
  const opts = getOpts();
  assert.equal(opts.reviewer_actor_user_id, "local-user");
  assert.equal(opts.at, FIXED_NOW_ISO);
  assert.equal("rejection_reason" in opts, false);
  // authority identities never cross the boundary:
  assert.equal("tenant_id" in r.value, false);
  assert.equal("actor_user_id" in r.value, false);
  assert.equal("reviewer_actor_user_id" in r.value, false);
});

test("transition: candidate -> rejected with reason -> ok, reason forwarded", async () => {
  const { provide, getOpts } = makeFactProvider();
  const r = await transitionFactHandler(
    { matterId: MATTER_ID, factId: FACT_ID, to: "rejected", rejection_reason: "not supported by the record" },
    provide,
    clock,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "rejected");
  assert.equal(r.value.rejection_reason, "not supported by the record");
  assert.equal(getOpts().rejection_reason, "not supported by the record");
});

test("transition: reviewed -> accepted -> ok", async () => {
  const { provide } = makeFactProvider();
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "accepted" }, provide, clock);
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "accepted");
});

test("transition: rejected WITHOUT rejection_reason -> invalid_payload, transitionFact NOT called", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "rejected" }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.transition, 0);
});

test("transition: rejection_reason supplied for a non-rejected target -> invalid_payload, NOT called", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await transitionFactHandler(
    { matterId: MATTER_ID, factId: FACT_ID, to: "reviewed", rejection_reason: "x" },
    provide,
    clock,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "rejection_reason");
  assert.equal(calls.transition, 0);
});

test("transition: invalid `to` value -> invalid_payload", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "candidate" }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.transition, 0);
});

test("transition: unknown matter -> unknown_matter, transitionFact NOT called", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await transitionFactHandler({ matterId: "01jz0000000000000000000xxx", factId: FACT_ID, to: "reviewed" }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_matter");
  assert.equal(calls.transition, 0);
});

test("transition: wrong-tenant matter -> tenant_mismatch, NOT called", async () => {
  const { provide, calls } = makeFactProvider({
    persistence: { getMatter: async () => ({ id: MATTER_ID, tenant_id: "other-tenant", status: "active" }) },
  });
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "reviewed" }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "tenant_mismatch");
  assert.equal(calls.transition, 0);
});

test("transition: foreign/unknown factId (scoped getFact miss) -> invalid_payload, fail-closed", async () => {
  const { provide, calls } = makeFactProvider({ seededFact: undefined }); // getFact always null
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "reviewed" }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.transition, 0, "transitionFact NOT called on a scoped fact miss");
});

test("transition: WRONG-MATTER factId -> invalid_payload, NOT called", async () => {
  // fact seeded under a DIFFERENT matter; transition requested under MATTER_ID.
  const { provide, calls } = makeFactProvider({
    seededFact: { tenant_id: "default-tenant", matter_id: "01jz000000000000000000oth0", fact_id: FACT_ID },
  });
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "reviewed" }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(calls.transition, 0);
});

test("transition: illegal domain transition surfaces illegal_transition (not re-implemented)", async () => {
  // The handler does not block candidate->accepted; persistence throws illegal_transition.
  const { provide } = makeFactProvider({
    persistence: {
      transitionFact: async () => {
        throw new CaseBoxPersistenceError("illegal_transition", "candidate cannot transition directly to accepted");
      },
    },
  });
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "accepted" }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "illegal_transition");
});

test("transition: forbidden server-authority field (reviewer_actor_user_id) -> invalid_payload", async () => {
  const { provide, calls } = makeFactProvider();
  const r = await transitionFactHandler(
    { matterId: MATTER_ID, factId: FACT_ID, to: "reviewed", reviewer_actor_user_id: "evil" },
    provide,
    clock,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "reviewer_actor_user_id");
  assert.equal(calls.transition, 0);
});

test("transition: forbidden lifecycle field (status) -> invalid_payload", async () => {
  const { provide } = makeFactProvider();
  const r = await transitionFactHandler(
    { matterId: MATTER_ID, factId: FACT_ID, to: "reviewed", status: "accepted" },
    provide,
    clock,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
  assert.equal(r.error.details?.schemaPath, "status");
});

test("transition: unknown field -> invalid_payload", async () => {
  const { provide } = makeFactProvider();
  const r = await transitionFactHandler({ matterId: MATTER_ID, factId: FACT_ID, to: "reviewed", bogus: 1 }, provide, clock);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid_payload");
});

test("transition: missing matterId / factId -> invalid_payload", async () => {
  const { provide } = makeFactProvider();
  const r1 = await transitionFactHandler({ factId: FACT_ID, to: "reviewed" }, provide, clock);
  assert.equal(r1.error.code, "invalid_payload");
  const r2 = await transitionFactHandler({ matterId: MATTER_ID, to: "reviewed" }, provide, clock);
  assert.equal(r2.error.code, "invalid_payload");
});
