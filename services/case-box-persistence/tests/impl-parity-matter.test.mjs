// Impl-parity B1 — matter scenarios. Split from former monolithic
// impl-parity.test.mjs per B7 plan §1.7 (closes B6 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makePair } from "./impl-parity-common.mjs";

test("impl-parity B1.1: createMatter happy path returns identical matter row", async () => {
  const { inMem, sqlite } = makePair();
  const input = makeMatterInput();
  const im = await inMem.createMatter(input);
  const sq = await sqlite.createMatter(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B1.2: createMatter with all R-5(j) free-text fields", async () => {
  const { inMem, sqlite } = makePair();
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
  const { inMem, sqlite } = makePair();
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
  const { inMem, sqlite } = makePair();
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
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  await sqlite.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const imUn = await inMem.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  const sqUn = await sqlite.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "lawyer", reason: "test" });
  assert.deepEqual(sqUn, imUn);
});

test("impl-parity B1.6: createMatter rejects same way (duplicate_id) on both impls", async () => {
  const { inMem, sqlite } = makePair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  let imErr, sqErr;
  try { await inMem.createMatter(makeMatterInput()); } catch (e) { imErr = e; }
  try { await sqlite.createMatter(makeMatterInput()); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "duplicate_id");
});
