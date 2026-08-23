// matter-details-edit Phase B — in-memory ↔ SQLite parity for
// updateMatterDetails.
//
// Uses makeAuditPair() (SHARED id prefix) so audit-event hash chains match
// byte-identically across both impls. Both impls run the same operations in the
// same order, so their deterministic id + clock counters stay in lockstep and
// the emitted MATTER_DETAILS_UPDATED events (incl. changed_fields + hashes) are
// byte-identical.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CaseBoxPersistenceError } from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeDocumentInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function listEvents(p) {
  return (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows;
}

const OPTS = (patch, reason = "corrected") => ({ patch, actor_user_id: "editor-user", reason });

test("MDU parity: a single-field edit yields identical matter + audit event", async () => {
  const { inMem, sqlite } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());

  const im = await inMem.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Corrected Caption" }));
  const sq = await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Corrected Caption" }));
  assert.deepEqual(sq, im);

  assert.deepEqual(await sqlite.getMatter(DEFAULT_MATTER_ID), await inMem.getMatter(DEFAULT_MATTER_ID));

  const imEvents = await listEvents(inMem);
  const sqEvents = await listEvents(sqlite);
  assert.deepEqual(sqEvents, imEvents, "audit chains must be byte-identical");
  assert.equal(imEvents.length, 2);
  assert.equal(imEvents[1].event_kind, "MATTER_DETAILS_UPDATED");
  assert.deepEqual(imEvents[1].changed_fields, ["name"]);
});

test("MDU parity: a multi-field edit (sorted changed_fields) matches across impls", async () => {
  const { inMem, sqlite } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());

  const patch = { name: "New Name", court_contact_text: "Clerk, Room 3", retainer_scope: "full rep" };
  const im = await inMem.updateMatterDetails(DEFAULT_MATTER_ID, OPTS(patch));
  const sq = await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS(patch));
  assert.deepEqual(sq, im);

  const imEvents = await listEvents(inMem);
  assert.deepEqual(await listEvents(sqlite), imEvents);
  assert.deepEqual(imEvents[1].changed_fields, ["court_contact_text", "name", "retainer_scope"]);
});

test("MDU parity: continuity holds identically with an interleaved document event", async () => {
  const { inMem, sqlite } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());

  await inMem.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "After Doc" }));
  await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "After Doc" }));

  const imEvents = await listEvents(inMem);
  const sqEvents = await listEvents(sqlite);
  assert.deepEqual(sqEvents, imEvents, "byte-identical incl. before/prev hashes");
  assert.equal(imEvents.length, 3);
  // Continuity chained off the matter event, not the document event.
  assert.equal(imEvents[2].before_state_hash, imEvents[0].after_state_hash);
});

test("MDU parity: clearing an optional descriptor matches across impls", async () => {
  const { inMem, sqlite } = makeAuditPair();
  await inMem.createMatter(makeMatterInput({ retainer_scope: "old scope" }));
  await sqlite.createMatter(makeMatterInput({ retainer_scope: "old scope" }));

  const im = await inMem.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ retainer_scope: "" }));
  const sq = await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ retainer_scope: "" }));
  assert.deepEqual(sq, im);
  assert.equal(im.retainer_scope, "");
  assert.deepEqual(await listEvents(sqlite), await listEvents(inMem));
});

test("MDU parity: SQLite structural invariant event_count == COUNT(*) == MAX(sequence)", async () => {
  const { sqlite, db } = makeAuditPair();
  await sqlite.createMatter(makeMatterInput());
  await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Corrected" }));

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

// ---------------------------------------------------------------------------
// Error-code parity
// ---------------------------------------------------------------------------

async function bothCreated() {
  const pair = makeAuditPair();
  await pair.inMem.createMatter(makeMatterInput());
  await pair.sqlite.createMatter(makeMatterInput());
  return pair;
}

test("MDU parity: unknown key rejected identically → invalid_payload", async () => {
  const { inMem, sqlite } = await bothCreated();
  let imErr, sqErr;
  try { await inMem.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x", bogus: "y" })); } catch (e) { imErr = e; }
  try { await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x", bogus: "y" })); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr);
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "invalid_payload");
});

test("MDU parity: no-op rejected identically → no_editable_change", async () => {
  const { inMem, sqlite } = await bothCreated();
  let imErr, sqErr;
  try { await inMem.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Test Matter" })); } catch (e) { imErr = e; }
  try { await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "Test Matter" })); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr);
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "no_editable_change");
});

test("MDU parity: archived matter rejected identically → matter_archived", async () => {
  const { inMem, sqlite } = await bothCreated();
  await inMem.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "u", reason: "archiving" });
  await sqlite.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "u", reason: "archiving" });
  let imErr, sqErr;
  try { await inMem.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x" })); } catch (e) { imErr = e; }
  try { await sqlite.updateMatterDetails(DEFAULT_MATTER_ID, OPTS({ name: "x" })); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr);
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "matter_archived");
});
