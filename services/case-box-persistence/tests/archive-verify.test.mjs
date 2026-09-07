// verifyAllAuditChains — whole-database chain verification for a holder of an archive.
//
// WHY IT EXISTS AT ALL, since `verifyAuditChainForMatter` already did the hard part: a consumer
// with a database file and no application has no list of matters to iterate, and the obvious
// place to get one is wrong. The desktop backup engine took its list from
// `case_box_audit_chain_heads`, which means a DELETED HEAD removed its matter from the check —
// and a deleted head is one of the tampers being looked for. Reproduced against the shipped
// engine on 2026-09-06: deleting every head produced a backup reported as VERIFIED with an empty
// chain-heads manifest.
//
// So the tests that matter here are the STRUCTURAL ones — the cases where the corruption is in
// the very rows a naive implementation would use to decide what to look at. Per-event hash and
// prev-link coverage lives in hardening-audit.test.mjs and the contract's own suite; this file
// does not re-test the verifier it delegates to, it tests the set it delegates over.

import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyAllAuditChains } from "../dist/archiveVerify.js";
import {
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

/** Two matters with real chains, built through the API so the healthy control is genuine. */
async function makeBox(prefix) {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-09-06T09:00:00.000Z"),
    generateId: makeIdGenerator(prefix),
  });
  const ids = makeIdGenerator(`${prefix}m`);
  const matterIds = [];
  for (const name of ["SYNTHETIC ARCHIVE ONE", "SYNTHETIC ARCHIVE TWO"]) {
    const matter = makeMatterInput({ id: ids(), name });
    await persistence.createMatter(matter);
    matterIds.push(matter.id);
  }
  return { persistence, db, matterIds };
}

test("archive-verify: a healthy database passes, and reports what it actually examined", async () => {
  const { db, matterIds } = await makeBox("av1");
  try {
    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.mattersChecked, matterIds.length);
    assert.ok(result.eventsVerified >= matterIds.length,
      "each matter contributes at least its genesis event; a zero here would be a silent no-op");
    assert.deepEqual(result.findings, []);
  } finally { db.close(); }
});

test("archive-verify: a DELETED chain head is caught — the matter stays in the checked set", async () => {
  // The defect this exists for. A head-driven matter list cannot see this at all.
  const { db, matterIds } = await makeBox("av2");
  try {
    db.prepare("DELETE FROM case_box_audit_chain_heads WHERE matter_id = ?").run(matterIds[0]);
    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, false, "a matter with no head anchor was reported as verified");
    assert.equal(result.mattersChecked, matterIds.length,
      "the matter must still be COUNTED as checked, not quietly dropped");
    assert.ok(result.findings.some((f) => f.matterId === matterIds[0]),
      `the finding must name the matter; got ${JSON.stringify(result.findings)}`);
    assert.equal(result.findings.some((f) => f.matterId === matterIds[1]), false,
      "the intact matter must not be implicated");
  } finally { db.close(); }
});

test("archive-verify: deleting EVERY chain head is caught, not reported as nothing to check", async () => {
  const { db, matterIds } = await makeBox("av3");
  try {
    db.prepare("DELETE FROM case_box_audit_chain_heads").run();
    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, false);
    assert.equal(result.mattersChecked, matterIds.length);
    assert.equal(result.findings.length >= matterIds.length, true,
      "every matter left without an anchor must produce its own finding");
  } finally { db.close(); }
});

test("archive-verify: audit rows outliving their matter are reported as orphans", async () => {
  const { db, matterIds } = await makeBox("av4");
  try {
    db.prepare("PRAGMA foreign_keys = OFF").run();
    db.prepare("DELETE FROM case_box_matters WHERE id = ?").run(matterIds[0]);
    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, false, "events belonging to no matter were reported as fine");
    const orphan = result.findings.find((f) => f.matterId === matterIds[0]);
    assert.ok(orphan, "the orphaned matter id must appear in the findings");
    assert.equal(orphan.reason, "orphan_audit_rows");
    // The union is what makes this visible: the matters table no longer mentions this id.
    assert.equal(result.mattersChecked, matterIds.length,
      "the id must come from the events/heads tables, since the matters table has lost it");
  } finally { db.close(); }
});

test("archive-verify: an inflated event_count is caught even though the chain itself verifies", async () => {
  // The head hash still matches the last event here, so the chain verifier is satisfied. Only the
  // declared count is a lie — the one invariant the old count-only check did carry, kept.
  const { db, matterIds } = await makeBox("av5");
  try {
    assert.equal(verifyAllAuditChains(db).ok, true, "precondition: healthy before the edit");
    db.prepare("UPDATE case_box_audit_chain_heads SET event_count = event_count + 7 WHERE matter_id = ?")
      .run(matterIds[0]);
    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, false);
    const finding = result.findings.find((f) => f.matterId === matterIds[0]);
    assert.equal(finding.reason, "head_count_mismatch");
    assert.ok(finding.detail.includes(matterIds[0]));
  } finally { db.close(); }
});

test("archive-verify: an edited event payload is caught — a count comparison cannot see this", async () => {
  const { db, matterIds } = await makeBox("av6");
  try {
    const row = db
      .prepare("SELECT event_id, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence LIMIT 1")
      .get(matterIds[0]);
    const event = JSON.parse(row.event_json);
    event.actor_user_id = "SYNTHETIC-TAMPER";
    db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
      .run(JSON.stringify(event), row.event_id);

    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, false, "an edited event verified clean");
    const finding = result.findings.find((f) => f.matterId === matterIds[0]);
    assert.equal(finding.reason, "chain_invalid");
    // Counts are all still perfectly consistent, which is exactly why this class was missed.
    assert.equal(result.findings.some((f) => f.reason === "head_count_mismatch"), false,
      "nothing about the COUNTS changed; only a real chain verifier sees this");
  } finally { db.close(); }
});

test("archive-verify: an empty database is a pass over zero matters, and says so", async () => {
  // Honest rather than reassuring: `ok:true` with `mattersChecked: 0` lets a caller decide
  // whether nothing-to-check is expected. Reporting a bare `true` would make an emptied database
  // indistinguishable from a verified one.
  const { db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-09-06T09:00:00.000Z"),
    generateId: makeIdGenerator("av7"),
  });
  try {
    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, true);
    assert.equal(result.mattersChecked, 0);
    assert.equal(result.eventsVerified, 0);
  } finally { db.close(); }
});

test("archive-verify: reads only — verifying does not modify the database", async () => {
  const { db, matterIds } = await makeBox("av8");
  try {
    const snapshot = () => ({
      events: db.prepare("SELECT event_id, event_json, sequence FROM case_box_audit_events ORDER BY event_id").all(),
      heads: db.prepare("SELECT matter_id, head_hash, event_count FROM case_box_audit_chain_heads ORDER BY matter_id").all(),
      matters: db.prepare("SELECT id FROM case_box_matters ORDER BY id").all(),
    });
    const before = snapshot();
    verifyAllAuditChains(db);

    // And again after a corruption, because the failure path is the one that would be tempted to
    // "repair" something.
    db.prepare("DELETE FROM case_box_audit_chain_heads WHERE matter_id = ?").run(matterIds[0]);
    const afterTamper = snapshot();
    assert.equal(verifyAllAuditChains(db).ok, false);
    assert.deepEqual(snapshot(), afterTamper, "the failure path wrote to the database");

    assert.deepEqual(before.events, afterTamper.events, "the events were never the thing changed");
  } finally { db.close(); }
});

test("archive-verify: every defect is reported, not just the first one", async () => {
  const { db, matterIds } = await makeBox("av9");
  try {
    db.prepare("DELETE FROM case_box_audit_chain_heads WHERE matter_id = ?").run(matterIds[0]);
    db.prepare("UPDATE case_box_audit_chain_heads SET event_count = 42 WHERE matter_id = ?").run(matterIds[1]);
    const result = verifyAllAuditChains(db);
    assert.equal(result.ok, false);
    const affected = new Set(result.findings.map((f) => f.matterId));
    assert.deepEqual([...affected].sort(), [...matterIds].sort(),
      "an integrity report that stops at the first defect understates the scope of a tamper");
  } finally { db.close(); }
});
