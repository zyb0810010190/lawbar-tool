// SQLite-backed implementation of the OCR job queue (Step 10I-B1).
//
// Scope of THIS step (10I-B1):
//   - durable storage layer: schema v2 tables, dedupe, claim/lease, receipt
//     ledger, receipt classification across process restart
//   - exposes the `OcrJobQueueBackend` surface from `ocr-worker-contract`
//     so a downstream conformance run can construct it. The full queue
//     conformance matrix and SQLITE_BUSY/contention tests are 10I-B2.
//
// Hard constraints honored here (per 10H-A ADR):
//   - imports queue types from `ocr-worker-contract`, never from
//     `ocr-worker-adapter`
//   - the queue owns its own better-sqlite3 Database handle (a separate DB
//     connection from any persistence connection on the same file)
//   - claim path uses `BEGIN IMMEDIATE` (write-intent) so a row-level race
//     between two claimers serializes on SQLite's reserved lock instead of
//     producing two claims for the same row
//   - Node clock (`Date.now()`) drives lease arithmetic by default — same
//     fake-clock seam the in-memory queue uses, so the conformance harness
//     stays time-injectable
//   - INTEGER epoch-ms columns for queue timestamps (arithmetic, not
//     lexical, comparison)
//
// Receipt classification (the reason for the ledger):
//
//   Given a receipt presented by a caller after some interleaving of
//   process restarts, lease expiry, and reclaim, we MUST distinguish four
//   cases — the contract codes carry semantically different "what does
//   the caller do next" advice:
//
//     unknown_receipt → never issued, OR resolved by complete/requeue.
//                       The caller has no work to do; the job is gone or
//                       moved on.
//     stale_receipt   → was once active, but the slot was re-claimed by a
//                       newer receipt (lease expired and someone else got
//                       it). Caller's work is invalid; do not write.
//     lease_expired   → still the most recent receipt for the slot, but
//                       its lease has elapsed. Slot is reclaimable; the
//                       caller's claim is no longer authoritative.
//     active          → still the active owner; renew/complete/requeue OK.
//
//   We persist enough state in the ledger to compute all four after the
//   in-memory `issuedReceipts` set is gone (i.e. after restart):
//     - row missing                       → unknown_receipt
//     - resolution in (completed,requeued)→ unknown_receipt
//     - resolution = expired_swept        → unknown_receipt
//                       (B2 janitor sweep w/o successor; no newer claim
//                        exists, so there is nothing to be "stale against")
//     - resolution = superseded           → stale_receipt
//                       (lease expired AND a newer receipt now owns slot)
//     - resolution = claimed:
//         lease_expires_at_ms <= now()    → lease_expired
//         else                            → active

import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";

import {
  OcrQueueError,
  type EnqueueResult,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrQueueClaim,
} from "ocr-worker-contract";

import { applySchema } from "./schema.js";

/** Default lease length. Mirrors `InMemoryOcrQueue`'s default for parity. */
const DEFAULT_LEASE_MS = 30_000;

/**
 * Default busy_timeout. Non-zero so concurrent writers from a separate
 * connection block briefly on SQLite's reserved lock instead of returning
 * SQLITE_BUSY immediately. The value is "long enough to absorb a normal
 * write" but well below what would mask a real deadlock; a 10I-B2
 * contention test will pin the policy.
 */
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export interface SqliteOcrQueueOptions {
  /**
   * Already-opened better-sqlite3 Database. Caller owns its lifecycle:
   * `SqliteOcrQueue.close()` will NOT close this handle. To get a queue
   * that closes its own connection, use `openSqliteOcrQueue` instead.
   */
  db: BetterSqlite3Database;
  /**
   * Deterministic clock for lease/receipt timestamps. Default: `Date.now`.
   * The conformance harness injects a fake clock via this seam.
   */
  now?: () => Date;
  /** Lease duration in milliseconds. Default 30_000. */
  leaseMs?: number;
  /** Receipt token factory. Default: `randomUUID()`. */
  generateReceipt?: () => string;
  /**
   * If true (default), apply the schema idempotently on construction. Set
   * to false if the caller has already migrated the DB.
   */
  applySchemaOnInit?: boolean;
  /**
   * Internal hint, set only by `openSqliteOcrQueue`, that this queue owns
   * its DB handle and should close it on `close()`. Direct callers of the
   * constructor MUST NOT set this — they retain ownership of the handle
   * they pass in. Marked `@internal` rather than enforced via a separate
   * factory class to keep the constructor seam usable from tests.
   *
   * @internal
   */
  ownsDb?: boolean;
}

export interface OpenSqliteOcrQueueOptions {
  /** Filesystem path. Defaults to `:memory:` for tests. */
  path?: string;
  now?: () => Date;
  leaseMs?: number;
  generateReceipt?: () => string;
  /** Override SQLite busy_timeout (ms). Default 5000. */
  busyTimeoutMs?: number;
}

interface QueueJobRow {
  transport_id: string;
  job_id: string;
  job_json: string;
  submission_json: string;
  state: "waiting" | "claimed" | "resolved";
  enqueued_at_ms: number;
  enqueue_seq: number;
  claimed_until_ms: number | null;
  claimed_by: string | null;
  current_receipt: string | null;
  resolved_at_ms: number | null;
  resolution: "completed" | "requeued" | "superseded" | null;
}

interface ReceiptRow {
  receipt: string;
  job_id: string;
  transport_id: string;
  worker_id: string;
  issued_at_ms: number;
  lease_expires_at_ms: number;
  resolved_at_ms: number | null;
  resolution: "claimed" | "requeued" | "completed" | "expired_swept" | "superseded";
}

// Canonical, key-sorted JSON. Two values compare equal iff their canonical
// JSON strings match. Inlined here so the persistence package does not
// pull in a JSON canonicalization dep — the in-memory queue does the same.
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]))
      .join(",") +
    "}"
  );
}

function jobIdOf(job: OcrJob): string {
  const sub = job.submission as { job_id?: unknown };
  if (typeof sub?.job_id !== "string" || sub.job_id.length === 0) {
    throw new OcrQueueError(
      "invalid_claim",
      "job.submission.job_id must be a non-empty string",
    );
  }
  return sub.job_id;
}

function assertClaimShape(claim: OcrQueueClaim): void {
  if (
    !claim ||
    typeof claim.receipt !== "string" ||
    claim.receipt.length === 0 ||
    typeof claim.job_id !== "string" ||
    claim.job_id.length === 0
  ) {
    throw new OcrQueueError(
      "invalid_claim",
      "claim must carry a non-empty receipt and job_id",
    );
  }
}

export class SqliteOcrQueue implements OcrJobQueueBackend {
  private readonly db: BetterSqlite3Database;
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly generateReceipt: () => string;
  private readonly ownsDb: boolean;

  constructor(options: SqliteOcrQueueOptions) {
    this.db = options.db;
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.generateReceipt = options.generateReceipt ?? (() => randomUUID());
    // Default to NOT owning a caller-supplied handle. `openSqliteOcrQueue`
    // is the only path that flips this to true.
    this.ownsDb = options.ownsDb === true;
    if (options.applySchemaOnInit !== false) {
      applySchema(this.db);
    }
  }

  /**
   * Release queue resources. If this queue owns its DB handle (i.e. it
   * was constructed via `openSqliteOcrQueue`), the handle is closed; the
   * file lock is released. If the caller passed in a Database via the
   * constructor, that handle is the caller's to manage and is NOT closed
   * here. Idempotent in either case.
   */
  async close(): Promise<void> {
    if (!this.ownsDb) return;
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }

  // -------------------------------------------------------------------------
  // enqueue
  // -------------------------------------------------------------------------

  async enqueue(job: OcrJob): Promise<EnqueueResult> {
    const logicalId = jobIdOf(job);
    const cloned = structuredClone(job);
    const submissionCanonical = canonicalJSON(cloned.submission);
    const jobJson = JSON.stringify(cloned);
    const enqueuedAtMs = this.now().getTime();

    let outcome: { kind: "fresh"; row: QueueJobRow } | { kind: "deduped"; row: QueueJobRow } | null =
      null;

    const tx = this.db.transaction(() => {
      // Look for an active row (waiting or claimed) with this logical id.
      // Active rows are bounded by the partial unique index, so this finds
      // 0 or 1 row.
      const active = this.db
        .prepare(
          "SELECT * FROM ocr_queue_jobs WHERE job_id = ? AND state != 'resolved'",
        )
        .get(logicalId) as QueueJobRow | undefined;

      if (active !== undefined) {
        if (active.submission_json === submissionCanonical) {
          // Same logical id, equal canonical submission — idempotent replay.
          outcome = { kind: "deduped", row: active };
          return;
        }
        throw new OcrQueueError(
          "dedupe_conflict",
          `enqueue conflict for job_id ${logicalId}: submission differs from active queued record`,
        );
      }

      // No active row — append. enqueue_seq is the running max + 1; the
      // UNIQUE constraint catches a race even under BEGIN IMMEDIATE
      // serialization (defensive, not load-bearing here).
      const seqRow = this.db
        .prepare("SELECT COALESCE(MAX(enqueue_seq), 0) AS m FROM ocr_queue_jobs")
        .get() as { m: number };
      const enqueueSeq = seqRow.m + 1;

      this.db
        .prepare(
          `INSERT INTO ocr_queue_jobs
             (transport_id, job_id, job_json, submission_json, state,
              enqueued_at_ms, enqueue_seq,
              claimed_until_ms, claimed_by, current_receipt,
              resolved_at_ms, resolution)
           VALUES (?, ?, ?, ?, 'waiting',
                   ?, ?,
                   NULL, NULL, NULL,
                   NULL, NULL)`,
        )
        .run(
          cloned.id,
          logicalId,
          jobJson,
          submissionCanonical,
          enqueuedAtMs,
          enqueueSeq,
        );

      const inserted = this.db
        .prepare("SELECT * FROM ocr_queue_jobs WHERE transport_id = ?")
        .get(cloned.id) as QueueJobRow;
      outcome = { kind: "fresh", row: inserted };
    });
    // BEGIN IMMEDIATE — any concurrent writer (claim, complete, enqueue) is
    // serialized on the reserved lock, so the dedupe read+insert pair is
    // atomic with respect to other writers.
    tx.immediate();

    if (outcome === null) {
      throw new OcrQueueError(
        "invalid_claim",
        "internal: enqueue produced no outcome",
      );
    }
    const o = outcome as { kind: "fresh" | "deduped"; row: QueueJobRow };
    return {
      job: rowToOcrJob(o.row),
      deduped: o.kind === "deduped",
    };
  }

  // -------------------------------------------------------------------------
  // claimNext
  // -------------------------------------------------------------------------

  async claimNext(workerId: string): Promise<OcrQueueClaim | null> {
    const nowMs = this.now().getTime();
    let claim: OcrQueueClaim | null = null;

    const tx = this.db.transaction(() => {
      // Pull the oldest row that is either fresh (waiting) or whose claim
      // has expired (lazy reclaim). FIFO over enqueue_seq.
      const row = this.db
        .prepare(
          `SELECT * FROM ocr_queue_jobs
             WHERE state = 'waiting'
                OR (state = 'claimed' AND claimed_until_ms <= ?)
             ORDER BY enqueue_seq ASC
             LIMIT 1`,
        )
        .get(nowMs) as QueueJobRow | undefined;
      if (row === undefined) {
        claim = null;
        return;
      }

      // If we picked an expired-claimed row, mark its old receipt as
      // superseded BEFORE minting a new one. This is the only path that
      // produces a 'superseded' resolution; without it, restart
      // classification could not distinguish stale_receipt from
      // lease_expired for a token that pre-dated the reclaim.
      if (row.state === "claimed" && row.current_receipt !== null) {
        this.db
          .prepare(
            `UPDATE ocr_queue_receipts
               SET resolution = 'superseded', resolved_at_ms = ?
             WHERE receipt = ? AND resolved_at_ms IS NULL`,
          )
          .run(nowMs, row.current_receipt);
      }

      const receipt = this.generateReceipt();
      const leaseExpiresMs = nowMs + this.leaseMs;

      this.db
        .prepare(
          `UPDATE ocr_queue_jobs
             SET state = 'claimed',
                 claimed_until_ms = ?,
                 claimed_by = ?,
                 current_receipt = ?
           WHERE transport_id = ?`,
        )
        .run(leaseExpiresMs, workerId, receipt, row.transport_id);

      this.db
        .prepare(
          `INSERT INTO ocr_queue_receipts
             (receipt, job_id, transport_id, worker_id,
              issued_at_ms, lease_expires_at_ms,
              resolved_at_ms, resolution)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 'claimed')`,
        )
        .run(
          receipt,
          row.job_id,
          row.transport_id,
          workerId,
          nowMs,
          leaseExpiresMs,
        );

      claim = {
        job_id: row.job_id,
        job: rowToOcrJob(row),
        worker_id: workerId,
        claimed_at: new Date(nowMs).toISOString(),
        lease_expires_at: new Date(leaseExpiresMs).toISOString(),
        receipt,
      };
    });
    tx.immediate();

    return claim;
  }

  // -------------------------------------------------------------------------
  // renewClaim / completeClaim / requeueClaim
  //
  // All three share a classification step: look up the receipt in the
  // ledger, decide whether the contract permits the operation, then mutate.
  // -------------------------------------------------------------------------

  async renewClaim(claim: OcrQueueClaim): Promise<OcrQueueClaim> {
    assertClaimShape(claim);
    const nowMs = this.now().getTime();
    let updated: OcrQueueClaim | null = null;

    const tx = this.db.transaction(() => {
      this.classifyOrThrow(claim, nowMs);
      const newLeaseExpiresMs = nowMs + this.leaseMs;

      this.db
        .prepare(
          `UPDATE ocr_queue_receipts
             SET lease_expires_at_ms = ?
           WHERE receipt = ?`,
        )
        .run(newLeaseExpiresMs, claim.receipt);

      this.db
        .prepare(
          `UPDATE ocr_queue_jobs
             SET claimed_until_ms = ?
           WHERE current_receipt = ? AND state = 'claimed'`,
        )
        .run(newLeaseExpiresMs, claim.receipt);

      // Reconstruct the renewed claim entirely from durable state. We
      // deliberately do NOT echo `claim.worker_id` or `claim.claimed_at`
      // back to the caller — those originate in the ledger row at
      // claim-time and are immutable. A caller that holds a valid
      // receipt but passes forged worker_id/claimed_at must not get the
      // forgery reflected back as authoritative metadata.
      const jobRow = this.db
        .prepare("SELECT * FROM ocr_queue_jobs WHERE current_receipt = ?")
        .get(claim.receipt) as QueueJobRow | undefined;
      const receiptRow = this.db
        .prepare("SELECT * FROM ocr_queue_receipts WHERE receipt = ?")
        .get(claim.receipt) as ReceiptRow | undefined;
      if (jobRow === undefined || receiptRow === undefined) {
        // classifyOrThrow already passed; reaching here would mean the
        // row vanished between classification and read inside the same
        // BEGIN IMMEDIATE — not a possible interleaving with a single
        // writer lock. Treat as an internal error.
        throw new OcrQueueError(
          "invalid_claim",
          `internal: renewClaim could not re-read receipt ${claim.receipt}`,
        );
      }
      updated = {
        job_id: jobRow.job_id,
        job: rowToOcrJob(jobRow),
        worker_id: receiptRow.worker_id,
        claimed_at: new Date(receiptRow.issued_at_ms).toISOString(),
        lease_expires_at: new Date(receiptRow.lease_expires_at_ms).toISOString(),
        receipt: receiptRow.receipt,
      };
    });
    tx.immediate();

    if (updated === null) {
      throw new OcrQueueError(
        "invalid_claim",
        "internal: renewClaim produced no claim",
      );
    }
    return updated;
  }

  async completeClaim(claim: OcrQueueClaim): Promise<void> {
    assertClaimShape(claim);
    const nowMs = this.now().getTime();

    const tx = this.db.transaction(() => {
      this.classifyOrThrow(claim, nowMs);

      this.db
        .prepare(
          `UPDATE ocr_queue_receipts
             SET resolution = 'completed', resolved_at_ms = ?
           WHERE receipt = ?`,
        )
        .run(nowMs, claim.receipt);

      this.db
        .prepare(
          `UPDATE ocr_queue_jobs
             SET state = 'resolved',
                 resolved_at_ms = ?,
                 resolution = 'completed',
                 claimed_until_ms = NULL,
                 claimed_by = NULL,
                 current_receipt = NULL
           WHERE current_receipt = ? AND state = 'claimed'`,
        )
        .run(nowMs, claim.receipt);
    });
    tx.immediate();
  }

  async requeueClaim(claim: OcrQueueClaim): Promise<void> {
    assertClaimShape(claim);
    const nowMs = this.now().getTime();

    const tx = this.db.transaction(() => {
      this.classifyOrThrow(claim, nowMs);

      this.db
        .prepare(
          `UPDATE ocr_queue_receipts
             SET resolution = 'requeued', resolved_at_ms = ?
           WHERE receipt = ?`,
        )
        .run(nowMs, claim.receipt);

      // The slot returns to the waiting set; the row's enqueue_seq is
      // preserved so re-delivery order reflects original FIFO.
      this.db
        .prepare(
          `UPDATE ocr_queue_jobs
             SET state = 'waiting',
                 claimed_until_ms = NULL,
                 claimed_by = NULL,
                 current_receipt = NULL
           WHERE current_receipt = ? AND state = 'claimed'`,
        )
        .run(claim.receipt);
    });
    tx.immediate();
  }

  /**
   * Look up a receipt in the ledger and throw the appropriate
   * `OcrQueueError`, or return when the receipt is still active. Caller
   * runs this inside a transaction so the classification reflects the
   * exact state we will then mutate.
   *
   * Cross-field validation: a caller cannot present a live receipt paired
   * with a different `claim.job_id` than the ledger recorded. The receipt
   * is the authorization token; pairing it with a foreign job_id is a
   * malformed claim, not a stale or expired one. This rejection runs
   * BEFORE the resolution/lease branches so callers cannot pivot a live
   * receipt onto a different slot via classifier path-shape.
   */
  private classifyOrThrow(claim: OcrQueueClaim, nowMs: number): void {
    const row = this.db
      .prepare("SELECT * FROM ocr_queue_receipts WHERE receipt = ?")
      .get(claim.receipt) as ReceiptRow | undefined;

    if (row === undefined) {
      throw new OcrQueueError(
        "unknown_receipt",
        `receipt ${claim.receipt} was never issued`,
      );
    }
    if (row.job_id !== claim.job_id) {
      throw new OcrQueueError(
        "invalid_claim",
        `receipt ${claim.receipt} is bound to job_id ${row.job_id}, not ${claim.job_id}`,
      );
    }
    if (row.resolution === "completed" || row.resolution === "requeued") {
      throw new OcrQueueError(
        "unknown_receipt",
        `receipt ${claim.receipt} has already been resolved (${row.resolution})`,
      );
    }
    // 'expired_swept' is a future-B2 resolution emitted by an active
    // janitor that sweeps a stale claim WITHOUT minting a successor. Until
    // B2 lands, no code path produces it; we still classify it defensively
    // here so a forward-compat row can never silently pass through. With
    // no successor receipt by definition, this is unknown_receipt — there
    // is no newer claim to make it "stale" against.
    if (row.resolution === "expired_swept") {
      throw new OcrQueueError(
        "unknown_receipt",
        `receipt ${claim.receipt} was swept after expiry`,
      );
    }
    if (row.resolution === "superseded") {
      throw new OcrQueueError(
        "stale_receipt",
        `receipt ${claim.receipt} was superseded by a newer claim`,
      );
    }
    // resolution === 'claimed' — still potentially active.
    if (row.lease_expires_at_ms <= nowMs) {
      throw new OcrQueueError(
        "lease_expired",
        `receipt ${claim.receipt} lease expired at ${row.lease_expires_at_ms}, now=${nowMs}`,
      );
    }
    // Active: caller proceeds.
  }
}

function rowToOcrJob(row: QueueJobRow): OcrJob {
  // Defensive clone — caller mutating the returned job must not affect the
  // canonical stored payload.
  return JSON.parse(row.job_json) as OcrJob;
}

/**
 * Convenience factory: open a file-backed (or `:memory:`) SQLite database,
 * configure WAL + busy_timeout, apply the schema, and return a ready-to-use
 * SqliteOcrQueue. Callers that need to share a connection with persistence
 * should construct `SqliteOcrQueue` directly with their own Database.
 */
export function openSqliteOcrQueue(
  options: OpenSqliteOcrQueueOptions = {},
): { queue: SqliteOcrQueue; db: BetterSqlite3Database } {
  const db = new Database(options.path ?? ":memory:");
  // WAL allows concurrent readers + a single writer without blocking and is
  // a safe default for file-backed SQLite. For `:memory:` the WAL pragma
  // silently no-ops (returns "memory"); both pragmas are harmless there.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  // busy_timeout is the queue's primary defence against transient
  // SQLITE_BUSY when a second connection lands on the reserved lock during
  // a BEGIN IMMEDIATE write. Zero would surface BUSY immediately at every
  // race; the value here is a deliberate ms count, not "as long as
  // possible", so a 10I-B2 contention test can pin observable behavior.
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);

  const queue = new SqliteOcrQueue({
    db,
    now: options.now,
    leaseMs: options.leaseMs,
    generateReceipt: options.generateReceipt,
    applySchemaOnInit: true,
    // The factory is the queue's owner of this handle: a subsequent
    // queue.close() must release the file lock so test teardown does not
    // leak a connection. Direct constructor callers retain ownership and
    // close their own Database.
    ownsDb: true,
  });
  return { queue, db };
}
