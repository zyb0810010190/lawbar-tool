// lawbar-ocr-vision — Apple Vision, reached THROUGH the app's own helper boundary (R3, WI-12 step 3).
//
// The candidate is not "Vision". It is `lawbar-ocr extract`, the Swift helper the desktop app
// packages at Contents/Resources/helpers/lawbar-ocr and spawns under a deadline. The plan's rule
// for this bake-off is that the slot is earned through the SAME boundary the app uses, so a
// development-only engine that later fails at the packaged boundary cannot win here. Therefore:
//
// - The binary is resolved from the PACKAGED bundle first (release/mac-<arch>/lawbar.app), then the
//   staged build (apps/lawbar-desktop/build/helpers), or wherever LAWBAR_OCR_HELPER points. Which
//   one answered is recorded in the probe.
// - The helper runs with an EMPTY PATH, detached, and is killed as a process group at the deadline —
//   the discipline of the other two harnesses and of the app.
// - Nothing the helper prints is believed until the digest it reports about itself equals the
//   sha256 of the file that was executed. A probe that fails that check is `probe_failed`; a run
//   that fails it is a failure observation, never a transcript.
//
// One fixture = one PNG = one page record. The helper's `vision_text` (lines joined in Vision's
// reading order) is the measurement-only transcript; `vision_ms` is the per-page inference time;
// what remains of the wall clock after render and inference is process start plus framework
// initialisation, reported as the cold load. Only `cold` runs are honest for a per-invocation CLI.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { arch as osArch, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import type {
  ActiveBakeoffFixture,
  EngineCandidate,
  EngineObservation,
  LicenseEvidence,
  ProbeResult,
  RunOptions,
} from "../types.js";

const ENGINE_NAME = "lawbar-ocr-vision";
/** The helper's own version string, as `lawbar-ocr probe` reports it. The digest is the real pin. */
const HELPER_VERSION_PINNED = "0.1.0";

const LICENSE: LicenseEvidence = {
  // The helper is this repository's code; Vision and PDFKit are macOS system frameworks linked at
  // run time under the macOS software licence. Nothing of Apple's is redistributed: no model, no
  // framework, no weights. What ships is a 550 KB executable that calls what every Mac already has.
  code_license: "repository licence (helper) + Apple macOS SLA (Vision.framework, PDFKit.framework — system, not redistributed)",
  model_license: null,
  redistribution: "permitted",
  code_evidence_url: "https://developer.apple.com/documentation/vision/vnrecognizetextrequest",
  model_evidence_url: null,
  last_verified_at: "2026-09-10",
  notes: "Recognition models are part of macOS (offline, on-device). The bake-off records the OS build with every probe because the model changes with the OS, not with this repository.",
};

// ---------------------------------------------------------------------------
// Where the helper is
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..", "..");
const DESKTOP = join(REPO_ROOT, "apps", "lawbar-desktop");

export interface HelperLocation {
  readonly path: string;
  readonly source: "env" | "packaged" | "staged" | "option";
}

/**
 * Packaged bundle first, staged build second, an explicit environment path over both. A missing
 * file is reported as such rather than falling through to a different binary silently: the point
 * of the boundary is knowing which executable answered.
 */
export function resolveHelperLocation(env: NodeJS.ProcessEnv = process.env): HelperLocation | null {
  const fromEnv = env.LAWBAR_OCR_HELPER;
  if (fromEnv !== undefined && fromEnv !== "") return { path: fromEnv, source: "env" };
  const archDir = osArch() === "arm64" ? "mac-arm64" : "mac";
  const packaged = join(DESKTOP, "release", archDir, "lawbar.app", "Contents", "Resources", "helpers", "lawbar-ocr");
  if (existsSync(packaged)) return { path: packaged, source: "packaged" };
  const staged = join(DESKTOP, "build", "helpers", "lawbar-ocr");
  if (existsSync(staged)) return { path: staged, source: "staged" };
  return null;
}

export function sha256OfFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// ---------------------------------------------------------------------------
// Options + injection seams (for tests)
// ---------------------------------------------------------------------------

export interface LawbarOcrVisionHarnessOptions {
  /** Explicit helper executable; overrides resolution. */
  binary_path?: string;
  /**
   * The digest the helper is REQUIRED to have. Default: the pin the desktop build wrote to
   * apps/lawbar-desktop/dist/src/ocr/helper-pin.json, when that file exists. A helper whose bytes
   * are not the pin is `bad_version`: the bake-off then measures exactly the binary the app ships.
   * `null` disables the check (a bake-off against an unpinned, hand-built helper — say so).
   */
  pinned_digest?: string | null;
  time_binary?: string;
  spawner?: typeof spawn;
  required_languages?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Deadline for `lawbar-ocr probe`; injectable so a hanging probe can be tested in seconds. */
  probe_timeout_ms?: number;
}

const PIN_FILE = join(DESKTOP, "dist", "src", "ocr", "helper-pin.json");

/** The desktop build's pin, or null when there is none to read. */
export function readDesktopPin(file: string = PIN_FILE): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const d = (parsed as { sha256?: unknown } | null)?.sha256;
    return typeof d === "string" && /^[0-9a-f]{64}$/.test(d) ? d : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Language mapping (BCP-47 / Tesseract tags → Vision recognition languages)
// ---------------------------------------------------------------------------

const TAG_TO_VISION: Readonly<Record<string, string>> = {
  "eng": "en-US", "en": "en-US", "en-us": "en-US", "en-gb": "en-US",
  "zh": "zh-Hans", "zh-hans": "zh-Hans", "zh-cn": "zh-Hans", "zh-hans-cn": "zh-Hans", "chi_sim": "zh-Hans",
  "zh-hant": "zh-Hant", "zh-tw": "zh-Hant", "zh-hk": "zh-Hant", "chi_tra": "zh-Hant",
};

/** The Vision recognition language for a fixture tag, or null when this harness has no mapping. */
export function resolveVisionLang(tag: string): string | null {
  return TAG_TO_VISION[tag.trim().toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Subprocess helpers — the shape of the other harnesses, with PATH emptied
// ---------------------------------------------------------------------------

interface SubprocessResult {
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  /** stdout or stderr exceeded its cap; the helper was killed and nothing it wrote is kept. */
  overflow: boolean;
  spawn_error?: NodeJS.ErrnoException;
}

const HELPER_ENV = { PATH: "" } as const;
/** A page's lines; anything larger is not a helper record. Exceeding either cap kills the helper. */
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 1 * 1024 * 1024;

async function runWithTimeout(
  spawner: typeof spawn,
  binary: string,
  args: readonly string[],
  timeout_ms: number,
): Promise<SubprocessResult> {
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawner(binary, args.slice(), { detached: true, env: HELPER_ENV, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return { exit_code: null, signal: null, stdout: "", stderr: "", timed_out: false, overflow: false, spawn_error: err as NodeJS.ErrnoException };
  }
  // Listen for `error` before anything else: a failed exec reports asynchronously with no pid.
  let spawnError: NodeJS.ErrnoException | undefined;
  const failed = new Promise<void>((res) => { proc.once("error", (e) => { spawnError = e as NodeJS.ErrnoException; res(); }); });
  if (proc.pid === undefined) {
    await failed;
    return { exit_code: null, signal: null, stdout: "", stderr: "spawn returned no pid", timed_out: false, overflow: false, spawn_error: spawnError };
  }
  const pgid = proc.pid;
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let overflow = false;
  const killGroup = (sig: NodeJS.Signals): void => { try { process.kill(-pgid, sig); } catch { /* benign */ } };
  const collect = (chunks: Buffer[], counter: { n: number }, cap: number) => (b: Buffer) => {
    if (overflow) return;
    if (counter.n + b.length > cap) {
      // A helper that floods is not producing a record: stop it now, keep nothing.
      overflow = true;
      out.length = 0;
      err.length = 0;
      killGroup("SIGKILL");
      return;
    }
    chunks.push(b);
    counter.n += b.length;
  };
  const outCounter = { n: 0 };
  const errCounter = { n: 0 };
  proc.stdout?.on("data", collect(out, outCounter, MAX_STDOUT_BYTES));
  proc.stderr?.on("data", collect(err, errCounter, MAX_STDERR_BYTES));

  let timedOut = false;
  let sigkillHandle: NodeJS.Timeout | undefined;
  let forceResolve: (() => void) | undefined;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    killGroup("SIGTERM");
    sigkillHandle = setTimeout(() => {
      killGroup("SIGKILL");
      // A descendant that left the group and kept the pipe must not hold the bake-off either.
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      forceResolve?.();
    }, 1000);
  }, timeout_ms);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
    forceResolve = () => res({ code: proc.exitCode, signal: proc.signalCode });
    proc.once("close", (code, signal) => res({ code, signal }));
    void failed.then(() => res({ code: null, signal: null }));
  });
  clearTimeout(timeoutHandle);
  if (sigkillHandle) clearTimeout(sigkillHandle);
  if (timedOut) killGroup("SIGKILL");

  return {
    exit_code: exit.code,
    signal: exit.signal,
    stdout: overflow ? "" : Buffer.concat(out).toString("utf8"),
    stderr: overflow ? "" : Buffer.concat(err).toString("utf8"),
    timed_out: timedOut,
    overflow,
    spawn_error: spawnError,
  };
}

export function parseMaxRssBytesFromTimeL(stderr: string): number | null {
  const match = stderr.match(/^\s*(\d+)\s+maximum resident set size/m);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** The helper's protocol: exactly ONE non-empty JSON line per page, and a PNG is one page. */
function parseSingleRecord(stdout: string): { record: Record<string, unknown> } | { problem: string } {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length !== 1) return { problem: `expected exactly one record line, got ${lines.length}` };
  try {
    const parsed: unknown = JSON.parse(lines[0]!);
    if (typeof parsed !== "object" || parsed === null) return { problem: "record is not an object" };
    return { record: parsed as Record<string, unknown> };
  } catch {
    return { problem: "record is not JSON" };
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The helper's error vocabulary, fixed here. An observation code is built only from this list; a
 * value the helper made up — or a path, or a client's filename — lands in `detail`, truncated,
 * under the fixed code `helper_error`.
 */
const HELPER_ERROR_CODES: ReadonlySet<string> = new Set(["unreadable_input", "page_out_of_range", "bad_arguments"]);
const HELPER_PAGE_ERRORS: ReadonlySet<string> = new Set(["render_failed", "vision_failed"]);

function helperCode(prefix: "helper_", allow: ReadonlySet<string>, raw: unknown): { code: string; unknown: string | null } {
  return typeof raw === "string" && allow.has(raw)
    ? { code: `${prefix}${raw}`, unknown: null }
    : { code: "helper_error", unknown: truncate(String(raw), 80) };
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 15_000;

interface ProbedHelper {
  readonly location: HelperLocation;
  readonly digest: string;
  readonly helper_version: string;
  readonly os_build: string;
  readonly arch: string;
  readonly vision_languages: readonly string[];
}

async function probeHelper(opts: LawbarOcrVisionHarnessOptions): Promise<ProbedHelper | ProbeResult> {
  if (osPlatform() !== "darwin") {
    return {
      status: "unsupported_platform",
      platform: osPlatform(),
      remediation: "lawbar-ocr uses Apple Vision and PDFKit; this candidate runs only on macOS.",
    };
  }
  const location: HelperLocation | null = opts.binary_path !== undefined
    ? { path: opts.binary_path, source: "option" }
    : resolveHelperLocation(opts.env ?? process.env);
  if (location === null) {
    return {
      status: "missing_dependency",
      dependency: "lawbar-ocr (apps/lawbar-desktop/release/mac-*/lawbar.app/Contents/Resources/helpers/lawbar-ocr or apps/lawbar-desktop/build/helpers/lawbar-ocr)",
      remediation: "Run `npm --prefix apps/lawbar-desktop run dist` (packaged) or `npm --prefix apps/lawbar-desktop run build:helper` (staged), or set LAWBAR_OCR_HELPER to the executable.",
    };
  }
  let isFile = false;
  try { isFile = lstatSync(location.path).isFile(); } catch { isFile = false; }
  if (!isFile) {
    return {
      status: "missing_dependency",
      dependency: location.path,
      remediation: `No regular file at ${location.path} (source: ${location.source}). Build the helper or fix LAWBAR_OCR_HELPER.`,
    };
  }
  let digest: string;
  try {
    digest = sha256OfFile(location.path);
  } catch (err) {
    return {
      status: "probe_failed",
      error_message: `could not hash ${location.path}: ${(err as NodeJS.ErrnoException).code ?? "unreadable"}`,
      remediation: "The helper must be a readable regular file; check its mode and that it is not being rewritten.",
    };
  }
  const pin = opts.pinned_digest === undefined ? readDesktopPin() : opts.pinned_digest;
  if (pin !== null && pin !== digest) {
    return {
      status: "bad_version",
      required_version: `sha256:${pin}`,
      resolved_version: `sha256:${digest}`,
      remediation: `The helper at ${location.path} (${location.source}) is not the one the desktop build pinned. Rebuild (npm --prefix apps/lawbar-desktop run dist) or pass pinned_digest: null to measure an unpinned helper knowingly.`,
    };
  }

  const spawner = opts.spawner ?? spawn;
  const probeTimeout = opts.probe_timeout_ms ?? PROBE_TIMEOUT_MS;
  const probe = await runWithTimeout(spawner, location.path, ["probe"], probeTimeout);
  if (probe.spawn_error !== undefined) {
    return {
      status: "probe_failed",
      error_message: `could not execute ${location.path}: ${probe.spawn_error.code ?? probe.spawn_error.message}`,
      remediation: "Check the executable bit and that the binary matches this machine's architecture.",
    };
  }
  if (probe.timed_out) {
    return {
      status: "probe_failed",
      error_message: `lawbar-ocr probe exceeded ${probeTimeout} ms`,
      remediation: "The helper hung on probe; run it by hand and read its stderr.",
      detail: truncate(probe.stderr, 500),
    };
  }
  if (probe.exit_code !== 0) {
    return {
      status: "probe_failed",
      error_message: `lawbar-ocr probe exited ${probe.exit_code}${probe.signal ? ` (signal ${probe.signal})` : ""}`,
      remediation: "Run `lawbar-ocr probe` by hand and read its stderr.",
      detail: truncate(probe.stderr, 500),
    };
  }
  const parsed = parseSingleRecord(probe.stdout);
  if ("problem" in parsed) {
    return {
      status: "probe_failed",
      error_message: `lawbar-ocr probe output: ${parsed.problem}`,
      remediation: "The executable at the helper path does not speak the helper protocol.",
      detail: truncate(probe.stdout, 200),
    };
  }
  const r = parsed.record;
  const reported = r.helper_build_digest;
  if (r.kind !== "probe" || typeof reported !== "string" || !HEX64.test(reported)) {
    return {
      status: "probe_failed",
      error_message: "lawbar-ocr probe output is not a probe record",
      remediation: "The executable at the helper path does not speak the helper protocol.",
      detail: truncate(probe.stdout, 200),
    };
  }
  if (reported !== digest) {
    // Whatever answered is not the file that was executed. Nothing it says is used.
    return {
      status: "probe_failed",
      error_message: `helper identity mismatch: the executable is sha256 ${digest.slice(0, 12)}… but it reports ${reported.slice(0, 12)}…`,
      remediation: "Rebuild the helper (`npm --prefix apps/lawbar-desktop run build:helper`); a wrapper or substituted binary is refused.",
    };
  }
  const helperVersion = typeof r.helper_version === "string" ? r.helper_version : "unknown";
  if (helperVersion !== HELPER_VERSION_PINNED) {
    return {
      status: "bad_version",
      required_version: HELPER_VERSION_PINNED,
      resolved_version: helperVersion,
      remediation: `This harness pins lawbar-ocr ${HELPER_VERSION_PINNED}; update HELPER_VERSION_PINNED deliberately when the helper's protocol is re-verified.`,
    };
  }
  const langs = Array.isArray(r.vision_languages) ? r.vision_languages.filter((l): l is string => typeof l === "string") : [];
  return {
    location,
    digest,
    helper_version: helperVersion,
    os_build: typeof r.os_build === "string" ? r.os_build : "unknown",
    arch: typeof r.arch === "string" ? r.arch : "unknown",
    vision_languages: langs,
  };
}

function isProbeResult(v: ProbedHelper | ProbeResult): v is ProbeResult {
  return "status" in v;
}

async function probeLawbarOcrVision(opts: LawbarOcrVisionHarnessOptions): Promise<ProbeResult> {
  const requiredLangs = opts.required_languages ?? ["eng"];
  for (const tag of requiredLangs) {
    if (resolveVisionLang(tag) === null) {
      return {
        status: "missing_model",
        model: `<unmapped:${tag}>`,
        expected_path: "(no Vision recognition language mapped for this tag)",
        remediation: `Add a TAG_TO_VISION entry for "${tag}" in src/harnesses/lawbar-ocr-vision.ts, or use a supported tag (eng, zh-Hans, zh-Hant).`,
      };
    }
  }

  const probed = await probeHelper(opts);
  if (isProbeResult(probed)) return probed;

  for (const tag of requiredLangs) {
    const lang = resolveVisionLang(tag)!;
    if (!probed.vision_languages.includes(lang)) {
      return {
        status: "missing_model",
        model: lang,
        expected_path: `(Vision on this macOS build ${probed.os_build} reports: ${probed.vision_languages.join(", ")})`,
        remediation: `This macOS build does not offer Vision recognition for ${lang}; the bake-off cannot score "${tag}" here.`,
      };
    }
  }

  // /usr/bin/time -l is the RSS backend, as for the other candidates.
  const timeBin = opts.time_binary ?? "/usr/bin/time";
  const spawner = opts.spawner ?? spawn;
  const rss = await runWithTimeout(spawner, timeBin, ["-l", "/usr/bin/true"], 5_000);
  if (rss.spawn_error?.code === "ENOENT") {
    return { status: "probe_failed", error_message: `${timeBin} not found`, remediation: "This harness needs /usr/bin/time -l (macOS BSD time) for RSS measurement." };
  }
  if (rss.timed_out || parseMaxRssBytesFromTimeL(rss.stderr) === null) {
    return { status: "probe_failed", error_message: `${timeBin} -l did not report a maximum resident set size`, remediation: "Verify /usr/bin/time -l works on this host." };
  }

  return {
    status: "available",
    resolved_version: `${probed.helper_version}+sha256.${probed.digest.slice(0, 12)}`,
    detail: `helper=${probed.location.source}:${probed.location.path} os_build=${probed.os_build} arch=${probed.arch} vision_languages=${probed.vision_languages.length}`,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function runLawbarOcrVision(
  fixture: ActiveBakeoffFixture,
  opts: RunOptions,
  harnessOpts: LawbarOcrVisionHarnessOptions,
  fixturesRoot: string,
): Promise<EngineObservation> {
  const fail = (code: string, message: string, detail?: string): EngineObservation =>
    ({ outcome: "failure", fixture_id: fixture.id, engine_name: ENGINE_NAME, code, message, ...(detail !== undefined ? { detail } : {}) });

  if (opts.run_kind !== "cold") {
    return fail("unsupported_run_kind", `lawbar-ocr is one process per invocation; only run_kind "cold" is honest, got "${opts.run_kind}".`);
  }
  const lang = resolveVisionLang(fixture.language);
  if (lang === null) return fail("unsupported_language_tag", `No Vision language mapped for fixture.language "${fixture.language}".`);

  const probed = await probeHelper(harnessOpts);
  if (isProbeResult(probed)) {
    return fail(`helper_${probed.status}`, "error_message" in probed ? probed.error_message : `helper probe: ${probed.status}`);
  }
  if (!probed.vision_languages.includes(lang)) {
    return fail("vision_language_unavailable", `Vision on macOS build ${probed.os_build} does not offer ${lang}; the fixture cannot be scored on this host.`);
  }

  const spawner = harnessOpts.spawner ?? spawn;
  const timeBin = harnessOpts.time_binary ?? "/usr/bin/time";
  const imagePath = join(fixturesRoot, fixture.path);

  const start = performance.now();
  const result = await runWithTimeout(
    spawner,
    timeBin,
    ["-l", probed.location.path, "extract", imagePath, "--lang", lang],
    opts.timeout_ms,
  );
  const latency_ms = Math.round(performance.now() - start);

  if (result.spawn_error !== undefined) return fail("spawn_failed", `could not execute ${timeBin}: ${result.spawn_error.code ?? result.spawn_error.message}`);
  if (result.timed_out) return fail("timeout", `lawbar-ocr extract exceeded ${opts.timeout_ms} ms`, truncate(result.stderr, 500));
  if (result.overflow) return fail("helper_output_overflow", "lawbar-ocr wrote more than a page record can hold; it was killed and nothing it wrote is kept");
  if (result.signal !== null) return fail(`terminated_by_signal_${result.signal}`, `lawbar-ocr terminated by signal ${result.signal}`, truncate(result.stderr, 500));

  const parsed = parseSingleRecord(result.stdout);
  if ("problem" in parsed) {
    return fail("helper_output_unparseable", `lawbar-ocr output: ${parsed.problem}. stdout: ${truncate(result.stdout, 200)}`, truncate(result.stderr, 500));
  }
  const r = parsed.record;
  if (r.kind === "error") {
    // The error record carries no digest, so it is trusted for exactly one thing: which of the
    // helper's THREE known codes it is. Anything else is `helper_error` with the value in detail.
    const mapped = helperCode("helper_", HELPER_ERROR_CODES, r.code);
    return fail(mapped.code, "lawbar-ocr reported an error record", mapped.unknown === null ? truncate(String(r.detail ?? ""), 200) : `unknown helper code: ${mapped.unknown}`);
  }
  if (result.exit_code !== 0) return fail(`helper_exit_${result.exit_code}`, `lawbar-ocr exited with code ${result.exit_code}`, truncate(result.stderr, 500));
  if (r.kind !== "page") return fail("helper_output_unparseable", `expected a page record, got kind ${JSON.stringify(r.kind)}`);
  if (r.helper_build_digest !== probed.digest) {
    return fail("helper_identity_mismatch", `the page record carries digest ${String(r.helper_build_digest).slice(0, 12)}…, the executable is ${probed.digest.slice(0, 12)}…`);
  }
  if (r.error !== null && r.error !== undefined) {
    const mapped = helperCode("helper_", HELPER_PAGE_ERRORS, r.error);
    return fail(mapped.code, "lawbar-ocr could not process the page", mapped.unknown === null ? undefined : `unknown page error: ${mapped.unknown}`);
  }
  if (typeof r.vision_text !== "string") return fail("helper_output_unparseable", "page record has no vision_text");
  const isMs = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!isMs(r.vision_ms) || !isMs(r.render_ms)) {
    // A measurement that cannot be trusted is not a measurement; a zeroed default would be a lie.
    return fail("helper_output_unparseable", "page record timings are missing or malformed");
  }

  const peak_rss_bytes = parseMaxRssBytesFromTimeL(result.stderr);
  if (peak_rss_bytes === null) return fail("rss_parse_failed", "Could not parse `maximum resident set size` from /usr/bin/time -l output", truncate(result.stderr, 500));

  const vision_ms = Math.round(r.vision_ms);
  const render_ms = Math.round(r.render_ms);

  return {
    outcome: "success",
    fixture_id: fixture.id,
    engine_name: ENGINE_NAME,
    engine_version: `${probed.helper_version}+sha256.${probed.digest.slice(0, 12)}`,
    transcript: r.vision_text,
    latency_ms,
    peak_rss_bytes,
    // The harness contract's name for what the wall clock holds beyond render and recognition. For
    // this candidate that is process start, framework initialisation, `time`, and pipe teardown —
    // NOT a measured model load; the helper does not report one. Read it as "overhead per page".
    cold_model_load_ms: Math.max(0, latency_ms - vision_ms - render_ms),
    per_page_inference_ms: vision_ms,
    run_kind: "cold",
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeLawbarOcrVisionCandidate(
  fixturesRoot: string,
  options: LawbarOcrVisionHarnessOptions = {},
): EngineCandidate {
  return {
    name: ENGINE_NAME,
    version_pinned: HELPER_VERSION_PINNED,
    license: LICENSE,
    supported_run_kinds: ["cold"],
    probe: () => probeLawbarOcrVision(options),
    run: (fixture, opts) => runLawbarOcrVision(fixture, opts, options, fixturesRoot),
    dispose: async () => { /* one process per run; nothing outlives run() */ },
  };
}
