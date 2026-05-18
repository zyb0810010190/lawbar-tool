// Production paddleocr-onnx adapter SHAPE. See ADR-11C.3a.
//
// Wires together:
//   - the fetcher (ADR-11C.2) — validated bytes
//   - the mapper  (ADR-11C.1) — engine output -> contract OcrResult
//   - the engine seam (EnginePort interface) — stubbed in 11C.3a,
//     swapped for real @gutenye/ocr-node in 11C.3b
//
// The engine takes a PATH (Detection.run -> ImageRaw.open(path)),
// not a Buffer, so the adapter writes the fetcher's validated bytes
// to a private temp file under os.tmpdir(), passes that path to
// engine.detect, and deletes the temp file in a finally. The unit
// of validation stays in bytes; the engine reads exactly those
// validated bytes; fetcher's realPath does not leak.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  OcrJobOutcome,
  OcrResult,
  OcrSubmission,
} from "ocr-worker-contract";
import {
  assertValidOcrStatusTransition,
  validateOcrSubmission,
  type TransitionRecord,
} from "ocr-worker-contract";

import type { OcrJob, OcrWorker } from "../types.js";
import {
  fetchPageBytes,
  FetcherError,
  FETCHER_ERROR_CODES,
  type FetcherDeps,
} from "../fetcher/index.js";
import {
  mapEngineLinesToOcrResult,
  type EngineLine,
  type MapperJobMeta,
} from "./mapper.js";

/**
 * The engine seam. The adapter does not know which OCR engine is
 * behind this interface — production wires @gutenye/ocr-node in
 * 11C.3b; tests inject a stub.
 *
 * `detect` is path-based (not Buffer) to mirror @gutenye/ocr-node's
 * `Ocr.detect(image)` which calls `ImageRaw.open(path)` under the
 * hood. Engine implementations MAY return `[]` for an image with no
 * recognizable text — the mapper treats that as a `succeeded` result
 * with an empty `blocks[]` and empty `raw_text`.
 */
export interface EnginePort {
  detect(imagePath: string): Promise<ReadonlyArray<EngineLine>>;
}

export interface PaddleOcrOnnxAdapterDeps {
  /** Forwarded to `fetchPageBytes`. */
  readonly fetcher: FetcherDeps;
  /** The engine seam — production or stub. */
  readonly engine: EnginePort;
  /**
   * Wall-clock for timestamps + processing-duration measurements.
   * Default: `() => new Date()`. Tests inject a deterministic clock.
   */
  readonly now?: () => Date;
  /**
   * Engine version string for the OcrResult.engine.version field.
   * Format `<pkg-version>+<model-set>` per ADR-11A.5 §"engine.version".
   * 11C.3a leaves this caller-supplied (test fixture); 11C.3b derives
   * it from the bundled `@gutenye/ocr-node` package + model set.
   */
  readonly engineVersion: string;
}

/**
 * Stable error code surfaced via `OcrResult.partial_failure.code`
 * when the engine itself throws (or otherwise fails to produce a
 * usable output). NOT in `FETCHER_ERROR_CODES`: this code is
 * adapter-local, not fetcher-local.
 *
 * Coordinators/reviewers can branch on this string alongside the
 * fetcher codes.
 */
export const ENGINE_FAILED_CODE = "engine_failed";

/**
 * Adapter entrypoint. Always returns a valid OcrJobOutcome — never
 * throws — for any per-job error class (fetcher failure, engine
 * failure). The single exception: `FetcherError` with code
 * `file_root_unconfigured` is re-thrown so the bin can surface it
 * as a config fault (exit 2 per ADR-11C.3a §3 + the user decision
 * pinned this session).
 */
export async function processPaddleOcrOnnxJob(
  job: OcrJob,
  deps: PaddleOcrOnnxAdapterDeps,
): Promise<OcrJobOutcome> {
  // OcrJob.submission is typed `unknown` at the queue boundary
  // (docs/contracts/src/queue.ts:33). The worker contract guarantees
  // the submission was validated upstream by ingestion (ADR-10K) and
  // re-validated by the coordinator (ADR-10C), but we narrow it
  // explicitly here so the adapter has type-level access to the
  // submission's fields and so a future direct enqueue (bypassing
  // ingestion) is rejected at this seam rather than crashing on a
  // null deref two scopes deeper.
  const v = validateOcrSubmission(job.submission);
  if (!v.ok) {
    throw new Error(
      "paddleocr-onnx adapter received an invalid submission: " + v.summary,
    );
  }
  const submission: OcrSubmission = v.value;
  const clock = deps.now ?? (() => new Date());

  // §3 — status-chain start: queue:queued->claimed +
  // worker:claimed->processing. Same shape as the fake worker so
  // the coordinator's chain-integrity validator accepts it.
  const statuses: TransitionRecord[] = [];
  pushTransition(statuses, "queued", "claimed", "queue", clock);
  pushTransition(statuses, "claimed", "processing", "worker", clock);

  const t0 = Date.now();
  const completedAt = () => clock().toISOString();

  // Page-binding sanity. The fetcher also asserts pages.length === 1;
  // we use the [0]! here behind that guarantee. The mapper consumes
  // submission.pages[0] for page_id + page_number.
  if (submission.pages.length !== 1) {
    // Should be unreachable: ingestion (854abf8) + fetcher (ae1de3c
    // / f6984be) both enforce N=1 with stable code
    // `multi_page_unsupported`. We let the fetcher fire that code
    // on the next call rather than duplicate the message here.
  }

  // --- Fetch -------------------------------------------------------
  let bytes: Buffer;
  let mimeType: string;
  try {
    const fetched = await fetchPageBytes(submission, deps.fetcher);
    bytes = fetched.bytes;
    mimeType = fetched.mimeType;
  } catch (err) {
    if (
      err instanceof FetcherError &&
      err.code === FETCHER_ERROR_CODES.FILE_ROOT_UNCONFIGURED
    ) {
      // Config fault — bubble up. Bin handles exit 2 in 11C.3c.
      throw err;
    }
    if (err instanceof FetcherError) {
      return assembleFailedOutcome({
        submission,
        statuses,
        clock,
        engineVersion: deps.engineVersion,
        processing_duration_ms: Date.now() - t0,
        completedAt: completedAt(),
        code: err.code,
        message: err.message,
      });
    }
    throw err;
  }

  // --- Bridge: bytes -> private temp path --------------------------
  // mkdtemp guarantees a unique, worker-owned directory under
  // os.tmpdir(); the temp file name inside is fixed but the dir
  // randomization is sufficient against collision/replacement.
  const tempDir = await mkdtemp(join(tmpdir(), "ocr-worker-paddle-"));
  const tempPath = join(tempDir, "page" + extensionForMime(mimeType));
  try {
    await writeFile(tempPath, bytes);

    // --- Engine ----------------------------------------------------
    let lines: ReadonlyArray<EngineLine>;
    try {
      lines = await deps.engine.detect(tempPath);
    } catch (err) {
      return assembleFailedOutcome({
        submission,
        statuses,
        clock,
        engineVersion: deps.engineVersion,
        processing_duration_ms: Date.now() - t0,
        completedAt: completedAt(),
        code: ENGINE_FAILED_CODE,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // --- Map -------------------------------------------------------
    const jobMeta: MapperJobMeta = {
      contract_version: submission.contract_version,
      job_id: submission.job_id,
      tenant_id: submission.tenant_id,
      document_id: submission.document_id,
      page_id: submission.pages[0]!.page_id,
      page_number: submission.pages[0]!.page_number,
    };
    if (submission.document_revision !== undefined) {
      (jobMeta as Record<string, unknown>).document_revision =
        submission.document_revision;
    }

    const result = mapEngineLinesToOcrResult({
      lines,
      job: jobMeta,
      engine: { name: "paddleocr-onnx", version: deps.engineVersion },
      timing: {
        processing_duration_ms: Date.now() - t0,
        completed_at: completedAt(),
      },
      geometry: {}, // 11C.3b/c may add width/height via image-size
    });

    pushTransition(statuses, "processing", "succeeded", "worker", clock);

    return finalizeOutcome(submission.job_id, statuses, [result]);
  } finally {
    // Cleanup invariant: temp dir is removed regardless of success
    // / failure / throw. `rm` with recursive+force tolerates absent
    // entries so we never throw out of this finally.
    await rm(tempDir, { recursive: true, force: true });
  }
}

/** Convenience factory matching the `WorkerEntry.load` signature. */
export async function makePaddleOcrOnnxWorker(
  deps: PaddleOcrOnnxAdapterDeps,
): Promise<OcrWorker> {
  return {
    process: (job) => processPaddleOcrOnnxJob(job, deps),
  };
}

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

function pushTransition(
  statuses: TransitionRecord[],
  from: TransitionRecord["from"],
  to: TransitionRecord["to"],
  controlled_by: TransitionRecord["controlled_by"],
  clock: () => Date,
): void {
  // Throws IllegalTransitionError if the edge is illegal; that would
  // be an internal bug rather than a per-job failure, so we let it
  // surface.
  assertValidOcrStatusTransition(from, to, controlled_by);
  statuses.push({
    from,
    to,
    controlled_by,
    at: clock().toISOString(),
  });
}

interface FailedOutcomeInput {
  readonly submission: OcrSubmission;
  readonly statuses: TransitionRecord[];
  readonly clock: () => Date;
  readonly engineVersion: string;
  readonly processing_duration_ms: number;
  readonly completedAt: string;
  readonly code: string;
  readonly message: string;
}

function assembleFailedOutcome(input: FailedOutcomeInput): OcrJobOutcome {
  const { submission } = input;
  const page = submission.pages[0]!;

  const result = {
    contract_version: submission.contract_version,
    job_id: submission.job_id,
    tenant_id: submission.tenant_id,
    document_id: submission.document_id,
    page_id: page.page_id,
    page_number: page.page_number,
    status: "failed" as const,
    engine: {
      name: "paddleocr-onnx",
      version: input.engineVersion,
    },
    page_metrics: {
      processing_duration_ms: input.processing_duration_ms,
    },
    partial_failure: {
      code: input.code,
      message: input.message,
      is_transient: false,
      attempted_count: 1,
    },
    metadata: {},
    completed_at: input.completedAt,
  } satisfies OcrResult;

  if (submission.document_revision !== undefined) {
    (result as Record<string, unknown>).document_revision =
      submission.document_revision;
  }

  pushTransition(
    input.statuses,
    "processing",
    "failed",
    "worker",
    input.clock,
  );

  return finalizeOutcome(submission.job_id, input.statuses, [result]);
}

function finalizeOutcome(
  job_id: string,
  statuses: TransitionRecord[],
  results: OcrResult[],
): OcrJobOutcome {
  if (statuses.length === 0) {
    throw new Error(
      "internal: paddleocr-onnx adapter produced an empty status sequence",
    );
  }
  const terminal_state = statuses[statuses.length - 1]!.to;
  return {
    job_id,
    statuses: statuses as unknown as OcrJobOutcome["statuses"],
    results,
    terminal_state,
  };
}

function extensionForMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return ".bin";
}
