/**
 * ⚠️  TEST / INTEGRATION SCAFFOLDING — NOT PRODUCTION OCR.
 *
 * `processFakeOcrJob` is a deterministic, in-process fake of the OCR worker.
 * It validates the submission, walks documented status transitions (asserted
 * edge-by-edge against the contract state machine), produces results derived
 * from the canonical fixtures under `fixtures/valid/`, and validates the
 * emitted results against the result schema — all without running OCR.
 *
 * Use it to wire up queue consumers, integration harnesses, and end-to-end
 * tests *before* the real PaddleOCR worker exists. Do NOT deploy this in any
 * codepath that needs actual text recognition.
 *
 * The fake never emits a contract-invalid payload; if internal logic ever
 * produces one, the function throws `FakeWorkerError`.
 */

import successFixture from "../../fixtures/valid/result-chinese-litigation.json" with { type: "json" };
import failureFixture from "../../fixtures/valid/result-partial-failure.json" with { type: "json" };

import { validateOcrSubmission } from "../validateSubmission.js";
import { validateOcrResult } from "../validateResult.js";
import {
  assertValidOcrStatusTransition,
  validateOcrStatusTransitionSequence,
} from "../validateStatusTransition.js";
import type { OcrSubmission, PageRef } from "../generated/ocr-submission.js";
import type { OcrResult } from "../generated/ocr-result.js";
import type { OcrJobOutcome } from "../generated/ocr-job-outcome.js";
import type {
  OcrJobActor,
  OcrJobState,
  TransitionRecord,
} from "../transitions.js";

export type FakeScenario =
  | "success"
  | "partial_failure"
  | "permanent_failure"
  | "transient_then_success";

export interface FakeWorkerOptions {
  /** Default: "success". */
  scenario?: FakeScenario;
  /**
   * Deterministic clock. If omitted, the fake derives a clock from
   * `submission.submitted_at`, advancing 100ms per emitted timestamp.
   */
  now?: () => Date;
}

/**
 * Test-only specialization of the production `OcrJobOutcome` shape.
 *
 * Per ADR-11A.5 §1, the production type is `OcrJobOutcome` (4-field,
 * schema-derived). The fake worker emits the same shape plus a `scenario`
 * tag so tests can identify which deterministic path produced an outcome.
 *
 * `scenario` is OPTIONAL on the type even though `processFakeOcrJob` always
 * sets it at runtime — this lets hand-built test fakes omit the tag without
 * a cast, while still satisfying structural assignment to `OcrJobOutcome`.
 */
export interface FakeJobOutcome extends OcrJobOutcome {
  scenario?: FakeScenario;
}

export class FakeWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FakeWorkerError";
  }
}

const DEFAULT_SCENARIO: FakeScenario = "success";

const VALID_SCENARIOS: ReadonlySet<FakeScenario> = new Set<FakeScenario>([
  "success",
  "partial_failure",
  "permanent_failure",
  "transient_then_success",
]);

export function processFakeOcrJob(
  submission: unknown,
  options: FakeWorkerOptions = {},
): FakeJobOutcome {
  // 1. Validate the submission. Refuse to operate on garbage input.
  const subResult = validateOcrSubmission(submission);
  if (!subResult.ok) {
    throw new FakeWorkerError(`invalid submission: ${subResult.summary}`);
  }
  const sub = subResult.value;

  if (sub.pages.length === 0) {
    // Schema enforces minItems 1, but the generated type widens to PageRef[]
    // under noUncheckedIndexedAccess; defend explicitly.
    throw new FakeWorkerError("submission has no pages");
  }

  const scenario = options.scenario ?? DEFAULT_SCENARIO;
  // Defend against `as any` casts that smuggle an unknown scenario past TS.
  // Without this guard the switch in `buildStatusSequence` falls through to
  // `undefined` and downstream code crashes on `statuses.length`.
  if (!VALID_SCENARIOS.has(scenario)) {
    throw new FakeWorkerError(
      `unknown scenario: ${String(scenario)}. Valid scenarios: ${[...VALID_SCENARIOS].join(", ")}`,
    );
  }
  const clock = makeClock(sub, options.now);

  // 2. Walk the documented status transitions for this scenario. Each step
  //    is asserted against the state machine; an internal bug will throw.
  const statuses = buildStatusSequence(scenario, clock);

  // 3. Cross-check the assembled sequence as a whole (chain integrity, etc).
  const seqResult = validateOcrStatusTransitionSequence({
    job_id: sub.job_id,
    transitions: statuses,
  });
  if (!seqResult.ok) {
    throw new FakeWorkerError(
      `fake worker assembled invalid status sequence: ${seqResult.summary}`,
    );
  }

  // 4. Build the per-page result(s) from canonical fixtures. One result per
  //    submitted page for every scenario; partial_failure requires >= 2
  //    submitted pages because mixed success/failure on a single page is not
  //    representable in the contract.
  const results = buildResults(scenario, sub, clock);

  // 5. Validate every emitted result.
  for (const r of results) {
    const rv = validateOcrResult(r);
    if (!rv.ok) {
      throw new FakeWorkerError(
        `fake worker emitted invalid result: ${rv.summary}`,
      );
    }
  }

  // Generated `OcrJobOutcome.statuses` is the non-empty tuple
  // `[TransitionRecord, ...TransitionRecord[]]` (schema `minItems: 1`).
  // `buildStatusSequence` always pushes >= 1 transition, and the sequence
  // validator above would have failed if it didn't; defend explicitly so
  // a future change to the switch cannot silently produce an empty tuple.
  if (statuses.length === 0) {
    throw new FakeWorkerError(
      "fake worker assembled an empty status sequence; expected >= 1",
    );
  }
  const lastTransition = statuses[statuses.length - 1]!;
  // Cast to OcrJobOutcome["statuses"] (rather than the local
  // TransitionRecord tuple) because the schema-derived generated type
  // carries a `[k: string]: unknown` index signature on TransitionRecord
  // that the hand-written `../transitions.ts` shape does not. Going
  // through OcrJobOutcome["statuses"] keeps the source compatible with
  // both representations of TransitionRecord without a triple-cast.
  return {
    scenario,
    job_id: sub.job_id,
    statuses: statuses as unknown as OcrJobOutcome["statuses"],
    results,
    terminal_state: lastTransition.to,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function makeClock(sub: OcrSubmission, override?: () => Date): () => Date {
  if (override) return override;
  let t = new Date(sub.submitted_at).getTime();
  if (Number.isNaN(t)) {
    // Schema's date-time format already enforces validity, but be defensive.
    t = Date.now();
  }
  return () => {
    t += 100;
    return new Date(t);
  };
}

function step(
  from: OcrJobState,
  to: OcrJobState,
  by: OcrJobActor,
  clock: () => Date,
  note?: string,
): TransitionRecord {
  // Throws IllegalTransitionError if (from, to, by) is not in the allowed set.
  assertValidOcrStatusTransition(from, to, by);
  const record: TransitionRecord = {
    from,
    to,
    controlled_by: by,
    at: clock().toISOString(),
  };
  if (note !== undefined) record.note = note;
  return record;
}

function buildStatusSequence(
  scenario: FakeScenario,
  clock: () => Date,
): TransitionRecord[] {
  const out: TransitionRecord[] = [];
  switch (scenario) {
    case "success":
      out.push(step("queued", "claimed", "queue", clock));
      out.push(step("claimed", "processing", "worker", clock));
      out.push(step("processing", "succeeded", "worker", clock));
      return out;

    case "partial_failure":
      out.push(step("queued", "claimed", "queue", clock));
      out.push(step("claimed", "processing", "worker", clock));
      out.push(step("processing", "partial_succeeded", "worker", clock,
        "at least one page succeeded, at least one failed"));
      return out;

    case "permanent_failure":
      out.push(step("queued", "claimed", "queue", clock));
      out.push(step("claimed", "processing", "worker", clock));
      out.push(step("processing", "failed", "worker", clock,
        "permanent failure (is_transient=false)"));
      out.push(step("failed", "dead_lettered", "queue", clock,
        "no retry — permanent"));
      return out;

    case "transient_then_success":
      out.push(step("queued", "claimed", "queue", clock));
      out.push(step("claimed", "processing", "worker", clock));
      out.push(step("processing", "failed", "worker", clock,
        "transient failure, attempt 1"));
      out.push(step("failed", "queued", "queue", clock, "retry"));
      out.push(step("queued", "claimed", "queue", clock));
      out.push(step("claimed", "processing", "worker", clock));
      out.push(step("processing", "succeeded", "worker", clock,
        "attempt 2 succeeded"));
      return out;
  }
}

function buildResults(
  scenario: FakeScenario,
  sub: OcrSubmission,
  clock: () => Date,
): OcrResult[] {
  const pages = sub.pages as readonly PageRef[];
  switch (scenario) {
    case "success":
    case "transient_then_success": {
      // One succeeded result per submitted page.
      return pages.map((p) => withCompletedAt(cloneResultFor(successFixture, sub, p), clock));
    }
    case "permanent_failure": {
      // One failed result per submitted page; the terminal job state is
      // dead_lettered. Worker-level permanence applies uniformly across pages.
      return pages.map((p) => withCompletedAt(cloneResultFor(failureFixture, sub, p), clock));
    }
    case "partial_failure": {
      // partial_failure scenario means SOME pages succeeded and SOME failed.
      // That is unrepresentable when the submission only has one page — there
      // would be nothing to be "partial" against. Refuse rather than invent
      // an unsubmitted page (the prior behavior, which silently violated the
      // submission/result page-binding invariant).
      if (pages.length < 2) {
        throw new FakeWorkerError(
          "partial_failure scenario requires a submission with >= 2 pages; " +
            "single-page submissions cannot exhibit partial success",
        );
      }
      // First page succeeds, the rest fail. Deterministic and uses only
      // submitted page identities.
      const successPage = pages[0]!;
      const successResult = withCompletedAt(
        cloneResultFor(successFixture, sub, successPage),
        clock,
      );
      const failureResults = pages
        .slice(1)
        .map((p) => withCompletedAt(cloneResultFor(failureFixture, sub, p), clock));
      return [successResult, ...failureResults];
    }
  }
}

function withCompletedAt(r: OcrResult, clock: () => Date): OcrResult {
  r.completed_at = clock().toISOString();
  return r;
}

function cloneResultFor(
  fixture: unknown,
  sub: OcrSubmission,
  page: { page_id: string; page_number: number },
): OcrResult {
  const r = structuredClone(fixture) as OcrResult & {
    [k: string]: unknown;
  };
  r.job_id = sub.job_id;
  r.tenant_id = sub.tenant_id;
  r.document_id = sub.document_id;
  if (sub.document_revision !== undefined) {
    r.document_revision = sub.document_revision;
  }
  r.page_id = page.page_id;
  r.page_number = page.page_number;
  // Echo submission metadata. The contract requires result.metadata to be the
  // metadata supplied at submission, not whatever the fixture happened to
  // carry; mismatch means downstream consumers (audit log, observability,
  // tracing) get a foreign trace_id.
  r.metadata = structuredClone(sub.metadata);
  return r;
}
