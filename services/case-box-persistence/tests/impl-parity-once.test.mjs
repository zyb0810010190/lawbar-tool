// Impl-parity B11 — appendFactOnce scenarios. Per B11 plan §1.5.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeFactInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPair() {
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  return { inMem, sqlite, db };
}

test("impl-parity B11.1: appendFactOnce create path identical", async () => {
  const { inMem, sqlite } = await buildPair();
  const input = makeFactInput();
  const im = await inMem.appendFactOnce(input);
  const sq = await sqlite.appendFactOnce(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B11.2: appendFactOnce byte-identical replay identical (both return stored; no audit added)", async () => {
  const { inMem, sqlite } = await buildPair();
  await inMem.appendFactOnce(makeFactInput());
  await sqlite.appendFactOnce(makeFactInput());
  const im = await inMem.appendFactOnce(makeFactInput());
  const sq = await sqlite.appendFactOnce(makeFactInput());
  assert.deepEqual(sq, im, "byte-identical replay must produce identical row across impls");
});

test("impl-parity B11.3: appendFactOnce same-id-different-payload throws duplicate_id on both impls", async () => {
  const { inMem, sqlite } = await buildPair();
  await inMem.appendFactOnce(makeFactInput({ purpose: "claim" }));
  await sqlite.appendFactOnce(makeFactInput({ purpose: "claim" }));
  let imErr, sqErr;
  try { await inMem.appendFactOnce(makeFactInput({ purpose: "defense" })); } catch (e) { imErr = e; }
  try { await sqlite.appendFactOnce(makeFactInput({ purpose: "defense" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "duplicate_id");
});
