// The restore tool's BOUNDARIES: what it may touch, what it may accept, and where it may write.
//
// The two earlier files ask whether the restore verifies enough. This one asks three questions
// that a correct verifier can still get wrong, each raised by an external review on 2026-09-07:
//
//   S1  Does verification leave its INPUT alone? It did not. `verifyArchive`'s `finally` deleted
//       `case-box.sqlite-wal` and `-shm` from the archive unconditionally — a cleanup lifted from
//       the backup engine, where the archive had just been written by us and the sidecars really
//       were ours. In the restore tool the archive is an input we do not own, and `--verify-only`
//       calls the same function. Measured by the reviewer: a 16,512-byte WAL and its SHM present
//       before the call, gone after, `findings: []` returned.
//
//   S2  Does an accepted archive actually OPEN in this application? Not necessarily. A database
//       recording schema version 999 verified clean and restored, and the app then refused it
//       with "schema version 999 ... newer than supported 13". A restore that succeeds into a
//       profile the product cannot use has not restored anything.
//
//   S3  Does the documented destination work? `--into <empty-or-new-dir>` promised an empty
//       directory would do, and the publish step ran `rmSync(into, { recursive: false })`, which
//       raises EISDIR on a directory however empty it is. Every passing test used a path that did
//       not exist yet, so the ordinary case — make a folder, restore into it — was never covered.
//
// THE MATRIX IS THE POINT. Each section below is a table of INPUT STATE x OUTCOME, and the
// assertions are the same for every row: the source archive is byte-identical afterwards, the
// destination is either correctly published or untouched, and nothing this operation did not
// create is removed. Writing the rows first is what stopped the fix being shaped around the three
// reproductions and nothing else.
//
// SYNTHETIC ONLY. Every archive, profile and database here is created by this file under
// os.tmpdir().

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync,
  statSync, lstatSync, copyFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { runBackup, isInside } from "../dist/src/backup/runBackup.js";
import { storeDocumentFile } from "../dist/src/caseBox/documentStorage.js";
import {
  restoreFromBackup, readManifest, verifyArchive, RestoreRefused,
} from "../scripts/restore-from-backup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);

const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const { openSqliteCaseBoxPersistence, CURRENT_SCHEMA_VERSION } = require_(
  path.join(REPO, "services/case-box-persistence/dist/index.js"),
);
const { makeMatterInput, makeDocumentInput, makeIdGenerator } = await import(
  path.join(REPO, "services/case-box-persistence/tests/conformance/fixtures.mjs")
);

const shaFile = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const openReadOnly = (file) => new Database(file, { readonly: true });

function tempRoot(label) {
  const d = mkdtempSync(path.join(os.tmpdir(), `lawbar-bnd-${label}-`));
  assert.equal(isInside(REPO, d), false, "temp root must not be inside the repo tree");
  assert.equal(isInside(path.join(os.homedir(), "Library"), d), false,
    "temp root must not be anywhere under ~/Library");
  return d;
}

/**
 * Every file under `root`, INCLUDING dotfiles and SQLite sidecars, as `relpath -> size:sha256`.
 *
 * Dotfiles and sidecars are exactly what a narrower fingerprint would miss, and they are the
 * subject of two of the three findings here. A fingerprint that filters them cannot detect the
 * defect it is written to detect.
 */
function fingerprint(root) {
  const out = {};
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        out[path.relative(root, full)] = `${statSync(full).size}:${shaFile(full)}`;
      }
    }
  };
  walk(root);
  return out;
}

/** A synthetic case box, archived by the current engine. */
async function makeArchive({ documents = 1, label = "src" } = {}) {
  const root = tempRoot(label);
  const userDataDir = path.join(root, "source");
  const docsRoot = path.join(userDataDir, "case-box-documents");
  const destinationRoot = path.join(root, "archives");
  mkdirSync(docsRoot, { recursive: true });
  mkdirSync(destinationRoot, { recursive: true });

  const ids = makeIdGenerator("bnd");
  const opened = openSqliteCaseBoxPersistence({
    path: path.join(userDataDir, "case-box.sqlite"), generateId: ids,
  });
  const matter = makeMatterInput({ id: ids(), name: "SYNTHETIC BOUNDARY MATTER" });
  await opened.persistence.createMatter(matter);
  for (let i = 0; i < documents; i++) {
    const documentId = ids();
    const input = path.join(root, `in-${i}.txt`);
    writeFileSync(input, `SYNTHETIC BOUNDARY EXHIBIT ${i}`);
    const stored = await storeDocumentFile({
      sourcePath: input, storageRoot: docsRoot, documentId, filename: "exhibit.txt",
    });
    rmSync(input);
    await opened.persistence.registerDocument(matter.id, makeDocumentInput({
      id: documentId, matter_id: matter.id, filename: stored.stored_filename,
      content_hash: stored.content_hash, storage_uri: stored.storage_uri,
      byte_size: stored.byte_size,
    }));
  }
  const backup = await runBackup({
    db: opened.db, documentsRoot: docsRoot, userDataDir, destinationRoot,
    appVersion: "0.1.0-boundaries", schemaVersion: CURRENT_SCHEMA_VERSION,
  }, openReadOnly);
  opened.db.close();
  assert.equal(backup.ok, true, backup.ok ? "" : `${backup.code}: ${backup.detail}`);

  const manifestPath = path.join(backup.dir, "manifest.json");
  return {
    root, matterId: matter.id, dir: backup.dir, dbFile: path.join(backup.dir, "case-box.sqlite"),
    manifestPath,
    readManifestJson: () => JSON.parse(readFileSync(manifestPath, "utf8")),
    writeManifestJson: (m) => writeFileSync(manifestPath, JSON.stringify(m, null, 2)),
    /** Rewrite the manifest's database digest so the archive stays internally consistent. */
    restampDbDigest() {
      const m = this.readManifestJson();
      m.databaseSha256 = shaFile(this.dbFile);
      this.writeManifestJson(m);
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Run a restore expected to be refused with `code`; return the error. */
async function refuses(archiveDir, into, code, opts = {}) {
  let error = null;
  try {
    await restoreFromBackup({ archiveDir, into, ...opts });
  } catch (err) { error = err; }
  assert.ok(error !== null, `expected refusal ${code}, the restore returned successfully`);
  assert.ok(error instanceof RestoreRefused,
    `expected RestoreRefused, got ${error.constructor.name}: ${error.message}`);
  assert.equal(error.code, code, `wrong refusal code (detail: ${error.detail})`);
  return error;
}

// ===========================================================================
// S1 — THE SOURCE ARCHIVE IS AN INPUT. Verification may not modify it.
//
//   row                       outcome                    archive afterwards
//   ------------------------- -------------------------- ------------------
//   healthy                   verify ok / restore ok     byte-identical
//   real pre-existing WAL+SHM REFUSED                    byte-identical (sidecars kept)
//   stray invalid -wal        REFUSED                    byte-identical
//   broken chain              REFUSED                    byte-identical
//   driver unavailable        REFUSED                    byte-identical
//   --verify-only, healthy    findings []                byte-identical
// ===========================================================================

test("S1: verifying a HEALTHY archive changes nothing in it", async (t) => {
  const a = await makeArchive();
  t.after(() => a.dispose());

  const before = fingerprint(a.dir);
  const findings = await verifyArchive(a.dir, readManifest(a.dir), { openDb: openReadOnly });
  assert.deepEqual(findings, [], "a freshly written archive must verify clean");
  assert.deepEqual(fingerprint(a.dir), before,
    "verifying a healthy archive modified it — including any sidecar it created and left");
});

test("S1: an archive carrying a REAL pre-existing WAL is refused, and the WAL survives", async (t) => {
  // The reviewer's reproduction. A hot WAL means the main database file is not the whole
  // database, and the manifest binds only that one file — so this input is outside the format.
  // Two separate failures were possible and both mattered: silently verifying a view of the data
  // the manifest does not cover, and DELETING the operator's WAL on the way past.
  const a = await makeArchive();
  let hot = null;
  t.after(() => { try { hot?.close(); } catch { /* already closed */ } a.dispose(); });

  hot = new Database(a.dbFile);
  hot.pragma("wal_autocheckpoint = 0");
  hot.exec("CREATE TABLE synthetic_boundary_wal (id INTEGER PRIMARY KEY, value TEXT)");
  hot.prepare("INSERT INTO synthetic_boundary_wal(value) VALUES (?)").run("SYNTHETIC WAL CONTENT");

  const wal = `${a.dbFile}-wal`;
  const shm = `${a.dbFile}-shm`;
  assert.equal(existsSync(wal), true, "fixture requires a real WAL");
  assert.equal(shaFile(a.dbFile), a.readManifestJson().databaseSha256,
    "precondition: the main file still matches the manifest, so only the WAL is extra");
  const before = fingerprint(a.dir);
  const walBytesBefore = statSync(wal).size;
  assert.ok(walBytesBefore > 0, "the WAL must actually hold pages");

  let error = null;
  try {
    await verifyArchive(a.dir, readManifest(a.dir), { openDb: openReadOnly });
  } catch (err) { error = err; }

  assert.ok(error instanceof RestoreRefused,
    `an archive with a hot WAL must be refused outright, not verified; got ${
      error === null ? "findings" : error.message}`);
  assert.equal(error.code, "archive_has_hot_sidecars");

  assert.equal(existsSync(wal), true, "verification DELETED a pre-existing WAL it did not create");
  assert.equal(existsSync(shm), true, "verification deleted a pre-existing SHM it did not create");
  assert.deepEqual(fingerprint(a.dir), before, "verification altered the archive");
});

test("S1: restoring from an archive with a hot WAL is refused and the archive is untouched",
  async (t) => {
    const a = await makeArchive();
    let hot = null;
    const intoParent = tempRoot("into");
    t.after(() => {
      try { hot?.close(); } catch { /* already closed */ }
      a.dispose(); rmSync(intoParent, { recursive: true, force: true });
    });

    hot = new Database(a.dbFile);
    hot.pragma("wal_autocheckpoint = 0");
    hot.exec("CREATE TABLE synthetic_boundary_wal (id INTEGER PRIMARY KEY)");
    hot.prepare("INSERT INTO synthetic_boundary_wal(id) VALUES (1)").run();
    const before = fingerprint(a.dir);

    const into = path.join(intoParent, "profile");
    await refuses(a.dir, into, "archive_has_hot_sidecars");
    assert.equal(existsSync(into), false, "a refused restore created the destination");
    assert.deepEqual(fingerprint(a.dir), before, "a refused restore altered the archive");
  });

test("S1: a stray, invalid sidecar is refused rather than deleted", async (t) => {
  // Not a real WAL — bytes that could not be one. The point is ownership, not validity: a file
  // this operation did not create is not this operation's to remove, and "it looked like junk" is
  // not a licence to delete something out of an evidentiary archive.
  const a = await makeArchive();
  t.after(() => a.dispose());

  writeFileSync(`${a.dbFile}-wal`, "SYNTHETIC NOT-ACTUALLY-A-WAL");
  const before = fingerprint(a.dir);

  let error = null;
  try {
    await verifyArchive(a.dir, readManifest(a.dir), { openDb: openReadOnly });
  } catch (err) { error = err; }
  assert.ok(error instanceof RestoreRefused, "a stray sidecar must be refused");
  assert.equal(error.code, "archive_has_hot_sidecars");
  assert.deepEqual(fingerprint(a.dir), before, "the stray sidecar was deleted or altered");
});

test("S1: a FAILING verification still leaves the archive byte-identical", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const db = new Database(a.dbFile);
  const row = db.prepare("SELECT event_id, event_json FROM case_box_audit_events ORDER BY sequence LIMIT 1").get();
  const event = JSON.parse(row.event_json);
  event.actor_user_id = "SYNTHETIC-TAMPER";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
    .run(JSON.stringify(event), row.event_id);
  db.close();
  for (const s of [`${a.dbFile}-wal`, `${a.dbFile}-shm`]) rmSync(s, { force: true });
  a.restampDbDigest();

  const before = fingerprint(a.dir);
  await refuses(a.dir, path.join(intoParent, "profile"), "archive_failed_verification");
  assert.deepEqual(fingerprint(a.dir), before,
    "the failure path modified the archive it was reading");
});

test("S1: a DRIVER failure leaves the archive byte-identical", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const before = fingerprint(a.dir);
  await refuses(a.dir, path.join(intoParent, "profile"), "driver_unavailable", {
    openDb: () => { throw new Error("SYNTHETIC: no driver"); },
  });
  assert.deepEqual(fingerprint(a.dir), before, "the driver-failure path modified the archive");
});

test("S1: a SUCCESSFUL restore leaves the archive byte-identical and publishes no sidecars",
  async (t) => {
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    const before = fingerprint(a.dir);
    await restoreFromBackup({ archiveDir: a.dir, into });
    assert.deepEqual(fingerprint(a.dir), before, "a successful restore modified the archive");

    // And the published profile must not carry sidecars either: verification opens a database
    // somewhere, and wherever that is must not be the thing being handed to the owner.
    const published = readdirSync(into).sort();
    assert.deepEqual(published, ["case-box-documents", "case-box.sqlite"],
      `the published profile contains unexpected files: ${published.join(", ")}`);
  });

// ===========================================================================
// S2 — AN ACCEPTED ARCHIVE MUST OPEN IN THIS APPLICATION.
//
//   row                              outcome
//   -------------------------------- --------------------------------
//   db schema newer than supported   REFUSED, nothing published
//   manifest schemaVersion != db     REFUSED
//   manifest chainHead hash wrong    REFUSED
//   manifest chainHead count wrong   REFUSED
//   manifest omits a matter's head   REFUSED
//   manifest schemaVersion missing   REFUSED
//   current version, healthy         SUCCESS + the app can open it
//   current version, empty case box  SUCCESS + the app can open it
//   older-but-supported version      SUCCESS (the app migrates the COPY, never the archive)
// ===========================================================================

/** Record a future schema version in the archive's database and restamp the manifest. */
function setDatabaseSchemaVersion(a, version) {
  const db = new Database(a.dbFile);
  db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)")
    .run(version, "2026-09-07T00:00:00.000Z");
  db.close();
  for (const s of [`${a.dbFile}-wal`, `${a.dbFile}-shm`]) rmSync(s, { force: true });
  const m = a.readManifestJson();
  m.schemaVersion = version;
  m.databaseSha256 = shaFile(a.dbFile);
  a.writeManifestJson(m);
}

test("S2: a database newer than this app supports is refused, not restored", async (t) => {
  // The reviewer's first case. It restored, and then the application could not open the result:
  // "schema version 999 ... newer than supported 13". A restore whose output the product refuses
  // has not restored anything; it has produced a directory.
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  setDatabaseSchemaVersion(a, 999);
  const err = await refuses(a.dir, into, "schema_version_unsupported");
  assert.ok(err.detail.includes("999") && err.detail.includes(String(CURRENT_SCHEMA_VERSION)),
    `the refusal must name both versions; got: ${err.detail}`);
  assert.equal(existsSync(into), false, "a profile was published for an unusable database");
});

test("S2: a manifest whose schemaVersion disagrees with the database is refused", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const m = a.readManifestJson();
  m.schemaVersion = 999; // the database stays at the real version
  a.writeManifestJson(m);

  const err = await refuses(a.dir, path.join(intoParent, "profile"), "archive_failed_verification");
  assert.ok(/schema/i.test(err.detail), `the finding must name the schema mismatch; got: ${err.detail}`);
});

test("S2: a manifest chain head that disagrees with the database is refused", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const m = a.readManifestJson();
  assert.equal(m.chainHeads.length, 1, "precondition: one matter, one head");
  m.chainHeads[0].headHash = "0".repeat(64);
  a.writeManifestJson(m);

  const err = await refuses(a.dir, path.join(intoParent, "profile"), "archive_failed_verification");
  assert.ok(/head/i.test(err.detail), `the finding must name the head; got: ${err.detail}`);
});

test("S2: a manifest chain head whose eventCount disagrees is refused", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const m = a.readManifestJson();
  m.chainHeads[0].eventCount = 999;
  a.writeManifestJson(m);

  await refuses(a.dir, path.join(intoParent, "profile"), "archive_failed_verification");
});

test("S2: a manifest that omits a matter the database has is refused", async (t) => {
  // The same shape as R1's omitted document, one table over: the manifest cannot be the index of
  // what to check, because its omissions are exactly what needs detecting.
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const m = a.readManifestJson();
  m.chainHeads = [];
  a.writeManifestJson(m);

  await refuses(a.dir, path.join(intoParent, "profile"), "archive_failed_verification");
});

test("S2: a manifest with a missing or non-integer schemaVersion is refused", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  for (const [label, value] of [["missing", undefined], ["a string", "13"], ["fractional", 13.5]]) {
    const m = a.readManifestJson();
    if (value === undefined) delete m.schemaVersion; else m.schemaVersion = value;
    a.writeManifestJson(m);
    const err = await refuses(a.dir, path.join(intoParent, `p-${label.replace(/\s/g, "-")}`),
      "manifest_unreadable");
    assert.ok(/schema/i.test(err.detail), `${label}: the refusal must name the field`);
  }
});

test("S2: a manifest with a malformed chainHeads entry is refused", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const m = a.readManifestJson();
  m.chainHeads = [{ matterId: 123, headHash: null, eventCount: "many" }];
  a.writeManifestJson(m);

  await refuses(a.dir, path.join(intoParent, "profile"), "manifest_unreadable");
});

test("S2: the CURRENT version restores, and the application can actually open the result",
  async (t) => {
    // The guard against fixing the above by refusing anything unfamiliar. This is also the only
    // assertion in the suite that the restored profile is usable BY THE PRODUCT rather than
    // merely well-formed — it opens through `openSqliteCaseBoxPersistence`, the same call the app
    // makes at startup, which is what refused the 999 database.
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    const result = await restoreFromBackup({ archiveDir: a.dir, into });
    assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);

    const opened = openSqliteCaseBoxPersistence({ path: path.join(into, "case-box.sqlite") });
    try {
      const chain = await opened.persistence.verifyAuditChainForMatter(a.matterId);
      assert.equal(chain.ok, true, `the app opened the restored profile but its chain failed: ${chain.detail ?? ""}`);
    } finally { opened.db.close(); }
  });

test("S2: an EMPTY case box at the current version still restores and opens", async (t) => {
  const a = await makeArchive({ documents: 0, label: "empty" });
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const result = await restoreFromBackup({ archiveDir: a.dir, into });
  assert.equal(result.documents, 0);
  const opened = openSqliteCaseBoxPersistence({ path: path.join(into, "case-box.sqlite") });
  try {
    assert.equal((await opened.persistence.verifyAuditChainForMatter(a.matterId)).ok, true);
  } finally { opened.db.close(); }
});

test("S2: an OLDER supported version is accepted, and the archive is not migrated", async (t) => {
  // POLICY, STATED: the application migrates a database forward when it opens one, so an older
  // archive is restorable — the migration then happens to the RESTORED COPY at first open, never
  // to the archive. Refusing older versions would make old backups unrestorable by the very tool
  // meant to read them; migrating the archive would rewrite evidence in place.
  //
  // KNOWN LIMIT OF THIS FIXTURE, stated rather than implied: it lowers the recorded version on a
  // database whose TABLES are current. It therefore exercises the version-policy branch, not a
  // genuine historical schema. A real cross-version restore needs an archive produced by an older
  // build and is not something this suite can synthesise.
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const older = CURRENT_SCHEMA_VERSION - 1;
  const db = new Database(a.dbFile);
  db.prepare("DELETE FROM schema_version WHERE version > ?").run(older);
  db.close();
  for (const s of [`${a.dbFile}-wal`, `${a.dbFile}-shm`]) rmSync(s, { force: true });
  const m = a.readManifestJson();
  m.schemaVersion = older;
  m.databaseSha256 = shaFile(a.dbFile);
  a.writeManifestJson(m);

  const before = fingerprint(a.dir);
  const result = await restoreFromBackup({ archiveDir: a.dir, into });
  assert.equal(result.schemaVersion, older, "the result must report the version it actually read");
  assert.deepEqual(fingerprint(a.dir), before,
    "the archive was migrated in place; an archive is evidence, not a working copy");
});

// ===========================================================================
// S3 — THE DESTINATION.
//
//   row                                outcome        destination afterwards
//   ---------------------------------- -------------- ----------------------
//   does not exist                     SUCCESS        published
//   exists and is truly empty          SUCCESS        published
//   holds a regular file               REFUSED        untouched
//   holds ONLY a hidden file           REFUSED        untouched
//   becomes non-empty during the copy  REFUSED        untouched
//   publish itself fails               REFUSED        untouched, staging cleaned
//   is a regular file, not a directory REFUSED        untouched
//   retry after any refusal            SUCCESS        published
// ===========================================================================

test("S3: a destination that does NOT yet exist is published", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  await restoreFromBackup({ archiveDir: a.dir, into });
  assert.equal(existsSync(path.join(into, "case-box.sqlite")), true);
  assert.deepEqual(readdirSync(intoParent).sort(), ["profile"], "staging survived a success");
});

test("S3: a destination that EXISTS and is empty is published — the documented case", async (t) => {
  // `--into <empty-or-new-dir>`. The empty-directory half of that promise raised EISDIR on every
  // attempt, because the publish step deleted the destination with `recursive: false` first.
  // Every passing test used a path that did not exist, so making a folder and restoring into it —
  // the ordinary thing a person does — was the one case never exercised.
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  mkdirSync(into);
  assert.deepEqual(readdirSync(into), [], "precondition: the destination exists and is empty");

  const result = await restoreFromBackup({ archiveDir: a.dir, into });
  assert.equal(result.documents, 1);
  assert.equal(existsSync(path.join(into, "case-box.sqlite")), true,
    "restoring into a pre-created empty directory must work");
  assert.deepEqual(readdirSync(intoParent).sort(), ["profile"], "staging survived a success");
});

test("S3: a destination holding a regular file is refused and left untouched", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  mkdirSync(into);
  writeFileSync(path.join(into, "case-box.sqlite"), "EXISTING SYNTHETIC PROFILE");
  const before = fingerprint(into);

  await refuses(a.dir, into, "destination_not_empty");
  assert.deepEqual(fingerprint(into), before, "the refused restore modified the destination");
});

test("S3: a destination holding ONLY a hidden file is refused, and the hidden file survives",
  async (t) => {
    // The emptiness test and the publish primitive have to agree. `rename` treats a directory
    // containing `.DS_Store` as non-empty (measured: ENOTEMPTY), so a check that filtered
    // dotfiles would call it empty, proceed, and then fail at the last step with an opaque error —
    // or, worse, be "fixed" later by deleting the destination recursively.
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    mkdirSync(into);
    writeFileSync(path.join(into, ".DS_Store"), "SYNTHETIC HIDDEN FILE");
    const before = fingerprint(into);

    await refuses(a.dir, into, "destination_not_empty");
    assert.deepEqual(fingerprint(into), before, "a hidden file at the destination was destroyed");
  });

test("S3: a destination that becomes non-empty DURING the copy is refused, content intact",
  async (t) => {
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    mkdirSync(into);
    const planted = path.join(into, "case-box.sqlite");
    let calls = 0;
    const occupyMidway = (from, to) => {
      calls += 1;
      copyFileSync(from, to);
      if (calls === 1) writeFileSync(planted, "EXISTING SYNTHETIC PROFILE");
    };

    await refuses(a.dir, into, "destination_not_empty", { copyFile: occupyMidway });
    assert.equal(readFileSync(planted, "utf8"), "EXISTING SYNTHETIC PROFILE",
      "content that appeared at the destination mid-restore was overwritten");
    assert.deepEqual(readdirSync(intoParent).sort(), ["profile"], "staging survived a refusal");
  });

test("S3: a destination that is a regular FILE is refused", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  writeFileSync(into, "NOT A DIRECTORY");
  await refuses(a.dir, into, "destination_not_a_directory");
  assert.equal(readFileSync(into, "utf8"), "NOT A DIRECTORY", "the destination file was destroyed");
});

test("S3: a retry after a refusal succeeds once the obstruction is removed", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  mkdirSync(into);
  writeFileSync(path.join(into, "in-the-way.txt"), "SYNTHETIC");
  await refuses(a.dir, into, "destination_not_empty");

  rmSync(path.join(into, "in-the-way.txt"));
  const result = await restoreFromBackup({ archiveDir: a.dir, into });
  assert.equal(result.documents, 1, "a retry into the now-empty destination must succeed");
  assert.deepEqual(readdirSync(intoParent).sort(), ["profile"]);
});

test("S3: a failure at the PUBLISH step leaves the destination untouched and cleans staging",
  async (t) => {
    // The last step, which no earlier case reaches: everything verified, the copy complete, and
    // the rename itself fails.
    //
    // Injected through the `publish` seam rather than by chmod-ing the parent read-only. That was
    // the first attempt and it was a bad test: an unwritable parent also blocks REMOVING the
    // staging directory, so the case would have failed on its own cleanup assertion while the
    // implementation behaved correctly. The seam isolates the step under test, and it exists for
    // the same reason `copyFile` and `openDb` do — a failure path nobody can cause is a failure
    // path nobody has checked.
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    mkdirSync(into);
    const beforeParent = readdirSync(intoParent).sort();

    let error = null;
    try {
      await restoreFromBackup({
        archiveDir: a.dir, into,
        publish: () => { throw Object.assign(new Error("SYNTHETIC PUBLISH FAILURE"), { code: "EXDEV" }); },
      });
    } catch (err) { error = err; }

    assert.ok(error instanceof RestoreRefused,
      `expected a refusal at publish, got ${error === null ? "success" : error.message}`);
    assert.equal(error.code, "restore_aborted");
    assert.equal(existsSync(into), true, "the caller's existing directory was deleted");
    assert.deepEqual(readdirSync(into), [], "a failed publish wrote into the destination");
    assert.deepEqual(readdirSync(intoParent).sort(), beforeParent,
      "a failed publish left staging behind next to the destination");

    // And the archive is intact, so the operator can simply try again.
    const retry = await restoreFromBackup({ archiveDir: a.dir, into });
    assert.equal(retry.documents, 1, "a retry after a failed publish must succeed");
  });
