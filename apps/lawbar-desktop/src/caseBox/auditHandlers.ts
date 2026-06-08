// Audit IPC handlers (chain head / list events). Mechanically extracted from
// handlers.ts (no behavior change).

import {
  CHAIN_HEAD_DTO_FIELDS,
  CHAIN_HEAD_FORBIDDEN_FIELDS,
  LIST_AUDIT_EVENTS_DTO_FIELDS,
  LIST_AUDIT_EVENTS_FORBIDDEN_FIELDS,
  LIST_AUDIT_EVENTS_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ChainHeadDto,
  type ListAuditEventsDto,
  type ChainHeadResult,
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

