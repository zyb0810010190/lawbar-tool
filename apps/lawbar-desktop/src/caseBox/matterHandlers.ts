// Matter IPC handlers (create / get / list / archive). Mechanically extracted
// from handlers.ts (no behavior change).

import { validateMatter } from "case-box-contract";

import {
  CREATE_MATTER_DTO_FIELDS,
  CREATE_MATTER_FORBIDDEN_FIELDS,
  LIST_MATTERS_DTO_FIELDS,
  LIST_MATTERS_FORBIDDEN_FIELDS,
  ARCHIVE_MATTER_DTO_FIELDS,
  ARCHIVE_MATTER_FORBIDDEN_FIELDS,
  GET_MATTER_DTO_FIELDS,
  GET_MATTER_FORBIDDEN_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type CreateMatterDto,
  type GetMatterDto,
  type ListMattersDto,
  type ArchiveMatterDto,
  type CreateMatterResult,
  type GetMatterResult,
  type ListMattersResult,
  type ArchiveMatterResult,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import { getActiveActorUserId } from "../security/activeActor.js";
import {
  CHANNEL,
  isPlainJsonObject,
  shapeGuardFailure,
  forbiddenFieldFailure,
  type PersistenceProvider,
  type ClockFn,
} from "./handlerShared.js";

export async function createMatterHandler(
  payload: unknown,
  provide: PersistenceProvider,
  nowFn: ClockFn,
  idFactory: () => string,
): Promise<CreateMatterResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CREATE_MATTER_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  const dto = payload as unknown as CreateMatterDto;
  const fullMatter: Record<string, unknown> = {
    id: idFactory(),
    tenant_id: getActiveTenantId(),
    actor_user_id: getActiveActorUserId(),
    created_at: nowFn().toISOString(),
    status: "active",
    external_ocr_authorized: false,
    sync_grant_present: false,
    llm_extraction_opt_in: false,
  };
  const dtoAsRecord = dto as unknown as Record<string, unknown>;
  for (const f of CREATE_MATTER_DTO_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(dtoAsRecord, f)) {
      fullMatter[f] = dtoAsRecord[f];
    }
  }
  const validation = validateMatter(fullMatter);
  if (!validation.ok) {
    const first = validation.errors[0];
    return {
      ok: false,
      error: makeInvalidPayload("persistence schema violation", {
        schemaPath: first?.schemaPath,
        keyword: first?.keyword,
      }),
    };
  }
  try {
    const { persistence } = provide();
    const created = await persistence.createMatter(validation.value);
    return { ok: true, value: created };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.matterCreate }) };
  }
}

export async function getMatterHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<GetMatterResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of GET_MATTER_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(GET_MATTER_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in GetMatterDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as GetMatterDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("matterId must be a non-empty string"),
    };
  }
  try {
    const { persistence } = provide();
    const value = await persistence.getMatter(dto.matterId);
    if (value === null) return { ok: true, value: null };
    if (value.tenant_id !== getActiveTenantId()) {
      // Defense-in-depth: v1 is single-tenant so this is unreachable in
      // normal flow, but the boundary must enforce tenant scope on every
      // lookup so future multi-tenant runtime state cannot leak by id.
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.matterGet }) };
  }
}

export async function listMattersHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListMattersResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_MATTERS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_MATTERS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListMattersDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ListMattersDto;
  if (dto.status !== undefined && dto.status !== "active" && dto.status !== "archived") {
    return {
      ok: false,
      error: makeInvalidPayload("status must be 'active' or 'archived'"),
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
    const page = await persistence.listMatters({
      tenant_id: getActiveTenantId(),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    return { ok: true, value: page };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.matterList }) };
  }
}

export async function archiveMatterHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ArchiveMatterResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of ARCHIVE_MATTER_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(ARCHIVE_MATTER_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ArchiveMatterDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ArchiveMatterDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("matterId must be a non-empty string"),
    };
  }
  if (typeof dto.reason !== "string" || dto.reason.trim().length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("reason must be a non-empty string"),
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
    const matter = await persistence.archiveMatter(dto.matterId, {
      actor_user_id: getActiveActorUserId(),
      reason: dto.reason,
    });
    return { ok: true, value: matter };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.matterArchive }) };
  }
}
