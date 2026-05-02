// High-level retry classifier exposed at the package surface.
// Wraps validateRetryBehavior from retry-rules.ts with an ergonomic API for the
// common case: "given this failure, should the queue retry?".

import {
  validateRetryBehavior,
  validateRetryCounters,
  type PartialFailure,
  type ResultEmitted,
  type RetryPolicy,
  type RetryRecord,
  type RetryRuleResult,
} from "./retry-rules.js";

export type {
  PartialFailure,
  ResultEmitted,
  RetryPolicy,
  RetryRecord,
  RetryRuleResult,
};
export { validateRetryBehavior, validateRetryCounters };

export class RetryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryPolicyError";
  }
}

export type RetryDecision =
  | { kind: "retry";        attemptsRemaining: number; reason: string }
  | { kind: "dead_letter";  reason: string }
  | { kind: "not_failed";   reason: string };

/**
 * Classify a (failure, retry policy) pair into a queue-actionable decision.
 * The contract (§4) is the source of truth: permanent failures dead-letter
 * immediately; transient failures may retry while attempts remain.
 *
 * This function is pure — it does not know about queue mechanics. The caller
 * is responsible for actually enqueueing or dead-lettering.
 */
export function classifyOcrFailureForRetry(args: {
  failure: PartialFailure | null;
  retry: RetryPolicy;
  status: ResultEmitted["status"];
}): RetryDecision {
  const { failure, retry, status } = args;

  if (status !== "failed") {
    return { kind: "not_failed", reason: `status='${status}' is not a failure` };
  }
  if (!failure) {
    // Schema rejects this, but defend at the API surface too.
    return {
      kind: "dead_letter",
      reason: "failed result with no partial_failure cannot be classified; dead-letter for safety",
    };
  }
  // Guard numeric invariants before doing arithmetic. A caller that smuggles
  // `attempt: 1.5` past TypeScript would otherwise get back a fractional
  // `attemptsRemaining`, which the queue layer cannot act on.
  const numericErr = validateRetryCounters(retry);
  if (numericErr) {
    throw new RetryPolicyError(numericErr);
  }
  if (failure.is_transient === false) {
    return {
      kind: "dead_letter",
      reason: `permanent failure '${failure.code}': ${failure.message}`,
    };
  }
  const attemptsRemaining = retry.max_attempts - retry.attempt;
  if (attemptsRemaining <= 0) {
    return {
      kind: "dead_letter",
      reason: `transient failure '${failure.code}' but attempts exhausted (${retry.attempt}/${retry.max_attempts})`,
    };
  }
  return {
    kind: "retry",
    attemptsRemaining,
    reason: `transient failure '${failure.code}'; ${attemptsRemaining} attempt(s) remaining`,
  };
}
