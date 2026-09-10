// In-app backup engine — the tests that decide whether "verified" is a word we may use.
//
// WHY THESE USE A REAL DATABASE. `runBackup` takes a `BackupCapableDb` interface, which makes a
// fake trivially easy and worthless: the SQL in this module names `case_box_audit_chain_heads`,
// `case_box_documents` and `payload_json`, and a fake would agree with whatever I wrote. The
// first draft of that SQL guessed `audit_events` and a `content_hash` COLUMN. Both typechecked.
// Both were wrong — every table is `case_box_`-prefixed and `content_hash` lives inside
// `payload_json`. A fake-backed test would have shipped that.
//
// So these build a real SQLite file with the product's real `applySchema`, and every assertion
// runs against it.
//
// ON WHICH better-sqlite3. `apps/lawbar-desktop`'s copy is rebuilt for ELECTRON's ABI by its
// `postinstall` (`electron-builder install-app-deps`). Under plain `node` it REQUIRES fine and
// then aborts the process on first use — verified, and a trap worth naming because `require`
// succeeding looks like proof and is not. The `services/case-box-persistence` copy is a plain
// Node build, and CI installs it (`npm --prefix services/case-box-persistence ci`) before it runs
// this suite. That is deliberately asserted rather than skipped around: a silent skip here would
// be a test that cannot fail.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, readdirSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  runBackup, verifyBackup, chainHeads, referencedContentHashes,
  listDocumentFiles, isInside, onSameVolume,
} from "../dist/src/backup/runBackup.js";
import { storeDocumentFile } from "../dist/src/caseBox/documentStorage.js";

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

/** A temp root outside the repo and outside ~/Library, like every other drill here. */
function tempRoot(label) {
  const d = mkdtempSync(path.join(os.tmpdir(), `lawbar-${label}-`));
  assert.equal(isInside(REPO, d), false, "temp root must not be inside the repo tree");
  return d;
}

/**
 * A case box with two matters, so a per-matter assertion can actually distinguish them, and two
 * documents whose bytes really live in the store.
 *
 * BUILT THROUGH THE PERSISTENCE API, NOT RAW SQL — and that changed after an external audit on
 * 2026-09-06. This fixture used to INSERT audit rows directly, with an invented `event_hash` and
 * `event_json = "{}"`. Those rows are internally consistent and are not a chain: no event in them
 * would survive `verifyAuditChain`. That mattered more than it looked, because it made this file
 * structurally unable to hold the judgement it appears to hold. With a fake chain there is no
 * healthy control — a real verifier rejects the fixture as loudly as it rejects a tamper — so the
 * engine could ship a chain check that only compared COUNTS, and every test here stayed green
 * while four corrupt case boxes were reported as VERIFIED.
 *
 * `createMatter` and `registerDocument` write real canonicalized events, real SHA-256 event
 * hashes, real prev-links and a real head anchor. The negative matrix lives in
 * backup-verified-integrity.test.mjs; this file keeps the engine's other properties.
 */
async function makeCaseBox() {
  const userDataDir = tempRoot("data");
  const dbPath = path.join(userDataDir, "case-box.sqlite");
  const docsRoot = path.join(userDataDir, "case-box-documents");
  mkdirSync(docsRoot, { recursive: true });
  const ids = makeIdGenerator("enginebk");
  const opened = openSqliteCaseBoxPersistence({ path: dbPath, generateId: ids });
  const db = opened.db;

  const docs = [];
  const matterIds = [];
  for (const name of ["SYNTHETIC MATTER ONE", "SYNTHETIC MATTER TWO"]) {
    const matter = makeMatterInput({ id: ids(), name });
    await opened.persistence.createMatter(matter);
    matterIds.push(matter.id);

    const id = ids();
    const source = path.join(userDataDir, `${id}-source.txt`);
    writeFileSync(source, `SYNTHETIC BYTES FOR ${id}`);
    const stored = await storeDocumentFile({
      sourcePath: source, storageRoot: docsRoot, documentId: id, filename: "source.txt",
    });
    rmSync(source);
    await opened.persistence.registerDocument(matter.id, makeDocumentInput({
      id, matter_id: matter.id, filename: stored.stored_filename,
      content_hash: stored.content_hash, storage_uri: stored.storage_uri,
      byte_size: stored.byte_size,
    }));
    const file = path.join(docsRoot, id, stored.stored_filename);
    docs.push({ id, content_hash: stored.content_hash, file, relative: path.relative(docsRoot, file) });
  }

  // The control is only a control if the product's own full verifier passes it first.
  for (const id of matterIds) {
    const chain = await opened.persistence.verifyAuditChainForMatter(id);
    assert.equal(chain.ok, true, `fixture chain for ${id} must be legitimate: ${chain.detail ?? ""}`);
  }

  return { userDataDir, dbPath, docsRoot, db, docs, matterIds, persistence: opened.persistence, ids };
}

const openBackupDb = (file) => new Database(file, { readonly: true });

async function backupInto(box, destRoot) {
  return runBackup({
    db: box.db,
    documentsRoot: box.docsRoot,
    userDataDir: box.userDataDir,
    destinationRoot: destRoot,
    appVersion: "0.1.0-test",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    now: () => new Date("2026-09-02T12:00:00.000Z"),
  }, openBackupDb);
}

// MARK: - The SQL actually matches the product's schema

test("the schema this module queries is the schema the product creates", async () => {
  const box = await makeCaseBox();
  try {
    // Each of these would have thrown "no such table"/"no such column" against the first draft.
    const heads = chainHeads(box.db);
    assert.equal(heads.length, 2, "two matters were seeded");
    assert.deepEqual(heads.map((h) => h.matterId), [...box.matterIds].sort());
    for (const h of heads) {
      assert.ok(h.eventCount >= 2,
        "createMatter writes a genesis event and registerDocument writes another");
      assert.equal(typeof h.headHash, "string");
    }

    const hashes = referencedContentHashes(box.db);
    assert.equal(hashes.length, 2, "content_hash comes out of payload_json, not a column");
    assert.deepEqual(hashes, box.docs.map((d) => d.content_hash).sort());
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); }
});

test("the manifest binds a head PER MATTER, not one global head", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.detail}`);
    assert.equal(r.manifest.chainHeads.length, 2,
      "a single head would under-bind every matter but one — this product has no global chain");
    const byId = Object.fromEntries(r.manifest.chainHeads.map((h) => [h.matterId, h]));
    const [a, b] = box.matterIds;
    assert.ok(byId[a].eventCount >= 2, "each matter's own event count travels in the manifest");
    assert.ok(byId[b].eventCount >= 2);
    assert.notEqual(byId[a].headHash, byId[b].headHash,
      "two matters with identical event counts must still have distinct heads");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// MARK: - A live snapshot under concurrent writes

test("a backup taken WHILE the database is being written is internally consistent", async () => {
  // HOW THIS ACHIEVES CONCURRENCY, and why the obvious way does not.
  //
  // A `setInterval(..., 1)` writer awaited alongside the backup passed locally and FAILED IN CI on
  // its own guard ("the writer must actually have run"): `db.backup()` finished in 12 ms on the
  // runner, and a same-thread timer cannot fire while synchronous work holds the event loop.
  // better-sqlite3's `backup(file, { progress })` runs its handler BETWEEN copy steps, on this
  // thread, deterministically — so writing from inside it is genuinely mid-copy with no timing
  // assumption at all. The engine is NOT modified for this; the test supplies its own
  // `BackupCapableDb`, which is the seam that already exists.
  //
  // WHAT IS WRITTEN, and why not raw rows. The writes go through `createMatter`, not raw INSERTs.
  // A raw INSERT of invented audit rows would make this test assert `ok: true` about an archive
  // whose chains are broken — the concurrency claim would be indistinguishable from a verifier
  // that checks nothing, which is the exact confusion this change is about. Real matters keep the
  // archive verifiable, so `ok: true` still means what it says while writes commit underneath the
  // snapshot. `createMatter` has no `await` ahead of its transaction, so a call from inside the
  // hook has COMMITTED before the hook returns; the promise merely settles later.
  //
  // MERGED 2026-09-09 from two branches that each had half of this: main had the deterministic
  // hook writing invented rows (unverifiable under this branch's engine); this branch had real
  // matters written from a timer that cannot fire during the copy. Either half alone is a test
  // that passes for the wrong reason or fails for the wrong reason.
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  let midCopyWrites = 0;
  let committed = 0;
  const inflight = [];
  const writingDb = {
    prepare: (sql) => box.db.prepare(sql),
    close: () => box.db.close(),
    pragma: (...a) => box.db.pragma(...a),
    backup: (file) =>
      box.db.backup(file, {
        progress({ remainingPages }) {
          if (remainingPages > 0) {
            midCopyWrites += 1;
            inflight.push(
              box.persistence
                .createMatter(makeMatterInput({ id: box.ids(), name: `SYNTHETIC CONCURRENT ${midCopyWrites}` }))
                .then(() => { committed += 1; }),
            );
          }
          return 1; // one page per step, so the handler is reached repeatedly on a small fixture
        },
      }),
  };
  try {
    const r = await runBackup({
      db: writingDb, documentsRoot: box.docsRoot, userDataDir: box.userDataDir,
      destinationRoot: dest, appVersion: "0.1.0-test", schemaVersion: CURRENT_SCHEMA_VERSION,
      now: () => new Date("2026-09-02T12:00:00.000Z"),
    }, openBackupDb);
    await Promise.all(inflight);

    assert.ok(midCopyWrites > 0,
      "the source must actually have been written during the copy, or this proves nothing");
    assert.equal(committed, midCopyWrites, "every mid-copy write must have committed as a real matter");
    assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.detail}`);
    const bk = new Database(path.join(r.dir, "case-box.sqlite"), { readonly: true });
    assert.equal(bk.pragma("integrity_check", { simple: true }), "ok",
      "a snapshot taken under concurrent writes must still be internally consistent");
    bk.close();
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("the live database and document store are unchanged by a backup", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const before = box.docs.map((d) => sha(readFileSync(d.file)));
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true);
    assert.deepEqual(box.docs.map((d) => sha(readFileSync(d.file))), before,
      "a backup must never mutate the evidence it preserves");
    assert.equal(chainHeads(box.db).length, 2, "the source chain heads are untouched");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// MARK: - "Verified" has to be able to say NO

test("a referenced document missing from the archive FAILS verification", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true);
    // Delete one copied blob and re-verify: the chain is still perfect, the archive is not.
    const victim = path.join(r.dir, "case-box-documents", box.docs[0].relative);
    rmSync(victim);
    const bk = new Database(path.join(r.dir, "case-box.sqlite"), { readonly: true });
    const findings = await verifyBackup(bk, r.manifest, path.join(r.dir, "case-box-documents"));
    bk.close();
    assert.ok(findings.length > 0,
      "an archive whose database cites a document it does not contain must not verify");
    assert.ok(findings.some((f) => f.includes(box.docs[0].relative) || f.includes(box.docs[0].content_hash)),
      `findings must name the missing document; got ${JSON.stringify(findings)}`);
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("a copied document whose bytes changed FAILS verification", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true);
    const victim = path.join(r.dir, "case-box-documents", box.docs[1].relative);
    writeFileSync(victim, "tampered-or-truncated-by-the-medium");
    const bk = new Database(path.join(r.dir, "case-box.sqlite"), { readonly: true });
    const findings = await verifyBackup(bk, r.manifest, path.join(r.dir, "case-box-documents"));
    bk.close();
    assert.ok(findings.some((f) => f.includes("hashes to")),
      `a byte change must be caught by hash, not by size; got ${JSON.stringify(findings)}`);
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("a chain head disagreeing with its events is reported, and only for that matter", async () => {
  // This used to call `chainHeadDisagreements`, a count-only check local to the backup engine.
  // That function is gone: it was the whole of what "verified" meant for the audit chain, and a
  // count comparison certifies an edited event. The invariant it carried is kept — it now runs
  // inside `verifyAllAuditChains` — so this asserts it through the engine's real entry point,
  // which also proves the check is actually WIRED rather than merely present.
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const [victim, intact] = box.matterIds;
    box.db.prepare("UPDATE case_box_audit_chain_heads SET event_count = 99 WHERE matter_id = ?").run(victim);
    const r = await backupInto(box, dest);
    assert.equal(r.ok, false, "a head that miscounts its own events must not verify");
    assert.equal(r.code, "verification_failed");
    assert.ok(r.detail.includes(victim) && r.detail.includes("99"),
      `the finding must name the matter and the declared count; got ${r.detail}`);
    assert.equal(r.detail.includes(intact), false, "the intact matter must not be implicated");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// MARK: - Refusals

test("a destination inside the app data directory is REFUSED", async () => {
  const box = await makeCaseBox();
  try {
    const inside = path.join(box.userDataDir, "backups");
    mkdirSync(inside, { recursive: true });
    const r = await backupInto(box, inside);
    assert.equal(r.ok, false);
    assert.equal(r.code, "destination_inside_data_dir",
      "a backup that dies with the thing it protects is not a backup");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); }
});

test("a destination that is not a directory is REFUSED", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const file = path.join(dest, "not-a-dir");
    writeFileSync(file, "x");
    const r = await backupInto(box, file);
    assert.equal(r.ok, false);
    assert.equal(r.code, "destination_unusable");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// MARK: - The manifest is a claim, so it may only exist when the claim is true

test("no manifest is written when verification fails", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    // Reference a document whose bytes were never stored: the copy cannot contain it.
    box.db.prepare(
      "INSERT INTO case_box_documents (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type, payload_json) " +
        "VALUES (?,?,?,?,?,?,?,?)",
    ).run("D-GHOST", "t1", "M-AAA", "u1", "registered", "2026-09-02T00:00:00.000Z", "pleading",
      JSON.stringify({ id: "D-GHOST", content_hash: sha(Buffer.from("never written to disk")) }));

    const r = await backupInto(box, dest);
    assert.equal(r.ok, false, "an archive missing a referenced document must not report success");
    assert.equal(r.code, "verification_failed");
    const dirs = existsSync(dest) ? require_("node:fs").readdirSync(dest) : [];
    for (const d of dirs) {
      assert.equal(existsSync(path.join(dest, d, "manifest.json")), false,
        "a manifest on disk must always mean a verified archive");
    }
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// MARK: - Store walking

test("listDocumentFiles skips symlinks rather than following them out of the store", () => {
  const root = tempRoot("store");
  try {
    mkdirSync(path.join(root, "D-1"), { recursive: true });
    writeFileSync(path.join(root, "D-1", "a.txt"), "a");
    const outside = tempRoot("outside");
    writeFileSync(path.join(outside, "secret.txt"), "should never be archived");
    require_("node:fs").symlinkSync(path.join(outside, "secret.txt"), path.join(root, "D-1", "link.txt"));
    const found = listDocumentFiles(root);
    // Two guards make this true — `lstatSync(...).isSymbolicLink()` and `Dirent.isFile()` — and
    // they are redundant. Measured: removing either one alone leaves this test green; removing
    // BOTH turns it red. So this asserts the property, not one implementation of it.
    assert.deepEqual(found, [path.join("D-1", "a.txt")],
      "a symlink must not decide what lands in an evidentiary archive");
    rmSync(outside, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// MARK: - Regressions found by adverse-condition probing, not by the tests above
//
// Both of these passed every test in this file before they were fixed. They were found by
// running the built engine against a destination that misbehaves — which is the failure this
// whole feature exists for, and the one a green suite was quietest about.

test("REGRESSION: a destination SYMLINKED into the data directory is refused", async () => {
  const box = await makeCaseBox();
  const outer = tempRoot("outer");
  try {
    // `path.resolve` normalises `..` and makes a path absolute; it does NOT follow symlinks. So a
    // destination that is a link back into the app data directory resolved to itself, compared as
    // "outside", and passed the containment guard — producing a self-referential backup, the exact
    // thing that guard exists to prevent. Measured: resolve(link) stays /outer/sneaky while
    // realpath(link) is the data dir. `documentVerify.ts` already used lstat + realpath for the
    // same class of check; this guard had not.
    const link = path.join(outer, "sneaky");
    require_("node:fs").symlinkSync(box.userDataDir, link);
    const r = await backupInto(box, link);
    assert.equal(r.ok, false, "a backup written into the data directory dies with the thing it protects");
    assert.equal(r.code, "destination_inside_data_dir");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(outer, { recursive: true, force: true }); }
});

test("REGRESSION: a symlinked destination that is genuinely elsewhere is still ALLOWED", async () => {
  // The fix must not refuse every symlink — an external drive reached through one is ordinary.
  const box = await makeCaseBox();
  const real = tempRoot("realdest");
  const outer = tempRoot("outer");
  try {
    const link = path.join(outer, "drive");
    require_("node:fs").symlinkSync(real, link);
    const r = await backupInto(box, link);
    assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.detail}`);
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(real, { recursive: true, force: true }); rmSync(outer, { recursive: true, force: true }); }
});

test("REGRESSION: the manifest's databaseSha256 is actually CHECKED, not merely recorded", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true);
    assert.ok(r.manifest.databaseSha256.length === 64, "the manifest records a database hash");

    // Recording a hash and never verifying it is a claim with nothing behind it. Corrupt the
    // archived database and confirm verification now says so.
    const dbFile = path.join(r.dir, "case-box.sqlite");
    const original = readFileSync(dbFile);
    writeFileSync(dbFile, Buffer.concat([original, Buffer.from("trailing damage")]));
    const bk = new Database(dbFile, { readonly: true });
    const findings = await verifyBackup(bk, r.manifest, path.join(r.dir, "case-box-documents"));
    bk.close();
    assert.ok(findings.some((f) => f.includes("database file hashes to")),
      `a changed archive database must be caught by its recorded hash; got ${JSON.stringify(findings)}`);
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("REGRESSION: a destination that disappears before verification is refused", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    // WHAT THIS TEST DOES AND DOES NOT PIN. The deletion is injected inside `openBackupDb`, which
    // runs AFTER `runBackup`'s destination-still-there guard — so what actually catches it here is
    // the manifest's databaseSha256 check ("the database file named by the manifest is not in the
    // archive"). Measured: removing the guard leaves this test green. It therefore asserts the
    // OUTCOME (a vanished archive is never reported as verified), not which line produces it.
    //
    // The guard still earns its place, and that was measured separately rather than assumed: with
    // a genuinely concurrent deletion (a child process removing the destination during the copy,
    // reproduced out-of-repo because `copyDocuments` is synchronous and a same-thread timer cannot
    // fire during it) the guard returns `destination_unusable` — "the drive went away" — instead
    // of `verification_failed`, which would tell the owner their archive failed verification and
    // imply corruption rather than a missing disk. Same outcome, materially different sentence.
    const r = await runBackup({
      db: box.db, documentsRoot: box.docsRoot, userDataDir: box.userDataDir,
      destinationRoot: dest, appVersion: "0.1.0-test", schemaVersion: CURRENT_SCHEMA_VERSION,
      now: () => new Date("2026-09-02T12:00:00.000Z"),
    }, (file) => {
      rmSync(path.dirname(file), { recursive: true, force: true }); // the drive goes away
      return new Database(file, { readonly: true });
    }).catch((e) => ({ ok: false, code: "threw", detail: String(e.message) }));
    assert.equal(r.ok, false, "an archive that is no longer there must not be reported as verified");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// MARK: - Found by writing a real archive to a real external volume

test("REGRESSION: the archive contains ONLY what the manifest lists", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.detail}`);

    // `db.backup()` writes ONE complete file, but opening it — even read-only, which is what
    // verification does — makes SQLite create `-wal` and `-shm` beside it, and the handle was
    // never closed so they stayed. Listing a real archive on a real external volume is what
    // showed it: a 0-byte `-wal` and a 32 KB `-shm` sitting in an evidentiary archive that the
    // manifest does not mention. An archive whose contents exceed its manifest cannot tell a
    // reader which files are the evidence, which is the entire job of having a manifest.
    const top = readdirSync(r.dir).filter((f) => !f.startsWith("._")); // macOS AppleDouble on exFAT/NTFS
    assert.deepEqual(top.sort(), ["case-box-documents", "case-box.sqlite", "manifest.json"],
      `unexpected files in the archive: ${top.join(", ")}`);
    assert.equal(existsSync(path.join(r.dir, "case-box.sqlite-wal")), false, "-wal left behind");
    assert.equal(existsSync(path.join(r.dir, "case-box.sqlite-shm")), false, "-shm left behind");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("REGRESSION: the manifest says outright that it is the authority on what is evidentiary", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true);
    // A reader of the archive may not have this source tree. macOS writes `._*` sidecars onto
    // exFAT and NTFS on its own and no application can prevent it, so the archive must carry the
    // statement that unlisted files are not evidence.
    const onDisk = JSON.parse(readFileSync(path.join(r.dir, "manifest.json"), "utf8"));
    assert.equal(typeof onDisk.note, "string");
    assert.ok(onDisk.note.includes("authoritative"), "the manifest must claim authority explicitly");
    assert.ok(onDisk.note.includes("not evidentiary"), "and say what unlisted files are NOT");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("REGRESSION: no file handle is left open on the archive — the disk must be ejectable", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest");
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.detail}`);

    // WHY THIS IS ITS OWN TEST. Removing `backupDb.close?.()` leaves every other assertion in this
    // file green — the explicit `rmSync` still clears the sidecars from the listing — so the close
    // looked redundant until the question was asked properly. It is not: an open descriptor on the
    // archive means macOS reports the volume as in use and refuses to eject it. The backup screen
    // tells the owner, in `backup.custody`, to disconnect the disk afterwards. A product that
    // says "disconnect this" while still holding the file open is giving an instruction it has
    // itself made impossible to follow.
    const out = execFileSync("lsof", ["+D", r.dir], { encoding: "utf8" }).trim();
    assert.equal(out, "", `something still holds the archive open:\n${out}`);
  } catch (err) {
    // `lsof +D` exits 1 with no output when nothing matches, which is the PASSING case.
    if (err?.status === 1 && String(err.stdout ?? "").trim() === "") return;
    throw err;
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// MARK: - A read-only destination, which is the likeliest real failure of all
//
// External drives ship NTFS-formatted from the factory and macOS mounts NTFS READ-ONLY. Measured
// on exactly such a drive: 1 TB, 445 GB free, connected, visible in Finder, and completely
// unwritable. Before this, the owner was told "check the disk is connected and has space" —
// true, useless, and pointing at the two things that were already fine.

/**
 * A genuinely read-only filesystem. `chmod` cannot produce EROFS — only a real mount can, which is
 * why this goes to the trouble of making one. `hdiutil` is already a CI dependency here: the
 * packaging step builds DMGs with it.
 *
 * The mount point is PARSED from hdiutil's output rather than assumed from the volume name. macOS
 * appends a suffix when a name is already taken (`/Volumes/NAME 1`), so a guessed path is right
 * until two runs overlap and then silently points at nothing.
 */
async function withReadOnlyVolume(fn) {
  const dir = tempRoot("ro-img");
  const img = path.join(dir, "ro");
  const name = `LAWBARRO${process.pid}${Math.floor(Math.random() * 1e6)}`;
  execFileSync("hdiutil", ["create", "-size", "8m", "-fs", "HFS+", "-volname", name, "-quiet", img]);
  const out = execFileSync("hdiutil", ["attach", `${img}.dmg`, "-readonly", "-nobrowse"], { encoding: "utf8" });
  const match = out.split("\n").map((l) => l.match(/(\/Volumes\/.+?)\s*$/)).find(Boolean);
  assert.ok(match, `hdiutil attach reported no mount point:\n${out}`);
  const volume = match[1];
  assert.ok(existsSync(volume), `mount point ${volume} does not exist`);
  try {
    // AWAIT, not `return fn(volume)`. Without the await this helper is synchronous, so `finally`
    // fires the moment `fn` hands back its promise — detaching the volume while the callback is
    // still using it. The first version did exactly that, and the failure looked like a mount
    // point that had never existed rather than one pulled out from under the test.
    return await fn(volume);
  } finally {
    try { execFileSync("hdiutil", ["detach", volume, "-quiet"]); } catch { /* already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A WRITABLE mounted volume — a genuinely different device id from the temp dir. */
async function withWritableVolume(fn) {
  const dir = tempRoot("rw-img");
  const img = path.join(dir, "rw");
  const name = `LAWBARRW${process.pid}${Math.floor(Math.random() * 1e6)}`;
  execFileSync("hdiutil", ["create", "-size", "32m", "-fs", "HFS+", "-volname", name, "-quiet", img]);
  const out = execFileSync("hdiutil", ["attach", `${img}.dmg`, "-nobrowse"], { encoding: "utf8" });
  const match = out.split("\n").map((l) => l.match(/(\/Volumes\/.+?)\s*$/)).find(Boolean);
  assert.ok(match, `hdiutil attach reported no mount point:\n${out}`);
  const volume = match[1];
  try {
    return await fn(volume);
  } finally {
    try { execFileSync("hdiutil", ["detach", volume, "-quiet"]); } catch { /* already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a READ-ONLY volume is named as such, not lumped in with 'unusable'", async () => {
  const box = await makeCaseBox();
  try {
    const code = await withReadOnlyVolume(async (volume) => {
      const r = await backupInto(box, volume);
      assert.equal(r.ok, false, "a read-only volume cannot receive a backup");
      return r.code;
    });
    assert.equal(code, "destination_read_only",
      "the owner must be told the disk is read-only, not told to check space that is already free");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); }
});

test("the read-only check runs BEFORE anything is created on the volume", async () => {
  const box = await makeCaseBox();
  try {
    await withReadOnlyVolume(async (volume) => {
      const before = readdirSync(volume).filter((f) => !f.startsWith("."));
      const r = await backupInto(box, volume);
      assert.equal(r.ok, false);
      assert.deepEqual(readdirSync(volume).filter((f) => !f.startsWith(".")), before,
        "a refused backup must leave the destination exactly as it found it");
    });
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); }
});

test("a WRITABLE-but-permission-denied directory is NOT reported as read-only", async () => {
  // The two are different problems with different remedies, and conflating them would send the
  // owner to reformat a disk whose permissions merely need fixing.
  const box = await makeCaseBox();
  const parent = tempRoot("perm");
  const dest = path.join(parent, "locked");
  try {
    mkdirSync(dest);
    chmodSync(dest, 0o500); // readable + executable, not writable
    const r = await backupInto(box, dest);
    assert.equal(r.ok, false);
    assert.equal(r.code, "destination_unusable", "EACCES is not EROFS");
    assert.notEqual(r.code, "destination_read_only");
  } finally {
    try { chmodSync(dest, 0o700); } catch { /* fine */ }
    box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

// MARK: - Same-volume backups are real, and must not be reported as more than they are

test("a backup onto the SAME volume as the case box is flagged, not refused", async () => {
  const box = await makeCaseBox();
  const dest = tempRoot("dest"); // both under os.tmpdir() -> same device on this machine
  try {
    const r = await backupInto(box, dest);
    assert.equal(r.ok, true, "refusing would leave the owner with no backup at all");
    assert.equal(r.sameVolume, onSameVolume(box.userDataDir, r.dir),
      "the flag must reflect the measured device id, not a guess");
    // Both temp dirs live on the same device here, so this asserts the true case concretely.
    assert.equal(statSync(box.userDataDir).dev, statSync(r.dir).dev, "precondition for this test");
    assert.equal(r.sameVolume, true);
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test("a backup onto a DIFFERENT volume is not flagged", async () => {
  const box = await makeCaseBox();
  try {
    // A mounted disk image is a genuinely different device — the only honest way to test this.
    await withWritableVolume(async (volume) => {
      const r = await backupInto(box, volume);
      assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.detail}`);
      assert.notEqual(statSync(box.userDataDir).dev, statSync(r.dir).dev, "precondition");
      assert.equal(r.sameVolume, false,
        "an external disk must not be warned about — that would train the owner to ignore the warning");
    });
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); }
});

test("onSameVolume compares device ids, not path prefixes", async () => {
  const box = await makeCaseBox();
  try {
    await withWritableVolume(async (volume) => {
      // Nothing about these two paths shares a prefix, and they are genuinely different devices.
      assert.equal(onSameVolume(box.userDataDir, volume), false);
      // And a path that does not exist is never claimed to be the same volume.
      assert.equal(onSameVolume(box.userDataDir, path.join(volume, "no-such-dir")), false);
    });
    assert.equal(onSameVolume(box.userDataDir, box.userDataDir), true, "a path is on its own volume");
  } finally { box.db.close(); rmSync(box.userDataDir, { recursive: true, force: true }); }
});
