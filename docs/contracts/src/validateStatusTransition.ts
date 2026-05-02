import type { ValidateFunction } from "ajv";
import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { statusSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import {
  isAllowedTransition,
  validateTransitionSequence,
  type OcrJobActor,
  type OcrJobState,
  type TransitionRecord,
} from "./transitions.js";

// Top-level type from the status schema. The schema is a oneOf of two shapes
// (envelope or sequence); the validators below split them at the API surface.
import type { OcrStatus } from "./generated/ocr-status.js";

export interface OcrStatusEnvelope {
  contract_version: string;
  job_id: string;
  tenant_id: string;
  state: OcrJobState;
  observed_at: string;
  metadata?: Record<string, unknown>;
}

export interface OcrStatusTransitionSequence {
  job_id: string;
  transitions: TransitionRecord[];
}

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  return (compiled ??= ajv.compile(statusSchema as object));
}

function validateAgainstSchema(payload: unknown): ValidationResult<OcrStatus> {
  const v = getValidator();
  const ok = v(payload);
  if (ok) return { ok: true, value: payload as OcrStatus };
  const errors = (v.errors ?? []) as AjvErrorObject[];
  return { ok: false, summary: summarizeErrors(errors), errors };
}

/**
 * Validate a single status envelope (one observation of a job's current state).
 * Schema-only — no semantic transition rule applies to a single observation.
 */
export function validateOcrStatusEnvelope(
  payload: unknown,
): ValidationResult<OcrStatusEnvelope> {
  const r = validateAgainstSchema(payload);
  if (!r.ok) return r;
  // The schema oneOf accepts either branch; narrow to the envelope branch.
  if (
    typeof payload === "object" &&
    payload !== null &&
    "state" in payload &&
    "observed_at" in payload
  ) {
    return { ok: true, value: payload as OcrStatusEnvelope };
  }
  return {
    ok: false,
    summary: "payload validates against ocr-status schema but is not a status envelope",
    errors: [],
  };
}

/**
 * Validate a transition sequence's shape AND its semantics:
 * - chains correctly (each `from` matches prior `to`)
 * - every edge is a documented allowed transition controlled by the right actor
 * - no transition leaves a terminal state
 */
export function validateOcrStatusTransitionSequence(
  payload: unknown,
): ValidationResult<OcrStatusTransitionSequence> {
  const r = validateAgainstSchema(payload);
  if (!r.ok) return r;

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("transitions" in payload) ||
    !Array.isArray((payload as { transitions: unknown }).transitions)
  ) {
    return {
      ok: false,
      summary: "payload validates against ocr-status schema but is not a transition sequence",
      errors: [],
    };
  }

  const seq = payload as OcrStatusTransitionSequence;
  const semantic = validateTransitionSequence(seq.transitions);
  if (!semantic.ok) {
    return {
      ok: false,
      summary: semantic.error,
      errors: [
        {
          instancePath: `/transitions/${semantic.index}`,
          schemaPath: "(semantic)",
          keyword: "transition",
          params: {},
          message: semantic.error,
        },
      ],
    };
  }
  return { ok: true, value: seq };
}

export class IllegalTransitionError extends Error {
  readonly from: OcrJobState;
  readonly to: OcrJobState;
  readonly controlledBy?: OcrJobActor;
  constructor(from: OcrJobState, to: OcrJobState, controlledBy?: OcrJobActor) {
    const actorPart = controlledBy ? ` by '${controlledBy}'` : "";
    super(`illegal OCR status transition: '${from}' -> '${to}'${actorPart}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
    this.controlledBy = controlledBy;
  }
}

/**
 * Throw if (from -> to) is not a documented edge. Optional `controlledBy`
 * tightens the check to also verify the actor owns the edge.
 */
export function assertValidOcrStatusTransition(
  from: OcrJobState,
  to: OcrJobState,
  controlledBy?: OcrJobActor,
): void {
  // If controlledBy is omitted, accept the edge if any actor owns it.
  if (controlledBy !== undefined) {
    if (!isAllowedTransition(from, to, controlledBy)) {
      throw new IllegalTransitionError(from, to, controlledBy);
    }
    return;
  }
  const actors: OcrJobActor[] = ["queue", "worker", "web_app"];
  for (const a of actors) {
    if (isAllowedTransition(from, to, a)) return;
  }
  throw new IllegalTransitionError(from, to);
}
