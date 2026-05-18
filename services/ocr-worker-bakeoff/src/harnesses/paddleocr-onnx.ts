// PaddleOCR-via-ONNX engine adapter for the bakeoff (δ).
//
// Engine: @gutenye/ocr-node — PaddleOCR ONNX models loaded via
// onnxruntime-node. Covers both the γ (PaddleOCR) and δ (RapidOCR) regions
// of the ADR-11A.1 bakeoff because RapidOCR is itself a PaddleOCR-ONNX
// repackaging; the underlying engine identity is PaddleOCR running under
// ONNX Runtime.
//
// ================  PADDLEOCR-ONNX LEASE-METRIC RATIONALE  ====================
//
// Unlike Tesseract CLI, PaddleOCR-ONNX has a meaningful cold/warm split:
//
//   - Cold load: `Ocr.create()` reads the detection + recognition + cls
//     ONNX models from disk and initializes the runtime sessions. Real
//     one-time-per-process cost (~150-2000ms depending on host).
//   - Per-page inference: `ocr.detect(image)` runs the actual OCR. Much
//     cheaper than cold load (~50-500ms).
//
// The subprocess runner measures both separately and embeds them in its
// JSON output. The harness reads those numbers directly into the
// EngineSuccessObservation, so ε's lease-renewal metric gets honest cold
// vs per-page terms for this candidate.
//
// `supported_run_kinds: ["cold"]` — same as Tesseract for β/δ symmetry.
// Each run() invocation spawns a fresh process and pays the cold load.
// A future warm-mode (reused subprocess across pages) is possible but
// not part of this bakeoff round.
// =============================================================================

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type {
  ActiveBakeoffFixture,
  EngineCandidate,
  EngineObservation,
  LicenseEvidence,
  ProbeResult,
  RunOptions,
} from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENGINE_NAME = "paddleocr-onnx";
const VERSION_PINNED = "1.4.8"; // matches @gutenye/ocr-node in package.json

const LICENSE: LicenseEvidence = {
  code_license: "MIT",
  model_license: "MIT",
  redistribution: "permitted",
  code_evidence_url: "https://github.com/gutenye/ocr/blob/main/LICENSE",
  model_evidence_url: "https://github.com/gutenye/ocr/blob/main/packages/ocr-models/LICENSE",
  last_verified_at: "2026-05-18",
  notes: "Engine = @gutenye/ocr-node 1.4.8 (MIT). Models = @gutenye/ocr-models (MIT, derivative of PaddleOCR ONNX which is upstream Apache-2.0). onnxruntime-node = MIT (Microsoft). Re-verify model derivation chain before ε locks the verdict.",
};

// Resolve the subprocess runner once at module load. Lives next to this
// file in dist/ at runtime.
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNNER_PATH = join(here, "paddleocr-onnx-runner.mjs");

// ---------------------------------------------------------------------------
// Options + injection seams (for tests)
// ---------------------------------------------------------------------------

export interface PaddleOcrOnnxHarnessOptions {
  time_binary?: string;
  node_binary?: string;
  runner_path?: string;
  spawner?: typeof spawn;
  required_languages?: readonly string[];
}

// ---------------------------------------------------------------------------
// Language mapping (BCP-47 → supported tag set)
// ---------------------------------------------------------------------------

const SUPPORTED_TAGS_NORMALIZED: ReadonlySet<string> = new Set([
  "eng", "en", "en-US", "en-GB",
  "zh", "zh-Hans", "zh-Hans-CN", "zh-CN",
]);

export function canonicalizePaddleTag(tag: string): string {
  const parts = tag.split("-");
  return parts
    .map((part, idx) => {
      if (idx === 0) return part.toLowerCase();
      if (part.length === 4 && /^[A-Za-z]{4}$/.test(part)) {
        return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
      }
      if ((part.length === 2 && /^[A-Za-z]{2}$/.test(part)) || /^\d{3}$/.test(part)) {
        return part.toUpperCase();
      }
      return part.toLowerCase();
    })
    .join("-");
}

export function resolvePaddleLang(tag: string): "default" | null {
  return SUPPORTED_TAGS_NORMALIZED.has(canonicalizePaddleTag(tag)) ? "default" : null;
}

// ---------------------------------------------------------------------------
// Subprocess helpers — same shape as Tesseract harness
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
  const proc = spawner(binary, args.slice(), { detached: true });
  if (proc.pid === undefined) {
    return { exit_code: null, signal: null, stdout: "", stderr: "spawn returned no pid", timed_out: false };
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
    try { process.kill(-pgid, "SIGTERM"); } catch { /* benign */ }
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

  return { exit_code: exit.code, signal: exit.signal, stdout, stderr, timed_out: timedOut };
}

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
      proc = spawner(binary, args.slice(), { detached: true });
    } catch (err) {
      resolve({ exit_code: null, stdout: "", stderr: "", error: err as NodeJS.ErrnoException });
      return;
    }
    const pgid = proc.pid;
    let timedOut = false;
    const handle = setTimeout(() => {
      timedOut = true;
      if (pgid !== undefined) {
        try { process.kill(-pgid, "SIGKILL"); } catch { /* benign */ }
      } else {
        try { proc.kill("SIGKILL"); } catch { /* benign */ }
      }
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

export function parseMaxRssBytesFromTimeL(stderr: string): number | null {
  const match = stderr.match(/^\s*(\d+)\s+maximum resident set size/m);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

async function probePaddleOcrOnnx(opts: PaddleOcrOnnxHarnessOptions): Promise<ProbeResult> {
  const spawner = opts.spawner ?? spawn;
  const timeBin = opts.time_binary ?? "/usr/bin/time";
  const runnerPath = opts.runner_path ?? DEFAULT_RUNNER_PATH;
  const requiredLangs = opts.required_languages ?? ["eng"];

  // 1. Required language tags resolve to the supported set.
  for (const tag of requiredLangs) {
    if (resolvePaddleLang(tag) === null) {
      return {
        status: "missing_model",
        model: `<unmapped:${tag}>`,
        expected_path: `(no PaddleOCR-ONNX model for tag "${tag}"; this harness ships CJK+Latin only)`,
        remediation: `Add a SUPPORTED_TAGS_NORMALIZED entry for "${tag}" in src/harnesses/paddleocr-onnx.ts, OR change the fixture's language to a supported BCP-47 tag (en, zh-Hans, zh-CN).`,
      };
    }
  }

  // 2. @gutenye/ocr-node importable in this Node process? If THIS process
  //    can import it, the subprocess (same node_modules tree) will too.
  try {
    await import("@gutenye/ocr-node");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      return {
        status: "missing_dependency",
        dependency: "@gutenye/ocr-node",
        remediation: "Run `npm install @gutenye/ocr-node` in services/ocr-worker-bakeoff/.",
      };
    }
    return {
      status: "probe_failed",
      error_message: `@gutenye/ocr-node import threw: ${(err as Error).message}`,
      remediation: "Inspect the import error (likely a native onnxruntime-node platform mismatch).",
    };
  }

  // 3. RSS backend (/usr/bin/time -l) usable?
  const rssProbe = await captureCommand(spawner, timeBin, ["-l", "/usr/bin/true"]);
  if (rssProbe.error?.code === "ENOENT") {
    return {
      status: "probe_failed",
      error_message: `${timeBin} not found`,
      remediation: "PaddleOCR-ONNX harness requires /usr/bin/time -l for RSS measurement (macOS BSD).",
    };
  }
  if (rssProbe.timed_out) {
    return {
      status: "probe_failed",
      error_message: `${timeBin} -l timed out`,
      remediation: "RSS backend probe hung — verify /usr/bin/time -l is functional on this host.",
    };
  }
  if (parseMaxRssBytesFromTimeL(rssProbe.stderr) === null) {
    return {
      status: "probe_failed",
      error_message: `${timeBin} -l output did not contain a parseable 'maximum resident set size' line.`,
      remediation: "Verify /usr/bin/time -l works on this platform (macOS / BSD).",
    };
  }

  // 4. Sanity-check the runner script is reachable on disk.
  const { existsSync } = await import("node:fs");
  if (!existsSync(runnerPath)) {
    return {
      status: "missing_dependency",
      dependency: runnerPath,
      remediation: "The harness runner script was not built into dist/. Run `npm --prefix services/ocr-worker-bakeoff run build`.",
    };
  }

  return { status: "available", resolved_version: VERSION_PINNED };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function runPaddleOcrOnnx(
  fixture: ActiveBakeoffFixture,
  opts: RunOptions,
  harnessOpts: PaddleOcrOnnxHarnessOptions,
  fixturesRoot: string,
): Promise<EngineObservation> {
  if (opts.run_kind !== "cold") {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "unsupported_run_kind",
      message: `PaddleOCR-ONNX harness supports only run_kind "cold" today; got "${opts.run_kind}".`,
    };
  }

  if (resolvePaddleLang(fixture.language) === null) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "unsupported_language_tag",
      message: `No PaddleOCR-ONNX model coverage for fixture.language "${fixture.language}".`,
    };
  }

  const spawner = harnessOpts.spawner ?? spawn;
  const nodeBin = harnessOpts.node_binary ?? process.execPath;
  const timeBin = harnessOpts.time_binary ?? "/usr/bin/time";
  const runnerPath = harnessOpts.runner_path ?? DEFAULT_RUNNER_PATH;
  const imagePath = join(fixturesRoot, fixture.path);

  const start = performance.now();
  const result = await runWithTimeout(
    spawner,
    timeBin,
    ["-l", nodeBin, runnerPath, imagePath],
    opts.timeout_ms,
  );
  const latency_ms = Math.round(performance.now() - start);

  if (result.timed_out) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "timeout",
      message: `PaddleOCR-ONNX run exceeded ${opts.timeout_ms} ms`,
      detail: truncate(result.stderr, 500),
    };
  }
  if (result.signal !== null) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: `terminated_by_signal_${result.signal}`,
      message: `PaddleOCR-ONNX terminated by signal ${result.signal}`,
      detail: truncate(result.stderr, 500),
    };
  }
  if (result.exit_code !== 0) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: `runner_exit_${result.exit_code}`,
      message: `PaddleOCR-ONNX runner exited with code ${result.exit_code}`,
      detail: truncate(result.stderr, 500),
    };
  }

  // Parse the JSON payload from stdout. The runner emits exactly one
  // JSON line as the LAST non-empty line. Anything else is a runner
  // regression.
  const jsonLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  let payload: {
    ok: boolean;
    transcript?: string;
    cold_model_load_ms?: number;
    per_page_inference_ms?: number;
    error?: string;
  };
  try {
    payload = JSON.parse(jsonLine);
  } catch {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "runner_output_unparseable",
      message: `Could not parse runner JSON output. stdout: ${truncate(result.stdout, 200)}`,
      detail: truncate(result.stderr, 500),
    };
  }
  if (!payload.ok) {
    return {
      outcome: "failure",
      fixture_id: fixture.id,
      engine_name: ENGINE_NAME,
      code: "runner_reported_failure",
      message: payload.error ?? "runner reported ok=false",
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

  const cold_model_load_ms = payload.cold_model_load_ms ?? 0;
  const per_page_inference_ms = payload.per_page_inference_ms ?? Math.max(0, latency_ms - cold_model_load_ms);

  return {
    outcome: "success",
    fixture_id: fixture.id,
    engine_name: ENGINE_NAME,
    engine_version: VERSION_PINNED,
    transcript: payload.transcript ?? "",
    latency_ms,
    peak_rss_bytes,
    cold_model_load_ms,
    per_page_inference_ms,
    run_kind: "cold",
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makePaddleOcrOnnxCandidate(
  fixturesRoot: string,
  options: PaddleOcrOnnxHarnessOptions = {},
): EngineCandidate {
  return {
    name: ENGINE_NAME,
    version_pinned: VERSION_PINNED,
    license: LICENSE,
    supported_run_kinds: ["cold"],
    probe: () => probePaddleOcrOnnx(options),
    run: (fixture, opts) => runPaddleOcrOnnx(fixture, opts, options, fixturesRoot),
    dispose: async () => { /* no-op; each run spawns a fresh subprocess */ },
  };
}
