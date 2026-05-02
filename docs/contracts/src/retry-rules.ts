// Retry policy semantics from docs/contracts/ocr-worker-contract.md §4.
// - Transient failure (is_transient=true) MAY be retried up to max_attempts.
// - Permanent failure (is_transient=false) MUST NOT be retried.
// - failed -> dead_lettered when retries exhausted OR when failure is permanent.

import type { TransitionRecord } from "./transitions.js";

export interface PartialFailure {
  code: string;
  message: string;
  is_transient: boolean;
  attempted_count: number;
}

export interface ResultEmitted {
  status: "succeeded" | "failed" | "cancelled";
  partial_failure: PartialFailure | null;
}

export interface RetryPolicy {
  max_attempts: number;
  attempt: number;
}

export interface RetryRecord {
  result_emitted: ResultEmitted;
  retry_policy: RetryPolicy;
  transitions: readonly TransitionRecord[];
}

export type RetryRuleResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Given a result envelope and the subsequent transitions, decide whether the
 * retry behavior is consistent with the contract.
 */
export function validateRetryBehavior(record: RetryRecord): RetryRuleResult {
  const { result_emitted, retry_policy, transitions } = record;

  if (!result_emitted || result_emitted.status !== "failed") {
    return { ok: true };
  }

  // Guard numeric invariants. The contract requires `max_attempts` and
  // `attempt` to be positive integers with `attempt <= max_attempts`. The JSON
  // Schema enforces this for submissions, but `validateRetryBehavior` accepts
  // raw input from any caller — fractional or negative values were previously
  // accepted, and the subtraction below would yield nonsensical results.
  const numericErr = validateRetryCounters(retry_policy);
  if (numericErr) return { ok: false, error: numericErr };

  const pf = result_emitted.partial_failure;
  if (!pf) {
    return { ok: false, error: "failed result must include partial_failure" };
  }

  // Find the first transition leaving the `failed` state.
  const failedEdge = transitions.find((t) => t.from === "failed");
  if (!failedEdge) {
    // No transition out of failed yet — nothing to validate.
    return { ok: true };
  }

  // Permanent failure: must go to dead_lettered, never re-queue.
  if (pf.is_transient === false) {
    if (failedEdge.to !== "dead_lettered") {
      return {
        ok: false,
        error: `permanent failure (is_transient=false) must transition to dead_lettered, got '${failedEdge.to}'`,
      };
    }
    return { ok: true };
  }

  // Transient failure: may re-queue while attempts remain, else dead_letter.
  const attemptsRemaining = retry_policy.max_attempts - retry_policy.attempt;
  if (failedEdge.to === "queued") {
    if (attemptsRemaining <= 0) {
      return {
        ok: false,
        error: `transient failure re-queued but attempts exhausted (attempt ${retry_policy.attempt} of ${retry_policy.max_attempts})`,
      };
    }
    return { ok: true };
  }
  if (failedEdge.to === "dead_lettered") return { ok: true };

  return {
    ok: false,
    error: `failed -> '${failedEdge.to}' is not a valid edge for failed state`,
  };
}

/**
 * Returns a human-readable error string when `retry_policy` violates the
 * numeric invariants the contract requires. Returns null when the counters
 * are sane.
 */
export function validateRetryCounters(p: RetryPolicy): string | null {
  if (!p || typeof p !== "object") {
    return "retry_policy is required";
  }
  if (!Number.isInteger(p.max_attempts) || p.max_attempts < 1) {
    return `retry_policy.max_attempts must be a positive integer, got ${String(p.max_attempts)}`;
  }
  if (!Number.isInteger(p.attempt) || p.attempt < 1) {
    return `retry_policy.attempt must be a positive integer, got ${String(p.attempt)}`;
  }
  if (p.attempt > p.max_attempts) {
    return `retry_policy.attempt ${p.attempt} exceeds max_attempts ${p.max_attempts}`;
  }
  return null;
}
