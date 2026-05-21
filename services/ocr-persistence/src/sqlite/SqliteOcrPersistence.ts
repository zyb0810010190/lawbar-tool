// SQLite-backed implementation of `OcrPersistence` (Step 9).
//
// Behavioural parity with `InMemoryOcrPersistence`:
//   - Same OcrPersistenceError messages where the conformance harness asserts
//     them (validation summaries, linkage mismatches, duplicate keys, cursor
//     malformed/wrong-kind/mismatched-filters).
//   - Same JSON contract payloads stored verbatim and returned by parsing.
//   - Same ordering and seek-pagination semantics, expressed as OR-chain
//     SQL predicates that mirror the JS tuple compares.
//   - Same defensive-copy guarantees: every record returned to the caller is
//     freshly parsed from JSON, so caller mutations cannot leak into store.
//
// Concurrency model:
//   - `appendOcrStatus` is wrapped in `BEGIN IMMEDIATE` so the seq read +
//     INSERT + UPDATE complete atomically. Concurrent appenders will
//     serialize on the write lock; the contract sequence validator runs
//     against the just-read chain.
//   - `saveOcrResult` is wrapped in `BEGIN IMMEDIATE` for the same reason
//     (linkage check + dup check + INSERT must be atomic).
//
// Driver:
//   - `better-sqlite3` (synchronous, native). The constructor accepts an
//     opened `Database` so callers can choose `:memory:` (tests) or a file
//     path (durable). PRAGMA foreign_keys is enabled per-connection here.

import type { Database as BetterSqlite3Database } from "better-sqlite3";

import {
  OcrQueueError,
  validateOcrStatusTransitionSequence,
  validateOcrSubmission,
  type OcrJobQueueBackend,
  type OcrSubmission,
  type TransitionRecord,
} from "ocr-worker-contract";

import { randomUUID } from "node:crypto";

import {
  OcrPersistenceError,
  type EnqueueNewOcrJobOptions,
  type EnqueueNewOcrJobResult,
  type ListOcrJobsByDocumentPage,
  type ListOcrJobsByDocumentQuery,
  type ListOcrReviewPageRowsPage,
  type ListOcrReviewPageRowsQuery,
  type OcrJobRecord,
  type OcrPersistence,
  type OcrResultRecord,
  type OcrReviewPageRow,
  type OcrStatusEvent,
} from "../types.js";

import { enqueueOcrJobIntoConnection } from "./SqliteOcrQueue.js";

import type { OcrJob } from "ocr-worker-contract";

import { applySchema } from "./schema.js";
import { deepEquals, transitionEquals } from "../replaySafe.js";

import {
  buildJobRecordFromSubmission,
  rowToJobRecord,
  type OcrJobRow,
} from "./jobRecordMappers.js";
import { isAtomicEligiblePath } from "./atomicEligibility.js";
export { isAtomicEligiblePath } from "./atomicEligibility.js";
import {
  insertOcrResultRow,
  validateResultAgainstJob,
} from "./ocrResultWrites.js";
import { listOcrJobsByDocument as listOcrJobsByDocumentImpl } from "./listOcrJobsByDocument.js";
import { listOcrReviewPageRows as listOcrReviewPageRowsImpl } from "./listOcrReviewPageRows.js";
export { openSqliteOcrPersistence } from "./openSqliteOcrPersistence.js";

export interface SqliteOcrPersistenceOptions {
  /** Already-opened better-sqlite3 Database. Caller owns its lifecycle. */
  db: BetterSqlite3Database;
  /** Deterministic clock for `created_at`/`persisted_at`. Default: `new Date()`. */
  now?: () => Date;
  /**
   * If true (default), apply the schema idempotently on construction. Set to
   * false if the caller has already migrated the DB.
   */
  applySchemaOnInit?: boolean;
}

interface OcrStatusRow {
  job_id: string;
  seq: number;
  from_state: string | null;
  to_state: string;
  controlled_by: string;
  occurred_at: string;
  persisted_at: string;
  transition_json: string;
}

export class SqliteOcrPersistence implements OcrPersistence {
  private readonly db: BetterSqlite3Database;
  private readonly now: () => Date;

  /** Filesystem path of the underlying SQLite file. Probe used by the
   *  10K atomic ingest seam to confirm persistence + queue share a store. */
  get dbFilePath(): string {
    return this.db.name;
  }

  constructor(options: SqliteOcrPersistenceOptions) {
    this.db = options.db;
    this.now = options.now ?? (() => new Date());
    // Per-connection pragma. Required for FK enforcement.
    this.db.pragma("foreign_keys = ON");
    if (options.applySchemaOnInit !== false) {
      // Schema bootstrap uses a real wall-clock so we don't drain ticks from
      // an injected deterministic `now`. The applied_at column is purely
      // administrative; tests assert on payload timestamps, not on it.
      applySchema(this.db);
    }
  }

  /**
   * Wrap a synchronous block so that:
   *  - `OcrPersistenceError` (the contracted domain error) propagates verbatim
   *  - any other thrown value (raw better-sqlite3 driver error, JSON parse
   *    failure, undefined-column TypeError, etc.) is converted into an
   *    `OcrPersistenceError` prefixed with "internal db error: ".
   *
   * This guarantees callers only ever see one error type from this class —
   * raw driver internals (`SqliteError: SQLITE_*`, native error codes,
   * connection state) cannot leak across the persistence boundary.
   */
  private wrapErrors<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof OcrPersistenceError) throw err;
      // 10K: preserve typed queue errors (dedupe_conflict etc.) raised
      // from the shared `enqueueOcrJobIntoConnection` helper, so atomic-
      // path callers can still discriminate by `OcrQueueError.code`.
      if (err instanceof OcrQueueError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new OcrPersistenceError(`internal db error: ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // createOcrJob
  // -------------------------------------------------------------------------

  async createOcrJob(submission: unknown): Promise<OcrJobRecord> {
    return this.wrapErrors(() => {
      const sub = this.validateAndCloneSubmission(submission);
      const createdAt = this.now().toISOString();
      const tx = this.db.transaction(() => {
        this.insertOcrJobRow(sub, createdAt);
      });
      tx.immediate();
      return buildJobRecordFromSubmission(sub, createdAt, null);
    });
  }

  // -------------------------------------------------------------------------
  // enqueueNewOcrJob — Step 10K atomic ingest seam
  // -------------------------------------------------------------------------

  async enqueueNewOcrJob(
    submission: unknown,
    queue: OcrJobQueueBackend,
    opts: EnqueueNewOcrJobOptions = {},
  ): Promise<EnqueueNewOcrJobResult> {
    return this.wrapErrors(() => {
      // Atomicity is only meaningful when the queue lives in the same
      // SQLite file. A queue against a different store would silently
      // commit the queue row to a place the runtime queue cannot read.
      // Reject `:memory:` and empty paths: two independent in-memory
      // DBs both report `:memory:`, so equality there is spoofable.
      const supplied = queue as { dbFilePath?: unknown };
      if (
        typeof supplied.dbFilePath !== "string" ||
        supplied.dbFilePath !== this.dbFilePath ||
        !isAtomicEligiblePath(this.dbFilePath)
      ) {
        throw new OcrPersistenceError(
          "atomic enqueueNewOcrJob requires a SqliteOcrQueue on the same on-disk SQLite file",
        );
      }

      const sub = this.validateAndCloneSubmission(submission);

      // Capture ONE wall-clock sample so created_at and enqueued_at
      // cannot diverge under an injected counter clock.
      const now = opts.now ?? this.now;
      const sampledAt = now();
      const createdAt = sampledAt.toISOString();
      const enqueuedAtMs = sampledAt.getTime();
      const generateId = opts.generateId ?? (() => randomUUID());

      const candidate: OcrJob = {
        id: generateId(),
        submission: sub,
        enqueued_at: sampledAt.toISOString(),
        ...(opts.scenario !== undefined ? { scenario: opts.scenario } : {}),
      };

      let enqueueOutcome:
        | { kind: "fresh"; row_json: string; deduped: false }
        | { kind: "deduped"; row_json: string; deduped: true }
        | null = null;

      const tx = this.db.transaction(() => {
        this.insertOcrJobRow(sub, createdAt);
        const out = enqueueOcrJobIntoConnection(this.db, candidate, enqueuedAtMs);
        enqueueOutcome = {
          kind: out.kind,
          row_json: out.row.job_json,
          deduped: out.kind === "deduped",
        } as typeof enqueueOutcome;
      });
      tx.immediate();

      if (enqueueOutcome === null) {
        throw new OcrPersistenceError(
          "internal: enqueueNewOcrJob produced no outcome",
        );
      }
      const eo = enqueueOutcome as {
        kind: "fresh" | "deduped";
        row_json: string;
        deduped: boolean;
      };
      const job = buildJobRecordFromSubmission(sub, createdAt, null);
      return {
        job,
        enqueueResult: {
          job: JSON.parse(eo.row_json) as OcrJob,
          deduped: eo.deduped,
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Shared helpers (10K DRY: createOcrJob ∪ enqueueNewOcrJob)
  // -------------------------------------------------------------------------

  private validateAndCloneSubmission(
    submission: unknown,
  ): OcrSubmission & {
    case_id?: string;
    document_revision?: number;
    submitted_by: string;
    metadata?: unknown;
  } {
    const v = validateOcrSubmission(submission);
    if (!v.ok) {
      throw new OcrPersistenceError(`invalid submission: ${v.summary}`);
    }
    // Clone validated value so caller mutations after this call cannot leak in.
    return structuredClone(v.value) as OcrSubmission & {
      case_id?: string;
      document_revision?: number;
      submitted_by: string;
      metadata?: unknown;
    };
  }

  /**
   * Insert one ocr_jobs row inside the caller's open transaction. Mirrors
   * the in-memory "already exists" precheck without depending on raw
   * constraint errors. Caller owns the surrounding `db.transaction(...).immediate()`.
   */
  private insertOcrJobRow(
    sub: OcrSubmission & {
      case_id?: string;
      document_revision?: number;
      submitted_by: string;
      metadata?: unknown;
    },
    createdAt: string,
  ): void {
    const existing = this.db
      .prepare("SELECT 1 AS one FROM ocr_jobs WHERE job_id = ?")
      .get(sub.job_id);
    if (existing !== undefined) {
      throw new OcrPersistenceError(`job already exists: ${sub.job_id}`);
    }
    const submissionJson = JSON.stringify(sub);
    const metadataJson =
      sub.metadata !== undefined ? JSON.stringify(sub.metadata) : null;
    this.db
      .prepare(
        `INSERT INTO ocr_jobs
           (job_id, tenant_id, case_id, document_id, document_revision,
            submitted_by, created_at, terminal_state, submission_json, metadata_json)
         VALUES (@job_id, @tenant_id, @case_id, @document_id, @document_revision,
                 @submitted_by, @created_at, NULL, @submission_json, @metadata_json)`,
      )
      .run({
        job_id: sub.job_id,
        tenant_id: sub.tenant_id,
        case_id: sub.case_id ?? null,
        document_id: sub.document_id,
        document_revision: sub.document_revision ?? null,
        submitted_by: sub.submitted_by,
        created_at: createdAt,
        submission_json: submissionJson,
        metadata_json: metadataJson,
      });
  }

  // -------------------------------------------------------------------------
  // appendOcrStatus
  // -------------------------------------------------------------------------

  async appendOcrStatus(
    jobId: string,
    transition: TransitionRecord,
  ): Promise<OcrStatusEvent> {
    return this.wrapErrors(() => {
    let event: OcrStatusEvent | null = null;

    const tx = this.db.transaction(() => {
      const jobExists = this.db
        .prepare("SELECT 1 AS one FROM ocr_jobs WHERE job_id = ?")
        .get(jobId);
      if (jobExists === undefined) {
        throw new OcrPersistenceError(`unknown job: ${jobId}`);
      }
      const existingRows = this.db
        .prepare(
          "SELECT transition_json FROM ocr_status_events WHERE job_id = ? ORDER BY seq ASC",
        )
        .all(jobId) as Array<{ transition_json: string }>;
      const existing: TransitionRecord[] = existingRows.map(
        (r) => JSON.parse(r.transition_json) as TransitionRecord,
      );
      const proposed: TransitionRecord[] = [...existing, transition];
      const seqResult = validateOcrStatusTransitionSequence({
        job_id: jobId,
        transitions: proposed,
      });
      if (!seqResult.ok) {
        throw new OcrPersistenceError(
          `illegal status transition: ${seqResult.summary}`,
        );
      }
      const seq = existing.length + 1;
      const persistedAt = this.now().toISOString();
      const cloned = structuredClone(transition);
      this.db
        .prepare(
          `INSERT INTO ocr_status_events
             (job_id, seq, from_state, to_state, controlled_by,
              occurred_at, persisted_at, transition_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          jobId,
          seq,
          cloned.from ?? null,
          cloned.to,
          cloned.controlled_by,
          cloned.at,
          persistedAt,
          JSON.stringify(cloned),
        );
      this.db
        .prepare("UPDATE ocr_jobs SET terminal_state = ? WHERE job_id = ?")
        .run(cloned.to, jobId);
      event = {
        ...cloned,
        seq,
        persisted_at: persistedAt,
      };
    });
    tx.immediate();

    if (event === null) {
      // Unreachable: the transaction either threw or assigned `event`.
      throw new OcrPersistenceError("internal: appendOcrStatus produced no event");
    }
    return structuredClone(event) as OcrStatusEvent;
    });
  }

  // -------------------------------------------------------------------------
  // appendOcrStatusOnce — replay-safe append for at-least-once redelivery
  // -------------------------------------------------------------------------

  async appendOcrStatusOnce(
    jobId: string,
    transition: TransitionRecord,
  ): Promise<OcrStatusEvent> {
    return this.wrapErrors(() => {
      let outcome:
        | { kind: "replay"; event: OcrStatusEvent }
        | { kind: "fresh" }
        | null = null;

      // First pass: do existence check + chain scan inside a tx. If we find a
      // canonically-equal stored transition, we're done (replay no-op). Otherwise
      // we fall through to the strict append, which also runs in its own
      // transaction. We deliberately do not append inside this scan tx so that
      // strict's full validation+seq+update logic stays in one place.
      const scanTx = this.db.transaction(() => {
        const jobExists = this.db
          .prepare("SELECT 1 AS one FROM ocr_jobs WHERE job_id = ?")
          .get(jobId);
        if (jobExists === undefined) {
          throw new OcrPersistenceError(`unknown job: ${jobId}`);
        }
        const rows = this.db
          .prepare(
            "SELECT seq, persisted_at, transition_json FROM ocr_status_events WHERE job_id = ? ORDER BY seq ASC",
          )
          .all(jobId) as Array<{
          seq: number;
          persisted_at: string;
          transition_json: string;
        }>;
        for (const row of rows) {
          const stored = JSON.parse(row.transition_json) as TransitionRecord;
          if (transitionEquals(stored, transition)) {
            outcome = {
              kind: "replay",
              event: {
                ...stored,
                seq: row.seq,
                persisted_at: row.persisted_at,
              },
            };
            return;
          }
        }
        outcome = { kind: "fresh" };
      });
      scanTx.immediate();

      if (outcome === null) {
        throw new OcrPersistenceError("internal: appendOcrStatusOnce scan produced no outcome");
      }
      const o = outcome as
        | { kind: "replay"; event: OcrStatusEvent }
        | { kind: "fresh" };
      if (o.kind === "replay") {
        return structuredClone(o.event);
      }
      // No replay match — strict append. wrapErrors here would double-wrap;
      // unwrap by calling the inner sync logic via the public method which
      // already handles wrapping. Since we're already inside wrapErrors, the
      // inner OcrPersistenceError will pass through verbatim.
      // appendOcrStatus is async because the interface requires it, but the
      // body is synchronous. Use a synchronous shim to keep this in one tx
      // window... The simpler approach: just call appendOcrStatus and rely on
      // BEGIN IMMEDIATE on the strict path — there is no harm in a brief
      // window between scan and strict, because strict re-reads the chain
      // and re-validates.
      // We can't await inside this sync wrapper, but appendOcrStatus's body
      // resolves synchronously after `tx.immediate()`. Returning the promise
      // is fine because wrapErrors's return type is T, and Promise<X> is the
      // T here.
      return this.appendOcrStatus(jobId, transition);
    });
  }

  // -------------------------------------------------------------------------
  // saveOcrResult
  // -------------------------------------------------------------------------

  async saveOcrResult(jobId: string, result: unknown): Promise<OcrResultRecord> {
    return this.wrapErrors(() => {
      let record: OcrResultRecord | null = null;

      const tx = this.db.transaction(() => {
        const jobRow = this.db
          .prepare("SELECT * FROM ocr_jobs WHERE job_id = ?")
          .get(jobId) as OcrJobRow | undefined;
        if (jobRow === undefined) {
          throw new OcrPersistenceError(`unknown job: ${jobId}`);
        }
        const r = validateResultAgainstJob(jobRow, jobId, result);

        const dup = this.db
          .prepare(
            "SELECT 1 AS one FROM ocr_results WHERE job_id = ? AND page_id = ?",
          )
          .get(jobId, r.page_id);
        if (dup !== undefined) {
          throw new OcrPersistenceError(
            `duplicate result for (job_id=${jobId}, page_id=${r.page_id})`,
          );
        }

        const persistedAt = this.now().toISOString();
        const cloned = structuredClone(r);
        insertOcrResultRow(this.db, jobId, jobRow, cloned, persistedAt);

        record = {
          result: cloned as unknown as OcrResultRecord["result"],
          persisted_at: persistedAt,
        };
      });
      tx.immediate();

      if (record === null) {
        throw new OcrPersistenceError("internal: saveOcrResult produced no record");
      }
      return structuredClone(record) as OcrResultRecord;
    });
  }

  // -------------------------------------------------------------------------
  // saveOcrResultOnce — replay-safe result write for at-least-once redelivery
  // -------------------------------------------------------------------------

  async saveOcrResultOnce(
    jobId: string,
    result: unknown,
  ): Promise<OcrResultRecord> {
    return this.wrapErrors(() => {
      let outcome:
        | { kind: "replay"; record: OcrResultRecord }
        | { kind: "fresh"; record: OcrResultRecord }
        | null = null;

      const tx = this.db.transaction(() => {
        // Full validation + linkage gauntlet runs first, regardless of
        // whether this is a replay or a fresh insert. Tampered linkage must
        // produce its specific error — never a generic "conflicting duplicate".
        const jobRow = this.db
          .prepare("SELECT * FROM ocr_jobs WHERE job_id = ?")
          .get(jobId) as OcrJobRow | undefined;
        if (jobRow === undefined) {
          throw new OcrPersistenceError(`unknown job: ${jobId}`);
        }
        const r = validateResultAgainstJob(jobRow, jobId, result);

        // Branch: existing for (job_id, page_id) → replay-equality decision;
        // none → fresh insert (re-using the strict insert shape).
        const existing = this.db
          .prepare(
            "SELECT result_json, persisted_at FROM ocr_results WHERE job_id = ? AND page_id = ?",
          )
          .get(jobId, r.page_id) as
          | { result_json: string; persisted_at: string }
          | undefined;

        if (existing !== undefined) {
          const storedResult = JSON.parse(
            existing.result_json,
          ) as OcrResultRecord["result"];
          // Equality compares contract payload only; persisted_at is store-assigned.
          if (deepEquals(storedResult, r)) {
            outcome = {
              kind: "replay",
              record: {
                result: storedResult,
                persisted_at: existing.persisted_at,
              },
            };
            return;
          }
          throw new OcrPersistenceError(
            `conflicting duplicate result for (job_id=${jobId}, page_id=${r.page_id})`,
          );
        }

        const persistedAt = this.now().toISOString();
        const cloned = structuredClone(r);
        insertOcrResultRow(this.db, jobId, jobRow, cloned, persistedAt);
        outcome = {
          kind: "fresh",
          record: {
            result: cloned as unknown as OcrResultRecord["result"],
            persisted_at: persistedAt,
          },
        };
      });
      tx.immediate();

      if (outcome === null) {
        throw new OcrPersistenceError(
          "internal: saveOcrResultOnce produced no outcome",
        );
      }
      return structuredClone((outcome as { record: OcrResultRecord }).record);
    });
  }

  // -------------------------------------------------------------------------
  // Single-job reads
  // -------------------------------------------------------------------------

  async getOcrJob(jobId: string): Promise<OcrJobRecord | null> {
    return this.wrapErrors(() => {
      const row = this.db
        .prepare("SELECT * FROM ocr_jobs WHERE job_id = ?")
        .get(jobId) as OcrJobRow | undefined;
      if (row === undefined) return null;
      return rowToJobRecord(row);
    });
  }

  // -------------------------------------------------------------------------
  // ADR-11G pending-retry outbox
  // -------------------------------------------------------------------------

  async setOcrPendingRetry(
    jobId: string,
    submission: unknown,
  ): Promise<void> {
    return this.wrapErrors(() => {
      const v = validateOcrSubmission(submission);
      if (!v.ok) {
        throw new OcrPersistenceError(
          `invalid pending-retry submission for ${jobId}: ${v.summary}`,
        );
      }
      // Verify the job exists BEFORE the update so a typo/unknown id
      // produces a domain error instead of a silent no-op (UPDATE matches
      // zero rows but does not throw).
      const exists = this.db
        .prepare("SELECT 1 AS one FROM ocr_jobs WHERE job_id = ?")
        .get(jobId) as { one: number } | undefined;
      if (exists === undefined) {
        throw new OcrPersistenceError(
          `unknown job for setOcrPendingRetry: ${jobId}`,
        );
      }
      // Canonical equality on the JSON payload makes idempotent overwrite
      // a no-op write. Writing through anyway is cheap; the comparison
      // keeps the column's last-write-wins semantics honest for tests
      // that snapshot the row timestamp.
      const json = JSON.stringify(v.value);
      this.db
        .prepare(
          "UPDATE ocr_jobs SET pending_retry_submission_json = ? WHERE job_id = ?",
        )
        .run(json, jobId);
    });
  }

  async getOcrPendingRetry(jobId: string): Promise<OcrSubmission | null> {
    return this.wrapErrors(() => {
      const row = this.db
        .prepare(
          "SELECT pending_retry_submission_json FROM ocr_jobs WHERE job_id = ?",
        )
        .get(jobId) as
        | { pending_retry_submission_json: string | null }
        | undefined;
      if (row === undefined) {
        throw new OcrPersistenceError(
          `unknown job for getOcrPendingRetry: ${jobId}`,
        );
      }
      if (row.pending_retry_submission_json === null) return null;
      return JSON.parse(row.pending_retry_submission_json) as OcrSubmission;
    });
  }

  async clearOcrPendingRetry(jobId: string): Promise<void> {
    return this.wrapErrors(() => {
      const exists = this.db
        .prepare("SELECT 1 AS one FROM ocr_jobs WHERE job_id = ?")
        .get(jobId) as { one: number } | undefined;
      if (exists === undefined) {
        throw new OcrPersistenceError(
          `unknown job for clearOcrPendingRetry: ${jobId}`,
        );
      }
      this.db
        .prepare(
          "UPDATE ocr_jobs SET pending_retry_submission_json = NULL WHERE job_id = ?",
        )
        .run(jobId);
    });
  }

  async listOcrJobStatuses(jobId: string): Promise<OcrStatusEvent[]> {
    return this.wrapErrors(() => {
      const rows = this.db
        .prepare(
          "SELECT seq, persisted_at, transition_json FROM ocr_status_events WHERE job_id = ? ORDER BY seq ASC",
        )
        .all(jobId) as Array<{
        seq: number;
        persisted_at: string;
        transition_json: string;
      }>;
      return rows.map((r) => {
        const t = JSON.parse(r.transition_json) as TransitionRecord;
        return {
          ...t,
          seq: r.seq,
          persisted_at: r.persisted_at,
        };
      });
    });
  }

  async listOcrResults(jobId: string): Promise<OcrResultRecord[]> {
    return this.wrapErrors(() => {
      const rows = this.db
        .prepare(
          "SELECT result_json, persisted_at FROM ocr_results WHERE job_id = ? ORDER BY persisted_at ASC, page_id ASC",
        )
        .all(jobId) as Array<{ result_json: string; persisted_at: string }>;
      return rows.map((r) => ({
        result: JSON.parse(r.result_json) as OcrResultRecord["result"],
        persisted_at: r.persisted_at,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Cross-job: listOcrJobsByDocument
  // -------------------------------------------------------------------------

  async listOcrJobsByDocument(
    query: ListOcrJobsByDocumentQuery,
  ): Promise<ListOcrJobsByDocumentPage> {
    return this.wrapErrors(() => listOcrJobsByDocumentImpl(this.db, query));
  }

  // -------------------------------------------------------------------------
  // Cross-job: listOcrReviewPageRows
  // -------------------------------------------------------------------------

  async listOcrReviewPageRows(
    query: ListOcrReviewPageRowsQuery,
  ): Promise<ListOcrReviewPageRowsPage> {
    return this.wrapErrors(() => listOcrReviewPageRowsImpl(this.db, query));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

