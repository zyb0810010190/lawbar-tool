// Wire the shared conformance harness against the SQLite implementation,
// scoped to B6's filter pattern per the reviewed B4 plan §1.8.
//
// The harness's make() constructs `new Persistence({ now, generateId })`,
// but `SqliteCaseBoxPersistence` requires a Database. We wrap with a
// per-instance `:memory:` DB created in the constructor.
//
// Filter mechanism (CANONICAL per umbrella §2 + B1/B2/B3/B4 plans §1): the
// shared harness labels every test as `${label}: 6.1.N <description>`
// (or `${label}: R5.N` / `${label}: R6.N`). We pass label "Sqlite-B6";
// node:test's `--test-name-pattern` (run via the npm test command)
// filters the run to B6's scope. The B4 conformance pattern is the
// constant `B6_PATTERN` below; B4 is a SUPERSET of B3 (matter +
// document + R5 + R6.1..R6.3 + getAuditChainHead 6.1.29..6.1.31 +
// audit-read 6.1.32 / 6.1.34..6.1.38 + confidentiality
// 6.A2.1..6.A2.24 incl. 9a, 9b variants).
//
// Preflight assertion (per B1 §1.3 + B2 §1.5 + B3 §1.6 + B4 §1.8):
// the runner hand-enumerates the expected case ids and asserts they match
// against a list of cases the harness will register (built by reading
// the harness file with the regex). If the count drifts (e.g., harness
// renames a case), the preflight test fails before the full conformance
// run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openSqliteCaseBoxPersistence } from "../dist/index.js";
import { runConformance } from "./conformance/runCaseBoxPersistenceConformance.mjs";

// The B4 filter pattern (superset of B3 + confidentiality classification
// cases 6.A2.1..6.A2.24 including 9a, 9b variants).
//
// Inner `26-27` alternative is placed BEFORE numeric ranges so the
// regex engine sees the literal combined-case label before trying
// `2[0-8]` (which would consume `26` and then fail the trailing
// `(?:\s|$)` lookahead on the `-`).
const B6_PATTERN = /^Sqlite-B6: (?:6\.1\.(?:13a|26-27|[1-9]|1[0-5]|1[6-9]|2[0-8]|29|30|31|3[2-8])|6\.A2\.(?:9a|9b|[1-9]|1[0-9]|2[0-4])|6\.A3\.(?:A2b|20b|21b|[1-9]|1[0-9]|2[0-7])|6\.A4\.(?:10b|10c|27b|27c|[1-9]|1[0-9]|2[0-8])|R5\.(?:[1-9]|9b|1[0-5])|R6\.[1-3])(?:\s|$)/;

// Hand-enumerated list of B4 case ids per the reviewed B4 plan §1.8.
// Format matches the harness's `${label}: N <description>` shape.
const B6_EXPECTED_CASE_IDS = [
  // B1-carried (matter lifecycle 6.1.1..6.1.15 + matter R5)
  "6.1.1", "6.1.2", "6.1.3", "6.1.4", "6.1.5",
  "6.1.6", "6.1.7", "6.1.8", "6.1.9", "6.1.10",
  "6.1.11", "6.1.12", "6.1.13", "6.1.13a", "6.1.14", "6.1.15",
  "R5.1", "R5.2", "R5.3", "R5.4", "R5.5", "R5.6",
  // B2-carried (document lifecycle 6.1.16..6.1.28 + document R5 + R6).
  // Note `6.1.26-27` is a single combined harness test (listDocuments
  // single + multi-page); `6.1.28` is listDocuments cursor-filter check.
  "6.1.16", "6.1.17", "6.1.18", "6.1.19", "6.1.20",
  "6.1.21", "6.1.22", "6.1.23", "6.1.24", "6.1.25",
  "6.1.26-27", "6.1.28",
  "R5.7", "R5.8", "R5.9", "R5.9b", "R5.10", "R5.11", "R5.12", "R5.13", "R5.14",
  "R6.1", "R6.2", "R6.3",
  // R6.4 uses getDocumentDetail (B10 read-aggregation) — out of B2/B3 scope.
  // B1 getAuditChainHead cases CARRIED FORWARD per B3 plan rev-1 Dim-1 #1
  // (previously omitted from B2 regex).
  "6.1.29", "6.1.30", "6.1.31",
  // B3 audit-read cases (6.1.33 does NOT exist in the harness; verified via grep).
  "6.1.32", "6.1.34", "6.1.35", "6.1.36", "6.1.37", "6.1.38",
  // B4 confidentiality classification cases (6.A2.1..6.A2.24 incl. 9a, 9b).
  "6.A2.1", "6.A2.2", "6.A2.3", "6.A2.4", "6.A2.5", "6.A2.6", "6.A2.7", "6.A2.8",
  "6.A2.9", "6.A2.9a", "6.A2.9b",
  "6.A2.10", "6.A2.11", "6.A2.12", "6.A2.13", "6.A2.14", "6.A2.15", "6.A2.16",
  "6.A2.17", "6.A2.18", "6.A2.19", "6.A2.20", "6.A2.21", "6.A2.22", "6.A2.23", "6.A2.24",
  // B5 privilege marker cases (6.A3.1..6.A3.27 incl. 20b, 21b, A2b).
  "6.A3.1", "6.A3.2", "6.A3.3", "6.A3.4", "6.A3.5", "6.A3.6", "6.A3.7", "6.A3.8",
  "6.A3.9", "6.A3.10", "6.A3.11", "6.A3.12", "6.A3.13", "6.A3.14", "6.A3.15",
  "6.A3.16", "6.A3.17", "6.A3.18", "6.A3.19", "6.A3.20", "6.A3.20b", "6.A3.21",
  "6.A3.21b", "6.A3.22", "6.A3.23", "6.A3.24", "6.A3.25", "6.A3.26", "6.A3.27",
  "6.A3.A2b",
  // B6 facts cases (6.A4.1..6.A4.28 incl. 10b, 10c, 27b, 27c) + R5.15.
  // R5.16..R5.18 stay OUT (appendFactOnce is B11; umbrella row B6 acceptance
  // text contradicts row B11 — resolved via separate docs-only WI per B6
  // plan §"Umbrella-divergence note").
  "6.A4.1", "6.A4.2", "6.A4.3", "6.A4.4", "6.A4.5", "6.A4.6", "6.A4.7", "6.A4.8",
  "6.A4.9", "6.A4.10", "6.A4.10b", "6.A4.10c", "6.A4.11", "6.A4.12", "6.A4.13",
  "6.A4.14", "6.A4.15", "6.A4.16", "6.A4.17", "6.A4.18", "6.A4.19", "6.A4.20",
  "6.A4.21", "6.A4.22", "6.A4.23", "6.A4.24", "6.A4.25", "6.A4.26", "6.A4.27",
  "6.A4.27b", "6.A4.27c", "6.A4.28",
  "R5.15",
];

// Preflight: parse the harness source for the literal label + case-id
// strings (templated as `${label}: <case-id> ...`) and verify the
// regex matches exactly the expected B3 set.
// Preflight: verify the regex matches exactly the expected B3 case set,
// and does NOT match cases outside B6's scope. We do NOT scan the
// harness source for literal IDs because some cases (e.g., 6.1.6/7/8)
// are generated by a runtime loop, so a literal grep would miss them.
// The harness's own conformance run is the authoritative end-to-end
// check — preflight just guards the regex shape against drift.
test("Sqlite-B6 conformance preflight: regex matches exactly the B6 case set", () => {
  // Confirm the harness file is reachable (preflight does not parse it).
  const here = dirname(fileURLToPath(import.meta.url));
  void readFileSync(join(here, "conformance", "runCaseBoxPersistenceConformance.mjs"), "utf8");

  const matched = [];
  for (const id of B6_EXPECTED_CASE_IDS) {
    const synthetic = `Sqlite-B6: ${id} placeholder description`;
    if (B6_PATTERN.test(synthetic)) matched.push(id);
  }
  assert.deepEqual(matched, B6_EXPECTED_CASE_IDS, "B6 regex must match every expected case id");

  // Verify the regex does NOT match cases outside B6's scope (smoke).
  // 6.A3.* is now in B5 scope; B5 stops there. 6.A4+ is B6+.
  for (const outside of ["6.A4.29", "6.A5.1", "6.A9.1", "R6.4", "R5.16", "R5.17", "R5.18"]) {
    const synthetic = `Sqlite-B6: ${outside} placeholder description`;
    assert.equal(B6_PATTERN.test(synthetic), false, `${outside} must NOT match B6 pattern`);
  }
});

// Wrapper that satisfies the harness's `new Persistence({ now, generateId })`
// shape by auto-opening a fresh `:memory:` DB per instance. The DB is
// retained as a private field; better-sqlite3 closes the handle when
// the wrapper is garbage-collected (the harness creates one instance
// per test; :memory: DBs are lightweight).
class SqliteCaseBoxPersistenceTestWrapper {
  constructor(opts) {
    const { persistence, db } = openSqliteCaseBoxPersistence({
      path: ":memory:",
      now: opts?.now,
      generateId: opts?.generateId,
    });
    Object.assign(this, persistence);
    // Bind every method so harness can call `p.method(...)` on `this`.
    Object.getOwnPropertyNames(Object.getPrototypeOf(persistence))
      .filter((m) => m !== "constructor" && typeof persistence[m] === "function")
      .forEach((m) => { this[m] = persistence[m].bind(persistence); });
    this._db = db;
  }
}

runConformance("Sqlite-B6", () => ({ Persistence: SqliteCaseBoxPersistenceTestWrapper }));
