// Focused tests for the Step 9 SQLite "should-fix" hardening:
//
// 1. applySchema is idempotent under repeat invocation (and the schema_version
//    insert tolerates the row already existing — INSERT OR IGNORE).
// 2. Unexpected better-sqlite3 driver errors are wrapped into
//    OcrPersistenceError carrying ONLY the driver's stable `.code`
//    (`SQLITE_*` / errno enum) after an "internal db error: " prefix — the
//    raw `.message` (which can embed the DB file path, a SQL fragment, or a
//    schema identifier like a table name) MUST NOT cross the persistence
//    boundary. See dev-memo/ocr-persistence-error-sanitization.md (WI-25).
//
// These complement (not replace) the shared conformance harness.

import { test } from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  SqliteOcrPersistence,
  OcrPersistenceError,
} from "../dist/index.js";
// Internal module export (NOT part of the package's public `index.js`
// surface) — imported via the deep dist path purely so the security-
// load-bearing sanitizer can be pinned version-independently.
import { sanitizeDriverErrorCode } from "../dist/sqlite/SqliteOcrPersistence.js";

test("applySchema: repeated invocation is idempotent (INSERT OR IGNORE)", () => {
  const db = new Database(":memory:");
  try {
    const v1 = applySchema(db);
    const v2 = applySchema(db);
    const v3 = applySchema(db);
    assert.equal(v1, CURRENT_SCHEMA_VERSION);
    assert.equal(v2, CURRENT_SCHEMA_VERSION);
    assert.equal(v3, CURRENT_SCHEMA_VERSION);

    const rows = db
      .prepare("SELECT version FROM schema_version ORDER BY version ASC")
      .all();
    // One row per applied migration (1..CURRENT_SCHEMA_VERSION). Repeat
    // invocations of applySchema must not duplicate rows — INSERT OR
    // IGNORE keeps the per-version applied_at frozen at first-write.
    assert.equal(rows.length, CURRENT_SCHEMA_VERSION);
    for (let i = 0; i < CURRENT_SCHEMA_VERSION; i++) {
      assert.equal(rows[i].version, i + 1);
    }
  } finally {
    db.close();
  }
});

test("applySchema: schema_version row is preserved across re-runs", () => {
  const db = new Database(":memory:");
  try {
    let nowCallCount = 0;
    const fixed = () => {
      nowCallCount++;
      return new Date("2030-06-01T00:00:00Z");
    };
    applySchema(db, fixed);
    const firstApplied = db
      .prepare("SELECT applied_at FROM schema_version WHERE version = ?")
      .get(CURRENT_SCHEMA_VERSION).applied_at;

    // Second call uses a different timestamp source — INSERT OR IGNORE must
    // *not* overwrite the first applied_at.
    applySchema(db, () => new Date("2099-12-31T23:59:59Z"));
    const secondApplied = db
      .prepare("SELECT applied_at FROM schema_version WHERE version = ?")
      .get(CURRENT_SCHEMA_VERSION).applied_at;

    assert.equal(secondApplied, firstApplied);
    // First apply runs every missing migration (1..CURRENT_SCHEMA_VERSION),
    // sampling `now` once per migration. The second apply short-circuits
    // (DB already at current) and does not call `now` at all.
    assert.equal(
      nowCallCount,
      CURRENT_SCHEMA_VERSION,
      "applied_at clock sampled once per migration on first apply, never again",
    );
  } finally {
    db.close();
  }
});

test(
  "wrapErrors: unexpected driver error is wrapped into OcrPersistenceError carrying only the stable code (no raw message / schema identifier)",
  async () => {
    // Construct a persistence WITHOUT applying the schema so any access
    // raises a raw SqliteError whose *message* embeds a schema identifier
    // ("no such table: ocr_jobs"). This is a realistic stand-in for any
    // unexpected DB-layer failure (drift, corruption, transient I/O) — we
    // just need *something* the driver throws on that is not a domain
    // validation failure, and whose message carries a sensitive fragment.
    const db = new Database(":memory:");
    try {
      const persistence = new SqliteOcrPersistence({
        db,
        applySchemaOnInit: false,
      });

      let captured;
      try {
        await persistence.getOcrJob("01arz3ndektsv4rrffq69g5fav");
      } catch (err) {
        captured = err;
      }

      assert.ok(
        captured instanceof OcrPersistenceError,
        `expected OcrPersistenceError, got ${captured?.constructor?.name}`,
      );
      // Stable prefix retained for callers that key on it.
      assert.match(captured.message, /^internal db error: /);
      // WI-25: ONLY the driver's stable code survives — the wrapped message
      // is exactly "internal db error: <ENUM_CODE>", nothing more.
      assert.match(captured.message, /^internal db error: [A-Z][A-Z0-9_]*$/);
      // The raw driver message body — here a schema identifier — MUST NOT
      // cross the boundary. A DB file path or SQL fragment would be scrubbed
      // by the identical code path.
      assert.doesNotMatch(captured.message, /no such table/i);
      assert.doesNotMatch(captured.message, /ocr_jobs/);
    } finally {
      db.close();
    }
  },
);

test(
  "sanitizeDriverErrorCode: a driver error whose message embeds a client path yields only the stable code (no path leak)",
  () => {
    // The canonical confidentiality threat for a local-first legal tool: a
    // SQLITE_CANTOPEN whose *message* names the matter DB file — and thus the
    // client. Feed the sanitizer the exact error shape better-sqlite3 raises
    // for such a failure and prove ONLY the stable code survives. (We drive
    // the sanitizer directly with a synthetic shape rather than a live open,
    // because the installed better-sqlite3 pre-guards a missing directory
    // with a path-free message — so a version-independent regression must
    // pin the sanitizer's own contract, not one driver build's phrasing.)
    const pathCarrying = {
      code: "SQLITE_CANTOPEN",
      message:
        "unable to open database file '/private/var/matters/ClientConfidential-2026/ocr-store.db'",
    };
    assert.equal(sanitizeDriverErrorCode(pathCarrying), "SQLITE_CANTOPEN");

    // A SQL/schema-fragment message → code only.
    assert.equal(
      sanitizeDriverErrorCode({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: case_box_ocr_links.document_id",
      }),
      "SQLITE_CONSTRAINT_UNIQUE",
    );

    // A known Node errno (local-store I/O) → surfaced.
    assert.equal(
      sanitizeDriverErrorCode({ code: "ENOENT", message: "/Users/x/y.db" }),
      "ENOENT",
    );

    // Allowlist, not shape-match: an enum-SHAPED but sensitive / unknown
    // `.code` a rogue non-driver error might carry MUST collapse to
    // "unknown" — it is neither a known errno nor a SQLITE_ token.
    assert.equal(
      sanitizeDriverErrorCode({ code: "CLIENTCONFIDENTIAL_2026" }),
      "unknown",
    );
    assert.equal(sanitizeDriverErrorCode({ code: "OCR_TEXT_RED_FLAG" }), "unknown");
    // A SQLITE_-prefixed token carrying non-enum characters is rejected too.
    assert.equal(
      sanitizeDriverErrorCode({ code: "SQLITE_/private/matters/ClientX.db" }),
      "unknown",
    );

    // No code, a numeric code, a free-text code, or a non-object → opaque
    // "unknown" (never the raw message).
    assert.equal(
      sanitizeDriverErrorCode(new Error("boom at /Users/lawyer/secret.db")),
      "unknown",
    );
    assert.equal(
      sanitizeDriverErrorCode({ code: "leak /Users/lawyer/secret.db" }),
      "unknown",
    );
    assert.equal(sanitizeDriverErrorCode({ code: 14 }), "unknown");
    assert.equal(sanitizeDriverErrorCode("raw string error"), "unknown");
    assert.equal(sanitizeDriverErrorCode(null), "unknown");
    assert.equal(sanitizeDriverErrorCode(undefined), "unknown");

    // The wrapped form the persistence boundary emits carries no path chars.
    const wrapped = `internal db error: ${sanitizeDriverErrorCode(pathCarrying)}`;
    assert.doesNotMatch(wrapped, /ClientConfidential-2026/);
    assert.doesNotMatch(wrapped, /\//);
    assert.match(wrapped, /^internal db error: [A-Z][A-Z0-9_]*$/);
  },
);

test(
  "wrapErrors: domain OcrPersistenceError propagates verbatim (not wrapped)",
  async () => {
    // Sanity: the wrapping path must NOT double-wrap legitimate domain errors.
    // Calling getOcrJob on a fully-applied schema with an unknown id is not
    // an error (returns null); we use createOcrJob with invalid input which
    // raises an "invalid submission" OcrPersistenceError.
    const db = new Database(":memory:");
    try {
      const persistence = new SqliteOcrPersistence({ db });

      let captured;
      try {
        await persistence.createOcrJob({ totally: "invalid" });
      } catch (err) {
        captured = err;
      }

      assert.ok(captured instanceof OcrPersistenceError);
      assert.match(captured.message, /^invalid submission: /);
      assert.doesNotMatch(captured.message, /internal db error/);
    } finally {
      db.close();
    }
  },
);
