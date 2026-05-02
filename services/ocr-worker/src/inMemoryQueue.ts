// In-memory, lease-aware backend for the OCR queue seam (Step 10B).
//
// Two stores:
//   - waiting: FIFO array of jobs available to claim
//   - active : Map<receipt, ActiveClaim> for jobs currently leased
//
// Receipts are opaque strings minted on claimNext. The same receipt is
// returned by renewClaim (only `lease_expires_at` is bumped). complete /
// requeue invalidate the receipt by removing the active entry.
//
// Sweep policy: lazy, only on claimNext. Between sweeps, an expired
// receipt is still in the active map and ops that touch it surface
// `lease_expired`. After a sweep, the job is back in waiting (or has been
// re-claimed under a new receipt) and the old receipt becomes either
// `stale_receipt` (a different receipt now owns the same job_id) or
// `unknown_receipt` (the slot is no longer claimed at all).
//
// Dedupe: keyed by `submission.job_id` of an *active* (waiting + claimed)
// job. Equality is canonical JSON over the validated submission only.
// Transport metadata (OcrJob.id, enqueued_at, scenario) is intentionally
// excluded — those are per-attempt and would otherwise reject legitimate
// idempotent replays.

import { randomUUID } from "node:crypto";

import {
  OcrQueueError,
  type EnqueueResult,
  type OcrJob,
  type OcrJobQueueBackend,
  type OcrQueueClaim,
} from "./types.js";

/** Default lease window for a fresh claim. 30s. */
export const DEFAULT_LEASE_MS = 30_000;

export interface InMemoryOcrQueueOptions {
  /** Injected clock for tests. Default: `() => new Date()`. */
  now?: () => Date;
  /** Lease length applied to every fresh claim and every renew. */
  leaseMs?: number;
  /** Receipt minter. Default: `crypto.randomUUID`. */
  generateReceipt?: () => string;
}

interface ActiveClaim {
  receipt: string;
  job_id: string;
  job: OcrJob;
  worker_id: string;
  claimed_at: string;
  lease_expires_at: string;
  /** Cached numeric ms epoch of `lease_expires_at` for fast expiry checks. */
  lease_expires_ms: number;
}

// Canonical, key-sorted JSON. Two values compare equal iff their canonical
// JSON strings match. Inlined here so the worker package does not depend on
// ocr-persistence.
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k])).join(",") +
    "}"
  );
}

function deepEquals(a: unknown, b: unknown): boolean {
  return canonicalJSON(a) === canonicalJSON(b);
}

/** Pull `submission.job_id` defensively. We don't re-validate here — the
 * adapter has already validated by the time the job reaches `enqueue`. */
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

function snapshotClaim(c: ActiveClaim): OcrQueueClaim {
  return {
    job_id: c.job_id,
    job: structuredClone(c.job),
    worker_id: c.worker_id,
    claimed_at: c.claimed_at,
    lease_expires_at: c.lease_expires_at,
    receipt: c.receipt,
  };
}

export class InMemoryOcrQueue implements OcrJobQueueBackend {
  private readonly waiting: OcrJob[] = [];
  private readonly active: Map<string, ActiveClaim> = new Map();
  /**
   * All receipts ever minted by this backend, regardless of current lifecycle.
   * Used to distinguish `unknown_receipt` (never issued) from
   * `stale_receipt` (issued, then resolved/expired, slot now owned by a
   * different receipt). Memory is unbounded by design — Step 10B is
   * test/dev only; production BullMQ won't reuse this implementation.
   */
  private readonly issuedReceipts: Set<string> = new Set();
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly generateReceipt: () => string;

  constructor(options: InMemoryOcrQueueOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.generateReceipt = options.generateReceipt ?? (() => randomUUID());
  }

  // -------------------------------------------------------------------------
  // enqueue
  // -------------------------------------------------------------------------

  async enqueue(job: OcrJob): Promise<EnqueueResult> {
    const incomingJobId = jobIdOf(job);
    const incomingSubmission = (job.submission as object) ?? null;

    // Active queue dedupe: scan waiting then active for the same job_id.
    const existing = this.findActiveBySubmissionJobId(incomingJobId);
    if (existing !== null) {
      if (deepEquals(existing.submission, incomingSubmission)) {
        // Idempotent replay — return the canonical queued record. The
        // candidate's transport metadata (id / enqueued_at / scenario) is
        // discarded so callers see what is actually queued.
        return { job: structuredClone(existing), deduped: true };
      }
      throw new OcrQueueError(
        "dedupe_conflict",
        `enqueue conflict for job_id=${incomingJobId}: a different submission is already active`,
      );
    }

    const stored = structuredClone(job);
    this.waiting.push(stored);
    return { job: structuredClone(stored), deduped: false };
  }

  // -------------------------------------------------------------------------
  // claimNext
  // -------------------------------------------------------------------------

  async claimNext(workerId: string): Promise<OcrQueueClaim | null> {
    if (typeof workerId !== "string" || workerId.length === 0) {
      throw new OcrQueueError("invalid_claim", "workerId must be non-empty");
    }
    this.sweepExpired();
    const next = this.waiting.shift();
    if (next === undefined) return null;

    const nowDate = this.now();
    const claimed_at = nowDate.toISOString();
    const lease_expires_ms = nowDate.getTime() + this.leaseMs;
    const lease_expires_at = new Date(lease_expires_ms).toISOString();
    const receipt = this.generateReceipt();
    this.issuedReceipts.add(receipt);
    const record: ActiveClaim = {
      receipt,
      job_id: jobIdOf(next),
      job: next,
      worker_id: workerId,
      claimed_at,
      lease_expires_at,
      lease_expires_ms,
    };
    this.active.set(receipt, record);
    return snapshotClaim(record);
  }

  // -------------------------------------------------------------------------
  // renewClaim
  // -------------------------------------------------------------------------

  async renewClaim(claim: OcrQueueClaim): Promise<OcrQueueClaim> {
    assertClaimShape(claim);
    const record = this.lookupOrThrow(claim);
    const nowDate = this.now();
    record.lease_expires_ms = nowDate.getTime() + this.leaseMs;
    record.lease_expires_at = new Date(record.lease_expires_ms).toISOString();
    return snapshotClaim(record);
  }

  // -------------------------------------------------------------------------
  // completeClaim
  // -------------------------------------------------------------------------

  async completeClaim(claim: OcrQueueClaim): Promise<void> {
    assertClaimShape(claim);
    const record = this.lookupOrThrow(claim);
    this.active.delete(record.receipt);
  }

  // -------------------------------------------------------------------------
  // requeueClaim
  // -------------------------------------------------------------------------

  async requeueClaim(claim: OcrQueueClaim): Promise<void> {
    assertClaimShape(claim);
    const record = this.lookupOrThrow(claim);
    this.active.delete(record.receipt);
    // Push to head so a requeued job stays roughly first-in-line. Spec
    // permits any order on re-delivery; head is the friendly default.
    this.waiting.unshift(record.job);
  }

  // -------------------------------------------------------------------------
  // close (optional)
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    this.waiting.length = 0;
    this.active.clear();
  }

  // -------------------------------------------------------------------------
  // Test introspection — NOT part of OcrJobQueueBackend.
  // -------------------------------------------------------------------------

  /**
   * Total active footprint (waiting + claimed). Test-only helper. Exposed
   * on the concrete class deliberately — the contract has no `size`.
   */
  pendingCount(): number {
    return this.waiting.length + this.active.size;
  }

  /** Number of jobs currently waiting (not claimed). Test-only helper. */
  waitingCount(): number {
    return this.waiting.length;
  }

  /** Number of jobs currently claimed (not yet resolved). Test-only helper. */
  claimedCount(): number {
    return this.active.size;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Resolve a claim against the active map. Throws the appropriate
   * `OcrQueueError` on every failure mode so callers can match on `code`.
   */
  private lookupOrThrow(claim: OcrQueueClaim): ActiveClaim {
    const found = this.active.get(claim.receipt);
    if (found !== undefined) {
      const nowMs = this.now().getTime();
      if (found.lease_expires_ms <= nowMs) {
        throw new OcrQueueError(
          "lease_expired",
          `receipt has expired (lease ended at ${found.lease_expires_at})`,
        );
      }
      // Receipt is alive — but the supplied claim must still describe the
      // same logical job. A live, unexpired receipt paired with a different
      // job_id is a malformed/tampered claim, not lease succession; surface
      // it as `invalid_claim` so callers can distinguish bad input from
      // legitimate stale-after-reclaim flow.
      if (claim.job_id !== found.job_id) {
        throw new OcrQueueError(
          "invalid_claim",
          `claim.job_id=${claim.job_id} does not match the receipt's owner job_id=${found.job_id}`,
        );
      }
      return found;
    }
    // Receipt not in the active map. Disambiguate:
    //   - never issued ............................................ unknown_receipt
    //   - issued, no longer active, no successor for same job_id .. unknown_receipt
    //   - issued, no longer active, a *different* receipt now
    //     owns the same job_id .................................... stale_receipt
    if (!this.issuedReceipts.has(claim.receipt)) {
      throw new OcrQueueError(
        "unknown_receipt",
        `receipt was never issued by this backend`,
      );
    }
    for (const rec of this.active.values()) {
      if (rec.job_id === claim.job_id) {
        throw new OcrQueueError(
          "stale_receipt",
          `receipt is no longer the owner of job_id=${claim.job_id}`,
        );
      }
    }
    throw new OcrQueueError(
      "unknown_receipt",
      `receipt is not active (already resolved)`,
    );
  }

  /**
   * Move every expired active claim back to the head of `waiting`. Called
   * lazily at the start of `claimNext`. Order among swept jobs is not
   * guaranteed (spec: re-delivery may reorder), so we iterate the map.
   */
  private sweepExpired(): void {
    const nowMs = this.now().getTime();
    for (const [receipt, rec] of this.active) {
      if (rec.lease_expires_ms <= nowMs) {
        this.active.delete(receipt);
        this.waiting.unshift(rec.job);
      }
    }
  }

  /**
   * Search waiting + active for any job whose `submission.job_id` matches.
   * Returns the *contained* OcrJob (not a clone) for equality comparison.
   */
  private findActiveBySubmissionJobId(jobId: string): OcrJob | null {
    for (const j of this.waiting) {
      const sub = j.submission as { job_id?: unknown };
      if (sub?.job_id === jobId) return j;
    }
    for (const rec of this.active.values()) {
      if (rec.job_id === jobId) return rec.job;
    }
    return null;
  }
}
