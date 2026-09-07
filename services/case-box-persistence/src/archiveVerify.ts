// Whole-database audit-chain verification, for a reader who holds a database file and no app.
//
// WHY THIS IS ITS OWN MODULE, AND ITS OWN EXPORT SUBPATH.
//
// The desktop backup engine needs to answer "does every audit chain in this archive hold?" and
// had been answering it with a COUNT COMPARISON — `event_count == COUNT(*) == MAX(sequence)` —
// which cannot see an edited event payload, a rewritten prev-link, or a moved head. Reproduced
// on 2026-09-06: a matter whose first event JSON was edited, and a matter whose head row was
// deleted, both produced a backup reported as VERIFIED, while this package's own verifier
// rejected each of them. The fix is not a better check in the desktop app; it is to stop having
// a second, weaker verifier at all.
//
// It cannot simply import the package root. `./dist/index.js` re-exports
// `openSqliteCaseBoxPersistence`, which VALUE-imports `better-sqlite3`. The desktop app's copy of
// that native module is rebuilt for ELECTRON's ABI by its postinstall, so loading it under plain
// `node` — which is how the desktop test lane runs — is a trap: `require` succeeds and the
// process aborts on first use. This module's import graph is `auditRepoQueries` +
// `case-box-contract` + `node:crypto` and contains no native binding, so the subpath
// `case-box-persistence/archive-verify` is safe from a Node test, from Electron's main process,
// and from a future restore tool alike.
//
// READ-ONLY, AND SAYS SO. Every statement here is a SELECT. Nothing opens the database
// read-write, applies a schema, or migrates: verifying an archive must not become the act that
// modifies it. That is why this takes a caller-supplied handle rather than opening its own.

import type { Database } from "better-sqlite3";

import { CaseBoxPersistenceError } from "./errors.js";
import { verifyAuditChainForMatterSqlite } from "./sqlite/auditRepoQueries.js";
import { CURRENT_SCHEMA_VERSION, readMaxSchemaVersion } from "./sqlite/schema.js";

/**
 * The newest schema this build understands, re-exported HERE rather than reached through the
 * package root.
 *
 * The root re-exports `openSqliteCaseBoxPersistence`, which value-imports `better-sqlite3`; a
 * consumer that only wants to inspect an archive must not be made to load a native binding to
 * learn a number. `schema.ts` itself imports the driver as a TYPE only, so pulling it in here
 * keeps this subpath free of native code — a property a desktop test asserts by hooking
 * `process.dlopen`.
 */
export { CURRENT_SCHEMA_VERSION };

/**
 * The slice of a better-sqlite3 handle this needs. Structural on purpose: a caller holding an
 * ARCHIVE opened read-only should not have to depend on the driver's types to pass it in.
 */
export interface ChainReadableDb {
  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
}

export type ArchiveChainReason =
  | "chain_invalid"        // the contract verifier rejected the event sequence itself
  | "orphan_audit_rows"    // audit events or a head row exist for a matter that does not
  | "head_count_mismatch"  // the head row's declared event_count disagrees with the events
  | "sequence_gap"         // COUNT(*) and MAX(sequence) disagree: an event was removed
  | "verifier_error";      // the verifier threw for a reason other than a missing matter

export interface ArchiveChainFinding {
  readonly matterId: string;
  readonly reason: ArchiveChainReason;
  /** Human-readable, and safe for a log — it names matter ids, never case content. */
  readonly detail: string;
}

export interface ArchiveChainVerification {
  readonly ok: boolean;
  /** How many matters were examined. `{ok:true, findings:[]}` over zero matters is not a pass. */
  readonly mattersChecked: number;
  readonly eventsVerified: number;
  readonly findings: readonly ArchiveChainFinding[];
}

interface MatterIdRow {
  readonly matterId: string;
}

/**
 * Every matter id the database mentions ANYWHERE — matters, audit events, and chain heads.
 *
 * The union is the load-bearing part. A set built from `case_box_audit_chain_heads` alone is
 * self-defeating: deleting a head is precisely the tamper you want caught, and it removes the
 * matter from the checked set. A set built from `case_box_matters` alone misses audit rows left
 * behind by a deleted matter. Only the union can report both, and neither structural corruption
 * can hide by removing its own row from the list of things to check.
 */
function allMatterIds(db: ChainReadableDb): string[] {
  const rows = db
    .prepare(
      "SELECT id AS matterId FROM case_box_matters " +
        "UNION SELECT matter_id AS matterId FROM case_box_audit_events " +
        "UNION SELECT matter_id AS matterId FROM case_box_audit_chain_heads " +
        "ORDER BY matterId",
    )
    .all() as MatterIdRow[];
  return rows.map((r) => r.matterId);
}

interface HeadCountRow {
  readonly declared: number | null;
  readonly actual: number;
  readonly maxSeq: number | null;
}

/**
 * The per-matter invariant the schema documents: `event_count == COUNT(*) == MAX(sequence)`.
 *
 * Kept ALONGSIDE the chain verifier rather than replaced by it, because the two see different
 * things. Editing only `event_count` in the head row leaves the chain and the head hash perfectly
 * valid, so the verifier passes it; the verifier in turn catches every payload and link tamper
 * this count check is blind to.
 */
function headCountFindings(db: ChainReadableDb, matterId: string): ArchiveChainFinding[] {
  const row = db
    .prepare(
      "SELECT (SELECT event_count FROM case_box_audit_chain_heads h WHERE h.matter_id = ?) AS declared, " +
        "  (SELECT COUNT(*) FROM case_box_audit_events e WHERE e.matter_id = ?) AS actual, " +
        "  (SELECT MAX(sequence) FROM case_box_audit_events e WHERE e.matter_id = ?) AS maxSeq",
    )
    .get(matterId, matterId, matterId) as HeadCountRow | undefined;
  if (row === undefined) return [];
  const out: ArchiveChainFinding[] = [];
  const actual = Number(row.actual);
  if (row.declared !== null && Number(row.declared) !== actual) {
    out.push({
      matterId,
      reason: "head_count_mismatch",
      detail: `${matterId}: the chain head declares ${String(row.declared)} events, the archive holds ${actual}`,
    });
  }
  if (actual > 0 && Number(row.maxSeq) !== actual) {
    out.push({
      matterId,
      reason: "sequence_gap",
      detail: `${matterId}: ${actual} events but MAX(sequence)=${String(row.maxSeq)}; an event was removed from the middle`,
    });
  }
  return out;
}

/**
 * Verify EVERY audit chain in a database, using this package's own full verifier per matter —
 * per-event hashes, prev-links, sequence, genesis shape and the persisted head anchor.
 *
 * Returns findings rather than throwing. The caller is a backup button and a restore drill; both
 * need to report every defect at once, not stop at the first one.
 */
export function verifyAllAuditChains(db: ChainReadableDb): ArchiveChainVerification {
  const findings: ArchiveChainFinding[] = [];
  let eventsVerified = 0;
  const matterIds = allMatterIds(db);

  for (const matterId of matterIds) {
    findings.push(...headCountFindings(db, matterId));
    try {
      // The cast is confined to this package, which owns the driver dependency. The verifier
      // uses only `prepare().get()` and `prepare().all()`, which `ChainReadableDb` states.
      const result = verifyAuditChainForMatterSqlite(db as unknown as Database, matterId);
      if (result.ok) {
        eventsVerified += result.verifiedCount;
      } else {
        findings.push({
          matterId,
          reason: "chain_invalid",
          detail: `${matterId}: ${result.errorReason} at event ${String(result.errorIndex)} — ${result.detail}`,
        });
      }
    } catch (error) {
      // `unknown_matter` here means audit rows outlived the matter they belong to. That is a
      // structural corruption in its own right, and it is invisible to any per-matter check that
      // starts from the matters table.
      if (error instanceof CaseBoxPersistenceError && error.code === "unknown_matter") {
        findings.push({
          matterId,
          reason: "orphan_audit_rows",
          detail: `${matterId}: audit events or a chain head exist, but the matter row does not`,
        });
      } else {
        findings.push({
          matterId,
          reason: "verifier_error",
          detail: `${matterId}: chain verification failed to complete (${
            error instanceof Error ? error.message : String(error)
          })`,
        });
      }
    }
  }

  return {
    ok: findings.length === 0,
    mattersChecked: matterIds.length,
    eventsVerified,
    findings,
  };
}

/**
 * The schema version a database records, read exactly the way `applySchema` reads it before
 * deciding whether it can operate on that file.
 *
 * REUSED, NOT REIMPLEMENTED, and the reason is specific. A restore tool has to answer "will this
 * application be able to open the result?" before it publishes a profile. The only correct source
 * for that answer is the same reader the application's own startup path consults: a second query
 * that agreed today would be free to disagree after the next migration, and the disagreement
 * would surface as a restore that succeeds into a profile the product then refuses.
 *
 * Returns 0 for a database with no `schema_version` table — a file that is not a case box at all.
 */
export function readArchiveSchemaVersion(db: ChainReadableDb): number {
  return readMaxSchemaVersion(db as unknown as Database);
}

/**
 * One row per matter from `case_box_audit_chain_heads`, for cross-checking an EXTERNAL manifest
 * against the database it claims to describe.
 *
 * `runBackup` builds its manifest from this same table, so for an archive this product wrote the
 * two agree by construction. That is not a reason to skip the check on the restore side: the
 * manifest arriving there is a file on a disk that has been out of this program's control, and
 * an internal contradiction between it and the database is a defect whoever caused it.
 */
export function readChainHeads(db: ChainReadableDb): Array<{
  matterId: string;
  headHash: string | null;
  eventCount: number;
}> {
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
