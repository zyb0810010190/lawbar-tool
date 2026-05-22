// Impl-parity tests for case-box-persistence Phase B1 — matter scenarios
// per dev-memo/plan-case-box-persistence-B1-matter.md §1.3.
//
// Each test runs identical inputs against InMemory and Sqlite impls,
// then deep-compares the returned matter rows. Per umbrella plan
// §9 risk #1 + rev-1 reviewer Dim-5 #1.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryCaseBoxPersistence,
  openSqliteCaseBoxPersistence,
} from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";

const ISO = "2026-05-22T09:00:00.000Z";
const ID_PREFIX_INMEM = "parityim";
const ID_PREFIX_SQLITE = "paritysq";

function makePair() {
  const inMem = new InMemoryCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_INMEM),
  });
  const { persistence: sqlite, db } = openSqliteCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_SQLITE),
  });
  return { inMem, sqlite, db };
}

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

test("impl-parity B1.7: not_implemented surfaces uniformly on SQLite for non-B1 methods", async () => {
  const { sqlite } = makePair();
  let err;
  try { await sqlite.registerDocument(DEFAULT_MATTER_ID, {}); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "not_implemented");
  assert.match(err.message, /registerDocument/);
});
