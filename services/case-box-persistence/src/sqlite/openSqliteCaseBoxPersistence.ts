// Convenience factory: open an in-memory or file-backed SQLite database,
// apply local-durability/perf pragmas, run applySchema, and return a
// ready-to-use SqliteCaseBoxPersistence. Mirrors
// services/ocr-persistence/src/sqlite/openSqliteOcrPersistence.ts.
//
// The caller must keep a reference to the returned `db` to close it.

import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";

import path from "node:path";

import { CaseBoxPersistenceError } from "../errors.js";
import { applySchema } from "./schema.js";
import { SqliteCaseBoxPersistence } from "./SqliteCaseBoxPersistence.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * Why a failed integrity check is not automatically corruption.
 *
 * `quick_check` throws for reasons that have nothing to do with the bytes: another
 * connection holding a lock past `busy_timeout`, an unreadable path, an I/O error. The
 * first version of this gate treated every throw as corruption, so a HEALTHY case file
 * open in a second window was reported to the litigator as having failed its integrity
 * check, and an incident directory of "suspect" bytes was written beside it. For a
 * court-facing tool that is the exact defect class this gate exists to remove, committed
 * by the gate itself.
 *
 * The default for an UNRECOGNISED code is `unavailable`, not `corrupt`. That looks like
 * the less cautious choice and is not: WI03-13 proves a refused open leaves the original
 * byte-identical, so declining to take a copy loses nothing — the bytes are still on
 * disk. Asserting corruption, by contrast, is a claim about the user's evidence that we
 * cannot support from an unknown error code.
 */
type OpenFailureClass = "corrupt" | "locked" | "unavailable";

function classifyOpenFailure(e: unknown): OpenFailureClass {
  const raw = (e as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" ? raw : "";
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ||
      code.startsWith("SQLITE_BUSY_") || code.startsWith("SQLITE_LOCKED_")) return "locked";
  if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB" ||
      code.startsWith("SQLITE_CORRUPT_")) return "corrupt";
  return "unavailable";
}

export interface OpenSqliteCaseBoxPersistenceOptions {
  /** SQLite path. Defaults to `:memory:`. */
  readonly path?: string;
  /** Clock injection for deterministic timestamps in tests. */
  readonly now?: () => Date;
  /** ULID-shape id generator injection. Required for createMatter audit events. */
  readonly generateId?: () => string;
  /** SQLite busy_timeout in ms. Default 5000. */
  readonly busyTimeoutMs?: number;
  /**
   * ADDITIONAL integrity check, for exercising the spurious-failure path in tests.
   *
   * It can only ADD a failure, never suppress one: the real `PRAGMA quick_check` runs
   * unconditionally and its verdict is honoured first. An earlier draft let this REPLACE
   * the check, which meant any production caller could pass `() => null` and silently
   * disable the gate with nothing logged or refused — a supplied-by-the-caller false
   * green in the one place the product cannot afford one.
   */
  readonly additionalIntegrityCheck?: (db: BetterSqlite3Database) => string | null;
}

/**
 * `PRAGMA integrity_check` returns exactly one row reading "ok" when the file is valid
 * SQLite AND every index still agrees with the rows it points at.
 *
 * This was `quick_check`, and the difference is not speed — it is scope. quick_check
 * counts index entries but does not verify their CONTENT. A database whose index has gone
 * stale against its table passes quick_check with "ok" while returning two different
 * answers to one query depending on whether the planner uses the index: measured in
 * WI03-16, an indexed lookup yields a row that a table scan proves is gone. In a tool
 * whose lists are evidence, that is a silent wrong answer with the audit chain intact.
 *
 * Measured cost of the stronger check on this machine: +5 ms at 5 MB, +81 ms at 50 MB —
 * free against Electron's own start-up, so there is no trade-off to weigh.
 *
 * What it still does NOT prove: that this is a case-box store (see the identity gate
 * below), or that the audit history is untampered (that is `verifyAuditChainForMatter`,
 * and the chain cannot detect a consistent truncation at all). Do not let this check be
 * described as proving the database is trustworthy.
 */
function integrityCheck(db: BetterSqlite3Database): string | null {
  const rows = db.pragma("integrity_check") as { integrity_check?: string }[];
  if (rows.length === 1 && String(rows[0]?.integrity_check ?? "").trim() === "ok") return null;
  return rows.map((r) => String(r.integrity_check ?? "")).join("; ").slice(0, 400);
}

/**
 * Preserve the suspect bytes, then say honestly whether the preserved copy is usable.
 *
 * THREE KNOWN LIMITS, stated rather than implied — all raised by audit and deliberately
 * NOT closed here, because each needs a change wider than this work item:
 *
 *  - The first connection is read-write/create, so SQLite may recover or create sidecars
 *    before this runs. Closing it needs a read-only probing pass before the real open.
 *  - main/-wal/-shm are copied as three independent reads with no lock, so a concurrent
 *    writer could produce a copy corrupt in a different way than the original. Closing it
 *    needs an app-level write lock or `sqlite3_backup`.
 *  - Copies and the marker are written to their final names, not temp-plus-rename, so a
 *    crash mid-preservation can leave a partial artefact.
 *
 * Single-user, single-process, offline is the app's actual deployment, which is why these
 * rank below the identity and marker-truthfulness defects that were fixed.
 *
 * The `.verified` marker is written ONLY when the copy passes its own integrity check.
 * A byte-copy of a corrupt database is corrupt, so on genuine corruption there will be a
 * copy and no marker — which is the truthful outcome. A marker beside an unusable copy
 * would claim recovery is possible when it is not.
 */
function preserveCopy(dbPath: string, stamp: string): { copyPath: string; verified: boolean; note: string } | null {
  if (dbPath === ":memory:" || !existsSync(dbPath)) return null;
  // A UNIQUE incident directory per failure. A fixed `<path>.repair.tmp` silently
  // overwrote the copy from an earlier incident — destroying forensic evidence — and,
  // worse, left a `.verified` marker from a previous SPURIOUS failure sitting beside a
  // freshly-copied CORRUPT database. That is precisely the false claim this design exists
  // to prevent, reintroduced by reusing a filename.
  const incidentDir = `${dbPath}.repair-${stamp}`;
  const copyPath = path.join(incidentDir, path.basename(dbPath));
  const copied: string[] = [];
  try {
    mkdirSync(incidentDir, { recursive: false });
    copyFileSync(dbPath, copyPath);
    copied.push(copyPath);
    // WAL/SHM sidecars carry committed data that has not been checkpointed. Copying the
    // main file alone would silently drop it and produce a "verified" copy missing the
    // most recent writes.
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) {
        copyFileSync(dbPath + suffix, copyPath + suffix);
        copied.push(copyPath + suffix);
      }
    }
  } catch (e) {
    // Do not swallow: disk-full and permission-denied are the likeliest reasons a
    // preservation fails, and the operator needs to know which.
    return { copyPath: incidentDir, verified: false, note: `preservation FAILED: ${(e as Error).message}` };
  }
  let verified = false;
  let copy: BetterSqlite3Database | undefined;
  try {
    copy = new Database(copyPath, { readonly: true });
    const rows = copy.pragma("integrity_check") as { integrity_check?: string }[];
    verified = rows.length === 1 && String(rows[0]?.integrity_check ?? "").trim() === "ok";
  } catch {
    verified = false;
  } finally {
    try { copy?.close(); } catch { /* closing a corrupt handle may throw */ }
  }
  if (verified) {
    try {
    writeFileSync(
      `${copyPath}.verified`,
      `integrity_check = ok\nsource = ${dbPath}\n` +
        `verified_set =\n${copied.map((f) => `  ${f}`).join("\n")}\n` +
        `The FILE SET above — not the main database alone — is what passed verification.\n` +
        `A WAL sidecar can hold committed data that has not been checkpointed, so\n` +
        `recovering only the main file may silently lose the most recent evidence.\n`,
    );
    } catch (e) {
      // A verified copy whose marker could not be written is still a verified copy; say so
      // rather than letting a filesystem error escape as something other than corruption.
      return { copyPath, verified, note: `copy verified but the marker could not be written: ${(e as Error).message}` };
    }
  }
  return { copyPath, verified, note: "" };
}

export interface OpenSqliteCaseBoxPersistenceResult {
  readonly persistence: SqliteCaseBoxPersistence;
  readonly db: BetterSqlite3Database;
}

export function openSqliteCaseBoxPersistence(
  options: OpenSqliteCaseBoxPersistenceOptions = {},
): OpenSqliteCaseBoxPersistenceResult {
  const dbPath = options.path ?? ":memory:";

  // D-6. A case file truncated to zero bytes — a full disk mid-write, an interrupted copy, a
  // botched restore, a sync client swapping it for a placeholder — is a VALID EMPTY DATABASE
  // as far as SQLite is concerned. It passed every gate below: integrity_check returned "ok",
  // the identity gate saw no foreign tables, applySchema stamped fresh tables in, and the
  // litigator got a working app showing no matters. Nothing refused and nothing warned. For a
  // court-facing tool that is worse than corruption, because corruption at least announces
  // itself: this silently substitutes an empty store for the record.
  //
  // The discriminator needs no marker file, no new option on this seam, and no migration. A
  // genuine first run has NO file at all — the driver creates it, and it is 4096 bytes once
  // the schema lands. So "the file exists and is zero bytes" is a state a first install never
  // produces. Measured, and pinned by WI03-10 (first run, no file) and WI03-17 (truncation).
  //
  // This check comes FIRST, before the connection is even opened, because failing closed has
  // to mean the suspect file is left exactly as found. Opening it would create the header and
  // destroy the evidence that it had been emptied.
  if (dbPath !== ":memory:" && existsSync(dbPath) && statSync(dbPath).size === 0) {
    throw new CaseBoxPersistenceError(
      "database_empty",
      `refusing to open: the case-box database at ${dbPath} exists but is empty (0 bytes). ` +
        `A new install has no file here at all, so an empty one means something truncated it ` +
        `— a full disk, an interrupted copy, or a failed restore. Restore from a backup. If ` +
        `you intend to start a new, blank case box instead, delete this empty file first.`,
    );
  }
  // Construction sat outside every try, so a missing parent directory or an unreadable
  // file escaped as a raw driver throw — sometimes a TypeError with no `code` at all —
  // past the domain-error contract callers are told to switch on.
  let db: BetterSqlite3Database;
  try {
    db = new Database(dbPath);
  } catch (e) {
    throw new CaseBoxPersistenceError(
      "database_unavailable",
      `refusing to open: the case-box database could not be opened — ${(e as Error).message}`,
    );
  }

  // Integrity BEFORE any pragma that writes. `journal_mode = WAL` mutates the file
  // header, so checking afterwards would mean writing to a database already known to be
  // untrustworthy.
  // Connection-local, writes nothing to the file, and must precede the check: without it
  // a HEALTHY database briefly held by another process fails instantly — a false red that
  // locks the litigator out of their own case file.
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);

  let failure: string | null;
  try {
    failure = integrityCheck(db);
    // Additive only. Never allowed to clear a real failure.
    if (failure === null && options.additionalIntegrityCheck) {
      failure = options.additionalIntegrityCheck(db);
    }
  } catch (e) {
    // SQLITE_NOTADB, SQLITE_CORRUPT and malformed headers make the pragma itself throw.
    // Unhandled, that escaped as a raw driver error, skipped preservation entirely, and
    // never produced the domain error callers are told to expect. But a throw is NOT
    // proof of corruption — see classifyOpenFailure.
    const kind = classifyOpenFailure(e);
    if (kind !== "corrupt") {
      db.close();
      throw new CaseBoxPersistenceError(
        kind === "locked" ? "database_locked" : "database_unavailable",
        kind === "locked"
          ? `refusing to open: the case-box database is locked by another process — ` +
            `${(e as Error).message}. The database was NOT examined and is not suspect; ` +
            `close the other window and retry.`
          : `refusing to open: the integrity check could not run — ${(e as Error).message}. ` +
            `The database was NOT examined and is not suspect.`,
      );
    }
    failure = `integrity check could not run: ${(e as Error).message}`;
  }
  if (failure !== null) {
    const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const preserved = preserveCopy(dbPath, stamp);
    db.close();
    const where = preserved === null
      ? " The suspect bytes could NOT be preserved (no file on disk to copy)."
      : preserved.note.startsWith("preservation FAILED")
      ? ` The suspect bytes could NOT be preserved: ${preserved.note}.`
      : ` A copy of the suspect database was preserved at ${preserved.copyPath}` +
        (preserved.verified
          ? " and independently verified as usable for recovery."
          : "; that copy did NOT pass its own integrity check, so no .verified marker was written.") +
        (preserved.note ? ` (${preserved.note})` : "");
    throw new CaseBoxPersistenceError(
      "database_corrupt",
      `refusing to open: the case-box database failed its integrity check — ${failure}.${where}`,
    );
  }

  // IDENTITY, not just structure. quick_check proves the file is valid SQLite; it says
  // nothing about WHOSE database it is. Without this, pointing the app at an unrelated
  // .db — a mis-restore, a wrong path — passed the gate and applySchema then stamped
  // case-box tables INTO it. That is data destruction in another application's file, not
  // merely a trust gap, and it is why deferring this check was not defensible.
  //
  // An EMPTY database is the ordinary first-run case and is initialised normally. Only a
  // populated file that carries no case-box table is refused.
  const existingTables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  if (existingTables.length > 0 && !existingTables.some((t) => t.startsWith("case_box_"))) {
    db.close();
    throw new CaseBoxPersistenceError(
      "database_not_case_box",
      `refusing to open: ${dbPath} is a valid SQLite database but holds no case-box tables ` +
        `(found: ${existingTables.slice(0, 6).join(", ")}). Opening it would write case-box ` +
        `schema into another application's data. Nothing was modified.`,
    );
  }

  // WAL = concurrent readers + single writer without blocking.
  // synchronous=NORMAL pairs with WAL for durable-across-process-crash.
  // busy_timeout defends transient contention from concurrent writers.
  // foreign_keys=ON is defensive (case-box declares NO FK constraints).
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
  db.pragma("foreign_keys = ON");

  // applySchema uses real wall-clock for schema_version.applied_at — NOT
  // the caller's injected clock. The migration timestamp is internal
  // bookkeeping and must not consume the test clock's ticks (would skew
  // matter/audit-event timestamps by one tick versus the in-memory impl).
  applySchema(db);

  const persistence = new SqliteCaseBoxPersistence({
    db,
    now: options.now,
    generateId: options.generateId,
  });
  return { persistence, db };
}
