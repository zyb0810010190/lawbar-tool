// Bakeoff runner. Provisional shape — final BakeoffReport schema lands
// in ε once γ/δ are wired and the field set across all three engines is
// stable. Consumers should treat this report as internal-only.
//
// Verdict aggregation rule (ADR-11A.1 Q3 sign-off): smoke fixtures are
// EXCLUDED from verdict aggregation entirely, not merely from readiness
// counts. The `roleFilter` argument controls which fixtures run; the
// emitted report records the filter so downstream code never mistakes a
// smoke-only run for a verdict-eligible one.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { computeCER } from "./accuracy.js";
import type {
  ActiveBakeoffFixture,
  BakeoffFixture,
  EngineCandidate,
  EngineObservation,
  FixtureRole,
  ProbeResult,
} from "./types.js";

export interface RunBakeoffOptions {
  candidates: readonly EngineCandidate[];
  fixtures: readonly BakeoffFixture[];
  /** Which role(s) to score. Default: `"smoke"`. ε passes `"verdict"`. */
  roleFilter?: FixtureRole;
  fixturesRoot: string;
  /** Per-run timeout. Default: 30_000. */
  timeout_ms?: number;
}

export interface BakeoffRunReport {
  /** Provisional schema; promoted to a stable contract in ε. */
  schema: "bakeoff-run-report/provisional";
  generated_at: string;
  host: { platform: string; arch: string };
  role_filter: FixtureRole;
  /** True only if `role_filter === "verdict"` AND at least one verdict fixture ran successfully. */
  verdict_ready: boolean;
  fixtures_scored: number;
  probes: Array<{ candidate: string; result: ProbeResult }>;
  observations: EngineObservation[];
  /** CER per (candidate, fixture). Excludes failure observations. */
  cer_scores: Array<{ candidate: string; fixture_id: string; cer: number }>;
}

function isActive(f: BakeoffFixture): f is ActiveBakeoffFixture {
  return f.active === true;
}

type HashResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Hash a file's bytes, converting filesystem errors into a typed result.
 *  Audit 019e3854 R2: missing/non-file/permission errors must become
 *  structured `fixture_unreadable` failure observations, never thrown.
 */
function tryHashFile(path: string): HashResult {
  try {
    return { ok: true, value: createHash("sha256").update(readFileSync(path)).digest("hex") };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Best-effort dispose; never throws into the caller. */
async function disposeSafely(candidate: EngineCandidate): Promise<void> {
  try {
    await candidate.dispose();
  } catch {
    // dispose() is "tear down" — failure is logged via swallow; the
    // runner has already produced its observations for this candidate.
  }
}

function selectFixtures(fixtures: readonly BakeoffFixture[], role: FixtureRole): ActiveBakeoffFixture[] {
  return fixtures.filter(isActive).filter((f) => f.role === role);
}

export async function runBakeoff(opts: RunBakeoffOptions): Promise<BakeoffRunReport> {
  const role: FixtureRole = opts.roleFilter ?? "smoke";
  const timeout_ms = opts.timeout_ms ?? 30_000;
  const scoredFixtures = selectFixtures(opts.fixtures, role);

  const probes: BakeoffRunReport["probes"] = [];
  const observations: EngineObservation[] = [];
  const cer_scores: BakeoffRunReport["cer_scores"] = [];

  for (const candidate of opts.candidates) {
    // Refuse to ask a candidate for an unsupported run mode in the first
    // place (Codex pass-4 D1.1). Tesseract's supported_run_kinds is
    // ["cold"] — every fixture in this runner is scored cold.
    const requestedKind: "cold" | "warm" = "cold";
    if (!candidate.supported_run_kinds.includes(requestedKind)) {
      // Unreachable today (requestedKind is always "cold" and every
      // candidate must support cold); guarded for future runner modes.
      probes.push({
        candidate: candidate.name,
        result: {
          status: "unsupported_platform",
          platform: `requested_run_kind=${requestedKind}`,
          remediation: `Candidate ${candidate.name} does not support run_kind ${requestedKind}`,
        },
      });
      continue;
    }

    const probe = await candidate.probe();
    probes.push({ candidate: candidate.name, result: probe });

    if (probe.status !== "available") {
      // Every non-available ProbeResult variant carries `remediation`
      // (see types.ts). TypeScript narrows away AvailableProbeResult
      // here, so this access is safe.
      const remediation = probe.remediation;
      // Emit a failure observation per fixture so the report shape is
      // uniform whether or not the engine actually ran.
      for (const fx of scoredFixtures) {
        observations.push({
          outcome: "failure",
          fixture_id: fx.id,
          engine_name: candidate.name,
          code: `probe_${probe.status}`,
          message: remediation,
        });
      }
      await disposeSafely(candidate);
      continue;
    }

    // Audit 019e3854 R2: wrap every per-fixture lifecycle in try/finally
    // so an unreadable hash file or a thrown engine adapter still calls
    // dispose() for future engines that hold persistent state.
    try {
      for (const fx of scoredFixtures) {
        // Audit 019e36a0 D3.6 / contract gap: enforce the active-fixture
        // hash gate at RUNTIME, not only in the manifest test. Drifted
        // bytes against the manifest's recorded SHA-256 → fail this
        // observation as `fixture_hash_drift`, never run the engine.
        // I/O failures (missing / unreadable / non-file) → fail this
        // observation as `fixture_unreadable` (audit 019e3854 R2). Either
        // way the run() call is skipped and the loop continues; we never
        // tear down the runner over a single bad fixture.
        const imgPath = join(opts.fixturesRoot, fx.path);
        const txtPath = join(opts.fixturesRoot, fx.expected_text_path);

        const imgHash = tryHashFile(imgPath);
        if (!imgHash.ok) {
          observations.push({
            outcome: "failure",
            fixture_id: fx.id,
            engine_name: candidate.name,
            code: "fixture_unreadable",
            message: `image at ${fx.path} could not be read: ${imgHash.error}`,
          });
          continue;
        }
        if (imgHash.value !== fx.sha256) {
          observations.push({
            outcome: "failure",
            fixture_id: fx.id,
            engine_name: candidate.name,
            code: "fixture_hash_drift",
            message: `image sha256 ${imgHash.value} does not match manifest ${fx.sha256}`,
          });
          continue;
        }
        const txtHash = tryHashFile(txtPath);
        if (!txtHash.ok) {
          observations.push({
            outcome: "failure",
            fixture_id: fx.id,
            engine_name: candidate.name,
            code: "fixture_unreadable",
            message: `expected text at ${fx.expected_text_path} could not be read: ${txtHash.error}`,
          });
          continue;
        }
        if (txtHash.value !== fx.expected_text_sha256) {
          observations.push({
            outcome: "failure",
            fixture_id: fx.id,
            engine_name: candidate.name,
            code: "fixture_hash_drift",
            message: `expected text sha256 ${txtHash.value} does not match manifest ${fx.expected_text_sha256}`,
          });
          continue;
        }

        const obs = await candidate.run(fx, { run_kind: requestedKind, timeout_ms });
        observations.push(obs);
        if (obs.outcome === "success") {
          const expected = readFileSync(txtPath, "utf8");
          cer_scores.push({
            candidate: candidate.name,
            fixture_id: fx.id,
            cer: computeCER(expected, obs.transcript),
          });
        }
      }
    } finally {
      await disposeSafely(candidate);
    }
  }

  const verdict_ready =
    role === "verdict" &&
    cer_scores.some((s) => isFinite(s.cer));

  return {
    schema: "bakeoff-run-report/provisional",
    generated_at: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch },
    role_filter: role,
    verdict_ready,
    fixtures_scored: scoredFixtures.length,
    probes,
    observations,
    cer_scores,
  };
}
