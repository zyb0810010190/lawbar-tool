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

import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

import {
  validateOcrResult,
  validateOcrStatusTransitionSequence,
  validateOcrSubmission,
  type OcrSubmission,
  type TransitionRecord,
} from "ocr-worker-contract";

import {
  OcrPersistenceError,
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

import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "../cursor.js";

import { applySchema } from "./schema.js";
import { deepEquals, transitionEquals } from "../replaySafe.js";

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

interface OcrJobRow {
  job_id: string;
  tenant_id: string;
  case_id: string | null;
  document_id: string;
  document_revision: number | null;
  submitted_by: string;
  created_at: string;
  terminal_state: string | null;
  submission_json: string;
  metadata_json: string | null;
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

interface OcrResultRow {
  job_id: string;
  page_id: string;
  page_number: number;
  tenant_id: string;
  case_id: string | null;
  document_id: string;
  document_revision: number | null;
  status: string;
  manual_review_recommended: number;
  persisted_at: string;
  result_json: string;
}

export class SqliteOcrPersistence implements OcrPersistence {
  private readonly db: BetterSqlite3Database;
  private readonly now: () => Date;

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
      const msg = err instanceof Error ? err.message : String(err);
      throw new OcrPersistenceError(`internal db error: ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // createOcrJob
  // -------------------------------------------------------------------------

  async createOcrJob(submission: unknown): Promise<OcrJobRecord> {
    return this.wrapErrors(() => {
      const v = validateOcrSubmission(submission);
      if (!v.ok) {
        throw new OcrPersistenceError(`invalid submission: ${v.summary}`);
      }
      // Clone validated value so caller mutations after this call cannot leak in.
      const sub = structuredClone(v.value) as OcrSubmission & {
        case_id?: string;
        document_revision?: number;
        submitted_by: string;
        metadata?: unknown;
      };
      const createdAt = this.now().toISOString();
      const submissionJson = JSON.stringify(sub);
      const metadataJson =
        sub.metadata !== undefined ? JSON.stringify(sub.metadata) : null;

      // Atomic existence-check + insert, mirroring in-memory's
      // "already exists" precheck without depending on raw constraint errors.
      const tx = this.db.transaction(() => {
        const existing = this.db
          .prepare("SELECT 1 AS one FROM ocr_jobs WHERE job_id = ?")
          .get(sub.job_id);
        if (existing !== undefined) {
          throw new OcrPersistenceError(`job already exists: ${sub.job_id}`);
        }
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
      });
      // better-sqlite3's transaction() runs synchronously and rethrows.
      tx.immediate();

      return buildJobRecordFromSubmission(sub, createdAt, null);
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
      const v = validateOcrResult(result);
      if (!v.ok) {
        throw new OcrPersistenceError(`invalid result: ${v.summary}`);
      }
      const r = v.value as {
        job_id: string;
        tenant_id: string;
        document_id: string;
        document_revision?: number;
        page_id: string;
        page_number: number;
        status: string;
        review?: { manual_review_recommended?: unknown };
      };
      if (r.job_id !== jobId) {
        throw new OcrPersistenceError(
          `result.job_id ${r.job_id} does not match jobId ${jobId}`,
        );
      }
      if (r.tenant_id !== jobRow.tenant_id) {
        throw new OcrPersistenceError(
          `result.tenant_id mismatch: ${r.tenant_id} vs ${jobRow.tenant_id}`,
        );
      }
      if (r.document_id !== jobRow.document_id) {
        throw new OcrPersistenceError(
          `result.document_id mismatch: ${r.document_id} vs ${jobRow.document_id}`,
        );
      }
      // Parse submission to inspect submitted pages. We deliberately do NOT
      // use a side table for this — the contract submission is the canonical
      // source of submitted page metadata.
      const submission = JSON.parse(jobRow.submission_json) as {
        pages: ReadonlyArray<{ page_id: string; page_number: number }>;
      };
      const submittedPage = submission.pages.find(
        (p) => p.page_id === r.page_id,
      );
      if (!submittedPage) {
        throw new OcrPersistenceError(
          `result.page_id ${r.page_id} is not present in submission.pages for job ${jobId}`,
        );
      }
      if (r.page_number !== submittedPage.page_number) {
        throw new OcrPersistenceError(
          `result.page_number ${r.page_number} does not match submitted page_number ${submittedPage.page_number} for page_id ${r.page_id}`,
        );
      }
      if (jobRow.document_revision !== null) {
        if (r.document_revision !== jobRow.document_revision) {
          throw new OcrPersistenceError(
            `result.document_revision ${r.document_revision} does not match job.document_revision ${jobRow.document_revision}`,
          );
        }
      }
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
      const manualReview =
        cloned.review !== undefined &&
        cloned.review.manual_review_recommended === true
          ? 1
          : 0;

      this.db
        .prepare(
          `INSERT INTO ocr_results
             (job_id, page_id, page_number, tenant_id, case_id, document_id,
              document_revision, status, manual_review_recommended,
              persisted_at, result_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          jobId,
          cloned.page_id,
          cloned.page_number,
          cloned.tenant_id,
          // Denorm case_id from JOB (canonical source) — not from result.
          jobRow.case_id,
          cloned.document_id,
          cloned.document_revision ?? null,
          cloned.status,
          manualReview,
          persistedAt,
          JSON.stringify(cloned),
        );

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
        const v = validateOcrResult(result);
        if (!v.ok) {
          throw new OcrPersistenceError(`invalid result: ${v.summary}`);
        }
        const r = v.value as {
          job_id: string;
          tenant_id: string;
          document_id: string;
          document_revision?: number;
          page_id: string;
          page_number: number;
          status: string;
          review?: { manual_review_recommended?: unknown };
        };
        if (r.job_id !== jobId) {
          throw new OcrPersistenceError(
            `result.job_id ${r.job_id} does not match jobId ${jobId}`,
          );
        }
        if (r.tenant_id !== jobRow.tenant_id) {
          throw new OcrPersistenceError(
            `result.tenant_id mismatch: ${r.tenant_id} vs ${jobRow.tenant_id}`,
          );
        }
        if (r.document_id !== jobRow.document_id) {
          throw new OcrPersistenceError(
            `result.document_id mismatch: ${r.document_id} vs ${jobRow.document_id}`,
          );
        }
        const submission = JSON.parse(jobRow.submission_json) as {
          pages: ReadonlyArray<{ page_id: string; page_number: number }>;
        };
        const submittedPage = submission.pages.find(
          (p) => p.page_id === r.page_id,
        );
        if (!submittedPage) {
          throw new OcrPersistenceError(
            `result.page_id ${r.page_id} is not present in submission.pages for job ${jobId}`,
          );
        }
        if (r.page_number !== submittedPage.page_number) {
          throw new OcrPersistenceError(
            `result.page_number ${r.page_number} does not match submitted page_number ${submittedPage.page_number} for page_id ${r.page_id}`,
          );
        }
        if (jobRow.document_revision !== null) {
          if (r.document_revision !== jobRow.document_revision) {
            throw new OcrPersistenceError(
              `result.document_revision ${r.document_revision} does not match job.document_revision ${jobRow.document_revision}`,
            );
          }
        }

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
        const manualReview =
          cloned.review !== undefined &&
          cloned.review.manual_review_recommended === true
            ? 1
            : 0;
        this.db
          .prepare(
            `INSERT INTO ocr_results
               (job_id, page_id, page_number, tenant_id, case_id, document_id,
                document_revision, status, manual_review_recommended,
                persisted_at, result_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            jobId,
            cloned.page_id,
            cloned.page_number,
            cloned.tenant_id,
            jobRow.case_id,
            cloned.document_id,
            cloned.document_revision ?? null,
            cloned.status,
            manualReview,
            persistedAt,
            JSON.stringify(cloned),
          );
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
    return this.wrapErrors(() => {
    const limit = resolveLimit(query.limit);
    const filters = {
      tenant_id: query.tenant_id,
      document_id: query.document_id,
      document_revision: query.document_revision,
    };
    const filters_hash = computeFiltersHash(filters);
    const cursor =
      query.cursor !== undefined
        ? decodeCursor(query.cursor, { kind: "jobs_by_document", filters_hash })
        : null;

    const where: string[] = ["tenant_id = ?", "document_id = ?"];
    const params: unknown[] = [query.tenant_id, query.document_id];
    if (query.document_revision !== undefined) {
      where.push("document_revision = ?");
      params.push(query.document_revision);
    }

    // Seek predicate for ORDER BY created_at DESC, job_id ASC. "Strictly after"
    // tuple (tCreated, tJobId) is:
    //   created_at < tCreated  (DESC: smaller is later in the result order)
    //   OR (created_at = tCreated AND job_id > tJobId)
    if (cursor !== null) {
      const [tCreated, tJobId] = cursor.last_sort_tuple as [string, string];
      where.push("(created_at < ? OR (created_at = ? AND job_id > ?))");
      params.push(tCreated, tCreated, tJobId);
    }

    // Fetch limit+1 to know whether more rows remain.
    const sql = `SELECT * FROM ocr_jobs
                 WHERE ${where.join(" AND ")}
                 ORDER BY created_at DESC, job_id ASC
                 LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit + 1) as OcrJobRow[];

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const records = slice.map((r) => rowToJobRecord(r));
    const last = slice[slice.length - 1];

    const next_cursor =
      hasMore && last !== undefined
        ? encodeCursor({
            v: 1,
            kind: "jobs_by_document",
            filters_hash,
            last_sort_tuple: [last.created_at, last.job_id],
          })
        : null;

    return { rows: records, next_cursor };
    });
  }

  // -------------------------------------------------------------------------
  // Cross-job: listOcrReviewPageRows
  // -------------------------------------------------------------------------

  async listOcrReviewPageRows(
    query: ListOcrReviewPageRowsQuery,
  ): Promise<ListOcrReviewPageRowsPage> {
    return this.wrapErrors(() => {
    const limit = resolveLimit(query.limit);
    const filters = {
      tenant_id: query.tenant_id,
      document_id: query.document_id,
      document_revision: query.document_revision,
      case_id: query.case_id,
    };
    const filters_hash = computeFiltersHash(filters);
    const cursor =
      query.cursor !== undefined
        ? decodeCursor(query.cursor, { kind: "review_pages", filters_hash })
        : null;

    // Filter on the result side (denormalized linkage). Manual-review queue
    // is the only supported lookup, so the index covers it.
    const where: string[] = [
      "r.tenant_id = ?",
      "r.manual_review_recommended = 1",
    ];
    const params: unknown[] = [query.tenant_id];
    if (query.document_id !== undefined) {
      where.push("r.document_id = ?");
      params.push(query.document_id);
    }
    if (query.document_revision !== undefined) {
      where.push("r.document_revision = ?");
      params.push(query.document_revision);
    }
    if (query.case_id !== undefined) {
      // Filter via job-side case_id semantics, but the denorm column on
      // results is written from job.case_id at insert time, so equality
      // here is identical to filtering on the job table.
      where.push("r.case_id = ?");
      params.push(query.case_id);
    }

    // Seek predicate for ORDER BY r.persisted_at DESC, r.job_id ASC,
    // r.page_number ASC, r.page_id ASC. "Strictly after" tuple
    // (tP, tJ, tN, tI) becomes a 4-step OR-chain:
    //   r.persisted_at < tP                                    (DESC)
    //   OR (r.persisted_at = tP AND r.job_id > tJ)             (ASC)
    //   OR (r.persisted_at = tP AND r.job_id = tJ AND r.page_number > tN) (ASC)
    //   OR (r.persisted_at = tP AND r.job_id = tJ AND r.page_number = tN
    //       AND r.page_id > tI)                                (ASC)
    if (cursor !== null) {
      const [tP, tJ, tN, tI] = cursor.last_sort_tuple as [
        string,
        string,
        number,
        string,
      ];
      where.push(
        `(
           r.persisted_at < ?
           OR (r.persisted_at = ? AND r.job_id > ?)
           OR (r.persisted_at = ? AND r.job_id = ? AND r.page_number > ?)
           OR (r.persisted_at = ? AND r.job_id = ? AND r.page_number = ? AND r.page_id > ?)
         )`,
      );
      params.push(tP, tP, tJ, tP, tJ, tN, tP, tJ, tN, tI);
    }

    const sql = `
      SELECT
        r.job_id           AS r_job_id,
        r.page_id          AS r_page_id,
        r.page_number      AS r_page_number,
        r.persisted_at     AS r_persisted_at,
        r.result_json      AS r_result_json,
        j.job_id           AS j_job_id,
        j.tenant_id        AS j_tenant_id,
        j.case_id          AS j_case_id,
        j.document_id      AS j_document_id,
        j.document_revision AS j_document_revision,
        j.submitted_by     AS j_submitted_by,
        j.created_at       AS j_created_at,
        j.terminal_state   AS j_terminal_state,
        j.submission_json  AS j_submission_json,
        j.metadata_json    AS j_metadata_json
      FROM ocr_results r
      JOIN ocr_jobs j ON j.job_id = r.job_id
      WHERE ${where.join(" AND ")}
      ORDER BY r.persisted_at DESC, r.job_id ASC, r.page_number ASC, r.page_id ASC
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...params, limit + 1) as Array<{
      r_job_id: string;
      r_page_id: string;
      r_page_number: number;
      r_persisted_at: string;
      r_result_json: string;
      j_job_id: string;
      j_tenant_id: string;
      j_case_id: string | null;
      j_document_id: string;
      j_document_revision: number | null;
      j_submitted_by: string;
      j_created_at: string;
      j_terminal_state: string | null;
      j_submission_json: string;
      j_metadata_json: string | null;
    }>;

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const out: OcrReviewPageRow[] = slice.map((row) => {
      const job = rowToJobRecord({
        job_id: row.j_job_id,
        tenant_id: row.j_tenant_id,
        case_id: row.j_case_id,
        document_id: row.j_document_id,
        document_revision: row.j_document_revision,
        submitted_by: row.j_submitted_by,
        created_at: row.j_created_at,
        terminal_state: row.j_terminal_state,
        submission_json: row.j_submission_json,
        metadata_json: row.j_metadata_json,
      });
      const result: OcrResultRecord = {
        result: JSON.parse(row.r_result_json) as OcrResultRecord["result"],
        persisted_at: row.r_persisted_at,
      };
      return { job, result };
    });

    const last = slice[slice.length - 1];
    const next_cursor =
      hasMore && last !== undefined
        ? encodeCursor({
            v: 1,
            kind: "review_pages",
            filters_hash,
            last_sort_tuple: [
              last.r_persisted_at,
              last.r_job_id,
              last.r_page_number,
              last.r_page_id,
            ],
          })
        : null;

    return { rows: out, next_cursor };
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToJobRecord(row: OcrJobRow): OcrJobRecord {
  const submission = JSON.parse(row.submission_json) as OcrSubmission;
  const record: OcrJobRecord = {
    job_id: row.job_id,
    tenant_id: row.tenant_id,
    document_id: row.document_id,
    submission,
    created_at: row.created_at,
  };
  if (row.case_id !== null) record.case_id = row.case_id;
  if (row.document_revision !== null) {
    record.document_revision = row.document_revision;
  }
  if (row.terminal_state !== null) {
    // The DB column is unconstrained TEXT; the contract OcrJobState union is
    // narrower. The terminal_state cache only ever receives values that
    // appendOcrStatus has validated against the contract, so this cast is safe.
    record.terminal_state = row.terminal_state as OcrJobRecord["terminal_state"];
  }
  return record;
}

function buildJobRecordFromSubmission(
  sub: OcrSubmission & {
    case_id?: string;
    document_revision?: number;
  },
  createdAt: string,
  terminalState: OcrJobRecord["terminal_state"] | null,
): OcrJobRecord {
  const record: OcrJobRecord = {
    job_id: sub.job_id,
    tenant_id: sub.tenant_id,
    document_id: sub.document_id,
    submission: sub,
    created_at: createdAt,
  };
  if (sub.case_id !== undefined) record.case_id = sub.case_id;
  if (sub.document_revision !== undefined) {
    record.document_revision = sub.document_revision;
  }
  if (terminalState !== null && terminalState !== undefined) {
    record.terminal_state = terminalState;
  }
  return record;
}

/**
 * Convenience factory: open an in-memory or file-backed SQLite database,
 * apply the schema, and return a ready-to-use SqliteOcrPersistence. The
 * caller must keep a reference to the underlying Database to close it.
 */
export function openSqliteOcrPersistence(
  options: { path?: string; now?: () => Date } = {},
): { persistence: SqliteOcrPersistence; db: BetterSqlite3Database } {
  const db = new Database(options.path ?? ":memory:");
  // Local-durability/perf pragmas — NOT part of the OcrPersistence behavioural
  // contract. WAL gives concurrent readers + a single writer without blocking
  // and is a safe default for file-backed SQLite. `synchronous = NORMAL`
  // pairs with WAL: durable across process crashes (only loses uncommitted
  // txns on power loss). For `:memory:` the WAL pragma silently no-ops
  // (returns "memory"); both pragmas are harmless there.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  const persistence = new SqliteOcrPersistence({
    db,
    now: options.now,
    applySchemaOnInit: true,
  });
  return { persistence, db };
}
