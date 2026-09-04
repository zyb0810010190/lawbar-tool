// backupHandlers.ts — the main-process side of "Back Up Now" and "how am I doing?".
//
// THE RENDERER NEVER SUPPLIES A PATH. It asks to back up; MAIN opens the native directory
// chooser and MAIN writes. That is the same invariant `chooseDocumentFile` and the T3 export
// already hold, and it is what stops a compromised or merely buggy renderer from naming an
// arbitrary destination for a copy of the entire case box.
//
// FAILURES CARRY A CODE, NOT A MESSAGE. `runBackup` produces detail strings that can contain a
// filesystem path, and a path can contain a client's name — people name external drives after
// the matter they are working on. The renderer receives only a fixed code it maps to its own
// catalog string, so nothing derived from the filesystem reaches the screen. Same reasoning as
// `unhandledRejectionNotice`: a banner gets photographed and pasted into a bug report.

import type { BackupCapableDb, BackupFailureCode } from "./runBackup.js";
import { runBackup } from "./runBackup.js";
import { loadBackupRecord, saveBackupRecord, daysSince } from "../persistence/backupRecord.js";
import type { BackupRecord } from "../persistence/backupRecord.js";

export const BACKUP_CHANNEL = {
  run: "backup:run",
  status: "backup:status",
} as const;

/** What the renderer is allowed to know. Deliberately code-only — see the header. */
export type BackupRunResult =
  | { readonly ok: true; readonly verifiedAt: string }
  | { readonly ok: false; readonly code: BackupFailureCode | "cancelled" };

export interface BackupStatus {
  readonly lastVerifiedAt: string | null;
  readonly daysSinceLastVerified: number | null;
  readonly hasEverBackedUp: boolean;
  /** The last verified archive is on the same disk as the case box, so it survives no hardware loss. */
  readonly lastBackupOnSameVolume: boolean;
}

export interface BackupHandlerDeps {
  readonly userDataDir: string;
  readonly documentsRoot: string;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly getDb: () => BackupCapableDb;
  readonly openBackupDb: (file: string) => BackupCapableDb & { pragma?: (s: string, o?: unknown) => unknown };
  /** Native directory chooser, owned by main. Returns null when the owner cancels. */
  readonly chooseDestination: () => Promise<string | null>;
  readonly now?: () => Date;
}

export function backupStatusHandler(deps: BackupHandlerDeps): BackupStatus {
  const now = deps.now ?? (() => new Date());
  const record: BackupRecord = loadBackupRecord(deps.userDataDir);
  return {
    lastVerifiedAt: record.lastVerifiedAt,
    daysSinceLastVerified: daysSince(record, now()),
    hasEverBackedUp: record.lastVerifiedAt !== null,
    lastBackupOnSameVolume: record.lastVerifiedAt !== null && record.lastVerifiedSameVolume,
  };
}

export async function backupRunHandler(deps: BackupHandlerDeps): Promise<BackupRunResult> {
  const now = deps.now ?? (() => new Date());
  const destinationRoot = await deps.chooseDestination();
  if (destinationRoot === null) return { ok: false, code: "cancelled" };

  const outcome = await runBackup(
    {
      db: deps.getDb(),
      documentsRoot: deps.documentsRoot,
      userDataDir: deps.userDataDir,
      destinationRoot,
      appVersion: deps.appVersion,
      schemaVersion: deps.schemaVersion,
      now,
    },
    deps.openBackupDb,
  );

  if (!outcome.ok) {
    // The record is NOT touched on failure. A failed run must never advance "last backup",
    // and must never quietly retire the last good one either.
    return { ok: false, code: outcome.code };
  }

  const verifiedAt = outcome.manifest.createdAt;
  saveBackupRecord(deps.userDataDir, {
    lastVerifiedAt: verifiedAt,
    lastVerifiedDir: outcome.dir,
    lastDestinationRoot: destinationRoot,
    lastVerifiedSameVolume: outcome.sameVolume,
  });
  return { ok: true, verifiedAt };
}
