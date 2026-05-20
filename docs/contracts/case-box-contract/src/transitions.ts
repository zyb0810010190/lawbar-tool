// State machines for the four v1 case-box lifecycles. Source of truth for legal
// (from, to) edges and the actor that owns each.
//
// The schemas validate the *shape* of each entity. This module validates the
// *semantics* (which transitions are legal, who controls them, and which
// transitions require a reason). Mirrors the posture of
// ../../src/transitions.ts in the OCR contract.

export type CaseBoxActor = "lawyer" | "ingestion" | "coordinator" | "review";

// ---------------------------------------------------------------------------
// Matter lifecycle
// ---------------------------------------------------------------------------

export type MatterState = "active" | "archived";

export const MATTER_STATES: readonly MatterState[] = Object.freeze([
  "active",
  "archived",
] as const);

// Archive is terminal-but-reversible per docs/adr/case-box-step-0-boundary.md.
// Modeled as zero truly-terminal states: unarchive is allowed.
export const TERMINAL_MATTER_STATES: readonly MatterState[] = Object.freeze([] as const);

export function isTerminalMatterState(state: MatterState): boolean {
  return TERMINAL_MATTER_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Document lifecycle
// ---------------------------------------------------------------------------

export type DocumentState =
  | "registered"
  | "ocr_pending"
  | "ocr_complete"
  | "ocr_failed"
  | "triaged"
  | "tagged"
  | "reviewed";

export const DOCUMENT_STATES: readonly DocumentState[] = Object.freeze([
  "registered",
  "ocr_pending",
  "ocr_complete",
  "ocr_failed",
  "triaged",
  "tagged",
  "reviewed",
] as const);

// Reviewed is functionally end-state in v1 but not contractually terminal:
// re-review may be added in a later step. Step 1 records no terminals.
export const TERMINAL_DOCUMENT_STATES: readonly DocumentState[] = Object.freeze([] as const);

export function isTerminalDocumentState(state: DocumentState): boolean {
  return TERMINAL_DOCUMENT_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Evidence lifecycle
// ---------------------------------------------------------------------------

export type EvidenceState = "proposed" | "accepted" | "rejected" | "superseded";

export const EVIDENCE_STATES: readonly EvidenceState[] = Object.freeze([
  "proposed",
  "accepted",
  "rejected",
  "superseded",
] as const);

// Rejected and superseded are terminal in v1. Accepted is NOT terminal —
// accepted evidence can be superseded later.
export const TERMINAL_EVIDENCE_STATES: readonly EvidenceState[] = Object.freeze([
  "rejected",
  "superseded",
] as const);

export function isTerminalEvidenceState(state: EvidenceState): boolean {
  return TERMINAL_EVIDENCE_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Fact lifecycle
// ---------------------------------------------------------------------------

export type FactState = "candidate" | "reviewed" | "accepted" | "rejected";

export const FACT_STATES: readonly FactState[] = Object.freeze([
  "candidate",
  "reviewed",
  "accepted",
  "rejected",
] as const);

// Accepted and rejected are terminal. Supersession is a relationship between
// rows (a new accepted fact's `supersedes_fact_id` points to an old accepted
// fact), NOT a row-level state. See case-box-step-2 ADR §3.
export const TERMINAL_FACT_STATES: readonly FactState[] = Object.freeze([
  "accepted",
  "rejected",
] as const);

export function isTerminalFactState(state: FactState): boolean {
  return TERMINAL_FACT_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Deadline lifecycle
// ---------------------------------------------------------------------------

export type DeadlineState = "pending" | "met" | "missed" | "withdrawn";

export const DEADLINE_STATES: readonly DeadlineState[] = Object.freeze([
  "pending",
  "met",
  "missed",
  "withdrawn",
] as const);

// Withdrawn is terminal in v1. Met / missed are NOT terminal because the
// canonical missed→met transition exists with a required reason.
export const TERMINAL_DEADLINE_STATES: readonly DeadlineState[] = Object.freeze([
  "withdrawn",
] as const);

export function isTerminalDeadlineState(state: DeadlineState): boolean {
  return TERMINAL_DEADLINE_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Edge tables
// ---------------------------------------------------------------------------

export interface AllowedEdge<S extends string> {
  from: S;
  to: S;
  by: readonly CaseBoxActor[];
  /** When true the transition MUST carry a non-empty `reason` string. */
  reason_required?: boolean;
  /** Short human-readable annotation. */
  note?: string;
}

function freezeEdges<S extends string>(edges: AllowedEdge<S>[]): readonly AllowedEdge<S>[] {
  return Object.freeze(edges.map((e) => Object.freeze({ ...e, by: Object.freeze([...e.by]) })));
}

export const ALLOWED_MATTER_EDGES: readonly AllowedEdge<MatterState>[] = freezeEdges<MatterState>([
  { from: "active",   to: "archived", by: ["lawyer"] },
  { from: "archived", to: "active",   by: ["lawyer"], note: "unarchive — archive is terminal-but-reversible" },
]);

export const ALLOWED_DOCUMENT_EDGES: readonly AllowedEdge<DocumentState>[] = freezeEdges<DocumentState>([
  { from: "registered",   to: "ocr_pending",  by: ["ingestion"] },
  { from: "registered",   to: "triaged",      by: ["lawyer"], note: "skip-OCR fast path for native-text docs" },
  { from: "ocr_pending",  to: "ocr_complete", by: ["coordinator"] },
  { from: "ocr_pending",  to: "ocr_failed",   by: ["coordinator"] },
  { from: "ocr_complete", to: "triaged",      by: ["lawyer"] },
  { from: "ocr_failed",   to: "triaged",      by: ["lawyer"], note: "lawyer triages even after OCR failure" },
  { from: "triaged",      to: "tagged",       by: ["lawyer"] },
  { from: "tagged",       to: "reviewed",     by: ["lawyer"] },
]);

export const ALLOWED_EVIDENCE_EDGES: readonly AllowedEdge<EvidenceState>[] = freezeEdges<EvidenceState>([
  { from: "proposed", to: "accepted",   by: ["lawyer"] },
  { from: "proposed", to: "rejected",   by: ["lawyer"] },
  { from: "accepted", to: "superseded", by: ["lawyer"], note: "supersedes_evidence_id required" },
]);

// Fact promotion edges. `candidate → accepted` is intentionally absent: it
// would defeat no-auto-accept. Every promotion edge is `by: ["lawyer"]`;
// coordinator / ingestion / review cannot promote a fact. Accepted is
// terminal at the state-machine layer; replacement happens via a new row
// whose `supersedes_fact_id` points to the old accepted row.
export const ALLOWED_FACT_EDGES: readonly AllowedEdge<FactState>[] = freezeEdges<FactState>([
  { from: "candidate", to: "reviewed", by: ["lawyer"] },
  { from: "candidate", to: "rejected", by: ["lawyer"], note: "shortcut: reject without intermediate review" },
  { from: "reviewed",  to: "accepted", by: ["lawyer"], note: "promotion to SoT — load-bearing for no-auto-accept" },
  { from: "reviewed",  to: "rejected", by: ["lawyer"] },
]);

export const ALLOWED_DEADLINE_EDGES: readonly AllowedEdge<DeadlineState>[] = freezeEdges<DeadlineState>([
  { from: "pending", to: "met",       by: ["lawyer"] },
  { from: "pending", to: "missed",    by: ["lawyer"] },
  { from: "pending", to: "withdrawn", by: ["lawyer"] },
  { from: "missed",  to: "met",       by: ["lawyer"], reason_required: true, note: "missed → met requires audit reason" },
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class IllegalTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  readonly controlled_by: string;
  constructor(from: string, to: string, controlled_by: string, message?: string) {
    super(message ?? `illegal transition '${from}' -> '${to}' by '${controlled_by}'`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
    this.controlled_by = controlled_by;
  }
}

export class OcrSubordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrSubordinationError";
  }
}

// ---------------------------------------------------------------------------
// Predicates + asserts
// ---------------------------------------------------------------------------

function isAllowed<S extends string>(
  edges: readonly AllowedEdge<S>[],
  from: S,
  to: S,
  controlled_by: CaseBoxActor,
): boolean {
  return edges.some((e) => e.from === from && e.to === to && e.by.includes(controlled_by));
}

function edgeRequiresReason<S extends string>(
  edges: readonly AllowedEdge<S>[],
  from: S,
  to: S,
): boolean {
  const edge = edges.find((e) => e.from === from && e.to === to);
  return edge?.reason_required === true;
}

export function isAllowedMatterTransition(
  from: MatterState,
  to: MatterState,
  controlled_by: CaseBoxActor,
): boolean {
  return isAllowed(ALLOWED_MATTER_EDGES, from, to, controlled_by);
}

export function isAllowedDocumentTransition(
  from: DocumentState,
  to: DocumentState,
  controlled_by: CaseBoxActor,
): boolean {
  return isAllowed(ALLOWED_DOCUMENT_EDGES, from, to, controlled_by);
}

export function isAllowedEvidenceTransition(
  from: EvidenceState,
  to: EvidenceState,
  controlled_by: CaseBoxActor,
): boolean {
  return isAllowed(ALLOWED_EVIDENCE_EDGES, from, to, controlled_by);
}

export function isAllowedDeadlineTransition(
  from: DeadlineState,
  to: DeadlineState,
  controlled_by: CaseBoxActor,
): boolean {
  return isAllowed(ALLOWED_DEADLINE_EDGES, from, to, controlled_by);
}

export function isAllowedFactTransition(
  from: FactState,
  to: FactState,
  controlled_by: CaseBoxActor,
): boolean {
  return isAllowed(ALLOWED_FACT_EDGES, from, to, controlled_by);
}

function assertNonTerminal<S extends string>(
  terminals: readonly S[],
  from: S,
  to: S,
  controlled_by: CaseBoxActor,
): void {
  if (terminals.includes(from)) {
    throw new IllegalTransitionError(from, to, controlled_by, `cannot transition from terminal state '${from}'`);
  }
}

export function assertValidMatterTransition(
  from: MatterState,
  to: MatterState,
  controlled_by: CaseBoxActor,
): void {
  assertNonTerminal(TERMINAL_MATTER_STATES, from, to, controlled_by);
  if (from === to) {
    throw new IllegalTransitionError(from, to, controlled_by, "self-transition rejected");
  }
  if (!isAllowedMatterTransition(from, to, controlled_by)) {
    throw new IllegalTransitionError(from, to, controlled_by);
  }
}

export function assertValidDocumentTransition(
  from: DocumentState,
  to: DocumentState,
  controlled_by: CaseBoxActor,
): void {
  assertNonTerminal(TERMINAL_DOCUMENT_STATES, from, to, controlled_by);
  if (from === to) {
    throw new IllegalTransitionError(from, to, controlled_by, "self-transition rejected");
  }
  if (!isAllowedDocumentTransition(from, to, controlled_by)) {
    throw new IllegalTransitionError(from, to, controlled_by);
  }
}

export function assertValidEvidenceTransition(
  from: EvidenceState,
  to: EvidenceState,
  controlled_by: CaseBoxActor,
): void {
  assertNonTerminal(TERMINAL_EVIDENCE_STATES, from, to, controlled_by);
  if (from === to) {
    throw new IllegalTransitionError(from, to, controlled_by, "self-transition rejected");
  }
  if (!isAllowedEvidenceTransition(from, to, controlled_by)) {
    throw new IllegalTransitionError(from, to, controlled_by);
  }
}

export function assertValidDeadlineTransition(
  from: DeadlineState,
  to: DeadlineState,
  controlled_by: CaseBoxActor,
  reason?: string,
): void {
  assertNonTerminal(TERMINAL_DEADLINE_STATES, from, to, controlled_by);
  if (from === to) {
    throw new IllegalTransitionError(from, to, controlled_by, "self-transition rejected");
  }
  if (!isAllowedDeadlineTransition(from, to, controlled_by)) {
    throw new IllegalTransitionError(from, to, controlled_by);
  }
  if (edgeRequiresReason(ALLOWED_DEADLINE_EDGES, from, to)) {
    if (typeof reason !== "string" || reason.length === 0) {
      throw new IllegalTransitionError(
        from,
        to,
        controlled_by,
        `transition '${from}' -> '${to}' requires a non-empty reason`,
      );
    }
  }
}

export function assertValidFactTransition(
  from: FactState,
  to: FactState,
  controlled_by: CaseBoxActor,
): void {
  assertNonTerminal(TERMINAL_FACT_STATES, from, to, controlled_by);
  if (from === to) {
    throw new IllegalTransitionError(from, to, controlled_by, "self-transition rejected");
  }
  if (!isAllowedFactTransition(from, to, controlled_by)) {
    throw new IllegalTransitionError(from, to, controlled_by);
  }
}
