// Type contracts for the engine bakeoff harness. See ADR-11A.1 (verdict
// commit lands as ε) and dev-memo/real-ocr-worker-brainstorm.md
// §"Lease-renewal metric" for the empirical inputs each engine harness
// MUST produce.
//
// All shapes are engine-INDEPENDENT. Per-engine commits (β/γ/δ) consume
// these types verbatim; if a future engine needs a field this file does
// not name, that field gets added here first and propagated.

// ---------------------------------------------------------------------------
// Probe results — discriminated union by status.
//
// Each non-`available` status carries enough context for the bakeoff
// runner to print actionable remediation. The discriminated union
// prevents a harness from accidentally returning a half-populated
// failure result.
// ---------------------------------------------------------------------------

export type ProbeStatus =
  | "available"
  | "missing_dependency"
  | "missing_model"
  | "bad_version"
  | "unsupported_platform"
  | "probe_failed";

export interface AvailableProbeResult {
  status: "available";
  /** Human-readable version string for the resolved engine (e.g. "5.3.4"). */
  resolved_version: string;
  /** Optional free-form detail captured during probe. */
  detail?: string;
}

export interface MissingDependencyProbeResult {
  status: "missing_dependency";
  /** Name of the missing dep (e.g. "tesseract" / "python3" / "paddleocr"). */
  dependency: string;
  /** Actionable install hint (e.g. "brew install tesseract"). */
  remediation: string;
  detail?: string;
}

export interface MissingModelProbeResult {
  status: "missing_model";
  /** Logical name of the missing model artifact. */
  model: string;
  /** Where the harness expected to find the model. */
  expected_path: string;
  remediation: string;
  detail?: string;
}

export interface BadVersionProbeResult {
  status: "bad_version";
  /** The version string the harness pin requires. */
  required_version: string;
  /** The version actually resolved on the host. */
  resolved_version: string;
  remediation: string;
  detail?: string;
}

export interface UnsupportedPlatformProbeResult {
  status: "unsupported_platform";
  /** Reported platform (e.g. "darwin-arm64", "linux-x64"). */
  platform: string;
  remediation: string;
  detail?: string;
}

export interface ProbeFailedResult {
  status: "probe_failed";
  /** The thrown error or stderr captured while probing. */
  error_message: string;
  remediation: string;
  detail?: string;
}

export type ProbeResult =
  | AvailableProbeResult
  | MissingDependencyProbeResult
  | MissingModelProbeResult
  | BadVersionProbeResult
  | UnsupportedPlatformProbeResult
  | ProbeFailedResult;

// ---------------------------------------------------------------------------
// Engine observations — discriminated union by outcome.
//
// SUCCESS variant requires the lease-relevant timing terms so the verdict
// commit (ε) can assemble the lease-renewal metric without optional-field
// guessing. A run that completed without the timing split is NOT a
// success — it's an incomplete observation, surfaced via the failure
// variant.
// ---------------------------------------------------------------------------

export interface EngineSuccessObservation {
  outcome: "success";
  fixture_id: string;
  engine_name: string;
  engine_version: string;
  /**
   * Raw engine output projected to a single string for CER comparison.
   * Projection is engine-specific and lives in the harness file. This is
   * a measurement-only projection — NOT the production OcrResult mapper
   * (see ADR-11A.5 v0.1 §"What v0.1 does NOT decide").
   */
  transcript: string;
  /** Wall-clock latency of THIS run (cold or warm, distinguished below). */
  latency_ms: number;
  /** Peak resident set size of the engine subprocess, in bytes. */
  peak_rss_bytes: number;
  /**
   * Cold model-load duration in milliseconds. Required: every successful
   * observation MUST distinguish cold load from per-page inference so
   * the lease-renewal metric is computable. For a single-page fixture on
   * a fresh process, this is the load time before the first inference.
   * On warm reruns of the same process, this is 0.
   */
  cold_model_load_ms: number;
  /**
   * Per-page inference duration in milliseconds. Excludes cold load.
   * For a single-page fixture: `latency_ms === cold_model_load_ms + per_page_inference_ms`
   * on a cold run; `latency_ms === per_page_inference_ms` on a warm run.
   */
  per_page_inference_ms: number;
  /** Whether this run was a cold (fresh process) or warm (reused) run. */
  run_kind: "cold" | "warm";
}

export interface EngineFailureObservation {
  outcome: "failure";
  fixture_id: string;
  engine_name: string;
  engine_version?: string;
  /** Stable code for downstream report grouping (e.g. "probe_failed", "timeout", "decode_error"). */
  code: string;
  message: string;
  /** Captured stderr / partial stdout, if any. Redacted of secrets per ADR-11A.0 §6. */
  detail?: string;
}

export type EngineObservation = EngineSuccessObservation | EngineFailureObservation;

// ---------------------------------------------------------------------------
// License evidence — captured per engine in β/γ/δ; assembled into the
// legal artifact in ε. Code license, model-weight license, and
// redistribution status are each first-class.
// ---------------------------------------------------------------------------

export type RedistributionStatus = "permitted" | "denied" | "tbd";

export interface LicenseEvidence {
  /** SPDX-ish identifier for the engine source (e.g. "Apache-2.0", "MIT"). */
  code_license: string;
  /**
   * SPDX-ish identifier for the model weights, if separate. `null` means
   * the engine has no separately-licensed weights (e.g. Tesseract's
   * built-in language data ships under the same code license).
   */
  model_license: string | null;
  redistribution: RedistributionStatus;
  /** URL to upstream LICENSE file or equivalent legal source. */
  evidence_url: string;
  /** ISO-8601 timestamp of last manual verification. */
  last_verified_at: string;
  /** Free-form notes (e.g. "weights bundle includes CC-BY-SA training set"). */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Engine candidate — the seam each per-engine commit implements.
// ---------------------------------------------------------------------------

export interface EngineCandidate {
  name: string;
  /** Pinned engine version this harness targets. */
  version_pinned: string;
  license: LicenseEvidence;
  probe(): Promise<ProbeResult>;
  run(fixture: ActiveBakeoffFixture, opts: RunOptions): Promise<EngineObservation>;
  /** Tear down any subprocesses / loaded models. */
  dispose(): Promise<void>;
}

export interface RunOptions {
  /** Cold (fresh process) vs warm (reuse). β/γ/δ define semantics. */
  run_kind: "cold" | "warm";
  /** Wall-clock timeout in milliseconds for the run() call. */
  timeout_ms: number;
}

// ---------------------------------------------------------------------------
// Fixtures — discriminated union by active vs placeholder.
//
// Active fixtures ship real bytes + expected text + hash. Placeholder
// fixtures reserve a slot in the manifest before content lands (e.g.
// the two real-sample placeholders pending PII review).
// ---------------------------------------------------------------------------

export interface ActiveBakeoffFixture {
  active: true;
  id: string;
  kind: "synthetic" | "real";
  /** Coverage category (e.g. "printed-chinese", "table", "seal", "vertical"). */
  category: string;
  /** Path to the image bytes, relative to the fixtures/ root. */
  path: string;
  /** Path to the expected ground-truth text, relative to fixtures/ root. */
  expected_text_path: string;
  /** SHA-256 of the image bytes (lowercase hex). */
  sha256: string;
  /** SHA-256 of the expected-text bytes (lowercase hex). */
  expected_text_sha256: string;
  /** Detected DPI of the image, if known. */
  dpi?: number;
  /** Primary language tag of the expected text (e.g. "zh-Hans"). */
  language: string;
  /** Free-form provenance trail (e.g. "synthetic v1, font NotoSerifSC-Regular"). */
  provenance: string;
  /** ISO-8601 timestamp of last manual verification of the bytes + expected text. */
  last_verified_at: string;
  notes?: string;
}

export interface PlaceholderBakeoffFixture {
  active: false;
  id: string;
  kind: "synthetic" | "real";
  category: string;
  /**
   * Intended path for the image when the fixture is promoted to active.
   * The image file MAY be absent. If present, it is NOT subject to the
   * hash gate (the gate only applies to active fixtures).
   */
  path: string;
  /** Intended path for the expected text. */
  expected_text_path: string;
  language: string;
  /** Free-form reason this slot is still placeholder (e.g. "pending PII review"). */
  reason: string;
  notes?: string;
}

export type BakeoffFixture = ActiveBakeoffFixture | PlaceholderBakeoffFixture;

export interface FixtureManifest {
  /** Manifest schema version; bumped when this file's shape changes. */
  version: 1;
  fixtures: BakeoffFixture[];
}
