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
  LicenseEvidence,
  RedistributionStatus,
  ActiveBakeoffFixture,
  PlaceholderBakeoffFixture,
  BakeoffFixture,
  FixtureManifest,
} from "./types.js";

export { computeCER, normalizeForCer } from "./accuracy.js";
