// Audit-chain TRUNCATION / ROLLBACK resistance.
//
// PROVENANCE. This file exists because of a gap-analysis against mature
// tamper-evident-log projects (transparency logs — Rekor, Trillian, Certificate
// Transparency — and immudb). Nothing is copied from them: those are Go/AGPL
// codebases and their test code cannot enter this repo. What transferred is a
// FAILURE CLASS they test and this suite did not: **truncation / rollback**, in
// which the log is left internally valid but SHORTER than a previously observed
// state. Every assertion below is written from scratch against our own API.
//
// Why this class matters more here than most. The existing chain tests cover
// mutation (change an event) thoroughly — mid-chain payload edits, broken
// prev_event_hash, wrong tenant, last-event tampering via the head anchor. They do
// not cover DELETION of the tail. For a court-facing evidence tool the realistic
// adversary is not someone forging an entry; it is someone with local filesystem
// access erasing an inconvenient RECENT entry. That is exactly a truncation.
//
// The distinction that makes this tractable is between:
//   naive truncation      — delete trailing events, leave the head anchor alone
//   consistent truncation — delete trailing events AND repair the head anchor
// The first is detectable and IS detected today (T-TRUNC-1 pins that). The second
// is not, and cannot be by any purely internal check — see T-TRUNC-3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalAuditEventHashInput } from "case-box-contract";

import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

const hashHex = (e) => createHash("sha256").update(canonicalAuditEventHashInput(e)).digest("hex");

/** Three-event matter on a real on-disk chain: create, archive, unarchive. */
async function seedThreeEvents(prefix) {
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator(prefix),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, {
    actor_user_id: "local-user",
    reason: "synthetic archive",
  });
  await persistence.unarchiveMatter(DEFAULT_MATTER_ID, {
    actor_user_id: "local-user",
    reason: "synthetic unarchive",
  });
  return { persistence, db };
}

const eventsOf = (db) =>
  db
    .prepare(
      "SELECT event_id, sequence, event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC",
    )
    .all(DEFAULT_MATTER_ID);

test("T-TRUNC-1 naive truncation — deleting the tail without repairing the head anchor IS detected", async () => {
  const { persistence, db } = await seedThreeEvents("trunc1");
  assert.equal((await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID)).ok, true);

  const evs = eventsOf(db);
  assert.equal(evs.length, 3, "fixture must produce three events");
  db.prepare("DELETE FROM case_box_audit_events WHERE event_id = ?").run(evs[2].event_id);

  const r = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  // The surviving 1..2 prefix is internally perfect — the ONLY thing that can
  // notice is the head anchor still naming the deleted event.
  assert.equal(r.ok, false, "an unrepaired truncation must not verify");
  assert.match(String(r.detail), /head-anchor mismatch/);
  db.close();
});

test("T-TRUNC-2 the hash chain is PER-MATTER — no cross-matter link exists to catch a truncation", async () => {
  // This pins the structural fact that makes T-TRUNC-3 a real exposure rather
  // than a theoretical one. If events chained across matters, erasing matter A's
  // tail would break the next event written in matter B and be caught for free.
  // They do not chain, so nothing outside a matter observes its length.
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("trunc2"),
  });
  const OTHER = `${DEFAULT_MATTER_ID.slice(0, -1)}z`;
  await persistence.createMatter(makeMatterInput());
  await persistence.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "synthetic a" });
  await persistence.createMatter(makeMatterInput({ id: OTHER }));

  const firstOfB = db
    .prepare(
      "SELECT prev_event_hash FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC LIMIT 1",
    )
    .get(OTHER);
  assert.equal(
    firstOfB.prev_event_hash,
    null,
    "a matter's first event must not chain off another matter's head — if this ever becomes non-null, revisit T-TRUNC-3, because a global chain would detect truncation for free",
  );
  db.close();
});

test(
  "T-TRUNC-3 consistent truncation — deleting the tail AND repairing the head anchor must be detected",
  {
    todo:
      "KNOWN GAP, not a flaky test. Detection is IMPOSSIBLE with only in-database " +
      "evidence: a truncated chain is a valid shorter chain, and every internal " +
      "invariant (prev_event_hash linkage, head_hash, event_count == COUNT == " +
      "MAX(sequence)) holds after the anchor is repaired. Closing it requires an " +
      "EXTERNAL ANCHOR that an attacker with database access cannot rewrite — a " +
      "signed checkpoint over (matter_id, event_count, head_hash) using a key held " +
      "outside the DB, or an append-only off-device witness. That is an " +
      "architectural decision about the product's tamper-evidence guarantee and " +
      "carries key-management consequences, so it is deliberately NOT taken here. " +
      "Remove this todo when the anchor exists; the assertions below are already " +
      "written against the desired behaviour.",
  },
  async () => {
    const { persistence, db } = await seedThreeEvents("trunc3");
    const evs = eventsOf(db);
    const survivor = evs[evs.length - 2];

    // The attack, in full: erase the most recent event, then make the anchor agree.
    db.prepare("DELETE FROM case_box_audit_events WHERE event_id = ?").run(evs[evs.length - 1].event_id);
    db.prepare(
      "UPDATE case_box_audit_chain_heads SET head_hash = ?, last_event_id = ?, event_count = ? WHERE matter_id = ?",
    ).run(hashHex(JSON.parse(survivor.event_json)), survivor.event_id, evs.length - 1, DEFAULT_MATTER_ID);

    const r = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
    db.close();

    // Desired behaviour. Currently r.ok === true, which is why this is a todo.
    assert.equal(r.ok, false, "a consistently-truncated chain must not verify as ok");
  },
);

// ---------------------------------------------------------------------------
// TOTAL ERASURE — the detectable sibling of truncation.
//
// Truncation (T-TRUNC-3) is undetectable because a shorter chain is a valid
// chain. Total erasure is DIFFERENT and must not be conflated with it: a matter
// that exists always has at least its genesis MATTER_REGISTERED event, so a
// zero-event chain for an existing matter is impossible by construction. It is
// therefore evidence of deletion, and verification must fail closed on it.
// ---------------------------------------------------------------------------

test("T-ERASE-1 a matter whose audit events AND anchor row were both deleted must NOT verify", async () => {
  const { persistence, db } = await seedThreeEvents("erase1");
  assert.equal((await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID)).ok, true);

  // Deleting either one alone already fails closed (T-ERASE-2 pins that). Deleting
  // BOTH removes every internal disagreement, which is exactly what makes this the
  // attack worth guarding: the matter row survives, so the case still opens, but
  // its entire history is gone.
  db.prepare("DELETE FROM case_box_audit_events WHERE matter_id = ?").run(DEFAULT_MATTER_ID);
  db.prepare("DELETE FROM case_box_audit_chain_heads WHERE matter_id = ?").run(DEFAULT_MATTER_ID);

  const r = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  db.close();
  assert.equal(r.ok, false, "an existing matter with zero audit events must fail verification");
});

test("T-ERASE-2 partial erasure already fails closed — each half alone is detected", async () => {
  for (const [label, sql] of [
    ["anchor row only", "DELETE FROM case_box_audit_chain_heads WHERE matter_id = ?"],
    ["events only", "DELETE FROM case_box_audit_events WHERE matter_id = ?"],
  ]) {
    const { persistence, db } = await seedThreeEvents(`erase2${label[0]}`);
    db.prepare(sql).run(DEFAULT_MATTER_ID);
    const r = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
    db.close();
    assert.equal(r.ok, false, `${label}: must fail closed`);
  }
});

// ---------------------------------------------------------------------------
// T-GENESIS-1 — added 2026-08-22 after an external Codex audit (finding D1).
//
// The zero-event guard above only catches TOTAL erasure. Deleting the genesis event and
// RE-CHAINING the survivors produces a chain that is internally perfect and verifies ok —
// confirmed by execution before this test was written. It is a member of the re-forge
// class that T-TRUNC-3 documents as undetectable... except in one respect: the forged
// chain now BEGINS with a non-genesis event. `createMatter` is the only writer of the
// first event, so a live matter's chain must start with a matter-create event whose
// before_state_hash is null. That is checkable, and it is the one thing a re-forge
// cannot fake without also fabricating a genesis.
//
// The predicate deliberately uses action/entity_type/before_state_hash rather than the
// v2-only event_kind, so legacy v1 rows (which carry no event_kind) are not rejected.
// ---------------------------------------------------------------------------

test("T-GENESIS-1 a chain whose genesis was deleted and re-chained must NOT verify", async () => {
  const { persistence, db } = await seedThreeEvents("gen1");
  const evs = eventsOf(db);

  db.prepare("DELETE FROM case_box_audit_events WHERE event_id = ?").run(evs[0].event_id);

  // Re-chain the survivors so every internal link is valid again.
  let prev = null;
  let lastHash = null;
  for (const row of evs.slice(1)) {
    const e = JSON.parse(row.event_json);
    e.prev_event_hash = prev;
    db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
      .run(JSON.stringify(e), row.event_id);
    prev = hashHex(e);
    lastHash = prev;
  }
  db.prepare(
    "UPDATE case_box_audit_chain_heads SET head_hash = ?, last_event_id = ?, event_count = ? WHERE matter_id = ?",
  ).run(lastHash, evs[evs.length - 1].event_id, evs.length - 1, DEFAULT_MATTER_ID);

  const r = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  db.close();
  assert.equal(r.ok, false, "a chain not beginning with a genesis event must not verify");
  assert.equal(r.errorReason, "missing_genesis_event");
});

test("T-GENESIS-2 total erasure reports the genesis reason, not a generic chain error", async () => {
  // Codex finding D6: the erasure test asserted only ok===false, so a fix that returned
  // the wrong reason would have passed.
  const { persistence, db } = await seedThreeEvents("gen2");
  db.prepare("DELETE FROM case_box_audit_events WHERE matter_id = ?").run(DEFAULT_MATTER_ID);
  db.prepare("DELETE FROM case_box_audit_chain_heads WHERE matter_id = ?").run(DEFAULT_MATTER_ID);
  const r = await persistence.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
  db.close();
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "missing_genesis_event");
});

// ---------------------------------------------------------------------------
// WI-05 — an erased audit chain must not read as an ordinary empty one.
//
// Measured before writing this: delete every row from case_box_audit_events AND
// case_box_audit_chain_heads for a matter that still exists, and the two read paths return
//   listAuditEvents   -> { rows: [], next_cursor: null }
//   getAuditChainHead -> { headHash: null, lastEventId: null, count: 0 }
// which is indistinguishable from a matter that simply has no history yet. Only
// verifyAuditChainForMatter knows, and no IPC exposes it — so the app can display a deleted
// audit history as "nothing here yet". For the tool whose court-facing claim IS the audit
// chain, that is the worst presentation available.
//
// The discriminator needs no extra state, and it is the same shape as D-6: a matter that
// exists ALWAYS has a MATTER_REGISTERED genesis event, so "matter exists and the chain holds
// zero events" is a state that cannot legitimately occur.

import { openSqliteCaseBoxPersistence as openForWi05 } from "../dist/index.js";
import { InMemoryCaseBoxPersistence as InMemForWi05 } from "../dist/index.js";
import { mkdtempSync as mkdtempWi05 } from "node:fs";
import { tmpdir as tmpdirWi05 } from "node:os";
import pathWi05 from "node:path";

const W5_MID = "01j" + "a".repeat(20) + "mt1";
const W5_TID = "01j" + "a".repeat(20) + "tn1";
const w5Matter = () => ({
  id: W5_MID, tenant_id: W5_TID, actor_user_id: "u", name: "WI05 MATTER",
  jurisdiction: { value: "cn-sh", locked: false }, matter_type: "litigation",
  parties: [{ role: "client", display_name: "P", party_kind: "organization" }],
  confidentiality_class: "normal", status: "active",
  external_ocr_authorized: false, sync_grant_present: false, llm_extraction_opt_in: false,
  created_at: "2026-05-20T09:00:00.000Z", updated_at: "2026-05-20T09:00:00.000Z",
});

async function w5Store() {
  const p = pathWi05.join(mkdtempWi05(pathWi05.join(tmpdirWi05(), "wi05-")), "case.db");
  const r = openForWi05({ path: p });
  await r.persistence.createMatter(w5Matter());
  return r;
}

test("WI05-1 a HEALTHY chain still reads normally — the guard must not break the ordinary path", async () => {
  const r = await w5Store();
  try {
    const page = await r.persistence.listAuditEvents({ tenant_id: W5_TID, matter_id: W5_MID, limit: 50 });
    assert.ok(page.rows.length > 0, "fixture must produce a genesis event, or the rest is vacuous");
    const head = await r.persistence.getAuditChainHead(W5_MID);
    assert.equal(head.count, page.rows.length);
    assert.ok(head.headHash, "a healthy chain has a head hash");
  } finally { r.db.close(); }
});

test("WI05-2 getAuditChainHead REFUSES to present an erased chain as an empty one", async () => {
  const r = await w5Store();
  try {
    r.db.exec("DELETE FROM case_box_audit_events; DELETE FROM case_box_audit_chain_heads;");
    let err;
    try { await r.persistence.getAuditChainHead(W5_MID); } catch (e) { err = e; }
    assert.ok(err, "an existing matter with zero events must not return count:0 as if normal");
    assert.equal(err.code, "audit_chain_erased");
    assert.match(err.message, /erase|delet/i);
  } finally { r.db.close(); }
});

test("WI05-3 listAuditEvents REFUSES to present an erased chain as an empty page", async () => {
  const r = await w5Store();
  try {
    r.db.exec("DELETE FROM case_box_audit_events; DELETE FROM case_box_audit_chain_heads;");
    let err;
    try { await r.persistence.listAuditEvents({ tenant_id: W5_TID, matter_id: W5_MID, limit: 50 }); }
    catch (e) { err = e; }
    assert.ok(err, "an empty page is exactly the false presentation this WI exists to remove");
    assert.equal(err.code, "audit_chain_erased");
  } finally { r.db.close(); }
});

test("WI05-4 an UNKNOWN matter still reports unknown_matter, not erasure", async () => {
  // The two conditions are different and must stay distinguishable: no such matter is an
  // ordinary miss; a matter that exists with no history is evidence of deletion.
  const r = await w5Store();
  try {
    let err;
    try { await r.persistence.getAuditChainHead("01j" + "b".repeat(20) + "zz9"); } catch (e) { err = e; }
    assert.equal(err?.code, "unknown_matter");
  } finally { r.db.close(); }
});

test("WI05-6 paging to the END of a healthy chain must not cry erasure", async () => {
  // What this DOES pin: the guard does not fire while walking a healthy chain. What it does
  // NOT pin, stated so nobody reads more into it: the cursor exemption itself. Removing that
  // exemption survives mutation, and I checked why rather than writing a test to chase it —
  // normal paging never requests an empty page (next_cursor is null on the last page) and a
  // malformed cursor throws invalid_argument first. It is an equivalent mutant, not a gap.
  const r = await w5Store();
  try {
    await r.persistence.archiveMatter(W5_MID, { actor_user_id: "u", reason: "second event" });
    const first = await r.persistence.listAuditEvents({ tenant_id: W5_TID, matter_id: W5_MID, limit: 1 });
    assert.equal(first.rows.length, 1);
    assert.ok(first.next_cursor, "fixture needs at least two events to page, or this is vacuous");

    // Walk to the end. The last page comes back empty WITH a cursor, and must be ordinary.
    let cursor = first.next_cursor, pages = 0, rows = first.rows.length;
    while (cursor && pages < 10) {
      const page = await r.persistence.listAuditEvents({
        tenant_id: W5_TID, matter_id: W5_MID, limit: 1, cursor,
      });
      rows += page.rows.length; cursor = page.next_cursor; pages += 1;
    }
    assert.ok(rows >= 2, "should have walked the whole chain");
  } finally { r.db.close(); }
});

test("WI05-5 both implementations share ONE invariant, so they cannot drift", async () => {
  // The first version of this case reached for an erasure seam on the in-memory twin, found
  // none, and returned early — a vacuous pass dressed as parity coverage. Parity is now
  // structural instead: SQLite and the in-memory twin call the SAME exported helper, so there
  // is no second copy to drift. Test the helper directly, and assert both files use it.
  const { assertAuditChainNotErased } = await import("../dist/index.js");

  assert.doesNotThrow(() => assertAuditChainNotErased("m", 1), "a non-empty chain passes");
  let err;
  try { assertAuditChainNotErased("m", 0); } catch (e) { err = e; }
  assert.equal(err?.code, "audit_chain_erased");
  assert.match(err.message, /genesis/i, "and it must say WHY zero is impossible");

  const { readFileSync } = await import("node:fs");
  for (const f of ["dist/sqlite/SqliteCaseBoxPersistence.js", "dist/inMemoryAudit.js"]) {
    assert.match(readFileSync(new URL("../" + f, import.meta.url), "utf8"),
      /assertAuditChainNotErased/, `${f} must use the shared invariant, not its own copy`);
  }
});
