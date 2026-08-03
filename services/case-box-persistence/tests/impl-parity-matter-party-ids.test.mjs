// WI-PTA-VS0 Phase C — in-memory ↔ SQLite parity for matter party-identity
// (create-time assignment + audited ensureMatterPartyIds backfill), incl.
// error-code parity and the SQLite structural audit invariant.
//
// Uses makeAuditPair() (SHARED id prefix) so audit-event hash chains match
// byte-identically across both impls. Both impls run the same operations in
// the same order, so their independent deterministic id counters stay in
// lockstep.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CaseBoxPersistenceError } from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";
import {
  setStoredMatterPartiesInMemory,
  setStoredMatterPartiesSqlite,
  setStoredMatterPartiesSqliteNoRealign,
  stripPartyIds,
} from "./internals.mjs";

const THREE_IDLESS_PARTIES = [
  { role: "client", display_name: "ACME Corp", party_kind: "organization" },
  { role: "opposing", display_name: "Globex", party_kind: "organization" },
  { role: "third_party", display_name: "Jane Doe", party_kind: "individual" },
];

async function listEvents(p) {
  return (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows;
}

// ---------------------------------------------------------------------------
// Create-time assignment parity
// ---------------------------------------------------------------------------

test("PTA-VS0 parity: createMatter id-fills parties identically (matter + audit)", async () => {
  const { inMem, sqlite } = makeAuditPair();
  const input = makeMatterInput({ parties: THREE_IDLESS_PARTIES });
  const im = await inMem.createMatter(input);
  const sq = await sqlite.createMatter(input);
  assert.deepEqual(sq, im);

  const imGet = await inMem.getMatter(DEFAULT_MATTER_ID);
  const sqGet = await sqlite.getMatter(DEFAULT_MATTER_ID);
  assert.deepEqual(sqGet, imGet);
  // Audit chains byte-identical (shared id prefix).
  assert.deepEqual(await listEvents(sqlite), await listEvents(inMem));
});

test("PTA-VS0 parity: duplicate caller party ids rejected identically", async () => {
  const { inMem, sqlite } = makeAuditPair();
  const input = makeMatterInput({
    parties: [
      { id: "01jcasepartydupeid00000001", role: "client", display_name: "ACME Corp", party_kind: "organization" },
      { id: "01jcasepartydupeid00000001", role: "opposing", display_name: "Globex", party_kind: "organization" },
    ],
  });
  let imErr, sqErr;
  try { await inMem.createMatter(input); } catch (e) { imErr = e; }
  try { await sqlite.createMatter(input); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr, "both impls must reject duplicate caller party ids");
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "invalid_payload");
});

// ---------------------------------------------------------------------------
// Backfill parity
// ---------------------------------------------------------------------------

/** Create the same matter on both impls, then downgrade both to a legacy
 *  id-less state via the impl-specific seam (no id generation on either). */
async function bothLegacyIdless(pair) {
  const { inMem, sqlite, db } = pair;
  await inMem.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  await sqlite.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  const idless = stripPartyIds(THREE_IDLESS_PARTIES);
  setStoredMatterPartiesInMemory(inMem, DEFAULT_MATTER_ID, idless);
  setStoredMatterPartiesSqlite(db, DEFAULT_MATTER_ID, idless);
}

test("PTA-VS0 parity: ensureMatterPartyIds backfill matches (matter + one MATTER_PARTY_IDS_ASSIGNED)", async () => {
  const pair = makeAuditPair();
  const { inMem, sqlite } = pair;
  await bothLegacyIdless(pair);

  const im = await inMem.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  const sq = await sqlite.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  assert.deepEqual(sq, im);

  const imGet = await inMem.getMatter(DEFAULT_MATTER_ID);
  const sqGet = await sqlite.getMatter(DEFAULT_MATTER_ID);
  assert.deepEqual(sqGet, imGet);

  const imEvents = await listEvents(inMem);
  const sqEvents = await listEvents(sqlite);
  assert.deepEqual(sqEvents, imEvents);
  assert.equal(imEvents.length, 2);
  assert.equal(imEvents[1].event_kind, "MATTER_PARTY_IDS_ASSIGNED");
});

test("PTA-VS0 parity: SQLite structural invariant event_count == COUNT(*) == MAX(sequence)", async () => {
  const pair = makeAuditPair();
  const { sqlite, db } = pair;
  await bothLegacyIdless(pair);
  await sqlite.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });

  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const agg = db
    .prepare("SELECT COUNT(*) AS c, MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, agg.c);
  assert.equal(head.event_count, agg.m);
  assert.equal(head.event_count, 2);

  const verify = await sqlite.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(verify.ok, true);
});

test("PTA-VS0 parity: backfill is idempotent identically (no write, no event)", async () => {
  const pair = makeAuditPair();
  const { inMem, sqlite } = pair;
  await bothLegacyIdless(pair);
  await inMem.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  await sqlite.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });

  const imAgain = await inMem.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "other" });
  const sqAgain = await sqlite.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "other" });
  assert.deepEqual(sqAgain, imAgain);
  assert.deepEqual(await listEvents(sqlite), await listEvents(inMem));
  assert.equal((await listEvents(inMem)).length, 2, "idempotent re-run emits no extra event");
});

// ---------------------------------------------------------------------------
// Error-code parity
// ---------------------------------------------------------------------------

test("PTA-VS0 parity: unknown matter → unknown_matter on both", async () => {
  const { inMem, sqlite } = makeAuditPair();
  let imErr, sqErr;
  try { await inMem.ensureMatterPartyIds("01nonexistmatter00000000xx", { actorUserId: "a" }); } catch (e) { imErr = e; }
  try { await sqlite.ensureMatterPartyIds("01nonexistmatter00000000xx", { actorUserId: "a" }); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr);
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "unknown_matter");
});

test("PTA-VS0 parity: empty actorUserId → invalid_argument on both", async () => {
  const pair = makeAuditPair();
  const { inMem, sqlite } = pair;
  await bothLegacyIdless(pair);
  let imErr, sqErr;
  try { await inMem.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "" }); } catch (e) { imErr = e; }
  try { await sqlite.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "" }); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr);
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "invalid_argument");
});

test("PTA-VS0 parity: FIX 1 — desynced SQLite payload fails closed; transaction rolls back", async () => {
  const { sqlite, db } = makeAuditPair();
  await sqlite.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  // Rewrite the payload to id-less parties WITHOUT re-aligning the seed event /
  // chain head → the stored payload is out of sync with the chain.
  setStoredMatterPartiesSqliteNoRealign(db, DEFAULT_MATTER_ID, stripPartyIds(THREE_IDLESS_PARTIES));

  const headBefore = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).event_count;
  const payloadBefore = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(DEFAULT_MATTER_ID).payload_json;

  let caught;
  try {
    await sqlite.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "backfill-actor" });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof CaseBoxPersistenceError);
  assert.equal(caught.code, "audit_chain_desync");

  // BEGIN IMMEDIATE rolled back: no event insert, no head advance, no payload rewrite.
  const headAfter = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).event_count;
  const payloadAfter = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(DEFAULT_MATTER_ID).payload_json;
  const rowCount = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID).c;
  assert.equal(headAfter, headBefore, "no head advance on desync");
  assert.equal(rowCount, headBefore, "no audit-event row inserted on desync");
  assert.equal(payloadAfter, payloadBefore, "no payload rewrite on desync");
});

test("PTA-VS0 parity: duplicate existing party ids → invalid_payload on both", async () => {
  const pair = makeAuditPair();
  const { inMem, sqlite, db } = pair;
  await inMem.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  await sqlite.createMatter(makeMatterInput({ parties: THREE_IDLESS_PARTIES }));
  const dupeParties = [
    { id: "01jcasepartydupeid00000001", role: "client", display_name: "ACME Corp", party_kind: "organization" },
    { id: "01jcasepartydupeid00000001", role: "opposing", display_name: "Globex", party_kind: "organization" },
    { role: "third_party", display_name: "Jane Doe", party_kind: "individual" },
  ];
  setStoredMatterPartiesInMemory(inMem, DEFAULT_MATTER_ID, dupeParties);
  setStoredMatterPartiesSqlite(db, DEFAULT_MATTER_ID, dupeParties);

  let imErr, sqErr;
  try { await inMem.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "a" }); } catch (e) { imErr = e; }
  try { await sqlite.ensureMatterPartyIds(DEFAULT_MATTER_ID, { actorUserId: "a" }); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr);
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "invalid_payload");
});
