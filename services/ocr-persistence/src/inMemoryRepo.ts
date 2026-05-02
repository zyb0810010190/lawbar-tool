// In-memory implementation of `OcrPersistence`. Used for tests and local
// development. The DB-backed implementation will live alongside this file
// behind the same interface.

import {
  validateOcrSubmission,
  validateOcrResult,
  validateOcrStatusTransitionSequence,
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
} from "./types.js";

import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "./cursor.js";

import { deepEquals, transitionEquals } from "./replaySafe.js";

export interface InMemoryOcrPersistenceOptions {
  /** Deterministic clock for `created_at` / `persisted_at`. Default: `Date.now`. */
  now?: () => Date;
}

export class InMemoryOcrPersistence implements OcrPersistence {
  private readonly jobs = new Map<string, OcrJobRecord>();
  private readonly statuses = new Map<string, OcrStatusEvent[]>();
  private readonly results = new Map<string, OcrResultRecord[]>();
  private readonly now: () => Date;

  constructor(options: InMemoryOcrPersistenceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createOcrJob(submission: unknown): Promise<OcrJobRecord> {
    const v = validateOcrSubmission(submission);
    if (!v.ok) {
      throw new OcrPersistenceError(`invalid submission: ${v.summary}`);
    }
    // Clone the validated submission so post-write mutation by the caller
    // cannot leak into stored state. Ajv returns the input by reference.
    const sub = structuredClone(v.value);
    if (this.jobs.has(sub.job_id)) {
      throw new OcrPersistenceError(`job already exists: ${sub.job_id}`);
    }
    const record = buildJobRecord(sub, this.now().toISOString());
    this.jobs.set(sub.job_id, record);
    this.statuses.set(sub.job_id, []);
    this.results.set(sub.job_id, []);
    // Return a defensive copy so the caller's mutations do not bleed into
    // future reads.
    return structuredClone(record);
  }

  async appendOcrStatus(
    jobId: string,
    transition: TransitionRecord,
  ): Promise<OcrStatusEvent> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new OcrPersistenceError(`unknown job: ${jobId}`);
    }
    const existing = this.statuses.get(jobId) ?? [];
    // Re-validate the entire chain after the proposed append. This catches:
    //   - illegal single edge
    //   - wrong actor for the edge
    //   - chain break (transition.from !== last.to)
    //   - re-departure from a terminal state
    const proposed: TransitionRecord[] = [...existing, transition];
    const seq = validateOcrStatusTransitionSequence({
      job_id: jobId,
      transitions: proposed,
    });
    if (!seq.ok) {
      throw new OcrPersistenceError(
        `illegal status transition: ${seq.summary}`,
      );
    }
    const event: OcrStatusEvent = {
      // Spread copies primitives; deep-clone in case `note` or future fields
      // become non-primitive.
      ...structuredClone(transition),
      seq: existing.length + 1,
      persisted_at: this.now().toISOString(),
    };
    existing.push(event);
    this.statuses.set(jobId, existing);
    // Refresh terminal_state cache.
    job.terminal_state = transition.to;
    return structuredClone(event);
  }

  async appendOcrStatusOnce(
    jobId: string,
    transition: TransitionRecord,
  ): Promise<OcrStatusEvent> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new OcrPersistenceError(`unknown job: ${jobId}`);
    }
    const existing = this.statuses.get(jobId) ?? [];
    // Replay short-circuit: a canonically-equal transition already in the
    // chain means this exact step has already been persisted. Return that
    // event verbatim — do NOT re-validate against the chain (which would
    // wrongly reject because the transition would now appear twice).
    for (const stored of existing) {
      if (transitionEquals(stored, transition)) {
        return structuredClone(stored);
      }
    }
    // No replay match — fall through to the strict append path. This
    // correctly rejects illegal edges, chain breaks, terminal-state
    // re-departures, and anything that *looks* like an already-applied step
    // but disagrees with the persisted chain (e.g. same `from`/`to` but a
    // different `at` timestamp at a position that's already been advanced
    // past).
    return this.appendOcrStatus(jobId, transition);
  }

  async saveOcrResult(jobId: string, result: unknown): Promise<OcrResultRecord> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new OcrPersistenceError(`unknown job: ${jobId}`);
    }
    const v = validateOcrResult(result);
    if (!v.ok) {
      throw new OcrPersistenceError(`invalid result: ${v.summary}`);
    }
    const r = v.value;
    if (r.job_id !== jobId) {
      throw new OcrPersistenceError(
        `result.job_id ${r.job_id} does not match jobId ${jobId}`,
      );
    }
    if (r.tenant_id !== job.tenant_id) {
      throw new OcrPersistenceError(
        `result.tenant_id mismatch: ${r.tenant_id} vs ${job.tenant_id}`,
      );
    }
    if (r.document_id !== job.document_id) {
      throw new OcrPersistenceError(
        `result.document_id mismatch: ${r.document_id} vs ${job.document_id}`,
      );
    }
    // Page-binding: the result's page_id must correspond to a page that was
    // actually submitted for this job, and the page_number must match the
    // submitted page_number. Without this check, a misbehaving worker could
    // persist results for unsubmitted pages and the read model would never
    // detect the divergence.
    const submittedPages = (job.submission as {
      pages: ReadonlyArray<{ page_id: string; page_number: number }>;
    }).pages;
    const submittedPage = submittedPages.find((p) => p.page_id === r.page_id);
    if (!submittedPage) {
      throw new OcrPersistenceError(
        `result.page_id ${r.page_id} is not present in submission.pages for job ${jobId}`,
      );
    }
    if ((r as { page_number: number }).page_number !== submittedPage.page_number) {
      throw new OcrPersistenceError(
        `result.page_number ${(r as { page_number: number }).page_number} does not match submitted page_number ${submittedPage.page_number} for page_id ${r.page_id}`,
      );
    }
    // Document revision: enforce only when the stored job carries one
    // (matching the submission contract — `document_revision` is optional
    // at submission time).
    if (job.document_revision !== undefined) {
      const rRev = (r as { document_revision?: number }).document_revision;
      if (rRev !== job.document_revision) {
        throw new OcrPersistenceError(
          `result.document_revision ${rRev} does not match job.document_revision ${job.document_revision}`,
        );
      }
    }
    const list = this.results.get(jobId) ?? [];
    if (list.some((existing) => existing.result.page_id === r.page_id)) {
      throw new OcrPersistenceError(
        `duplicate result for (job_id=${jobId}, page_id=${r.page_id})`,
      );
    }
    const record: OcrResultRecord = {
      // Clone so post-write mutation by the caller cannot bleed into store.
      result: structuredClone(r),
      persisted_at: this.now().toISOString(),
    };
    list.push(record);
    this.results.set(jobId, list);
    return structuredClone(record);
  }

  async saveOcrResultOnce(
    jobId: string,
    result: unknown,
  ): Promise<OcrResultRecord> {
    // Run the full validation + linkage gauntlet first, BEFORE deciding
    // duplicate-vs-replay. Tampered linkage (wrong tenant, wrong document,
    // page not in submission, page_number drift, document_revision drift)
    // must produce its specific error — not a generic "conflicting duplicate".
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new OcrPersistenceError(`unknown job: ${jobId}`);
    }
    const v = validateOcrResult(result);
    if (!v.ok) {
      throw new OcrPersistenceError(`invalid result: ${v.summary}`);
    }
    const r = v.value;
    if (r.job_id !== jobId) {
      throw new OcrPersistenceError(
        `result.job_id ${r.job_id} does not match jobId ${jobId}`,
      );
    }
    if (r.tenant_id !== job.tenant_id) {
      throw new OcrPersistenceError(
        `result.tenant_id mismatch: ${r.tenant_id} vs ${job.tenant_id}`,
      );
    }
    if (r.document_id !== job.document_id) {
      throw new OcrPersistenceError(
        `result.document_id mismatch: ${r.document_id} vs ${job.document_id}`,
      );
    }
    const submittedPages = (job.submission as {
      pages: ReadonlyArray<{ page_id: string; page_number: number }>;
    }).pages;
    const submittedPage = submittedPages.find((p) => p.page_id === r.page_id);
    if (!submittedPage) {
      throw new OcrPersistenceError(
        `result.page_id ${r.page_id} is not present in submission.pages for job ${jobId}`,
      );
    }
    if ((r as { page_number: number }).page_number !== submittedPage.page_number) {
      throw new OcrPersistenceError(
        `result.page_number ${(r as { page_number: number }).page_number} does not match submitted page_number ${submittedPage.page_number} for page_id ${r.page_id}`,
      );
    }
    if (job.document_revision !== undefined) {
      const rRev = (r as { document_revision?: number }).document_revision;
      if (rRev !== job.document_revision) {
        throw new OcrPersistenceError(
          `result.document_revision ${rRev} does not match job.document_revision ${job.document_revision}`,
        );
      }
    }
    const list = this.results.get(jobId) ?? [];
    const existing = list.find((rec) => rec.result.page_id === r.page_id);
    if (existing !== undefined) {
      // Equality compares the contract result payload only. `persisted_at`
      // is store-assigned and excluded.
      if (deepEquals(existing.result, r)) {
        return structuredClone(existing);
      }
      throw new OcrPersistenceError(
        `conflicting duplicate result for (job_id=${jobId}, page_id=${r.page_id})`,
      );
    }
    const record: OcrResultRecord = {
      result: structuredClone(r),
      persisted_at: this.now().toISOString(),
    };
    list.push(record);
    this.results.set(jobId, list);
    return structuredClone(record);
  }

  async getOcrJob(jobId: string): Promise<OcrJobRecord | null> {
    const rec = this.jobs.get(jobId);
    return rec ? structuredClone(rec) : null;
  }

  async listOcrJobStatuses(jobId: string): Promise<OcrStatusEvent[]> {
    // Slice + deep-clone so callers cannot mutate internal state.
    return (this.statuses.get(jobId) ?? []).map((e) => structuredClone(e));
  }

  async listOcrResults(jobId: string): Promise<OcrResultRecord[]> {
    // Sort ascending by persisted_at; ties broken by result.page_id. Matches
    // the ordering documented on the OcrPersistence interface.
    const out = (this.results.get(jobId) ?? []).map((r) => structuredClone(r));
    out.sort((a, b) => {
      if (a.persisted_at < b.persisted_at) return -1;
      if (a.persisted_at > b.persisted_at) return 1;
      const pa = a.result.page_id;
      const pb = b.result.page_id;
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return 0;
    });
    return out;
  }

  async listOcrJobsByDocument(
    query: ListOcrJobsByDocumentQuery,
  ): Promise<ListOcrJobsByDocumentPage> {
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

    // Filter: tenant_id + document_id required; document_revision optional.
    const matched: OcrJobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.tenant_id !== query.tenant_id) continue;
      if (job.document_id !== query.document_id) continue;
      if (
        query.document_revision !== undefined &&
        job.document_revision !== query.document_revision
      ) {
        continue;
      }
      matched.push(job);
    }

    // Sort: created_at DESC, job_id ASC.
    matched.sort((a, b) => {
      if (a.created_at > b.created_at) return -1;
      if (a.created_at < b.created_at) return 1;
      if (a.job_id < b.job_id) return -1;
      if (a.job_id > b.job_id) return 1;
      return 0;
    });

    // Seek: drop rows up to and including cursor's last_sort_tuple.
    const startIdx =
      cursor === null
        ? 0
        : findSeekStartIndex(matched, cursor.last_sort_tuple, jobAfterCursor);

    const slice = matched.slice(startIdx, startIdx + limit);
    const hasMore = startIdx + limit < matched.length;

    const next_cursor =
      hasMore && slice.length > 0
        ? encodeCursor({
            v: 1,
            kind: "jobs_by_document",
            filters_hash,
            last_sort_tuple: jobSortTuple(slice[slice.length - 1]!),
          })
        : null;

    return {
      rows: slice.map((j) => structuredClone(j)),
      next_cursor,
    };
  }

  async listOcrReviewPageRows(
    query: ListOcrReviewPageRowsQuery,
  ): Promise<ListOcrReviewPageRowsPage> {
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

    // Build joined rows for jobs that pass tenant/document/case filters.
    const matched: Array<{ job: OcrJobRecord; result: OcrResultRecord }> = [];
    for (const job of this.jobs.values()) {
      if (job.tenant_id !== query.tenant_id) continue;
      if (
        query.document_id !== undefined &&
        job.document_id !== query.document_id
      ) {
        continue;
      }
      if (
        query.document_revision !== undefined &&
        job.document_revision !== query.document_revision
      ) {
        continue;
      }
      if (query.case_id !== undefined && job.case_id !== query.case_id) {
        continue;
      }
      const results = this.results.get(job.job_id) ?? [];
      for (const r of results) {
        const review = (r.result as { review?: { manual_review_recommended?: unknown } })
          .review;
        if (review?.manual_review_recommended !== true) continue;
        matched.push({ job, result: r });
      }
    }

    // Sort: persisted_at DESC, job_id ASC, page_number ASC, page_id ASC.
    matched.sort((a, b) => {
      const pa = a.result.persisted_at;
      const pb = b.result.persisted_at;
      if (pa > pb) return -1;
      if (pa < pb) return 1;
      if (a.job.job_id < b.job.job_id) return -1;
      if (a.job.job_id > b.job.job_id) return 1;
      const na = (a.result.result as { page_number: number }).page_number;
      const nb = (b.result.result as { page_number: number }).page_number;
      if (na < nb) return -1;
      if (na > nb) return 1;
      const ia = (a.result.result as { page_id: string }).page_id;
      const ib = (b.result.result as { page_id: string }).page_id;
      if (ia < ib) return -1;
      if (ia > ib) return 1;
      return 0;
    });

    const startIdx =
      cursor === null
        ? 0
        : findSeekStartIndex(matched, cursor.last_sort_tuple, reviewAfterCursor);

    const slice = matched.slice(startIdx, startIdx + limit);
    const hasMore = startIdx + limit < matched.length;

    const next_cursor =
      hasMore && slice.length > 0
        ? encodeCursor({
            v: 1,
            kind: "review_pages",
            filters_hash,
            last_sort_tuple: reviewSortTuple(slice[slice.length - 1]!),
          })
        : null;

    const rows: OcrReviewPageRow[] = slice.map((row) => ({
      job: structuredClone(row.job),
      result: structuredClone(row.result),
    }));
    return { rows, next_cursor };
  }
}

// ---------------------------------------------------------------------------
// Sort-tuple helpers for cursor seek
// ---------------------------------------------------------------------------

function jobSortTuple(job: OcrJobRecord): unknown[] {
  return [job.created_at, job.job_id];
}

/** True iff `job` comes strictly AFTER `tuple` in jobs sort order. */
function jobAfterCursor(job: OcrJobRecord, tuple: unknown[]): boolean {
  const [tCreated, tJobId] = tuple as [string, string];
  if (job.created_at < tCreated) return true;
  if (job.created_at > tCreated) return false;
  return job.job_id > tJobId;
}

function reviewSortTuple(row: { job: OcrJobRecord; result: OcrResultRecord }): unknown[] {
  return [
    row.result.persisted_at,
    row.job.job_id,
    (row.result.result as { page_number: number }).page_number,
    (row.result.result as { page_id: string }).page_id,
  ];
}

function reviewAfterCursor(
  row: { job: OcrJobRecord; result: OcrResultRecord },
  tuple: unknown[],
): boolean {
  const [tPersisted, tJobId, tPageNumber, tPageId] = tuple as [
    string,
    string,
    number,
    string,
  ];
  if (row.result.persisted_at < tPersisted) return true;
  if (row.result.persisted_at > tPersisted) return false;
  if (row.job.job_id < tJobId) return false;
  if (row.job.job_id > tJobId) return true;
  const n = (row.result.result as { page_number: number }).page_number;
  if (n < tPageNumber) return false;
  if (n > tPageNumber) return true;
  const id = (row.result.result as { page_id: string }).page_id;
  return id > tPageId;
}

function findSeekStartIndex<T>(
  rows: ReadonlyArray<T>,
  tuple: unknown[],
  isAfter: (row: T, tuple: unknown[]) => boolean,
): number {
  for (let i = 0; i < rows.length; i++) {
    if (isAfter(rows[i] as T, tuple)) return i;
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildJobRecord(sub: OcrSubmission, createdAt: string): OcrJobRecord {
  // Submission types are nominally typed by the generated d.ts. case_id is
  // optional in the contract; it lands on the record only when present.
  const subAny = sub as OcrSubmission & {
    case_id?: string;
    document_revision?: number;
  };
  const record: OcrJobRecord = {
    job_id: sub.job_id,
    tenant_id: sub.tenant_id,
    document_id: sub.document_id,
    submission: sub,
    created_at: createdAt,
  };
  if (subAny.case_id !== undefined) record.case_id = subAny.case_id;
  if (subAny.document_revision !== undefined) {
    record.document_revision = subAny.document_revision;
  }
  return record;
}
