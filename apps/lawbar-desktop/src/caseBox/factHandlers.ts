// Fact IPC handlers (read-only). Mirrors the deadline/document list handlers:
// matter existence + active-tenant check before the read, server-side tenant
// injection, bounded limit/cursor. No create / edit / delete / review here.

import {
  LIST_FACTS_DTO_FIELDS,
  LIST_FACTS_FORBIDDEN_FIELDS,
  LIST_FACTS_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ListFactsDto,
  type ListFactsResult,
  type RendererFactRow,
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
