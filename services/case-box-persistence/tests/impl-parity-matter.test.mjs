// Impl-parity B1 — matter scenarios. Split from former monolithic
// impl-parity.test.mjs per B7 plan §1.7 (closes B6 D4#1).
//
// WI-PTA-VS0: createMatter now server-assigns ULIDs to id-less parties, so the
// stored matter (and its MATTER_REGISTERED hash) depends on the injected id
// generator. These cross-impl deep-equals therefore use makeAuditPair() (a
// SHARED id prefix) so both impls generate identical party ids; makePair()'s
// separate prefixes would make the generated party ids diverge.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

test("impl-parity B1.1: createMatter happy path returns identical matter row", async () => {
  const { inMem, sqlite } = makeAuditPair();
  const input = makeMatterInput();
  const im = await inMem.createMatter(input);
  const sq = await sqlite.createMatter(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B1.2: createMatter with all R-5(j) free-text fields", async () => {
  const { inMem, sqlite } = makeAuditPair();
  const input = makeMatterInput({
    case_type_text: "合同纠纷",
    case_progress_text: "first hearing 2026-07-15",
    court_contact_text: "Shanghai No.1 Intermediate Court",
    contention_summary_text: "breach vs force majeure",
  });
  const im = await inMem.createMatter(input);
  const sq = await sqlite.createMatter(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B1.3: createMatter with successor_matter_id (R5.2)", async () => {
  const { inMem, sqlite } = makeAuditPair();
  // Both impls need the successor matter first.
  const successorId = "01jcasemattermockid0000099";
  const successor = makeMatterInput({ id: successorId, matter_type: "litigation" });
  await inMem.createMatter(successor);
  await sqlite.createMatter(successor);
  const original = makeMatterInput({
    matter_type: "advisory",
    successor_matter_id: successorId,
  });
  const im = await inMem.createMatter(original);
  const sq = await sqlite.createMatter(original);
  assert.deepEqual(sq, im);
});

test("impl-parity B1.4: archiveMatter → getMatter round-trip", async () => {
  const { inMem, sqlite } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  const imArch = await inMem.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const sqArch = await sqlite.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  assert.deepEqual(sqArch, imArch);
  const imGet = await inMem.getMatter(DEFAULT_MATTER_ID);
  const sqGet = await sqlite.getMatter(DEFAULT_MATTER_ID);
  assert.deepEqual(sqGet, imGet);
});

test("impl-parity B1.5: unarchiveMatter → getMatter round-trip", async () => {
  const { inMem, sqlite } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await sqlite.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const imUn = await inMem.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const sqUn = await sqlite.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  assert.deepEqual(sqUn, imUn);
});

test("impl-parity B1.6: createMatter rejects same way (duplicate_id) on both impls", async () => {
  const { inMem, sqlite } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  let imErr, sqErr;
  try { await inMem.createMatter(makeMatterInput()); } catch (e) { imErr = e; }
  try { await sqlite.createMatter(makeMatterInput()); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "duplicate_id");
});

// ---------------------------------------------------------------------------
// T3 S0 (FORMS-T3-S0-SCHEMA-00 §4 Option A): matter litigation_position.
// ---------------------------------------------------------------------------

test("impl-parity T3-S0: createMatter with litigation_position round-trips identically", async () => {
  const { inMem, sqlite } = makeAuditPair();
  const input = makeMatterInput({ litigation_position: "plaintiff" });
  const im = await inMem.createMatter(input);
  const sq = await sqlite.createMatter(input);
  assert.deepEqual(sq, im);
  assert.equal(sq.litigation_position, "plaintiff");
  const imGet = await inMem.getMatter(DEFAULT_MATTER_ID);
  const sqGet = await sqlite.getMatter(DEFAULT_MATTER_ID);
  assert.deepEqual(sqGet, imGet);
  assert.equal(sqGet.litigation_position, "plaintiff");
});

test("impl-parity T3-S0: legacy matter without litigation_position stays valid; field absent on read", async () => {
  const { inMem, sqlite } = makeAuditPair();
  const input = makeMatterInput();
  await inMem.createMatter(input);
  await sqlite.createMatter(input);
  const imGet = await inMem.getMatter(DEFAULT_MATTER_ID);
  const sqGet = await sqlite.getMatter(DEFAULT_MATTER_ID);
  assert.deepEqual(sqGet, imGet);
  assert.ok(!("litigation_position" in sqGet), "legacy matter must not grow litigation_position");
});

test("impl-parity T3-S0: out-of-enum litigation_position is rejected identically by both impls", async () => {
  const { inMem, sqlite } = makeAuditPair();
  const input = makeMatterInput({ litigation_position: "third_party" });
  let imErr, sqErr;
  try { await inMem.createMatter(input); } catch (e) { imErr = e; }
  try { await sqlite.createMatter(input); } catch (e) { sqErr = e; }
  assert.ok(imErr && sqErr, "both implementations must reject an out-of-enum litigation_position");
  assert.equal(imErr.code, sqErr.code);
  assert.equal(imErr.code, "invalid_payload");
});
