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
// AND HOW THAT SENTENCE WAS ONCE FALSE. An external audit on 2026-09-06 reproduced four false
// VERIFIEDs against this module. It said it recomputed chains; it compared COUNTS
// (`event_count == COUNT(*) == MAX(sequence)`) and drove that comparison FROM the chain-heads
// table, so an edited event payload passed and a DELETED head removed its matter from the checked
// set altogether — producing a `chainHeads: []` manifest reported as success. It said it checked
// document references; it compared a SET of content hashes, so a registered exhibit renamed on
// disk passed (its bytes were still somewhere in the archive), and a document row whose JSON no
// longer parsed was `continue`d past into a `documents: 0` success.
//
// Both are now delegated to the verifiers the product already had and was not calling:
// `verifyAllAuditChains` (case-box-persistence/archive-verify — per-event hashes, prev-links,
// sequence, genesis shape, head anchor, over the UNION of every matter the database mentions) and
// `verifyDocumentStore` (documentVerify.ts — per-document derived path, containment, exclusive
// hold, re-hash). The rule this leaves behind: a second, weaker copy of a check the product
// already owns is not a cheaper version of it, it is a way of not performing it.
//
// AND WHAT NO CODE HERE CAN SUPPLY. `docs/reference/audit-chain-evidentiary-scope.md` is blunt
// about it: a backup written by this machine to storage this machine can still reach sits under
// the SAME write authority as the database. It becomes a witness only when retained OUTSIDE that
// authority — disconnected external media, or an evidenced custody arrangement. That is an
// operational commitment by the owner, not a guarantee this file can make, and nothing in the UI
// built on top of it may imply otherwise.

import { createHash } from "node:crypto";
import {
  accessSync, constants as FS, existsSync, mkdirSync, readdirSync, readFileSync, rmSync,
  statSync, writeFileSync, lstatSync, realpathSync,
} from "node:fs";
import path from "node:path";

// The subpath, NOT the package root. `case-box-persistence` re-exports
// `openSqliteCaseBoxPersistence`, which value-imports `better-sqlite3`; the desktop app's copy of
// that native module is built for ELECTRON's ABI and aborts the process on first use under plain
// `node`, which is how this module's tests run. `archive-verify` has no native binding in its
// import graph, and a test in backup-verified-integrity.test.mjs holds that line.
import { verifyAllAuditChains } from "case-box-persistence/archive-verify";

import { safeBasename } from "../caseBox/documentStorage.js";
import { verifyDocumentStore } from "../caseBox/documentVerify.js";
import type { DocumentVerifyRecord } from "../caseBox/documentVerify.js";

/** The minimal surface this module needs from better-sqlite3, so tests need no Electron ABI. */
export interface BackupCapableDb {
  backup(destination: string): Promise<{ totalPages: number }>;
  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
  /** Present on the handle we open over the ARCHIVE; absent on the live handle, which we never close. */
  close?(): void;
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

/**
 * Same physical volume? Compared by device id (`st_dev`), not by path prefix.
 *
 * A path comparison cannot answer this: `/Volumes/Backup` looks like another disk and may be a
 * folder on this one, while an APFS volume in the same container has a different mount point and
 * a different device id, which is the answer we want — a container is one piece of hardware but
 * a volume is what fails independently for the purposes that matter here.
 */
export function onSameVolume(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false; // if we cannot tell, do not claim they are the same
  }
}

/**
 * Stored in the manifest so a reader of the ARCHIVE — who may not have this source — knows that
 * files present but unlisted are not evidence. macOS writes `._*` sidecars onto exFAT and NTFS
 * volumes on its own, so an archive on removable media will generally contain some.
 */
export const MANIFEST_NOTE =
  "This manifest is authoritative: only the database file and the documents listed below are " +
  "part of this backup. Any other file present in this directory was added by the operating " +
  "system or the filesystem and is not evidentiary.";

export interface BackupManifest {
  readonly manifestVersion: 1;
  readonly note: string;
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
  | {
      readonly ok: true;
      readonly dir: string;
      readonly manifest: BackupManifest;
      /**
       * True when the archive landed on the SAME physical volume as the case box.
       *
       * Such a backup is real and it verifies — it survives a mistake made inside the app, a bad
       * migration, an accidental deletion. It survives nothing that happens to the disk. Reporting
       * it as simply "backed up" would be the false confidence this whole screen exists to
       * prevent, so the fact travels with the result rather than being inferred later from a path.
       */
      readonly sameVolume: boolean;
    }
  | { readonly ok: false; readonly code: BackupFailureCode; readonly detail: string };

export type BackupFailureCode =
  | "destination_inside_data_dir"
  | "destination_read_only"
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
  const hashes = new Set<string>();
  for (const doc of readDocumentRows(db).records) hashes.add(doc.content_hash);
  return [...hashes].sort();
}

/**
 * One registered document, as the archive's own database describes it.
 *
 * `id` is the ROW's primary key rather than the payload's, because the row key is the identity
 * the rest of the schema joins on. The payload carries its own `id`; a disagreement between the
 * two is corruption and is reported as such rather than silently resolved in either direction.
 */
export interface RegisteredDocument extends DocumentVerifyRecord {
  readonly byteSize: number | null;
  /** Where this document's bytes must be, relative to the document store root. Derived, never read. */
  readonly expectedRelativePath: string;
}

export interface DocumentRowReadResult {
  readonly records: RegisteredDocument[];
  /** Rows that could not be turned into a checkable record. NEVER silently dropped. */
  readonly findings: string[];
}

/**
 * Every row of `case_box_documents`, parsed — and every row that CANNOT be parsed, reported.
 *
 * `content_hash` is not a column: `case_box_documents` lifts only the fields its indices need
 * (status, doc_type, received_at, supersedes_document_id) and keeps the canonical record in
 * `payload_json`. Reading it therefore means parsing that JSON, which is why an unparseable row
 * is possible at all — and the previous version of this function `continue`d past one. That is
 * how a case box whose only document row was corrupt produced a `documents: 0` archive reported
 * as verified: the row that proved the archive was broken was the row that got skipped.
 *
 * A row this function cannot read is therefore a FINDING, not an omission. The set of documents
 * to verify must be derived from the number of rows, never from the number of rows that happened
 * to parse.
 */
export function readDocumentRows(db: BackupCapableDb): DocumentRowReadResult {
  const rows = db
    .prepare("SELECT id, payload_json FROM case_box_documents ORDER BY id")
    .all() as Array<{ id: string; payload_json: string }>;
  const records: RegisteredDocument[] = [];
  const findings: string[] = [];

  for (const row of rows) {
    const rowId = typeof row.id === "string" ? row.id : String(row.id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json);
    } catch {
      findings.push(`document row ${rowId}: its stored record is not valid JSON and cannot be checked`);
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      findings.push(`document row ${rowId}: its stored record is not an object`);
      continue;
    }
    const p = parsed as Record<string, unknown>;

    // The payload's own id must agree with the row key it is stored under. A payload id that
    // disagrees is either corruption or an attempt to make a record describe a different file.
    if (typeof p.id !== "string" || p.id !== rowId) {
      findings.push(
        `document row ${rowId}: the stored record identifies itself as ${JSON.stringify(p.id)}`,
      );
      continue;
    }
    if (typeof p.content_hash !== "string" || p.content_hash.length === 0) {
      findings.push(`document row ${rowId}: no content_hash, so nothing about its bytes can be proven`);
      continue;
    }
    if (typeof p.filename !== "string" || p.filename.length === 0) {
      findings.push(`document row ${rowId}: no filename, so its stored path cannot be derived`);
      continue;
    }

    records.push({
      id: rowId,
      filename: p.filename,
      content_hash: p.content_hash,
      byteSize: typeof p.byte_size === "number" ? p.byte_size : null,
      // Derived exactly as `storeDocumentFile` writes it and `verifyDocumentStore` reads it.
      // `storage_uri` is deliberately NOT consulted: it bakes in an absolute path containing the
      // macOS username, and an archive is going to be read on some other machine.
      expectedRelativePath: path.join(rowId, safeBasename(p.filename, rowId)),
    });
  }

  return { records, findings };
}

// `chainHeadDisagreements` USED TO LIVE HERE, and its removal is the point of this change rather
// than tidying around it. It compared `event_count == COUNT(*) == MAX(sequence)` and was the ONLY
// thing standing behind the word "verified" for the audit chain. A count comparison cannot see an
// edited event payload, a rewritten prev-link or a moved head, and because it read its matter list
// FROM `case_box_audit_chain_heads`, deleting a head deleted the matter from the check.
//
// The invariant it did carry is real and is kept — `verifyAllAuditChains` performs it per matter
// as `head_count_mismatch` / `sequence_gap`, alongside the full chain verification, over a matter
// set that no single deletion can shrink. Leaving the old function exported but uncalled would
// have left a tested, plausible-looking verifier for the next person to wire back in.

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
 * Four questions, because a backup can pass any three and still be worthless:
 *   1. is the database file itself sound?               -> integrity_check + databaseSha256
 *   2. do the audit chains it carries hold together?    -> verifyAllAuditChains
 *   3. does EVERY document row still describe a file?   -> readDocumentRows + verifyDocumentStore
 *   4. do the bytes that were copied still hash right?  -> the manifest re-read
 *
 * (2) and (3) are the two this module previously answered with cheaper proxies — a count
 * comparison and a hash-set intersection — and both proxies certified corrupt archives. The
 * distinction that matters in (3) is between "a file with this digest exists in the archive" and
 * "the file THIS RECORD points at exists in the archive": only the second is reference integrity,
 * and only the second refuses a renamed exhibit or two records sharing one digest where one of
 * their files is gone.
 *
 * Async because per-document verification streams and hashes each file. Everything it touches is
 * inside the archive; the source case box is not read here at all.
 */
export async function verifyBackup(
  backupDb: BackupCapableDb & { pragma?: (s: string, o?: unknown) => unknown },
  manifest: BackupManifest,
  documentsDir: string,
): Promise<string[]> {
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

  // THE AUDIT CHAINS, in full, over every matter the archive mentions anywhere — not only those
  // with a chain-head row, because deleting a head is one of the tampers being looked for and a
  // head-driven query lets it delete its own entry from the list of things to check.
  const chains = verifyAllAuditChains(backupDb);
  for (const f of chains.findings) findings.push(`audit chain: ${f.detail}`);

  // A verification that examined nothing is not a pass. `chainHeads` is read from the same
  // archive, so a database that lost its matters entirely would otherwise sail through with an
  // empty manifest and no findings at all.
  if (chains.mattersChecked === 0 && manifest.chainHeads.length > 0) {
    findings.push(
      `the archive lists ${manifest.chainHeads.length} chain heads but no matter could be verified`,
    );
  }

  // EVERY DOCUMENT ROW, INDIVIDUALLY. Rows that cannot be parsed are findings in their own right;
  // the rest are verified by identity and derived path, not by digest membership.
  const { records, findings: rowFindings } = readDocumentRows(backupDb);
  findings.push(...rowFindings);

  const store = await verifyDocumentStore(records, { storageRoot: documentsDir });
  for (const id of store.missing) {
    findings.push(`document ${id} is registered but its file is not at its expected path in the archive`);
  }
  for (const id of store.mismatched) {
    findings.push(`document ${id} is present but its bytes do not match the recorded content_hash`);
  }
  for (const u of store.unverifiable) {
    findings.push(`document ${u.id} could not be verified (${u.reason})`);
  }
  if (store.checked !== records.length) {
    findings.push(`only ${store.checked} of ${records.length} document records were examined`);
  }

  // Each record's derived path must also be one the MANIFEST lists, with the same digest and
  // size. Without this the database and the manifest could describe two different archives — the
  // documents present and correct, and the manifest a reader is told is authoritative not naming
  // them.
  const manifestByPath = new Map(manifest.documents.map((d) => [d.relativePath, d]));
  for (const r of records) {
    const entry = manifestByPath.get(r.expectedRelativePath);
    if (entry === undefined) {
      findings.push(`document ${r.id} is registered but the manifest does not list its file`);
      continue;
    }
    if (entry.sha256.toLowerCase() !== r.content_hash.toLowerCase()) {
      findings.push(`document ${r.id}: the manifest records a different digest than the record does`);
    }
    if (r.byteSize !== null && entry.byteSize !== r.byteSize) {
      findings.push(
        `document ${r.id}: the record says ${r.byteSize} bytes, the archive holds ${entry.byteSize}`,
      );
    }
  }

  // Every hash the RESTORED database would look for must also be present in the copied bytes.
  // Subsumed by the per-document check above for well-formed rows, and kept because it is the one
  // question that stays answerable when a row's derived path is itself in doubt.
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

  // A READ-ONLY VOLUME IS ITS OWN ANSWER, and it deserves its own one.
  //
  // This is the single likeliest real-world failure, not an exotic one: external drives ship
  // NTFS-formatted from the factory, and macOS mounts NTFS READ-ONLY. Measured on exactly such a
  // drive — a 1 TB Seagate with 445 GB free, connected and visible in Finder, and completely
  // unwritable. "Check the disk is connected and has space" is true, useless, and sends the owner
  // to look at the two things that are already fine.
  //
  // The probe is `access(W_OK)` rather than a trial mkdir because `mkdirSync(recursive: true)`
  // reports ENOENT for this — the recursive walk fails on the child before the kernel ever
  // returns EROFS for the parent — so a mkdir-based guess would name the wrong cause. Measured:
  // access -> EROFS, mkdir(single) -> EROFS, mkdir(recursive) -> ENOENT.
  try {
    accessSync(options.destinationRoot, FS.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EROFS") {
      return {
        ok: false,
        code: "destination_read_only",
        detail: "the volume is mounted read-only",
      };
    }
    return { ok: false, code: "destination_unusable", detail: `not writable (${String(code)})` };
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
    note: MANIFEST_NOTE,
    appVersion: options.appVersion,
    schemaVersion: options.schemaVersion,
    createdAt: now().toISOString(),
    databaseFile: DB_FILENAME,
    databaseSha256: sha256File(dbFile),
    chainHeads: chainHeads(backupDb),
    documents,
    referencedContentHashes: referencedContentHashes(backupDb),
  };

  const findings = await verifyBackup(backupDb, manifest, docsDir);

  // CLOSE THE ARCHIVE HANDLE, then remove the WAL sidecars OUR OWN read opened.
  //
  // `db.backup()` writes one complete file. Opening it — even read-only — makes SQLite create
  // `-wal` and `-shm` beside it, and leaving the handle open kept them there. Found by writing a
  // real archive to a real external volume and listing it: a 0-byte `-wal` and a 32 KB `-shm`
  // sitting in an evidentiary archive that the manifest does not list. An archive whose contents
  // exceed its manifest cannot tell a reader which files are the evidence, which is the whole job
  // of having a manifest. They are artifacts of verification, not part of the snapshot, so they go.
  //
  // (macOS still writes `._*` AppleDouble sidecars on exFAT/NTFS volumes, which no application can
  // prevent. The manifest is authoritative about what is evidentiary; see MANIFEST_NOTE.)
  backupDb.close?.();
  for (const sidecar of [`${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      if (existsSync(sidecar)) rmSync(sidecar);
    } catch {
      // Leaving a sidecar behind is untidy, not unsafe: the manifest still says what counts.
    }
  }

  if (findings.length > 0) {
    return { ok: false, code: "verification_failed", detail: findings.join("; ") };
  }

  // The manifest is written only AFTER verification passes, so a manifest on disk always means a
  // verified archive. A half-written archive carrying a confident manifest is worse than none.
  writeFileSync(path.join(dir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), "utf-8");
  return {
    ok: true,
    dir,
    manifest,
    sameVolume: onSameVolume(options.userDataDir, dir),
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
