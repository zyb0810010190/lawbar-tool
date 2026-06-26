import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  InMemoryCaseBoxPersistence,
  openSqliteCaseBoxPersistence,
} from "case-box-persistence";
import type {
  CaseBoxPersistence,
  SqliteCaseBoxPersistence,
  OpenSqliteCaseBoxPersistenceResult,
} from "case-box-persistence";

const CASE_BOX_DB_FILENAME = "case-box.sqlite";

// The raw better-sqlite3 Database handle, sourced through the persistence
// package's typed surface (the desktop app does not ship @types/better-sqlite3).
type SqliteDatabase = OpenSqliteCaseBoxPersistenceResult["db"];

interface Runtime {
  readonly persistence: CaseBoxPersistence;
  readonly dbPath: string | null;
  // SQLite-only handles for the Evidence link lifecycle. Both null in the
  // pure-unit-test InMemory fallback (the link IPC requires the SQLite runtime).
  readonly sqlite: SqliteCaseBoxPersistence | null;
  readonly db: SqliteDatabase | null;
  readonly close: () => void;
}

export interface CaseBoxRuntimeOptions {
  readonly userDataDir?: string;
  readonly dbPath?: string;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

let runtime: Runtime | null = null;

function resolveDbPath(options: CaseBoxRuntimeOptions): string | null {
  if (options.dbPath !== undefined) return options.dbPath;
  if (options.userDataDir !== undefined) {
    return path.join(options.userDataDir, CASE_BOX_DB_FILENAME);
  }
  return null;
}

export function getCaseBoxRuntime(options: CaseBoxRuntimeOptions = {}): Runtime {
  if (runtime !== null) return runtime;

  const dbPath = resolveDbPath(options);
  if (dbPath === null) {
    // Pure unit-test fallback only. Electron main MUST pass userDataDir so
    // product runtime is file-backed SQLite.
    runtime = {
      persistence: new InMemoryCaseBoxPersistence(),
      dbPath: null,
      sqlite: null,
      db: null,
      close: () => undefined,
    };
    return runtime;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const opened = openSqliteCaseBoxPersistence({
    path: dbPath,
    now: options.now,
    generateId: options.generateId,
  });

  runtime = {
    persistence: opened.persistence,
    dbPath,
    sqlite: opened.persistence,
    db: opened.db,
    close: () => opened.db.close(),
  };
  return runtime;
}

export function closeCaseBoxRuntime(): void {
  if (runtime !== null) {
    runtime.close();
    runtime = null;
  }
}

export function _isCaseBoxRuntimeInitializedForTesting(): boolean {
  return runtime !== null;
}

export function _getCaseBoxRuntimeDbPathForTesting(): string | null {
  return runtime?.dbPath ?? null;
}
