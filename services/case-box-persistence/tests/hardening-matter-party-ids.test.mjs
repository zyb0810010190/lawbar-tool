// WI-PTA-VS0 Phase C — matter party-identity behavior (in-memory).
//
// Two behaviors:
//   1. create-time assignment — createMatter server-assigns a ULID to every
//      id-less party BEFORE the MATTER_REGISTERED hash; rejects duplicate
//      caller ids; generated ids are collision-free.
//   2. ensureMatterPartyIds(matterId, { actorUserId }) — audited backfill of a
//      legacy id-less matter: one MATTER_PARTY_IDS_ASSIGNED event, explicit
//      actor, state-hash continuity, idempotent, rejects duplicate existing ids.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  InMemoryCaseBoxPersistence,
} from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import {
  entityStateHash,
  setStoredMatterPartiesInMemory,
  setStoredMatterPartiesInMemoryNoRealign,
  stripPartyIds,
} from "./internals.mjs";

const ULID_RE = /^[0-9a-z]{26}$/;

function make(prefix) {
  return new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-20T09:00:00.000Z"),
    generateId: makeIdGenerator(prefix),
  });
}

const THREE_IDLESS_PARTIES = [
  { role: "client", display_name: "ACME Corp", party_kind: "organization" },
  { role: "opposing", display_name: "Globex", party_kind: "organization" },
  { role: "third_party", display_name: "Jane Doe", party_kind: "individual" },
];

// ---------------------------------------------------------------------------
// Behavior 1 — create-time assignment
// ---------------------------------------------------------------------------

test("PTA-VS0 create: every id-less party gets a ULID id", async () => {
  const p = make("ptac1");
  const created = await p.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  assert.equal(created.parties.length, 3);
  for (const party of created.parties) {
    assert.match(party.id, ULID_RE, `party ${party.display_name} must get a ULID id`);
  }
  const stored = await p.getMatter(DEFAULT_MATTER_ID);
  for (const party of stored.parties) {
    assert.match(party.id, ULID_RE);
  }
});

test("PTA-VS0 create: MATTER_REGISTERED hashes the id-ful state; no MATTER_PARTY_IDS_ASSIGNED", async () => {
  const p = make("ptac2");
  await p.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].event_kind, "MATTER_REGISTERED");
  // The single seed event's after_state_hash must equal the hash of the stored
  // (id-ful) matter — i.e. it hashed the state WITH party ids.
  const stored = await p.getMatter(DEFAULT_MATTER_ID);
  assert.equal(page.rows[0].after_state_hash, entityStateHash(stored));
  // No backfill event on the create path.
  const kinds = page.rows.map((r) => r.event_kind);
  assert.ok(!kinds.includes("MATTER_PARTY_IDS_ASSIGNED"), "create must not emit MATTER_PARTY_IDS_ASSIGNED");
});

test("PTA-VS0 create: generated party ids are collision-free (all distinct)", async () => {
  const p = make("ptac3");
  const created = await p.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  const ids = created.parties.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, "all generated party ids must be distinct");
});

test("PTA-VS0 create: a caller-supplied party id is preserved; id-less siblings get fresh distinct ids", async () => {
  const p = make("ptac4");
  const created = await p.createMatter(makeMatterInput({
    parties: [
      { id: "01jcasepartyfixedid0000001", role: "client", display_name: "ACME Corp", party_kind: "organization" },
      { role: "opposing", display_name: "Globex", party_kind: "organization" },
    ],
  }));
  assert.equal(created.parties[0].id, "01jcasepartyfixedid0000001");
  assert.match(created.parties[1].id, ULID_RE);
  assert.notEqual(created.parties[1].id, created.parties[0].id);
});

test("PTA-VS0 create: duplicate caller-supplied party ids → invalid_payload", async () => {
  const p = make("ptac5");
  let caught;
  try {
    await p.createMatter(makeMatterInput({
      parties: [
        { id: "01jcasepartydupeid00000001", role: "client", display_name: "ACME Corp", party_kind: "organization" },
        { id: "01jcasepartydupeid00000001", role: "opposing", display_name: "Globex", party_kind: "organization" },
      ],
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
});

test("PTA-VS0 create: caller input parties are NOT mutated", async () => {
  const p = make("ptac6");
  const input = makeMatterInput({ parties: [{ role: "client", display_name: "ACME Corp", party_kind: "organization" }] });
  await p.createMatter(input);
  assert.ok(!("id" in input.parties[0]), "caller's input party must remain id-less");
});

// ---------------------------------------------------------------------------
// Behavior 2 — ensureMatterPartyIds (audited backfill)
// ---------------------------------------------------------------------------

/** Create a matter then downgrade it to a legacy id-less state via the seam. */
async function makeLegacyIdlessMatter(prefix) {
  const p = make(prefix);
  await p.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  setStoredMatterPartiesInMemory(p, DEFAULT_MATTER_ID, stripPartyIds(THREE_IDLESS_PARTIES));
  return p;
}

test("PTA-VS0 backfill: assigns ULIDs + emits exactly one MATTER_PARTY_IDS_ASSIGNED for the passed actor", async () => {
  const p = await makeLegacyIdlessMatter("ptab1");
  const result = await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  for (const party of result.parties) assert.match(party.id, ULID_RE);

  const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
  const assigned = page.rows.filter((r) => r.event_kind === "MATTER_PARTY_IDS_ASSIGNED");
  assert.equal(assigned.length, 1, "exactly one MATTER_PARTY_IDS_ASSIGNED event");
  assert.equal(assigned[0].actor_user_id, "backfill-actor");
  // Actor attribution: NOT the matter's original creator (local-user).
  assert.notEqual(assigned[0].actor_user_id, "local-user");
  assert.equal(assigned[0].action, "update");
  assert.equal(assigned[0].entity_type, "matter");
});

test("PTA-VS0 backfill: state-hash continuity is direct + event_count==COUNT==MAX(sequence)", async () => {
  const p = await makeLegacyIdlessMatter("ptab2");
  await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });

  const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
  assert.equal(page.rows.length, 2);
  const prior = page.rows[0];
  const assigned = page.rows[1];
  assert.equal(assigned.event_kind, "MATTER_PARTY_IDS_ASSIGNED");

  // (a) before_state_hash of the new event == after_state_hash of the prior event.
  assert.equal(assigned.before_state_hash, prior.after_state_hash);
  // (b) after_state_hash of the new event == hash of the rewritten stored matter.
  const stored = await p.getMatter(DEFAULT_MATTER_ID);
  assert.equal(assigned.after_state_hash, entityStateHash(stored));
  // (c) prev_event_hash links back to the prior event (64-hex).
  assert.match(assigned.prev_event_hash, /^[0-9a-f]{64}$/);

  // event_count == COUNT == MAX(sequence). In-memory sequences are 1..n so
  // MAX(sequence) == rows.length; getAuditChainHead.count is event_count.
  const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(head.count, page.rows.length);
  assert.equal(head.count, 2);

  const verify = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(verify.ok, true);
  assert.equal(verify.verifiedCount, 2);
});

test("PTA-VS0 backfill: idempotent — re-run with all ids present writes nothing, emits no event", async () => {
  const p = await makeLegacyIdlessMatter("ptab3");
  await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  const before = await p.getMatter(DEFAULT_MATTER_ID);
  const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);

  const again = await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "someone-else" });
  const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);

  assert.deepEqual(again, before, "idempotent re-run returns the unchanged matter");
  assert.equal(headAfter.count, headBefore.count, "no new audit event on idempotent re-run");
  assert.equal(headAfter.headHash, headBefore.headHash, "head hash unchanged on idempotent re-run");
});

test("PTA-VS0 backfill: a freshly-created matter (ids already present) is a no-op", async () => {
  const p = make("ptab4");
  await p.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(headAfter.count, headBefore.count, "create already id-filled ⇒ backfill emits nothing");
  assert.equal(headAfter.count, 1);
});

test("PTA-VS0 backfill: unknown matter → unknown_matter", async () => {
  const p = make("ptab5");
  let caught;
  try {
    await p.ensureMatterPartyIds("01nonexistmatter00000000xx", { actorUserId: "backfill-actor" });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "unknown_matter");
});

test("PTA-VS0 backfill: empty actorUserId → invalid_argument", async () => {
  const p = await makeLegacyIdlessMatter("ptab6");
  let caught;
  try {
    await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "" });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_argument");
});

test("PTA-VS0 backfill: duplicate existing party ids → invalid_payload (no write)", async () => {
  const p = make("ptab7");
  await p.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  // Legacy state with two parties carrying the SAME id + one id-less.
  setStoredMatterPartiesInMemory(p, DEFAULT_MATTER_ID, [
    { id: "01jcasepartydupeid00000001", role: "client", display_name: "ACME Corp", party_kind: "organization" },
    { id: "01jcasepartydupeid00000001", role: "opposing", display_name: "Globex", party_kind: "organization" },
    { role: "third_party", display_name: "Jane Doe", party_kind: "individual" },
  ]);
  const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  let caught;
  try {
    await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_payload");
  const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(headAfter.count, headBefore.count, "rejected backfill must not write an event");
});

test("PTA-VS0 backfill: FIX 1 — desynced stored payload fails closed (audit_chain_desync, no write)", async () => {
  const p = make("ptab8");
  await p.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  // Rewrite the payload to id-less parties WITHOUT re-aligning the seed event's
  // after_state_hash → the stored payload is now out of sync with the chain.
  setStoredMatterPartiesInMemoryNoRealign(p, DEFAULT_MATTER_ID, stripPartyIds(THREE_IDLESS_PARTIES));
  const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  const storedBefore = await p.getMatter(DEFAULT_MATTER_ID);

  let caught;
  try {
    await p.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "audit_chain_desync");

  // Fail-closed: no event insert, no head advance, no payload rewrite.
  const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
  assert.equal(headAfter.count, headBefore.count, "no head advance on desync");
  assert.equal(headAfter.headHash, headBefore.headHash, "head hash unchanged on desync");
  const storedAfter = await p.getMatter(DEFAULT_MATTER_ID);
  assert.deepEqual(storedAfter, storedBefore, "no payload rewrite on desync");
  // Parties remain id-less (the guard fired before assignment was committed).
  for (const party of storedAfter.parties) {
    assert.ok(!("id" in party), "desynced matter must not be id-filled");
  }
});

test("PTA-VS0 create: FIX 2 — id generator that always collides fails bounded (invalid_argument)", async () => {
  // Generator always returns the SAME id → the second id-less party can never
  // get a unique id; the bounded retry must throw rather than infinite-loop.
  const stuck = "01jcasepartystuckid0000001";
  const p = new InMemoryCaseBoxPersistence({
    now: makeClock("2026-05-20T09:00:00.000Z"),
    generateId: () => stuck,
  });
  let caught;
  try {
    await p.createMatter(makeMatterInput({
      parties: [
        { role: "client", display_name: "ACME Corp", party_kind: "organization" },
        { role: "opposing", display_name: "Globex", party_kind: "organization" },
      ],
    }));
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "invalid_argument");
  // Nothing was stored (the create aborted before commit).
  const got = await p.getMatter(DEFAULT_MATTER_ID);
  assert.equal(got, null);
});
