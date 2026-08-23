// Hardening: WI-PTA-VS1 claim-track invariants (SQLite path). Mirrors
// hardening-evidence.test.mjs. NEW file.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";
import {
  DEFAULT_CLAIM_TRACK_ID,
  DEFAULT_TENANT_ID,
  makeClaimTrackInput,
  makeMatterWithClaimPartiesInput,
} from "./conformance/fixtures.mjs";
import { entityStateHash } from "../dist/auditChain.js";

test("Sqlite-VS1: createClaimTrack rejects a schema-invalid payload (invalid_payload)", async () => {
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("ct1"),
  });
  await persistence.createMatter(makeMatterWithClaimPartiesInput());
  let err;
  try {
    // Missing required `title`.
    const bad = makeClaimTrackInput();
    delete bad.title;
    await persistence.createClaimTrack(bad);
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "invalid_payload");
});

test("Sqlite-VS1: createClaimTrack rejects a duplicate id (duplicate_id)", async () => {
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("ct2"),
  });
  await persistence.createMatter(makeMatterWithClaimPartiesInput());
  await persistence.createClaimTrack(makeClaimTrackInput());
  let err;
  try {
    await persistence.createClaimTrack(makeClaimTrackInput());
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "duplicate_id");
});

test("Sqlite-VS1: audit-chain atomic — red-before/green-after CLAIM_TRACK_CREATED; event_count==COUNT==MAX(sequence)", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("ct3"),
  });
  await persistence.createMatter(makeMatterWithClaimPartiesInput());
  // RED: before the create, no claim_track audit row exists.
  const before = db
    .prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ? AND entity_type = 'claim_track'")
    .get(DEFAULT_MATTER_ID);
  assert.equal(before.c, 0);

  const created = await persistence.createClaimTrack(makeClaimTrackInput());

  // GREEN: exactly one CLAIM_TRACK_CREATED row (action=create, entity_type=claim_track).
  const evRows = db
    .prepare("SELECT action, entity_type FROM case_box_audit_events WHERE matter_id = ? AND entity_type = 'claim_track'")
    .all(DEFAULT_MATTER_ID);
  assert.equal(evRows.length, 1);
  assert.equal(evRows[0].action, "create");
  assert.equal(evRows[0].entity_type, "claim_track");

  // The emitted event row's content is pinned, not just its shape:
  //   - action:create → before_state_hash IS NULL;
  //   - after_state_hash === entityStateHash(created claim-track row);
  //   - entity_id === the claim-track id;
  //   - event_kind (in event_json; no lifted column) is exactly CLAIM_TRACK_CREATED.
  const ev = db
    .prepare(
      "SELECT entity_id, before_state_hash, after_state_hash, event_json FROM case_box_audit_events WHERE matter_id = ? AND entity_type = 'claim_track'",
    )
    .get(DEFAULT_MATTER_ID);
  assert.equal(ev.before_state_hash, null, "create event must have a null before_state_hash");
  assert.equal(ev.after_state_hash, entityStateHash(created), "after_state_hash must equal the created row's entity state hash");
  assert.equal(ev.entity_id, DEFAULT_CLAIM_TRACK_ID, "entity_id must equal the claim-track id");
  assert.equal(created.id, DEFAULT_CLAIM_TRACK_ID);
  const parsedEvent = JSON.parse(ev.event_json);
  assert.equal(parsedEvent.event_kind, "CLAIM_TRACK_CREATED", "event_kind must be exactly CLAIM_TRACK_CREATED");

  // A single claim-track row landed.
  const trackRows = db.prepare("SELECT COUNT(*) AS c FROM case_box_claim_tracks WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(trackRows.c, 1);

  // event_count == COUNT(*) == MAX(sequence): createMatter (1) + createClaimTrack (1) = 2.
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 2);
  assert.equal(count.c, 2);
  assert.equal(maxSeq.m, 2);
});

test("Sqlite-VS1: a failure during the audit write rolls back the whole transaction (no orphan row, no claim_track event)", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("ct7"),
  });
  await persistence.createMatter(makeMatterWithClaimPartiesInput());

  // Force a mid-transaction failure. createClaimTrack runs, inside ONE
  // BEGIN IMMEDIATE, insertClaimTrackRow (the row INSERT) and THEN the audit
  // INSERT. Pre-plant a case_box_audit_events row occupying the exact
  // (matter_id, sequence) the new CLAIM_TRACK_CREATED event will take (the chain
  // head's event_count + 1) so the audit INSERT violates
  // UNIQUE(matter_id, sequence) and throws AFTER the claim-track row was already
  // inserted in the same transaction. entity_type is deliberately NOT
  // 'claim_track' so the decoy does not pollute the claim_track count below.
  const head = db
    .prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(DEFAULT_MATTER_ID);
  const collidingSequence = head.event_count + 1;
  db.prepare(
    `INSERT INTO case_box_audit_events
       (event_id, tenant_id, matter_id, sequence, action, entity_type, actor_user_id, timestamp, event_hash, event_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "planted-sequence-collision",
    DEFAULT_TENANT_ID,
    DEFAULT_MATTER_ID,
    collidingSequence,
    "create",
    "matter",
    "local-user",
    "2026-05-22T09:00:00.000Z",
    "deadbeefdeadbeef",
    "{}",
  );

  await assert.rejects(
    () => persistence.createClaimTrack(makeClaimTrackInput()),
    /UNIQUE|constraint/i,
    "the colliding audit INSERT must throw and abort createClaimTrack",
  );

  // BEGIN IMMEDIATE rolled the whole write back: the claim-track row insert did
  // NOT survive, and no CLAIM_TRACK_CREATED audit event landed.
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM case_box_claim_tracks").get().c,
    0,
    "the claim-track row insert must roll back with the failed audit write",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE entity_type = 'claim_track'").get().c,
    0,
    "no CLAIM_TRACK_CREATED audit event may persist after rollback",
  );
  db.close();
});

test("Sqlite-VS1: createClaimTrack rejects a party ref absent from the matter (unknown_party)", async () => {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("ct4"),
  });
  await persistence.createMatter(makeMatterWithClaimPartiesInput());
  let err;
  try {
    await persistence.createClaimTrack(makeClaimTrackInput({ respondent_party_id: "01jcasepartyghost000000001" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "unknown_party");
  // No claim-track row and no claim_track audit event were written (atomic refusal).
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM case_box_claim_tracks").get().c, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE entity_type = 'claim_track'").get().c,
    0,
  );
});

test("Sqlite-VS1: createClaimTrack rejects a non-active status at create (invalid_argument)", async () => {
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("ct5"),
  });
  await persistence.createMatter(makeMatterWithClaimPartiesInput());
  for (const status of ["withdrawn", "resolved"]) {
    let err;
    try {
      await persistence.createClaimTrack(makeClaimTrackInput({ status }));
    } catch (e) { err = e; }
    assert.ok(err instanceof CaseBoxPersistenceError, `status=${status} must reject`);
    assert.equal(err.code, "invalid_argument", `status=${status} → invalid_argument`);
  }
});

test("Sqlite-VS1: get/list are tenant + matter scoped", async () => {
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("ct6"),
  });
  await persistence.createMatter(makeMatterWithClaimPartiesInput());
  await persistence.createClaimTrack(makeClaimTrackInput());

  // getClaimTrack: correct scope returns the row.
  const got = await persistence.getClaimTrack({
    tenant_id: DEFAULT_TENANT_ID,
    matter_id: DEFAULT_MATTER_ID,
    claim_track_id: DEFAULT_CLAIM_TRACK_ID,
  });
  assert.ok(got);
  assert.equal(got.id, DEFAULT_CLAIM_TRACK_ID);

  // getClaimTrack: a foreign tenant on the KNOWN matter throws tenant_mismatch.
  let getErr;
  try {
    await persistence.getClaimTrack({ tenant_id: "tenant-evil", matter_id: DEFAULT_MATTER_ID, claim_track_id: DEFAULT_CLAIM_TRACK_ID });
  } catch (e) { getErr = e; }
  assert.ok(getErr instanceof CaseBoxPersistenceError);
  assert.equal(getErr.code, "tenant_mismatch");

  // getClaimTrack: an unknown matter returns null (not an error).
  const nullGet = await persistence.getClaimTrack({
    tenant_id: DEFAULT_TENANT_ID,
    matter_id: "01jcasematterunknown000001",
    claim_track_id: DEFAULT_CLAIM_TRACK_ID,
  });
  assert.equal(nullGet, null);

  // listClaimTracks: correct scope returns the single track.
  const list = await persistence.listClaimTracks({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, DEFAULT_CLAIM_TRACK_ID);

  // listClaimTracks: foreign tenant throws; unknown matter throws.
  let listTenantErr, listMatterErr;
  try {
    await persistence.listClaimTracks({ tenant_id: "tenant-evil", matter_id: DEFAULT_MATTER_ID });
  } catch (e) { listTenantErr = e; }
  try {
    await persistence.listClaimTracks({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01jcasematterunknown000001" });
  } catch (e) { listMatterErr = e; }
  assert.equal(listTenantErr.code, "tenant_mismatch");
  assert.equal(listMatterErr.code, "unknown_matter");
});
