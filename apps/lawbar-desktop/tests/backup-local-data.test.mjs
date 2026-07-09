// backup-local-data.test.mjs — behavior of scripts/backup-local-data.mjs
// (WI-DESKTOP-LOCAL-DATA-BACKUP-RESTORE-11). Uses temp dirs only — never touches
// the real ~/Library/Application Support/lawbar. Proves: happy-path packaging of
// the WAL-mode file set + documents, the --allow-running warning, refusal while
// the store is in use, a missing DB, an unsafe --out (textual + symlink-resolved),
// label path-traversal rejection, a missing option value, archive collision, and
// that no document filename leaks to stdout OR to stderr on a tar failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "backup-local-data.mjs");
const CONFIDENTIAL = "matter-A-confidential.pdf";

function makeDataDir({ withWal = true, docName = CONFIDENTIAL } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-bkup-"));
  const dataDir = path.join(root, "lawbar");
  mkdirSync(path.join(dataDir, "case-box-documents"), { recursive: true });
  writeFileSync(path.join(dataDir, "case-box.sqlite"), "SQLITE_MAIN_FIXTURE");
  if (withWal) {
    writeFileSync(path.join(dataDir, "case-box.sqlite-wal"), "WAL_FIXTURE");
    writeFileSync(path.join(dataDir, "case-box.sqlite-shm"), "SHM_FIXTURE");
  }
  if (docName) writeFileSync(path.join(dataDir, "case-box-documents", docName), "DOC_BYTES");
  return { root, dataDir };
}

function run(args, env = {}) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("happy path: packages DB + WAL/SHM sidecars + documents into a tar.gz", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit", "--allow-running"]);
  assert.equal(r.status, 0, `expected exit 0; stderr: ${r.stderr}`);
  const archive = path.join(out, "lawbar-backup-unit.tar.gz");
  const entries = execFileSync("tar", ["-tzf", archive]).toString().split("\n").filter(Boolean).sort();
  assert.ok(entries.includes("case-box.sqlite"), "archive must contain the DB");
  assert.ok(entries.includes("case-box.sqlite-wal"), "archive must contain the WAL sidecar");
  assert.ok(entries.includes("case-box.sqlite-shm"), "archive must contain the SHM sidecar");
  assert.ok(entries.some((e) => e.startsWith("case-box-documents")), "archive must contain the documents dir");
  rmSync(root, { recursive: true, force: true });
});

test("confidentiality: stdout never leaks a document filename", () => {
  const { root, dataDir } = makeDataDir({ docName: CONFIDENTIAL });
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit", "--allow-running"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /confidential\.pdf|matter-A/, "must not print document filenames");
  assert.match(r.stdout, /1 file\(s\)/, "reports counts instead");
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 2) while the store is IN USE and --allow-running is absent", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit"], { LAWBAR_BACKUP_ASSUME_RUNNING: "1" });
  assert.equal(r.status, 2, "must refuse while in use");
  assert.match(r.stderr, /IN USE/, "must explain the in-use refusal");
  rmSync(root, { recursive: true, force: true });
});

test("--allow-running bypasses the in-use check but emits a WARNING", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit", "--allow-running"], { LAWBAR_BACKUP_ASSUME_RUNNING: "1" });
  assert.equal(r.status, 0, `override should proceed; stderr: ${r.stderr}`);
  assert.match(r.stderr, /WARNING --allow-running/, "override must warn about a possibly inconsistent copy");
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 1) when there is no case-box.sqlite", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-bkup-"));
  const dataDir = path.join(root, "lawbar");
  mkdirSync(dataDir, { recursive: true });
  const r = run(["--data-dir", dataDir, "--out", path.join(root, "backups"), "--label", "unit", "--allow-running"]);
  assert.equal(r.status, 1, "must refuse with no DB");
  assert.match(r.stderr, /no case-box\.sqlite/, "must explain the missing DB");
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 2) when --out is inside the data directory (textual)", () => {
  const { root, dataDir } = makeDataDir();
  const r = run(["--data-dir", dataDir, "--out", path.join(dataDir, "nested"), "--label", "unit", "--allow-running"]);
  assert.equal(r.status, 2, "must refuse an --out inside the data dir");
  assert.match(r.stderr, /inside the data directory/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 2) when a symlinked --out RESOLVES inside the data dir", () => {
  const { root, dataDir } = makeDataDir();
  // real target sits inside the data dir; a symlink outside points at it.
  const realTarget = path.join(dataDir, "sneaky");
  mkdirSync(realTarget, { recursive: true });
  const link = path.join(root, "outlink");
  symlinkSync(realTarget, link);
  const r = run(["--data-dir", dataDir, "--out", link, "--label", "unit", "--allow-running"]);
  assert.equal(r.status, 2, "must refuse a symlinked --out that resolves inside the data dir");
  assert.match(r.stderr, /resolves inside the data directory/);
  rmSync(root, { recursive: true, force: true });
});

test("rejects (exit 1) a --label with path separators / traversal", () => {
  const { root, dataDir } = makeDataDir();
  const r = run(["--data-dir", dataDir, "--out", path.join(root, "backups"), "--label", "x/../../evil", "--allow-running"]);
  assert.equal(r.status, 1, "must reject an unsafe label");
  assert.match(r.stderr, /--label must be filename-safe/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 1) when a value-taking flag has no value", () => {
  const { root, dataDir } = makeDataDir();
  const r = run(["--data-dir", dataDir, "--out"]); // --out dangling
  assert.equal(r.status, 1, "must refuse a dangling option");
  assert.match(r.stderr, /--out requires a value/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 1) when the archive already exists (collision)", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const first = run(["--data-dir", dataDir, "--out", out, "--label", "dup", "--allow-running"]);
  assert.equal(first.status, 0);
  const second = run(["--data-dir", dataDir, "--out", out, "--label", "dup", "--allow-running"]);
  assert.equal(second.status, 1, "must refuse to overwrite an existing archive");
  assert.match(second.stderr, /already exists/);
  rmSync(root, { recursive: true, force: true });
});

test("tar failure: generic message, no document filename leaks to stderr", () => {
  const { root, dataDir } = makeDataDir({ docName: CONFIDENTIAL });
  const out = path.join(root, "ro-backups");
  mkdirSync(out, { recursive: true });
  chmodSync(out, 0o555); // read-only => tar cannot create the archive
  try {
    const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit", "--allow-running"]);
    assert.equal(r.status, 1, "a tar write failure is a controlled exit 1");
    assert.match(r.stderr, /failed to create the archive/, "must report a generic failure");
    assert.doesNotMatch(r.stderr, /confidential\.pdf|matter-A/, "must not leak document filenames on failure");
  } finally {
    chmodSync(out, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses (exit 1) when the data dir does not exist", () => {
  const r = run(["--data-dir", "/nonexistent/lawbar-xyz", "--out", os.tmpdir(), "--label", "unit", "--allow-running"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /data directory not found/);
});
