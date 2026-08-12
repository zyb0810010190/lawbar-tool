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
// Docket-entry lifecycle (Step 6)
// ---------------------------------------------------------------------------

export type DocketEntryState = "proposed" | "confirmed" | "dismissed";

export const DOCKET_ENTRY_STATES: readonly DocketEntryState[] = Object.freeze([
  "proposed",
  "confirmed",
  "dismissed",
] as const);

// Confirmed AND dismissed are terminal. Confirmed materializes a CaseBoxDeadline
// (Step-1 entity) and the docket entry stays immutable post-confirmation;
// "this deadline didn't apply" is expressed by transitioning the CaseBoxDeadline
// itself to status=withdrawn (existing Step-1 enum) — not the docket entry.
export const TERMINAL_DOCKET_ENTRY_STATES: readonly DocketEntryState[] = Object.freeze([
  "confirmed",
  "dismissed",
] as const);

export function isTerminalDocketEntryState(state: DocketEntryState): boolean {
  return TERMINAL_DOCKET_ENTRY_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Privilege-marker lifecycle
// ---------------------------------------------------------------------------

export type PrivilegeMarkerState = "proposed" | "confirmed" | "dismissed" | "waived";

export const PRIVILEGE_MARKER_STATES: readonly PrivilegeMarkerState[] = Object.freeze([
  "proposed",
  "confirmed",
  "dismissed",
  "waived",
] as const);

// dismissed and waived are terminal. Once dismissed or waived, the marker
// stays in that state; a new marker on the same target is a new row.
export const TERMINAL_PRIVILEGE_MARKER_STATES: readonly PrivilegeMarkerState[] = Object.freeze([
  "dismissed",
  "waived",
] as const);

export function isTerminalPrivilegeMarkerState(state: PrivilegeMarkerState): boolean {
  return TERMINAL_PRIVILEGE_MARKER_STATES.includes(state);
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

// Docket-entry edges (Step 6). proposed→confirmed is the only promotion path
// (load-bearing for no-auto-confirm). proposed→dismissed requires a non-empty
// reason. Confirmation is owned by the confirmation-specific helper
// assertValidDocketEntryConfirmation (in docket-invariants.ts), which REQUIRES
// the full entry and rejects date_only confirmation in v1. The generic
// assertValidDocketEntryTransition here does NOT take an entry.
export const ALLOWED_DOCKET_ENTRY_EDGES: readonly AllowedEdge<DocketEntryState>[] = freezeEdges<DocketEntryState>([
  { from: "proposed", to: "confirmed", by: ["lawyer"], note: "lawyer affirmation — call assertValidDocketEntryConfirmation for date_only safety" },
  { from: "proposed", to: "dismissed", by: ["lawyer"], reason_required: true, note: "lawyer rejected the proposed deadline; reason required for legal trail" },
]);

// Privilege-marker edges. proposed→confirmed is the only promotion path
// (load-bearing for no-auto-privilege); proposed→dismissed and confirmed→
// waived both REQUIRE a non-empty reason (legal-trail invariants).
export const ALLOWED_PRIVILEGE_MARKER_EDGES: readonly AllowedEdge<PrivilegeMarkerState>[] = freezeEdges<PrivilegeMarkerState>([
  { from: "proposed",  to: "confirmed", by: ["lawyer"], note: "promotion to protective status — load-bearing for no-auto-privilege" },
  { from: "proposed",  to: "dismissed", by: ["lawyer"], reason_required: true, note: "dismissal reason required for legal trail" },
  { from: "confirmed", to: "waived",    by: ["lawyer"], reason_required: true, note: "waiver reason required; waiver is one-way" },
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

export function isAllowedPrivilegeMarkerTransition(
  from: PrivilegeMarkerState,
  to: PrivilegeMarkerState,
  controlled_by: CaseBoxActor,
): boolean {
  return isAllowed(ALLOWED_PRIVILEGE_MARKER_EDGES, from, to, controlled_by);
}

export function isAllowedDocketEntryTransition(
  from: DocketEntryState,
  to: DocketEntryState,
  controlled_by: CaseBoxActor,
): boolean {
  return isAllowed(ALLOWED_DOCKET_ENTRY_EDGES, from, to, controlled_by);
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

// ---------------------------------------------------------------------------
// The assertValid*Transition family
// ---------------------------------------------------------------------------

/**
 * Shared contract for the seven `assertValid*Transition` functions below. All
 * seven THROW `IllegalTransitionError` and return nothing — there is no result
 * to inspect, so a call whose return value is discarded still enforces.
 *
 * Each applies three checks in order: `from` must not be a terminal state for
 * that entity; `from === to` is always rejected; and the full
 * (from, to, controlled_by) triple must appear in that entity's
 * `ALLOWED_*_EDGES` table.
 *
 * `controlled_by` is the load-bearing parameter and the reason a legal-looking
 * edge can still throw. Every edge in every table names exactly ONE owning
 * actor, so the same (from, to) pair is legal for its owner and illegal for
 * everyone else. Only `ALLOWED_DOCUMENT_EDGES` grants a non-lawyer anything —
 * `ingestion` may take a document registered → ocr_pending, `coordinator` may
 * take it ocr_pending → ocr_complete | ocr_failed. Every promotion into a
 * lawyer-owned state (document → triaged, fact → reviewed | accepted, evidence
 * → accepted, docket entry → confirmed, privilege marker → confirmed | waived)
 * is `by: ["lawyer"]`. That is the mechanism preventing the ingestion pipeline
 * from promoting its own output: passing `"ingestion"` for a lawyer edge throws
 * exactly as an undefined edge would. The `review` actor owns no edge in any
 * table and can therefore transition nothing.
 *
 * Reason enforcement exists only in the three functions whose signature carries
 * a `reason` parameter — deadline, privilege marker, docket entry — which are
 * exactly the three tables declaring `reason_required`. The matter, document,
 * evidence and fact asserts accept no reason at all, so adding a
 * `reason_required` edge to one of those tables would NOT be enforced. The
 * lookup matches on (from, to) and ignores the actor.
 */
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

/** See the family contract on `assertValidMatterTransition`. */
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

/** See the family contract on `assertValidMatterTransition`. */
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

/** See the family contract on `assertValidMatterTransition`. Reason-enforcing. */
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

/** See the family contract on `assertValidMatterTransition`. */
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

/** See the family contract on `assertValidMatterTransition`. Reason-enforcing. */
export function assertValidPrivilegeMarkerTransition(
  from: PrivilegeMarkerState,
  to: PrivilegeMarkerState,
  controlled_by: CaseBoxActor,
  reason?: string,
): void {
  assertNonTerminal(TERMINAL_PRIVILEGE_MARKER_STATES, from, to, controlled_by);
  if (from === to) {
    throw new IllegalTransitionError(from, to, controlled_by, "self-transition rejected");
  }
  if (!isAllowedPrivilegeMarkerTransition(from, to, controlled_by)) {
    throw new IllegalTransitionError(from, to, controlled_by);
  }
  if (edgeRequiresReason(ALLOWED_PRIVILEGE_MARKER_EDGES, from, to)) {
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

// Generic state-machine transition for docket entries. Date_only confirmation
// safety is owned by assertValidDocketEntryConfirmation in docket-invariants.ts;
// callers performing a confirmation MUST use that helper, not this one.
/** See the family contract on `assertValidMatterTransition`. Reason-enforcing. */
export function assertValidDocketEntryTransition(
  from: DocketEntryState,
  to: DocketEntryState,
  controlled_by: CaseBoxActor,
  reason?: string,
): void {
  assertNonTerminal(TERMINAL_DOCKET_ENTRY_STATES, from, to, controlled_by);
  if (from === to) {
    throw new IllegalTransitionError(from, to, controlled_by, "self-transition rejected");
  }
  if (!isAllowedDocketEntryTransition(from, to, controlled_by)) {
    throw new IllegalTransitionError(from, to, controlled_by);
  }
  if (edgeRequiresReason(ALLOWED_DOCKET_ENTRY_EDGES, from, to)) {
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
