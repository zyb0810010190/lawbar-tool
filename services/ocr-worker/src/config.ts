// Step 10E — OCR worker runtime config.
//
// Pure parser. Inputs: env map + argv tail. Outputs: typed config or a
// thrown OcrWorkerConfigError. No process side-effects, no filesystem
// reads, no logging. All defaults documented inline.
//
// Argv > env > defaults. Both `--flag=value` and `--flag value` forms are
// accepted. Bare boolean flags (e.g. `--include-empty-outcomes`) imply true.

import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

import type { WorkerKey } from "./registry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OcrWorkerPersistenceKind = "memory" | "sqlite";
export type OcrWorkerQueueKind = "memory" | "sqlite";

const VALID_WORKER_KINDS: ReadonlySet<WorkerKey> = new Set<WorkerKey>([
  "fake",
  "paddleocr-onnx",
]);

export interface OcrWorkerConfig {
  /** Stable worker identity; passed to `claimNext`. */
  worker_id: string;
  /**
   * Which worker the bin loads from `WORKER_REGISTRY`. Default `"fake"`
   * (preserves back-compat with the pre-11C.3c bin behavior). Production
   * deployers MUST set `OCR_WORKER=paddleocr-onnx` explicitly; running
   * fake in production is operator error (same class as forgetting any
   * other env). The bin emits the chosen worker in its stderr config
   * line so operators see what they got.
   */
  worker_kind: WorkerKey;
  /**
   * Absolute path under which every `file://` source path must resolve.
   * Forwarded to `FetcherDeps.allowedFileRoot`. REQUIRED when
   * `worker_kind === "paddleocr-onnx"`; unset for `"fake"`.
   */
  fetcher_file_root: string | undefined;
  /**
   * Set of exact-match host strings the fetcher will resolve for
   * `kind: "https"` submissions. Lower-cased on parse. `undefined`
   * or empty → every https fetch throws `host_not_allowlisted`
   * (fail-closed). Optional even when worker_kind=paddleocr-onnx,
   * because some deployments use only file/inline sources.
   * Read from `OCR_FETCHER_HTTPS_HOSTS` (comma-separated) or
   * `--https-hosts`.
   */
  fetcher_https_hosts: ReadonlySet<string> | undefined;
  /** Which persistence backend to construct in the default deps factory. */
  persistence: OcrWorkerPersistenceKind;
  /**
   * Which queue backend to construct in the default deps factory.
   * Default `"memory"`. `"sqlite"` requires `persistence === "sqlite"`
   * and reuses `sqlite_path` (one file, two connections — see
   * docs/adr/ocr-queue-runtime-wiring-step-10j.md).
   */
  queue: OcrWorkerQueueKind;
  /**
   * Path to the SQLite file. Required when `persistence === "sqlite"` or
   * `queue === "sqlite"` (which already implies persistence === "sqlite").
   */
  sqlite_path: string | undefined;
  /** `runOcrWorkerLoop({ idleDelayMs })`. Default: 250ms. */
  idle_delay_ms: number;
  /** `runOcrWorkerLoop({ maxIterations })`. Undefined = run until stopped. */
  max_iterations: number | undefined;
  /** `runOcrWorkerLoop({ includeEmptyOutcomes })`. Default: false. */
  include_empty_outcomes: boolean;
  /**
   * When true, the CLI's `onOutcome` hook formats each coordinator
   * result as a single-line JSON event (via `formatCoordinatorEventJson`)
   * and writes it to stdout. Default: false (preserves the prior CLI
   * behavior where only the final summary is emitted). Operator
   * dashboards consuming the structured stream should set
   * `OCR_LOG_OUTCOMES=1` or pass `--log-outcomes`.
   */
  log_outcomes: boolean;
  /** `--help` was passed. CLI should print usage and exit 0 without running. */
  help_requested: boolean;
}

export class OcrWorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrWorkerConfigError";
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_DELAY_MS = 250;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ParseOcrWorkerConfigInput {
  env: Record<string, string | undefined>;
  argv: readonly string[];
  /** Test seam for deterministic worker_id generation. */
  generateWorkerId?: () => string;
}

/**
 * Parse env + argv into a typed `OcrWorkerConfig`. Throws
 * `OcrWorkerConfigError` for any malformed input.
 *
 * Recognized argv flags (long form only):
 *   --worker-id <s>
 *   --worker <fake|paddleocr-onnx>
 *   --fetcher-file-root <absolute-path>
 *   --https-hosts <h1,h2,...>
 *   --persistence <memory|sqlite>
 *   --queue <memory|sqlite>
 *   --sqlite-path <s>
 *   --idle-delay-ms <int>
 *   --max-iterations <int>
 *   --include-empty-outcomes [bool]
 *   --log-outcomes [bool]
 *   --help
 *
 * Recognized env keys:
 *   OCR_WORKER_ID
 *   OCR_WORKER (= worker_kind; default "fake")
 *   OCR_FETCHER_FILE_ROOT
 *   OCR_FETCHER_HTTPS_HOSTS
 *   OCR_WORKER_PERSISTENCE
 *   OCR_WORKER_QUEUE
 *   OCR_WORKER_SQLITE_PATH
 *   OCR_WORKER_IDLE_DELAY_MS
 *   OCR_WORKER_MAX_ITERATIONS
 *   OCR_WORKER_INCLUDE_EMPTY_OUTCOMES
 *   OCR_LOG_OUTCOMES
 */
export function parseOcrWorkerConfig(
  input: ParseOcrWorkerConfigInput,
): OcrWorkerConfig {
  const { env, argv } = input;
  const generateWorkerId = input.generateWorkerId ?? (() => `worker-${randomUUID()}`);

  const argvFlags = parseArgvFlags(argv);

  if (argvFlags.help) {
    return {
      worker_id: pickString(argvFlags.values.workerId, env.OCR_WORKER_ID) ?? generateWorkerId(),
      worker_kind: "fake",
      fetcher_file_root: undefined,
      fetcher_https_hosts: undefined,
      persistence: "memory",
      queue: "memory",
      sqlite_path: undefined,
      idle_delay_ms: DEFAULT_IDLE_DELAY_MS,
      max_iterations: undefined,
      include_empty_outcomes: false,
      log_outcomes: false,
      help_requested: true,
    };
  }

  // Persistence
  const persistenceRaw = pickString(argvFlags.values.persistence, env.OCR_WORKER_PERSISTENCE);
  const persistence = parsePersistence(persistenceRaw);

  // Queue
  const queueRaw = pickString(argvFlags.values.queue, env.OCR_WORKER_QUEUE);
  const queue = parseQueue(queueRaw);

  // queue=sqlite requires persistence=sqlite, so they share the SQLite
  // file (ADR-10H "Default intent for 10J: queue uses the same SQLite path
  // as persistence"). Splitting backends would imply two separate DB files,
  // which the ADR explicitly rejects.
  if (queue === "sqlite" && persistence !== "sqlite") {
    throw new OcrWorkerConfigError(
      "queue=sqlite requires persistence=sqlite (queue and persistence share the SQLite file)",
    );
  }

  // SQLite path
  const sqlitePath = pickString(argvFlags.values.sqlitePath, env.OCR_WORKER_SQLITE_PATH);
  if (persistence === "sqlite" && (sqlitePath === undefined || sqlitePath.length === 0)) {
    throw new OcrWorkerConfigError(
      "persistence=sqlite requires sqlite_path (env OCR_WORKER_SQLITE_PATH or --sqlite-path)",
    );
  }

  // Idle delay — bounded to keep an adversarial value from parking the
  // worker for hours. 60s is the upper bound; the loop only sleeps on
  // empty outcomes, so even the cap is fully recoverable via SIGINT.
  const idleDelayMs = parseInteger(
    "idle_delay_ms",
    pickRaw(argvFlags.values.idleDelayMs, env.OCR_WORKER_IDLE_DELAY_MS),
    DEFAULT_IDLE_DELAY_MS,
    { min: 0, max: 60_000 },
  );

  // Max iterations — bounded so a typo cannot create a value beyond
  // anything a human would deliberately request. Lower bound is 1 since
  // a 0-iteration loop has no meaningful semantics.
  const maxIterations = parseOptionalInteger(
    "max_iterations",
    pickRaw(argvFlags.values.maxIterations, env.OCR_WORKER_MAX_ITERATIONS),
    { min: 1, max: 1_000_000 },
  );

  // include_empty_outcomes — argv may be a bare flag (true), an explicit
  // value, or absent (fall back to env, else false).
  let includeEmptyOutcomes: boolean;
  if (argvFlags.values.includeEmptyOutcomes !== undefined) {
    includeEmptyOutcomes = parseBoolean(argvFlags.values.includeEmptyOutcomes);
  } else if (argvFlags.bareIncludeEmptyOutcomes) {
    includeEmptyOutcomes = true;
  } else if (env.OCR_WORKER_INCLUDE_EMPTY_OUTCOMES !== undefined) {
    includeEmptyOutcomes = parseBoolean(env.OCR_WORKER_INCLUDE_EMPTY_OUTCOMES);
  } else {
    includeEmptyOutcomes = false;
  }

  // log_outcomes — same precedence as include_empty_outcomes.
  let logOutcomes: boolean;
  if (argvFlags.values.logOutcomes !== undefined) {
    logOutcomes = parseBoolean(argvFlags.values.logOutcomes);
  } else if (argvFlags.bareLogOutcomes) {
    logOutcomes = true;
  } else if (env.OCR_LOG_OUTCOMES !== undefined) {
    logOutcomes = parseBoolean(env.OCR_LOG_OUTCOMES);
  } else {
    logOutcomes = false;
  }

  // Worker id: explicit > env > generated.
  const workerId =
    pickString(argvFlags.values.workerId, env.OCR_WORKER_ID) ?? generateWorkerId();

  // Worker kind: argv > env > default "fake" (ADR-11A.0 §10 + ADR-11C.3c §1).
  // Use `pickRaw` so an EXPLICIT empty value ("--worker=" or
  // OCR_WORKER="") is preserved rather than silently filtered to
  // undefined. The omitted-vs-empty distinction is load-bearing per
  // ADR-11A.0 §10: empty is a config error; truly omitted defaults to
  // "fake".
  const workerKindRaw = pickRaw(argvFlags.values.worker, env.OCR_WORKER);
  const workerKind = parseWorkerKind(workerKindRaw);

  // Fetcher root: argv > env > undefined. Use `pickRaw` for the same
  // omitted-vs-empty reason.
  const fetcherFileRootRaw = pickRaw(
    argvFlags.values.fetcherFileRoot,
    env.OCR_FETCHER_FILE_ROOT,
  );
  const fetcherFileRoot = parseFetcherFileRoot(fetcherFileRootRaw, workerKind);

  // ADR-11D.2: parse OCR_FETCHER_HTTPS_HOSTS into a Set of lowercase
  // host strings. Empty / missing → undefined (fetcher fails closed
  // for any https submission).
  const httpsHostsRaw = pickRaw(
    argvFlags.values.httpsHosts,
    env.OCR_FETCHER_HTTPS_HOSTS,
  );
  const fetcherHttpsHosts = parseHttpsHosts(httpsHostsRaw);

  // ADR-11A.0 §10 production fail-closed. Evaluated AFTER worker kind
  // resolves but BEFORE any deps construction; throws OcrWorkerConfigError
  // which maps to exit 2 at the bin's top-level catch.
  validateProductionProfile(env, workerKind);

  return {
    worker_id: workerId,
    worker_kind: workerKind,
    fetcher_file_root: fetcherFileRoot,
    fetcher_https_hosts: fetcherHttpsHosts,
    persistence,
    queue,
    sqlite_path: sqlitePath,
    idle_delay_ms: idleDelayMs,
    max_iterations: maxIterations,
    include_empty_outcomes: includeEmptyOutcomes,
    log_outcomes: logOutcomes,
    help_requested: false,
  };
}

function parseWorkerKind(raw: string | undefined): WorkerKey {
  if (raw === undefined) return "fake";
  if (raw === "") {
    // ADR-11A.0 §10: empty selector is an explicit config error,
    // NOT a silent omission. Operators who want fake must omit
    // the env / flag entirely.
    throw new OcrWorkerConfigError(
      "OCR_WORKER (or --worker) must not be empty; omit entirely to default to \"fake\", " +
        "or set explicitly to one of " +
        `${[...VALID_WORKER_KINDS].map((k) => JSON.stringify(k)).join(", ")}`,
    );
  }
  if (!VALID_WORKER_KINDS.has(raw as WorkerKey)) {
    throw new OcrWorkerConfigError(
      `unknown worker kind ${JSON.stringify(raw)}; expected one of ` +
        `${[...VALID_WORKER_KINDS].map((k) => JSON.stringify(k)).join(", ")}`,
    );
  }
  return raw as WorkerKey;
}

function parseHttpsHosts(raw: string | undefined): ReadonlySet<string> | undefined {
  if (raw === undefined) return undefined;
  if (raw === "") {
    // Same omitted-vs-empty rule as the worker selector: explicit
    // empty is a config error.
    throw new OcrWorkerConfigError(
      "OCR_FETCHER_HTTPS_HOSTS (or --https-hosts) must not be empty; " +
        "omit the env/flag entirely or supply a comma-separated host list",
    );
  }
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  if (hosts.length === 0) {
    throw new OcrWorkerConfigError(
      `OCR_FETCHER_HTTPS_HOSTS contained no non-empty host entries (got ${JSON.stringify(raw)})`,
    );
  }
  // Sanity: reject scheme/path syntax that suggests the operator
  // pasted a full URL by mistake.
  for (const h of hosts) {
    if (h.includes("://") || h.includes("/")) {
      throw new OcrWorkerConfigError(
        `OCR_FETCHER_HTTPS_HOSTS entry ${JSON.stringify(h)} looks like a URL; supply host only`,
      );
    }
  }
  return new Set(hosts);
}

function parseFetcherFileRoot(
  raw: string | undefined,
  workerKind: WorkerKey,
): string | undefined {
  if (raw === undefined) {
    // Genuinely unset.
    if (workerKind === "paddleocr-onnx") {
      throw new OcrWorkerConfigError(
        "worker=paddleocr-onnx requires fetcher_file_root " +
          "(env OCR_FETCHER_FILE_ROOT or --fetcher-file-root)",
      );
    }
    return undefined;
  }
  if (raw === "") {
    // Explicit empty — same fail-closed posture as worker.
    throw new OcrWorkerConfigError(
      "OCR_FETCHER_FILE_ROOT (or --fetcher-file-root) must not be empty; " +
        "omit the env/flag entirely or supply an absolute path",
    );
  }
  if (!isAbsolute(raw)) {
    throw new OcrWorkerConfigError(
      `fetcher_file_root must be an absolute path (got ${JSON.stringify(raw)})`,
    );
  }
  return raw;
}

/**
 * ADR-11A.0 §10 fail-closed production profile. Reading NODE_ENV and
 * OCR_WORKER_REQUIRE_REAL here (env-only — no argv flag for these,
 * per the ADR's "production deployment" framing).
 *
 * Three independent guards, all surface as exit 2:
 *   1. OCR_WORKER_REQUIRE_REAL=1 AND worker_kind="fake"
 *   2. NODE_ENV=production AND OCR_WORKER_REQUIRE_REAL unset
 *   3. NODE_ENV=production AND worker_kind="fake"
 *
 * Dev/test deployments leave both env vars unset (or set
 * OCR_WORKER_REQUIRE_REAL=1 explicitly to opt into prod-like
 * checks). Production deployments MUST set both.
 */
function validateProductionProfile(
  env: Record<string, string | undefined>,
  workerKind: WorkerKey,
): void {
  const requireReal = env.OCR_WORKER_REQUIRE_REAL;
  const nodeEnv = env.NODE_ENV;
  const requireRealActive = requireReal === "1";
  const isProduction = nodeEnv === "production";

  if (requireRealActive && workerKind === "fake") {
    throw new OcrWorkerConfigError(
      "OCR_WORKER_REQUIRE_REAL=1 forbids worker=fake; " +
        "set OCR_WORKER=paddleocr-onnx (or another real worker) or unset OCR_WORKER_REQUIRE_REAL",
    );
  }
  if (isProduction && !requireRealActive) {
    throw new OcrWorkerConfigError(
      "NODE_ENV=production requires OCR_WORKER_REQUIRE_REAL=1; " +
        "production deployments MUST set both env vars (ADR-11A.0 §10)",
    );
  }
  if (isProduction && workerKind === "fake") {
    throw new OcrWorkerConfigError(
      "NODE_ENV=production forbids worker=fake; " +
        "set OCR_WORKER=paddleocr-onnx (or another real worker)",
    );
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ArgvParseResult {
  help: boolean;
  /**
   * Captured values per known flag. Undefined = flag not seen with a value
   * (the bare boolean form for include-empty-outcomes is captured separately).
   */
  values: {
    workerId?: string;
    worker?: string;
    fetcherFileRoot?: string;
    httpsHosts?: string;
    persistence?: string;
    queue?: string;
    sqlitePath?: string;
    idleDelayMs?: string;
    maxIterations?: string;
    includeEmptyOutcomes?: string;
    logOutcomes?: string;
  };
  bareIncludeEmptyOutcomes: boolean;
  bareLogOutcomes: boolean;
}

const KNOWN_FLAGS: ReadonlyMap<string, keyof ArgvParseResult["values"] | "help"> = new Map([
  ["--worker-id", "workerId"],
  ["--worker", "worker"],
  ["--fetcher-file-root", "fetcherFileRoot"],
  ["--https-hosts", "httpsHosts"],
  ["--persistence", "persistence"],
  ["--queue", "queue"],
  ["--sqlite-path", "sqlitePath"],
  ["--idle-delay-ms", "idleDelayMs"],
  ["--max-iterations", "maxIterations"],
  ["--include-empty-outcomes", "includeEmptyOutcomes"],
  ["--log-outcomes", "logOutcomes"],
  ["--help", "help"],
]);

function parseArgvFlags(argv: readonly string[]): ArgvParseResult {
  const values: ArgvParseResult["values"] = {};
  const seen = new Set<string>();
  let help = false;
  let bareIncludeEmptyOutcomes = false;
  let bareLogOutcomes = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;

    if (!tok.startsWith("--")) {
      throw new OcrWorkerConfigError(`unexpected positional argument: ${tok}`);
    }

    // Split --flag=value; otherwise consume next token as value (unless flag is bare).
    let name: string;
    let inlineValue: string | undefined;
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      name = tok.slice(0, eq);
      inlineValue = tok.slice(eq + 1);
    } else {
      name = tok;
      inlineValue = undefined;
    }

    const known = KNOWN_FLAGS.get(name);
    if (known === undefined) {
      throw new OcrWorkerConfigError(`unknown flag: ${name}`);
    }

    // Repeated flags are an explicit error so silent last-wins surprises
    // never bury an operator typo.
    if (seen.has(name)) {
      throw new OcrWorkerConfigError(`flag ${name} repeated`);
    }
    seen.add(name);

    if (known === "help") {
      help = true;
      continue;
    }

    // include-empty-outcomes / log-outcomes may appear bare.
    if (known === "includeEmptyOutcomes" && inlineValue === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        // Consume `--include-empty-outcomes true` style.
        values.includeEmptyOutcomes = next;
        i++;
      } else {
        bareIncludeEmptyOutcomes = true;
      }
      continue;
    }
    if (known === "logOutcomes" && inlineValue === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.logOutcomes = next;
        i++;
      } else {
        bareLogOutcomes = true;
      }
      continue;
    }

    let value: string;
    if (inlineValue !== undefined) {
      value = inlineValue;
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new OcrWorkerConfigError(`flag ${name} requires a value`);
      }
      value = next;
      i++;
    }

    values[known] = value;
  }

  return { help, values, bareIncludeEmptyOutcomes, bareLogOutcomes };
}

function pickString(...candidates: ReadonlyArray<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return undefined;
}

/**
 * Like pickString, but does NOT filter empty/whitespace strings — used
 * for integer fields so the integer parser can reject empty/whitespace
 * explicitly (instead of silently falling back to the default).
 */
function pickRaw(...candidates: ReadonlyArray<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (c !== undefined) return c;
  }
  return undefined;
}

function parsePersistence(raw: string | undefined): OcrWorkerPersistenceKind {
  if (raw === undefined) return "memory";
  if (raw === "memory" || raw === "sqlite") return raw;
  throw new OcrWorkerConfigError(
    `invalid persistence: ${raw} (expected memory | sqlite)`,
  );
}

function parseQueue(raw: string | undefined): OcrWorkerQueueKind {
  if (raw === undefined) return "memory";
  if (raw === "memory" || raw === "sqlite") return raw;
  throw new OcrWorkerConfigError(
    `invalid queue: ${raw} (expected memory | sqlite)`,
  );
}

interface IntRange {
  min?: number;
  max?: number;
}

function parseInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  range: IntRange = {},
): number {
  if (raw === undefined) return fallback;
  // Empty / whitespace-only inputs are explicit errors so an
  // accidentally-cleared env var never silently degrades to defaults.
  if (raw.length === 0) {
    throw new OcrWorkerConfigError(`${name}: empty value`);
  }
  if (raw.trim().length === 0) {
    throw new OcrWorkerConfigError(`${name}: whitespace-only value (${JSON.stringify(raw)})`);
  }
  // Strict integer regex: no decimals, no exponent, no leading/trailing
  // whitespace, no partial numerics like "123abc", no hex.
  if (!/^-?\d+$/.test(raw)) {
    throw new OcrWorkerConfigError(`${name}: not an integer (${raw})`);
  }
  const n = Number.parseInt(raw, 10);
  // parseInt silently clamps oversize numbers to lossy floats.
  // Number.isSafeInteger rejects Infinity, NaN, and >2^53 magnitudes.
  if (!Number.isSafeInteger(n)) {
    throw new OcrWorkerConfigError(
      `${name}: not a safe integer (${raw})`,
    );
  }
  if (range.min !== undefined && n < range.min) {
    throw new OcrWorkerConfigError(`${name}: must be >= ${range.min} (got ${n})`);
  }
  if (range.max !== undefined && n > range.max) {
    throw new OcrWorkerConfigError(`${name}: must be <= ${range.max} (got ${n})`);
  }
  return n;
}

function parseOptionalInteger(
  name: string,
  raw: string | undefined,
  range: IntRange = {},
): number | undefined {
  if (raw === undefined) return undefined;
  return parseInteger(name, raw, 0, range);
}

const TRUTHY = new Set(["true", "1", "yes", "y", "on"]);
const FALSY = new Set(["false", "0", "no", "n", "off", ""]);

function parseBoolean(raw: string): boolean {
  const lc = raw.toLowerCase();
  if (TRUTHY.has(lc)) return true;
  if (FALSY.has(lc)) return false;
  throw new OcrWorkerConfigError(`expected boolean, got: ${raw}`);
}
