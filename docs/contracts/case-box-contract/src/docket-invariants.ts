// Docket-entry semantic invariants + IANA timezone validation + date-only
// resolver. Pure functions; no IO. See
// docs/adr/case-box-step-6-deadline-docketing-rules.md.
//
// Critical design properties:
//  - ALL docket entries start in confirmation_state="proposed". Direct-confirm
//    is forbidden for ALL source types (manual included).
//  - Confirmation safety lives in assertValidDocketEntryConfirmation, which
//    REQUIRES the full entry and rejects date_only confirmation in v1
//    (no jurisdiction/timezone resolver in v1; confirming a date_only entry
//    would silently fabricate a UTC midnight for CaseBoxDeadline.due_at).
//  - The generic assertValidDocketEntryTransition (in transitions.ts) does NOT
//    take an entry. There is NO API path that allows confirmation without the
//    entry, so the date_only check cannot be bypassed.
//  - assertValidIanaTimezone uses Intl.supportedValuesOf("timeZone") (Set-or-
//    Array tolerant) + explicit UTC allowlist + runtime probe for Etc/UTC.
//    A DEPRECATED_TZ_DENYLIST is checked FIRST so America/Buenos_Aires is
//    always rejected even if a future Node ICU adds it.

import { isDeepStrictEqual } from "node:util";
import type { CaseBoxDocketEntry } from "./generated/case-box-docket-entry.js";
import { IllegalTransitionError } from "./transitions.js";
import {
  isAllowedDocketEntryTransition,
  TERMINAL_DOCKET_ENTRY_STATES,
} from "./transitions.js";
import { validateDocketEntry } from "./validateDocketEntry.js";

export class DocketEntryCreationError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "DocketEntryCreationError";
    this.violation = violation;
  }
}

export class DocketEntryConfirmationError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "DocketEntryConfirmationError";
    this.violation = violation;
  }
}

export class InvalidIanaTimezoneError extends Error {
  readonly value: string;
  constructor(value: string) {
    super(`not a valid IANA timezone (v1 strict): ${JSON.stringify(value)}`);
    this.name = "InvalidIanaTimezoneError";
    this.value = value;
  }
}

export class DocketEntryEditError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "DocketEntryEditError";
    this.violation = violation;
  }
}

// ---------------------------------------------------------------------------
// IANA timezone validation — strict, deny-list-first, supportedValuesOf-based
// ---------------------------------------------------------------------------

const DEPRECATED_TZ_DENYLIST: ReadonlySet<string> = new Set([
  // Deprecated alias; canonical is America/Argentina/Buenos_Aires. Always
  // rejected even if a future Node ICU build adds it to supportedValuesOf.
  "America/Buenos_Aires",
]);

function buildAcceptedTimezoneSet(): ReadonlySet<string> {
  const set = new Set<string>();
  // Intl.supportedValuesOf may return Array (Node >=18); wrap in Set for
  // robust membership lookup regardless of return type variation.
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => Iterable<string> })
      .supportedValuesOf?.("timeZone");
    if (supported) {
      for (const tz of supported) set.add(tz);
    }
  } catch {
    // If Intl.supportedValuesOf is unavailable, the allowlist is just UTC + probe.
  }
  // Always allow UTC even if supportedValuesOf omits it on some builds.
  set.add("UTC");
  // One-time probe: if Etc/UTC works in this runtime, accept it.
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat(undefined, { timeZone: "Etc/UTC" });
    set.add("Etc/UTC");
  } catch {
    // Etc/UTC not accepted by runtime; do not add.
  }
  return set;
}

const ACCEPTED_TIMEZONES = buildAcceptedTimezoneSet();

export function assertValidIanaTimezone(tz: string): void {
  if (typeof tz !== "string" || tz.length === 0) {
    throw new InvalidIanaTimezoneError(String(tz));
  }
  if (DEPRECATED_TZ_DENYLIST.has(tz)) {
    throw new InvalidIanaTimezoneError(tz);
  }
  if (!ACCEPTED_TIMEZONES.has(tz)) {
    throw new InvalidIanaTimezoneError(tz);
  }
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export function isDocketEntryProposalOnly(entry: { confirmation_state: string }): boolean {
  return entry.confirmation_state === "proposed";
}

const MACHINE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "llm_extraction",
  "imported",
  "court_order_excerpt",
]);

export function docketEntryWasMachineExtracted(entry: { source_type: string }): boolean {
  return MACHINE_SOURCE_TYPES.has(entry.source_type);
}

export function requiresHumanConfirmation(entry: {
  confirmation_state: string;
  source_type: string;
}): boolean {
  return isDocketEntryProposalOnly(entry) && docketEntryWasMachineExtracted(entry);
}

// ---------------------------------------------------------------------------
// Creation rule
// ---------------------------------------------------------------------------

type CreationInput = {
  confirmation_state: string;
  confirmation_actor_user_id?: string | null;
  confirmed_at?: string | null;
  confirmed_deadline_id?: string | null;
  dismissal_actor_user_id?: string | null;
  dismissed_at?: string | null;
  dismissal_reason?: string | null;
};

/**
 * ALL docket entries MUST be created in confirmation_state="proposed".
 * Direct-confirm is forbidden for every source type. Confirmation happens
 * via a separate transition (Mode B), enforced by
 * assertValidDocketEntryConfirmation.
 */
export function assertValidNewDocketEntry(entry: CreationInput): void {
  if (entry.confirmation_state !== "proposed") {
    throw new DocketEntryCreationError(
      `new docket entry must be created in confirmation_state="proposed" (got ${JSON.stringify(entry.confirmation_state)})`,
    );
  }
  const offenders: string[] = [];
  if ((entry.confirmation_actor_user_id ?? null) !== null) offenders.push("confirmation_actor_user_id");
  if ((entry.confirmed_at ?? null) !== null) offenders.push("confirmed_at");
  if ((entry.confirmed_deadline_id ?? null) !== null) offenders.push("confirmed_deadline_id");
  if ((entry.dismissal_actor_user_id ?? null) !== null) offenders.push("dismissal_actor_user_id");
  if ((entry.dismissed_at ?? null) !== null) offenders.push("dismissed_at");
  if ((entry.dismissal_reason ?? null) !== null) offenders.push("dismissal_reason");
  if (offenders.length > 0) {
    throw new DocketEntryCreationError(
      `new docket entry must have null confirmation + dismissal fields; non-null: ${offenders.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Confirmation rule — REQUIRES the full entry; rejects date_only
// ---------------------------------------------------------------------------

type ConfirmationInput = {
  confirmation_state: string;
  proposed_due_at_kind: string;
};

type CaseBoxActor = "lawyer" | "ingestion" | "coordinator" | "review";

/**
 * Confirmation-specific helper. Mode B (§7) calls THIS, not the generic
 * assertValidDocketEntryTransition. Performs the state-machine check AND
 * the v1 date_only-confirmation prohibition. Entry parameter is REQUIRED;
 * there is NO API path that allows confirmation without the entry.
 */
export function assertValidDocketEntryConfirmation(
  entry: ConfirmationInput,
  controlled_by: CaseBoxActor,
): void {
  // State-machine check (inlined to avoid optional-entry contamination).
  if (TERMINAL_DOCKET_ENTRY_STATES.includes(entry.confirmation_state as "confirmed" | "dismissed")) {
    throw new IllegalTransitionError(
      entry.confirmation_state,
      "confirmed",
      controlled_by,
      `cannot transition from terminal state '${entry.confirmation_state}'`,
    );
  }
  if (entry.confirmation_state !== "proposed") {
    throw new IllegalTransitionError(
      entry.confirmation_state,
      "confirmed",
      controlled_by,
    );
  }
  if (!isAllowedDocketEntryTransition("proposed", "confirmed", controlled_by)) {
    throw new IllegalTransitionError("proposed", "confirmed", controlled_by);
  }
  // v1 critical invariant: date_only confirmation is forbidden.
  if (entry.proposed_due_at_kind === "date_only") {
    throw new DocketEntryConfirmationError(
      `confirming a date_only docket entry is forbidden in v1 (no jurisdiction/timezone resolver). Upgrade to datetime + supply an IANA timezone before confirming.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Edit rule — proposed-only, content-only, provenance/lifecycle immutable
// ---------------------------------------------------------------------------

/**
 * The fields a docket-proposal edit MAY change (docs/adr/docket-proposal-edit.md
 * §3 + the §6 revised_at marker). Every other field is immutable by construction.
 */
const EDITABLE_DOCKET_ENTRY_FIELDS: readonly string[] = [
  "proposed_kind",
  "proposed_due_at",
  "proposed_due_at_kind",
  "proposed_due_at_timezone",
  "proposed_owner_user_id",
  "reminder_offsets",
  "revised_at",
];

// Intrinsics captured at module load so later reassignment of these globals or
// prototype pollution (Object/Array/Set/Number) cannot subvert the persisted-shape
// normalizer below (WI-DPE2-FIX1, Class-A prototype-pollution hardening).
const objectKeys = Object.keys;
const objectCreate = Object.create;
const objectHasOwn = Object.hasOwn;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectProto = Object.prototype;
const arrayIsArray = Array.isArray;
const numberIsFinite = Number.isFinite;

// Null-prototype editable-field lookup, built once at module load (Array.prototype is
// pristine here, before any caller runs). Membership is tested at call time with the
// captured objectHasOwn — a direct intrinsic invocation with NO `.call`/`.has` method
// lookup, so Function.prototype.call / Set.prototype.has pollution cannot subvert it
// (WI-DPE2-FIX1 audit High).
const EDITABLE_DOCKET_ENTRY_FIELD_LOOKUP: Record<string, true> = objectCreate(null);
for (const field of EDITABLE_DOCKET_ENTRY_FIELDS) {
  EDITABLE_DOCKET_ENTRY_FIELD_LOOKUP[field] = true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = objectGetPrototypeOf(value);
  return proto === objectProto || proto === null;
}

/**
 * Reduce a value to the shape JSON persistence (payload_json) would store: own-
 * enumerable JSON-primitive data, recursively, using ONLY captured intrinsics — it
 * never invokes toJSON, an instance `.map`, the Array iterator, or the `__proto__`
 * setter. Inherited, non-enumerable, and non-JSON values are dropped at every level
 * (top-level fields AND nested reminder_offsets items alike). Normalized records use
 * a null prototype so an own "__proto__" data key cannot trigger the legacy setter.
 * (WI-DPE2-FIX1 — see the assertValidDocketEntryEdit precondition for the threat-model
 * boundary: this defends prototype pollution on JSON-origin data, not live getters /
 * Proxies, which are a caller-contract violation.)
 */
function persistedShape(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") return numberIsFinite(value) ? value : undefined;
  if (arrayIsArray(value)) {
    const arr = value as unknown[];
    const out: unknown[] = [];
    const len = arr.length;
    for (let i = 0; i < len; i += 1) {
      // JSON array semantics: a hole or a non-JSON element serializes as null.
      const pv = objectHasOwn(arr, i) ? persistedShape(arr[i]) : null;
      out[i] = pv === undefined ? null : pv;
    }
    return out;
  }
  if (t === "object") {
    if (!isPlainRecord(value)) return undefined;
    const src = value;
    const out: Record<string, unknown> = objectCreate(null);
    const keys = objectKeys(src);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i] as string;
      const nv = persistedShape(src[key]);
      if (nv !== undefined) out[key] = nv;
    }
    return out;
  }
  return undefined;
}

/**
 * Content-integrity invariant for editing a docket-entry proposal (ADR §2/§3/§4).
 * NOT an authority-boundary sanitizer: revised_at is editable here, so a caller-
 * supplied timestamp is not rejected — DPE3/DPE4 derive revised_at server-side and
 * ignore client-supplied values (ADR §6 + the DPE2 plan Medium resolution).
 *
 * PRECONDITION: `prior` and `revised` MUST be plain JSON-origin data — e.g. the output
 * of JSON.parse or a structured clone: plain objects/arrays of strings, finite numbers,
 * booleans, and null. Live accessors (getters), custom prototypes, and Proxies are a
 * CALLER-CONTRACT VIOLATION and are NOT defended here: this is a content-integrity
 * invariant, not a hostile-object membrane. DPE3/DPE4 MUST pass deserialized/plain DTO
 * records (and derive revised_at server-side). The hardening below defends against
 * prototype pollution of Object/Array/Set on such JSON-origin data (WI-DPE2-FIX1);
 * fully closing live-getter TOCTOU / Proxy concerns would require a different API
 * (returning the validated snapshot) and is deferred to a separate WI.
 *
 * Enforcement, in order:
 *  (a) Only a "proposed" entry may be edited. A confirmed/dismissed prior throws
 *      IllegalTransitionError (the terminal-state rejection mirrors confirm/dismiss),
 *      NOT DocketEntryEditError.
 *  (b) Both sides are reduced to their persisted (own-enumerable JSON) shape via
 *      persistedShape; every key outside EDITABLE must be deeply equal across those
 *      shapes (node:util.isDeepStrictEqual). This keeps ALL provenance/identity/
 *      lifecycle/confirmation+dismissal fields immutable by construction, including
 *      future-added schema fields; a key present on only one side outside EDITABLE is
 *      a violation. Reducing to the persisted shape first means an inherited, non-
 *      enumerable, or non-JSON value cannot mask a missing required field.
 *  (c) The revised persisted shape must itself be schema-valid (ADR §4).
 */
export function assertValidDocketEntryEdit(
  prior: CaseBoxDocketEntry,
  revised: CaseBoxDocketEntry,
): void {
  if (!isPlainRecord(prior) || !isPlainRecord(revised)) {
    throw new DocketEntryEditError(
      "docket entry edit requires plain prior/revised objects (own properties only)",
    );
  }
  // (a) proposed-only — read the RAW prior so a non-proposed prior throws FIRST.
  if (prior.confirmation_state !== "proposed") {
    throw new IllegalTransitionError(prior.confirmation_state, "proposed", "edit");
  }
  // Reduce both sides to the persisted own-enumerable JSON shape (intrinsics-only).
  let priorOwn: unknown;
  let revisedOwn: unknown;
  try {
    priorOwn = persistedShape(prior);
    revisedOwn = persistedShape(revised);
  } catch {
    throw new DocketEntryEditError(
      "docket entry edit: prior/revised is not a normalizable JSON shape",
    );
  }
  if (!isPlainRecord(priorOwn) || !isPlainRecord(revisedOwn)) {
    throw new DocketEntryEditError(
      "docket entry edit: prior/revised did not normalize to a plain record",
    );
  }
  const pOwn = priorOwn;
  const rOwn = revisedOwn;
  // (b) Every key outside EDITABLE must be deeply equal across the persisted shapes.
  // Iterate the union with index loops + captured intrinsics (no Set/Array iterator,
  // no Set.prototype.has lookup) so prototype pollution cannot subvert membership.
  const checked: Record<string, true> = objectCreate(null);
  const checkKey = (key: string): void => {
    if (objectHasOwn(checked, key)) return;
    checked[key] = true;
    if (objectHasOwn(EDITABLE_DOCKET_ENTRY_FIELD_LOOKUP, key)) return;
    if (!isDeepStrictEqual(pOwn[key], rOwn[key])) {
      throw new DocketEntryEditError(
        `docket entry edit may not change immutable field ${JSON.stringify(key)}`,
      );
    }
  };
  const priorKeys = objectKeys(pOwn);
  for (let i = 0; i < priorKeys.length; i += 1) checkKey(priorKeys[i] as string);
  const revisedKeys = objectKeys(rOwn);
  for (let i = 0; i < revisedKeys.length; i += 1) checkKey(revisedKeys[i] as string);
  // (c) The revised persisted shape must itself be schema-valid (ADR §4).
  const result = validateDocketEntry(rOwn);
  if (!result.ok) {
    throw new DocketEntryEditError(
      `revised docket entry is not schema-valid: ${result.summary}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Date-only / datetime interpretation
// ---------------------------------------------------------------------------

export type DocketEntryDueAtInterpretation =
  | { kind: "datetime"; instant: string; timezone: string }
  | { kind: "date_only"; calendarDate: string; jurisdictionHint: string | null };

/**
 * Interpret the docket entry's proposed_due_at. For datetime kind, asserts
 * the timezone is a valid IANA zone (throws InvalidIanaTimezoneError if not).
 * For date_only kind, returns the calendar date without converting to a
 * datetime instant — callers MUST NOT silently treat date_only as UTC midnight.
 */
export function interpretDocketEntryDueAt(
  entry: {
    proposed_due_at: string;
    proposed_due_at_kind: string;
    proposed_due_at_timezone: string | null;
  },
  options?: { jurisdictionHint?: string },
): DocketEntryDueAtInterpretation {
  if (entry.proposed_due_at_kind === "datetime") {
    if (entry.proposed_due_at_timezone === null || entry.proposed_due_at_timezone === undefined) {
      throw new InvalidIanaTimezoneError("(null timezone with datetime kind)");
    }
    assertValidIanaTimezone(entry.proposed_due_at_timezone);
    return {
      kind: "datetime",
      instant: entry.proposed_due_at,
      timezone: entry.proposed_due_at_timezone,
    };
  }
  if (entry.proposed_due_at_kind === "date_only") {
    // Extract calendar date portion (YYYY-MM-DD) from the ISO string.
    const datePart = entry.proposed_due_at.slice(0, 10);
    return {
      kind: "date_only",
      calendarDate: datePart,
      jurisdictionHint: options?.jurisdictionHint ?? null,
    };
  }
  throw new Error(`unrecognized proposed_due_at_kind: ${JSON.stringify(entry.proposed_due_at_kind)}`);
}

export type { CaseBoxDocketEntry };
