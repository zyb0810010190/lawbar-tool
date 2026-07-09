#!/usr/bin/env node
// backup-local-data.mjs — safe local backup of the lawbar case-box data store
// (WI-DESKTOP-LOCAL-DATA-BACKUP-RESTORE-11). Local-first: this only copies files
// on this Mac into a timestamped archive. NO cloud, NO network, NO remote.
//
// The DB is SQLite in WAL mode (journal_mode=WAL), so a consistent file-copy
// requires that NOTHING holds the DB open — a live copy can capture a half-written
// WAL. This script therefore REFUSES to run while the DB is in use, detected
// (strongest first) by an OPEN-FILE-HANDLE check (`lsof`) on the DB / -wal / -shm
// paths, falling back to an app-process match (`pgrep`); if NEITHER check can run
// it FAILS CLOSED (refuses) rather than risk an inconsistent copy. An expert who
// has otherwise quiesced the DB may override with --allow-running (which then emits
// a loud warning). The -wal / -shm sidecars are included when present so SQLite can
// recover a consistent snapshot on restore.
//
// Confidentiality: it never prints document filenames or DB contents — only the
// data-dir path, the archive path, file COUNTS, and sizes. On a tar failure it
// prints a GENERIC message (tar's stderr, which can name archived files, is
// suppressed).
//
// Usage:
//   node scripts/backup-local-data.mjs [--data-dir <dir>] [--out <dir>]
//       [--label <name>] [--allow-running]
//   npm run backup:local -- --out ~/Desktop
//
// Defaults: --data-dir = ~/Library/Application Support/lawbar ; --out = cwd.
// --label must be filename-safe ([A-Za-z0-9._-]; no path separators).
// Exit codes: 0 ok · 1 usage/data error · 2 refused (in use / unsafe out dir).

import { existsSync, statSync, mkdirSync, readdirSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const DB_FILENAME = "case-box.sqlite";
const DOCS_DIRNAME = "case-box-documents";
const LABEL_RE = /^[A-Za-z0-9._-]+$/; // filename-safe; no "/" or ".." traversal

function log(msg) { process.stdout.write(msg + "\n"); }
function warn(msg) { process.stderr.write(msg + "\n"); }
function errExit(code, msg) { process.stderr.write(msg + "\n"); process.exit(code); }

// A value-taking flag must be followed by a real value (not the end of argv and
// not another --flag). Prevents `--out --label x` silently eating "--label" and
// `--data-dir` at the end silently becoming undefined.
function needVal(argv, i, name) {
  const v = argv[i];
  if (v === undefined || (typeof v === "string" && v.startsWith("--")))
    errExit(1, `backup: ${name} requires a value.`);
  return v;
}

function parseArgs(argv) {
  const out = { dataDir: null, outDir: null, label: null, allowRunning: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir") out.dataDir = needVal(argv, ++i, "--data-dir");
    else if (a === "--out") out.outDir = needVal(argv, ++i, "--out");
    else if (a === "--label") out.label = needVal(argv, ++i, "--label");
    else if (a === "--allow-running") out.allowRunning = true;
    else errExit(1, `backup: unknown argument ${JSON.stringify(a)}`);
  }
  return out;
}

// Default macOS userData for productName "lawbar".
function defaultDataDir() {
  return path.join(os.homedir(), "Library", "Application Support", "lawbar");
}

// Is any process holding one of the DB files open? Strongest signal for WAL
// safety. Returns { checked, open }. `lsof <paths>`: exit 0 => a holder exists;
// exit 1 => none; ENOENT/other => lsof unavailable (checked:false). Paths are
// absolute (leading "/"), so there is no dash-injection risk without a "--".
function lsofOpen(files) {
  try {
    execFileSync("lsof", [...files], { stdio: "ignore" });
    return { checked: true, open: true }; // exit 0 => at least one open handle
  } catch (e) {
    if (e && e.status === 1) return { checked: true, open: false }; // no holders
    return { checked: false, open: false }; // lsof not present / usage error
  }
}

// Fallback signal: is a lawbar app process running? Returns { checked, running }.
function pgrepLawbar() {
  try {
    execFileSync("pgrep", ["-f", "lawbar.app/Contents/MacOS/lawbar"], { stdio: "ignore" });
    return { checked: true, running: true };
  } catch (e) {
    if (e && e.status === 1) return { checked: true, running: false };
    return { checked: false, running: false };
  }
}

// Decide whether the data store is in use. Fail CLOSED: if no check can run,
// report in-use so the caller refuses (unless --allow-running). LAWBAR_BACKUP_
// ASSUME_RUNNING=1 forces "in use" (used by the refusal test).
function detectInUse(dbFiles) {
  if (process.env.LAWBAR_BACKUP_ASSUME_RUNNING === "1")
    return { inUse: true, reason: "forced (LAWBAR_BACKUP_ASSUME_RUNNING)" };
  const l = lsofOpen(dbFiles);
  if (l.checked)
    return { inUse: l.open, reason: l.open ? "a process holds the database open" : null };
  const p = pgrepLawbar();
  if (p.checked)
    return { inUse: p.running, reason: p.running ? "the lawbar app is running" : null };
  return { inUse: true, reason: "cannot verify the app is closed (lsof and pgrep unavailable) — fail-closed" };
}

function dirSize(dir) {
  let bytes = 0, files = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else { bytes += st.size; files += 1; }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { bytes, files };
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

// --- refuse while the data store is in use (WAL-mode: a live copy can be inconsistent) ---
const use = detectInUse(dbFiles);
if (use.inUse && !args.allowRunning)
  errExit(2, `backup: the case-box data store appears IN USE (${use.reason}). Quit lawbar first, then re-run — the DB is WAL-mode and a live file copy can be inconsistent. (Expert override: --allow-running, only if the app is quiesced.)`);
if (use.inUse && args.allowRunning)
  warn(`backup: WARNING --allow-running: proceeding while the data store appears IN USE (${use.reason}). The WAL-mode copy may be INCONSISTENT; only trust this backup if you have otherwise quiesced the DB.`);

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

// --- report (counts + sizes only; NO document filenames / DB contents) ---
const dbBytes = statSync(dbPath).size;
const walPath = path.join(dataDir, `${DB_FILENAME}-wal`);
const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
const docs = hasDocs ? dirSize(docsPath) : { bytes: 0, files: 0 };
const archiveBytes = statSync(archive).size;
let sha = "(shasum unavailable)";
try { sha = execFileSync("shasum", ["-a", "256", archive]).toString().split(" ")[0]; } catch { /* optional */ }

log("");
log("lawbar local backup — OK");
log(`  data dir : ${dataDir}`);
log(`  database : ${DB_FILENAME} (${human(dbBytes)})${walBytes ? ` + WAL (${human(walBytes)})` : ""}`);
log(`  documents: ${docs.files} file(s), ${human(docs.bytes)}`);
log(`  archive  : ${archive} (${human(archiveBytes)})`);
log(`  sha256   : ${sha}`);
log("");
log("Restore: quit lawbar, back up the current data dir, then extract this archive");
log(`  into ${dataDir} (see dev-memo/desktop-local-data-backup-restore.md §Restore).`);
