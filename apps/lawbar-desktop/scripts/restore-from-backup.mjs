#!/usr/bin/env node
// restore-from-backup.mjs — restore an in-app backup archive into a FRESH application profile.
//
// SCOPE, STATED PLAINLY SO IT IS NOT OVERCLAIMED. This is a controlled command-line entry point.
// There is NO user-facing restore UI in the app: an owner cannot restore from inside lawbar
// today. What this provides is a restore path that is executable, testable and capable of
// FAILING, so the archive format the app now produces can be shown to be restorable rather than
// merely well-formed. Building the owner-facing flow is separate work.
//
// WHY RESTORE IS A SEPARATE PROGRAM FROM BACKUP. Backup runs inside the app, against a database
// the app already has open. Restore runs when there is no app state to speak of, and its most
// dangerous possible behaviour is writing over a case box that is still there. So this refuses to
// write into any directory that already holds one, and it never resolves a default path: the
// destination is always named explicitly by the caller.
//
// ---------------------------------------------------------------------------
// THE MISTAKE THIS FILE MADE FIRST, because it is the same one twice.
// ---------------------------------------------------------------------------
//
// The first version verified the archive by re-hashing the database file and every document THE
// MANIFEST LISTED. It never opened the database. An external review reproduced three consequences
// on 2026-09-06:
//
//   * a manifest with `documents: []` restored "successfully" while the restored database still
//     held document rows whose files had never been copied. The manifest decided what was
//     checked, so its omissions could not be detected;
//   * an archive written by the PRE-FIX backup engine — one carrying a broken audit chain, the
//     exact defect the preceding work made unwritable going forward — restored clean. Both
//     engines stamp `manifestVersion: 1`, so "a manifest exists" cannot mean "this was verified"
//     for any archive already sitting on a shelf;
//   * `databaseFile` was only type-checked, so a manifest could name a path outside the archive,
//     or a symlink — and `cpSync` copies a symlink AS a symlink, so the restored profile's
//     `case-box.sqlite` became a link to a file that was never in the backup.
//
// That is the SAME defect the backup engine had, moved one step downstream: a cheap proxy standing
// in for a check the product already owns. So restore now opens the archive and runs `verifyBackup`
// — the backup engine's own full verification: integrity_check, every audit chain over the union of
// matters, every document row parsed and re-hashed at its derived path, manifest-to-database
// cross-reference. There is no second, weaker verifier here to drift out of step with it.
//
// A manifest is a CLAIM BY THE ARCHIVE ABOUT ITSELF. Restoring is where that claim is checked
// against the database and the bytes — not where it is taken as the index of what to check.
//
// WHAT THIS DOES NOT ATTEMPT. Internal consistency between manifest, database and files is the
// goal. This is not a signature scheme and does not pretend to withstand an adversary holding the
// same write authority as the archive; `docs/reference/audit-chain-evidentiary-scope.md` is
// explicit that such a guarantee comes from custody, not from code in this repository.
//
// FAIL-CLOSED, VERIFY BEFORE COPYING, AND VERIFY WHAT WAS COPIED. The archive is checked in full
// BEFORE a byte is written; the copy lands in a private staging directory; the staged result is
// verified again; only then is it published. A restore that copies first and validates afterwards
// leaves the operator holding a half-populated profile and a failure message — the state that
// gets "fixed" by using it anyway.
//
// Usage:
//   node scripts/restore-from-backup.mjs --archive <backup-dir> --into <empty-or-new-dir>
//   node scripts/restore-from-backup.mjs --archive <backup-dir> --verify-only

import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, renameSync, rmSync, statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** apps/lawbar-desktop */
const APP_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_DIR, "..", "..");

/**
 * The current format has exactly ONE database name.
 *
 * Accepting any other name means accepting an instruction from the archive about which file to
 * trust, and that instruction is the untrusted part. Fixing the name is what makes the traversal
 * and symlink cases below decidable rather than merely filtered.
 */
const DB_FILENAME = "case-box.sqlite";
const DOCS_DIRNAME = "case-box-documents";
const MANIFEST_FILENAME = "manifest.json";

/** The profile a running lawbar uses. Never a destination, under any flag. */
export const REAL_USER_DATA = path.join(os.homedir(), "Library", "Application Support", "lawbar");

export class RestoreRefused extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Resolve as far as the path exists, so a not-yet-created leaf still gets a real ancestor. */
function realish(p) {
  let current = path.resolve(p);
  const trailing = [];
  for (;;) {
    try {
      return path.join(realpathSync(current), ...trailing.reverse());
    } catch {
      const up = path.dirname(current);
      if (up === current) return path.resolve(p);
      trailing.push(path.basename(current));
      current = up;
    }
  }
}

function samePath(a, b) {
  return realish(a) === realish(b);
}

function isInsideResolved(parent, child) {
  const rel = path.relative(realish(parent), realish(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// The SQLite reader
// ---------------------------------------------------------------------------

/**
 * Open a database file READ-ONLY, using a driver whose ABI matches this process.
 *
 * WHICH COPY, AND WHY IT IS CHOSEN BY PATH. This repository holds two builds of better-sqlite3.
 * `apps/lawbar-desktop`'s is rebuilt for ELECTRON's ABI by its postinstall; under plain `node` it
 * REQUIRES CLEANLY and then ABORTS THE PROCESS on first use — so a try/catch cannot pick the right
 * one, and resolution order must not be left to chance. `services/case-box-persistence`'s copy is
 * a plain Node build and is the correct one for this command-line tool.
 *
 * An Electron caller — a restore UI, when one exists — must pass its own `openDb` instead. That is
 * why this is an injection point rather than a hard-coded require.
 *
 * IF NO DRIVER LOADS, THIS THROWS. It does not fall back to a shallower check. "I could not
 * verify this" and "I verified this" are different answers, and a restore that quietly downgrades
 * from the second to the first is the whole class of defect this file exists to stop making.
 */
export function defaultOpenDb(file) {
  let Database;
  try {
    const require_ = createRequire(import.meta.url);
    Database = require_(
      path.join(REPO_ROOT, "services/case-box-persistence/node_modules/better-sqlite3"),
    );
  } catch (err) {
    throw new RestoreRefused(
      "driver_unavailable",
      "no usable SQLite driver: the archive's audit chain cannot be verified, so this archive " +
        `is NOT confirmed restorable (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  try {
    return new Database(file, { readonly: true });
  } catch (err) {
    throw new RestoreRefused(
      "driver_unavailable",
      `the archived database could not be opened for verification (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
}

/**
 * The backup engine's own verification, loaded from the built app.
 *
 * Deliberately the SAME function the backup writes through. A restore-side reimplementation is
 * how the two ends drift, and the drift is invisible: both would still say "verified".
 */
/**
 * The schema-version reader and the chain-head reader, from the package's NATIVE-FREE subpath.
 *
 * `case-box-persistence/archive-verify` deliberately contains no native binding, so a tool that
 * only inspects an archive does not have to load one to ask which schema version it holds. Both
 * functions are the product's own — the version reader is the same one `applySchema` consults
 * before deciding whether this build can operate on a file at all.
 */
async function loadPersistenceReaders() {
  const built = path.join(
    REPO_ROOT, "services/case-box-persistence/dist/archiveVerify.js");
  if (!existsSync(built)) {
    throw new RestoreRefused(
      "engine_unavailable",
      `case-box-persistence is not built at ${path.relative(REPO_ROOT, built)}; ` +
        "run `npm --prefix services/case-box-persistence run build` first. Nothing was verified.",
    );
  }
  return import(pathToFileURL(built).href);
}

async function loadVerifyBackup() {
  const built = path.join(APP_DIR, "dist", "src", "backup", "runBackup.js");
  if (!existsSync(built)) {
    throw new RestoreRefused(
      "engine_unavailable",
      `the built backup engine is not at ${path.relative(REPO_ROOT, built)}; ` +
        "run `npm --prefix apps/lawbar-desktop run build` first. Nothing was verified.",
    );
  }
  const mod = await import(pathToFileURL(built).href);
  if (typeof mod.verifyBackup !== "function") {
    throw new RestoreRefused("engine_unavailable", "the built backup engine exports no verifyBackup");
  }
  return mod.verifyBackup;
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/**
 * Read and structurally validate the manifest.
 *
 * The manifest is the archive's own claim about itself, so it is the first thing that must be
 * refused when malformed — every later check reads its fields, and a check driven by a field that
 * is absent silently checks nothing. A missing manifest is the most important case of all: the
 * backup engine writes it ONLY after verification passes, so an archive without one is an archive
 * that failed verification.
 *
 * A manifest that IS present is NOT thereby trusted. `manifestVersion: 1` was also written by the
 * engine that did not verify chains, so the version says which SHAPE to expect and nothing about
 * whether the contents were ever checked. That is what `verifyArchive` is for.
 */
export function readManifest(archiveDir) {
  const file = path.join(archiveDir, MANIFEST_FILENAME);
  if (!existsSync(file)) {
    throw new RestoreRefused(
      "manifest_missing",
      "this archive has no manifest, which means the backup that produced it never passed verification",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    throw new RestoreRefused("manifest_unreadable", `manifest.json is not valid JSON (${err.message})`);
  }
  if (typeof manifest !== "object" || manifest === null) {
    throw new RestoreRefused("manifest_unreadable", "manifest.json is not an object");
  }
  if (manifest.manifestVersion !== 1) {
    throw new RestoreRefused(
      "manifest_version_unsupported",
      `manifest version ${JSON.stringify(manifest.manifestVersion)} is not one this tool can read`,
    );
  }
  if (typeof manifest.databaseSha256 !== "string") {
    throw new RestoreRefused("manifest_unreadable", "the manifest does not record a database digest");
  }
  // NOT "is it a string" and not "does it stay inside the archive": it must be THE name. A
  // traversal check on a free-form name still lets the archive choose which file is the database.
  if (manifest.databaseFile !== DB_FILENAME) {
    throw new RestoreRefused(
      "manifest_database_name_unsupported",
      `this format's database is ${DB_FILENAME}; the manifest names ` +
        `${JSON.stringify(manifest.databaseFile)}`,
    );
  }
  // EVERY FIELD THE RESTORE SIDE LATER READS IS VALIDATED HERE.
  //
  // `verifyBackup` is reused for the content checks, and it was written for a manifest the backup
  // engine had just constructed itself — so it validates the archive against the manifest, not the
  // manifest's own shape. Reusing it does not transfer a guarantee it never made. A field that is
  // read but never checked is the same defect as a check driven by an absent field: it silently
  // does nothing.
  if (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 0) {
    throw new RestoreRefused(
      "manifest_unreadable",
      `the manifest's schemaVersion is ${JSON.stringify(manifest.schemaVersion)}, not a version number`,
    );
  }
  if (!Array.isArray(manifest.chainHeads)) {
    throw new RestoreRefused("manifest_unreadable", "the manifest has no chainHeads list");
  }
  for (const [i, h] of manifest.chainHeads.entries()) {
    if (
      typeof h?.matterId !== "string" || h.matterId.length === 0 ||
      (h.headHash !== null && typeof h.headHash !== "string") ||
      !Number.isSafeInteger(h?.eventCount) || h.eventCount < 0
    ) {
      throw new RestoreRefused("manifest_unreadable", `chainHeads[${i}] is not a complete entry`);
    }
  }
  if (!Array.isArray(manifest.documents)) {
    throw new RestoreRefused("manifest_unreadable", "the manifest has no documents list");
  }
  for (const [i, d] of manifest.documents.entries()) {
    if (
      typeof d?.relativePath !== "string" || typeof d?.sha256 !== "string" ||
      typeof d?.byteSize !== "number"
    ) {
      throw new RestoreRefused("manifest_unreadable", `documents[${i}] is not a complete entry`);
    }
    // Lexical containment first — cheap, and it rejects the obvious traversal before any stat.
    // The symlink cases it cannot see are handled by assertArchiveSelfContained.
    const resolved = path.resolve(path.join(DOCS_DIRNAME, d.relativePath));
    if (path.isAbsolute(d.relativePath) || !resolved.startsWith(path.resolve(DOCS_DIRNAME) + path.sep)) {
      throw new RestoreRefused("manifest_path_escape", `documents[${i}] names a path outside the archive`);
    }
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Self-containment
// ---------------------------------------------------------------------------

/**
 * Every path the manifest names must resolve to a regular file INSIDE the archive, with no
 * symlink anywhere along the way.
 *
 * ANCESTORS, NOT JUST LEAVES. The first version lstat'd the leaf only, so replacing a document's
 * per-document DIRECTORY with a link to somewhere else left every digest matching and every file
 * outside the archive. The database had no link check at all.
 *
 * This is about self-containment, not about defeating an attacker who can write to the archive:
 * an archive that reaches outside itself cannot be restored into an independent profile, whatever
 * the intent behind it.
 */
export function assertArchiveSelfContained(archiveDir, manifest) {
  let realRoot;
  try {
    const rootLink = lstatSync(archiveDir);
    if (rootLink.isSymbolicLink()) {
      throw new RestoreRefused("archive_not_self_contained", "the archive directory is a symlink");
    }
    realRoot = realpathSync(archiveDir);
  } catch (err) {
    if (err instanceof RestoreRefused) throw err;
    throw new RestoreRefused("archive_unusable", `the archive could not be resolved (${err.message})`);
  }

  /** Walk each segment from the root down, refusing any symlink component. */
  const checkPath = (relative, what) => {
    let current = realRoot;
    const segments = relative.split(path.sep).filter((s) => s.length > 0);
    for (const [i, segment] of segments.entries()) {
      if (segment === "." || segment === "..") {
        throw new RestoreRefused("archive_not_self_contained", `${what} contains a relative segment`);
      }
      current = path.join(current, segment);
      const st = lstatSync(current, { throwIfNoEntry: false });
      if (st === undefined) {
        // Absence is reported by verifyArchive as a finding, with a better message than this
        // guard could give. Containment has nothing left to check on a path that is not there.
        return;
      }
      if (st.isSymbolicLink()) {
        throw new RestoreRefused(
          "archive_not_self_contained",
          `${what} passes through a symlink (${segment}); a restored profile built from it would ` +
            "reference a file the archive does not contain",
        );
      }
      const last = i === segments.length - 1;
      if (last && !st.isFile()) {
        throw new RestoreRefused("archive_not_self_contained", `${what} is not a regular file`);
      }
      if (!last && !st.isDirectory()) {
        throw new RestoreRefused("archive_not_self_contained", `${what} traverses a non-directory`);
      }
    }
    // Belt and braces: the resolved path must still be under the resolved root.
    if (!isInsideResolved(realRoot, current)) {
      throw new RestoreRefused("archive_not_self_contained", `${what} resolves outside the archive`);
    }
  };

  checkPath(DB_FILENAME, "the archived database");
  for (const d of manifest.documents) {
    checkPath(path.join(DOCS_DIRNAME, d.relativePath), `document ${d.relativePath}`);
  }
}

/**
 * SQLite sidecars that mean the main database file is not the whole database.
 *
 * `-wal` is the write-ahead log, `-shm` its shared-memory index, `-journal` the rollback journal
 * of the older mode. Any of them present means committed data lives outside `case-box.sqlite`.
 */
const HOT_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];

/**
 * Refuse an archive that carries SQLite sidecars, and leave them exactly where they are.
 *
 * TWO REASONS, and the second is the one that makes refusal the right answer rather than
 * tolerance. First: the manifest binds ONE file and records ONE digest for it. A hot WAL holds
 * committed pages the digest does not cover, so an archive carrying one is outside the format this
 * tool reads — verifying it would mean checking a view of the data the manifest never described.
 * Second: whatever produced those sidecars, they are not this operation's to resolve. Deleting
 * them discards data; checkpointing them rewrites the archive. An input this tool does not
 * understand is refused intact, which leaves every option open to the person holding it.
 *
 * Deliberately NOT a feature request in disguise: nothing here adds support for restoring a
 * hot-WAL archive. It states that the case is unsupported, and stops.
 */
export function assertNoHotSidecars(archiveDir) {
  const present = HOT_SIDECAR_SUFFIXES
    .filter((suffix) => existsSync(path.join(archiveDir, `${DB_FILENAME}${suffix}`)))
    .map((suffix) => `${DB_FILENAME}${suffix}`);
  if (present.length > 0) {
    throw new RestoreRefused(
      "archive_has_hot_sidecars",
      `this archive carries ${present.join(", ")}. The manifest describes ${DB_FILENAME} alone, ` +
        "so part of the database is outside what it can vouch for. Nothing has been changed: " +
        "close whatever still has the database open, then take a fresh backup.",
    );
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify an archive against its own manifest AND against its own database.
 *
 * Returns FINDINGS for things that were checked and found wrong. THROWS `RestoreRefused` for
 * things that make checking impossible at all — no driver, no built engine, a structure that
 * reaches outside itself. The distinction matters at exactly one moment: an empty findings array
 * must never be reachable by a path that skipped the work.
 */
export async function verifyArchive(archiveDir, manifest, { openDb = defaultOpenDb } = {}) {
  assertArchiveSelfContained(archiveDir, manifest);
  assertNoHotSidecars(archiveDir);

  const findings = [];
  const dbFile = path.join(archiveDir, DB_FILENAME);
  if (!existsSync(dbFile)) {
    findings.push("the database file named by the manifest is not in the archive");
  } else if (sha256File(dbFile) !== manifest.databaseSha256) {
    findings.push("the archived database does not match the digest the manifest recorded");
  }

  const docsDir = path.join(archiveDir, DOCS_DIRNAME);
  for (const d of manifest.documents) {
    const file = path.join(docsDir, d.relativePath);
    if (!existsSync(file)) {
      findings.push(`the manifest lists ${d.relativePath} but the archive does not contain it`);
      continue;
    }
    const st = statSync(file);
    if (st.size !== d.byteSize) {
      findings.push(`${d.relativePath} is ${st.size} bytes, the manifest says ${d.byteSize}`);
      continue;
    }
    if (sha256File(file) !== d.sha256) {
      findings.push(`${d.relativePath} does not match the digest the manifest recorded`);
    }
  }

  // A database whose file is absent or already mismatched cannot be meaningfully opened, and
  // opening it would replace a precise finding with a driver error.
  if (findings.length > 0 && !existsSync(dbFile)) return findings;

  // THE PART THE FIRST VERSION DID NOT DO. Open the archive read-only and run the backup engine's
  // own verification over it: integrity_check, every audit chain across the union of every matter
  // the database mentions, every document row parsed and re-hashed at its derived path, and the
  // manifest cross-checked against what the database actually references.
  const verifyBackup = await loadVerifyBackup();
  const { readArchiveSchemaVersion, readChainHeads, CURRENT_SCHEMA_VERSION } =
    await loadPersistenceReaders();

  // OPEN A PRIVATE COPY, NEVER THE ARCHIVE'S OWN DATABASE FILE.
  //
  // This is the S1 fix, and the defect it replaces is worth recording because the code looked
  // right. Verification used to open the archive's database in place and then, in a `finally`,
  // delete `case-box.sqlite-wal` and `-shm`. That cleanup was lifted from the backup engine,
  // where it is correct: there the archive had just been written by this process and the sidecars
  // really were ours. Here the archive is an INPUT — possibly the operator's only copy — and
  // `--verify-only` runs the same path. Measured by a reviewer: a 16,512-byte WAL and its SHM
  // present before the call, gone after, `findings: []` returned. A tool that inspects evidence
  // must not be capable of changing it, and "both callers share a cleanup function" is not
  // ownership.
  //
  // Copying the database out first removes the question rather than answering it carefully: every
  // temporary file SQLite creates lands in a directory this call made and deletes. The DIGEST
  // check above still reads the archive's real file, so nothing is verified by proxy.
  const scratch = mkdtempSync(path.join(os.tmpdir(), "lawbar-verify-"));
  const scratchDb = path.join(scratch, DB_FILENAME);
  let db;
  try {
    copyFileSync(dbFile, scratchDb);
  } catch (err) {
    rmSync(scratch, { recursive: true, force: true });
    throw new RestoreRefused(
      "archive_unusable",
      `the archived database could not be read for verification (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  // Opening is guarded too, and not only for the default reader. An INJECTED `openDb` — an
  // Electron caller's, say — may fail in its own way, and every one of those ways has to arrive
  // at the same fail-closed answer. An unwrapped driver error escaping here would reach a caller
  // that is catching `RestoreRefused`, and "not verified" would look like an unrelated crash.
  try {
    db = openDb(scratchDb);
  } catch (err) {
    rmSync(scratch, { recursive: true, force: true });
    if (err instanceof RestoreRefused) throw err;
    throw new RestoreRefused(
      "driver_unavailable",
      "the archived database could not be opened, so its audit chain was NOT verified " +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  try {
    // COMPATIBILITY BEFORE CONTENT. A database this build cannot open is not a corrupt archive
    // and must not be reported as one; it is an archive for a newer product than the one holding
    // it, and the only useful answer names both versions.
    const dbSchemaVersion = readArchiveSchemaVersion(db);
    if (dbSchemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new RestoreRefused(
        "schema_version_unsupported",
        `the archived database records schema version ${dbSchemaVersion}, newer than the ` +
          `${CURRENT_SCHEMA_VERSION} this build supports; restoring it would produce a profile ` +
          "this application refuses to open",
      );
    }
    // An older version is fine and is deliberately NOT migrated here: the application migrates a
    // database when it opens one, so the migration happens to the restored COPY at first open.
    // Migrating the archive would rewrite the evidence being restored from.

    if (manifest.schemaVersion !== dbSchemaVersion) {
      findings.push(
        `the manifest records schema version ${manifest.schemaVersion} but the database is at ` +
          `${dbSchemaVersion}`,
      );
    }
    findings.push(...chainHeadDisagreements(manifest, readChainHeads(db)));

    findings.push(...(await verifyBackup(db, manifest, docsDir)));
  } catch (err) {
    if (err instanceof RestoreRefused) throw err;
    throw new RestoreRefused(
      "driver_unavailable",
      `the archive could not be verified (${err instanceof Error ? err.message : String(err)})`,
    );
  } finally {
    try { db.close?.(); } catch { /* a reader that will not close is not a restore problem */ }
    // Only this call's own scratch directory. Nothing inside the archive is ever removed.
    rmSync(scratch, { recursive: true, force: true });
  }

  // Deduplicate: the digest checks above and verifyBackup's own manifest re-read overlap, and a
  // finding reported twice reads as two problems.
  return [...new Set(findings)];
}

/**
 * Cross-check the manifest's `chainHeads` against the heads the DATABASE actually holds.
 *
 * `verifyBackup` proves the chains themselves are sound; it does not compare them to what an
 * EXTERNAL manifest claims, because the manifest it was written for is one the backup engine
 * built from the same table moments earlier. On the restore side the manifest has been sitting on
 * a disk outside this program's control, and three of its fields describe the audit chain — the
 * single most load-bearing thing in the product. An internal contradiction between the two is a
 * defect regardless of how it got there.
 *
 * This is not an anti-forgery measure and does not pretend to be: anyone able to edit the manifest
 * can edit the database. It refuses SELF-CONTRADICTION, which is a different and achievable thing.
 */
function chainHeadDisagreements(manifest, actualHeads) {
  const findings = [];
  const actual = new Map(actualHeads.map((h) => [h.matterId, h]));
  const claimed = new Map(manifest.chainHeads.map((h) => [h.matterId, h]));

  for (const [matterId, head] of actual) {
    const said = claimed.get(matterId);
    if (said === undefined) {
      findings.push(`the manifest lists no chain head for matter ${matterId}, but the database has one`);
      continue;
    }
    if ((said.headHash ?? null) !== head.headHash) {
      findings.push(`the manifest's chain head for ${matterId} is not the one the database records`);
    }
    if (Number(said.eventCount) !== head.eventCount) {
      findings.push(
        `the manifest says matter ${matterId} has ${String(said.eventCount)} audit events, the ` +
          `database has ${head.eventCount}`,
      );
    }
  }
  for (const matterId of claimed.keys()) {
    if (!actual.has(matterId)) {
      findings.push(`the manifest claims a chain head for matter ${matterId}, which the database does not have`);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The destination
// ---------------------------------------------------------------------------

/** Refuse any destination that is, or contains, a live case box — or the real profile at all. */
export function assertDestinationSafe(into) {
  if (samePath(into, REAL_USER_DATA)) {
    throw new RestoreRefused(
      "destination_is_live_profile",
      "refusing to restore over the application's real profile",
    );
  }
  // Resolved, not string-compared: a link or a `..` spelling of the same directory is the same
  // directory, and the check that matters is where the write actually lands.
  if (isInsideResolved(REAL_USER_DATA, into)) {
    throw new RestoreRefused(
      "destination_is_live_profile",
      "refusing to restore inside the application's real profile",
    );
  }
  if (!existsSync(into)) return;
  if (!statSync(into).isDirectory()) {
    throw new RestoreRefused("destination_not_a_directory", "the destination is not a directory");
  }
  // Emptiness is checked rather than "does a database exist", because a partially-populated
  // profile is just as unrestorable-into and much easier to miss.
  //
  // HIDDEN FILES COUNT. They were filtered here, which put this check out of step with the
  // primitive that publishes: `rename` onto a directory containing `.DS_Store` fails with
  // ENOTEMPTY (measured). So a dotfile-only destination passed this guard, did the whole copy,
  // and then failed at the last step with an opaque message — and the obvious way to "fix" that
  // later is a recursive delete of a directory whose contents were never examined. Counting every
  // entry makes the guard and the primitive agree on one definition of empty, and the cost is
  // refusing a destination containing a stray `.DS_Store`, which is a sentence the operator can
  // act on.
  const entries = readdirSync(into);
  if (entries.length > 0) {
    throw new RestoreRefused(
      "destination_not_empty",
      `the destination already holds ${entries.length} item(s); restore only into an empty or ` +
        "not-yet-created directory",
    );
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Restore `archiveDir` into `into`. Verifies the archive, copies into private staging, verifies
 * what was actually written, then publishes with a single rename.
 *
 * WHY STAGING. The previous version created the destination and copied into it directly, so any
 * error partway through left a complete `case-box.sqlite` — chain valid, exhibits missing — at
 * exactly the path someone would then open. A profile that opens and is quietly incomplete is
 * worse than one that plainly does not exist.
 *
 * Staging is a sibling of the destination so the publish is a rename WITHIN ONE FILESYSTEM, which
 * is what makes it atomic. `/tmp` would not do: a cross-device rename degrades to a copy, and the
 * copy is the step being protected against.
 *
 * `copyFile` is injectable for the same reason `openDb` is: the failure paths here are only
 * testable if a failure can be caused on purpose.
 */
export async function restoreFromBackup({
  archiveDir,
  into,
  openDb = defaultOpenDb,
  copyFile = copyFileSync,
  publish = renameSync,
}) {
  if (!existsSync(archiveDir) || !statSync(archiveDir).isDirectory()) {
    throw new RestoreRefused("archive_unusable", "the archive is not a directory");
  }
  const manifest = readManifest(archiveDir);
  const findings = await verifyArchive(archiveDir, manifest, { openDb });
  if (findings.length > 0) {
    throw new RestoreRefused("archive_failed_verification", findings.join("; "));
  }

  assertDestinationSafe(into);
  if (isInsideResolved(archiveDir, into) || isInsideResolved(into, archiveDir)) {
    throw new RestoreRefused(
      "destination_overlaps_archive",
      "the destination and the archive are the same tree; a restore must produce an independent copy",
    );
  }

  const parent = path.dirname(path.resolve(into));
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, ".lawbar-restore-"));

  try {
    // Copy the database first and the documents second — the same order the backup used, for the
    // same reason: a database referencing documents not yet present is the worse intermediate.
    copyFile(path.join(archiveDir, DB_FILENAME), path.join(staging, DB_FILENAME));
    const docsSource = path.join(archiveDir, DOCS_DIRNAME);
    const docsDest = path.join(staging, DOCS_DIRNAME);
    mkdirSync(docsDest, { recursive: true });
    for (const d of manifest.documents) {
      const to = path.join(docsDest, d.relativePath);
      mkdirSync(path.dirname(to), { recursive: true });
      copyFile(path.join(docsSource, d.relativePath), to);
    }

    // VERIFY WHAT WAS ACTUALLY WRITTEN, not what was read. Verifying the archive proves what is
    // on the shelf; it says nothing about the medium that just accepted these writes. Removable
    // media returning different bytes than it was given is the failure this catches, and no
    // pre-copy check can see it.
    const staged = await verifyArchive(staging, manifest, { openDb });
    if (staged.length > 0) {
      throw new RestoreRefused("restore_failed_verification", staged.join("; "));
    }

    // And each copy must be an independent regular file. A hardlink would satisfy every digest
    // and still leave the profile dying with the archive.
    for (const rel of [DB_FILENAME, ...manifest.documents.map((d) => path.join(DOCS_DIRNAME, d.relativePath))]) {
      const st = lstatSync(path.join(staging, rel));
      if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1) {
        throw new RestoreRefused(
          "restore_failed_verification",
          `${rel} was not written as an independent regular file`,
        );
      }
    }

    // PUBLISH — ONE RENAME, NOTHING DELETED FIRST.
    //
    // This used to `rmSync(into, { recursive: false })` before renaming, which raises EISDIR on a
    // directory however empty it is. The CLI documents `--into <empty-or-new-dir>` and the
    // empty-directory half was therefore impossible: make a folder, restore into it, and the run
    // died with "rm returned EISDIR". Every passing test used a path that did not exist yet, so
    // the ordinary thing a person does was the one case never covered.
    //
    // `rename` onto an EMPTY directory succeeds, and onto a non-empty one fails with ENOTEMPTY
    // (both measured). So the delete was not only wrong, it was unnecessary: the primitive
    // already enforces exactly the precondition this restore requires, which is why
    // `assertDestinationSafe` now counts hidden files too — the two must not disagree about what
    // "empty" means. Deleting the destination first would also open a window in which the owner's
    // directory is gone and the new one is not yet there.
    assertDestinationSafe(into);
    publish(staging, into);
  } catch (err) {
    // Only ever the directory this call created. The caller's existing content is not ours.
    rmSync(staging, { recursive: true, force: true });
    if (err instanceof RestoreRefused) throw err;
    throw new RestoreRefused(
      "restore_aborted",
      `the restore was abandoned and nothing was published (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  return {
    into,
    databaseFile: path.join(into, DB_FILENAME),
    documentsRoot: path.join(into, DOCS_DIRNAME),
    documents: manifest.documents.length,
    appVersion: manifest.appVersion,
    schemaVersion: manifest.schemaVersion,
    createdAt: manifest.createdAt,
  };
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const out = { archive: null, into: null, verifyOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--archive") out.archive = argv[++i];
    else if (argv[i] === "--into") out.into = argv[++i];
    else if (argv[i] === "--verify-only") out.verifyOnly = true;
    else throw new RestoreRefused("bad_usage", `unrecognised argument ${JSON.stringify(argv[i])}`);
  }
  return out;
}

const isMain = process.argv[1] !== undefined
  && samePath(process.argv[1], fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.archive === null) throw new RestoreRefused("bad_usage", "--archive is required");
    if (args.verifyOnly) {
      const manifest = readManifest(args.archive);
      const findings = await verifyArchive(args.archive, manifest);
      if (findings.length > 0) {
        console.error(`archive failed verification:\n  ${findings.join("\n  ")}`);
        process.exit(1);
      }
      console.log(
        `archive verifies: ${manifest.documents.length} document(s), created ${manifest.createdAt}. ` +
          "Audit chains, document references and digests all checked.",
      );
      process.exit(0);
    }
    if (args.into === null) throw new RestoreRefused("bad_usage", "--into is required");
    const result = await restoreFromBackup({ archiveDir: args.archive, into: args.into });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof RestoreRefused) {
      console.error(`REFUSED (${err.code}): ${err.detail}`);
      process.exit(1);
    }
    throw err;
  }
}
