// Hardening: B11 appendFactOnce invariants. Per B11 plan §1.5.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

test("Sqlite-B11: appendFactOnce byte-identical replay returns stored row; NO new audit event", async () => {
  // Per B11 plan §1.5 invariant #1: replay path emits NO INSERT, NO audit.
  // Verify event_count unchanged and row payload_json byte-identical.
  const { makeDocumentInput, makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // First append.
  const first = await persistence.appendFactOnce(makeFactInput());
  const preHead = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const preRow = db.prepare("SELECT payload_json FROM case_box_facts WHERE id = ?").get(DEFAULT_FACT_ID);
  // Replay with byte-identical input.
  const second = await persistence.appendFactOnce(makeFactInput());
  const postHead = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const postRow = db.prepare("SELECT payload_json FROM case_box_facts WHERE id = ?").get(DEFAULT_FACT_ID);
  assert.deepEqual(second, first, "replay must return same row as first append");
  assert.equal(postHead.event_count, preHead.event_count, "replay must NOT advance audit chain head");
  assert.equal(postRow.payload_json, preRow.payload_json, "replay must leave payload_json byte-identical");
});

test("Sqlite-B11: appendFactOnce same-id-different-tenant falls through to strict (throws)", async () => {
  // Per B11 plan §1.5 invariant #2: cross-tenant defense. Replay MUST
  // NEVER short-circuit when input.tenant_id !== stored.tenant_id —
  // falls through to strict appendFact which will throw on the cross-
  // tenant attempt (tenant_mismatch via matter+tenant check OR
  // duplicate_id via id collision; either error means the cross-tenant
  // path did NOT silently return the stored row).
  const { makeDocumentInput, makeFactInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o2"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendFactOnce(makeFactInput());
  // Replay with mutated tenant_id but same fact id.
  let err;
  try {
    await persistence.appendFactOnce(makeFactInput({ tenant_id: "tenant-evil" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError, "cross-tenant replay must throw, NOT silently succeed");
});

test("Sqlite-B11: appendFactOnce same-id-different-payload throws duplicate_id", async () => {
  // Per B11 plan §1.5 invariant #3: different canonical projection
  // falls through to strict which throws duplicate_id (A4 semantics).
  const { makeDocumentInput, makeFactInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.appendFactOnce(makeFactInput({ purpose: "claim" }));
  let err;
  try {
    // Same id, different purpose enum value → canonical projection differs → duplicate_id.
    await persistence.appendFactOnce(makeFactInput({ purpose: "defense" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "duplicate_id");
});
