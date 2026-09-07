// The tests that decide whether a backup may call itself VERIFIED.
//
// WHAT THIS FILE IS FOR. backup-in-app-engine.test.mjs covers the engine's mechanics —
// destinations, refusals, manifests, volumes. This file covers the single judgement the word
// "verified" stands on: a legitimate case box passes, and every corruption of one is refused.
//
// It exists as its own file because that judgement was reproducibly WRONG on 2026-09-06 while the
// engine suite was fully green, and the reason was the fixture. That suite used to seed audit rows
// with raw SQL — a made-up `event_hash`, `event_json = "{}"`, a head row whose hash was whatever
// the loop last computed. Internally consistent, and not a chain: no event in it would survive
// `verifyAuditChain`. A fixture like that cannot express this judgement at all, because it has no
// healthy control — a real verifier rejects it exactly as loudly as it rejects a tamper. So the
// engine could ship a chain check that compared only COUNTS, and nothing went red. (That fixture
// is now built through the persistence API too; the lesson is why both files say so.)
//
// Every case box below is therefore built through the PRODUCT's own persistence API —
// `openSqliteCaseBoxPersistence` + `createMatter` + `registerDocument` — which writes real
// canonicalized events, real SHA-256 event hashes, real prev-links and a real head anchor.
// Corruption is then injected into that synthetic copy with direct SQL or filesystem edits, which
// is the only way to produce these states: the product API cannot.
//
// SYNTHETIC ONLY. Every case box is created under os.tmpdir() by this file, and the temp root is
// asserted to be outside the repo before anything is written. Nothing here reads, opens or names
// the real case store.
//
// ON WHICH better-sqlite3: the `services/case-box-persistence` copy, a plain Node build. The
// desktop app's own copy is rebuilt for ELECTRON's ABI by its postinstall and aborts the process
// on first use under plain `node` — it `require`s cleanly first, which is what makes that trap
// worth naming.

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync,
  readdirSync, statSync, cpSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runBackup, verifyBackup, isInside } from "../dist/src/backup/runBackup.js";
import { backupRunHandler, backupStatusHandler } from "../dist/src/backup/backupHandlers.js";
import { loadBackupRecord, saveBackupRecord } from "../dist/src/persistence/backupRecord.js";
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
const openBackupDb = (file) => new Database(file, { readonly: true });

/** A temp root outside the repo tree, asserted rather than assumed. */
function tempRoot(label) {
  const d = mkdtempSync(path.join(os.tmpdir(), `lawbar-${label}-`));
  assert.equal(isInside(REPO, d), false, "temp root must not be inside the repo tree");
  assert.equal(isInside(path.join(os.homedir(), "Library", "Application Support", "lawbar"), d),
    false, "temp root must not be inside the real case store");
  return d;
}

/**
 * A case box carrying a REAL audit chain: two matters, each created through the persistence API
 * (so each has a genuine MATTER_REGISTERED genesis event), and documents whose bytes really live
 * in the content-addressed store and whose rows really reference them.
 *
 * The FIRST matter gets two documents, so its chain is genesis + two registrations = three
 * events. That is not decoration: a chain of two has a first and a last event and no MIDDLE one,
 * and "an edited middle event" is the case the in-chain prev-link is supposed to catch on its
 * own, distinct from the head anchor that catches the last. A two-event fixture cannot tell those
 * two mechanisms apart.
 */
async function makeRealCaseBox(label = "data") {
  const userDataDir = tempRoot(label);
  const docsRoot = path.join(userDataDir, "case-box-documents");
  mkdirSync(docsRoot, { recursive: true });
  const ids = makeIdGenerator("synthbk");
  const opened = openSqliteCaseBoxPersistence({
    path: path.join(userDataDir, "case-box.sqlite"),
    generateId: ids,
  });

  const matters = [];
  const documents = [];

  const addDocument = async (matter) => {
    const documentId = ids();
    const source = path.join(userDataDir, `${documentId}-source.txt`);
    writeFileSync(source, `SYNTHETIC BYTES FOR ${documentId}`);
    const stored = await storeDocumentFile({
      sourcePath: source, storageRoot: docsRoot, documentId, filename: "source.txt",
    });
    rmSync(source);
    const document = makeDocumentInput({
      id: documentId, matter_id: matter.id, filename: stored.stored_filename,
      content_hash: stored.content_hash, storage_uri: stored.storage_uri,
      byte_size: stored.byte_size,
    });
    await opened.persistence.registerDocument(matter.id, document);
    documents.push({ ...document, storedRelative: path.join(documentId, stored.stored_filename) });
  };

  for (const [index, name] of ["SYNTHETIC MATTER ONE", "SYNTHETIC MATTER TWO"].entries()) {
    const matter = makeMatterInput({ id: ids(), name });
    await opened.persistence.createMatter(matter);
    matters.push(matter);
    await addDocument(matter);
    if (index === 0) await addDocument(matter); // third event on matter one — see above
  }

  // The control is only a control if the product's OWN full verifier passes it first.
  for (const m of matters) {
    const chain = await opened.persistence.verifyAuditChainForMatter(m.id);
    assert.equal(chain.ok, true, `fixture chain for ${m.id} must be legitimate: ${chain.detail ?? ""}`);
  }

  return {
    userDataDir, docsRoot, db: opened.db, persistence: opened.persistence, matters, documents,
    dispose() {
      try { opened.db.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

async function backupInto(box, destRoot) {
  return runBackup({
    db: box.db,
    documentsRoot: box.docsRoot,
    userDataDir: box.userDataDir,
    destinationRoot: destRoot,
    appVersion: "0.1.0-test",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    now: () => new Date("2026-09-06T12:00:00.000Z"),
  }, openBackupDb);
}

/** Every file under a root with its size and digest — for proving the SOURCE was not touched. */
function fingerprint(root) {
  const out = {};
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const bytes = readFileSync(full);
        out[path.relative(root, full)] = `${bytes.length}:${sha(bytes)}`;
      }
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// The import that makes the reuse possible must stay free of the native driver
// ---------------------------------------------------------------------------

test("case-box-persistence/archive-verify loads without opening ANY native addon", async () => {
  // `runBackup` imports this subpath rather than the package root, and the comment there says
  // why. This is that claim under test rather than asserted. The package root re-exports
  // `openSqliteCaseBoxPersistence`, which value-imports `better-sqlite3`; the desktop app's copy
  // of that binding is built for ELECTRON's ABI and aborts the process on first use under plain
  // `node`. `require` SUCCEEDING is what makes it dangerous — the failure is deferred to the
  // first call, which in production is the backup button.
  //
  // `process.dlopen` is the single chokepoint every native addon goes through, so hooking it in a
  // child process detects the load itself rather than a symptom of it.
  const probe = `
    const failures = [];
    const realDlopen = process.dlopen.bind(process);
    process.dlopen = (m, f, ...rest) => { failures.push(f); return realDlopen(m, f, ...rest); };
    await import(${JSON.stringify(
      path.join(REPO, "apps/lawbar-desktop/node_modules/case-box-persistence/dist/archiveVerify.js"),
    )});
    console.log(JSON.stringify(failures));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    cwd: path.join(REPO, "apps/lawbar-desktop"),
  });
  assert.deepEqual(JSON.parse(out.trim()), [],
    "importing archive-verify loaded a native addon; under plain node that is an aborting process",
  );

  // And the module really does export the verifier — an empty module would also load no addon.
  const mod = await import(
    path.join(REPO, "apps/lawbar-desktop/node_modules/case-box-persistence/dist/archiveVerify.js")
  );
  assert.equal(typeof mod.verifyAllAuditChains, "function");
});

// ---------------------------------------------------------------------------
// The healthy control
// ---------------------------------------------------------------------------

test("a case box with a legitimate audit chain backs up and verifies", async (t) => {
  const box = await makeRealCaseBox();
  const dest = tempRoot("dest");
  t.after(() => { box.dispose(); rmSync(dest, { recursive: true, force: true }); });

  const result = await backupInto(box, dest);
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.detail}`);
  assert.equal(result.manifest.chainHeads.length, box.matters.length, "one head per matter");
  assert.equal(result.manifest.documents.length, box.documents.length,
    "every registered exhibit is in the archive");
  assert.ok(existsSync(path.join(result.dir, "manifest.json")),
    "a manifest on disk is the product's own signal that verification passed");
});

// ---------------------------------------------------------------------------
// The corruption matrix. Each of these returned ok:true before this work.
// ---------------------------------------------------------------------------

/**
 * Run one corruption scenario: build a real case box, mutate it, back it up, and require the
 * backup to REFUSE. `mutate` receives the live box and does its damage with direct SQL or
 * filesystem edits — the product API cannot produce these states, which is the point.
 */
async function refuses(t, label, mutate, { expectCode = "verification_failed" } = {}) {
  const box = await makeRealCaseBox();
  const dest = tempRoot("dest");
  t.after(() => { box.dispose(); rmSync(dest, { recursive: true, force: true }); });

  await mutate(box);
  const result = await backupInto(box, dest);

  assert.equal(result.ok, false, `${label}: a corrupted case box was reported as VERIFIED`);
  assert.equal(result.code, expectCode, `${label}: wrong failure code (detail: ${result.detail})`);
  assert.ok(typeof result.detail === "string" && result.detail.length > 0,
    `${label}: a refusal with no diagnosis cannot be acted on`);

  // A refused run must not leave a manifest behind: a manifest on disk means "verified".
  const dirs = readdirSync(dest).map((d) => path.join(dest, d)).filter((d) => statSync(d).isDirectory());
  for (const d of dirs) {
    assert.equal(existsSync(path.join(d, "manifest.json")), false,
      `${label}: a refused archive still carries a manifest, which reads as verified`);
  }
  return result;
}

// -- audit chain --------------------------------------------------------------

test("an edited event payload is refused, even though the head row still agrees on counts", async (t) => {
  await refuses(t, "changed-event-json", (box) => {
    const row = box.db.prepare(
      "SELECT event_id, event_json FROM case_box_audit_events ORDER BY sequence LIMIT 1").get();
    const event = JSON.parse(row.event_json);
    event.actor_user_id = "SYNTHETIC-TAMPER";
    box.db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
      .run(JSON.stringify(event), row.event_id);
  });
});

test("an edited MIDDLE event is refused", async (t) => {
  await refuses(t, "changed-middle-event", (box) => {
    const rows = box.db.prepare(
      "SELECT event_id, event_json, matter_id FROM case_box_audit_events ORDER BY matter_id, sequence").all();
    const byMatter = rows.filter((r) => r.matter_id === rows[0].matter_id);
    assert.ok(byMatter.length >= 3, "fixture needs at least three events to have a middle one");
    const middle = byMatter[Math.floor(byMatter.length / 2)];
    const event = JSON.parse(middle.event_json);
    event.actor_user_id = "SYNTHETIC-TAMPER-MIDDLE";
    box.db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
      .run(JSON.stringify(event), middle.event_id);
  });
});

test("an edited LAST event is refused — the in-chain link cannot see it, the head anchor can", async (t) => {
  await refuses(t, "changed-last-event", (box) => {
    const last = box.db.prepare(
      "SELECT event_id, event_json FROM case_box_audit_events ORDER BY matter_id DESC, sequence DESC LIMIT 1").get();
    const event = JSON.parse(last.event_json);
    event.actor_user_id = "SYNTHETIC-TAMPER-LAST";
    box.db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
      .run(JSON.stringify(event), last.event_id);
  });
});

test("a deleted chain head is refused — and the matter is still CHECKED, not skipped", async (t) => {
  // The defect this pins: the verifier drove its matter list from the chain-heads table, so
  // deleting a head removed the matter from the checked set entirely and produced a manifest
  // with `chainHeads: []` reported as a success. Asserting the detail NAMES that matter is what
  // separates "it failed for some reason" from "it failed because it actually looked at it".
  let victim = null;
  const result = await refuses(t, "missing-head", (box) => {
    victim = box.matters[0].id;
    box.db.prepare("DELETE FROM case_box_audit_chain_heads WHERE matter_id = ?").run(victim);
  });
  assert.ok(result.detail.includes(victim),
    `the refusal must name the matter whose head is gone; got: ${result.detail}`);
});

test("truncating the last event is refused", async (t) => {
  await refuses(t, "truncated-events", (box) => {
    const last = box.db.prepare(
      "SELECT event_id FROM case_box_audit_events ORDER BY matter_id DESC, sequence DESC LIMIT 1").get();
    box.db.prepare("DELETE FROM case_box_audit_events WHERE event_id = ?").run(last.event_id);
  });
});

test("a head row whose event_count is inflated is refused", async (t) => {
  // The chain itself still verifies here — only the head's declared count is a lie. This is the
  // one corruption the old count-only check DID catch, and it must not regress.
  await refuses(t, "count-forgery", (box) => {
    box.db.prepare("UPDATE case_box_audit_chain_heads SET event_count = event_count + 5 WHERE matter_id = ?")
      .run(box.matters[0].id);
  });
});

test("events belonging to a matter row that no longer exists are refused, not ignored", async (t) => {
  await refuses(t, "orphan-events", (box) => {
    box.db.prepare("PRAGMA foreign_keys = OFF").run?.();
    box.db.prepare("DELETE FROM case_box_matters WHERE id = ?").run(box.matters[0].id);
  });
});

// -- documents ----------------------------------------------------------------

test("a registered exhibit renamed on disk is refused, even though its bytes are still present", async (t) => {
  // The hash-SET check passed this: some file in the archive hashed to the wanted digest, so the
  // set comparison was satisfied. Reference integrity is per-document, not per-digest.
  await refuses(t, "renamed-document", (box) => {
    const doc = box.documents[0];
    const dir = path.join(box.docsRoot, doc.id);
    renameSync(path.join(dir, doc.filename), path.join(dir, "renamed.txt"));
  });
});

test("a registered exhibit whose file is gone is refused", async (t) => {
  await refuses(t, "missing-document", (box) => {
    rmSync(path.join(box.docsRoot, box.documents[0].id), { recursive: true });
  });
});

test("an exhibit whose bytes were replaced is refused", async (t) => {
  await refuses(t, "altered-document", (box) => {
    const doc = box.documents[0];
    writeFileSync(path.join(box.docsRoot, doc.id, doc.filename), "SYNTHETIC REPLACEMENT BYTES");
  });
});

test("a document row with unparseable JSON is refused, not silently skipped", async (t) => {
  // Before this work the bad row was `continue`d past, so the manifest reported
  // `documents: 0, referencedHashes: 0` and the run SUCCEEDED.
  await refuses(t, "invalid-document-json", (box) => {
    box.db.prepare("UPDATE case_box_documents SET payload_json = ? WHERE id = ?")
      .run("{invalid-json", box.documents[0].id);
    rmSync(path.join(box.docsRoot, box.documents[0].id), { recursive: true });
  });
});

test("a document row missing content_hash is refused, not treated as having nothing to check", async (t) => {
  await refuses(t, "document-without-hash", (box) => {
    const doc = box.documents[0];
    const payload = JSON.parse(
      box.db.prepare("SELECT payload_json FROM case_box_documents WHERE id = ?").get(doc.id).payload_json);
    delete payload.content_hash;
    box.db.prepare("UPDATE case_box_documents SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), doc.id);
  });
});

test("two documents sharing one digest do not cover for each other's missing file", async (t) => {
  // The sharpest case against a hash-set check: doc B is registered with doc A's digest, then B's
  // own file is removed. The wanted digest is still present in the archive (A supplies it), so a
  // set comparison is satisfied while B's reference is dangling.
  await refuses(t, "same-hash-different-reference", (box) => {
    const [a, b] = box.documents;
    const payload = JSON.parse(
      box.db.prepare("SELECT payload_json FROM case_box_documents WHERE id = ?").get(b.id).payload_json);
    payload.content_hash = a.content_hash;
    box.db.prepare("UPDATE case_box_documents SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), b.id);
    rmSync(path.join(box.docsRoot, b.id), { recursive: true });
  });
});

test("a document row whose id points outside the store is refused", async (t) => {
  await refuses(t, "escaping-document-id", (box) => {
    const doc = box.documents[0];
    const payload = JSON.parse(
      box.db.prepare("SELECT payload_json FROM case_box_documents WHERE id = ?").get(doc.id).payload_json);
    payload.id = "../../../etc";
    box.db.prepare("UPDATE case_box_documents SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), doc.id);
  });
});

test("an exhibit replaced by a symlink to real bytes is refused", async (t) => {
  // The archive copier skips symlinks, so the link never reaches the archive — but the point is
  // that the DOCUMENT REFERENCE must then fail, rather than the file quietly vanishing from a
  // manifest that still reports success.
  await refuses(t, "symlinked-document", (box) => {
    const doc = box.documents[0];
    const target = path.join(box.userDataDir, "planted.txt");
    writeFileSync(target, readFileSync(path.join(box.docsRoot, doc.id, doc.filename)));
    rmSync(path.join(box.docsRoot, doc.id, doc.filename));
    require_("node:fs").symlinkSync(target, path.join(box.docsRoot, doc.id, doc.filename));
  });
});

// ---------------------------------------------------------------------------
// Verification must be READ-ONLY on the source
// ---------------------------------------------------------------------------

test("verifying a backup changes nothing in the source case box — healthy or corrupt", async (t) => {
  for (const corrupt of [false, true]) {
    const box = await makeRealCaseBox();
    const dest = tempRoot("dest");
    try {
      if (corrupt) {
        const row = box.db.prepare(
          "SELECT event_id, event_json FROM case_box_audit_events ORDER BY sequence LIMIT 1").get();
        const event = JSON.parse(row.event_json);
        event.actor_user_id = "SYNTHETIC-TAMPER";
        box.db.prepare("UPDATE case_box_audit_events SET event_json = ? WHERE event_id = ?")
          .run(JSON.stringify(event), row.event_id);
      }
      // Fingerprint the DOCUMENT STORE and the logical database content, taken after any
      // corruption so the comparison isolates what the backup itself does.
      const docsBefore = fingerprint(box.docsRoot);
      const dbBefore = {
        events: box.db.prepare("SELECT event_id, event_json FROM case_box_audit_events ORDER BY event_id").all(),
        heads: box.db.prepare("SELECT matter_id, head_hash, event_count FROM case_box_audit_chain_heads ORDER BY matter_id").all(),
        documents: box.db.prepare("SELECT id, payload_json FROM case_box_documents ORDER BY id").all(),
        matters: box.db.prepare("SELECT id FROM case_box_matters ORDER BY id").all(),
      };

      await backupInto(box, dest);

      assert.deepEqual(fingerprint(box.docsRoot), docsBefore,
        `${corrupt ? "corrupt" : "healthy"}: backing up altered the original exhibits`);
      assert.deepEqual({
        events: box.db.prepare("SELECT event_id, event_json FROM case_box_audit_events ORDER BY event_id").all(),
        heads: box.db.prepare("SELECT matter_id, head_hash, event_count FROM case_box_audit_chain_heads ORDER BY matter_id").all(),
        documents: box.db.prepare("SELECT id, payload_json FROM case_box_documents ORDER BY id").all(),
        matters: box.db.prepare("SELECT id FROM case_box_matters ORDER BY id").all(),
      }, dbBefore, `${corrupt ? "corrupt" : "healthy"}: backing up altered the source database`);
    } finally {
      box.dispose();
      rmSync(dest, { recursive: true, force: true });
    }
  }
});

test("a corrupt archive is left on disk for diagnosis, but is distinguishable from a verified one", async (t) => {
  const box = await makeRealCaseBox();
  const dest = tempRoot("dest");
  t.after(() => { box.dispose(); rmSync(dest, { recursive: true, force: true }); });

  box.db.prepare("DELETE FROM case_box_audit_chain_heads").run();
  const result = await backupInto(box, dest);
  assert.equal(result.ok, false);

  const dirs = readdirSync(dest).filter((d) => statSync(path.join(dest, d)).isDirectory());
  assert.equal(dirs.length, 1, "the archive is kept so the owner can be told where to look");
  assert.equal(existsSync(path.join(dest, dirs[0], "manifest.json")), false,
    "and it carries no manifest, which is the only thing that says 'verified'");
  assert.equal(existsSync(path.join(dest, dirs[0], "case-box.sqlite")), true);
});

// ---------------------------------------------------------------------------
// Through the REAL handler: a refused run must not touch the success record
// ---------------------------------------------------------------------------

function handlerDeps(box, destination) {
  return {
    userDataDir: box.userDataDir,
    documentsRoot: box.docsRoot,
    appVersion: "0.1.0-test",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    getDb: () => box.db,
    openBackupDb,
    chooseDestination: async () => destination,
    now: () => new Date("2026-09-06T12:00:00.000Z"),
  };
}

test("a VERIFICATION failure through the handler never records a success — first-ever backup", async (t) => {
  const box = await makeRealCaseBox();
  const dest = tempRoot("dest");
  t.after(() => { box.dispose(); rmSync(dest, { recursive: true, force: true }); });

  const deps = handlerDeps(box, dest);
  assert.equal(backupStatusHandler(deps).hasEverBackedUp, false, "precondition: nothing recorded yet");

  box.db.prepare("DELETE FROM case_box_audit_chain_heads").run();
  const result = await backupRunHandler(deps);

  assert.equal(result.ok, false, "the handler reported a tampered case box as backed up");
  assert.equal(result.code, "verification_failed");
  const status = backupStatusHandler(deps);
  assert.equal(status.hasEverBackedUp, false,
    "a failed first backup must not make the screen say the owner is protected");
  assert.equal(status.lastVerifiedAt, null);
  assert.equal(existsSync(path.join(box.userDataDir, "backup-record.json")), false);
});

test("a VERIFICATION failure through the handler never refreshes an EARLIER success", async (t) => {
  const box = await makeRealCaseBox();
  const dest = tempRoot("dest");
  t.after(() => { box.dispose(); rmSync(dest, { recursive: true, force: true }); });

  const deps = handlerDeps(box, dest);
  const good = await backupRunHandler(deps);
  assert.equal(good.ok, true, good.ok ? "" : good.code);
  const before = loadBackupRecord(box.userDataDir);
  assert.notEqual(before.lastVerifiedAt, null, "precondition: a real earlier success");

  // Now tamper, and run again with a LATER clock. If the failure path wrote anything, the
  // timestamp would move forward — the exact way a bad run masquerades as a fresh good one.
  box.db.prepare("UPDATE case_box_audit_chain_heads SET head_hash = ? WHERE matter_id = ?")
    .run(sha("SYNTHETIC-NOT-THE-HEAD"), box.matters[0].id);
  const later = { ...deps, now: () => new Date("2026-09-20T12:00:00.000Z") };
  const bad = await backupRunHandler(later);

  assert.equal(bad.ok, false, "a tampered chain was accepted");
  assert.equal(bad.code, "verification_failed");
  assert.deepEqual(loadBackupRecord(box.userDataDir), before,
    "the failed run advanced or rewrote the last-verified record");
  assert.equal(backupStatusHandler(later).lastVerifiedAt, before.lastVerifiedAt,
    "the screen would have shown a failed run as this month's backup");
});

test("the renderer still receives a code and no filesystem path when verification fails", async (t) => {
  const box = await makeRealCaseBox();
  const dest = tempRoot("dest");
  t.after(() => { box.dispose(); rmSync(dest, { recursive: true, force: true }); });

  box.db.prepare("DELETE FROM case_box_audit_chain_heads").run();
  const result = await backupRunHandler(handlerDeps(box, dest));
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result).sort(), ["code", "ok"],
    "a verification detail names matters and paths; it must not cross the process boundary");
  const payload = JSON.stringify(result);
  assert.equal(payload.includes(box.userDataDir), false);
  assert.equal(payload.includes(box.matters[0].id), false, "no matter id on the wire either");
});

// ---------------------------------------------------------------------------
// The archive is verified as an ARCHIVE — no migration, no writes into it
// ---------------------------------------------------------------------------

test("verification does not migrate or write to the archive it is checking", async (t) => {
  const box = await makeRealCaseBox();
  const dest = tempRoot("dest");
  t.after(() => { box.dispose(); rmSync(dest, { recursive: true, force: true }); });

  const result = await backupInto(box, dest);
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.detail}`);

  // As DELIVERED, the archive holds exactly the database, the documents and the manifest —
  // no `-wal`/`-shm` left behind by the handle verification itself opened.
  for (const sidecar of ["case-box.sqlite-wal", "case-box.sqlite-shm"]) {
    assert.equal(existsSync(path.join(result.dir, sidecar)), false,
      `the delivered archive carries ${sidecar}, which its manifest does not list`);
  }

  // Now re-verify the finished archive and prove the EVIDENTIARY CONTENT is untouched: a
  // verification that opened it read-write, checkpointed a WAL, or ran a migration would show
  // up as a differing database file. (Sidecars created by this test's own second handle are
  // excluded and cleaned up — they are the test's artifacts, not the product's.)
  const copy = path.join(tempRoot("copy"), "archive");
  cpSync(result.dir, copy, { recursive: true });
  t.after(() => rmSync(path.dirname(copy), { recursive: true, force: true }));

  const archiveDb = openBackupDb(path.join(result.dir, "case-box.sqlite"));
  const manifest = JSON.parse(readFileSync(path.join(result.dir, "manifest.json"), "utf8"));
  const findings = await verifyBackup(archiveDb, manifest, path.join(result.dir, "case-box-documents"));
  archiveDb.close();
  assert.deepEqual(findings, [], "re-verifying a good archive must find nothing");

  for (const sidecar of ["case-box.sqlite-wal", "case-box.sqlite-shm"]) {
    rmSync(path.join(result.dir, sidecar), { force: true });
  }
  assert.deepEqual(fingerprint(result.dir), fingerprint(copy),
    "verifying the archive modified its evidentiary content");
});
