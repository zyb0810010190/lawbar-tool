// Deadline IPC handlers (read-only). Mirrors the document/audit list handlers:
// matter existence + active-tenant check before the read, server-side tenant
// injection, bounded limit/cursor. No create/confirm/dismiss/transition here.

import {
  LIST_DEADLINES_DTO_FIELDS,
  LIST_DEADLINES_FORBIDDEN_FIELDS,
  LIST_DEADLINES_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ListDeadlinesDto,
  type ListDeadlinesResult,
  type RendererDeadlineRow,
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

export async function listDeadlinesHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListDeadlinesResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_DEADLINES_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_DEADLINES_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListDeadlinesDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ListDeadlinesDto;
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
    const page = await persistence.listDeadlines({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    // Project every row to the renderer-safe allowlist so server-authority
    // fields (tenant_id / actor_user_id) never cross the IPC boundary.
    // next_cursor is preserved unchanged.
    return { ok: true, value: projectPage<RendererDeadlineRow>(page, LIST_DEADLINES_RESPONSE_FIELDS) };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.deadlineList }) };
  }
}
