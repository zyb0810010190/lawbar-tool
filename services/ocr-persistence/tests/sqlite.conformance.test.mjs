// Conformance entry-point for SqliteOcrPersistence (Step 9).
//
// Runs the same behavioral conformance harness used by InMemoryOcrPersistence
// against the SQLite-backed implementation. Each test gets a fresh in-memory
// SQLite database; cleanup closes the connection.

import {
  openSqliteOcrPersistence,
  OcrPersistenceError,
} from "../dist/index.js";

import { runOcrPersistenceConformance } from "./conformance/runOcrPersistenceConformance.mjs";

runOcrPersistenceConformance({
  label: "SqliteOcrPersistence",
  OcrPersistenceError,
  makeImpl: ({ now }) => {
    const { persistence, db } = openSqliteOcrPersistence({ now });
    return {
      persistence,
      cleanup: () => {
        db.close();
      },
    };
  },
});
