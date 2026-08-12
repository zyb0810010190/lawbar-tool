// Audit-log helpers over the existing CaseBoxAuditEvent schema.
// See docs/adr/case-box-step-4-audit-log-shape.md.
//
// Two enforcement layers cooperate:
//   1. Schema (Step-4 tiny additive change): additionalProperties: false + entity_type enum.
//   2. TS helpers here: rich event vocabulary, reason-required ceiling,
//      canonical hash input (incl. timestamp+id), chain verifier with required hash fn.
//
// Persistence MUST:
//   - emit events via buildCaseBoxAuditEvent
//   - stamp timestamps via new Date().toISOString() (normalization)
//   - run verifyAuditChain at export time with a valid eventHashFn
//   - capture headHash into an external manifest for v1 tamper-detection anchor
//
// The v1 limitation: in-row chain alone does not detect full-chain rewrites.
// External anchor required.

import { ajv, type AjvErrorObject } from "./ajv-instance.js";
import { auditEventSchema } from "./loadSchemas.js";
import { summarizeErrors, type ValidationResult } from "./result-types.js";
import type { CaseBoxAuditEvent } from "./generated/case-box-audit-event.js";
import { validateAuditEvent } from "./validateAuditEvent.js";

// ---------------------------------------------------------------------------
// Entity-type vocabulary
// ---------------------------------------------------------------------------

export const CASE_BOX_AUDIT_ENTITY_TYPES = Object.freeze([
  "matter",
  "document",
  "deadline",
  "evidence_item",
  "ocr_link",
  "fact",
  "privilege_marker",
  "confidentiality_classification",
  "docket_entry",
  "link",
  "claim_track",
  "evidence_preparation",
  "cross_examination_opinion",
  "legal_opinion_card",
] as const);

export type CaseBoxAuditEntityType = (typeof CASE_BOX_AUDIT_ENTITY_TYPES)[number];

export function isKnownAuditEntityType(value: string): value is CaseBoxAuditEntityType {
  return (CASE_BOX_AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Rich event vocabulary mapped onto existing schema actions
// ---------------------------------------------------------------------------

type AuditAction =
  | "create"
  | "update"
  | "delete-soft"
  | "access"
  | "export"
  | "print"
  | "share"
  | "privilege-waive"
  | "delete-hard";

interface AuditKindMeta {
  readonly action: AuditAction;
  readonly entity_type: CaseBoxAuditEntityType;
  readonly reasonRequired: boolean;
}

/**
 * The frozen audit vocabulary. A key's NAME is not a label — for v2 events both
 * `event_kind` and `audit_schema_version` are fields of the canonical hash
 * input, so the name is part of what every stored event's hash commits to, and
 * `verifyAuditChain` additionally re-checks that a stored kind's declared
 * `{action, entity_type, reasonRequired}` still matches the event it is on.
 *
 * ADDING a key is additive-safe: no existing event's canonical bytes change.
 * The JSON-Schema `event_kind` enum must be extended in the same commit, or
 * `validateAuditEvent` rejects every event carrying the new kind.
 *
 * RENAMING or REMOVING a key breaks stored events OF THAT KIND — not merely
 * their hashes. Those events fail the schema enum, and
 * `canonicalAuditEventHashInput` throws `unknown event_kind`, so chains
 * containing them stop verifying and cannot be re-hashed. Editing an existing
 * key's `action` or `entity_type`, or flipping `reasonRequired` false→true,
 * retroactively invalidates already-stored events of that kind at the verifier's
 * consistency check. Treat every entry below as append-only.
 */
export const CASE_BOX_AUDIT_EVENT_KINDS = Object.freeze({
  MATTER_REGISTERED:          { action: "create",          entity_type: "matter",           reasonRequired: false },
  MATTER_ARCHIVED:            { action: "update",          entity_type: "matter",           reasonRequired: false },
  MATTER_UNARCHIVED:          { action: "update",          entity_type: "matter",           reasonRequired: false },
  // WI-PTA-VS0: audited assignment/backfill of party ULIDs on a matter (parties live in the matter
  // payload; assigning an id rewrites the matter → an audited matter update, never an unaudited migration).
  MATTER_PARTY_IDS_ASSIGNED:  { action: "update",          entity_type: "matter",           reasonRequired: false },
  // matter-details-edit Phase A: audited correction of the 6 free-text descriptive fields (D1/D4). The
  // narrow structured `changed_fields` (D5a) records WHAT changed and is HASHED in the v2 canonicalization.
  MATTER_DETAILS_UPDATED:     { action: "update",          entity_type: "matter",           reasonRequired: true  },
  DOCUMENT_REGISTERED:        { action: "create",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_OCR_SUBMITTED:     { action: "update",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_OCR_COMPLETE:      { action: "update",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_OCR_FAILED:        { action: "update",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_TRIAGED:           { action: "update",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_TAGGED:            { action: "update",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_REVIEWED:          { action: "update",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_SOFT_DELETED:      { action: "delete-soft",     entity_type: "document",         reasonRequired: true  },
  OCR_LINK_SNAPSHOTTED:       { action: "create",          entity_type: "ocr_link",         reasonRequired: false },
  OCR_LINK_REFRESHED:         { action: "update",          entity_type: "ocr_link",         reasonRequired: false },
  DEADLINE_REGISTERED:        { action: "create",          entity_type: "deadline",         reasonRequired: false },
  DEADLINE_MET:               { action: "update",          entity_type: "deadline",         reasonRequired: false },
  DEADLINE_MISSED:            { action: "update",          entity_type: "deadline",         reasonRequired: false },
  DEADLINE_WITHDRAWN:         { action: "update",          entity_type: "deadline",         reasonRequired: false },
  DEADLINE_MISSED_TO_MET:     { action: "update",          entity_type: "deadline",         reasonRequired: true  },
  EVIDENCE_PROPOSED:          { action: "create",          entity_type: "evidence_item",    reasonRequired: false },
  EVIDENCE_ACCEPTED:          { action: "update",          entity_type: "evidence_item",    reasonRequired: false },
  EVIDENCE_REJECTED:          { action: "update",          entity_type: "evidence_item",    reasonRequired: false },
  EVIDENCE_SUPERSEDED:        { action: "update",          entity_type: "evidence_item",    reasonRequired: false },
  FACT_PROPOSED:              { action: "create",          entity_type: "fact",             reasonRequired: false },
  FACT_REVIEWED:              { action: "update",          entity_type: "fact",             reasonRequired: false },
  FACT_ACCEPTED:              { action: "update",          entity_type: "fact",             reasonRequired: false },
  FACT_REJECTED:              { action: "update",          entity_type: "fact",             reasonRequired: true  },
  FACT_REPLACEMENT_ACCEPTED:  { action: "create",          entity_type: "fact",             reasonRequired: false },
  PRIVILEGE_MARKER_PROPOSED:  { action: "create",          entity_type: "privilege_marker", reasonRequired: false },
  PRIVILEGE_MARKER_CONFIRMED: { action: "update",          entity_type: "privilege_marker", reasonRequired: false },
  PRIVILEGE_MARKER_DISMISSED: { action: "update",          entity_type: "privilege_marker", reasonRequired: true  },
  PRIVILEGE_MARKER_WAIVED:    { action: "privilege-waive", entity_type: "privilege_marker", reasonRequired: true  },
  EXTERNAL_OCR_AUTHORIZED:    { action: "update",          entity_type: "matter",           reasonRequired: false },
  EXTERNAL_OCR_REVOKED:       { action: "update",          entity_type: "matter",           reasonRequired: true  },
  SYNC_GRANT_GRANTED:         { action: "update",          entity_type: "matter",           reasonRequired: false },
  SYNC_GRANT_REVOKED:         { action: "update",          entity_type: "matter",           reasonRequired: true  },
  LLM_EXTRACTION_OPT_IN:      { action: "update",          entity_type: "matter",           reasonRequired: false },
  LLM_EXTRACTION_OPT_OUT:     { action: "update",          entity_type: "matter",           reasonRequired: true  },
  PRIVILEGE_LOG_EXPORTED:     { action: "export",          entity_type: "matter",           reasonRequired: false },
  CASE_DATA_EXPORTED:         { action: "export",          entity_type: "matter",           reasonRequired: false },
  DOCUMENT_ACCESSED:          { action: "access",          entity_type: "document",         reasonRequired: false },
  DOCUMENT_PRINTED:           { action: "print",           entity_type: "document",         reasonRequired: false },
  DOCUMENT_SHARED:            { action: "share",           entity_type: "document",         reasonRequired: true  },
  // Confidentiality classification (Step 5) — all append-only inserts → action: "create"
  CLASSIFICATION_SET:                  { action: "create", entity_type: "confidentiality_classification", reasonRequired: false },
  CLASSIFICATION_UPGRADED:             { action: "create", entity_type: "confidentiality_classification", reasonRequired: false },
  CLASSIFICATION_DOWNGRADED:           { action: "create", entity_type: "confidentiality_classification", reasonRequired: true  },
  CLASSIFICATION_RESET_TO_UNCLASSIFIED: { action: "create", entity_type: "confidentiality_classification", reasonRequired: true  },
  // Docket entry (Step 6) — three kinds; DEADLINE_CONTINUED deliberately deferred
  DOCKET_ENTRY_PROPOSED:               { action: "create", entity_type: "docket_entry", reasonRequired: false },
  DOCKET_ENTRY_CONFIRMED:              { action: "update", entity_type: "docket_entry", reasonRequired: false },
  DOCKET_ENTRY_DISMISSED:              { action: "update", entity_type: "docket_entry", reasonRequired: true  },
  DOCKET_ENTRY_REVISED:                { action: "update", entity_type: "docket_entry", reasonRequired: false },
  // A3 evidence link (WI-A3-UNLINK-AUDIT-KINDS) — durable explicit unlink/relink; the emitter is WI-A3-UNLINK-T1.
  // An unlink updates the link row's V12 unlinked_at/unlink_reason markers (not create/delete); the relink clears them.
  LINK_UNLINKED:                       { action: "update", entity_type: "link", reasonRequired: true  },
  LINK_RELINKED:                       { action: "update", entity_type: "link", reasonRequired: false },
  LINK_CREATED:                        { action: "create", entity_type: "link", reasonRequired: false },
  // WI-PTA-03 (pre-trial/trial-mode addon) — additive vocabulary for the four future preparation models.
  // `*_DELETED` uses the additive `delete-hard` action (distinct from `delete-soft`); reasonRequired:true for
  // the destructive/legally-meaningful reversals (the four hard deletes + CLAIM_TRACK_WITHDRAWN), matching the
  // treatment of DOCUMENT_SOFT_DELETED / LINK_UNLINKED / PRIVILEGE_MARKER_DISMISSED / classification downgrade.
  CLAIM_TRACK_CREATED:                 { action: "create",      entity_type: "claim_track",               reasonRequired: false },
  CLAIM_TRACK_UPDATED:                 { action: "update",      entity_type: "claim_track",               reasonRequired: false },
  CLAIM_TRACK_WITHDRAWN:               { action: "update",      entity_type: "claim_track",               reasonRequired: true  },
  CLAIM_TRACK_RESOLVED:                { action: "update",      entity_type: "claim_track",               reasonRequired: false },
  CLAIM_TRACK_DELETED:                 { action: "delete-hard", entity_type: "claim_track",               reasonRequired: true  },
  EVIDENCE_PREPARATION_CREATED:        { action: "create",      entity_type: "evidence_preparation",      reasonRequired: false },
  EVIDENCE_PREPARATION_UPDATED:        { action: "update",      entity_type: "evidence_preparation",      reasonRequired: false },
  EVIDENCE_PREPARATION_DELETED:        { action: "delete-hard", entity_type: "evidence_preparation",      reasonRequired: true  },
  CROSS_EXAM_OPINION_CREATED:          { action: "create",      entity_type: "cross_examination_opinion", reasonRequired: false },
  CROSS_EXAM_OPINION_UPDATED:          { action: "update",      entity_type: "cross_examination_opinion", reasonRequired: false },
  CROSS_EXAM_OPINION_DELETED:          { action: "delete-hard", entity_type: "cross_examination_opinion", reasonRequired: true  },
  LEGAL_OPINION_CARD_CREATED:          { action: "create",      entity_type: "legal_opinion_card",        reasonRequired: false },
  LEGAL_OPINION_CARD_UPDATED:          { action: "update",      entity_type: "legal_opinion_card",        reasonRequired: false },
  LEGAL_OPINION_CARD_DELETED:          { action: "delete-hard", entity_type: "legal_opinion_card",        reasonRequired: true  },
  LEGAL_OPINION_CARD_USED_IN_TRIAL_SET:     { action: "update", entity_type: "legal_opinion_card",        reasonRequired: false },
  LEGAL_OPINION_CARD_USED_IN_TRIAL_CLEARED: { action: "update", entity_type: "legal_opinion_card",        reasonRequired: false },
  LEGAL_OPINION_CARD_FOLLOW_UP_SET:         { action: "update", entity_type: "legal_opinion_card",        reasonRequired: false },
  LEGAL_OPINION_CARD_FOLLOW_UP_CLEARED:     { action: "update", entity_type: "legal_opinion_card",        reasonRequired: false },
} as const satisfies Record<string, AuditKindMeta>);

export type CaseBoxAuditEventKind = keyof typeof CASE_BOX_AUDIT_EVENT_KINDS;

// ---------------------------------------------------------------------------
// Reason-required helper
// ---------------------------------------------------------------------------

/** Thrown only by `assertReasonForAuditEventKind`; the builder never throws it. */
export class AuditEventReasonRequiredError extends Error {
  readonly kind: CaseBoxAuditEventKind;
  constructor(kind: CaseBoxAuditEventKind) {
    super(`audit event kind ${JSON.stringify(kind)} requires a non-empty reason`);
    this.name = "AuditEventReasonRequiredError";
    this.kind = kind;
  }
}

/**
 * Enforces the kind's `reasonRequired` flag by THROWING
 * `AuditEventReasonRequiredError`.
 *
 * The same invariant is enforced a second time, in the opposite error style, by
 * `buildCaseBoxAuditEvent`, which returns `ok: false` with a `required-by-kind`
 * error and never throws. This is not redundancy to pick from at random: the
 * builder is the emission path (persistence MUST emit through it, per the
 * module header), and only the builder's output reaches the chain. Use this
 * throwing helper only to reject a missing reason at a call site EARLIER than
 * event construction — e.g. validating user input before a write is attempted.
 * Calling both on one path adds no protection.
 *
 * Both check `length === 0` only, so a whitespace-only reason (`" "`) passes
 * here and in `verifyAuditChain`. Persistence guards trim separately; the
 * contract layer does not.
 */
export function assertReasonForAuditEventKind(
  kind: CaseBoxAuditEventKind,
  reason: string | null | undefined,
): void {
  const meta = CASE_BOX_AUDIT_EVENT_KINDS[kind];
  if (!meta.reasonRequired) return;
  if (typeof reason !== "string" || reason.length === 0) {
    throw new AuditEventReasonRequiredError(kind);
  }
}

// ---------------------------------------------------------------------------
// Branded SHA-256 hash type
// ---------------------------------------------------------------------------

export type AuditEventHash = string & { readonly __brand: "AuditEventHash" };

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * The only gate that mints the `AuditEventHash` brand — nothing revalidates the
 * brand afterwards, so a value that bypasses this function via a cast is
 * indistinguishable from a real digest downstream.
 *
 * Accepts `/^[0-9a-f]{64}$/` exactly: 64 characters, lowercase hex only. An
 * uppercase digest, a `0x` prefix, surrounding whitespace, or any other length
 * is rejected. Rejection is a plain `Error`, not a typed contract error, so it
 * cannot be caught by class.
 */
export function asAuditEventHash(value: string): AuditEventHash {
  if (!SHA256_HEX_RE.test(value)) {
    throw new Error(
      `not a valid lowercase SHA-256 hex digest (64 chars): ${JSON.stringify(value)}`,
    );
  }
  return value as AuditEventHash;
}

/**
 * The hasher `verifyAuditChain` requires. It is a REQUIRED member of that
 * function's options and has deliberately no default — the verifier can never
 * silently fall back to a weak or absent hash.
 *
 * The verifier trusts whatever this returns: the value becomes the expected
 * `prev_event_hash` of the next event. Supplying a non-cryptographic
 * implementation (a constant, say) makes a forged chain verify. The production
 * implementation is `eventHashFn` in
 * `services/case-box-persistence/src/auditChain.ts` — SHA-256 over
 * `canonicalAuditEventHashInput`.
 */
export type EventHashFn = (event: CaseBoxAuditEvent) => AuditEventHash;

// ---------------------------------------------------------------------------
// Canonical hash input — includes id + timestamp + reason
// ---------------------------------------------------------------------------

/**
 * Returns the canonical UTF-8 byte string to hash for an event_hash.
 * INCLUDES id and timestamp (plan-review D1.1/D5.2). Throws if any
 * required canonical field is undefined.
 *
 * Determinism mechanism: literal source-order = JSON.stringify output order.
 * The order below MUST stay alphabetical; pinned-exact-output test guards.
 */
export function canonicalAuditEventHashInput(event: CaseBoxAuditEvent): string {
  // Versioned canonicalization (ADR audit-event-kind-preservation). The function — called directly by
  // eventHashFn / verifyAuditChain — accepts ONLY a valid v1 event (NEITHER audit_schema_version NOR
  // event_kind present) or a valid v2 event (audit_schema_version === 2 AND a known event_kind), and
  // THROWS on anything else (partial pair / unsupported version / unknown kind). This defensive
  // validation at the canonicalizer is a security-boundary requirement, not merely defensive.
  // matter-details-edit Phase A (audit finding M): `changed_fields` is a security-boundary field permitted
  // ONLY on a MATTER_DETAILS_UPDATED v2 event. Reject it on ANY other kind (incl. v1 legacy) at the
  // canonicalizer — defense-in-depth mirroring the partial-pair / unknown-kind throws below, so a
  // schema-bypassing malformed event can never hash a smuggled `changed_fields`. Byte-safe: this only fires
  // for events that actually carry the field, so every existing event's canonical bytes are unchanged.
  if (event.changed_fields !== undefined && event.event_kind !== "MATTER_DETAILS_UPDATED") {
    throw new Error(
      "canonicalAuditEventHashInput: changed_fields is only allowed on MATTER_DETAILS_UPDATED v2 events",
    );
  }
  const hasVer = event.audit_schema_version !== undefined && event.audit_schema_version !== null;
  const hasKind = event.event_kind !== undefined && event.event_kind !== null;
  if (hasVer || hasKind) {
    if (!(hasVer && hasKind)) {
      throw new Error(
        "canonicalAuditEventHashInput: partial v2 pair — audit_schema_version and event_kind must be both present or both absent",
      );
    }
    if (event.audit_schema_version !== 2) {
      throw new Error(
        `canonicalAuditEventHashInput: unsupported audit_schema_version ${JSON.stringify(event.audit_schema_version)}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(CASE_BOX_AUDIT_EVENT_KINDS, event.event_kind as string)) {
      throw new Error(
        `canonicalAuditEventHashInput: unknown event_kind ${JSON.stringify(event.event_kind)}`,
      );
    }
    // v2: existing 12 fields PLUS audit_schema_version + event_kind, in alphabetical (canonical) order.
    // matter-details-edit Phase A (D5a): `changed_fields` is included ONLY when present, in its
    // alphabetical slot (between before_state_hash and entity_id). This conditional spread is the #1
    // byte-preservation invariant — an event with NO changed_fields produces a canonical string
    // BYTE-IDENTICAL to the pre-change v2 shape, so every existing event's hash is unchanged. Do NOT
    // add changed_fields unconditionally (a null/default would rewrite every existing v2 event's string
    // and break the chain).
    const canonical = {
      action: event.action,
      actor_user_id: event.actor_user_id,
      after_state_hash: event.after_state_hash,
      audit_schema_version: event.audit_schema_version,
      before_state_hash: event.before_state_hash,
      ...(event.changed_fields !== undefined ? { changed_fields: event.changed_fields } : {}),
      entity_id: event.entity_id,
      entity_type: event.entity_type,
      event_kind: event.event_kind,
      id: event.id,
      matter_id: event.matter_id,
      prev_event_hash: event.prev_event_hash,
      reason: event.reason ?? null,
      tenant_id: event.tenant_id,
      timestamp: event.timestamp,
    };
    for (const [k, v] of Object.entries(canonical)) {
      if (v === undefined) {
        throw new Error(`canonicalAuditEventHashInput: required field "${k}" is undefined`);
      }
    }
    return JSON.stringify(canonical);
  }
  // v1 (legacy): the exact 12-field canonical string, byte-identical to the pre-v2 contract.
  const canonical = {
    action: event.action,
    actor_user_id: event.actor_user_id,
    after_state_hash: event.after_state_hash,
    before_state_hash: event.before_state_hash,
    entity_id: event.entity_id,
    entity_type: event.entity_type,
    id: event.id,
    matter_id: event.matter_id,
    prev_event_hash: event.prev_event_hash,
    reason: event.reason ?? null,
    tenant_id: event.tenant_id,
    timestamp: event.timestamp,
  };
  for (const [k, v] of Object.entries(canonical)) {
    if (v === undefined) {
      throw new Error(`canonicalAuditEventHashInput: required field "${k}" is undefined`);
    }
  }
  return JSON.stringify(canonical);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildAuditEventInput {
  kind: CaseBoxAuditEventKind;
  id: string;
  tenant_id: string;
  actor_user_id: string;
  matter_id: string;
  entity_id: string;
  before_state_hash: string | null;
  after_state_hash: string;
  prev_event_hash: string | null;
  timestamp: string;
  reason?: string;
}

/**
 * Build a CaseBoxAuditEvent from a rich kind input. Returns
 * ValidationResult only; never throws (plan-review D1.4). Reason-required
 * helper violations are wrapped into ok=false with a synthesized error.
 */
export function buildCaseBoxAuditEvent(
  input: BuildAuditEventInput,
): ValidationResult<CaseBoxAuditEvent> {
  const meta = CASE_BOX_AUDIT_EVENT_KINDS[input.kind];
  if (!meta) {
    const err: AjvErrorObject = {
      instancePath: "/kind",
      schemaPath: "",
      keyword: "enum",
      params: { allowedValues: Object.keys(CASE_BOX_AUDIT_EVENT_KINDS) },
      message: `unknown audit event kind ${JSON.stringify(input.kind)}`,
    };
    return { ok: false, summary: summarizeErrors([err]), errors: [err] };
  }
  if (meta.reasonRequired) {
    if (typeof input.reason !== "string" || input.reason.length === 0) {
      const err: AjvErrorObject = {
        instancePath: "/reason",
        schemaPath: "",
        keyword: "required-by-kind",
        params: { kind: input.kind },
        message: `audit event kind ${JSON.stringify(input.kind)} requires a non-empty reason`,
      };
      return { ok: false, summary: summarizeErrors([err]), errors: [err] };
    }
  }
  const candidate: Record<string, unknown> = {
    id: input.id,
    tenant_id: input.tenant_id,
    actor_user_id: input.actor_user_id,
    matter_id: input.matter_id,
    action: meta.action,
    entity_type: meta.entity_type,
    entity_id: input.entity_id,
    before_state_hash: input.before_state_hash,
    after_state_hash: input.after_state_hash,
    prev_event_hash: input.prev_event_hash,
    timestamp: input.timestamp,
    // v2 (ADR audit-event-kind-preservation): preserve the kind + version on every new event so the
    // distinction (e.g. DEADLINE_MET vs DEADLINE_MISSED, which share action/entity_type) is durable
    // and tamper-evident (both fields are hashed in the v2 canonicalization). action/entity_type stay
    // derived from meta, so the event is always kind↔{action,entity_type,reasonRequired}-consistent.
    audit_schema_version: 2,
    event_kind: input.kind,
  };
  if (input.reason !== undefined) candidate.reason = input.reason;
  return validateAuditEvent(candidate);
}

// ---------------------------------------------------------------------------
// Chain verifier — eventHashFn REQUIRED; checks tenant/matter homogeneity
// ---------------------------------------------------------------------------

export type ChainVerifyErrorReason =
  | "prev_event_hash_mismatch"
  | "prev_event_hash_non_null_for_first_event"
  | "before_state_hash_not_null_on_create"
  | "missing_after_state_hash"
  | "event_schema_invalid"
  | "event_kind_inconsistent"
  | "tenant_id_mismatch"
  | "matter_id_mismatch";

export interface ChainVerifyOk {
  readonly ok: true;
  readonly verifiedCount: number;
  /** Hash of the last verified event; null when chain is empty. v1 head anchor. */
  readonly headHash: AuditEventHash | null;
}

export interface ChainVerifyErr {
  readonly ok: false;
  readonly errorIndex: number;
  readonly errorReason: ChainVerifyErrorReason;
  readonly detail: string;
}

/**
 * Walk an append-ordered sequence of audit events and verify chain
 * integrity. `eventHashFn` is REQUIRED (no weak fallback, per
 * plan-review D1.2). Pure; no IO.
 */
export function verifyAuditChain(
  events: ReadonlyArray<unknown>,
  options: { eventHashFn: EventHashFn },
): ChainVerifyOk | ChainVerifyErr {
  if (events.length === 0) {
    return { ok: true, verifiedCount: 0, headHash: null };
  }
  let priorHash: AuditEventHash | null = null;
  let priorTenant: string | null = null;
  let priorMatter: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const candidate = events[i];
    const r = validateAuditEvent(candidate);
    if (!r.ok) {
      return {
        ok: false,
        errorIndex: i,
        errorReason: "event_schema_invalid",
        detail: r.summary,
      };
    }
    const e = r.value;
    if (typeof e.after_state_hash !== "string" || e.after_state_hash.length === 0) {
      return {
        ok: false,
        errorIndex: i,
        errorReason: "missing_after_state_hash",
        detail: `event[${i}] has empty or missing after_state_hash`,
      };
    }
    if (i === 0) {
      if (e.prev_event_hash !== null) {
        return {
          ok: false,
          errorIndex: 0,
          errorReason: "prev_event_hash_non_null_for_first_event",
          detail: `first event must have prev_event_hash === null (got ${JSON.stringify(e.prev_event_hash)})`,
        };
      }
      priorTenant = e.tenant_id;
      priorMatter = e.matter_id;
    } else {
      if (e.tenant_id !== priorTenant) {
        return {
          ok: false,
          errorIndex: i,
          errorReason: "tenant_id_mismatch",
          detail: `event[${i}].tenant_id (${JSON.stringify(e.tenant_id)}) does not match prior chain tenant_id (${JSON.stringify(priorTenant)})`,
        };
      }
      if (e.matter_id !== priorMatter) {
        return {
          ok: false,
          errorIndex: i,
          errorReason: "matter_id_mismatch",
          detail: `event[${i}].matter_id (${JSON.stringify(e.matter_id)}) does not match prior chain matter_id (${JSON.stringify(priorMatter)})`,
        };
      }
      if (e.prev_event_hash !== priorHash) {
        return {
          ok: false,
          errorIndex: i,
          errorReason: "prev_event_hash_mismatch",
          detail: `event[${i}].prev_event_hash (${JSON.stringify(e.prev_event_hash)}) does not match prior event hash (${JSON.stringify(priorHash)})`,
        };
      }
    }
    if (e.action === "create" && e.before_state_hash !== null) {
      return {
        ok: false,
        errorIndex: i,
        errorReason: "before_state_hash_not_null_on_create",
        detail: `create-action event[${i}] must have before_state_hash === null (got ${JSON.stringify(e.before_state_hash)})`,
      };
    }
    // v2 event_kind consistency (ADR §4): a present event_kind's declared
    // {action, entity_type, reasonRequired} metadata must match this event. Enforced HERE at the
    // verification (security) boundary — not builder-only — so a raw/imported/tampered v2 payload whose
    // event_kind disagrees with its action/entity_type, or whose reasonRequired kind omits a reason, is
    // rejected. (Schema already restricts event_kind to a known key, so kindMeta is defined; the guard
    // is defensive.) The kind→{action,entity_type} map is many-to-one, so this checks declared-equals,
    // not uniqueness.
    if (e.event_kind !== undefined && e.event_kind !== null) {
      const kindMeta: AuditKindMeta | undefined =
        CASE_BOX_AUDIT_EVENT_KINDS[e.event_kind as CaseBoxAuditEventKind];
      if (
        kindMeta === undefined ||
        kindMeta.action !== e.action ||
        kindMeta.entity_type !== e.entity_type ||
        (kindMeta.reasonRequired && (typeof e.reason !== "string" || e.reason.length === 0))
      ) {
        return {
          ok: false,
          errorIndex: i,
          errorReason: "event_kind_inconsistent",
          detail: `event[${i}].event_kind (${JSON.stringify(e.event_kind)}) is inconsistent with its declared {action, entity_type, reasonRequired} metadata vs the event (action=${JSON.stringify(e.action)}, entity_type=${JSON.stringify(e.entity_type)}, reason_present=${typeof e.reason === "string" && e.reason.length > 0})`,
        };
      }
    }
    priorHash = options.eventHashFn(e);
  }
  return { ok: true, verifiedCount: events.length, headHash: priorHash };
}

// Silence unused-imports lint while keeping the schema-aware imports in scope.
void auditEventSchema;
void ajv;
