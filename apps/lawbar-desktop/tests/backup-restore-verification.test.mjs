// What the RESTORE side must prove before it writes a profile.
//
// WHY THIS IS A SEPARATE FILE FROM backup-restore-current-format.test.mjs. That file drills the
// happy path and the refusals that are decidable from the manifest alone. This one covers the
// class of defect an external review found in the first version of `restore-from-backup.mjs` on
// 2026-09-06: the restore verified only what the MANIFEST CHOSE TO LIST.
//
// The shape of that mistake is worth stating, because it is the same shape as the backup defect
// it was written to close. `verifyArchive` re-hashed the database file and every document the
// manifest named, and never opened the database. So:
//
//   * a manifest with `documents: []` restored "successfully" while the restored database still
//     held document rows whose files had never been copied — the manifest decided what was
//     checked, and its omissions were therefore invisible;
//   * an archive written by the PRE-FIX backup engine — one whose audit chain is broken, which is
//     exactly what the earlier work made unwritable going forward — restored clean, because both
//     engines write `manifestVersion: 1` and nothing re-checked the chain;
//   * `databaseFile` was type-checked and nothing more, so it could name a path outside the
//     archive, or a symlink, and the "restored" profile then pointed at a file that was never in
//     the backup at all.
//
// The rule this leaves: a manifest is a CLAIM BY THE ARCHIVE ABOUT ITSELF. Restoring is the point
// at which that claim must be checked against the database and the bytes, not the point at which
// it is taken as the index of what to check.
//
// SYNTHETIC ONLY. Every archive and profile here is built by this file under os.tmpdir().

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync,
  symlinkSync, lstatSync, statSync, readdirSync, copyFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { runBackup, isInside } from "../dist/src/backup/runBackup.js";
import { storeDocumentFile } from "../dist/src/caseBox/documentStorage.js";
import { verifyDocumentStore } from "../dist/src/caseBox/documentVerify.js";
import {
  restoreFromBackup, readManifest, verifyArchive, RestoreRefused, REAL_USER_DATA,
} from "../scripts/restore-from-backup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);

const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const { openSqliteCaseBoxPersistence, CURRENT_SCHEMA_VERSION } = require_(
  path.join(REPO, "services/case-box-persistence/dist/index.js"),
);
const { verifyAllAuditChains } = require_(
  path.join(REPO, "services/case-box-persistence/dist/archiveVerify.js"),
);
const { makeMatterInput, makeDocumentInput, makeIdGenerator } = await import(
  path.join(REPO, "services/case-box-persistence/tests/conformance/fixtures.mjs")
);

const sha = (b) => createHash("sha256").update(b).digest("hex");
const shaFile = (f) => sha(readFileSync(f));
const openReadOnly = (file) => new Database(file, { readonly: true });

function tempRoot(label) {
  const d = mkdtempSync(path.join(os.tmpdir(), `lawbar-rv-${label}-`));
  assert.equal(isInside(REPO, d), false, "temp root must not be inside the repo tree");
  assert.equal(isInside(path.join(os.homedir(), "Library"), d), false,
    "temp root must not be anywhere under ~/Library");
  return d;
}

/**
 * A synthetic case box plus an archive of it, as the CURRENT engine writes one.
 *
 * `documents: 0` builds a legitimately empty case box — a matter with a real genesis chain and no
 * exhibits — because "restores an empty profile" and "restores a populated one" are different
 * claims and an empty archive is the easier one to accidentally pass by doing nothing.
 */
async function makeArchive({ documents = 2, label = "src" } = {}) {
  const root = tempRoot(label);
  const userDataDir = path.join(root, "source");
  const docsRoot = path.join(userDataDir, "case-box-documents");
  const destinationRoot = path.join(root, "archives");
  mkdirSync(docsRoot, { recursive: true });
  mkdirSync(destinationRoot, { recursive: true });

  const ids = makeIdGenerator("restver");
  const opened = openSqliteCaseBoxPersistence({
    path: path.join(userDataDir, "case-box.sqlite"), generateId: ids,
  });
  const matter = makeMatterInput({ id: ids(), name: "SYNTHETIC RESTORE VERIFICATION" });
  await opened.persistence.createMatter(matter);

  const registered = [];
  for (let i = 0; i < documents; i++) {
    const documentId = ids();
    const input = path.join(root, `in-${i}.txt`);
    writeFileSync(input, `SYNTHETIC EXHIBIT BYTES ${i}`);
    const stored = await storeDocumentFile({
      sourcePath: input, storageRoot: docsRoot, documentId, filename: "exhibit.txt",
    });
    rmSync(input);
    const doc = makeDocumentInput({
      id: documentId, matter_id: matter.id, filename: stored.stored_filename,
      content_hash: stored.content_hash, storage_uri: stored.storage_uri,
      byte_size: stored.byte_size,
    });
    await opened.persistence.registerDocument(matter.id, doc);
    registered.push({ ...doc, relativePath: path.join(documentId, stored.stored_filename) });
  }
  assert.equal((await opened.persistence.verifyAuditChainForMatter(matter.id)).ok, true,
    "the fixture chain must be legitimate before anything is done to it");

  const backup = await runBackup({
    db: opened.db, documentsRoot: docsRoot, userDataDir,
    destinationRoot, appVersion: "0.1.0-restore-verification",
    schemaVersion: CURRENT_SCHEMA_VERSION,
  }, openReadOnly);
  opened.db.close();
  assert.equal(backup.ok, true, backup.ok ? "" : `${backup.code}: ${backup.detail}`);

  return {
    root, userDataDir, docsRoot, matterId: matter.id, documents: registered,
    dir: backup.dir,
    manifestPath: path.join(backup.dir, "manifest.json"),
    readManifestJson: () => JSON.parse(readFileSync(path.join(backup.dir, "manifest.json"), "utf8")),
    writeManifestJson: (m) =>
      writeFileSync(path.join(backup.dir, "manifest.json"), JSON.stringify(m, null, 2)),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Assert a restore is refused with `code`, AND that it left no database at the destination.
 *
 * The second half is the load-bearing one for the incomplete-restore cases: a refusal that still
 * leaves a `case-box.sqlite` behind produces a profile that opens, verifies, and is missing
 * exhibits — the failure mode that looks most like success.
 */
async function refuses(archiveDir, into, code, opts = {}) {
  let error = null;
  try {
    await restoreFromBackup({ archiveDir, into, ...opts });
  } catch (err) {
    error = err;
  }
  assert.ok(error !== null, `expected a refusal (${code}), the restore returned successfully`);
  assert.ok(error instanceof RestoreRefused,
    `expected RestoreRefused, got ${error.constructor.name}: ${error.message}`);
  assert.equal(error.code, code, `wrong refusal code (detail: ${error.detail})`);
  assert.equal(existsSync(path.join(into, "case-box.sqlite")), false,
    "a refused restore left a database at the destination, which reads as a usable profile");
  return error;
}

// ===========================================================================
// R1 — the restore must verify the DATABASE, not only what the manifest lists
// ===========================================================================

test("R1: a manifest that omits a registered document is refused", async (t) => {
  // Nothing is removed from the archive and the database is untouched: only the manifest's own
  // index is emptied. Under a manifest-driven check there is then nothing to disagree with, and
  // the earlier implementation restored `documents: 0` into a profile whose database still
  // referenced both exhibits.
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  const m = a.readManifestJson();
  assert.equal(m.documents.length, 2, "precondition: the manifest listed both exhibits");
  m.documents = [];
  m.referencedContentHashes = [];
  a.writeManifestJson(m);

  await refuses(a.dir, into, "archive_failed_verification");
});

test("R1: an archive whose audit chain is broken is refused, however tidy its manifest", async (t) => {
  // The pre-fix backup engine could write exactly this: every digest in the manifest correct,
  // the chain not. Both engines stamp `manifestVersion: 1`, so "a manifest exists" cannot mean
  // "this was verified" for any archive already on a shelf. Reproduced here without depending on
  // the frozen snapshot: tamper an event INSIDE the archive, then restamp the manifest's
  // database digest so the archive is internally consistent and evidentially worthless.
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  const dbFile = path.join(a.dir, "case-box.sqlite");
  const db = new Database(dbFile);
  const row = db.prepare("SELECT event_id, event_json FROM case_box_audit_events ORDER BY sequence LIMIT 1").get();
  const event = JSON.parse(row.event_json);
  event.actor_user_id = "SYNTHETIC-TAMPER";
  db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
    .run(JSON.stringify(event), row.event_id);
  db.close();
  for (const sidecar of [`${dbFile}-wal`, `${dbFile}-shm`]) rmSync(sidecar, { force: true });

  const m = a.readManifestJson();
  m.databaseSha256 = shaFile(dbFile);
  a.writeManifestJson(m);

  // The manifest now agrees with the bytes; only the CHAIN is broken. Assert that precondition,
  // so a failure here cannot be mistaken for the digest check doing the work.
  assert.equal(shaFile(dbFile), m.databaseSha256, "precondition: the manifest matches the bytes");
  const tamperedDb = openReadOnly(dbFile);
  try {
    assert.equal(verifyAllAuditChains(tamperedDb).ok, false, "precondition: the chain is broken");
  } finally { tamperedDb.close(); }
  for (const sidecar of [`${dbFile}-wal`, `${dbFile}-shm`]) rmSync(sidecar, { force: true });

  const err = await refuses(a.dir, into, "archive_failed_verification");
  assert.ok(/audit chain|chain/i.test(err.detail),
    `the refusal must say the chain is what failed; got: ${err.detail}`);
});

test("R1: a document row whose file was never copied is refused", async (t) => {
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  // Remove one exhibit from the archive AND from the manifest, so only the DATABASE still knows
  // it should exist. A manifest-driven check sees a complete, consistent archive.
  const victim = a.documents[0];
  rmSync(path.join(a.dir, "case-box-documents", victim.id), { recursive: true });
  const m = a.readManifestJson();
  m.documents = m.documents.filter((d) => !d.relativePath.startsWith(victim.id));
  a.writeManifestJson(m);

  await refuses(a.dir, into, "archive_failed_verification");
});

test("R1: when the SQLite driver is unavailable the restore reports it and STOPS", async (t) => {
  // The one outcome that must never happen is a silent downgrade to "restored successfully"
  // because the chain could not be checked. Not-verified and verified are different answers.
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  await refuses(a.dir, into, "driver_unavailable", {
    openDb: () => { throw new Error("SYNTHETIC: no native binding for this ABI"); },
  });
});

test("R1: verifyArchive itself reports chain findings, not just digests", async (t) => {
  const a = await makeArchive();
  t.after(() => a.dispose());

  const clean = await verifyArchive(a.dir, readManifest(a.dir), { openDb: openReadOnly });
  assert.deepEqual(clean, [], "a freshly written archive must verify with no findings");

  const dbFile = path.join(a.dir, "case-box.sqlite");
  const db = new Database(dbFile);
  db.prepare("DELETE FROM case_box_audit_chain_heads").run();
  db.close();
  for (const sidecar of [`${dbFile}-wal`, `${dbFile}-shm`]) rmSync(sidecar, { force: true });
  const m = a.readManifestJson();
  m.databaseSha256 = shaFile(dbFile);
  a.writeManifestJson(m);

  const findings = await verifyArchive(a.dir, readManifest(a.dir), { openDb: openReadOnly });
  assert.ok(findings.length > 0, "a missing chain head must be a finding at the restore boundary");
  assert.ok(findings.some((f) => /chain/i.test(f)), `findings must name the chain; got ${JSON.stringify(findings)}`);
});

test("R1: a legitimately EMPTY case box still restores", async (t) => {
  // Guard against fixing the above by making the verifier reject anything it finds surprising.
  const a = await makeArchive({ documents: 0, label: "empty" });
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  const result = await restoreFromBackup({ archiveDir: a.dir, into });
  assert.equal(result.documents, 0);
  const db = openReadOnly(path.join(into, "case-box.sqlite"));
  try {
    assert.equal(verifyAllAuditChains(db).ok, true, "the restored empty case box must verify");
    assert.equal(verifyAllAuditChains(db).mattersChecked, 1, "and must contain its matter");
  } finally { db.close(); }
});

// ===========================================================================
// R2 — the archive must be self-contained, and so must the restored profile
// ===========================================================================

test("R2: a manifest naming a database outside the archive is refused", async (t) => {
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  const outside = path.join(a.root, "outside.sqlite");
  copyFileSync(path.join(a.dir, "case-box.sqlite"), outside);
  const m = a.readManifestJson();
  m.databaseFile = path.relative(a.dir, outside);
  a.writeManifestJson(m);

  await refuses(a.dir, into, "manifest_database_name_unsupported");
});

test("R2: a manifest naming any database but case-box.sqlite is refused", async (t) => {
  // The current format has exactly one database name. Accepting another is accepting an
  // instruction from the archive about which file to trust.
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  renameSync(path.join(a.dir, "case-box.sqlite"), path.join(a.dir, "other.sqlite"));
  const m = a.readManifestJson();
  m.databaseFile = "other.sqlite";
  a.writeManifestJson(m);

  await refuses(a.dir, into, "manifest_database_name_unsupported");
});

test("R2: an archive whose database is a SYMLINK is refused", async (t) => {
  // And note what the old behaviour was: not merely accepted. `cpSync` copies a symlink AS a
  // symlink, so the "restored" profile's case-box.sqlite was a link to a file outside the
  // archive, and the app opening that profile would have used the external database.
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  const dbFile = path.join(a.dir, "case-box.sqlite");
  const outside = path.join(a.root, "outside.sqlite");
  renameSync(dbFile, outside);
  symlinkSync(outside, dbFile);

  await refuses(a.dir, into, "archive_not_self_contained");
});

test("R2: an exhibit whose PARENT DIRECTORY is a symlink is refused", async (t) => {
  // The leaf was lstat'd; its ancestors were not. A per-document directory replaced by a link
  // put the bytes outside the archive while every digest still matched.
  const a = await makeArchive();
  const into = path.join(tempRoot("into"), "profile");
  t.after(() => { a.dispose(); rmSync(path.dirname(into), { recursive: true, force: true }); });

  const parent = path.join(a.dir, "case-box-documents", a.documents[0].id);
  const outside = path.join(a.root, "outside-exhibits");
  renameSync(parent, outside);
  symlinkSync(outside, parent);

  await refuses(a.dir, into, "archive_not_self_contained");
});

test("R2: a healthy restore is INDEPENDENT of the archive — delete it and the profile still works",
  async (t) => {
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    await restoreFromBackup({ archiveDir: a.dir, into });

    // Every restored file must be a regular file held by nobody else. A hardlink into the archive
    // would satisfy "the bytes are right" and still die when the archive is deleted or edited.
    const restoredDb = path.join(into, "case-box.sqlite");
    const dbStat = lstatSync(restoredDb);
    assert.equal(dbStat.isSymbolicLink(), false, "the restored database is a symlink");
    assert.equal(dbStat.isFile(), true);
    assert.equal(dbStat.nlink, 1, "the restored database shares its inode with another path");
    for (const d of a.documents) {
      const f = path.join(into, "case-box-documents", d.relativePath);
      const st = lstatSync(f);
      assert.equal(st.isSymbolicLink(), false, `${d.relativePath} restored as a symlink`);
      assert.equal(st.nlink, 1, `${d.relativePath} shares its inode with the archive`);
    }

    // Now destroy the archive AND the original profile, and use what is left.
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(a.userDataDir, { recursive: true, force: true });

    const opened = openSqliteCaseBoxPersistence({ path: restoredDb });
    try {
      const chain = await opened.persistence.verifyAuditChainForMatter(a.matterId);
      assert.equal(chain.ok, true, `the restored chain must verify with no archive present: ${chain.detail ?? ""}`);
      const rows = opened.db.prepare("SELECT id, payload_json FROM case_box_documents ORDER BY id").all()
        .map((r) => ({ id: r.id, ...JSON.parse(r.payload_json) }));
      const docs = await verifyDocumentStore(
        rows.map((r) => ({ id: r.id, filename: r.filename, content_hash: r.content_hash })),
        { storageRoot: path.join(into, "case-box-documents") },
      );
      assert.equal(docs.ok, true, `restored exhibits unusable without the archive: ${JSON.stringify(docs)}`);
      assert.equal(docs.checked, a.documents.length);
    } finally { opened.db.close(); }
  });

// ===========================================================================
// R3 — a failed restore must not leave something that looks like a profile
// ===========================================================================

/** A copyFile that fails on the Nth call, so a mid-copy abort is deterministic. */
function failingCopyAt(n) {
  let calls = 0;
  return (from, to) => {
    calls += 1;
    if (calls === n) {
      throw Object.assign(new Error("SYNTHETIC IO FAILURE"), { code: "EIO" });
    }
    return copyFileSync(from, to);
  };
}

test("R3: a failure while copying an EXHIBIT leaves no database at the destination", async (t) => {
  // This is the review's deterministic injection. Before the fix the destination was left with a
  // complete case-box.sqlite whose chain verified and whose exhibits were missing — a profile
  // that opens and is quietly incomplete, which is worse than one that plainly does not exist.
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  await refuses(a.dir, into, "restore_aborted", { copyFile: failingCopyAt(2) });

  assert.equal(existsSync(into) === false || readdirSync(into).length === 0, true,
    "the destination must be absent or empty after an aborted restore");

  // The archive is untouched, so a retry is possible — and works.
  const retry = await restoreFromBackup({ archiveDir: a.dir, into });
  assert.equal(retry.documents, a.documents.length, "a retry after an aborted restore must succeed");
});

test("R3: a failure while copying the DATABASE leaves nothing behind either", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  await refuses(a.dir, into, "restore_aborted", { copyFile: failingCopyAt(1) });
  assert.equal(existsSync(into) === false || readdirSync(into).length === 0, true);
});

test("R3: a copy that silently produces wrong bytes is caught AFTER copying, before publishing",
  async (t) => {
    // Verifying the archive proves what is on the shelf; it does not prove what was written to
    // the destination. A medium that accepts a write and returns different bytes is the failure
    // an external drive actually produces, and it is invisible to a pre-copy check.
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    let calls = 0;
    const corruptingCopy = (from, to) => {
      calls += 1;
      copyFileSync(from, to);
      if (calls === 2) writeFileSync(to, "SYNTHETIC WRONG BYTES AT THE DESTINATION");
    };
    const err = await refuses(a.dir, into, "restore_failed_verification", { copyFile: corruptingCopy });
    assert.ok(err.detail.length > 0, "the failure must say what did not match");
    assert.equal(existsSync(into) === false || readdirSync(into).length === 0, true);
  });

test("R3: an aborted restore does not damage the SOURCE archive", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  const fingerprint = (root) => {
    const out = {};
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) out[path.relative(root, full)] = shaFile(full);
      }
    };
    walk(root);
    return out;
  };
  const before = fingerprint(a.dir);

  await refuses(a.dir, into, "restore_aborted", { copyFile: failingCopyAt(2) });
  assert.deepEqual(fingerprint(a.dir), before, "an aborted restore modified the archive it read");
});

test("R3: a destination that becomes occupied between the check and the write is refused",
  async (t) => {
    // The window the staging design has to close. The destination is empty when validated and
    // holds a case box by the time the restore would publish; overwriting it is the one outcome
    // that must be impossible.
    const a = await makeArchive();
    const intoParent = tempRoot("into");
    const into = path.join(intoParent, "profile");
    t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

    mkdirSync(into, { recursive: true });
    const planted = path.join(into, "case-box.sqlite");
    let calls = 0;
    const occupyMidway = (from, to) => {
      calls += 1;
      copyFileSync(from, to);
      // After the database is staged but before publication, someone else populates the target.
      if (calls === 1) writeFileSync(planted, "EXISTING SYNTHETIC PROFILE");
    };

    let error = null;
    try {
      await restoreFromBackup({ archiveDir: a.dir, into, copyFile: occupyMidway });
    } catch (err) { error = err; }
    assert.ok(error instanceof RestoreRefused,
      `expected a refusal, got ${error === null ? "success" : error.message}`);
    assert.equal(readFileSync(planted, "utf8"), "EXISTING SYNTHETIC PROFILE",
      "the restore overwrote content that appeared at the destination after the check");
  });

test("R3: staging leaves nothing behind next to the destination on success", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  await restoreFromBackup({ archiveDir: a.dir, into });
  assert.deepEqual(readdirSync(intoParent).sort(), ["profile"],
    "a staging directory survived a successful restore");
});

test("R3: staging leaves nothing behind next to the destination on failure", async (t) => {
  const a = await makeArchive();
  const intoParent = tempRoot("into");
  const into = path.join(intoParent, "profile");
  t.after(() => { a.dispose(); rmSync(intoParent, { recursive: true, force: true }); });

  await refuses(a.dir, into, "restore_aborted", { copyFile: failingCopyAt(2) });
  const leftovers = readdirSync(intoParent).filter((e) => e !== "profile");
  assert.deepEqual(leftovers, [], `staging leftovers: ${leftovers.join(", ")}`);
});

// ===========================================================================
// R4 — the lane has to actually RUN, not merely exist
// ===========================================================================

test("R4: the packaged backup/restore lane is wired into desktop CI, not just runnable", () => {
  // The review's point, made checkable. `test:restore-acceptance-packaged` began life as an npm
  // script and nothing more: runnable on demand, enforced never. For a lane whose two claims —
  // "a corrupt case box is refused" and "an accepted archive restores" — were both FALSE within
  // the last week, on-demand is not enough; a claim that can regress silently between manual runs
  // is the same "looks like coverage, provides none" hazard as an unregistered test file.
  //
  // This also catches the cheaper failure: a workflow step that invokes a script name which no
  // longer exists. `npm run` on a missing script exits non-zero, so CI would go red rather than
  // silently skip — but it would go red for a confusing reason, days later.
  const workflow = readFileSync(
    path.join(REPO, ".github/workflows/desktop-release-gates.yml"), "utf8");
  const manifest = JSON.parse(readFileSync(path.join(REPO, "apps/lawbar-desktop/package.json"), "utf8"));

  const invoked = [...workflow.matchAll(/npm --prefix apps\/lawbar-desktop run ([a-z0-9:-]+)/g)]
    .map((m) => m[1]);
  assert.ok(invoked.length > 0, "no desktop npm scripts are invoked by the workflow at all");

  const missing = invoked.filter((name) => manifest.scripts[name] === undefined);
  assert.deepEqual(missing, [], `the workflow runs scripts that do not exist: ${missing.join(", ")}`);

  assert.ok(invoked.includes("test:restore-acceptance-packaged"),
    "the packaged backup/restore acceptance lane is not run by desktop CI; it would be " +
    "runnable on demand and enforced never");
});
