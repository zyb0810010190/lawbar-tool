// casebox:evidence:{list,create,transition} handlers (product plan R2, WI-10).
//
// Same discipline as the fact channels, from which this is mirrored line for line where the
// shape is the same: plain-JSON shape guard, server-authority fields refused, unknown fields
// refused, matter looked up and tenant-checked BEFORE any write, codes not messages across the
// boundary, rows projected through an allowlist so nothing the renderer did not ask for leaks.
//
// What is specific to evidence:
// - `create` requires `documentId`, and the document must exist IN THIS MATTER under this tenant.
//   That preflight is load-bearing, not belt-and-braces: a document id alone is a bearer token
//   for any document in the box, and an evidence row pointing at another matter's original would
//   put that original's name into this matter's catalogue.
// - The persisted row is appended as `proposed` and promoted by `transition`; persistence owns the
//   edge set (proposed → accepted | rejected; both terminal for this channel) and reports an
//   `illegal_transition` code, which the renderer turns into a sentence.

import {
  LIST_EVIDENCE_ITEMS_DTO_FIELDS,
  LIST_EVIDENCE_ITEMS_FORBIDDEN_FIELDS,
  LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS,
  CREATE_EVIDENCE_ITEM_DTO_FIELDS,
  CREATE_EVIDENCE_ITEM_FORBIDDEN_FIELDS,
  CREATE_EVIDENCE_ITEM_RESPONSE_FIELDS,
  TRANSITION_EVIDENCE_ITEM_DTO_FIELDS,
  TRANSITION_EVIDENCE_ITEM_FORBIDDEN_FIELDS,
  TRANSITION_EVIDENCE_ITEM_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ListEvidenceItemsDto,
  type ListEvidenceItemsResult,
  type RendererEvidenceRow,
  type CreateEvidenceItemDto,
  type CreateEvidenceItemResult,
  type RendererCreatedEvidenceRow,
  type TransitionEvidenceItemDto,
  type TransitionEvidenceItemResult,
  type RendererTransitionedEvidenceRow,
  type EvidenceTransitionTarget,
  type EvidencePartySide,
  type EvidenceLawyerWeight,
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

const PARTY_SIDES: ReadonlyArray<EvidencePartySide> = ["our", "opposing"];
const LAWYER_WEIGHTS: ReadonlyArray<EvidenceLawyerWeight> = ["weak", "moderate", "strong"];
const TRANSITION_TARGETS: ReadonlyArray<EvidenceTransitionTarget> = ["accepted", "rejected"];

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Optional text field: absent, or a non-blank string. Blank is refused rather than silently dropped. */
function optionalText(v: unknown, name: string): { ok: true; value: string | undefined } | { ok: false; message: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (typeof v !== "string") return { ok: false, message: `${name}, when present, must be a string` };
  const trimmed = v.trim();
  if (trimmed.length === 0) return { ok: false, message: `${name}, when present, must not be blank` };
  return { ok: true, value: trimmed };
}

export async function listEvidenceItemsHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListEvidenceItemsResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_EVIDENCE_ITEMS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_EVIDENCE_ITEMS_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in ListEvidenceItemsDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as ListEvidenceItemsDto;
  if (!nonEmptyString(dto.matterId)) {
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
      return { ok: false, error: makeInvalidPayload(`cursor must be an opaque string <=${MAX_CURSOR_LENGTH} chars`) };
    }
  }
  try {
    const { persistence } = provide();
    const tenantId = getActiveTenantId();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    const page = await persistence.listEvidenceItems({
      tenant_id: tenantId,
      matter_id: dto.matterId,
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    return { ok: true, value: projectPage<RendererEvidenceRow>(page, LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS) };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.evidenceList }) };
  }
}

export async function createEvidenceItemHandler(
  payload: unknown,
  provide: PersistenceProvider,
  now: ClockFn,
  idFactory: () => string,
): Promise<CreateEvidenceItemResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CREATE_EVIDENCE_ITEM_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(CREATE_EVIDENCE_ITEM_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in CreateEvidenceItemDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as CreateEvidenceItemDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.documentId)) {
    return { ok: false, error: makeInvalidPayload("documentId must be a non-empty string") };
  }
  if (typeof dto.evidence_title !== "string" || dto.evidence_title.trim().length === 0) {
    return { ok: false, error: makeInvalidPayload("evidence_title must be a non-blank string") };
  }
  const proof = optionalText(dto.proof_statement, "proof_statement");
  if (!proof.ok) return { ok: false, error: makeInvalidPayload(proof.message) };
  const pages = optionalText(dto.exhibit_page_range, "exhibit_page_range");
  if (!pages.ok) return { ok: false, error: makeInvalidPayload(pages.message) };
  if (dto.party_side !== undefined && !(PARTY_SIDES as readonly string[]).includes(dto.party_side)) {
    return { ok: false, error: makeInvalidPayload("party_side, when present, must be our | opposing") };
  }
  if (dto.lawyer_weight !== undefined && !(LAWYER_WEIGHTS as readonly string[]).includes(dto.lawyer_weight)) {
    return { ok: false, error: makeInvalidPayload("lawyer_weight, when present, must be weak | moderate | strong") };
  }
  if (dto.display_order !== undefined) {
    if (typeof dto.display_order !== "number" || !Number.isInteger(dto.display_order) || dto.display_order < 0) {
      return { ok: false, error: makeInvalidPayload("display_order, when present, must be a non-negative integer") };
    }
  }
  try {
    const { persistence } = provide();
    const tenantId = getActiveTenantId();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    // The document must be THIS matter's. A document from another matter is reported as unknown,
    // not as a mismatch: the renderer has no business learning that the id exists elsewhere.
    const document = await persistence.getDocument(dto.documentId);
    if (document === null || document.tenant_id !== tenantId || document.matter_id !== dto.matterId) {
      return { ok: false, error: makeBoundaryError("unknown_document") };
    }
    const input = {
      id: idFactory(),
      tenant_id: tenantId,
      actor_user_id: getActiveActorUserId(),
      matter_id: dto.matterId,
      source_document_id: dto.documentId,
      exhibit_page_range: pages.value ?? null,
      lawyer_weight: dto.lawyer_weight ?? "moderate",
      status: "proposed",
      supersedes_evidence_id: null,
      evidence_title: dto.evidence_title.trim(),
      created_at: now().toISOString(),
      ...(proof.value !== undefined ? { proof_statement: proof.value } : {}),
      ...(dto.party_side !== undefined ? { party_side: dto.party_side } : {}),
      ...(dto.display_order !== undefined ? { display_order: dto.display_order } : {}),
    };
    const row = await persistence.appendEvidenceItem(input);
    return {
      ok: true,
      value: projectRow<RendererCreatedEvidenceRow>(row as unknown as Record<string, unknown>, CREATE_EVIDENCE_ITEM_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.evidenceCreate }) };
  }
}

export async function transitionEvidenceItemHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<TransitionEvidenceItemResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of TRANSITION_EVIDENCE_ITEM_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(TRANSITION_EVIDENCE_ITEM_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in TransitionEvidenceItemDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as TransitionEvidenceItemDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.evidenceId)) {
    return { ok: false, error: makeInvalidPayload("evidenceId must be a non-empty string") };
  }
  if (!(TRANSITION_TARGETS as readonly string[]).includes(dto.to)) {
    return { ok: false, error: makeInvalidPayload("to must be one of accepted | rejected") };
  }
  try {
    const { persistence } = provide();
    const tenantId = getActiveTenantId();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    const existing = await persistence.getEvidenceItem({
      tenant_id: tenantId,
      matter_id: dto.matterId,
      evidence_id: dto.evidenceId,
    });
    if (existing === null) {
      return { ok: false, error: makeInvalidPayload("evidenceId does not reference an evidence item in this matter") };
    }
    const row = await persistence.transitionEvidenceItem(dto.evidenceId, {
      to: dto.to,
      actor_user_id: getActiveActorUserId(),
    });
    return {
      ok: true,
      value: projectRow<RendererTransitionedEvidenceRow>(row as unknown as Record<string, unknown>, TRANSITION_EVIDENCE_ITEM_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.evidenceTransition }) };
  }
}
