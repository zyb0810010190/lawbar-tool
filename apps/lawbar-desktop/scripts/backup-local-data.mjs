#!/usr/bin/env node
// backup-local-data.mjs — safe local backup of the lawbar case-box data store
// (WI-DESKTOP-LOCAL-DATA-BACKUP-RESTORE-11; hardened by WI-BACKUP-HARDEN-11-FIX1).
// Local-first: this only copies files on this Mac into a timestamped archive.
// NO cloud, NO network, NO remote.
//
// SAFETY MODEL (fail-closed). The DB is SQLite in WAL mode, so a consistent
// file-copy requires that NOTHING holds it open:
//   * lsof proves an OPEN handle on the DB / -wal / -shm  -> REFUSE (exit 2).
//     This is NOT overridable — copying an open WAL DB risks an inconsistent,
//     unusable backup of confidential data.
//   * lsof proves the files are CLOSED                    -> proceed.
//   * lsof cannot run / is inconclusive                   -> REFUSE (exit 2)
//     unless the caller passes the explicit, deliberately-verbose acknowledgement
//     flag AND no app process is detected. pgrep is ADVISORY ONLY: it can
//     strengthen a refusal (app clearly running) but NEVER grants clearance
//     (a quiet app list is not proof that the DB files are closed).
//
// The -wal / -shm sidecars are included when present so SQLite can recover a
// consistent snapshot on restore.
//
// Confidentiality: it never prints document filenames or DB contents — only the
// data-dir path, the archive path, file COUNTS, and sizes. tar stderr is
// suppressed (it can name archived files) and post-archive reporting is
// exception-safe (a broken symlink / permission error can NOT leak a document
// path through a Node stack trace).
//
// Usage:
//   node scripts/backup-local-data.mjs [--data-dir <dir>] [--out <dir>]
//       [--label <name>] [--i-understand-this-may-create-an-inconsistent-confidential-backup]
//   npm run backup:local -- --out ~/Desktop
//
// Defaults: --data-dir = ~/Library/Application Support/lawbar ; --out = cwd.
// --label must be filename-safe ([A-Za-z0-9._-]; no path separators).
// Exit codes: 0 ok · 1 usage/data error · 2 refused (open/unverifiable / unsafe out dir).

import { existsSync, statSync, mkdirSync, readdirSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const DB_FILENAME = "case-box.sqlite";
const DOCS_DIRNAME = "case-box-documents";
const LABEL_RE = /^[A-Za-z0-9._-]+$/; // filename-safe; no "/" or ".." traversal
// Deliberately verbose so it can never be added casually/habitually. It ONLY
// applies when lsof cannot run (unverifiable state) — it can NEVER bypass a
// positive open-handle finding.
const UNSAFE_FLAG = "--i-understand-this-may-create-an-inconsistent-confidential-backup";

function log(msg) { process.stdout.write(msg + "\n"); }
function warn(msg) { process.stderr.write(msg + "\n"); }
function errExit(code, msg) { process.stderr.write(msg + "\n"); process.exit(code); }

// A value-taking flag must be followed by a real value (not the end of argv and
// not another --flag).
function needVal(argv, i, name) {
  const v = argv[i];
  if (v === undefined || (typeof v === "string" && v.startsWith("--")))
    errExit(1, `backup: ${name} requires a value.`);
  return v;
}

function parseArgs(argv) {
  const out = { dataDir: null, outDir: null, label: null, forceUnverified: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir") out.dataDir = needVal(argv, ++i, "--data-dir");
    else if (a === "--out") out.outDir = needVal(argv, ++i, "--out");
    else if (a === "--label") out.label = needVal(argv, ++i, "--label");
    else if (a === UNSAFE_FLAG) out.forceUnverified = true;
    else errExit(1, `backup: unknown argument ${JSON.stringify(a)}`);
  }
  return out;
}

// Default macOS userData for productName "lawbar".
function defaultDataDir() {
  return path.join(os.homedir(), "Library", "Application Support", "lawbar");
}

// AUTHORITATIVE open-handle check. Returns { checked, open }: checked=true means
// lsof ran and its result is trustworthy (exit 0 => a holder exists; exit 1 =>
// none); checked=false means lsof could not run (unavailable / usage error) and
// the state is UNPROVEN. Paths are absolute, so no dash-injection risk.
// LAWBAR_BACKUP_FORCE_LSOF=open|closed|unavailable forces a result (tests).
function lsofOpen(files) {
  const forced = process.env.LAWBAR_BACKUP_FORCE_LSOF;
  if (forced === "open") return { checked: true, open: true };
  if (forced === "closed") return { checked: true, open: false };
  if (forced === "unavailable") return { checked: false, open: false };
  try {
    execFileSync("lsof", [...files], { stdio: "ignore" });
    return { checked: true, open: true }; // exit 0 => at least one open handle
  } catch (e) {
    if (e && e.status === 1) return { checked: true, open: false }; // no holders
    return { checked: false, open: false }; // lsof not present / usage error
  }
}

// ADVISORY ONLY. Returns { checked, running }. A "running" result strengthens a
// refusal; a "not running" result is NEVER clearance (another process could hold
// the DB open). LAWBAR_BACKUP_FORCE_PGREP=running|clear|unavailable forces (tests).
function pgrepLawbar() {
  const forced = process.env.LAWBAR_BACKUP_FORCE_PGREP;
  if (forced === "running") return { checked: true, running: true };
  if (forced === "clear") return { checked: true, running: false };
  if (forced === "unavailable") return { checked: false, running: false };
  try {
    execFileSync("pgrep", ["-f", "lawbar.app/Contents/MacOS/lawbar"], { stdio: "ignore" });
    return { checked: true, running: true };
  } catch (e) {
    if (e && e.status === 1) return { checked: true, running: false };
    return { checked: false, running: false };
  }
}

// Exception-safe recursive size. NEVER throws and NEVER includes a path/name in
// any output — unreadable entries (broken symlinks, permission errors) are
// counted as `skipped` without naming them.
function dirSize(dir) {
  let bytes = 0, files = 0, skipped = 0;
  const walk = (d) => {
    let names;
    try { names = readdirSync(d); } catch { skipped += 1; return; }
    for (const name of names) {
      const p = path.join(d, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else { bytes += st.size; files += 1; }
      } catch { skipped += 1; } // broken symlink / permission — skip, no name leaked
    }
  };
  try { if (existsSync(dir)) walk(dir); } catch { skipped += 1; }
  return { bytes, files, skipped };
}

function human(bytes) {
  const u = ["B", "KB", "MB", "GB"]; let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Is `child` the same path as, or nested inside, `parent`? (both already resolved)
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return child === parent || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

const args = parseArgs(process.argv.slice(2));
if (args.label != null && !LABEL_RE.test(args.label))
  errExit(1, `backup: --label must be filename-safe [A-Za-z0-9._-] (no path separators); got ${JSON.stringify(args.label)}.`);

const dataDir = path.resolve(args.dataDir ?? defaultDataDir());
const outDir = path.resolve(args.outDir ?? process.cwd());

// --- validate data dir + DB ---
if (!existsSync(dataDir) || !statSync(dataDir).isDirectory())
  errExit(1, `backup: data directory not found: ${dataDir}\n  (expected the app's userData dir; pass --data-dir to override).`);
const dbPath = path.join(dataDir, DB_FILENAME);
if (!existsSync(dbPath))
  errExit(1, `backup: no ${DB_FILENAME} in ${dataDir} — nothing to back up (has the app ever run?).`);

// --- refuse unsafe output locations (never inside the data dir) — textual guard ---
if (isInside(dataDir, outDir))
  errExit(2, `backup: --out ${outDir} is inside the data directory; choose a different location (e.g. ~/Desktop).`);

// --- assemble the consistent file set (DB + WAL/SHM sidecars if present + docs) ---
const dbFiles = [dbPath];
for (const side of [`${DB_FILENAME}-wal`, `${DB_FILENAME}-shm`]) {
  const p = path.join(dataDir, side);
  if (existsSync(p)) dbFiles.push(p);
}
const entries = dbFiles.map((p) => path.basename(p));
const docsPath = path.join(dataDir, DOCS_DIRNAME);
const hasDocs = existsSync(docsPath) && statSync(docsPath).isDirectory();
if (hasDocs) entries.push(DOCS_DIRNAME);

// --- WAL-safety gate (fail-closed) ------------------------------------------
// 1. Positive open handle -> ALWAYS refuse (not overridable).
const lsof = lsofOpen(dbFiles);
if (lsof.checked && lsof.open)
  errExit(2, `backup: the case-box data store is OPEN — a process is holding the database. Quit lawbar and retry. This is NOT overridable: copying an open WAL-mode DB risks an inconsistent, unusable backup of confidential data.`);
// 2. lsof could NOT prove the files are closed -> unverifiable -> fail closed.
if (!lsof.checked) {
  const pg = pgrepLawbar(); // advisory only
  if (pg.checked && pg.running)
    errExit(2, `backup: cannot run the open-handle check (lsof unavailable) and the lawbar app appears to be RUNNING. Refusing. Quit lawbar and retry on a system with lsof.`);
  if (!args.forceUnverified)
    errExit(2, `backup: cannot verify the data store is closed (lsof unavailable; no open-handle proof). Refusing (fail-closed). Only if you have DEFINITELY quit lawbar, re-run with ${UNSAFE_FLAG}.`);
  warn(`backup: WARNING ${UNSAFE_FLAG}: proceeding WITHOUT an open-handle check (lsof unavailable). The WAL-mode copy may be INCONSISTENT; only trust this backup if lawbar is definitely quit.`);
}
// else: lsof.checked && !lsof.open -> proven closed -> proceed.

// --- output dir + realpath containment re-check (symlinked --out cannot escape into dataDir) ---
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const realOut = realpathSync(outDir);
const realData = realpathSync(dataDir);
if (isInside(realData, realOut))
  errExit(2, `backup: --out resolves inside the data directory (${realOut}); choose a different location.`);

// --- output archive (label is filename-safe; basename-guarded) ---
const label = args.label ?? new Date().toISOString().replace(/[:.]/g, "-");
const archive = path.join(realOut, `lawbar-backup-${path.basename(label)}.tar.gz`);
if (existsSync(archive)) errExit(1, `backup: archive already exists: ${archive} (choose a different --label/--out).`);

// tar the entries relative to the data dir (so restore extracts back into it).
// Suppress tar's stderr: on error it can print archived (document) paths.
try {
  execFileSync("tar", ["-czf", archive, "-C", dataDir, ...entries], { stdio: ["ignore", "ignore", "ignore"] });
} catch {
  if (existsSync(archive)) { try { rmSync(archive, { force: true }); } catch { /* best effort */ } }
  errExit(1, `backup: failed to create the archive (tar error). No archive was written; check permissions and free space. (Details suppressed to avoid leaking file names.)`);
}

// --- report (counts + sizes only; NO document filenames / DB contents) -------
// Fully exception-safe: the archive is already written, so a reporting failure
// must NOT crash with a Node stack (which could name a document path).
try {
  const safeStat = (p) => { try { return existsSync(p) ? statSync(p).size : 0; } catch { return -1; } };
  const dbBytes = safeStat(dbPath);
  const walBytes = safeStat(path.join(dataDir, `${DB_FILENAME}-wal`));
  const docs = hasDocs ? dirSize(docsPath) : { bytes: 0, files: 0, skipped: 0 };
  const archiveBytes = safeStat(archive);
  let sha = "(shasum unavailable)";
  try { sha = execFileSync("shasum", ["-a", "256", archive]).toString().split(" ")[0]; } catch { /* optional */ }

  const size = (b) => (b < 0 ? "(size unavailable)" : human(b));
  const skippedNote = docs.skipped > 0 ? ` (${docs.skipped} unreadable, skipped)` : "";
  log("");
  log("lawbar local backup — OK");
  log(`  data dir : ${dataDir}`);
  log(`  database : ${DB_FILENAME} (${size(dbBytes)})${walBytes > 0 ? ` + WAL (${size(walBytes)})` : ""}`);
  log(`  documents: ${docs.files} file(s), ${size(docs.bytes)}${skippedNote}`);
  log(`  archive  : ${archive} (${size(archiveBytes)})`);
  log(`  sha256   : ${sha}`);
} catch {
  // Never leak a path in a reporting error; the archive is already on disk.
  log("");
  log("lawbar local backup — archive written; summary unavailable.");
  log(`  archive  : ${archive}`);
}
log("");
log("Restore: quit lawbar, back up the current data dir, then extract this archive");
log(`  into ${dataDir} (see dev-memo/desktop-local-data-backup-restore.md §Restore).`);
