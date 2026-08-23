// backup-restore-drill.test.mjs — end-to-end restore drill for the local backup
// (WI-DESKTOP-BACKUP-RESTORE-DRILL-15). Proves a backup archive made from
// SYNTHETIC Lawbar data restores into a fresh temp app-data dir and opens.
//
// SYNTHETIC DATA ONLY. Everything lives under os.tmpdir(); the drill never reads,
// lists, or touches the real ~/Library/Application Support/lawbar or the ignored
// dev-memo/run/intake/, and writes nothing into the repo tree.
//
// It uses the `sqlite3` CLI (not better-sqlite3) to create + query the DB, so it
// is independent of the electron-ABI native binding used by the packaged app.
// The backup script is exercised through its existing --data-dir / --out options;
// the drill does NOT change or weaken the fail-closed backup behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "backup-local-data.mjs");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// A clearly-synthetic ASCII marker so a leak would be obvious and no real data is implied.
const SYNTHETIC_ROW = "SYNTHETIC-DRILL-ROW-0001"; // obviously-fake sample value
const SYNTHETIC_DOC = "synthetic-placeholder.txt";

function sqlite3Available() {
  const r = spawnSync("sqlite3", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

// PREFLIGHT (before any write): os.tmpdir() honors $TMPDIR, so refuse to run if the
// temp root resolves inside the repo tree or ~/Library — the drill must never write
// into either, even transiently. Repo-tree containment also covers the ignored
// dev-memo/run/intake/ (it lives inside the repo).
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return child === parent || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}
function assertSafeTempRoot() {
  const tmp = realpathSync(os.tmpdir());
  const repo = realpathSync(REPO_ROOT);
  const lib = path.join(os.homedir(), "Library");
  assert.ok(!isInside(repo, tmp), `refusing: TMPDIR resolves inside the repo tree (${tmp})`);
  assert.ok(!isInside(lib, tmp), `refusing: TMPDIR resolves inside ~/Library (${tmp})`);
}

// Build a synthetic app-data dir with a REAL sqlite DB (WAL mode) + a documents dir.
function makeSyntheticDataDir(root) {
  const dataDir = path.join(root, "lawbar");
  mkdirSync(path.join(dataDir, "case-box-documents"), { recursive: true });
  const dbPath = path.join(dataDir, "case-box.sqlite");
  execFileSync("sqlite3", [
    dbPath,
    "PRAGMA journal_mode=WAL; CREATE TABLE drill(id INTEGER PRIMARY KEY, note TEXT); " +
      `INSERT INTO drill(note) VALUES('${SYNTHETIC_ROW}');`,
  ]);
  writeFileSync(path.join(dataDir, "case-box-documents", SYNTHETIC_DOC), "SYNTHETIC-DOCUMENT-BYTES");
  return dataDir;
}

test("restore drill: synthetic backup restores into a fresh dir and the DB opens", () => {
  if (!sqlite3Available()) {
    // sqlite3 ships on macOS + the CI runner; if absent, fail loudly rather than skip silently.
    assert.fail("sqlite3 CLI not available — the restore drill cannot verify DB openability.");
  }
  assertSafeTempRoot(); // refuse before creating anything if $TMPDIR is unsafe
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-drill-"));
  try {
    // 1. synthetic source data
    const dataDir = makeSyntheticDataDir(root);
    const outDir = path.join(root, "out");

    // 2. back it up via the existing script (data-dir override; FORCE_LSOF=closed
    //    because the drill just closed the DB — deterministic + no real app running).
    const bk = spawnSync("node", [SCRIPT, "--data-dir", dataDir, "--out", outDir, "--label", "drill"], {
      encoding: "utf8",
      env: { ...process.env, LAWBAR_BACKUP_FORCE_LSOF: "closed" },
    });
    assert.equal(bk.status, 0, `backup should succeed; stderr: ${bk.stderr}`);
    // confidentiality: neither stdout nor stderr names a document filename
    assert.doesNotMatch(bk.stdout + bk.stderr, new RegExp(SYNTHETIC_DOC), "backup must not print document filenames");
    assert.match(bk.stdout, /1 file\(s\)/, "backup reports document counts");

    const archive = path.join(outDir, "lawbar-backup-drill.tar.gz");
    assert.ok(existsSync(archive), "archive was written");

    // 3. restore into a FRESH temp dir (simulates a second Mac / recovery)
    const restoreDir = path.join(root, "restore");
    mkdirSync(restoreDir, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", restoreDir]);

    // 4. expected files exist
    const restoredDb = path.join(restoreDir, "case-box.sqlite");
    assert.ok(existsSync(restoredDb), "restored DB present");
    assert.ok(
      existsSync(path.join(restoreDir, "case-box-documents", SYNTHETIC_DOC)),
      "restored documents dir + placeholder present",
    );

    // 5. SQLite opens AND the synthetic record is readable after restore
    const out = execFileSync("sqlite3", [restoredDb, "SELECT note FROM drill;"], { encoding: "utf8" }).trim();
    assert.equal(out, SYNTHETIC_ROW, "restored DB opens and the synthetic row round-trips");

    // 6. no repo-tree data created: every path the drill used is under os.tmpdir()
    for (const p of [dataDir, outDir, restoreDir, archive]) {
      assert.ok(p.startsWith(os.tmpdir()), `drill path must be under tmp, not the repo: ${p}`);
      assert.ok(!p.startsWith(REPO_ROOT), `drill must not write into the repo tree: ${p}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// WI-04 — backup round-trip EQUALITY, not merely "the database opens".
//
// The drill above proves an archive restores and one synthetic row survives. That is a
// liveness check. It would pass a backup that silently dropped the audit chain, reordered
// events, or lost the most recent commits sitting in an uncheckpointed WAL — and for a
// court-facing tool the audit chain is the claim being made, so "it opens" is the wrong bar.
//
// This case builds a REAL case-box database (17 tables, a genuine audit chain) via the
// persistence package, backs it up, restores it, and compares the two byte-for-byte at the
// logical level with `sqlite3 .dump`. The allowlist of permitted divergences is EMPTY, and
// that is the point: a backup has no licence to change anything. If a future change needs an
// entry here, it needs a justification in the row, not a quiet edit.
//
// The fixture shells out to the persistence package deliberately. The desktop's own
// better-sqlite3 is built for the ELECTRON ABI (NODE_MODULE_VERSION 140) and cannot load
// under plain node — which is the original reason this drill verifies through the sqlite3
// CLI, and it is still correct.

const PERSISTENCE_DIR = path.join(REPO_ROOT, "services", "case-box-persistence");

/** Build a real case box with a real audit chain, using the persistence package's own node. */
function makeRealCaseBox(dataDir) {
  mkdirSync(path.join(dataDir, "case-box-documents"), { recursive: true });
  const dbPath = path.join(dataDir, "case-box.sqlite");
  const build = `
    import { openSqliteCaseBoxPersistence } from "./dist/index.js";
    const r = openSqliteCaseBoxPersistence({ path: ${JSON.stringify(dbPath)} });
    await r.persistence.createMatter({
      id: "01jaaaaaaaaaaaaaaaaaaaamt1", tenant_id: "01jaaaaaaaaaaaaaaaaaaaatn1",
      actor_user_id: "local-user", name: "SYNTHETIC-DRILL-MATTER",
      jurisdiction: { value: "cn-sh", locked: false }, matter_type: "litigation",
      parties: [{ role: "client", display_name: "SYNTHETIC-DRILL-PARTY", party_kind: "organization" }],
      confidentiality_class: "normal", status: "active",
      external_ocr_authorized: false, sync_grant_present: false, llm_extraction_opt_in: false,
      created_at: "2026-05-20T09:00:00.000Z", updated_at: "2026-05-20T09:00:00.000Z",
    });
    r.db.close();
  `;
  const r = spawnSync("node", ["--input-type=module", "-e", build], {
    cwd: PERSISTENCE_DIR, encoding: "utf8",
  });
  assert.equal(r.status, 0, `fixture build failed: ${r.stderr}`);
  // A document row, so the content_hash assertion below compares something. Inserted with
  // the CLI rather than the persistence API on purpose: this drill is about backup fidelity,
  // and the row only has to be real enough to survive a round trip. content_hash lives inside
  // payload_json in this schema, not as a column.
  execFileSync("sqlite3", [dbPath,
    "INSERT INTO case_box_documents(id,tenant_id,matter_id,actor_user_id,status,received_at," +
    "doc_type,payload_json) VALUES('01jaaaaaaaaaaaaaaaaaaaadc1','01jaaaaaaaaaaaaaaaaaaaatn1'," +
    "'01jaaaaaaaaaaaaaaaaaaaamt1','local-user','received','2026-05-20T09:00:00.000Z','other'," +
    `'{"content_hash":"${"a".repeat(64)}","filename":"synthetic.txt"}');`,
  ]);
  writeFileSync(path.join(dataDir, "case-box-documents", SYNTHETIC_DOC), "SYNTHETIC-DOCUMENT-BYTES");
  return dataDir;
}

const sq = (db, sql) => execFileSync("sqlite3", [db, sql], { encoding: "utf8" });

test("WI04 backup round-trip is EQUAL, not merely openable", () => {
  if (!sqlite3Available()) assert.fail("sqlite3 CLI not available — cannot verify equality.");
  assertSafeTempRoot();
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-drill-eq-"));
  try {
    const dataDir = makeRealCaseBox(path.join(root, "lawbar"));
    const srcDb = path.join(dataDir, "case-box.sqlite");

    // Guard the fixture: a drill that compares two EMPTY databases passes trivially.
    const events = Number(sq(srcDb, "SELECT count(*) FROM case_box_audit_events;").trim());
    assert.ok(events > 0, "fixture must actually generate audit events, or this proves nothing");
    const heads = Number(sq(srcDb, "SELECT count(*) FROM case_box_audit_chain_heads;").trim());
    assert.ok(heads > 0, "fixture must record a chain head");

    const outDir = path.join(root, "out");
    const bk = spawnSync("node", [SCRIPT, "--data-dir", dataDir, "--out", outDir, "--label", "eq"], {
      encoding: "utf8", env: { ...process.env, LAWBAR_BACKUP_FORCE_LSOF: "closed" },
    });
    assert.equal(bk.status, 0, `backup should succeed; stderr: ${bk.stderr}`);

    const restoreDir = path.join(root, "restore");
    mkdirSync(restoreDir, { recursive: true });
    execFileSync("tar", ["-xzf", path.join(outDir, "lawbar-backup-eq.tar.gz"), "-C", restoreDir]);
    const dstDb = path.join(restoreDir, "case-box.sqlite");
    assert.ok(existsSync(dstDb), "restored DB present");

    // 1. THE AUDIT HEAD. If this differs the chain did not survive, whatever else matches.
    const headSrc = sq(srcDb, "SELECT * FROM case_box_audit_chain_heads ORDER BY rowid;");
    const headDst = sq(dstDb, "SELECT * FROM case_box_audit_chain_heads ORDER BY rowid;");
    assert.equal(headDst, headSrc, "audit chain head must survive the round trip unchanged");

    // 2. THE EVENT LIST, element-wise and in order. A reordered chain is a broken chain.
    const evSrc = sq(srcDb, "SELECT * FROM case_box_audit_events ORDER BY rowid;");
    const evDst = sq(dstDb, "SELECT * FROM case_box_audit_events ORDER BY rowid;");
    assert.equal(evDst, evSrc, "audit events must be element-wise identical and in the same order");

    // 3. EVERY content_hash. The chain points at exhibits; the exhibits must match too.
    //    Guarded first: comparing two empty tables is a pass that proves nothing, and this
    //    schema keeps content_hash inside payload_json rather than as a column.
    const HASH_SQL = "SELECT id, json_extract(payload_json,'$.content_hash') " +
                     "FROM case_box_documents ORDER BY id;";
    const hSrc = sq(srcDb, HASH_SQL);
    assert.ok(hSrc.trim().length > 0, "fixture must contain at least one document, or this is vacuous");
    assert.match(hSrc, /a{64}/, "and its content_hash must actually be readable");
    assert.equal(sq(dstDb, HASH_SQL), hSrc, "every document content_hash must match after restore");

    // 4. AND EVERYTHING ELSE. The allowlist of fields permitted to diverge is EMPTY: a
    //    backup has no licence to alter anything. `.dump` is logical, so it compares schema
    //    and every row of every table at once, and names the first difference if there is one.
    const ALLOWED_TO_DIVERGE = [];   // keep empty; an entry needs a justification in the row
    assert.equal(ALLOWED_TO_DIVERGE.length, 0,
      "if this is non-empty, say in wi-queue.md Notes why a backup may change that field");
    const dumpSrc = sq(srcDb, ".dump").split("\n");
    const dumpDst = sq(dstDb, ".dump").split("\n");
    const firstDiff = dumpSrc.findIndex((l, i) => l !== dumpDst[i]);
    assert.equal(
      firstDiff, -1,
      firstDiff === -1 ? "" :
        `restored database diverges at dump line ${firstDiff + 1}:\n` +
        `  source:   ${dumpSrc[firstDiff]}\n  restored: ${dumpDst[firstDiff]}`,
    );
    assert.equal(dumpDst.length, dumpSrc.length, "restored dump must have the same number of lines");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// GAP 1 — recorded as a todo so it surfaces on every lane run rather than sitting in prose.
//
// The backup script DOES copy the -wal/-shm sidecars (backup-local-data.mjs), so this is a
// COVERAGE gap, not a correctness one: no test exercises that path. Removing the sidecar loop
// from the script still passes the suite, which was confirmed by mutation.
//
// What blocks it: producing a genuinely hot WAL in a fixture. Closing the database
// checkpoints it, and the CLI closes cleanly on exit, so the obvious fixtures all leave the
// sidecars empty or absent. It needs a process killed mid-transaction, which is more fixture
// engineering than WI-04's three stated criteria justified.
test("GAP-1 a backup captures uncheckpointed WAL data", { todo: "needs a fixture that leaves a hot WAL; see WI-04 notes" }, () => {});
