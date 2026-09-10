// Restore drill for the CURRENT in-app backup format — a directory plus a manifest.
//
// WHY THIS IS NOT backup-restore-drill.test.mjs. That file drills the OLD CLI path:
// `scripts/backup-local-data.mjs` producing a `tar.gz`, restored by unpacking it. It is a good
// test of that format and it says nothing about this one. The app now writes a directory
// containing `case-box.sqlite`, `case-box-documents/` and `manifest.json`, and until this file
// existed nothing had ever restored one and checked what came back. "The manifest is well-formed"
// and "the archive can be restored into a working case box" are different claims.
//
// WHAT THIS DRILL COVERS: a backup taken from an isolated synthetic profile, restored into a
// SECOND fresh profile, then opened and checked — every matter's full audit chain re-verified
// through the persistence API, every exhibit re-hashed at its expected path, and the logical
// content compared against the source. Plus the refusals: a bad manifest, altered bytes, and a
// destination that is not empty must all fail to produce a usable profile.
//
// WHAT IT DOES NOT COVER, STATED SO IT IS NOT READ AS MORE: there is no restore UI. The restore
// runs through `scripts/restore-from-backup.mjs`, a controlled command-line entry point. An owner
// cannot do this from inside the app today.
//
// SYNTHETIC ONLY, AND ISOLATED BY CONSTRUCTION. Both profiles are created by this file under
// os.tmpdir(); the real profile path is asserted to be neither of them and is never read.

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync,
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
  restoreFromBackup, readManifest, verifyArchive, assertDestinationSafe, RestoreRefused,
  REAL_USER_DATA,
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

const sha = (b) => createHash("sha256").update(b).digest("hex");

/**
 * A temp root, with the isolation asserted at the point of creation rather than assumed from the
 * fact that `os.tmpdir()` is usually somewhere harmless. `TMPDIR` is an environment variable.
 */
function tempRoot(label) {
  const d = mkdtempSync(path.join(os.tmpdir(), `lawbar-restore-${label}-`));
  assert.equal(isInside(REPO, d), false, "temp root must not be inside the repo tree");
  assert.equal(isInside(REAL_USER_DATA, d), false, "temp root must not be inside the real profile");
  assert.equal(isInside(path.join(os.homedir(), "Library"), d), false,
    "temp root must not be anywhere under ~/Library");
  return d;
}

/** A synthetic profile with a real audit chain, two matters and three exhibits. */
async function makeSourceProfile() {
  const userDataDir = tempRoot("source");
  const docsRoot = path.join(userDataDir, "case-box-documents");
  mkdirSync(docsRoot, { recursive: true });
  const ids = makeIdGenerator("restore");
  const opened = openSqliteCaseBoxPersistence({
    path: path.join(userDataDir, "case-box.sqlite"), generateId: ids,
  });

  const matters = [];
  const documents = [];
  const addDocument = async (matter, body) => {
    const documentId = ids();
    const source = path.join(userDataDir, `${documentId}-in.txt`);
    writeFileSync(source, body);
    const stored = await storeDocumentFile({
      sourcePath: source, storageRoot: docsRoot, documentId, filename: "exhibit.txt",
    });
    rmSync(source);
    const document = makeDocumentInput({
      id: documentId, matter_id: matter.id, filename: stored.stored_filename,
      content_hash: stored.content_hash, storage_uri: stored.storage_uri,
      byte_size: stored.byte_size,
    });
    await opened.persistence.registerDocument(matter.id, document);
    documents.push({
      ...document,
      relativePath: path.join(documentId, stored.stored_filename),
      bytes: body,
    });
  };

  for (const [i, name] of ["SYNTHETIC RESTORE ONE", "SYNTHETIC RESTORE TWO"].entries()) {
    const matter = makeMatterInput({ id: ids(), name });
    await opened.persistence.createMatter(matter);
    matters.push(matter);
    await addDocument(matter, `SYNTHETIC EXHIBIT BYTES ${i}-A`);
    if (i === 0) await addDocument(matter, `SYNTHETIC EXHIBIT BYTES ${i}-B`);
  }

  return {
    userDataDir, docsRoot, db: opened.db, persistence: opened.persistence, matters, documents,
    dispose() {
      try { opened.db.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

async function backupInto(source, destRoot) {
  return runBackup({
    db: source.db,
    documentsRoot: source.docsRoot,
    userDataDir: source.userDataDir,
    destinationRoot: destRoot,
    appVersion: "0.1.0-restore-drill",
    schemaVersion: CURRENT_SCHEMA_VERSION,
  }, (file) => new Database(file, { readonly: true }));
}

/** Open a RESTORED profile the way the app would, and report what it holds. */
async function inspectRestored(profileDir) {
  const opened = openSqliteCaseBoxPersistence({ path: path.join(profileDir, "case-box.sqlite") });
  try {
    const matters = opened.db
      .prepare("SELECT id FROM case_box_matters ORDER BY id").all().map((r) => r.id);
    const chains = [];
    for (const id of matters) {
      chains.push({ id, result: await opened.persistence.verifyAuditChainForMatter(id) });
    }
    const documents = opened.db
      .prepare("SELECT id, payload_json FROM case_box_documents ORDER BY id").all()
      .map((r) => ({ id: r.id, ...JSON.parse(r.payload_json) }));
    const events = opened.db
      .prepare("SELECT event_id, matter_id, sequence, event_json FROM case_box_audit_events ORDER BY event_id").all();
    const heads = opened.db
      .prepare("SELECT matter_id, head_hash, event_count FROM case_box_audit_chain_heads ORDER BY matter_id").all();
    return { matters, chains, documents, events, heads };
  } finally {
    opened.db.close();
  }
}

// ---------------------------------------------------------------------------
// The drill
// ---------------------------------------------------------------------------

test("a current-format backup restores into a FRESH profile and comes back whole", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  const restored = path.join(restoredParent, "profile");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  // 1. Back up from the isolated source profile.
  const backup = await backupInto(source, destRoot);
  assert.equal(backup.ok, true, backup.ok ? "" : `${backup.code}: ${backup.detail}`);
  assert.deepEqual(
    readdirSync(backup.dir).filter((f) => !f.startsWith("._")).sort(),
    ["case-box-documents", "case-box.sqlite", "manifest.json"],
    "this is the directory+manifest format, not the old tar.gz",
  );

  // 2. Restore into a SECOND, entirely separate profile.
  const result = await restoreFromBackup({ archiveDir: backup.dir, into: restored });

  // 3. PATH ISOLATION, asserted rather than assumed. Three distinct directories, none inside
  //    another, and none of them the real profile.
  for (const [a, b] of [[source.userDataDir, restored], [restored, source.userDataDir],
    [backup.dir, restored], [restored, backup.dir]]) {
    assert.equal(isInside(a, b), false, `${b} must not live inside ${a}`);
  }
  assert.equal(isInside(REAL_USER_DATA, restored), false);
  assert.equal(isInside(restored, REAL_USER_DATA), false);
  assert.equal(result.documents, source.documents.length);

  // 4. Open the restored profile and re-verify EVERY audit chain in full.
  const after = await inspectRestored(restored);
  assert.deepEqual(after.matters, source.matters.map((m) => m.id).sort(),
    "every matter came back, and no extra one appeared");
  for (const { id, result: chain } of after.chains) {
    assert.equal(chain.ok, true, `restored chain for ${id} does not verify: ${chain.detail ?? ""}`);
  }

  // 5. Every exhibit, at its expected path, with its recorded bytes.
  const docVerify = await verifyDocumentStore(
    after.documents.map((d) => ({ id: d.id, filename: d.filename, content_hash: d.content_hash })),
    { storageRoot: path.join(restored, "case-box-documents") },
  );
  assert.equal(docVerify.ok, true,
    `restored exhibits do not verify: ${JSON.stringify({
      missing: docVerify.missing, mismatched: docVerify.mismatched, unverifiable: docVerify.unverifiable,
    })}`);
  assert.equal(docVerify.checked, source.documents.length);

  for (const d of source.documents) {
    const file = path.join(restored, "case-box-documents", d.relativePath);
    assert.ok(existsSync(file), `${d.relativePath} is not at its expected path in the restored profile`);
    const bytes = readFileSync(file);
    assert.equal(sha(bytes), d.content_hash, `${d.relativePath} restored with different bytes`);
    assert.equal(bytes.toString("utf8"), d.bytes, "and different content");
  }

  // 6. Logical equivalence with the source, record by record — not just "it opens".
  const before = await (async () => {
    const matters = source.db.prepare("SELECT id FROM case_box_matters ORDER BY id").all().map((r) => r.id);
    const documents = source.db.prepare("SELECT id, payload_json FROM case_box_documents ORDER BY id").all()
      .map((r) => ({ id: r.id, ...JSON.parse(r.payload_json) }));
    const events = source.db
      .prepare("SELECT event_id, matter_id, sequence, event_json FROM case_box_audit_events ORDER BY event_id").all();
    const heads = source.db
      .prepare("SELECT matter_id, head_hash, event_count FROM case_box_audit_chain_heads ORDER BY matter_id").all();
    return { matters, documents, events, heads };
  })();
  assert.deepEqual(after.matters, before.matters);
  assert.deepEqual(after.documents, before.documents, "document records are not logically equal");
  assert.deepEqual(after.events, before.events, "audit events are not logically equal");
  assert.deepEqual(after.heads, before.heads, "chain head anchors are not logically equal");
});

test("restoring does not touch the SOURCE profile", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  const fingerprint = (root) => {
    const out = {};
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) out[path.relative(root, full)] = sha(readFileSync(full));
      }
    };
    walk(root);
    return out;
  };

  const backup = await backupInto(source, destRoot);
  assert.equal(backup.ok, true);
  const docsBefore = fingerprint(source.docsRoot);

  await restoreFromBackup({ archiveDir: backup.dir, into: path.join(restoredParent, "profile") });

  assert.deepEqual(fingerprint(source.docsRoot), docsBefore,
    "a restore elsewhere must not alter the profile the backup came from");
});

// ---------------------------------------------------------------------------
// Refusals — a restore that cannot be trusted must not produce a usable profile
// ---------------------------------------------------------------------------

/** Run a restore expected to be refused, and confirm no usable profile was left behind. */
async function refuses(archiveDir, into, expectedCode) {
  let error = null;
  try {
    await restoreFromBackup({ archiveDir, into });
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof RestoreRefused,
    `expected a refusal, got ${error === null ? "success" : error.message}`);
  assert.equal(error.code, expectedCode, `wrong refusal code (detail: ${error.detail})`);
  const populated = existsSync(path.join(into, "case-box.sqlite"));
  assert.equal(populated, false, "a refused restore left a database behind in the destination");
  return error;
}

test("an archive with no manifest is refused — no manifest means verification never passed", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  const backup = await backupInto(source, destRoot);
  assert.equal(backup.ok, true);
  rmSync(path.join(backup.dir, "manifest.json"));
  await refuses(backup.dir, path.join(restoredParent, "profile"), "manifest_missing");
});

test("an archive whose manifest is corrupt is refused", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  const backup = await backupInto(source, destRoot);
  writeFileSync(path.join(backup.dir, "manifest.json"), "{not json");
  await refuses(backup.dir, path.join(restoredParent, "profile"), "manifest_unreadable");

  writeFileSync(path.join(backup.dir, "manifest.json"), JSON.stringify({ manifestVersion: 99 }));
  await refuses(backup.dir, path.join(restoredParent, "profile2"), "manifest_version_unsupported");
});

test("an archive whose exhibit bytes were altered is refused", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  const backup = await backupInto(source, destRoot);
  assert.equal(backup.ok, true);
  const victim = path.join(backup.dir, "case-box-documents", backup.manifest.documents[0].relativePath);
  writeFileSync(victim, "SYNTHETIC REPLACEMENT ON THE SHELF");
  const err = await refuses(backup.dir, path.join(restoredParent, "profile"), "archive_failed_verification");
  assert.ok(err.detail.includes(backup.manifest.documents[0].relativePath),
    "the refusal must name the file that no longer matches");
});

test("an archive whose database was altered is refused", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  const backup = await backupInto(source, destRoot);
  const dbFile = path.join(backup.dir, "case-box.sqlite");
  writeFileSync(dbFile, Buffer.concat([readFileSync(dbFile), Buffer.from("trailing damage")]));
  await refuses(backup.dir, path.join(restoredParent, "profile"), "archive_failed_verification");
});

test("an archive missing an exhibit the manifest lists is refused", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  const backup = await backupInto(source, destRoot);
  rmSync(path.join(backup.dir, "case-box-documents", backup.manifest.documents[0].relativePath));
  await refuses(backup.dir, path.join(restoredParent, "profile"), "archive_failed_verification");
});

test("a destination that already holds anything is refused, and is left untouched", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const occupied = tempRoot("occupied");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(occupied, { recursive: true, force: true });
  });

  const backup = await backupInto(source, destRoot);
  assert.equal(backup.ok, true);
  // The single most damaging thing a restore can do is write over a case box that is still
  // there. Emptiness — not "has no database" — is the condition, because a half-populated
  // profile is just as unrecoverable and much easier to overlook.
  writeFileSync(path.join(occupied, "case-box.sqlite"), "EXISTING SYNTHETIC PROFILE");
  const before = readFileSync(path.join(occupied, "case-box.sqlite"), "utf8");

  let error = null;
  try {
    await restoreFromBackup({ archiveDir: backup.dir, into: occupied });
  } catch (err) { error = err; }
  assert.ok(error instanceof RestoreRefused);
  assert.equal(error.code, "destination_not_empty");
  assert.equal(readFileSync(path.join(occupied, "case-box.sqlite"), "utf8"), before,
    "the refused restore overwrote the profile that was already there");
});

test("the real application profile can never be a restore destination", () => {
  // TESTED THROUGH THE GUARD, NOT THROUGH `restoreFromBackup`, AND DELIBERATELY.
  //
  // `assertDestinationSafe` performs no writes at all, so running it against the live profile
  // path cannot damage anything even if the check it is testing has regressed. Calling the full
  // restore here instead would mean aiming a function that copies files at the litigator's real
  // case store and relying on the very guard under test to stop it — a test whose failure mode is
  // the destruction it was written to prevent.
  //
  // That `restoreFromBackup` actually CALLS this guard before touching the filesystem is covered
  // by the destination_not_empty test above, which goes through the full path against a temp
  // directory and proves the existing contents survive.
  let error = null;
  try {
    assertDestinationSafe(REAL_USER_DATA);
  } catch (err) { error = err; }
  assert.ok(error instanceof RestoreRefused, "the live profile was accepted as a destination");
  assert.equal(error.code, "destination_is_live_profile");

  // And the guard is not merely matching a literal string: a path that resolves to the same place
  // is refused too, while an unrelated directory is not.
  const elsewhere = tempRoot("elsewhere");
  try {
    assertDestinationSafe(path.join(REAL_USER_DATA, "..", "lawbar"));
    assert.fail("a differently-spelled path to the live profile was accepted");
  } catch (err) {
    assert.ok(err instanceof RestoreRefused);
    assert.equal(err.code, "destination_is_live_profile");
  }
  assertDestinationSafe(elsewhere); // must NOT throw — the guard has to stay usable
  rmSync(elsewhere, { recursive: true, force: true });
});

test("a manifest entry naming a path outside the archive is refused", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  const restoredParent = tempRoot("restored");
  t.after(() => {
    source.dispose();
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(restoredParent, { recursive: true, force: true });
  });

  const backup = await backupInto(source, destRoot);
  const manifest = JSON.parse(readFileSync(path.join(backup.dir, "manifest.json"), "utf8"));
  manifest.documents[0].relativePath = "../../escaped.txt";
  writeFileSync(path.join(backup.dir, "manifest.json"), JSON.stringify(manifest));
  await refuses(backup.dir, path.join(restoredParent, "profile"), "manifest_path_escape");
});

test("verify-only reads an archive without writing anything to it", async (t) => {
  const source = await makeSourceProfile();
  const destRoot = tempRoot("dest");
  t.after(() => { source.dispose(); rmSync(destRoot, { recursive: true, force: true }); });

  const backup = await backupInto(source, destRoot);
  const listBefore = readdirSync(backup.dir).sort();
  const manifest = readManifest(backup.dir);
  assert.deepEqual(await verifyArchive(backup.dir, manifest), [],
    "a freshly written archive must verify against its own manifest");
  assert.deepEqual(readdirSync(backup.dir).sort(), listBefore,
    "verifying an archive on the shelf must not change it");
});
