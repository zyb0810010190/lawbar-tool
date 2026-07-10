// Step 10E — OCR worker runtime entrypoint.
//
// A thin shell around the existing Step 10D `runOcrWorkerLoop`. Owns
// only the things a real OS process needs that the loop itself does not:
//
//   - argv / env config parsing       → src/config.ts
//   - SIGINT / SIGTERM → AbortSignal   → src/processSignals.ts
//   - default queue / persistence / worker construction
//   - JSON summary logging on shutdown
//   - exit-code mapping
//
// No retry/backoff/DLQ/lease-renewal progression. No concurrency knob —
// concurrency stays 1 by construction (the loop itself enforces it).
//
// Exit codes:
//   0 — graceful stop OR max_iterations reached OR --help
//   1 — loop terminated with stop_reason="error"
//   2 — config parse failure OR dep wiring failure (startup failure)

import { statSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  InMemoryOcrPersistence,
  openSqliteOcrPersistence,
  openSqliteOcrQueue,
} from "ocr-persistence";

import {
  parseOcrWorkerConfig,
  OcrWorkerConfigError,
  type OcrWorkerConfig,
} from "./config.js";
import { installShutdownHandlers, type SignalSource } from "./processSignals.js";
import {
  OcrProcessingCoordinator,
  type OcrPersistencePort,
} from "./coordinator.js";
import { InMemoryOcrQueue } from "./inMemoryQueue.js";
import {
  runOcrWorkerLoop,
  type OcrCoordinatorLike,
  type OcrWorkerLoopSummary,
} from "./workerLoop.js";
import {
  formatCoordinatorEventJson,
  toCoordinatorEvent,
} from "./observability.js";
import { WORKER_REGISTRY } from "./registry.js";
import { makeRealPaddleEngine } from "./engines/real-paddleocr-engine.js";
import type { OcrJobQueueBackend, OcrWorker } from "./types.js";

// ---------------------------------------------------------------------------
// Log-path redaction (WI-OCR-CONFIG-PATH-REDACTION-22)
// ---------------------------------------------------------------------------

/**
 * Redact an operator-config filesystem path for LOG output to a `fp:<8-hex>`
 * fingerprint of the full path — NO path components. This exposes zero identifying
 * material (home directory, username, client/matter folder names, or even a
 * client-named basename — a *directory's* basename can itself be a client folder),
 * while remaining diagnostic: the fingerprint is stable per full path, so an
 * operator can confirm which resource is in use (and correlate across log lines) by
 * hashing their configured value. Only used for operator-config paths
 * (`sqlite_path`, `fetcher_file_root`); document-derived and temp paths are never
 * logged at all.
 */
function redactPathForLog(p: string | null | undefined): string | null {
  if (p == null) return null;
  return `fp:${createHash("sha256").update(p).digest("hex").slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Concrete dependencies the CLI needs at runtime. The default builder
 * provides every field; tests replace any subset.
 *
 * If `coordinator` is provided, it bypasses default construction (useful
 * for tests that want to inject a stub or a coordinator-throwing
 * coordinator). Otherwise the CLI builds an `OcrProcessingCoordinator`
 * from `queue` + `persistence` + `worker` + `config.worker_id`.
 */
export interface OcrWorkerProcessDeps {
  queue?: OcrJobQueueBackend;
  worker?: OcrWorker;
  persistence?: OcrPersistencePort;
  coordinator?: OcrCoordinatorLike;
  /** Called once after the loop terminates. Errors are logged, not propagated. */
  cleanup?: () => Promise<void>;
}

export type OcrWorkerProcessDepsBuilder = (
  config: OcrWorkerConfig,
) => Promise<OcrWorkerProcessDeps>;

export interface OcrWorkerProcessLike {
  on?: SignalSource["on"];
  off?: SignalSource["off"];
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
}

export interface RunOcrWorkerProcessOptions {
  /** Argv tail (already stripped of node + script). Default: []. */
  argv?: readonly string[];
  /** Environment map. Default: empty. The real CLI passes `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Process-like target for signal handlers and stdout/stderr. Defaults
   * to the global Node `process`. Tests pass an EventEmitter + buffer.
   */
  process?: OcrWorkerProcessLike;
  /** Override default dep wiring. Tests inject stubs. */
  buildDeps?: OcrWorkerProcessDepsBuilder;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP_TEXT = `OCR worker (Step 10E runtime shell)

Usage:
  node dist/cli.js [flags]

Flags:
  --worker-id <id>                    Worker identity (default: random UUID)
  --worker <fake|paddleocr-onnx>      Worker backend (default: fake).
                                      Empty value (--worker=) is an error;
                                      omit entirely to take the default.
  --fetcher-file-root <abs-path>      Allowed root for file:// page sources;
                                      REQUIRED when --worker=paddleocr-onnx.
  --https-hosts <h1,h2,...>           Comma-separated host allowlist for
                                      https:// page sources. Missing -> all
                                      https submissions reject as
                                      host_not_allowlisted.
  --persistence <memory|sqlite>       Persistence backend (default: memory)
  --queue <memory|sqlite>             Queue backend (default: memory)
                                      sqlite requires --persistence=sqlite;
                                      shares --sqlite-path with persistence.
  --sqlite-path <path>                SQLite DB path (required with --persistence=sqlite)
  --idle-delay-ms <int>               Idle pacing for empty claims (default: 250)
  --max-iterations <int>              Stop after N coordinator iterations
  --include-empty-outcomes [bool]     Emit onOutcome for empty results (default: false)
  --log-outcomes [bool]               Per-result structured JSON event on stdout
                                      (default: false). Each line is one
                                      OcrCoordinatorEvent (schema_version=1).
  --help                              Print this and exit 0

Environment variables (argv flags take precedence):
  OCR_WORKER_ID, OCR_WORKER, OCR_FETCHER_FILE_ROOT,
  OCR_FETCHER_HTTPS_HOSTS,
  OCR_WORKER_PERSISTENCE, OCR_WORKER_QUEUE,
  OCR_WORKER_SQLITE_PATH, OCR_WORKER_IDLE_DELAY_MS,
  OCR_WORKER_MAX_ITERATIONS, OCR_WORKER_INCLUDE_EMPTY_OUTCOMES,
  OCR_LOG_OUTCOMES

Production profile (ADR-11A.0 §10) — env-only, no argv flag:
  OCR_WORKER_REQUIRE_REAL=1    Forbid worker=fake (exit 2 if violated).
  NODE_ENV=production          Forbids worker=fake AND requires
                               OCR_WORKER_REQUIRE_REAL=1.

Signals:
  SIGINT/SIGTERM        Graceful shutdown — wait for the in-flight processOne()
                        to finish, log a JSON summary, then exit 0.

Exit codes:
  0   graceful stop, max_iterations, or --help
  1   loop ended with stop_reason="error"
  2   config or dep-wiring failure (incl. engine cold-load failure)
`;

export async function runOcrWorkerProcess(
  opts: RunOcrWorkerProcessOptions = {},
): Promise<number> {
  const proc: OcrWorkerProcessLike =
    opts.process ?? ((globalThis as { process?: OcrWorkerProcessLike }).process ?? {});
  const writeOut = (s: string): void => {
    proc.stdout?.write(s);
  };
  const writeErr = (s: string): void => {
    proc.stderr?.write(s);
  };

  // 1. Config
  let config: OcrWorkerConfig;
  try {
    config = parseOcrWorkerConfig({
      env: opts.env ?? {},
      argv: opts.argv ?? [],
    });
  } catch (err) {
    const msg = err instanceof OcrWorkerConfigError ? err.message : describeError(err);
    writeErr(`config error: ${msg}\n`);
    return 2;
  }

  if (config.help_requested) {
    writeOut(HELP_TEXT);
    return 0;
  }

  // ADR-11C.3c §1 + ADR-11A.0 §10: emit a one-line stderr config summary
  // so operators see exactly which worker the bin chose. Without this,
  // a misconfigured deploy could silently run the fake worker (the
  // back-compat default) while looking like real OCR.
  writeErr(
    "ocr-worker startup: " +
      JSON.stringify({
        worker_id: config.worker_id,
        worker_kind: config.worker_kind,
        // Redacted to fp:<hash> so operator home-dir / username / client-folder
        // names never reach the startup log (WI-OCR-CONFIG-PATH-REDACTION-22).
        fetcher_file_root: redactPathForLog(config.fetcher_file_root),
        fetcher_https_hosts_count: config.fetcher_https_hosts?.size ?? 0,
        persistence: config.persistence,
        queue: config.queue,
        sqlite_path: redactPathForLog(config.sqlite_path),
        max_iterations: config.max_iterations ?? null,
      }) +
      "\n",
  );

  // 2. Signal handlers (installed before deps so a slow buildDeps can be
  //    interrupted by SIGINT — but we still need to uninstall on every exit
  //    path, so wrap the rest in try/finally).
  let installed: ReturnType<typeof installShutdownHandlers> | undefined;
  if (typeof proc.on === "function" && typeof proc.off === "function") {
    installed = installShutdownHandlers({
      process: proc as SignalSource,
      onSecondSignal: (sig) => {
        writeErr(
          `received ${sig} again — shutdown already in progress, waiting for in-flight work\n`,
        );
      },
    });
  }
  const stopSignal = installed?.signal ?? new AbortController().signal;

  // 2b. Deterministic child-side readiness marker (WI-GATE5). Once the
  //     SIGINT/SIGTERM handlers above are armed, a signal flips the
  //     AbortController and the loop shuts down gracefully (exit 0 /
  //     stop_reason="stopped") — never Node's default terminate action.
  //     Emit a marker on STDERR (never stdout — the stdout summary JSON
  //     must stay clean) so a supervising process/test can wait for
  //     readiness BEFORE sending SIGINT, closing the host-load race where
  //     a signal could precede handler-arm. Only emitted when handlers
  //     were actually installed (a signal-capable process was supplied).
  if (installed !== undefined) {
    writeErr("ocr-worker ready: signal-handlers-armed\n");
  }

  // 3. Deps
  let deps: OcrWorkerProcessDeps;
  try {
    deps = await (opts.buildDeps ?? buildDefaultDeps)(config);
  } catch (err) {
    writeErr(`startup error: ${describeError(err)}\n`);
    installed?.uninstall();
    return 2;
  }

  // 4. Coordinator + loop
  let summary: OcrWorkerLoopSummary;
  try {
    const coordinator: OcrCoordinatorLike =
      deps.coordinator ??
      new OcrProcessingCoordinator({
        queue: requireDep(deps.queue, "queue"),
        persistence: requireDep(deps.persistence, "persistence"),
        worker: requireDep(deps.worker, "worker"),
        worker_id: config.worker_id,
      });

    summary = await runOcrWorkerLoop({
      coordinator,
      stopSignal,
      idleDelayMs: config.idle_delay_ms,
      maxIterations: config.max_iterations,
      includeEmptyOutcomes: config.include_empty_outcomes,
      onOutcome: config.log_outcomes
        ? (result) => {
            // Format and write a per-result structured event.
            // toCoordinatorEvent throws if a non-empty outcome has no
            // job_id (a coordinator bug); guard so a single bad row
            // does not crash the loop's onOutcome hook.
            try {
              writeOut(formatCoordinatorEventJson(toCoordinatorEvent(result)));
            } catch (err) {
              writeErr(
                `observability event format failed: ${describeError(err)}\n`,
              );
            }
          }
        : undefined,
      onError: (event) => {
        writeErr(
          `loop error (${event.phase}): ${event.message}\n`,
        );
      },
    });
  } catch (err) {
    // runOcrWorkerLoop is documented to never throw; defensive only.
    writeErr(`unexpected loop throw: ${describeError(err)}\n`);
    await safeCleanup(deps.cleanup, writeErr);
    installed?.uninstall();
    return 1;
  }

  // 5. Cleanup + summary log
  await safeCleanup(deps.cleanup, writeErr);
  installed?.uninstall();
  // Audit L1: when --log-outcomes is on, stdout is the per-event stream
  // (homogeneous OcrCoordinatorEvent schema). Mixing in the
  // OcrWorkerLoopSummary as the final stdout line would break consumers
  // parsing each line as an event. Route the summary to stderr in that
  // mode; default (no streaming) keeps the prior behavior of writing
  // the summary to stdout, since no test or consumer was expecting an
  // event stream in that configuration.
  const summaryLine = JSON.stringify(summary) + "\n";
  if (config.log_outcomes) {
    writeErr(summaryLine);
  } else {
    writeOut(summaryLine);
  }

  // 6. Exit-code mapping
  switch (summary.stop_reason) {
    case "stopped":
    case "max_iterations":
      return 0;
    case "error":
      return 1;
    default: {
      // Exhaustiveness guard.
      const _x: never = summary.stop_reason;
      void _x;
      return 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Default deps factory
// ---------------------------------------------------------------------------

/**
 * Route the config's `worker_kind` to a concrete `OcrWorker` via
 * WORKER_REGISTRY. Throws from this function (engine cold-load
 * failure, missing fetcher root) bubble out of `buildDefaultDeps` and
 * land at `runOcrWorkerProcess`'s top-level catch, which maps them
 * to exit 2 (config fault) per ADR-11A.0 §10 + ADR-11C.3c §3.
 */
async function constructWorker(config: OcrWorkerConfig): Promise<OcrWorker> {
  switch (config.worker_kind) {
    case "fake":
      return WORKER_REGISTRY.fake.load();
    case "paddleocr-onnx": {
      // Cross-validation: config parser already enforces this, but
      // defense-in-depth — the registry's load() guard also requires
      // a string, so a missing root would surface as a different
      // (less actionable) error if it slipped past config parse.
      if (config.fetcher_file_root === undefined) {
        throw new OcrWorkerConfigError(
          "internal: worker_kind=paddleocr-onnx with no fetcher_file_root after config parse",
        );
      }
      // Audit 019e3a8f D3 Medium: stat the fetcher root at startup so
      // a missing path or non-directory fails as exit 2 BEFORE engine
      // cold load, not after the first job lands and the fetcher
      // rejects. Config parser already enforces "absolute string";
      // here we additionally enforce "exists as a directory" so the
      // fail-closed window covers filesystem reality, not just
      // string shape.
      let st;
      try {
        st = statSync(config.fetcher_file_root);
      } catch (err) {
        // Use the errno CODE only — the native statSync message re-includes the
        // full path (e.g. "ENOENT ... stat '/…/client-folder'"), defeating the
        // redaction (WI-OCR-CONFIG-PATH-REDACTION-22 audit H1).
        const code = (err as NodeJS.ErrnoException).code ?? "unknown error";
        throw new OcrWorkerConfigError(
          `fetcher_file_root ${JSON.stringify(redactPathForLog(config.fetcher_file_root))} ` +
            `cannot be stat'd (${code})`,
        );
      }
      if (!st.isDirectory()) {
        throw new OcrWorkerConfigError(
          `fetcher_file_root ${JSON.stringify(redactPathForLog(config.fetcher_file_root))} ` +
            `is not a directory`,
        );
      }
      // Cold load happens here. Failure (missing models, native-binary
      // load failure, etc.) throws out of this function and maps to
      // exit 2 at the bin's top-level catch.
      const { engine, version } = await makeRealPaddleEngine();
      return WORKER_REGISTRY["paddleocr-onnx"].load({
        fetcher: {
          allowedFileRoot: config.fetcher_file_root,
          allowedHttpsHosts: config.fetcher_https_hosts,
        },
        engine,
        engineVersion: version,
      });
    }
  }
}

async function buildDefaultDeps(config: OcrWorkerConfig): Promise<OcrWorkerProcessDeps> {
  const worker = await constructWorker(config);

  if (config.persistence === "sqlite") {
    if (config.sqlite_path === undefined) {
      // Already validated by parseOcrWorkerConfig; defensive guard.
      throw new Error("internal: sqlite_path missing after config validation");
    }
    const { persistence, db: persistenceDb } = openSqliteOcrPersistence({
      path: config.sqlite_path,
    });

    if (config.queue === "sqlite") {
      // Two connections, one file. ADR-10H rejects a separate queue path
      // key; ADR-10J defers shared-connection (single-tx) wiring to 10K's
      // ingest seam — the worker side never writes queue+persistence in
      // one transaction (10C: persist-first then ack, idempotent).
      const { queue, db: queueDb } = openSqliteOcrQueue({ path: config.sqlite_path });
      return {
        queue,
        worker,
        persistence,
        cleanup: async () => {
          // close queue first so its connection releases the WAL writer
          // slot before persistence shuts down.
          try {
            queue.close();
          } finally {
            // queue.close() also closes queueDb (ownsDb=true via factory),
            // so do not double-close. Persistence db is owned here.
            persistenceDb.close();
          }
          // Reference queueDb to keep the destructure pinned in the
          // closure for static analysis tooling.
          void queueDb;
        },
      };
    }

    return {
      queue: new InMemoryOcrQueue(),
      worker,
      persistence,
      cleanup: async () => {
        persistenceDb.close();
      },
    };
  }

  // persistence=memory implies queue=memory (cross-validated in config.ts).
  return {
    queue: new InMemoryOcrQueue(),
    worker,
    persistence: new InMemoryOcrPersistence(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireDep<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`missing dep: ${name}`);
  }
  return value;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function safeCleanup(
  cleanup: (() => Promise<void>) | undefined,
  writeErr: (s: string) => void,
): Promise<void> {
  if (cleanup === undefined) return;
  try {
    await cleanup();
  } catch (err) {
    writeErr(`cleanup error: ${describeError(err)}\n`);
  }
}
