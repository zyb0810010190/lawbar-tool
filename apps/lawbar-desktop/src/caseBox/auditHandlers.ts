// Audit IPC handlers (chain head / list events). Mechanically extracted from
// handlers.ts (no behavior change).

import {
  CHAIN_HEAD_DTO_FIELDS,
  CHAIN_HEAD_FORBIDDEN_FIELDS,
  VERIFY_CHAIN_DTO_FIELDS,
  VERIFY_CHAIN_FORBIDDEN_FIELDS,
  LIST_AUDIT_EVENTS_DTO_FIELDS,
  LIST_AUDIT_EVENTS_FORBIDDEN_FIELDS,
  LIST_AUDIT_EVENTS_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ChainHeadDto,
  type VerifyChainDto,
  type ListAuditEventsDto,
  type ChainHeadResult,
  type VerifyChainResult,
  type RendererChainVerifyResult,
  type ListAuditEventsResult,
  type RendererAuditEventRow,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import {
  CHANNEL,
  isPlainJsonObject,
  shapeGuardFailure,
  forbiddenFieldFailure,
  projectPage,
  type PersistenceProvider,
} from "./handlerShared.js";

export async function chainHeadHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ChainHeadResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CHAIN_HEAD_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(CHAIN_HEAD_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ChainHeadDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ChainHeadDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("matterId must be a non-empty string"),
    };
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
    const head = await persistence.getAuditChainHead(dto.matterId);
    return { ok: true, value: head };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.auditChainHead }) };
  }
}

export async function listAuditEventsHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListAuditEventsResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_AUDIT_EVENTS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_AUDIT_EVENTS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListAuditEventsDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ListAuditEventsDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("matterId must be a non-empty string"),
    };
  }
  let limit = dto.limit;
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      return {
        ok: false,
        error: makeInvalidPayload("limit must be a positive integer"),
      };
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
    const page = await persistence.listAuditEvents({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    // AUDIT-AUD-1: project every row through the renderer-safe allowlist so
    // server-authority fields (tenant_id / actor_user_id / matter_id / id) + any
    // open-index extras never cross the IPC boundary. next_cursor passes through.
    return { ok: true, value: projectPage<RendererAuditEventRow>(page, LIST_AUDIT_EVENTS_RESPONSE_FIELDS) };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.auditListEvents }) };
  }
}


// GAP-2: full chain verification for one matter, exposed to the renderer.
//
// Mirrors chainHeadHandler's guards exactly — same shape guard, same forbidden-field and
// unknown-field allowlists, same matter-existence and tenant checks — because this channel takes
// the same single-field DTO and must not be a weaker door onto the same data.
//
// Two things here are deliberate and easy to get wrong if this is ever refactored:
//
// 1. A DETECTED TAMPER RETURNS `{ ok: true, value: { ok: false, ... } }`. The outer envelope means
//    "verification ran"; the inner flag means "the chain is intact". A broken chain is the single
//    most important result this channel can produce, and reporting it as an IPC error would bury it
//    among transport failures and make the court-facing claim untestable from the UI.
//
// 2. The persistence `detail` string is NOT forwarded — see RendererChainVerifyResult in
//    dto/audit.ts. Two of its branches interpolate tenant_id / matter_id, which this boundary
//    excludes everywhere else.
export async function verifyChainHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<VerifyChainResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of VERIFY_CHAIN_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(VERIFY_CHAIN_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in VerifyChainDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as VerifyChainDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("matterId must be a non-empty string"),
    };
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
    const result = await persistence.verifyAuditChainForMatter(dto.matterId);
    // Project field-by-field rather than spreading: a spread would carry `detail` (and any field a
    // future persistence version adds) across the boundary silently.
    const projected: RendererChainVerifyResult = result.ok
      ? { ok: true, verifiedCount: result.verifiedCount, headHash: result.headHash }
      : { ok: false, errorIndex: result.errorIndex, errorReason: result.errorReason };
    return { ok: true, value: projected };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.auditVerifyChain }) };
  }
}
