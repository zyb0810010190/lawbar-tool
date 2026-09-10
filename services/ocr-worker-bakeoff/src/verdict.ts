// The verdict: aggregates, pre-registered thresholds, and a result that can be committed (R3, WI-12 item 6).
//
// A run report (src/runner.ts) holds every observation, transcript included. This module turns it
// into what the plan allows to be committed — aggregates and identity — and evaluates it against
// fixtures/verdict-spec.json, whose lines were registered BEFORE the holdout existed. Three rules:
//
// 1. Nothing from a page crosses. The result carries counts, means, percentiles, failure-code
//    tallies, and the identities of the harness, the helper, and the spec. Never a transcript,
//    never a fixture id when the root is external (the owner's real pages), never a path.
// 2. The spec is the judge, not the code. Every requirement is evaluated exactly as written —
//    subgroup, metric, operator, value — and the result records the measured value beside each,
//    so a reader can check the decision without trusting it.
// 3. A tie is a tie. Five or six pages per subgroup cannot separate candidates whose folded CER
//    differs by less than one character per page; the ranking says so instead of pretending.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { computeCER } from "./accuracy.js";
import type { BakeoffRunReport } from "./runner.js";
import type { ActiveBakeoffFixture, BakeoffFixture, EngineObservation, FixtureMedia, FixtureRole } from "./types.js";

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

export type Subgroup = "png" | "pdf-layer" | "pdf-scan";
export type MetricName = "success_rate" | "signal_rate" | "mean_cer" | "mean_cer_folded" | "exact_rate" | "p95_latency_ms" | "max_rss_mb";

export interface Requirement {
  readonly subgroup: Subgroup;
  readonly metric: MetricName;
  /** For signal_rate: the failure code that counts as the right answer. */
  readonly code?: string;
  readonly op: ">=" | "<=";
  readonly value: number;
}

export interface RankKey {
  readonly subgroup: Subgroup;
  readonly metric: MetricName;
  readonly direction: "asc" | "desc";
}

export interface SlotSpec {
  readonly slot: string;
  readonly meaning?: string;
  readonly candidates: readonly string[];
  readonly requirements: readonly Requirement[];
  readonly rank_by: readonly RankKey[];
}

export interface VerdictSpec {
  readonly schema: "bakeoff-verdict-spec/1";
  readonly registered_at: string;
  readonly evaluate_on_role: FixtureRole;
  readonly slots: readonly SlotSpec[];
  readonly control?: { readonly from_slot: string };
}

export class VerdictSpecError extends Error {}

const SUBGROUPS: ReadonlySet<string> = new Set(["png", "pdf-layer", "pdf-scan"]);
const METRICS: ReadonlySet<string> = new Set(["success_rate", "signal_rate", "mean_cer", "mean_cer_folded", "exact_rate", "p95_latency_ms", "max_rss_mb"]);

/** Parse and validate a spec. A spec that names an unknown metric or subgroup is refused whole. */
export function parseVerdictSpec(json: string): VerdictSpec {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new VerdictSpecError("spec is not JSON"); }
  if (typeof raw !== "object" || raw === null) throw new VerdictSpecError("spec must be an object");
  const s = raw as Record<string, unknown>;
  if (s.schema !== "bakeoff-verdict-spec/1") throw new VerdictSpecError(`unknown spec schema ${JSON.stringify(s.schema)}`);
  if (typeof s.registered_at !== "string" || s.registered_at === "") throw new VerdictSpecError("spec.registered_at is required");
  if (!["smoke", "verdict", "holdout"].includes(String(s.evaluate_on_role))) throw new VerdictSpecError("spec.evaluate_on_role must be smoke|verdict|holdout");
  if (!Array.isArray(s.slots) || s.slots.length === 0) throw new VerdictSpecError("spec.slots must be a non-empty array");
  const slots: SlotSpec[] = s.slots.map((raw, i) => {
    const sl = raw as Record<string, unknown>;
    if (typeof sl.slot !== "string" || sl.slot === "") throw new VerdictSpecError(`slots[${i}].slot is required`);
    if (!Array.isArray(sl.candidates) || sl.candidates.length === 0 || !sl.candidates.every((c) => typeof c === "string")) throw new VerdictSpecError(`slots[${i}].candidates must name at least one candidate`);
    if (!Array.isArray(sl.requirements) || sl.requirements.length === 0) throw new VerdictSpecError(`slots[${i}].requirements must be a non-empty array — a slot with no requirement is not a decision`);
    const requirements = sl.requirements.map((rq, j) => {
      const r = rq as Record<string, unknown>;
      if (!SUBGROUPS.has(String(r.subgroup))) throw new VerdictSpecError(`slots[${i}].requirements[${j}].subgroup ${JSON.stringify(r.subgroup)} is not png|pdf-layer|pdf-scan`);
      if (!METRICS.has(String(r.metric))) throw new VerdictSpecError(`slots[${i}].requirements[${j}].metric ${JSON.stringify(r.metric)} is not a known metric`);
      if (r.op !== ">=" && r.op !== "<=") throw new VerdictSpecError(`slots[${i}].requirements[${j}].op must be >= or <=`);
      if (typeof r.value !== "number" || !Number.isFinite(r.value)) throw new VerdictSpecError(`slots[${i}].requirements[${j}].value must be a finite number`);
      if (r.metric === "signal_rate" && (typeof r.code !== "string" || r.code === "")) throw new VerdictSpecError(`slots[${i}].requirements[${j}] signal_rate needs a code`);
      const req: Requirement = { subgroup: r.subgroup as Subgroup, metric: r.metric as MetricName, ...(typeof r.code === "string" ? { code: r.code } : {}), op: r.op as ">=" | "<=", value: r.value };
      return req;
    });
    const rank_by = Array.isArray(sl.rank_by) ? sl.rank_by.map((rk, j) => {
      const k = rk as Record<string, unknown>;
      if (!SUBGROUPS.has(String(k.subgroup)) || !METRICS.has(String(k.metric)) || (k.direction !== "asc" && k.direction !== "desc")) throw new VerdictSpecError(`slots[${i}].rank_by[${j}] is malformed`);
      const key: RankKey = { subgroup: k.subgroup as Subgroup, metric: k.metric as MetricName, direction: k.direction as "asc" | "desc" };
      return key;
    }) : [];
    const slot: SlotSpec = { slot: sl.slot, ...(typeof sl.meaning === "string" ? { meaning: sl.meaning } : {}), candidates: sl.candidates as string[], requirements, rank_by };
    return slot;
  });
  const control = typeof s.control === "object" && s.control !== null && typeof (s.control as { from_slot?: unknown }).from_slot === "string"
    ? { from_slot: (s.control as { from_slot: string }).from_slot }
    : undefined;
  if (control !== undefined && !slots.some((sl) => sl.slot === control.from_slot)) throw new VerdictSpecError(`control.from_slot ${JSON.stringify(control.from_slot)} names no slot`);
  return { schema: "bakeoff-verdict-spec/1", registered_at: s.registered_at, evaluate_on_role: s.evaluate_on_role as FixtureRole, slots, ...(control ? { control } : {}) };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface SubgroupAggregate {
  readonly fixtures: number;
  readonly successes: number;
  readonly failures: Readonly<Record<string, number>>;
  readonly success_rate: number;
  readonly mean_cer: number | null;
  readonly mean_cer_folded: number | null;
  readonly exact_rate: number;
  readonly p50_latency_ms: number | null;
  readonly p95_latency_ms: number | null;
  readonly max_rss_mb: number | null;
}

export type Aggregates = Readonly<Record<string, Readonly<Partial<Record<Subgroup, SubgroupAggregate>>>>>;

/** NFKC on both sides folds full-width ASCII-range punctuation and digits; raw CER is kept beside it. */
export function computeCERFolded(reference: string, candidate: string): number {
  return computeCER(reference.normalize("NFKC"), candidate.normalize("NFKC"));
}

/** png by media; a PDF is pdf-layer or pdf-scan by the fixture id's suffix. Anything else is not scored. */
export function subgroupOf(fixture: { readonly id: string; readonly media: FixtureMedia }): Subgroup | null {
  if (fixture.media === "png") return "png";
  if (fixture.id.endsWith("-pdf-layer")) return "pdf-layer";
  if (fixture.id.endsWith("-pdf-scan")) return "pdf-scan";
  return null;
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const round = (v: number | null, places: number): number | null => (v === null ? null : Number(v.toFixed(places)));

/**
 * Aggregate a run report over the fixtures that were scored. `expectedText` supplies each fixture's
 * reference so the folded CER can be computed here; the runner's raw CER is recomputed identically
 * from the same transcript, so the two are comparable.
 */
export function aggregate(
  report: BakeoffRunReport,
  fixtures: readonly BakeoffFixture[],
  expectedText: (fixture: ActiveBakeoffFixture) => string,
): Aggregates {
  const active = fixtures.filter((f): f is ActiveBakeoffFixture => f.active === true && f.role === report.role_filter);
  const byId = new Map(active.map((f) => [f.id, f]));
  const candidates = new Set<string>([...report.probes.map((p) => p.candidate), ...report.observations.map((o) => o.engine_name)]);
  const out: Record<string, Partial<Record<Subgroup, SubgroupAggregate>>> = {};
  for (const name of candidates) {
    const obs = report.observations.filter((o) => o.engine_name === name);
    const perSub: Partial<Record<Subgroup, SubgroupAggregate>> = {};
    for (const sub of ["png", "pdf-layer", "pdf-scan"] as const) {
      const members = active.filter((f) => subgroupOf(f) === sub);
      if (members.length === 0) continue;
      const failures: Record<string, number> = {};
      const cers: number[] = [];
      const folded: number[] = [];
      const latencies: number[] = [];
      const rss: number[] = [];
      let successes = 0;
      for (const f of members) {
        const o: EngineObservation | undefined = obs.find((x) => x.fixture_id === f.id);
        if (o === undefined) { failures.not_run = (failures.not_run ?? 0) + 1; continue; }
        if (o.outcome === "failure") { failures[o.code] = (failures[o.code] ?? 0) + 1; continue; }
        successes += 1;
        const ref = expectedText(byId.get(f.id)!);
        cers.push(computeCER(ref, o.transcript));
        folded.push(computeCERFolded(ref, o.transcript));
        latencies.push(o.latency_ms);
        rss.push(o.peak_rss_bytes);
      }
      const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
      latencies.sort((a, b) => a - b);
      perSub[sub] = {
        fixtures: members.length,
        successes,
        failures,
        success_rate: round(successes / members.length, 4)!,
        mean_cer: round(mean(cers), 4),
        mean_cer_folded: round(mean(folded), 4),
        exact_rate: round(folded.filter((c) => c === 0).length / members.length, 4)!,
        p50_latency_ms: percentile(latencies, 50),
        p95_latency_ms: percentile(latencies, 95),
        max_rss_mb: rss.length === 0 ? null : round(Math.max(...rss) / (1024 * 1024), 1),
      };
    }
    out[name] = perSub;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface RequirementResult extends Requirement {
  readonly measured: number | null;
  readonly pass: boolean;
}

export interface CandidateEvaluation {
  readonly candidate: string;
  readonly present: boolean;
  readonly requirements: readonly RequirementResult[];
  readonly qualifies: boolean;
}

export interface SlotResult {
  readonly slot: string;
  readonly evaluations: readonly CandidateEvaluation[];
  readonly awarded_to: string | null;
  /** Qualifying candidates in rank order; a tie is recorded, not broken silently. */
  readonly ranking: readonly string[];
  readonly tie: readonly string[] | null;
}

/** One-character-per-page resolution: below this folded-CER gap two candidates are tied. */
const TIE_EPSILON = 0.01;

function measure(agg: Aggregates, candidate: string, r: { subgroup: Subgroup; metric: MetricName; code?: string }): number | null {
  const sub = agg[candidate]?.[r.subgroup];
  if (sub === undefined) return null;
  switch (r.metric) {
    case "success_rate": return sub.success_rate;
    case "signal_rate": return round((sub.failures[r.code ?? ""] ?? 0) / sub.fixtures, 4);
    case "mean_cer": return sub.mean_cer;
    case "mean_cer_folded": return sub.mean_cer_folded;
    case "exact_rate": return sub.exact_rate;
    case "p95_latency_ms": return sub.p95_latency_ms;
    case "max_rss_mb": return sub.max_rss_mb;
  }
}

export function evaluate(spec: VerdictSpec, agg: Aggregates): { slots: SlotResult[]; control: string | null } {
  const slots = spec.slots.map((sl): SlotResult => {
    const evaluations = sl.candidates.map((candidate): CandidateEvaluation => {
      const present = agg[candidate] !== undefined;
      const requirements = sl.requirements.map((r): RequirementResult => {
        const measured = measure(agg, candidate, r);
        // An unmeasured requirement fails: absence is not compliance.
        const pass = measured !== null && (r.op === ">=" ? measured >= r.value : measured <= r.value);
        return { ...r, measured, pass };
      });
      return { candidate, present, requirements, qualifies: present && requirements.every((r) => r.pass) };
    });
    const qualifying = evaluations.filter((e) => e.qualifies).map((e) => e.candidate);
    const keyed = qualifying.map((c) => ({ c, keys: sl.rank_by.map((k) => measure(agg, c, k)) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < sl.rank_by.length; i += 1) {
        const dir = sl.rank_by[i]!.direction === "asc" ? 1 : -1;
        const x = a.keys[i] ?? Number.POSITIVE_INFINITY;
        const y = b.keys[i] ?? Number.POSITIVE_INFINITY;
        if (x !== y) return (x - y) * dir;
      }
      return a.c.localeCompare(b.c);
    });
    const ranking = keyed.map((k) => k.c);
    let tie: string[] | null = null;
    if (keyed.length >= 2 && sl.rank_by.length > 0 && sl.rank_by[0]!.metric === "mean_cer_folded") {
      const first = keyed[0]!.keys[0];
      const tied = keyed.filter((k) => first !== null && k.keys[0] !== null && Math.abs((k.keys[0] ?? 0) - (first ?? 0)) < TIE_EPSILON).map((k) => k.c);
      if (tied.length >= 2) tie = tied;
    }
    return { slot: sl.slot, evaluations, awarded_to: ranking[0] ?? null, ranking, tie };
  });
  let control: string | null = null;
  if (spec.control !== undefined) {
    const from = slots.find((s) => s.slot === spec.control!.from_slot);
    control = from !== undefined && from.ranking.length >= 2 ? from.ranking[1]! : null;
  }
  return { slots, control };
}

// ---------------------------------------------------------------------------
// The committed result
// ---------------------------------------------------------------------------

export interface VerdictResult {
  readonly schema: "bakeoff-verdict/1";
  readonly generated_at: string;
  readonly spec: { readonly sha256: string; readonly registered_at: string; readonly evaluate_on_role: FixtureRole };
  readonly manifest: { readonly sha256: string; readonly root: "repo" | "external"; readonly role: FixtureRole; readonly fixtures_scored: number };
  readonly harness: { readonly git_sha: string | null; readonly node: string };
  readonly host: { readonly platform: string; readonly arch: string };
  readonly candidates: Readonly<Record<string, { readonly probe_status: string; readonly resolved_version: string | null; readonly detail: string | null }>>;
  readonly aggregates: Aggregates;
  readonly slots: readonly SlotResult[];
  readonly control: string | null;
}

export function sha256Hex(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build the result. `root` says whether the manifest lived in the repository or outside it; for an
 * external root nothing but aggregates and identity is included — the same as for the repository,
 * which is the point: the shape does not change with the sensitivity of the pages.
 */
export function buildVerdict(input: {
  readonly report: BakeoffRunReport;
  readonly fixtures: readonly BakeoffFixture[];
  readonly expectedText: (fixture: ActiveBakeoffFixture) => string;
  readonly spec: VerdictSpec;
  readonly specSha256: string;
  readonly manifestSha256: string;
  readonly root: "repo" | "external";
  readonly gitSha: string | null;
}): VerdictResult {
  if (input.report.role_filter !== input.spec.evaluate_on_role) {
    throw new VerdictSpecError(`the spec evaluates role ${input.spec.evaluate_on_role}; the report scored role ${input.report.role_filter}`);
  }
  const aggregates = aggregate(input.report, input.fixtures, input.expectedText);
  const { slots, control } = evaluate(input.spec, aggregates);
  const candidates: Record<string, { probe_status: string; resolved_version: string | null; detail: string | null }> = {};
  for (const p of input.report.probes) {
    const r = p.result as { status: string; resolved_version?: string; detail?: string };
    // The probe detail names the helper's source path; keep only what identifies the build.
    const detail = typeof r.detail === "string" ? r.detail.replace(/helper=\S+/, (m) => m.split(":")[0] ?? m) : null;
    candidates[p.candidate] = { probe_status: r.status, resolved_version: r.resolved_version ?? null, detail };
  }
  return {
    schema: "bakeoff-verdict/1",
    generated_at: input.report.generated_at,
    spec: { sha256: input.specSha256, registered_at: input.spec.registered_at, evaluate_on_role: input.spec.evaluate_on_role },
    manifest: { sha256: input.manifestSha256, root: input.root, role: input.report.role_filter, fixtures_scored: input.report.fixtures_scored },
    harness: { git_sha: input.gitSha, node: process.version },
    host: input.report.host,
    candidates,
    aggregates,
    slots,
    control,
  };
}

/** The words that must never appear in a committed result, checked before it is written. */
export function assertCommittable(result: VerdictResult): void {
  const text = JSON.stringify(result);
  for (const key of ["\"transcript\"", "\"observations\"", "\"cer_scores\"", "\"fixture_id\"", "\"path\""]) {
    if (text.includes(key)) throw new VerdictSpecError(`a committable result must not carry ${key}`);
  }
}

export function readSpecFile(path: string): { spec: VerdictSpec; sha256: string } {
  const json = readFileSync(path, "utf8");
  return { spec: parseVerdictSpec(json), sha256: sha256Hex(json) };
}
