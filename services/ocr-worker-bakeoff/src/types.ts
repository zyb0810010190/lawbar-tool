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
  run_kind: RunKind;
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
   * the engine has no separately-distributed model artifact (e.g. a pure
   * algorithmic engine with no weights). When non-null, `model_evidence_url`
   * MUST point at the matching upstream LICENSE — even when `model_license`
   * equals `code_license` numerically, the two artifacts ship from
   * different repositories and need separate provenance for ε's legal
   * artifact.
   */
  model_license: string | null;
  redistribution: RedistributionStatus;
  /** URL to upstream code LICENSE file. */
  code_evidence_url: string;
  /**
   * URL to upstream model LICENSE file. `null` only when `model_license`
   * is also null (no separate model artifact). Otherwise required.
   */
  model_evidence_url: string | null;
  /** ISO-8601 timestamp of last manual verification of all evidence URLs. */
  last_verified_at: string;
  /** Free-form notes (e.g. "weights bundle includes CC-BY-SA training set"). */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Engine candidate — the seam each per-engine commit implements.
// ---------------------------------------------------------------------------

export type RunKind = "cold" | "warm";

export interface EngineCandidate {
  name: string;
  /** Pinned engine version this harness targets. */
  version_pinned: string;
  license: LicenseEvidence;
  /**
   * Run kinds this candidate can honestly execute. The runner MUST only
   * request modes listed here; a direct unsupported request yields a
   * structured `unsupported_run_kind` failure observation rather than a
   * silent downgrade. CLI-per-page engines (e.g. Tesseract) typically
   * advertise only `"cold"`; persistent-process engines may advertise
   * both.
   */
  supported_run_kinds: readonly RunKind[];
  /**
   * Media this candidate can take. Absent means ["png"] — the two original harnesses take page
   * images only. The runner records an `unsupported_media` failure for any other fixture instead
   * of calling `run()`, so a PDF never reaches an engine that would misread its bytes as an image.
   */
  supported_media?: readonly FixtureMedia[];
  probe(): Promise<ProbeResult>;
  run(fixture: ActiveBakeoffFixture, opts: RunOptions): Promise<EngineObservation>;
  /** Tear down any subprocesses / loaded models. */
  dispose(): Promise<void>;
}

export interface RunOptions {
  /**
   * Cold (fresh process) vs warm (reused process). The runner MUST check
   * `EngineCandidate.supported_run_kinds` before invoking; passing an
   * unsupported mode is allowed but yields a structured failure
   * observation, never a silent downgrade.
   */
  run_kind: RunKind;
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

/**
 * Fixture role. Smoke fixtures verify harness plumbing (e.g. β's English
 * `hello bakeoff` PNG) and are EXCLUDED from verdict aggregation entirely.
 * Verdict fixtures form the signed-off corpus (Q3: ≥5 active synthetic +
 * ≥2 active real Chinese-pleading samples) that ADR-11A.1's verdict
 * depends on. The runner filters by role; the verdict path only sees
 * `verdict` fixtures.
 */
export type FixtureRole = "smoke" | "verdict";

/**
 * What the fixture file is. `png` is a single page image; `pdf` is a one-page PDF, which may carry
 * a text layer (a born-digital page) or none (a scan). A candidate declares which media it can
 * take; the runner never hands a candidate a fixture it did not declare for.
 */
export type FixtureMedia = "png" | "pdf";

/**
 * Render provenance for synthetic active fixtures. Records enough intent
 * for a future human to reproduce a fixture's authoring step even though
 * the canonical bytes are committed (CI never regenerates). Required for
 * synthetic active fixtures; absent for real fixtures.
 */
export interface SyntheticRenderProvenance {
  /** Exact command line used at authoring time (e.g. `magick ... label:"hello"`). */
  render_command: string;
  /** Font family / file (e.g. "Arial-Bold", "NotoSerifSC-Regular"). */
  font: string;
  /** Point size used at render time. */
  point_size: number;
  /** Canvas dimensions (e.g. "400x80"). */
  canvas: string;
  /** Authored source text — this MUST equal the expected ground truth. */
  source_text: string;
  /** Free-form notes about the rendering environment. */
  notes?: string;
}

interface ActiveBakeoffFixtureBase {
  active: true;
  id: string;
  /** Role within the bakeoff verdict: smoke fixtures are excluded from scoring. */
  role: FixtureRole;
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
  /** Defaults to "png" in the manifest; every fixture before the PDF kind was a PNG. */
  media: FixtureMedia;
  /** Free-form provenance summary. */
  provenance: string;
  /** ISO-8601 timestamp of last manual verification of the bytes + expected text. */
  last_verified_at: string;
  notes?: string;
}

export interface SyntheticActiveBakeoffFixture extends ActiveBakeoffFixtureBase {
  kind: "synthetic";
  /** Required for synthetic fixtures so manual replacement remains auditable. */
  render: SyntheticRenderProvenance;
}

export interface RealActiveBakeoffFixture extends ActiveBakeoffFixtureBase {
  kind: "real";
  /** Real-source provenance: where the image came from (URL / acquisition / consent). */
  real_source: string;
  /** PII / redaction status — required for real fixtures before ε. */
  pii_review: "redacted" | "pending" | "not_required";
}

export type ActiveBakeoffFixture = SyntheticActiveBakeoffFixture | RealActiveBakeoffFixture;

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
