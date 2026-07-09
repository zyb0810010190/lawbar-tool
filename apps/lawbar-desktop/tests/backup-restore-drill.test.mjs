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
