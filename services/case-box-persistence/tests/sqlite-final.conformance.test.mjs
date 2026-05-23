// Phase B FINAL conformance sweep. Per B11 plan §1.4 + umbrella row B11.
//
// Runs the FULL shared conformance harness with label "Sqlite-Final"
// and NO --test-name-pattern filter (the package.json invocation runs
// `node --test tests/sqlite-final.conformance.test.mjs` directly).
// Every 6.x.x case + every R5.* + every R6.* must pass under the
// SqliteCaseBoxPersistence implementation.
//
// This is the **Phase B SQLite implementation completion gate**.
// (Go-live readiness remains separately gated per .claude/rules/autonomy.md.)

import { openSqliteCaseBoxPersistence } from "../dist/index.js";
import { runConformance } from "./conformance/runCaseBoxPersistenceConformance.mjs";

// SqliteCaseBoxPersistenceTestWrapper — mirrors sqlite.conformance.test.mjs.
// The wrapper exposes the persistence's full method surface to the harness
// via prototype-method binding (each :memory: DB is per-test and lightweight).
class SqliteCaseBoxPersistenceTestWrapper {
  constructor(opts) {
    const { persistence, db } = openSqliteCaseBoxPersistence({
      path: ":memory:",
      now: opts?.now,
      generateId: opts?.generateId,
    });
    Object.assign(this, persistence);
    Object.getOwnPropertyNames(Object.getPrototypeOf(persistence))
      .filter((m) => m !== "constructor" && typeof persistence[m] === "function")
      .forEach((m) => { this[m] = persistence[m].bind(persistence); });
    this._db = db;
  }
}

// Label "Sqlite-Final"; NO filter applied at the test-name layer (the
// package.json invocation passes no --test-name-pattern for this file).
runConformance("Sqlite-Final", () => ({ Persistence: SqliteCaseBoxPersistenceTestWrapper }));
