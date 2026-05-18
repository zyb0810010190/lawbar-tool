// Production paddleocr-onnx adapter SHAPE. See ADR-11C.3a + audit
// 019e3a2e fix-up commit for every guard pinned here.
//
// Wires together:
//   - the fetcher (ADR-11C.2) — validated bytes
//   - the mapper  (ADR-11C.1) — engine output -> contract OcrResult
//   - the engine seam (EnginePort interface) — stubbed in 11C.3a,
//     swapped for real @gutenye/ocr-node in 11C.3b
//
// The engine takes a PATH (Detection.run -> ImageRaw.open(path)),
// not a Buffer, so the adapter writes the fetcher's validated bytes
// to a private temp file under os.tmpdir() (mkdtemp dir, mode 0o600
// per ADR-11A.0 §7), passes that path to engine.detect, and deletes
// the temp dir in a finally regardless of success/failure/throw.
//
// Boundary policy:
//   - submission.metadata is echoed unchanged into the OcrResult.
//     The contract treats metadata as opaque (ocr-worker-contract.md
//     §1.8); dropping it breaks distributed tracing.
//   - Engine output is treated as hostile: Array.isArray + per-line
//     shape check before the mapper. Engine throws AND mapper throws
//     both translate to engine_failed.
//   - Fetcher diagnostic messages (may contain paths) are NOT
//     forwarded into the result.partial_failure.message — the
//     adapter substitutes a stable, sanitized message keyed by code
//     (audit 019e3a2e D2). Raw fetcher message stays in the
//     operator-log surface only.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join } from "node:path";

import type {
  OcrJobOutcome,
  OcrResult,
  OcrSubmission,
} from "ocr-worker-contract";
import {
  assertValidOcrStatusTransition,
  validateOcrStatusTransitionSequence,
  validateOcrSubmission,
  type TransitionRecord,
} from "ocr-worker-contract";

import type { OcrJob, OcrWorker } from "../types.js";
import {
  fetchPageBytes,
  FetcherError,
  FETCHER_ERROR_CODES,
  type FetcherDeps,
  type FetcherErrorCode,
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
 */
export interface EnginePort {
  detect(imagePath: string): Promise<ReadonlyArray<EngineLine>>;
}

export interface PaddleOcrOnnxAdapterDeps {
  readonly fetcher: FetcherDeps;
  readonly engine: EnginePort;
  /**
   * Wall-clock for ISO timestamps on TransitionRecord.at + completed_at.
   * Defaults to `() => new Date()`.
   *
   * Note: NOT used for processing_duration_ms — that uses
   * `performance.now()` so a wall-clock backward adjustment cannot
   * produce a negative duration (audit 019e3a2e D3).
   */
  readonly now?: () => Date;
  /**
   * Engine version string for OcrResult.engine.version. Format
   * `<pkg-version>+<model-set>` per ADR-11A.5. Required.
   */
  readonly engineVersion: string;
}

/**
 * Stable error code surfaced via `OcrResult.partial_failure.code`
 * when the engine itself throws / returns unusable output / the
 * mapper throws on engine output the boundary didn't catch.
 *
 * NOT in FETCHER_ERROR_CODES: this is adapter-local.
 */
export const ENGINE_FAILED_CODE = "engine_failed";

/**
 * Stable, result-facing messages for each rejection code. Substituted
 * for the raw FetcherError.message before the message lands in
 * OcrResult.partial_failure.message (audit 019e3a2e D2 Medium —
 * raw fetcher messages can carry path data and travel further than
 * operator logs).
 *
 * Operators still see the raw fetcher diagnostic — the adapter does
 * not silence it from the throw site, only sanitizes what lands in
 * the durable result envelope.
 */
const SANITIZED_FETCHER_MESSAGES: Readonly<Record<FetcherErrorCode, string>> =
  Object.freeze({
    source_kind_unsupported: "Submission source kind is not admitted by the v1 fetcher.",
    multi_page_unsupported: "Multi-page submissions are not supported in v1.",
    file_root_unconfigured: "Fetcher file root is not configured.",
    path_escape: "Source path failed containment check.",
    file_not_found: "Source file not found.",
    file_not_regular: "Source path is not a regular file.",
    size_mismatch: "Source file size does not match the declared byte_size.",
    size_cap_exceeded: "Source file exceeds the per-page size cap.",
    mime_unsupported: "Source mime_type is not in the v1 allowlist.",
    mime_signature_mismatch: "Source bytes do not match the declared mime_type signature.",
    // ADR-11D.2 https codes — same path-redaction posture as file codes:
    // operator log carries the raw URL/host; the durable result envelope
    // gets the sanitized message only.
    http_scheme_unsupported: "Source URL scheme is not allowed (https:// only).",
    url_expired: "Source URL has expired.",
    host_not_allowlisted: "Source URL host is not in the configured allowlist.",
    host_resolves_to_private_ip: "Source URL host resolves to a private / loopback address.",
    redirect_unsupported: "Source URL returned a redirect; v1 does not follow redirects.",
    https_status_not_ok: "Source URL responded with a non-200 status.",
    https_timeout: "Source URL fetch timed out.",
    https_network_error: "Source URL fetch failed with a network error.",
    content_hash_mismatch: "Fetched bytes do not match the declared expected_sha256.",
  });

const ENGINE_FAILED_MESSAGE = "OCR engine failed to process the image.";

/**
 * Adapter entrypoint. Always returns a valid OcrJobOutcome — never
 * throws — for any per-job error class (fetcher failure, engine
 * failure, engine returns unusable output). The single exception:
 * `FetcherError` with code `file_root_unconfigured` is re-thrown so
 * the bin can surface it as a config fault (exit 2).
 */
export async function processPaddleOcrOnnxJob(
  job: OcrJob,
  deps: PaddleOcrOnnxAdapterDeps,
): Promise<OcrJobOutcome> {
  // OcrJob.submission is typed `unknown` at the queue boundary
  // (docs/contracts/src/queue.ts:33). The worker contract guarantees
  // the submission was validated upstream by ingestion (ADR-10K) and
  // re-validated by the coordinator (ADR-10C), but we narrow it
  // explicitly here so the adapter has type-level access and a
  // future direct-enqueue path (bypassing ingestion) is rejected at
  // this seam rather than crashing two scopes deeper.
  const v = validateOcrSubmission(job.submission);
  if (!v.ok) {
    throw new Error(
      "paddleocr-onnx adapter received an invalid submission: " + v.summary,
    );
  }
  const submission: OcrSubmission = v.value;
  const clock = deps.now ?? (() => new Date());

  // Status-chain start: queue:queued->claimed + worker:claimed->processing.
  // Same shape as the fake worker for coordinator chain-integrity.
  const statuses: TransitionRecord[] = [];
  pushTransition(statuses, "queued", "claimed", "queue", clock);
  pushTransition(statuses, "claimed", "processing", "worker", clock);

  // Duration uses performance.now() — monotonic — so a wall-clock
  // backward adjustment cannot produce a contract-invalid negative
  // duration (schema requires processing_duration_ms >= 0).
  const t0 = performance.now();
  const durationMs = () => Math.max(0, Math.round(performance.now() - t0));
  const completedAt = () => clock().toISOString();

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
        processing_duration_ms: durationMs(),
        completedAt: completedAt(),
        code: err.code,
        message: SANITIZED_FETCHER_MESSAGES[err.code],
      });
    }
    throw err;
  }

  // --- Bridge: bytes -> private temp path --------------------------
  // mkdtemp creates the directory with POSIX 0o700; writeFile with
  // mode 0o600 enforces explicit file confidentiality per
  // ADR-11A.0 §7.
  const tempDir = await mkdtemp(join(tmpdir(), "ocr-worker-paddle-"));
  const tempPath = join(tempDir, "page" + extensionForMime(mimeType));
  try {
    await writeFile(tempPath, bytes, { mode: 0o600 });

    // --- Engine + Map (hostile boundary) ---------------------------
    // Engine output is treated as runtime-hostile. We wrap the
    // detect + map calls in one try so non-array returns,
    // non-EngineLine shapes, mapper throws on the engine path, and
    // outright engine throws ALL surface as engine_failed.
    let result: OcrResult;
    try {
      const detectOutput = await deps.engine.detect(tempPath);
      const lines = sanitizeEngineLines(detectOutput);
      const jobMeta = buildMapperJobMeta(submission);
      result = mapEngineLinesToOcrResult({
        lines,
        job: jobMeta,
        engine: { name: "paddleocr-onnx", version: deps.engineVersion },
        timing: {
          processing_duration_ms: durationMs(),
          completed_at: completedAt(),
        },
        geometry: {},
      });
    } catch (err) {
      return assembleFailedOutcome({
        submission,
        statuses,
        clock,
        engineVersion: deps.engineVersion,
        processing_duration_ms: durationMs(),
        completedAt: completedAt(),
        code: ENGINE_FAILED_CODE,
        message: ENGINE_FAILED_MESSAGE,
        rawError: err,
      });
    }

    // Echo submission.metadata on the success path (contract §1.8 —
    // metadata MUST be echoed unchanged; audit 019e3a2e D3 High).
    (result as { metadata: unknown }).metadata = structuredClone(submission.metadata);

    pushTransition(statuses, "processing", "succeeded", "worker", clock);
    return finalizeOutcome(submission.job_id, statuses, [result]);
  } finally {
    // Cleanup invariant: temp dir is removed regardless of
    // success / failure / throw. `rm` with recursive+force tolerates
    // missing entries; OTHER deletion failures (e.g., EACCES) can
    // still reject. We swallow them deliberately so a tempfile
    // cleanup error never masks the job outcome.
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Operator log only — but the adapter has no logger seam yet.
      // If/when telemetry is added, route this here.
    }
  }
}

/** Convenience factory matching the WorkerEntry.load signature. */
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
  // Throws IllegalTransitionError on illegal edge — internal bug, not
  // per-job failure; we let it surface.
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
  readonly rawError?: unknown; // for future op-log routing; unused today
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
    metadata: structuredClone(submission.metadata),
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

function buildMapperJobMeta(submission: OcrSubmission): MapperJobMeta {
  const meta: MapperJobMeta = {
    contract_version: submission.contract_version,
    job_id: submission.job_id,
    tenant_id: submission.tenant_id,
    document_id: submission.document_id,
    page_id: submission.pages[0]!.page_id,
    page_number: submission.pages[0]!.page_number,
  };
  if (submission.document_revision !== undefined) {
    (meta as Record<string, unknown>).document_revision =
      submission.document_revision;
  }
  return meta;
}

/**
 * Hostile-engine boundary (audit 019e3a2e D3 High). The mapper has
 * per-field hostile-input guards (NaN/Infinity confidence, non-finite
 * polygon coords); the adapter is responsible for the OUTER shape
 * (is it even an array; is each element an object with a text).
 *
 * Returns the cleaned array; throws if the outer shape is wrong so
 * the caller's try/catch can convert to engine_failed.
 */
function sanitizeEngineLines(input: unknown): ReadonlyArray<EngineLine> {
  if (!Array.isArray(input)) {
    throw new TypeError(
      "engine.detect returned a non-array value; expected ReadonlyArray<EngineLine>",
    );
  }
  for (const [i, line] of input.entries()) {
    if (line === null || typeof line !== "object") {
      throw new TypeError(
        `engine.detect line[${i}] is not an object`,
      );
    }
    if (typeof (line as { text?: unknown }).text !== "string") {
      throw new TypeError(
        `engine.detect line[${i}].text is not a string`,
      );
    }
  }
  return input as ReadonlyArray<EngineLine>;
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
  // Full-sequence integrity check (audit 019e3a2e D7) — per-edge
  // assertValidOcrStatusTransition catches illegal edges but not a
  // chain with missing middle transitions or actor drift. We run the
  // sequence validator here as a hard pin; any failure is an
  // internal bug, not a per-job failure.
  const seqResult = validateOcrStatusTransitionSequence({
    job_id,
    transitions: statuses,
  });
  if (!seqResult.ok) {
    throw new Error(
      "internal: paddleocr-onnx adapter assembled invalid status sequence: " +
        seqResult.summary,
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
