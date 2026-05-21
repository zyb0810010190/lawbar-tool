// Confidentiality classification helpers and the external-handling decision
// resolver. Pure functions; no IO. See
// docs/adr/case-box-step-5-confidentiality-classification.md.
//
// Critical design properties:
//  - `unclassified` is the legal default. Empty classifications → handling
//    DENIED. Tests pin this as load-bearing.
//  - HandlingDecision return shape has NO green-light field (no
//    isPrivileged / safeToProcess / canTransmit / approvedForExternal).
//    Callers MUST check `allowed === true` explicitly.
//  - `unclassified` is OUTSIDE the ordinal lattice. Transitions involving
//    unclassified are special-cased: first-classification, reset-to-unset.
//  - Privilege review is a CALLER-COMPUTED input. The contract layer
//    trusts it; persistence MUST treat `not_reviewed` as the default
//    for any target the lawyer has not explicitly cleared.

import type { CaseBoxConfidentialityClassification } from "./generated/case-box-confidentiality-classification.js";

export class ConfidentialityTransitionError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "ConfidentialityTransitionError";
    this.violation = violation;
  }
}

export class ConfidentialityCreationError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "ConfidentialityCreationError";
    this.violation = violation;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONFIDENTIALITY_LEVELS = Object.freeze([
  "unclassified",
  "normal",
  "confidential",
  "highly_confidential",
  "restricted",
] as const);

export type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

/**
 * Ordinal lattice for downgrade detection. `unclassified` is deliberately
 * absent — it is OUTSIDE the lattice and special-cased.
 */
export const LATTICE_ORDINAL = Object.freeze({
  normal: 1,
  confidential: 2,
  highly_confidential: 3,
  restricted: 4,
} as const);

export const CONFIDENTIALITY_CHANGE_REASON_CODES = Object.freeze([
  "discovery_production",
  "client_authorization",
  "court_order",
  "change_in_legal_assessment",
  "data_minimization",
  "reset_to_unset",
  "other",
] as const);

export type ConfidentialityChangeReasonCode =
  (typeof CONFIDENTIALITY_CHANGE_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Transition predicates
// ---------------------------------------------------------------------------

export function isFirstClassification(
  prior: ConfidentialityLevel | null,
  next: ConfidentialityLevel,
): boolean {
  return prior === null && next !== null;
}

export function isResetToUnclassified(
  prior: ConfidentialityLevel | null,
  next: ConfidentialityLevel,
): boolean {
  return prior !== null && prior !== "unclassified" && next === "unclassified";
}

export function isDowngrade(
  prior: ConfidentialityLevel | null,
  next: ConfidentialityLevel,
): boolean {
  if (prior === null) return false;
  if (prior === "unclassified") return false;
  if (next === "unclassified") return false;
  const priorOrdinal = (LATTICE_ORDINAL as Record<string, number>)[prior];
  const nextOrdinal = (LATTICE_ORDINAL as Record<string, number>)[next];
  if (typeof priorOrdinal !== "number" || typeof nextOrdinal !== "number") return false;
  // Downgrade = becoming LESS restrictive = lower ordinal.
  return nextOrdinal < priorOrdinal;
}

export function assertValidConfidentialityTransition(
  prior: ConfidentialityLevel | null,
  next: ConfidentialityLevel,
  change_reason_code: ConfidentialityChangeReasonCode | null,
): void {
  if (isDowngrade(prior, next)) {
    if (change_reason_code === null) {
      throw new ConfidentialityTransitionError(
        `downgrade ${JSON.stringify(prior)} → ${JSON.stringify(next)} requires non-null change_reason_code`,
      );
    }
  }
  if (isResetToUnclassified(prior, next)) {
    if (change_reason_code === null) {
      throw new ConfidentialityTransitionError(
        `reset to unclassified from ${JSON.stringify(prior)} requires non-null change_reason_code`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Creation rule (history-aware)
// ---------------------------------------------------------------------------

type CreationInput = {
  prior_level: ConfidentialityLevel | null;
  level: ConfidentialityLevel;
  change_reason_code: ConfidentialityChangeReasonCode | null;
};

/**
 * Validate a new classification row against the prior row for the same
 * (target_type, target_id). priorRow=null means this is the first row.
 */
export function assertValidNewConfidentialityClassification(
  row: CreationInput,
  priorRow: { level: ConfidentialityLevel } | null,
): void {
  if (priorRow === null) {
    if (row.prior_level !== null) {
      throw new ConfidentialityCreationError(
        `first classification row for target must have prior_level === null (got ${JSON.stringify(row.prior_level)})`,
      );
    }
  } else {
    if (row.prior_level !== priorRow.level) {
      throw new ConfidentialityCreationError(
        `row.prior_level (${JSON.stringify(row.prior_level)}) must equal priorRow.level (${JSON.stringify(priorRow.level)})`,
      );
    }
  }
  try {
    assertValidConfidentialityTransition(row.prior_level, row.level, row.change_reason_code);
  } catch (err) {
    if (err instanceof ConfidentialityTransitionError) {
      throw new ConfidentialityCreationError(err.violation);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Effective level resolver
// ---------------------------------------------------------------------------

export function effectiveConfidentialityLevel(
  targetType: "document" | "fact",
  targetId: string,
  classifications: ReadonlyArray<CaseBoxConfidentialityClassification>,
): ConfidentialityLevel {
  const filtered = classifications.filter(
    (c) => c.target_type === targetType && c.target_id === targetId,
  );
  if (filtered.length === 0) return "unclassified";
  // Sort by set_at DESC; tie-break by id ASC.
  const sorted = [...filtered].sort((a, b) => {
    if (a.set_at !== b.set_at) return a.set_at > b.set_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0]!.level;
}

// ---------------------------------------------------------------------------
// External-handling decision resolver
// ---------------------------------------------------------------------------

export type ExternalAction = "external_ocr" | "sync_transmit" | "llm_extraction";

export type PrivilegeReviewState =
  | "not_reviewed"
  | "reviewed_no_privilege_applies"
  | "privileged_protected"
  | "privileged_with_waiver";

export type HandlingDenialReason =
  | "unclassified_default_denies_external"
  | "classification_restricted"
  | "classification_highly_confidential"
  | "classification_confidential_disallows_action"
  | "matter_heightened"
  | "matter_sealed"
  | "privilege_not_reviewed"
  | "privilege_protected"
  | "missing_action_specific_opt_in"
  | "external_action_not_recognized";

export interface HandlingEvidence {
  readonly effectiveLevel: ConfidentialityLevel;
  readonly matterConfidentialityClass: "normal" | "heightened" | "sealed";
  readonly privilegeReviewState: PrivilegeReviewState;
  readonly externalAction: ExternalAction;
  readonly optInForAction: boolean;
}

export interface HandlingDecision {
  readonly allowed: boolean;
  readonly denialReasons: ReadonlyArray<HandlingDenialReason>;
  readonly evidence: HandlingEvidence;
}

export interface AssertExternalHandlingInput {
  readonly matter: { confidentiality_class: "normal" | "heightened" | "sealed" };
  readonly classifications: ReadonlyArray<CaseBoxConfidentialityClassification>;
  readonly privilegeReviewState: PrivilegeReviewState;
  readonly targetType: "document" | "fact";
  readonly targetId: string;
  readonly externalAction: ExternalAction;
  readonly externalOcrAuthorized: boolean;
  readonly syncGrantPresent: boolean;
  readonly llmExtractionOptIn: boolean;
}

const KNOWN_EXTERNAL_ACTIONS: ReadonlySet<string> = new Set([
  "external_ocr",
  "sync_transmit",
  "llm_extraction",
]);

export function assertExternalHandlingAllowed(
  input: AssertExternalHandlingInput,
): HandlingDecision {
  const effectiveLevel = effectiveConfidentialityLevel(
    input.targetType,
    input.targetId,
    input.classifications,
  );
  const optInForAction =
    input.externalAction === "external_ocr"
      ? input.externalOcrAuthorized
      : input.externalAction === "sync_transmit"
        ? input.syncGrantPresent
        : input.externalAction === "llm_extraction"
          ? input.llmExtractionOptIn
          : false;
  const evidence: HandlingEvidence = {
    effectiveLevel,
    matterConfidentialityClass: input.matter.confidentiality_class,
    privilegeReviewState: input.privilegeReviewState,
    externalAction: input.externalAction,
    optInForAction,
  };

  if (!KNOWN_EXTERNAL_ACTIONS.has(input.externalAction as string)) {
    return {
      allowed: false,
      denialReasons: ["external_action_not_recognized"],
      evidence,
    };
  }

  const denialReasons: HandlingDenialReason[] = [];

  if (effectiveLevel === "unclassified") {
    denialReasons.push("unclassified_default_denies_external");
  }
  if (effectiveLevel === "restricted") {
    denialReasons.push("classification_restricted");
  }
  if (effectiveLevel === "highly_confidential") {
    denialReasons.push("classification_highly_confidential");
  }
  if (effectiveLevel === "confidential") {
    denialReasons.push("classification_confidential_disallows_action");
  }

  if (input.matter.confidentiality_class === "sealed") {
    denialReasons.push("matter_sealed");
  }
  if (input.matter.confidentiality_class === "heightened") {
    denialReasons.push("matter_heightened");
  }

  if (input.privilegeReviewState === "not_reviewed") {
    denialReasons.push("privilege_not_reviewed");
  } else if (
    input.privilegeReviewState === "privileged_protected" ||
    input.privilegeReviewState === "privileged_with_waiver"
  ) {
    // v1: helper denies even with_waiver — per-action waiver mechanism is post-MVP.
    denialReasons.push("privilege_protected");
  }

  if (!optInForAction) {
    denialReasons.push("missing_action_specific_opt_in");
  }

  return {
    allowed: denialReasons.length === 0,
    denialReasons,
    evidence,
  };
}

export type { CaseBoxConfidentialityClassification };
