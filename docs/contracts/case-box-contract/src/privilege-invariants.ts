// Privilege-marker semantic invariants and the legal-status resolver.
// Pure functions; no IO, no network, no persistence access. See
// docs/adr/case-box-step-3-privilege-marker-model.md.
//
// `PrivilegeResolution` is deliberately shaped so that callers CANNOT
// accidentally treat the resolver's return value as a disclosure clearance.
// There is no `isPrivileged`, `safeToDisclose`, `disclosureClearance`, or
// `notPrivileged` field. The only signal a caller may rely on to assert
// privilege is `hasProtectiveAssertion === true`. A `false` value is NEVER
// a green-light — it means "no protective assertion present", which is
// distinct from "lawyer has cleared this for disclosure". v1 has no
// "cleared for disclosure" state.

import type { CaseBoxPrivilegeMarker } from "./generated/case-box-privilege-marker.js";

export class PrivilegeMarkerCreationError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "PrivilegeMarkerCreationError";
    this.violation = violation;
  }
}

type PrivilegeMarkerCreationInput = {
  status: string;
  source_type: string;
  proposed_at: string | null;
  confirmed_actor_user_id?: string | null;
  confirmed_at?: string | null;
  dismissed_actor_user_id?: string | null;
  dismissed_at?: string | null;
  dismissal_reason?: string | null;
  waiver_actor_user_id?: string | null;
  waived_at?: string | null;
  waiver_reason?: string | null;
};

/**
 * Creation rule: every new marker MUST be created in `proposed` (any source)
 * OR `confirmed` (lawyer-authored only). Machine sources cannot final-mark
 * privilege. Dismissal and waiver fields MUST be null on a new row.
 *
 * Persistence MUST call this before insert; otherwise a caller can defeat
 * no-auto-privilege by inserting a confirmed row with reviewer fields populated.
 */
export function assertValidNewPrivilegeMarker(marker: PrivilegeMarkerCreationInput): void {
  const status = marker.status;
  const source = marker.source_type;

  if (status === "dismissed" || status === "waived") {
    throw new PrivilegeMarkerCreationError(
      `new marker must NOT be created in terminal status ${JSON.stringify(status)} (terminal states are reached via transitions)`,
    );
  }

  if (status !== "proposed" && status !== "confirmed") {
    throw new PrivilegeMarkerCreationError(
      `new marker status must be "proposed" or "confirmed" (got ${JSON.stringify(status)})`,
    );
  }

  if (status === "confirmed" && source !== "lawyer_authored") {
    throw new PrivilegeMarkerCreationError(
      `only lawyer_authored markers may be created directly in "confirmed" (got source_type=${JSON.stringify(source)}) — machine sources MUST start as "proposed" so a lawyer can confirm`,
    );
  }

  const dismissalOffenders: string[] = [];
  if ((marker.dismissed_actor_user_id ?? null) !== null) dismissalOffenders.push("dismissed_actor_user_id");
  if ((marker.dismissed_at ?? null) !== null) dismissalOffenders.push("dismissed_at");
  if ((marker.dismissal_reason ?? null) !== null) dismissalOffenders.push("dismissal_reason");
  if (dismissalOffenders.length > 0) {
    throw new PrivilegeMarkerCreationError(
      `new marker must have null dismissal fields; non-null: ${dismissalOffenders.join(", ")}`,
    );
  }

  const waiverOffenders: string[] = [];
  if ((marker.waiver_actor_user_id ?? null) !== null) waiverOffenders.push("waiver_actor_user_id");
  if ((marker.waived_at ?? null) !== null) waiverOffenders.push("waived_at");
  if ((marker.waiver_reason ?? null) !== null) waiverOffenders.push("waiver_reason");
  if (waiverOffenders.length > 0) {
    throw new PrivilegeMarkerCreationError(
      `new marker must have null waiver fields; non-null: ${waiverOffenders.join(", ")}`,
    );
  }

  if (status === "proposed") {
    const confirmOffenders: string[] = [];
    if ((marker.confirmed_actor_user_id ?? null) !== null) confirmOffenders.push("confirmed_actor_user_id");
    if ((marker.confirmed_at ?? null) !== null) confirmOffenders.push("confirmed_at");
    if (confirmOffenders.length > 0) {
      throw new PrivilegeMarkerCreationError(
        `new "proposed" marker must have null confirmation fields; non-null: ${confirmOffenders.join(", ")}`,
      );
    }
  }

  if (status === "confirmed") {
    if ((marker.confirmed_actor_user_id ?? null) === null) {
      throw new PrivilegeMarkerCreationError(
        `new "confirmed" marker must have non-null confirmed_actor_user_id`,
      );
    }
    if ((marker.confirmed_at ?? null) === null) {
      throw new PrivilegeMarkerCreationError(
        `new "confirmed" marker must have non-null confirmed_at`,
      );
    }
  }

  if ((marker.proposed_at ?? null) === null) {
    throw new PrivilegeMarkerCreationError(`new marker must have non-null proposed_at`);
  }
}

type PrivilegeMarkerTemporalInput = {
  proposed_at: string;
  confirmed_at?: string | null;
  dismissed_at?: string | null;
  waived_at?: string | null;
};

/**
 * Temporal invariants between marker lifecycle timestamps. Persistence
 * may tighten clock-skew rules; this contract-layer check enforces only
 * lifecycle ordering.
 */
export function assertPrivilegeMarkerTimestamps(marker: PrivilegeMarkerTemporalInput): void {
  const proposed = Date.parse(marker.proposed_at);
  if (Number.isNaN(proposed)) {
    throw new PrivilegeMarkerCreationError(`proposed_at is not a parseable date-time: ${JSON.stringify(marker.proposed_at)}`);
  }
  if (marker.confirmed_at !== undefined && marker.confirmed_at !== null) {
    const confirmed = Date.parse(marker.confirmed_at);
    if (Number.isNaN(confirmed)) {
      throw new PrivilegeMarkerCreationError(`confirmed_at is not a parseable date-time: ${JSON.stringify(marker.confirmed_at)}`);
    }
    if (confirmed < proposed) {
      throw new PrivilegeMarkerCreationError(`confirmed_at (${marker.confirmed_at}) must be >= proposed_at (${marker.proposed_at})`);
    }
    if (marker.waived_at !== undefined && marker.waived_at !== null) {
      const waived = Date.parse(marker.waived_at);
      if (Number.isNaN(waived)) {
        throw new PrivilegeMarkerCreationError(`waived_at is not a parseable date-time: ${JSON.stringify(marker.waived_at)}`);
      }
      if (waived < confirmed) {
        throw new PrivilegeMarkerCreationError(`waived_at (${marker.waived_at}) must be >= confirmed_at (${marker.confirmed_at})`);
      }
    }
  }
  if (marker.dismissed_at !== undefined && marker.dismissed_at !== null) {
    const dismissed = Date.parse(marker.dismissed_at);
    if (Number.isNaN(dismissed)) {
      throw new PrivilegeMarkerCreationError(`dismissed_at is not a parseable date-time: ${JSON.stringify(marker.dismissed_at)}`);
    }
    if (dismissed < proposed) {
      throw new PrivilegeMarkerCreationError(`dismissed_at (${marker.dismissed_at}) must be >= proposed_at (${marker.proposed_at})`);
    }
  }
}

export interface PrivilegeResolution {
  /** True iff at least one marker for the target is currently `confirmed`. The ONLY field a caller may rely on to assert privilege. Callers MUST NOT infer disclosure safety from `false`. */
  readonly hasProtectiveAssertion: boolean;
  /** Every currently-confirmed marker. Multiple kinds may apply (attorney-client + work-product). */
  readonly activeConfirmedMarkers: ReadonlyArray<CaseBoxPrivilegeMarker>;
  /** Lifecycle witness — true iff any marker for the target ever reached each state. */
  readonly historyHas: {
    readonly proposed: boolean;
    readonly confirmed: boolean;
    readonly dismissed: boolean;
    readonly waived: boolean;
  };
  /** Every marker for the (target_type, target_id) pair from the input array. */
  readonly allTargetMarkers: ReadonlyArray<CaseBoxPrivilegeMarker>;
}

/**
 * Resolve the privilege status of a target from a marker array. Pure; the
 * caller fetches markers from persistence. The return shape is deliberate:
 * NO `isPrivileged`, `safeToDisclose`, `disclosureClearance`, or
 * `notPrivileged` field exists. Callers MUST check `hasProtectiveAssertion`
 * explicitly and MUST NOT infer disclosure safety from any other field.
 */
export function effectivePrivilegeStatus(
  targetType: "document" | "fact",
  targetId: string,
  markers: ReadonlyArray<CaseBoxPrivilegeMarker>,
): PrivilegeResolution {
  const filtered = markers.filter(
    (m) => m.target_type === targetType && m.target_id === targetId,
  );
  const activeConfirmedMarkers = filtered.filter((m) => m.status === "confirmed");
  const historyHas = {
    proposed: filtered.some(
      (m) => m.status === "proposed" || (m.proposed_at !== null && m.proposed_at !== undefined),
    ),
    confirmed: filtered.some(
      (m) => m.status === "confirmed" || ((m.confirmed_at ?? null) !== null),
    ),
    dismissed: filtered.some((m) => m.status === "dismissed"),
    waived: filtered.some((m) => m.status === "waived"),
  };
  return {
    hasProtectiveAssertion: activeConfirmedMarkers.length > 0,
    activeConfirmedMarkers,
    historyHas,
    allTargetMarkers: filtered,
  };
}

export function isMarkerProtective(marker: { status: string }): boolean {
  return marker.status === "confirmed";
}

export function isMarkerLifecycleTerminal(marker: { status: string }): boolean {
  return marker.status === "dismissed" || marker.status === "waived";
}

const MACHINE_MARKER_SOURCES = new Set(["llm_suggested", "imported"]);

export function isMachineSuggestedMarker(marker: { source_type: string }): boolean {
  return MACHINE_MARKER_SOURCES.has(marker.source_type);
}

export type { CaseBoxPrivilegeMarker };
