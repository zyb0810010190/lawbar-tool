// Fact IPC handlers. Read: listFactsHandler. Write: createFactHandler (WI-602,
// manual lawyer-authored candidate fact) + transitionFactHandler (WI-802, review /
// accept / reject lifecycle). Mirrors the deadline/document handlers and the WI-601
// docket write handler: matter existence + active-tenant check before the
// read/write, server-side authority injection, renderer-safe allowlisted
// projection. The fact state machine lives in persistence (illegal_transition is
// surfaced, not re-implemented here).

import {
  LIST_FACTS_DTO_FIELDS,
  LIST_FACTS_FORBIDDEN_FIELDS,
  LIST_FACTS_RESPONSE_FIELDS,
  CREATE_FACT_DTO_FIELDS,
  CREATE_FACT_FORBIDDEN_FIELDS,
  CREATE_FACT_RESPONSE_FIELDS,
  TRANSITION_FACT_DTO_FIELDS,
  TRANSITION_FACT_FORBIDDEN_FIELDS,
  TRANSITION_FACT_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ListFactsDto,
  type ListFactsResult,
  type RendererFactRow,
  type CreateFactDto,
  type CreateFactResult,
  type RendererCreatedFactRow,
  type TransitionFactDto,
  type TransitionFactResult,
  type RendererTransitionedFactRow,
  type FactTransitionTarget,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import { getActiveActorUserId } from "../security/activeActor.js";
import {
  CHANNEL,
  ClockFn,
  isPlainJsonObject,
  shapeGuardFailure,
  forbiddenFieldFailure,
  projectPage,
  projectRow,
  type PersistenceProvider,
} from "./handlerShared.js";

// R-5 purpose enum (case-box-fact.schema.json). Absent => persistence defaults
// to "other"; when supplied it must be one of these.
const FACT_PURPOSES = Object.freeze([
  "claim",
  "defense",
  "counterclaim",
  "timeline_event",
  "work_order_result",
  "consultation_q",
  "consultation_a",
  "other",
] as const);
// Date-only (no time component). A FORMAT check, not a calendar-validity check;
// persistence.appendFact applies the schema's semantic validation on top.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Valid fact-transition targets (the renderer-facing `to`). The ALLOWED from->to
// edges (candidate->reviewed/rejected, reviewed->accepted/rejected; candidate->
// accepted is illegal per the no-auto-accept ADR) are enforced by persistence,
// not here — the handler only validates the target value + carries the request.
const FACT_TRANSITION_TARGETS: ReadonlyArray<FactTransitionTarget> = ["reviewed", "accepted", "rejected"];

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export async function listFactsHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListFactsResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_FACTS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_FACTS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListFactsDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ListFactsDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  let limit = dto.limit;
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      return { ok: false, error: makeInvalidPayload("limit must be a positive integer") };
    }
    if (limit > MAX_LIST_LIMIT) limit = MAX_LIST_LIMIT;
  }
  if (dto.cursor !== undefined) {
    if (typeof dto.cursor !== "string" || dto.cursor.length > MAX_CURSOR_LENGTH) {
      return {
        ok: false,
        error: makeInvalidPayload(`cursor must be an opaque string <=${MAX_CURSOR_LENGTH} chars`),
      };
    }
  }
  try {
    const { persistence } = provide();
    const existing = await persistence.getMatter(dto.matterId);
    if (existing === null) {
      return { ok: false, error: makeBoundaryError("unknown_matter") };
    }
    if (existing.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const page = await persistence.listFacts({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    // Project every row to the renderer-safe allowlist so server-authority
    // fields (tenant_id / actor_user_id / reviewer_actor_user_id) never cross
    // the IPC boundary. next_cursor is preserved unchanged.
    return { ok: true, value: projectPage<RendererFactRow>(page, LIST_FACTS_RESPONSE_FIELDS) };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.factList }) };
  }
}

// --- create a manual lawyer-authored candidate fact ------------------------
// The renderer supplies only statement_text (+ optional purpose / as_of_date);
// the server injects the full candidate CaseBoxFact shape (status "candidate",
// source_type "lawyer_authored", all source_* / extractor_* / reviewer_* /
// review fields null — the candidate-status conditional REQUIRES them null).
export async function createFactHandler(
  payload: unknown,
  provide: PersistenceProvider,
  now: ClockFn,
  idFactory: () => string,
): Promise<CreateFactResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CREATE_FACT_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(CREATE_FACT_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in CreateFactDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as CreateFactDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.statement_text)) {
    return { ok: false, error: makeInvalidPayload("statement_text must be a non-empty string") };
  }
  if (dto.purpose !== undefined && !(FACT_PURPOSES as readonly string[]).includes(dto.purpose)) {
    return {
      ok: false,
      error: makeInvalidPayload("purpose, when present, must be a valid fact purpose"),
    };
  }
  // as_of_date rule (a) FORMAT: whenever supplied (any purpose), must be a
  // date-only string with no time component.
  if (dto.as_of_date !== undefined) {
    if (typeof dto.as_of_date !== "string" || !DATE_ONLY_RE.test(dto.as_of_date)) {
      return {
        ok: false,
        error: makeInvalidPayload("as_of_date, when present, must be a date-only string (YYYY-MM-DD)"),
      };
    }
  }
  // as_of_date rule (b) REQUIREDNESS: a timeline_event fact must carry one.
  if (dto.purpose === "timeline_event" && !nonEmptyString(dto.as_of_date)) {
    return {
      ok: false,
      error: makeInvalidPayload('as_of_date is required when purpose is "timeline_event"'),
    };
  }
  try {
    const { persistence } = provide();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const input = {
      id: idFactory(),
      tenant_id: getActiveTenantId(),
      actor_user_id: getActiveActorUserId(),
      matter_id: dto.matterId,
      statement_text: dto.statement_text,
      status: "candidate",
      source_type: "lawyer_authored",
      source_document_id: null,
      source_page_number: null,
      source_excerpt: null,
      source_ocr_job_id: null,
      extractor_name: null,
      extractor_version: null,
      extraction_confidence: null,
      reviewer_actor_user_id: null,
      reviewed_at: null,
      accepted_at: null,
      rejected_at: null,
      rejection_reason: null,
      supersedes_fact_id: null,
      created_at: now().toISOString(),
      ...(dto.purpose !== undefined ? { purpose: dto.purpose } : {}),
      ...(dto.as_of_date !== undefined ? { as_of_date: dto.as_of_date } : {}),
    };
    const fact = await persistence.appendFact(input);
    return {
      ok: true,
      value: projectRow<RendererCreatedFactRow>(
        fact as unknown as Record<string, unknown>,
        CREATE_FACT_RESPONSE_FIELDS,
      ),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.factCreate }) };
  }
}

// --- transition a fact through the review lifecycle (review/accept/reject) ----
// The renderer supplies only { matterId, factId, to, rejection_reason? }. The
// server injects reviewer_actor_user_id + the `at` timestamp; persistence owns
// the state machine. Security boundary: persistence.transitionFact(factId, opts)
// is UNSCOPED (no tenant/matter), so the handler does a SCOPED getFact preflight
// and rejects a null with invalid_payload WITHOUT calling transitionFact —
// fail-closed against confirming a guessed foreign factId cross-matter/tenant
// (mirrors the WI-601 docket-confirm preflight).
export async function transitionFactHandler(
  payload: unknown,
  provide: PersistenceProvider,
  now: ClockFn,
): Promise<TransitionFactResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of TRANSITION_FACT_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(TRANSITION_FACT_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in TransitionFactDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as TransitionFactDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.factId)) {
    return { ok: false, error: makeInvalidPayload("factId must be a non-empty string") };
  }
  if (!(FACT_TRANSITION_TARGETS as readonly string[]).includes(dto.to)) {
    return { ok: false, error: makeInvalidPayload("to must be one of reviewed | accepted | rejected") };
  }
  const isReject = dto.to === "rejected";
  // rejection_reason is required + non-empty when rejecting, and FORBIDDEN (not
  // silently dropped) otherwise.
  if (isReject) {
    if (!nonEmptyString(dto.rejection_reason)) {
      return { ok: false, error: makeInvalidPayload('rejection_reason is required when to is "rejected"') };
    }
  } else if (dto.rejection_reason !== undefined) {
    return {
      ok: false,
      error: makeInvalidPayload('rejection_reason is only allowed when to is "rejected"', {
        schemaPath: "rejection_reason",
      }),
    };
  }
  try {
    const { persistence } = provide();
    // Capture the active tenant / actor / timestamp ONCE and reuse them.
    const tenantId = getActiveTenantId();
    const actorId = getActiveActorUserId();
    const atIso = now().toISOString();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // SCOPED preflight: the fact must exist UNDER this matter + active tenant.
    // transitionFact is unscoped, so a null here means unknown / wrong-matter /
    // wrong-tenant fact_id -> reject WITHOUT transitioning (fail-closed).
    const existing = await persistence.getFact({
      tenant_id: tenantId,
      matter_id: dto.matterId,
      fact_id: dto.factId,
    });
    if (existing === null) {
      return {
        ok: false,
        error: makeInvalidPayload("factId does not reference a fact in this matter"),
      };
    }
    const fact = await persistence.transitionFact(dto.factId, {
      to: dto.to,
      reviewer_actor_user_id: actorId,
      at: atIso,
      ...(isReject ? { rejection_reason: dto.rejection_reason } : {}),
    });
    return {
      ok: true,
      value: projectRow<RendererTransitionedFactRow>(
        fact as unknown as Record<string, unknown>,
        TRANSITION_FACT_RESPONSE_FIELDS,
      ),
    };
  } catch (err) {
    // illegal_transition (e.g. candidate -> accepted) surfaces from persistence here.
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.factTransition }) };
  }
}
