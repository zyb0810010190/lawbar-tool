// Impl-parity B7 — docket entry + deadline scenarios. Per B7 plan §1.6.
// NEW file per the mandatory impl-parity.test.mjs split (closes B6 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DEADLINE_ID,
  DEFAULT_DOCKET_ENTRY_ID,
  DEFAULT_MATTER_ID,
  makeDocketEntryInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPairForDocket() {
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  return { inMem, sqlite, db };
}

test("impl-parity B7.1: appendDocketEntry happy path identical", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  const input = makeDocketEntryInput();
  const im = await inMem.appendDocketEntry(input);
  const sq = await sqlite.appendDocketEntry(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B7.2: confirmDocketEntry Mode B identical (entry + deadline pair)", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const opts = {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  };
  const im = await inMem.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  const sq = await sqlite.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B7.3: confirmDocketEntry idempotent replay identical (idempotent: true)", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const opts = {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  };
  await inMem.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  await sqlite.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  const imReplay = await inMem.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  const sqReplay = await sqlite.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  assert.deepEqual(sqReplay, imReplay);
  assert.equal(sqReplay.idempotent, true);
});

test("impl-parity B7.4: dismissDocketEntry identical", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const opts = {
    dismissal_actor_user_id: "lawyer",
    dismissed_at: "2026-05-21T22:00:00.000Z",
    dismissal_reason: "out of scope",
  };
  const im = await inMem.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  const sq = await sqlite.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B7.5: transitionDeadline pending → met identical", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const confirmOpts = {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  };
  await inMem.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  await sqlite.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  const transOpts = { actor_user_id: "lawyer", at: "2026-06-15T17:00:00.000Z", to: "met" };
  const im = await inMem.transitionDeadline(DEFAULT_DEADLINE_ID, transOpts);
  const sq = await sqlite.transitionDeadline(DEFAULT_DEADLINE_ID, transOpts);
  assert.deepEqual(sq, im);
});

test("impl-parity B7.6: transitionDeadline missed → met with reason identical (R5.29 path)", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const confirmOpts = {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  };
  await inMem.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  await sqlite.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  // First: pending → missed.
  const missOpts = { actor_user_id: "lawyer", at: "2026-06-15T17:00:00.000Z", to: "missed" };
  await inMem.transitionDeadline(DEFAULT_DEADLINE_ID, missOpts);
  await sqlite.transitionDeadline(DEFAULT_DEADLINE_ID, missOpts);
  // Then: missed → met with reason.
  const recoverOpts = { actor_user_id: "lawyer", at: "2026-06-15T18:00:00.000Z", to: "met", transition_reason: "extension granted" };
  const im = await inMem.transitionDeadline(DEFAULT_DEADLINE_ID, recoverOpts);
  const sq = await sqlite.transitionDeadline(DEFAULT_DEADLINE_ID, recoverOpts);
  assert.deepEqual(sq, im);
});

test("impl-parity B7.7: getDeadline + listDeadlines identical", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const confirmOpts = {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  };
  await inMem.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  await sqlite.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, confirmOpts);
  const getQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, deadline_id: DEFAULT_DEADLINE_ID };
  const imGet = await inMem.getDeadline(getQuery);
  const sqGet = await sqlite.getDeadline(getQuery);
  assert.deepEqual(sqGet, imGet);
  const listQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID };
  const imList = await inMem.listDeadlines(listQuery);
  const sqList = await sqlite.listDeadlines(listQuery);
  assert.deepEqual(sqList, imList);
});

test("impl-parity B7.8: rejection parity (cross-tenant docket; unknown deadlineId transition)", async () => {
  const { inMem, sqlite } = await buildPairForDocket();
  // Cross-tenant docket entry.
  let imErr, sqErr;
  try { await inMem.appendDocketEntry(makeDocketEntryInput({ tenant_id: "tenant-evil" })); } catch (e) { imErr = e; }
  try { await sqlite.appendDocketEntry(makeDocketEntryInput({ tenant_id: "tenant-evil" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "tenant_mismatch");
  // Unknown deadlineId transition.
  imErr = undefined; sqErr = undefined;
  const unknownOpts = { actor_user_id: "lawyer", at: "2026-06-15T17:00:00.000Z", to: "met" };
  try { await inMem.transitionDeadline("01jcasedlinemockid000nope0", unknownOpts); } catch (e) { imErr = e; }
  try { await sqlite.transitionDeadline("01jcasedlinemockid000nope0", unknownOpts); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
});

// ---------------------------------------------------------------------------
// WI-DPE3 — editDocketEntry parity
// ---------------------------------------------------------------------------

test("impl-parity DPE3.1: editDocketEntry identical (in-memory ≡ SQLite, fixed clock)", async () => {
  const { makeEditDocketEntryOpts } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const opts = makeEditDocketEntryOpts();
  const im = await inMem.editDocketEntry(opts);
  const sq = await sqlite.editDocketEntry(opts);
  assert.deepEqual(sq, im);
  assert.equal(sq.proposed_kind, "hearing");
  assert.equal(typeof sq.revised_at, "string");
  assert.equal(sq.confirmation_state, "proposed");
});

test("impl-parity DPE3.2: editDocketEntry ignores adversarial caller revised_at identically", async () => {
  const { makeEditDocketEntryOpts } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite } = await buildPairForDocket();
  await inMem.appendDocketEntry(makeDocketEntryInput());
  await sqlite.appendDocketEntry(makeDocketEntryInput());
  const FORGED = "1999-01-01T00:00:00.000Z";
  const opts = makeEditDocketEntryOpts({ revised_at: FORGED });
  const im = await inMem.editDocketEntry(opts);
  const sq = await sqlite.editDocketEntry(opts);
  assert.deepEqual(sq, im);
  assert.notEqual(sq.revised_at, FORGED);
  assert.ok(!JSON.stringify(sq).includes(FORGED));
});
