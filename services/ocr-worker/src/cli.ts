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

import { processFakeOcrJob } from "ocr-worker-contract/testing";
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
import type { OcrJob, OcrJobQueueBackend, OcrWorker } from "./types.js";

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
  --persistence <memory|sqlite>       Persistence backend (default: memory)
  --queue <memory|sqlite>             Queue backend (default: memory)
                                      sqlite requires --persistence=sqlite;
                                      shares --sqlite-path with persistence.
  --sqlite-path <path>                SQLite DB path (required with --persistence=sqlite)
  --idle-delay-ms <int>               Idle pacing for empty claims (default: 250)
  --max-iterations <int>              Stop after N coordinator iterations
  --include-empty-outcomes [bool]     Emit onOutcome for empty results (default: false)
  --help                              Print this and exit 0

Environment variables (argv flags take precedence):
  OCR_WORKER_ID, OCR_WORKER_PERSISTENCE, OCR_WORKER_QUEUE,
  OCR_WORKER_SQLITE_PATH, OCR_WORKER_IDLE_DELAY_MS,
  OCR_WORKER_MAX_ITERATIONS, OCR_WORKER_INCLUDE_EMPTY_OUTCOMES

Signals:
  SIGINT/SIGTERM        Graceful shutdown — wait for the in-flight processOne()
                        to finish, log a JSON summary, then exit 0.

Exit codes:
  0   graceful stop, max_iterations, or --help
  1   loop ended with stop_reason="error"
  2   config or dep-wiring failure
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
  writeOut(JSON.stringify(summary) + "\n");

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

const defaultFakeWorker: OcrWorker = {
  async process(job: OcrJob) {
    return processFakeOcrJob(job.submission, {
      scenario: job.scenario ?? "success",
    });
  },
};

async function buildDefaultDeps(config: OcrWorkerConfig): Promise<OcrWorkerProcessDeps> {
  const worker = defaultFakeWorker;

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
