// Tesseract OCR engine adapter for the bakeoff.
//
// =================  TESSERACT LEASE-METRIC RATIONALE  ========================
//
// Tesseract has no daemon / no reusable persistent process exposed via its
// CLI. Every `tesseract <image> stdout` invocation:
//
//   - spawns a fresh process
//   - loads the engine into the new process
//   - loads the requested traineddata
//   - runs inference on the image
//   - emits to stdout
//   - exits
//
// There is no "one-time job-level load" that subsequent pages can
// amortize. Every page invocation pays the startup cost.
//
// This adapter therefore reports `cold_model_load_ms: 0` and folds the
// entire latency (including startup + traineddata load) into
// `per_page_inference_ms`. That is the honest model for a CLI-per-page
// engine. The lease-renewal metric assembled in ε MUST treat Tesseract's
// per-page cost as inclusive of startup; it cannot subtract a cold-load
// term that does not exist.
//
// `supported_run_kinds: ["cold"]` accordingly. Direct `run_kind: "warm"`
// requests return a structured `unsupported_run_kind` failure rather
// than silently downgrading.
// =============================================================================

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { join } from "node:path";

import type {
  ActiveBakeoffFixture,
  AvailableProbeResult,
  EngineCandidate,
  EngineObservation,
  LicenseEvidence,
  ProbeResult,
  RunOptions,
} from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENGINE_NAME = "tesseract";
const VERSION_PINNED = "5.5.2";

const LICENSE: LicenseEvidence = {
  code_license: "Apache-2.0",
  model_license: "Apache-2.0",
  redistribution: "permitted",
  code_evidence_url: "https://github.com/tesseract-ocr/tesseract/blob/5.5.2/LICENSE",
  // Homebrew's tesseract 5.5.2 formula fetches eng.traineddata from
  // tessdata_fast@4.1.0. The same Apache-2.0 license, but it ships from
  // a separate repository so we record its own evidence URL.
  model_evidence_url: "https://github.com/tesseract-ocr/tessdata_fast/blob/4.1.0/LICENSE",
  last_verified_at: "2026-05-17",
  notes: "Homebrew tesseract@5.5.2 ships eng/osd/snum traineddata. chi_sim is NOT bundled (requires `brew install tesseract-lang`).",
};

// ---------------------------------------------------------------------------
// Options + injection seams (for tests)
// ---------------------------------------------------------------------------

export interface TesseractHarnessOptions {
  /** Override the `tesseract` binary path. Default: `tesseract` (resolved via PATH). */
  binary_path?: string;
  /** Override the `time -l` binary path. Default: `/usr/bin/time`. */
  time_binary?: string;
  /**
   * BCP-47 language tags this harness needs at probe time. The harness
   * resolves each tag to the corresponding Tesseract engine model name
   * (e.g. `zh-Hans` → `chi_sim`) via `resolveTesseractLang()` and
   * verifies the model is installed. Default: `["eng"]`.
   */
  required_languages?: readonly string[];
  /** Test seam: provide a fake spawner. Defaults to `node:child_process`'s `spawn`. */
  spawner?: typeof spawn;
}

// ---------------------------------------------------------------------------
// BCP-47 → Tesseract engine-language mapping (audit thread 019e36a0 D3.4).
//
// Fixtures declare their language as a BCP-47 tag (e.g. `zh-Hans`).
// Tesseract's CLI expects engine model names (`chi_sim`). Bridging the
// two used to be a no-op branch (`fixture.language === "eng" ? "eng" :
// fixture.language`) that would have broken the moment any non-English
// fixture arrived. This map is engine-specific; γ (PaddleOCR) and
// δ (RapidOCR) will ship their own resolvers.
// ---------------------------------------------------------------------------

const TAG_TO_TESS_LANG: Readonly<Record<string, string>> = Object.freeze({
  "eng": "eng",
  "en": "eng",
  "en-US": "eng",
  "en-GB": "eng",
  "zh": "chi_sim",       // unqualified Chinese defaults to Simplified
  "zh-Hans": "chi_sim",
  "zh-Hans-CN": "chi_sim",
  "zh-CN": "chi_sim",
  "zh-Hant": "chi_tra",
  "zh-Hant-TW": "chi_tra",
  "zh-TW": "chi_tra",
  "zh-HK": "chi_tra",
  "ja": "jpn",
  "ja-JP": "jpn",
  "jpn": "jpn",
  "ko": "kor",
  "ko-KR": "kor",
  "kor": "kor",
  "osd": "osd",          // orientation + script detection (engine-internal tag)
});

/**
 * Resolve a BCP-47 (or Tesseract-native) language tag to the engine model
 * name Tesseract loads via `-l`. Returns null if no mapping is known —
 * callers MUST surface this as an unsupported_language_tag failure
 * rather than blindly passing the tag through.
 */
export function resolveTesseractLang(tag: string): string | null {
  return TAG_TO_TESS_LANG[tag] ?? null;
}

// ---------------------------------------------------------------------------
// RSS parser
// ---------------------------------------------------------------------------

/**
 * Parse the `/usr/bin/time -l` output line `<bytes>  maximum resident set size`.
 * macOS BSD `time -l` reports peak RSS in BYTES (not kbytes as Linux does).
 * Returns null if the line is absent or unparseable.
 */
export function parseMaxRssBytesFromTimeL(stderr: string): number | null {
  // The macOS line looks like:
  //   "             1474560  maximum resident set size"
  // Bytes appear before the label, may be preceded by whitespace.
  const match = stderr.match(/^\s*(\d+)\s+maximum resident set size/m);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Subprocess helper — process-group cleanup on timeout
// ---------------------------------------------------------------------------

interface SubprocessResult {
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

async function runWithTimeout(
  spawner: typeof spawn,
  binary: string,
  args: readonly string[],
  timeout_ms: number,
): Promise<SubprocessResult> {
  // `detached: true` places the spawned process in its own process group
  // so we can SIGTERM / SIGKILL the entire descendant tree on timeout.
  // On macOS, `/usr/bin/time -l <cmd>` execs the child in the same group
  // by default; with detached:true Node creates a fresh group for the
  // wrapper, and the wrapper's exec(2) keeps the child in that group.
  const proc = spawner(binary, args.slice(), { detached: true });
  if (proc.pid === undefined) {
    return {
      exit_code: null,
      signal: null,
      stdout: "",
      stderr: "spawn returned no pid",
      timed_out: false,
    };
  }
  const pgid = proc.pid;

  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (b: Buffer) => { stdout += b.toString("utf8"); });
  proc.stderr?.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });

  let timedOut = false;
  let sigkillHandle: NodeJS.Timeout | undefined;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    try {
      // Negative pid → kill the whole process group.
      process.kill(-pgid, "SIGTERM");
    } catch {
      // ESRCH if the group already exited — benign.
    }
    // SIGKILL grace. Store the handle so we can cancel it on `close`;
    // otherwise the timer can fire later against a recycled PGID and
    // kill an unrelated process group (audit thread 019e36a0 D3.1).
    sigkillHandle = setTimeout(() => {
      try { process.kill(-pgid, "SIGKILL"); } catch { /* benign */ }
    }, 1000);
    sigkillHandle.unref();
  }, timeout_ms);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    proc.on("close", (code, signal) => resolve({ code, signal }));
    proc.on("error", (err) => {
      stderr += `\nspawn error: ${(err as Error).message}`;
      resolve({ code: null, signal: null });
    });
  });

  clearTimeout(timeoutHandle);
  if (sigkillHandle) clearTimeout(sigkillHandle);

  return {
    exit_code: exit.code,
    signal: exit.signal,
    stdout,
    stderr,
    timed_out: timedOut,
  };
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

/** Probe-side timeout: short cap on every captureCommand invocation. */
const PROBE_TIMEOUT_MS = 5_000;

async function captureCommand(
  spawner: typeof spawn,
  binary: string,
  args: readonly string[],
  timeout_ms: number = PROBE_TIMEOUT_MS,
): Promise<{ exit_code: number | null; stdout: string; stderr: string; error?: NodeJS.ErrnoException; timed_out?: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let proc;
    try {
      proc = spawner(binary, args.slice());
    } catch (err) {
      resolve({ exit_code: null, stdout: "", stderr: "", error: err as NodeJS.ErrnoException });
      return;
    }
    // Audit 019e36a0 D3.2: a hung probe subprocess (e.g. `tesseract
    // --version` blocking on a broken install) would otherwise block the
    // bakeoff indefinitely. Hard cap every probe-side spawn.
    let timedOut = false;
    const handle = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGKILL"); } catch { /* benign */ }
    }, timeout_ms);

    proc.stdout?.on("data", (b: Buffer) => { stdout += b.toString("utf8"); });
    proc.stderr?.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });
    proc.on("error", (err) => {
      clearTimeout(handle);
      resolve({ exit_code: null, stdout, stderr, error: err as NodeJS.ErrnoException });
    });
    proc.on("close", (code) => {
      clearTimeout(handle);
      resolve({ exit_code: code, stdout, stderr, timed_out: timedOut });
    });
  });
}

function parseTesseractVersion(versionLine: string): string | null {
  // First line of `tesseract --version` looks like: "tesseract 5.5.2"
  const m = versionLine.match(/^tesseract\s+(\d+\.\d+\.\d+(?:[-+\w.]+)?)/);
  return m ? m[1]! : null;
}

async function probeTesseract(opts: TesseractHarnessOptions): Promise<ProbeResult> {
  const spawner = opts.spawner ?? spawn;
  const binary = opts.binary_path ?? "tesseract";
  const timeBin = opts.time_binary ?? "/usr/bin/time";
  const requiredLangs = opts.required_languages ?? ["eng"];

  // 1. Binary present?
  const versionRes = await captureCommand(spawner, binary, ["--version"]);
  if (versionRes.error?.code === "ENOENT") {
    return {
      status: "missing_dependency",
      dependency: binary,
      remediation: `Install Tesseract (e.g. \`brew install tesseract\`) or pass an explicit binary_path.`,
    };
  }
  if (versionRes.exit_code !== 0 && !versionRes.stdout && !versionRes.stderr) {
    return {
      status: "probe_failed",
      error_message: `\`${binary} --version\` returned exit ${versionRes.exit_code} with no output`,
      remediation: "Ensure the tesseract binary is executable and on PATH.",
    };
  }

  // Tesseract prints version to stderr on older builds, stdout on newer.
  const versionText = (versionRes.stdout + "\n" + versionRes.stderr).trim();
  const versionLine = versionText.split(/\r?\n/, 1)[0] ?? "";
  const resolvedVersion = parseTesseractVersion(versionLine);
  if (!resolvedVersion) {
    return {
      status: "probe_failed",
      error_message: `Could not parse Tesseract version from: ${versionLine}`,
      remediation: "The harness expects \"tesseract X.Y.Z\" as the first version line.",
    };
  }
  if (resolvedVersion !== VERSION_PINNED) {
    return {
      status: "bad_version",
      required_version: VERSION_PINNED,
      resolved_version: resolvedVersion,
      remediation: `This harness pins Tesseract ${VERSION_PINNED}. Update the pin or install the matching version.`,
    };
  }

  // 2. Required languages present?
  // requiredLangs is BCP-47; resolve each tag to a Tesseract engine
  // model name before checking installation. An unmappable tag is a
  // structured missing_model with a clear remediation.
  const langRes = await captureCommand(spawner, binary, ["--list-langs"]);
  // --list-langs writes to stderr in older tesseract; capture both.
  const langText = langRes.stdout + langRes.stderr;
  // The first line of --list-langs is "List of available languages (N):".
  // Filter to plausible traineddata identifiers: lowercase letters /
  // digits / underscore. This drops the header without affecting the
  // legitimate model names. (Audit 019e36a0 D3.3.)
  const langs = new Set(
    langText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^[a-z0-9_]+$/.test(s)),
  );
  for (const tag of requiredLangs) {
    const engineLang = resolveTesseractLang(tag);
    if (engineLang === null) {
      return {
        status: "missing_model",
        model: `<unmapped:${tag}>`,
        expected_path: `(no Tesseract engine-language mapping for tag "${tag}")`,
        remediation: `Add a TAG_TO_TESS_LANG entry for "${tag}" in src/harnesses/tesseract.ts, or change the fixture's language to a supported BCP-47 tag (e.g. en, zh-Hans, zh-Hant, ja, ko).`,
      };
    }
    if (!langs.has(engineLang)) {
      return {
        status: "missing_model",
        model: `${engineLang}.traineddata`,
        expected_path: `<tessdata>/${engineLang}.traineddata`,
        remediation: engineLang.startsWith("chi") || engineLang === "jpn" || engineLang === "kor"
          ? `Install Tesseract language packs: \`brew install tesseract-lang\` (to add ${engineLang} for tag "${tag}").`
          : `Install the ${engineLang} traineddata into Tesseract's tessdata directory (tag "${tag}").`,
      };
    }
  }

  // 3. RSS backend (/usr/bin/time -l) usable?
  const rssProbe = await captureCommand(spawner, timeBin, ["-l", "/usr/bin/true"]);
  if (rssProbe.error?.code === "ENOENT") {
    return {
      status: "probe_failed",
      error_message: `${timeBin} not found`,
      remediation: "Tesseract harness requires /usr/bin/time -l for RSS measurement (macOS BSD).",
    };
  }
  if (parseMaxRssBytesFromTimeL(rssProbe.stderr) === null) {
    return {
      status: "probe_failed",
      error_message: `${timeBin} -l output did not contain a parseable \`maximum resident set size\` line. stderr was: ${rssProbe.stderr.slice(0, 200)}`,
      remediation: "Verify /usr/bin/time -l works on this platform (macOS / BSD).",
    };
  }

  const available: AvailableProbeResult = {
    status: "available",
    resolved_version: resolvedVersion,
  };
  return available;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function runTesseract(
  fixture: ActiveBakeoffFixture,
  opts: RunOptions,
  harnessOpts: TesseractHarnessOptions,
  fixturesRoot: string,
): Promise<EngineObservation> {
  // Tesseract is cold-only — a warm request is a contract failure, not a
  // silent downgrade.
  if (opts.run_kind !== "cold") {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "unsupported_run_kind",
      message: `Tesseract supports only run_kind "cold"; got "${opts.run_kind}".`,
    };
  }

  const spawner = harnessOpts.spawner ?? spawn;
  const binary = harnessOpts.binary_path ?? "tesseract";
  const timeBin = harnessOpts.time_binary ?? "/usr/bin/time";
  const imagePath = join(fixturesRoot, fixture.path);

  // Resolve fixture's BCP-47 tag to a Tesseract engine language. An
  // unmappable tag is a structured failure — never silently pass the
  // raw tag to `-l` (which would either error obscurely or recognize
  // nothing).
  const engineLang = resolveTesseractLang(fixture.language);
  if (engineLang === null) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "unsupported_language_tag",
      message: `No Tesseract engine-language mapping for fixture.language "${fixture.language}". Add an entry to TAG_TO_TESS_LANG or change the fixture's tag.`,
    };
  }

  const start = performance.now();
  const result = await runWithTimeout(
    spawner,
    timeBin,
    ["-l", binary, imagePath, "stdout", "-l", engineLang],
    opts.timeout_ms,
  );
  const latency_ms = Math.round(performance.now() - start);

  if (result.timed_out) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "timeout",
      message: `Tesseract run exceeded ${opts.timeout_ms} ms`,
      detail: truncate(result.stderr, 500),
    };
  }
  if (result.signal !== null) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: `terminated_by_signal_${result.signal}`,
      message: `Tesseract terminated by signal ${result.signal}`,
      detail: truncate(result.stderr, 500),
    };
  }
  if (result.exit_code !== 0) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: `tesseract_exit_${result.exit_code}`,
      message: `Tesseract exited with code ${result.exit_code}`,
      detail: truncate(result.stderr, 500),
    };
  }

  const peak_rss_bytes = parseMaxRssBytesFromTimeL(result.stderr);
  if (peak_rss_bytes === null) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "rss_parse_failed",
      message: "Could not parse `maximum resident set size` from /usr/bin/time -l output",
      detail: truncate(result.stderr, 500),
    };
  }

  return {
    outcome: "success",
    fixture_id: fixture.id,
    engine_name: ENGINE_NAME,
    engine_version: VERSION_PINNED,
    transcript: result.stdout,
    latency_ms,
    peak_rss_bytes,
    // Tesseract CLI has no separable cold model load — startup cost
    // repeats per invocation and lives in per_page_inference_ms.
    cold_model_load_ms: 0,
    per_page_inference_ms: latency_ms,
    run_kind: "cold",
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeTesseractCandidate(
  fixturesRoot: string,
  options: TesseractHarnessOptions = {},
): EngineCandidate {
  return {
    name: ENGINE_NAME,
    version_pinned: VERSION_PINNED,
    license: LICENSE,
    supported_run_kinds: ["cold"],
    probe: () => probeTesseract(options),
    run: (fixture, opts) => runTesseract(fixture, opts, options, fixturesRoot),
    dispose: async () => { /* no-op */ },
  };
}
