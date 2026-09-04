// Main-process backup handlers + the last-verified record.
//
// The load-bearing claim here is NEGATIVE: a run that fails must never advance "last backup",
// and must not retire the last good one either. Get that wrong and the screen tells a litigator
// they are protected on the strength of an archive that was never proven — which is worse than
// telling them nothing, because they will stop checking.
//
// The second claim is that the renderer cannot choose the destination. `backupRunHandler` takes
// no path: main supplies `chooseDestination`. That is asserted by shape, below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { backupRunHandler, backupStatusHandler, BACKUP_CHANNEL } from "../dist/src/backup/backupHandlers.js";
import { loadBackupRecord, saveBackupRecord, daysSince, NO_BACKUP } from "../dist/src/persistence/backupRecord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);
const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const { applySchema, CURRENT_SCHEMA_VERSION } = require_(
  path.join(REPO, "services/case-box-persistence/dist/index.js"),
);

const tmp = (l) => mkdtempSync(path.join(os.tmpdir(), `lawbar-${l}-`));

function makeDeps({ destination, userDataDir, docsRoot }) {
  const db = new Database(path.join(userDataDir, "case-box.sqlite"));
  db.pragma("journal_mode = WAL");
  applySchema(db);
  return {
    db,
    deps: {
      userDataDir,
      documentsRoot: docsRoot,
      appVersion: "0.1.0-test",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      getDb: () => db,
      openBackupDb: (f) => new Database(f, { readonly: true }),
      chooseDestination: async () => destination,
      now: () => new Date("2026-09-02T12:00:00.000Z"),
    },
  };
}

// MARK: - The record only ever advances on a VERIFIED run

test("a successful run records the verified time; status then reports it", async () => {
  const userDataDir = tmp("data"), dest = tmp("dest"), docsRoot = path.join(userDataDir, "case-box-documents");
  const { db, deps } = makeDeps({ destination: dest, userDataDir, docsRoot });
  try {
    assert.equal(backupStatusHandler(deps).hasEverBackedUp, false, "nothing yet");
    const r = await backupRunHandler(deps);
    assert.equal(r.ok, true, r.ok ? "" : r.code);
    const status = backupStatusHandler(deps);
    assert.equal(status.hasEverBackedUp, true);
    assert.equal(status.lastVerifiedAt, r.verifiedAt);
    assert.equal(status.daysSinceLastVerified, 0);
  } finally { db.close(); rmSync(userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("a FAILED run leaves the record untouched — no advance, no erasure", async () => {
  const userDataDir = tmp("data"), dest = tmp("dest"), docsRoot = path.join(userDataDir, "case-box-documents");
  const { db, deps } = makeDeps({ destination: dest, userDataDir, docsRoot });
  try {
    const good = await backupRunHandler(deps);
    assert.equal(good.ok, true);
    const before = loadBackupRecord(userDataDir);

    // Now force a failure: aim the next run inside the data directory.
    const failing = { ...deps, chooseDestination: async () => userDataDir };
    const bad = await backupRunHandler(failing);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "destination_inside_data_dir");

    const after = loadBackupRecord(userDataDir);
    assert.deepEqual(after, before,
      "a failed run must neither advance 'last backup' nor retire the last good one");
  } finally { db.close(); rmSync(userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("cancelling the chooser is reported as cancelled and writes nothing", async () => {
  const userDataDir = tmp("data"), docsRoot = path.join(userDataDir, "case-box-documents");
  const { db, deps } = makeDeps({ destination: null, userDataDir, docsRoot });
  try {
    const r = await backupRunHandler({ ...deps, chooseDestination: async () => null });
    assert.equal(r.ok, false);
    assert.equal(r.code, "cancelled");
    assert.equal(existsSync(path.join(userDataDir, "backup-record.json")), false,
      "closing a dialog must not touch the record");
  } finally { db.close(); rmSync(userDataDir, { recursive: true, force: true }); }
});

// MARK: - Nothing derived from the filesystem crosses the boundary

test("the result carries a CODE and no path, message, or stack", async () => {
  const userDataDir = tmp("data"), docsRoot = path.join(userDataDir, "case-box-documents");
  const { db, deps } = makeDeps({ destination: userDataDir, userDataDir, docsRoot });
  try {
    const r = await backupRunHandler(deps);
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r).sort(), ["code", "ok"],
      "a detail string could carry a destination path, and drives get named after matters");
    assert.equal(JSON.stringify(r).includes(userDataDir), false, "no path in the payload");
  } finally { db.close(); rmSync(userDataDir, { recursive: true, force: true }); }
});

test("backupRunHandler takes no destination argument — main owns the chooser", () => {
  assert.equal(backupRunHandler.length, 1, "one argument: deps. A path parameter would be the bug.");
  assert.deepEqual(Object.values(BACKUP_CHANNEL).sort(), ["backup:run", "backup:status"]);
});

// MARK: - The record refuses to read as a stale success

test("a missing, corrupt or half-written record reads as NO BACKUP", () => {
  const dir = tmp("rec");
  try {
    assert.deepEqual(loadBackupRecord(dir), NO_BACKUP, "missing file");

    writeFileSync(path.join(dir, "backup-record.json"), "{not json");
    assert.deepEqual(loadBackupRecord(dir), NO_BACKUP, "unparseable file");

    writeFileSync(path.join(dir, "backup-record.json"), JSON.stringify({ version: 99, lastVerifiedAt: "2026-01-01T00:00:00.000Z", lastVerifiedDir: "/x" }));
    assert.deepEqual(loadBackupRecord(dir), NO_BACKUP, "unknown schema version");

    // A timestamp with no directory is a half-written record. Trusting the half that says
    // "you have a backup" is exactly the wrong half to trust.
    writeFileSync(path.join(dir, "backup-record.json"), JSON.stringify({ version: 1, lastVerifiedAt: "2026-01-01T00:00:00.000Z", lastVerifiedDir: null }));
    assert.deepEqual(loadBackupRecord(dir), NO_BACKUP, "timestamp without a directory");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a round-tripped record survives, and daysSince counts whole days", () => {
  const dir = tmp("rec");
  try {
    saveBackupRecord(dir, {
      lastVerifiedAt: "2026-08-20T00:00:00.000Z",
      lastVerifiedDir: "/Volumes/Backup/lawbar-backup-x",
      lastDestinationRoot: "/Volumes/Backup",
    });
    const r = loadBackupRecord(dir);
    assert.equal(r.lastVerifiedAt, "2026-08-20T00:00:00.000Z");
    assert.equal(daysSince(r, new Date("2026-09-02T00:00:00.000Z")), 13);
    assert.equal(daysSince(NO_BACKUP, new Date()), null, "never backed up has no age");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the record stores no case content — only times and the owner's own paths", () => {
  const dir = tmp("rec");
  try {
    saveBackupRecord(dir, {
      lastVerifiedAt: "2026-08-20T00:00:00.000Z",
      lastVerifiedDir: "/Volumes/B/x",
      lastDestinationRoot: "/Volumes/B",
    });
    const raw = JSON.parse(readFileSync(path.join(dir, "backup-record.json"), "utf8"));
    assert.deepEqual(Object.keys(raw).sort(),
      ["lastDestinationRoot", "lastVerifiedAt", "lastVerifiedDir", "version"],
      "no matter names, no document names, no counts that could identify a client");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
