// Observability event shapes for the OCR coordinator + worker loop.
//
// The coordinator and worker loop already emit results (the discriminated
// `OcrCoordinatorOutcome` union) and a final summary histogram. What was
// missing for v1 was a canonical structured event shape that operators can
// log, alert on, and aggregate without each consumer inventing their own
// keys. This module is pure: it converts a coordinator result into a
// frozen JSON-safe event, plus a single-line formatter for stdout-style
// logging. Wiring (logger, metrics sink) belongs to the caller.
//
// Design notes:
//
// 1. **Per-outcome variants, not a generic event.** Each outcome carries
//    different load-bearing fields (e.g. retry's `next_attempt`, dead-letter's
//    `reason`, ack failure's `queue_error_code`). A flat event would force
//    every consumer to handle `undefined` for irrelevant fields; a
//    discriminated union lets the event consumer narrow with `switch`.
//
// 2. **No clock dependency in `toCoordinatorEvent`.** The caller passes
//    `at` (or accepts the default `new Date()`). Tests inject a fixed
//    `at` to keep snapshots deterministic.
//
// 3. **Severity is opinionated.** `dead_lettered` and the persistence /
//    ack failure outcomes are `warn`; `retried` is `info`; `completed` /
//    `completed_already_terminal` / `requeued` are `info`. Operators can
//    override by mapping severity to their alert system. Severity is
//    advisory — it is NOT used to filter what events fire.
//
// 4. **No PII.** Submission payloads are NOT in the event. Only job_id,
//    counts, and short error strings (drawn from the coordinator's own
//    `error.message`, which is sanitized per CLAUDE.md fetcher rules).

import type {
  OcrCoordinatorOutcome,
  OcrCoordinatorResult,
} from "./coordinator.js";

/** Advisory severity for operator dashboards / alert routing. */
export type OcrCoordinatorEventSeverity = "info" | "warn";

/**
 * Schema version for the event shape. Bump when adding/removing fields
 * that break consumers' downstream parsers. Consumers should pin this on
 * read; missing/lower → safe to upgrade additively, higher → reject.
 */
export const OCR_COORDINATOR_EVENT_SCHEMA_VERSION = 1 as const;

/** Common envelope fields shared by every event variant. */
interface OcrCoordinatorEventBase {
  /** Fixed schema version of this event shape. */
  schema_version: typeof OCR_COORDINATOR_EVENT_SCHEMA_VERSION;
  /** ISO 8601 timestamp; injected by caller for determinism. */
  at: string;
  /** Discriminant — always equal to the coordinator outcome. */
  type: OcrCoordinatorOutcome;
  /** Advisory severity. */
  severity: OcrCoordinatorEventSeverity;
  /**
   * The job_id this event concerns. Absent when the outcome was `empty`
   * (no claim was acquired). Otherwise always present.
   */
  job_id?: string;
}

/** "Found nothing to claim this iteration." Carries no job_id. */
export interface OcrCoordinatorEmptyEvent extends OcrCoordinatorEventBase {
  type: "empty";
  severity: "info";
  job_id?: undefined;
}

/** Successful end-to-end: worker ran, results persisted, claim completed. */
export interface OcrCoordinatorCompletedEvent extends OcrCoordinatorEventBase {
  type: "completed";
  severity: "info";
  job_id: string;
  statuses_persisted: number;
  results_persisted: number;
}

/**
 * Redelivery of an already-terminal job. The coordinator short-circuited
 * past the worker because persistence said the job had already reached
 * a terminal state.
 */
export interface OcrCoordinatorCompletedAlreadyTerminalEvent
  extends OcrCoordinatorEventBase {
  type: "completed_already_terminal";
  severity: "info";
  job_id: string;
}

/**
 * Coordinator requeued the claim because the worker's output was
 * contract-invalid, threw, or normalization rejected it. The next
 * redelivery re-runs the worker.
 */
export interface OcrCoordinatorRequeuedEvent extends OcrCoordinatorEventBase {
  type: "requeued";
  severity: "info";
  job_id: string;
  reason: string;
}

/**
 * ADR-11F retry: worker failed transiently, budget remaining. Coordinator
 * persisted `failed → queued`, durably wrote the bumped submission to
 * the ADR-11G outbox row, completed the original claim, and enqueued a
 * fresh attempt.
 */
export interface OcrCoordinatorRetriedEvent extends OcrCoordinatorEventBase {
  type: "retried";
  severity: "info";
  job_id: string;
  statuses_persisted: number;
  /** Always 0 on the retry path — failed results are discarded (Codex B1). */
  results_persisted: number;
}

/**
 * ADR-11F dead-letter: permanent failure, OR transient + budget exhausted.
 * `terminal_state` becomes `dead_lettered`. No further redelivery.
 */
export interface OcrCoordinatorDeadLetteredEvent
  extends OcrCoordinatorEventBase {
  type: "dead_lettered";
  severity: "warn";
  job_id: string;
  statuses_persisted: number;
  results_persisted: number;
}

/**
 * Persistence write failed (chain break, conflicting replay, outbox
 * write failure, etc.) The current claim stays active so the lease can
 * expire and redelivery can re-evaluate.
 */
export interface OcrCoordinatorPersistenceFailedEvent
  extends OcrCoordinatorEventBase {
  type: "persistence_failed";
  severity: "warn";
  job_id: string;
  message: string;
  /** OcrQueueError.code if the failure originated from a queue op. */
  queue_error_code?: string;
}

/**
 * Queue.completeClaim or requeueClaim failed for a non-lease reason
 * (`unknown_receipt`, `stale_receipt`, `invalid_claim`, or a backend
 * error). The persisted state stands; recovery depends on the queue.
 */
export interface OcrCoordinatorAckFailedEvent
  extends OcrCoordinatorEventBase {
  type: "ack_failed";
  severity: "warn";
  job_id: string;
  queue_error_code?: string;
  message: string;
}

/**
 * Specifically `lease_expired` on completeClaim. Distinguished from the
 * generic `ack_failed` because under ADR-11G the pending-retry outbox
 * row may carry the bumped submission that the next redelivery will
 * pick up. Operators may want to alert separately.
 */
export interface OcrCoordinatorLeaseLostEvent extends OcrCoordinatorEventBase {
  type: "lease_lost";
  severity: "warn";
  job_id: string;
  message: string;
}

export type OcrCoordinatorEvent =
  | OcrCoordinatorEmptyEvent
  | OcrCoordinatorCompletedEvent
  | OcrCoordinatorCompletedAlreadyTerminalEvent
  | OcrCoordinatorRequeuedEvent
  | OcrCoordinatorRetriedEvent
  | OcrCoordinatorDeadLetteredEvent
  | OcrCoordinatorPersistenceFailedEvent
  | OcrCoordinatorAckFailedEvent
  | OcrCoordinatorLeaseLostEvent;

export interface ToCoordinatorEventOptions {
  /** ISO timestamp to stamp the event with. Default: `new Date().toISOString()`. */
  at?: string;
}

const SEVERITY: Record<OcrCoordinatorOutcome, OcrCoordinatorEventSeverity> = {
  empty: "info",
  completed: "info",
  completed_already_terminal: "info",
  requeued: "info",
  retried: "info",
  dead_lettered: "warn",
  persistence_failed: "warn",
  ack_failed: "warn",
  lease_lost: "warn",
};

/**
 * Convert a coordinator result into a structured event. The mapping is
 * total — every documented outcome produces exactly one event shape.
 *
 * The result's `error.message` field is copied verbatim into the event
 * for the failure variants. The coordinator's error messages are
 * already sanitized per the fetcher message-sanitization rules
 * (ADR-11D); this module does not re-sanitize.
 */
export function toCoordinatorEvent(
  result: OcrCoordinatorResult,
  options: ToCoordinatorEventOptions = {},
): OcrCoordinatorEvent {
  const at = options.at ?? new Date().toISOString();
  const base = {
    schema_version: OCR_COORDINATOR_EVENT_SCHEMA_VERSION,
    at,
    severity: SEVERITY[result.outcome],
  } as const;

  switch (result.outcome) {
    case "empty":
      return { ...base, type: "empty", severity: "info" };
    case "completed":
      return {
        ...base,
        type: "completed",
        severity: "info",
        job_id: requireJobId(result),
        statuses_persisted: result.statuses_persisted ?? 0,
        results_persisted: result.results_persisted ?? 0,
      };
    case "completed_already_terminal":
      return {
        ...base,
        type: "completed_already_terminal",
        severity: "info",
        job_id: requireJobId(result),
      };
    case "requeued":
      return {
        ...base,
        type: "requeued",
        severity: "info",
        job_id: requireJobId(result),
        reason: result.error?.message ?? "no reason recorded",
      };
    case "retried":
      return {
        ...base,
        type: "retried",
        severity: "info",
        job_id: requireJobId(result),
        statuses_persisted: result.statuses_persisted ?? 0,
        results_persisted: result.results_persisted ?? 0,
      };
    case "dead_lettered":
      return {
        ...base,
        type: "dead_lettered",
        severity: "warn",
        job_id: requireJobId(result),
        statuses_persisted: result.statuses_persisted ?? 0,
        results_persisted: result.results_persisted ?? 0,
      };
    case "persistence_failed": {
      const event: OcrCoordinatorPersistenceFailedEvent = {
        ...base,
        type: "persistence_failed",
        severity: "warn",
        job_id: requireJobId(result),
        message: result.error?.message ?? "no message recorded",
      };
      if (result.error?.code !== undefined) {
        event.queue_error_code = result.error.code;
      }
      return event;
    }
    case "ack_failed": {
      const event: OcrCoordinatorAckFailedEvent = {
        ...base,
        type: "ack_failed",
        severity: "warn",
        job_id: requireJobId(result),
        message: result.error?.message ?? "no message recorded",
      };
      if (result.error?.code !== undefined) {
        event.queue_error_code = result.error.code;
      }
      return event;
    }
    case "lease_lost":
      return {
        ...base,
        type: "lease_lost",
        severity: "warn",
        job_id: requireJobId(result),
        message: result.error?.message ?? "no message recorded",
      };
    default: {
      const _exhaustive: never = result.outcome;
      throw new Error(
        `unhandled coordinator outcome: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Format an event as a single-line newline-terminated JSON record
 * suitable for stdout-style structured logging. The line ends in `\n`
 * so callers can write it directly without appending.
 */
export function formatCoordinatorEventJson(
  event: OcrCoordinatorEvent,
): string {
  return JSON.stringify(event) + "\n";
}

function requireJobId(result: OcrCoordinatorResult): string {
  if (result.job_id === undefined) {
    // The coordinator's contract is that every non-`empty` outcome
    // carries a job_id. A missing one is a coordinator bug, not an
    // event-format issue; surface it loudly.
    throw new Error(
      `coordinator outcome '${result.outcome}' produced no job_id; cannot build event`,
    );
  }
  return result.job_id;
}
