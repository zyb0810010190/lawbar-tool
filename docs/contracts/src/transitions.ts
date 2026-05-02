// Status transition rules from docs/contracts/ocr-worker-contract.md §3.
// Source of truth for allowed (from -> to) edges and the actor that owns each.
//
// The schema validates the *shape* of a transition record; this module
// validates the *semantics* (which edges are legal and who controls them).

export type OcrJobState =
  | "queued"
  | "claimed"
  | "processing"
  | "succeeded"
  | "failed"
  | "partial_succeeded"
  | "cancelled"
  | "dead_lettered";

export type OcrJobActor = "queue" | "worker" | "web_app";

export const STATES: readonly OcrJobState[] = [
  "queued",
  "claimed",
  "processing",
  "succeeded",
  "failed",
  "partial_succeeded",
  "cancelled",
  "dead_lettered",
] as const;

// TERMINAL_STATES is exported as a deep-frozen array, not a Set. `Set` cannot be
// made runtime-immutable in Node — `Object.freeze(set)` does not block `.add()`
// — and a tampered Set would corrupt transition validation process-wide.
// Lookups go through `isTerminalState`, which is the only sanctioned API.
export const TERMINAL_STATES: readonly OcrJobState[] = Object.freeze([
  "succeeded",
  "partial_succeeded",
  "cancelled",
  "dead_lettered",
] as const);

/** True iff `state` is a documented terminal state. Hides the array so the
 *  internal data structure can change without breaking consumers. */
export function isTerminalState(state: OcrJobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export interface AllowedEdge {
  from: OcrJobState;
  to: OcrJobState;
  by: readonly OcrJobActor[];
  reason?: string;
}

const baseEdges: AllowedEdge[] = [
  { from: "queued",     to: "claimed",           by: ["queue"] },
  { from: "claimed",    to: "processing",        by: ["worker"] },
  { from: "claimed",    to: "queued",            by: ["queue"], reason: "lease expired / worker crash" },
  { from: "processing", to: "succeeded",         by: ["worker"] },
  { from: "processing", to: "failed",            by: ["worker"] },
  { from: "processing", to: "partial_succeeded", by: ["worker"] },
  { from: "failed",     to: "queued",            by: ["queue"], reason: "retry, attempt < max_attempts and is_transient" },
  { from: "failed",     to: "dead_lettered",     by: ["queue"], reason: "exhausted retries OR permanent failure" },
];

// web_app cancel: from any non-terminal state -> cancelled.
for (const s of STATES) {
  if (!isTerminalState(s)) {
    baseEdges.push({ from: s, to: "cancelled", by: ["web_app"] });
  }
}

// Freeze deeply: the array, each edge object, and each `by` actor list.
// `readonly` is a TS-only annotation and doesn't prevent runtime mutation;
// a consumer assigning into ALLOWED_EDGES would corrupt transition semantics
// process-wide, so we make it actually immutable.
export const ALLOWED_EDGES: readonly AllowedEdge[] = Object.freeze(
  baseEdges.map((e) => Object.freeze({ ...e, by: Object.freeze([...e.by]) })),
);

export function isAllowedTransition(
  from: OcrJobState,
  to: OcrJobState,
  controlledBy: OcrJobActor,
): boolean {
  return ALLOWED_EDGES.some(
    (e) => e.from === from && e.to === to && e.by.includes(controlledBy),
  );
}

export interface TransitionRecord {
  from: OcrJobState;
  to: OcrJobState;
  controlled_by: OcrJobActor;
  at: string;
  note?: string;
}

export type TransitionSequenceResult =
  | { ok: true }
  | { ok: false; error: string; index: number };

/** Validate a sequence of transitions for a single job. */
export function validateTransitionSequence(
  transitions: readonly TransitionRecord[],
): TransitionSequenceResult {
  if (!Array.isArray(transitions) || transitions.length === 0) {
    return { ok: false, error: "empty transitions", index: -1 };
  }

  let priorTo: OcrJobState | null = null;
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i]!;

    if (priorTo !== null && t.from !== priorTo) {
      return {
        ok: false,
        error: `transition[${i}].from='${t.from}' does not chain from prior to='${priorTo}'`,
        index: i,
      };
    }
    if (isTerminalState(t.from)) {
      return {
        ok: false,
        error: `transition[${i}] starts from terminal state '${t.from}'`,
        index: i,
      };
    }
    if (!isAllowedTransition(t.from, t.to, t.controlled_by)) {
      return {
        ok: false,
        error: `transition[${i}] '${t.from}' -> '${t.to}' by '${t.controlled_by}' is not allowed`,
        index: i,
      };
    }
    priorTo = t.to;
  }

  return { ok: true };
}
