// Step 10E — OCR worker runtime config.
//
// Pure parser. Inputs: env map + argv tail. Outputs: typed config or a
// thrown OcrWorkerConfigError. No process side-effects, no filesystem
// reads, no logging. All defaults documented inline.
//
// Argv > env > defaults. Both `--flag=value` and `--flag value` forms are
// accepted. Bare boolean flags (e.g. `--include-empty-outcomes`) imply true.

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OcrWorkerPersistenceKind = "memory" | "sqlite";

export interface OcrWorkerConfig {
  /** Stable worker identity; passed to `claimNext`. */
  worker_id: string;
  /** Which persistence backend to construct in the default deps factory. */
  persistence: OcrWorkerPersistenceKind;
  /** Path to the SQLite file. Required when `persistence === "sqlite"`. */
  sqlite_path: string | undefined;
  /** `runOcrWorkerLoop({ idleDelayMs })`. Default: 250ms. */
  idle_delay_ms: number;
  /** `runOcrWorkerLoop({ maxIterations })`. Undefined = run until stopped. */
  max_iterations: number | undefined;
  /** `runOcrWorkerLoop({ includeEmptyOutcomes })`. Default: false. */
  include_empty_outcomes: boolean;
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
 *   --persistence <memory|sqlite>
 *   --sqlite-path <s>
 *   --idle-delay-ms <int>
 *   --max-iterations <int>
 *   --include-empty-outcomes [bool]
 *   --help
 *
 * Recognized env keys:
 *   OCR_WORKER_ID
 *   OCR_WORKER_PERSISTENCE
 *   OCR_WORKER_SQLITE_PATH
 *   OCR_WORKER_IDLE_DELAY_MS
 *   OCR_WORKER_MAX_ITERATIONS
 *   OCR_WORKER_INCLUDE_EMPTY_OUTCOMES
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
      persistence: "memory",
      sqlite_path: undefined,
      idle_delay_ms: DEFAULT_IDLE_DELAY_MS,
      max_iterations: undefined,
      include_empty_outcomes: false,
      help_requested: true,
    };
  }

  // Persistence
  const persistenceRaw = pickString(argvFlags.values.persistence, env.OCR_WORKER_PERSISTENCE);
  const persistence = parsePersistence(persistenceRaw);

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

  // Worker id: explicit > env > generated.
  const workerId =
    pickString(argvFlags.values.workerId, env.OCR_WORKER_ID) ?? generateWorkerId();

  return {
    worker_id: workerId,
    persistence,
    sqlite_path: sqlitePath,
    idle_delay_ms: idleDelayMs,
    max_iterations: maxIterations,
    include_empty_outcomes: includeEmptyOutcomes,
    help_requested: false,
  };
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
    persistence?: string;
    sqlitePath?: string;
    idleDelayMs?: string;
    maxIterations?: string;
    includeEmptyOutcomes?: string;
  };
  bareIncludeEmptyOutcomes: boolean;
}

const KNOWN_FLAGS: ReadonlyMap<string, keyof ArgvParseResult["values"] | "help"> = new Map([
  ["--worker-id", "workerId"],
  ["--persistence", "persistence"],
  ["--sqlite-path", "sqlitePath"],
  ["--idle-delay-ms", "idleDelayMs"],
  ["--max-iterations", "maxIterations"],
  ["--include-empty-outcomes", "includeEmptyOutcomes"],
  ["--help", "help"],
]);

function parseArgvFlags(argv: readonly string[]): ArgvParseResult {
  const values: ArgvParseResult["values"] = {};
  const seen = new Set<string>();
  let help = false;
  let bareIncludeEmptyOutcomes = false;

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

    // include-empty-outcomes is the only flag that may appear bare.
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

  return { help, values, bareIncludeEmptyOutcomes };
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
