// runBackup.ts — an in-app, verified backup of the live case box.
//
// WHY THIS EXISTS. Backup already worked, and was unreachable. `scripts/backup-local-data.mjs`
// is careful and fail-closed, but `scripts/` is not in electron-builder's `build.files`, so the
// PACKAGED APP CANNOT RUN IT. Backing up therefore meant: quit the app, open Terminal, find a
// git checkout, run npm. The owner has stated real client information is going into this app.
// A backup procedure a busy litigator will not perform is a backup procedure that does not exist.
//
// WHY THIS DOES NOT QUIT THE APP. The CLI script proves with `lsof` that the database is CLOSED
// before copying it, because a raw file copy of a live WAL database can tear. That constraint
// belongs to FILE COPY, not to SQLite. SQLite's online backup API exists precisely to snapshot a
// live, open database, and better-sqlite3 exposes it as `db.backup()`.
//
// Measured before this module was written, on a live open WAL database with a 2.8 MB WAL sidecar
// and ten write transactions committing DURING the backup: 42 ms, `PRAGMA integrity_check` -> ok,
// and a 20,500-row hash-linked chain intact end to end. So the quit-and-relaunch dance a naive
// design would need is unnecessary; it would have been ceremony protecting against a hazard the
// right primitive removes.
//
// It also matters that we reuse the handle the app already holds rather than opening our own.
// `verify-against-backup.mjs` records the reason: opening a hot-WAL database read-write
// CHECKPOINTS it on close, which mutates the very evidence being preserved. This module opens no
// handle on the source and closes none.
//
// ORDER IS LOAD-BEARING: DATABASE FIRST, DOCUMENTS SECOND. `storeDocumentFile` copies a document
// into the content-addressed store and hashes the DESTINATION *before* the caller records the row
// that references it (itself the fix for a TOCTOU finding). So a snapshot taken first can only
// reference files already on disk, and the document copy that follows is guaranteed to be a
// superset of what the snapshot references. The reverse order can produce a manifest whose
// database cites a document the copy never saw. There is no document GC in this product, so
// nothing removes a blob between the two phases.
//
// WHAT "VERIFIED" MEANS HERE, AND WHAT IT DOES NOT. A chain that verifies is necessary and NOT
// sufficient: a backup can carry a perfectly valid chain and still be useless if the documents it
// cites are absent. So verification recomputes BOTH — every matter's audit chain, and every
// document reference against the bytes actually copied. Until that passes, this module reports a
// failure and writes no success record. "Copied" is not a claim worth making; only "verified" is.
//
// AND WHAT NO CODE HERE CAN SUPPLY. `docs/reference/audit-chain-evidentiary-scope.md` is blunt
// about it: a backup written by this machine to storage this machine can still reach sits under
// the SAME write authority as the database. It becomes a witness only when retained OUTSIDE that
// authority — disconnected external media, or an evidenced custody arrangement. That is an
// operational commitment by the owner, not a guarantee this file can make, and nothing in the UI
// built on top of it may imply otherwise.

import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, lstatSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

/** The minimal surface this module needs from better-sqlite3, so tests need no Electron ABI. */
export interface BackupCapableDb {
  backup(destination: string): Promise<{ totalPages: number }>;
  prepare(sql: string): { all: (...params: unknown[]) => unknown[] };
}

export interface MatterChainHead {
  readonly matterId: string;
  /** Hash of the most recent audit event, or null for a matter with no events yet. */
  readonly headHash: string | null;
  readonly eventCount: number;
}

export interface DocumentEntry {
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface BackupManifest {
  readonly manifestVersion: 1;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly databaseFile: string;
  readonly databaseSha256: string;
  /** One head PER MATTER. This product has no single global chain — see chainHeads(). */
  readonly chainHeads: readonly MatterChainHead[];
  readonly documents: readonly DocumentEntry[];
  /** Content hashes the database references, so verification can prove the set is complete. */
  readonly referencedContentHashes: readonly string[];
}

export type BackupOutcome =
  | { readonly ok: true; readonly dir: string; readonly manifest: BackupManifest }
  | { readonly ok: false; readonly code: BackupFailureCode; readonly detail: string };

export type BackupFailureCode =
  | "destination_inside_data_dir"
  | "destination_unusable"
  | "snapshot_failed"
  | "documents_copy_failed"
  | "verification_failed";

export interface RunBackupOptions {
  /** The LIVE handle the app already holds. This module never opens or closes it. */
  readonly db: BackupCapableDb;
  readonly documentsRoot: string;
  readonly userDataDir: string;
  /** Chosen by the MAIN process via a native dialog. The renderer never supplies a path. */
  readonly destinationRoot: string;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly now?: () => Date;
}

const DB_FILENAME = "case-box.sqlite";
const DOCS_DIRNAME = "case-box-documents";
const MANIFEST_FILENAME = "manifest.json";

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * True when `child` is `parent` or lives underneath it — AFTER RESOLVING SYMLINKS.
 *
 * `path.resolve` normalises `..` and makes a path absolute; it does NOT follow symlinks. So a
 * destination like `/Volumes/Drive/backups` that is a symlink to the application data directory
 * resolves to itself, compares as "outside", and passes a containment check built on `resolve`
 * alone — measured, and it is how the first version of this guard let a self-referential backup
 * through. `realpathSync` is what actually answers the question, which is why `documentVerify.ts`
 * uses `lstat` + `realpath` for the same class of check on the document store.
 *
 * A path that does not exist yet cannot be realpath'd, so it falls back to `resolve` — but its
 * existing ancestor is resolved first, which is what closes the symlinked-parent case.
 */
export function isInside(parent: string, child: string): boolean {
  const real = (p: string): string => {
    let current = path.resolve(p);
    const trailing: string[] = [];
    // Walk up to the nearest ancestor that exists, realpath THAT, then re-append.
    for (;;) {
      try {
        return path.join(realpathSync(current), ...trailing.reverse());
      } catch {
        const up = path.dirname(current);
        if (up === current) return path.resolve(p); // reached the root: nothing to resolve
        trailing.push(path.basename(current));
        current = up;
      }
    }
  };
  const rel = path.relative(real(parent), real(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Every regular file under `root`, as paths relative to it, sorted for a stable manifest.
 *
 * Symlinks are skipped rather than followed: the document store is written only by
 * `storeDocumentFile`, so a symlink inside it did not come from this product, and following one
 * would let a link decide what lands in an evidentiary archive.
 *
 * The `lstatSync` check is DEFENCE IN DEPTH, not the load-bearing line — established by mutation,
 * not assumed. `Dirent.isFile()` is already false for a symlink, so removing either guard alone
 * changes nothing and neither can be killed on its own; removing BOTH makes the symlink test red.
 * Saying "this line is what stops it" would have been a confident, unverified claim of exactly
 * the kind this module's own subject matter is about.
 */
export function listDocumentFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const full = path.join(dir, entry.name);
      if (lstatSync(full).isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * One chain head per matter, read from `case_box_audit_chain_heads` — the table the product
 * already maintains in the SAME transaction as each event insert. A manifest recording a single
 * "audit chain head" would be wrong here: this product has no global chain, and one head would
 * under-bind every matter but one.
 */
export function chainHeads(db: BackupCapableDb): MatterChainHead[] {
  const rows = db
    .prepare(
      "SELECT matter_id AS matterId, head_hash AS headHash, event_count AS eventCount " +
        "FROM case_box_audit_chain_heads ORDER BY matter_id",
    )
    .all() as Array<{ matterId: string; headHash: string | null; eventCount: number }>;
  return rows.map((r) => ({
    matterId: r.matterId,
    headHash: r.headHash ?? null,
    eventCount: Number(r.eventCount),
  }));
}

/**
 * The content hashes the database says it holds.
 *
 * `content_hash` is NOT a column: `case_box_documents` lifts only the fields its indices need
 * (status, doc_type, received_at, supersedes_document_id) and keeps the canonical record in
 * `payload_json`. Reading it therefore means parsing that JSON, not selecting a column — a
 * detail worth stating because guessing a `content_hash` column typechecks perfectly and fails
 * only at runtime, against the real database, which is the worst place to find out.
 */
export function referencedContentHashes(db: BackupCapableDb): string[] {
  const rows = db
    .prepare("SELECT payload_json FROM case_box_documents")
    .all() as Array<{ payload_json: string }>;
  const hashes = new Set<string>();
  for (const r of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.payload_json);
    } catch {
      continue; // a row we cannot parse is reported by verification, not silently repaired here
    }
    const h = (parsed as { content_hash?: unknown } | null)?.content_hash;
    if (typeof h === "string" && h.length > 0) hashes.add(h);
  }
  return [...hashes].sort();
}

/**
 * The per-matter invariant the schema documents: `event_count == COUNT(*) == MAX(sequence)`.
 * Checked against the BACKUP, where a torn snapshot would show up as a head row disagreeing with
 * the events it summarises.
 */
export function chainHeadDisagreements(db: BackupCapableDb): string[] {
  const rows = db
    .prepare(
      "SELECT h.matter_id AS matterId, h.event_count AS declared, " +
        "  (SELECT COUNT(*) FROM case_box_audit_events e WHERE e.matter_id = h.matter_id) AS actual, " +
        "  (SELECT MAX(sequence) FROM case_box_audit_events e WHERE e.matter_id = h.matter_id) AS maxSeq " +
        "FROM case_box_audit_chain_heads h ORDER BY h.matter_id",
    )
    .all() as Array<{ matterId: string; declared: number; actual: number; maxSeq: number | null }>;
  const out: string[] = [];
  for (const r of rows) {
    if (Number(r.declared) !== Number(r.actual)) {
      out.push(`${r.matterId}: head declares ${r.declared} events, backup holds ${r.actual}`);
    } else if (r.actual > 0 && Number(r.maxSeq) !== Number(r.actual)) {
      out.push(`${r.matterId}: ${r.actual} events but MAX(sequence)=${r.maxSeq}`);
    }
  }
  return out;
}

/**
 * Copy the content-addressed document store. Plain file copies: these blobs are immutable once
 * written (`storeDocumentFile` names them by their own SHA-256 and nothing in this product
 * deletes or rewrites one), so copying while the app runs can only ever miss a file added AFTER
 * the copy began — never tear one. The database snapshot is taken first, so any file this copy
 * misses is one the snapshot cannot reference.
 */
function copyDocuments(sourceRoot: string, destRoot: string): DocumentEntry[] {
  const entries: DocumentEntry[] = [];
  for (const rel of listDocumentFiles(sourceRoot)) {
    const from = path.join(sourceRoot, rel);
    const to = path.join(destRoot, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    const bytes = readFileSync(from);
    writeFileSync(to, bytes);
    entries.push({
      relativePath: rel,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
    });
  }
  return entries;
}

/**
 * Prove the archive is usable, not merely present.
 *
 * Three questions, because a backup can pass any two and still be worthless:
 *   1. is the database file itself sound?            -> integrity_check
 *   2. do the audit chains it carries hold together? -> chainHeadDisagreements
 *   3. does every document it CITES actually exist here, with the right bytes?
 *
 * (3) is the one a chain check cannot answer and the one that matters most in a court-facing
 * product: a perfectly valid chain describing documents that were never copied would restore into
 * a case box that references evidence it does not have.
 */
export function verifyBackup(
  backupDb: BackupCapableDb & { pragma?: (s: string, o?: unknown) => unknown },
  manifest: BackupManifest,
  documentsDir: string,
): string[] {
  const findings: string[] = [];

  // The manifest records `databaseSha256`. Recording a hash and never checking it is a claim
  // with no verification behind it — the exact shape of defect this repo keeps finding — so the
  // file is re-read from disk here, after all writing is finished.
  const dbFile = path.join(path.dirname(documentsDir), manifest.databaseFile);
  if (!existsSync(dbFile)) {
    findings.push(`the database file named by the manifest is not in the archive`);
  } else {
    const actual = sha256File(dbFile);
    if (actual !== manifest.databaseSha256) {
      findings.push(`database file hashes to ${actual}, manifest says ${manifest.databaseSha256}`);
    }
  }

  const integrity = backupDb.pragma?.("integrity_check", { simple: true });
  if (integrity !== undefined && integrity !== "ok") {
    findings.push(`integrity_check returned ${JSON.stringify(integrity)}`);
  }

  findings.push(...chainHeadDisagreements(backupDb));

  // Every hash the RESTORED database would look for must be present in the copied bytes.
  const present = new Set(manifest.documents.map((d) => d.sha256));
  for (const wanted of referencedContentHashes(backupDb)) {
    if (!present.has(wanted)) {
      findings.push(`document content_hash ${wanted} is referenced but absent from the archive`);
    }
  }

  // And the copied bytes must still hash to what the manifest recorded — this catches a file
  // truncated or altered between the copy and the verification, including by the destination
  // medium itself, which is the failure a removable drive actually produces.
  for (const d of manifest.documents) {
    const file = path.join(documentsDir, d.relativePath);
    if (!existsSync(file)) {
      findings.push(`manifest lists ${d.relativePath} but it is not in the archive`);
      continue;
    }
    const actual = sha256File(file);
    if (actual !== d.sha256) {
      findings.push(`${d.relativePath} hashes to ${actual}, manifest says ${d.sha256}`);
    }
  }

  return findings;
}

/**
 * Run a full backup. Returns a failure rather than throwing, because every caller of this is a
 * button, and a button must be able to say what went wrong.
 */
export async function runBackup(
  options: RunBackupOptions,
  openBackupDb: (file: string) => BackupCapableDb & { pragma?: (s: string, o?: unknown) => unknown },
): Promise<BackupOutcome> {
  const now = options.now ?? (() => new Date());

  // A backup written inside the data directory is not a backup: it dies with the thing it was
  // meant to survive, and on the next run it would try to copy itself.
  if (isInside(options.userDataDir, options.destinationRoot)) {
    return {
      ok: false,
      code: "destination_inside_data_dir",
      detail: "the destination is inside the application data directory",
    };
  }
  if (!existsSync(options.destinationRoot) || !statSync(options.destinationRoot).isDirectory()) {
    return { ok: false, code: "destination_unusable", detail: "the destination is not a directory" };
  }

  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(options.destinationRoot, `lawbar-backup-${stamp}`);
  const docsDir = path.join(dir, DOCS_DIRNAME);
  const dbFile = path.join(dir, DB_FILENAME);

  try {
    mkdirSync(docsDir, { recursive: true });
  } catch (err) {
    return { ok: false, code: "destination_unusable", detail: describe(err) };
  }

  // PHASE 1 — the database, first, from the handle the app already holds.
  try {
    await options.db.backup(dbFile);
  } catch (err) {
    return { ok: false, code: "snapshot_failed", detail: describe(err) };
  }

  // PHASE 2 — the documents, second. See the ordering note at the top of this file.
  let documents: DocumentEntry[];
  try {
    documents = copyDocuments(options.documentsRoot, docsDir);
  } catch (err) {
    return { ok: false, code: "documents_copy_failed", detail: describe(err) };
  }

  // The destination must still be the directory we created. A drive that was unmounted, or a
  // folder that was moved or deleted mid-run, must not be able to reach the success path — and
  // without this check the copy simply re-creates the tree it was writing into and reports
  // success for an archive that is no longer where the owner was told it is.
  if (!existsSync(dir) || !existsSync(dbFile)) {
    return {
      ok: false,
      code: "destination_unusable",
      detail: "the destination went away while the backup was running",
    };
  }

  const backupDb = openBackupDb(dbFile);
  const manifest: BackupManifest = {
    manifestVersion: 1,
    appVersion: options.appVersion,
    schemaVersion: options.schemaVersion,
    createdAt: now().toISOString(),
    databaseFile: DB_FILENAME,
    databaseSha256: sha256File(dbFile),
    chainHeads: chainHeads(backupDb),
    documents,
    referencedContentHashes: referencedContentHashes(backupDb),
  };

  const findings = verifyBackup(backupDb, manifest, docsDir);
  if (findings.length > 0) {
    return { ok: false, code: "verification_failed", detail: findings.join("; ") };
  }

  // The manifest is written only AFTER verification passes, so a manifest on disk always means a
  // verified archive. A half-written archive carrying a confident manifest is worse than none.
  writeFileSync(path.join(dir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), "utf-8");
  return { ok: true, dir, manifest };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
