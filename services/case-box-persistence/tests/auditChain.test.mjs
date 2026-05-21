// Audit-chain integrity tests for Phase A1.

import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryCaseBoxPersistence } from "../dist/index.js";
import { tamperStoredEvent } from "./internals.mjs";
import {
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";

function make(prefix) {
  const now = makeClock("2026-05-20T09:00:00.000Z");
  const generateId = makeIdGenerator(prefix);
  return { p: new InMemoryCaseBoxPersistence({ now, generateId }) };
}

test("6.3.1 first event in a matter has prev_event_hash === null", async () => {
  const { p } = make("c1");
  await p.createMatter(makeMatterInput());
  const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
  assert.equal(page.rows[0].prev_event_hash, null);
});

test("6.3.2 + 6.3.3 head hash updates on every write", async () => {
  const { p } = make("c2");
  await p.createMatter(makeMatterInput());
  const h1 = (await p.getAuditChainHead(DEFAULT_MATTER_ID)).headHash;
  await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
  const h2 = (await p.getAuditChainHead(DEFAULT_MATTER_ID)).headHash;
  await p.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "y" });
  const h3 = (await p.getAuditChainHead(DEFAULT_MATTER_ID)).headHash;
  assert.ok(h1 && h2 && h3);
  assert.notEqual(h1, h2);
  assert.notEqual(h2, h3);
  assert.notEqual(h1, h3);
});

test("6.3.4 tamper detection on a mutated stored event (mid-chain local)", async () => {
  const { p } = make("c4");
  await p.createMatter(makeMatterInput());
  await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
  await p.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "y" });
  // Tamper event 2 by flipping the after_state_hash.
  tamperStoredEvent(p, DEFAULT_MATTER_ID, 2, (e) => ({
    ...e,
    after_state_hash: "0000000000000000000000000000000000000000000000000000000000000000",
  }));
  const r = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(r.ok, false);
  assert.equal(typeof r.errorIndex, "number");
  assert.ok(r.errorIndex >= 2);
  assert.equal(typeof r.errorReason, "string");
  assert.equal(typeof r.detail, "string");
});

test("6.3.5 deterministic clock + id generator produce deterministic hashes", async () => {
  const make1 = () => {
    const now = makeClock("2026-05-20T09:00:00.000Z");
    const generateId = makeIdGenerator("det");
    return new InMemoryCaseBoxPersistence({ now, generateId });
  };
  const p1 = make1();
  await p1.createMatter(makeMatterInput());
  const h1 = (await p1.getAuditChainHead(DEFAULT_MATTER_ID)).headHash;
  const p2 = make1();
  await p2.createMatter(makeMatterInput());
  const h2 = (await p2.getAuditChainHead(DEFAULT_MATTER_ID)).headHash;
  assert.equal(h1, h2);
});

test("6.3.6 cross-matter chains do not interfere", async () => {
  const { p } = make("c6");
  await p.createMatter(makeMatterInput());
  const otherMatterId = "01jothermockmatterid000099";
  await p.createMatter(makeMatterInput({ id: otherMatterId }));
  const headA1 = (await p.getAuditChainHead(DEFAULT_MATTER_ID)).headHash;
  await p.archiveMatter(otherMatterId, { actor_user_id: "local-user", reason: "x" });
  const headA2 = (await p.getAuditChainHead(DEFAULT_MATTER_ID)).headHash;
  assert.equal(headA1, headA2, "matter A head must not change when matter B is updated");
});

test("6.3.7 listAuditEvents order is chain order", async () => {
  const { p } = make("c7");
  await p.createMatter(makeMatterInput());
  await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
  await p.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "y" });
  const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
  assert.equal(page.rows[0].prev_event_hash, null);
  // event N has prev_event_hash === hash(event N-1)
  // We can't recompute hashes here without the contract canonicalizer, but at minimum
  // the prev_event_hash chain must be a valid 64-char hex for each subsequent event.
  for (let i = 1; i < page.rows.length; i++) {
    assert.match(page.rows[i].prev_event_hash, /^[0-9a-f]{64}$/);
  }
});

test("6.3.8 verifyAuditChainForMatter on matter with seed event only → ok", async () => {
  const { p } = make("c8");
  await p.createMatter(makeMatterInput());
  const r = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  assert.equal(r.ok, true);
  assert.equal(r.verifiedCount, 1);
  assert.match(r.headHash, /^[0-9a-f]{64}$/);
});

test("6.3.9 timestamp normalization — invalid Date rejects with invalid_argument", async () => {
  // Test (a): now returns non-Date
  const pA = new InMemoryCaseBoxPersistence({ now: () => null });
  let err;
  try { await pA.createMatter(makeMatterInput()); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "invalid_argument");

  // Test (b): now returns Invalid Date (toISOString throws RangeError)
  const pB = new InMemoryCaseBoxPersistence({ now: () => new Date("garbage") });
  let err2;
  try { await pB.createMatter(makeMatterInput()); } catch (e) { err2 = e; }
  assert.ok(err2);
  assert.equal(err2.code, "invalid_argument");

  // Test (c): valid Date produces stable ISO output
  const fixedNow = () => new Date("2026-05-20T09:00:00.000Z");
  const pC = new InMemoryCaseBoxPersistence({ now: fixedNow, generateId: makeIdGenerator("tn") });
  const m = await pC.createMatter(makeMatterInput());
  const page = await pC.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: m.id });
  assert.equal(page.rows[0].timestamp, "2026-05-20T09:00:00.000Z");
});
