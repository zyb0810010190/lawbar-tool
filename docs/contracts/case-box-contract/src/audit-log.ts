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
  | "privilege-waive";

interface AuditKindMeta {
  readonly action: AuditAction;
  readonly entity_type: CaseBoxAuditEntityType;
  readonly reasonRequired: boolean;
}

export const CASE_BOX_AUDIT_EVENT_KINDS = Object.freeze({
  MATTER_REGISTERED:          { action: "create",          entity_type: "matter",           reasonRequired: false },
  MATTER_ARCHIVED:            { action: "update",          entity_type: "matter",           reasonRequired: false },
  MATTER_UNARCHIVED:          { action: "update",          entity_type: "matter",           reasonRequired: false },
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
} as const satisfies Record<string, AuditKindMeta>);

export type CaseBoxAuditEventKind = keyof typeof CASE_BOX_AUDIT_EVENT_KINDS;

// ---------------------------------------------------------------------------
// Reason-required helper
// ---------------------------------------------------------------------------

export class AuditEventReasonRequiredError extends Error {
  readonly kind: CaseBoxAuditEventKind;
  constructor(kind: CaseBoxAuditEventKind) {
    super(`audit event kind ${JSON.stringify(kind)} requires a non-empty reason`);
    this.name = "AuditEventReasonRequiredError";
    this.kind = kind;
  }
}

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

export function asAuditEventHash(value: string): AuditEventHash {
  if (!SHA256_HEX_RE.test(value)) {
    throw new Error(
      `not a valid lowercase SHA-256 hex digest (64 chars): ${JSON.stringify(value)}`,
    );
  }
  return value as AuditEventHash;
}

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
    priorHash = options.eventHashFn(e);
  }
  return { ok: true, verifiedCount: events.length, headHash: priorHash };
}

// Silence unused-imports lint while keeping the schema-aware imports in scope.
void auditEventSchema;
void ajv;
