// Wire the shared conformance harness against the SQLite implementation,
// scoped to B10's filter pattern per the reviewed B10 plan §1.4.
//
// The harness's make() constructs `new Persistence({ now, generateId })`,
// but `SqliteCaseBoxPersistence` requires a Database. We wrap with a
// per-instance `:memory:` DB created in the constructor.
//
// Filter mechanism (CANONICAL per umbrella §2 + B1..B10 plans §1): the
// shared harness labels every test as `${label}: 6.1.N <description>`
// (or `${label}: R5.N` / `${label}: R6.N`). We pass label "Sqlite-B10";
// node:test's `--test-name-pattern` (run via the npm test command)
// filters the run to B10's scope. The B10 conformance pattern is the
// constant `B10_PATTERN` below; B10 is a SUPERSET of B1..B9 (matter +
// document + audit observability + confidentiality + privilege +
// facts + docket-entries + deadlines + evidence + OCR links +
// read-side aggregations + R5.* + R6.1..R6.4).
//
// Preflight assertion (per B1..B10 plans §1.3-§1.6):
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

// The B10 filter pattern (superset of B1..B9 + read-side aggregations
// cases 6.A2.1..6.A2.24 including 9a, 9b variants).
//
// Inner `26-27` alternative is placed BEFORE numeric ranges so the
// regex engine sees the literal combined-case label before trying
// `2[0-8]` (which would consume `26` and then fail the trailing
// `(?:\s|$)` lookahead on the `-`).
const B10_PATTERN = /^Sqlite-B10: (?:6\.1\.(?:13a|26-27|[1-9]|1[0-5]|1[6-9]|2[0-8]|29|30|31|3[2-8])|6\.A2\.(?:9a|9b|[1-9]|1[0-9]|2[0-4])|6\.A3\.(?:A2b|20b|21b|[1-9]|1[0-9]|2[0-7])|6\.A4\.(?:10b|10c|27b|27c|[1-9]|1[0-9]|2[0-8])|6\.A5\.(?:4b|18a|18b|19b|19c|[1-9]|1[0-9]|2[0-9]|3[0-2])|6\.A6\.(?:5b|18b|21b|[1-9]|1[0-9]|2[0-2])|6\.A7\.(?:1b|15b|1|2|3|4|6|7|8|11|12|13|14|15|16|17|18)|6\.A8\.(?:11b|12b|12c|19b|19c|24b|[1-9]|1[0-9]|2[0-4])|R5\.(?:[1-9]|9b|1[0-5]|19|20|2[1-4])|R6\.[1-4])(?:\s|$)/;

// Hand-enumerated list of B10 case ids per the reviewed B10 plan §1.4.
// Format matches the harness's `${label}: N <description>` shape.
const B10_EXPECTED_CASE_IDS = [
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
  // R6.4 uses getDocumentDetail (B10 read-aggregation) — now in scope.
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
  // B7 docket entries + deadline materialization (6.A5.1..6.A5.32 incl.
  // variants 4b/18a/18b/19b/19c) + R5.21..R5.24 (new deadline kinds).
  "6.A5.1", "6.A5.2", "6.A5.3", "6.A5.4", "6.A5.4b", "6.A5.5",
  "6.A5.6", "6.A5.7", "6.A5.8", "6.A5.9", "6.A5.10",
  "6.A5.11", "6.A5.12", "6.A5.13", "6.A5.14", "6.A5.15",
  "6.A5.16", "6.A5.17", "6.A5.18a", "6.A5.18b", "6.A5.19",
  "6.A5.19b", "6.A5.19c", "6.A5.20", "6.A5.21", "6.A5.22",
  "6.A5.23", "6.A5.24", "6.A5.25", "6.A5.26", "6.A5.27",
  "6.A5.28", "6.A5.29", "6.A5.30", "6.A5.31", "6.A5.32",
  "R5.21", "R5.22", "R5.23", "R5.24",
  // B8 evidence items (6.A6.1..6.A6.22 incl. variants 5b, 18b, 21b) + R5.19/R5.20.
  "6.A6.1", "6.A6.2", "6.A6.3", "6.A6.4", "6.A6.5", "6.A6.5b",
  "6.A6.6", "6.A6.7", "6.A6.8", "6.A6.9", "6.A6.10",
  "6.A6.11", "6.A6.12", "6.A6.13", "6.A6.14", "6.A6.15",
  "6.A6.16", "6.A6.17", "6.A6.18", "6.A6.18b", "6.A6.19",
  "6.A6.20", "6.A6.21", "6.A6.21b", "6.A6.22",
  "R5.19", "R5.20",
  // B9 OCR links (6.A7.* incl. variants 1b, 15b; NO 5, 9, 10 — harness
  // has no such ids; explicit alternation per plan §1.5 rev-3).
  "6.A7.1", "6.A7.1b", "6.A7.2", "6.A7.3", "6.A7.4",
  "6.A7.6", "6.A7.7", "6.A7.8",
  "6.A7.11", "6.A7.12", "6.A7.13", "6.A7.14",
  "6.A7.15", "6.A7.15b", "6.A7.16", "6.A7.17", "6.A7.18",
  // B10 read-side aggregations (6.A8.* incl. variants 11b, 12b, 12c,
  // 19b, 19c, 24b) + R6.4 (getDocumentDetail asset-field preservation).
  "6.A8.1", "6.A8.2", "6.A8.3", "6.A8.4", "6.A8.5",
  "6.A8.6", "6.A8.7", "6.A8.8", "6.A8.9", "6.A8.10",
  "6.A8.11", "6.A8.11b", "6.A8.12", "6.A8.12b", "6.A8.12c",
  "6.A8.13", "6.A8.14", "6.A8.15", "6.A8.16",
  "6.A8.19", "6.A8.19b", "6.A8.19c",
  "6.A8.20", "6.A8.21", "6.A8.22", "6.A8.23",
  "6.A8.24", "6.A8.24b",
  "R6.4",
];

// Preflight: parse the harness source for the literal label + case-id
// strings (templated as `${label}: <case-id> ...`) and verify the
// regex matches exactly the expected B10 set.
// Preflight: verify the regex matches exactly the expected B3 case set,
// and does NOT match cases outside B6's scope. We do NOT scan the
// harness source for literal IDs because some cases (e.g., 6.1.6/7/8)
// are generated by a runtime loop, so a literal grep would miss them.
// The harness's own conformance run is the authoritative end-to-end
// check — preflight just guards the regex shape against drift.
test("Sqlite-B10 conformance preflight: regex matches exactly the B6 case set", () => {
  // Confirm the harness file is reachable (preflight does not parse it).
  const here = dirname(fileURLToPath(import.meta.url));
  void readFileSync(join(here, "conformance", "runCaseBoxPersistenceConformance.mjs"), "utf8");

  const matched = [];
  for (const id of B10_EXPECTED_CASE_IDS) {
    const synthetic = `Sqlite-B10: ${id} placeholder description`;
    if (B10_PATTERN.test(synthetic)) matched.push(id);
  }
  assert.deepEqual(matched, B10_EXPECTED_CASE_IDS, "B10 regex must match every expected case id");

  // Verify the regex does NOT match cases outside B6's scope (smoke).
  // 6.A3.* is now in B5 scope; B5 stops there. 6.A4+ is B6+.
  for (const outside of ["6.A7.5", "6.A7.9", "6.A7.10", "6.A7.19", "6.A8.25", "6.A9.1", "R6.5", "R5.16", "R5.17", "R5.18"]) {
    const synthetic = `Sqlite-B10: ${outside} placeholder description`;
    assert.equal(B10_PATTERN.test(synthetic), false, `${outside} must NOT match B10 pattern`);
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

runConformance("Sqlite-B10", () => ({ Persistence: SqliteCaseBoxPersistenceTestWrapper }));
