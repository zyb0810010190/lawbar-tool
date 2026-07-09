// backup-local-data.test.mjs — behavior of scripts/backup-local-data.mjs
// (WI-DESKTOP-LOCAL-DATA-BACKUP-RESTORE-11; hardened by WI-BACKUP-HARDEN-11-FIX1).
// Uses temp dirs only — never touches the real ~/Library/Application Support/lawbar.
//
// The WAL-safety gate is fail-closed:
//   * lsof proves OPEN  -> refuse, NOT overridable.
//   * lsof proves CLOSED -> proceed.
//   * lsof unavailable   -> refuse unless the explicit unsafe flag AND pgrep is
//                           not "running"; pgrep is advisory only, never clearance.
// Detection is driven in tests via LAWBAR_BACKUP_FORCE_LSOF / _FORCE_PGREP.

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
const UNSAFE_FLAG = "--i-understand-this-may-create-an-inconsistent-confidential-backup";
const CLOSED = { LAWBAR_BACKUP_FORCE_LSOF: "closed" };

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

test("proven-closed via REAL lsof: backup proceeds with no override flag", () => {
  // No FORCE env -> real lsof; a temp DB no process holds open resolves to CLOSED.
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "real"]);
  assert.equal(r.status, 0, `expected exit 0 on a closed DB; stderr: ${r.stderr}`);
  rmSync(root, { recursive: true, force: true });
});

test("packages DB + WAL/SHM sidecars + documents into a tar.gz", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit"], CLOSED);
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
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit"], CLOSED);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /confidential\.pdf|matter-A/, "must not print document filenames");
  assert.match(r.stdout, /1 file\(s\)/, "reports counts instead");
  rmSync(root, { recursive: true, force: true });
});

test("OPEN handle (lsof): refuses (exit 2) and is NOT overridable", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const env = { LAWBAR_BACKUP_FORCE_LSOF: "open" };
  const plain = run(["--data-dir", dataDir, "--out", out, "--label", "unit"], env);
  assert.equal(plain.status, 2, "an open handle must refuse");
  assert.match(plain.stderr, /OPEN/, "must explain the open-handle refusal");
  // the unsafe flag must NOT bypass a positive open finding
  const forced = run(["--data-dir", dataDir, "--out", out, "--label", "unit", UNSAFE_FLAG], env);
  assert.equal(forced.status, 2, "the unsafe flag must NOT override a positive open handle");
  assert.match(forced.stderr, /NOT overridable/);
  rmSync(root, { recursive: true, force: true });
});

test("lsof unavailable + no flag: fails closed (exit 2)", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit"],
    { LAWBAR_BACKUP_FORCE_LSOF: "unavailable", LAWBAR_BACKUP_FORCE_PGREP: "clear" });
  assert.equal(r.status, 2, "unverifiable state must fail closed");
  assert.match(r.stderr, /cannot verify the data store is closed/);
  rmSync(root, { recursive: true, force: true });
});

test("lsof unavailable + unsafe flag + pgrep clear: proceeds with WARNING", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit", UNSAFE_FLAG],
    { LAWBAR_BACKUP_FORCE_LSOF: "unavailable", LAWBAR_BACKUP_FORCE_PGREP: "clear" });
  assert.equal(r.status, 0, `explicit override should proceed; stderr: ${r.stderr}`);
  assert.match(r.stderr, /WARNING/, "override must warn about a possibly inconsistent copy");
  rmSync(root, { recursive: true, force: true });
});

test("lsof unavailable + unsafe flag but pgrep says RUNNING: still refuses (exit 2)", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit", UNSAFE_FLAG],
    { LAWBAR_BACKUP_FORCE_LSOF: "unavailable", LAWBAR_BACKUP_FORCE_PGREP: "running" });
  assert.equal(r.status, 2, "pgrep 'running' must veto the override");
  assert.match(r.stderr, /RUNNING/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 1) when there is no case-box.sqlite", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lawbar-bkup-"));
  const dataDir = path.join(root, "lawbar");
  mkdirSync(dataDir, { recursive: true });
  const r = run(["--data-dir", dataDir, "--out", path.join(root, "backups"), "--label", "unit"], CLOSED);
  assert.equal(r.status, 1, "must refuse with no DB");
  assert.match(r.stderr, /no case-box\.sqlite/, "must explain the missing DB");
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 2) when --out is inside the data directory (textual)", () => {
  const { root, dataDir } = makeDataDir();
  const r = run(["--data-dir", dataDir, "--out", path.join(dataDir, "nested"), "--label", "unit"], CLOSED);
  assert.equal(r.status, 2, "must refuse an --out inside the data dir");
  assert.match(r.stderr, /inside the data directory/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 2) when a symlinked --out RESOLVES inside the data dir", () => {
  const { root, dataDir } = makeDataDir();
  const realTarget = path.join(dataDir, "sneaky");
  mkdirSync(realTarget, { recursive: true });
  const link = path.join(root, "outlink");
  symlinkSync(realTarget, link);
  const r = run(["--data-dir", dataDir, "--out", link, "--label", "unit"], CLOSED);
  assert.equal(r.status, 2, "must refuse a symlinked --out that resolves inside the data dir");
  assert.match(r.stderr, /resolves inside the data directory/);
  rmSync(root, { recursive: true, force: true });
});

test("rejects (exit 1) a --label with path separators / traversal", () => {
  const { root, dataDir } = makeDataDir();
  const r = run(["--data-dir", dataDir, "--out", path.join(root, "backups"), "--label", "x/../../evil"], CLOSED);
  assert.equal(r.status, 1, "must reject an unsafe label");
  assert.match(r.stderr, /--label must be filename-safe/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 1) when a value-taking flag has no value", () => {
  const { root, dataDir } = makeDataDir();
  const r = run(["--data-dir", dataDir, "--out"], CLOSED); // --out dangling
  assert.equal(r.status, 1, "must refuse a dangling option");
  assert.match(r.stderr, /--out requires a value/);
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 1) when the archive already exists (collision)", () => {
  const { root, dataDir } = makeDataDir();
  const out = path.join(root, "backups");
  const first = run(["--data-dir", dataDir, "--out", out, "--label", "dup"], CLOSED);
  assert.equal(first.status, 0);
  const second = run(["--data-dir", dataDir, "--out", out, "--label", "dup"], CLOSED);
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
    const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit"], CLOSED);
    assert.equal(r.status, 1, "a tar write failure is a controlled exit 1");
    assert.match(r.stderr, /failed to create the archive/, "must report a generic failure");
    assert.doesNotMatch(r.stderr, /confidential\.pdf|matter-A/, "must not leak document filenames on failure");
  } finally {
    chmodSync(out, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("post-tar reporting: a broken symlink in documents never leaks its path", () => {
  const { root, dataDir } = makeDataDir({ docName: CONFIDENTIAL });
  // a broken symlink whose target name is itself sensitive; statSync() would
  // otherwise throw ENOENT containing this name.
  const secret = "super-secret-doc.pdf";
  symlinkSync(path.join(dataDir, "case-box-documents", secret),
    path.join(dataDir, "case-box-documents", "link.pdf"));
  const out = path.join(root, "backups");
  const r = run(["--data-dir", dataDir, "--out", out, "--label", "unit"], CLOSED);
  assert.equal(r.status, 0, `archive should still be written; stderr: ${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /super-secret-doc/, "a reporting error must not leak a document path");
  assert.match(r.stdout, /unreadable, skipped/, "should note the skipped entry without naming it");
  rmSync(root, { recursive: true, force: true });
});

test("refuses (exit 1) when the data dir does not exist", () => {
  const r = run(["--data-dir", "/nonexistent/lawbar-xyz", "--out", os.tmpdir(), "--label", "unit"], CLOSED);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /data directory not found/);
});
