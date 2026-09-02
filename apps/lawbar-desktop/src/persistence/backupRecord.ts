// backupRecord.ts — what the app remembers about the last VERIFIED backup.
//
// Only verified backups are recorded. A run that copied bytes and then failed verification
// leaves this file untouched, so "last backup" can never name an archive we could not prove.
// That is the whole point: on a removable drive the common failure is not a crash, it is a
// half-written archive on a disk that was unplugged, and a UI that reports that as success is
// worse than a UI that reports nothing.
//
// WHAT IS DELIBERATELY NOT STORED: the destination path is kept, and nothing else about the
// case box. No matter names, no document filenames, no counts that could identify a client.
// This file sits in the app data directory unencrypted-at-rest relative to the case box itself,
// and it is the kind of file that gets opened when someone is debugging.
//
// The destination path IS kept, because "where did I last back up to" is the question the owner
// actually needs answered, and a path they chose themselves tells them nothing they did not
// already know. It is shown back to them only in their own UI.

import fs from "node:fs";
import path from "node:path";

const FILENAME = "backup-record.json";
const SCHEMA_VERSION = 1;

export interface BackupRecord {
  readonly version: 1;
  /** ISO timestamp of the last backup that PASSED verification, or null if there has never been one. */
  readonly lastVerifiedAt: string | null;
  /** Directory the verified archive was written into, or null. */
  readonly lastVerifiedDir: string | null;
  /** The destination root the owner last chose, remembered so the next backup can offer it. */
  readonly lastDestinationRoot: string | null;
}

export const NO_BACKUP: BackupRecord = {
  version: SCHEMA_VERSION,
  lastVerifiedAt: null,
  lastVerifiedDir: null,
  lastDestinationRoot: null,
};

function isIsoLike(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v);
}

function nullableString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * A missing, unparseable or schema-violating file reads as NO BACKUP — never as a stale success.
 * Failing open here would tell the owner they are protected on the strength of a corrupt file.
 */
export function loadBackupRecord(userDataDir: string): BackupRecord {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(userDataDir, FILENAME), "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return NO_BACKUP;
    const o = parsed as Record<string, unknown>;
    if (o.version !== SCHEMA_VERSION) return NO_BACKUP;
    const at = isIsoLike(o.lastVerifiedAt) ? o.lastVerifiedAt : null;
    const dir = nullableString(o.lastVerifiedDir);
    // A timestamp without a directory (or the reverse) is a half-written record; trust neither.
    if ((at === null) !== (dir === null)) return NO_BACKUP;
    return {
      version: SCHEMA_VERSION,
      lastVerifiedAt: at,
      lastVerifiedDir: dir,
      lastDestinationRoot: nullableString(o.lastDestinationRoot),
    };
  } catch {
    return NO_BACKUP;
  }
}

export function saveBackupRecord(userDataDir: string, record: Omit<BackupRecord, "version">): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const payload: BackupRecord = { version: SCHEMA_VERSION, ...record };
  fs.writeFileSync(path.join(userDataDir, FILENAME), JSON.stringify(payload), "utf-8");
}

/** Whole days since the last verified backup, or null when there has never been one. */
export function daysSince(record: BackupRecord, now: Date): number | null {
  if (record.lastVerifiedAt === null) return null;
  const then = Date.parse(record.lastVerifiedAt);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}
