import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  InMemoryCaseBoxPersistence,
  openSqliteCaseBoxPersistence,
} from "case-box-persistence";
import type { CaseBoxPersistence } from "case-box-persistence";

const CASE_BOX_DB_FILENAME = "case-box.sqlite";

interface Runtime {
  readonly persistence: CaseBoxPersistence;
  readonly dbPath: string | null;
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
