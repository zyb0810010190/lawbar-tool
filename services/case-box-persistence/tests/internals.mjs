// Test-only seam for case-box-persistence audit-chain tamper tests.
//
// Imports the module-private `_tamperStoredEventForTest` function from
// `../dist/inMemoryRepo.js` — that function is NOT re-exported from the
// package's `src/index.ts`, so external consumers using
// `case-box-persistence` (via the `exports` field) cannot reach it.
//
// The conformance §6.2.7 prototype allowlist check protects the public
// surface: `_tamperStoredEventForTest` is a top-level function, not a
// method on `InMemoryCaseBoxPersistence`, so the prototype's
// `Object.getOwnPropertyNames` stays clean.

export { _tamperStoredEventForTest as tamperStoredEvent } from "../dist/inMemoryRepo.js";
export { _tamperFactSupersedesForTest } from "../dist/inMemoryFact.js";
// Module-private fact-state accessor for the conformance harness. Lets
// the cycle-walk test inject pre-corrupt state. Not re-exported from
// src/index.ts — invisible to package consumers.
export { _internalFactStateForTest } from "../dist/inMemoryRepo.js";

// WI-PTA-VS0: canonical state / event hash helpers, re-exported so tests can
// assert state-hash continuity directly (dist-internal, not on the public
// surface).
export { entityStateHash, eventHashFn } from "../dist/auditChain.js";

import { _tamperFactSupersedesForTest as _tamperInMem } from "../dist/inMemoryFact.js";
import { _internalFactStateForTest as _internalState } from "../dist/inMemoryRepo.js";
import { _setStoredMatterPartiesForTest } from "../dist/inMemoryRepo.js";
import { entityStateHash, eventHashFn } from "../dist/auditChain.js";

// Polymorphic tamper helper for the supersession-cycle conformance
// test (6.A4.22). InMemory persistence uses the in-memory state seam;
// SQLite persistence (test wrapper exposes `_db`) updates the row +
// payload_json directly via SQL. Per B6 plan §1.4 + §1.6: SQLite
// tamper is the row-mutation analog of B3's payload-tamper hardening.
export function _tamperFactSupersedesAny(persistence, factId, newSupersedes) {
  if (persistence && persistence._db) {
    const row = persistence._db
      .prepare("SELECT payload_json FROM case_box_facts WHERE id = ?")
      .get(factId);
    if (row === undefined) {
      throw new Error(`tamper(sqlite): unknown factId ${factId}`);
    }
    const parsed = JSON.parse(row.payload_json);
    parsed.supersedes_fact_id = newSupersedes;
    persistence._db
      .prepare("UPDATE case_box_facts SET supersedes_fact_id = ?, payload_json = ? WHERE id = ?")
      .run(newSupersedes, JSON.stringify(parsed), factId);
    return;
  }
  _tamperInMem(_internalState(persistence), factId, newSupersedes);
}

// WI-PTA-VS0 — legacy-matter constructor. Overwrites a stored matter's parties
// array AND re-aligns the last matter event's after_state_hash so the chain
// stays internally consistent, reconstructing a pre-WI matter whose parties
// were never server-assigned ids (or one with invalidly-duplicate ids) — the
// only route to `ensureMatterPartyIds`'s non-idempotent / reject paths now that
// create id-fills.
//
// InMemory persistence uses the in-memory state seam; SQLite uses the `db`
// handle from openSqliteCaseBoxPersistence (pass it explicitly), mirroring the
// row-level tamper analog used by _tamperFactSupersedesAny.

/** Strip `id` from every party of the given fixture parties (helper). */
export function stripPartyIds(parties) {
  return parties.map((p) => {
    const { id, ...rest } = p;
    void id;
    return { ...rest };
  });
}

export function setStoredMatterPartiesInMemory(persistence, matterId, parties) {
  _setStoredMatterPartiesForTest(persistence, matterId, parties, true);
}

// Desync variant (audit remediation FIX 3): rewrite the stored payload WITHOUT
// re-aligning the last event's after_state_hash — the OPPOSITE of the aligned
// seam — so the stored matter payload no longer matches the chain head, to
// exercise the fail-closed `audit_chain_desync` backfill guard.
export function setStoredMatterPartiesInMemoryNoRealign(persistence, matterId, parties) {
  _setStoredMatterPartiesForTest(persistence, matterId, parties, false);
}

export function setStoredMatterPartiesSqliteNoRealign(db, matterId, parties) {
  const mrow = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(matterId);
  if (mrow === undefined) {
    throw new Error(`setStoredMatterPartiesSqliteNoRealign: unknown matter ${matterId}`);
  }
  const matter = JSON.parse(mrow.payload_json);
  matter.parties = JSON.parse(JSON.stringify(parties));
  // Payload only — the seed event's after_state_hash + chain head are left
  // untouched, so the stored payload is now out of sync with the chain.
  db.prepare("UPDATE case_box_matters SET payload_json = ? WHERE id = ? AND tenant_id = ?")
    .run(JSON.stringify(matter), matterId, matter.tenant_id);
}

export function setStoredMatterPartiesSqlite(db, matterId, parties) {
  const mrow = db
    .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
    .get(matterId);
  if (mrow === undefined) {
    throw new Error(`setStoredMatterPartiesSqlite: unknown matter ${matterId}`);
  }
  const matter = JSON.parse(mrow.payload_json);
  matter.parties = JSON.parse(JSON.stringify(parties));
  const newAfter = entityStateHash(matter);
  db.prepare("UPDATE case_box_matters SET payload_json = ? WHERE id = ? AND tenant_id = ?")
    .run(JSON.stringify(matter), matterId, matter.tenant_id);
  // Re-align the head matter event: after_state_hash + recomputed event_hash +
  // event_json, then the chain-head's head_hash, so verify still passes.
  const head = db
    .prepare("SELECT last_event_id FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(matterId);
  const erow = db
    .prepare("SELECT event_json FROM case_box_audit_events WHERE event_id = ?")
    .get(head.last_event_id);
  const event = JSON.parse(erow.event_json);
  event.after_state_hash = newAfter;
  const newHash = eventHashFn(event);
  db.prepare(
    "UPDATE case_box_audit_events SET after_state_hash = ?, event_hash = ?, event_json = ? WHERE event_id = ?",
  ).run(newAfter, newHash, JSON.stringify(event), head.last_event_id);
  db.prepare("UPDATE case_box_audit_chain_heads SET head_hash = ? WHERE matter_id = ?")
    .run(newHash, matterId);
}
