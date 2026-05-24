// Native-module smoke probe (Packaging Smoke WI-B; Option A).
// Per dev-memo/plan-packaging-smoke-wib-00.md §2 fallback (selected
// after the Option B file:-link packaging attempt hit an
// electron-builder limitation with cross-package symlinks).
//
// Loads `better-sqlite3` (the native N-API binding) inside the
// Electron-packaged binary. Opens an ISOLATED TEMP database (NOT
// `~/Library/Application Support/lawbar/lawbar.db` — that would
// persist real-ish user data and is out of scope), creates a
// trivial table, inserts one row, reads it back, closes, removes
// the file. Returns a small status envelope.
//
// **Coverage scope (per Option A explicit acknowledgement)**: this
// probe proves only that `better-sqlite3`'s native binding loads
// + executes under Electron's Node ABI. It does NOT prove
// `case-box-persistence` packaging works, does NOT prove
// `case-box-contract` (Ajv) packaging works, does NOT prove the
// audit-chain logic loads. Those are SEPARATE later WIs.
//
// MUST NOT depend on the host filesystem beyond the OS temp dir.
// MUST NOT open a BrowserWindow. MUST NOT touch nativeTheme.

// @ts-expect-error -- @types/better-sqlite3 is intentionally NOT added
// as a devDep in this WI (lane authorization is for the runtime dep
// only; types are out of scope). Minimal inline type declared below.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface BetterSqlite3DatabaseLike {
  pragma(p: string): void;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number };
    get(...args: unknown[]): unknown;
  };
  close(): void;
}

interface BetterSqlite3Ctor {
  new (path: string): BetterSqlite3DatabaseLike;
}

const DatabaseTyped: BetterSqlite3Ctor = Database as unknown as BetterSqlite3Ctor;

export interface ProbeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly durationMs?: number;
}

export async function runCaseBoxProbe(): Promise<ProbeResult> {
  const t0 = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawbar-probe-"));
  const dbPath = path.join(tmpDir, "probe.db");
  let db: BetterSqlite3DatabaseLike | null = null;
  try {
    // Open an isolated on-disk SQLite — exercises the same native
    // open() + file-open path that case-box-persistence will use
    // when first case-box-aware screens land.
    db = new DatabaseTyped(dbPath);
    db.pragma("journal_mode = WAL");

    db.exec("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO probe (id, value) VALUES (?, ?)");
    insert.run(1, "probe-value");

    const row = db.prepare("SELECT id, value FROM probe WHERE id = ?").get(1) as
      | { id: number; value: string }
      | undefined;

    if (row === undefined) {
      return { ok: false, error: "SELECT returned no row after INSERT" };
    }
    if (row.id !== 1) {
      return { ok: false, error: `row.id ${row.id} !== 1` };
    }
    if (row.value !== "probe-value") {
      return { ok: false, error: `row.value ${row.value} !== probe-value` };
    }

    return { ok: true, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    if (db !== null) {
      try { db.close(); } catch { /* probe is exiting; ignore close errors */ }
    }
    // Best-effort cleanup of the temp SQLite + WAL/SHM siblings.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // probe is exiting; ignore
    }
  }
}
