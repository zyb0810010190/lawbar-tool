// Public surface of the engine bakeoff package. Outside the production
// dependency graph — see README for the per-engine landing protocol.

export type {
  ProbeStatus,
  ProbeResult,
  AvailableProbeResult,
  MissingDependencyProbeResult,
  MissingModelProbeResult,
  BadVersionProbeResult,
  UnsupportedPlatformProbeResult,
  ProbeFailedResult,
  EngineObservation,
  EngineSuccessObservation,
  EngineFailureObservation,
  EngineCandidate,
  RunOptions,
  RunKind,
  LicenseEvidence,
  RedistributionStatus,
  ActiveBakeoffFixture,
  SyntheticActiveBakeoffFixture,
  RealActiveBakeoffFixture,
  SyntheticRenderProvenance,
  PlaceholderBakeoffFixture,
  BakeoffFixture,
  FixtureRole,
  FixtureManifest,
} from "./types.js";

export { computeCER, normalizeForCer } from "./accuracy.js";
export { loadManifest, ManifestValidationError } from "./manifest.js";
export type { LoadedManifest } from "./manifest.js";
