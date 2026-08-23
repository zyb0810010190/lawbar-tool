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
  MATTER_RESPONSE_FIELDS,
  UPDATE_MATTER_DETAILS_DTO_FIELDS,
  UPDATE_MATTER_DETAILS_PATCH_FIELDS,
  UPDATE_MATTER_DETAILS_FORBIDDEN_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type CreateMatterDto,
  type GetMatterDto,
  type ListMattersDto,
  type ArchiveMatterDto,
  type UpdateMatterDetailsDto,
  type UpdateMatterDetailsPatch,
  type CreateMatterResult,
  type GetMatterResult,
  type ListMattersResult,
  type ArchiveMatterResult,
  type UpdateMatterDetailsResult,
  type RendererMatter,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import { getActiveActorUserId } from "../security/activeActor.js";
import {
  CHANNEL,
  isPlainJsonObject,
  shapeGuardFailure,
  forbiddenFieldFailure,
  projectRow,
  projectPage,
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
    // MATTER-AUD-1: project to the renderer-safe allowlist (strip tenant_id /
    // actor_user_id / open-index extras before crossing the IPC boundary).
    return {
      ok: true,
      value: projectRow<RendererMatter>(created as unknown as Record<string, unknown>, MATTER_RESPONSE_FIELDS),
    };
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
    // MATTER-AUD-1: project AFTER the null + tenant-scope checks.
    return {
      ok: true,
      value: projectRow<RendererMatter>(value as unknown as Record<string, unknown>, MATTER_RESPONSE_FIELDS),
    };
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
    // MATTER-AUD-1: project every row to the renderer-safe allowlist; next_cursor preserved.
    return { ok: true, value: projectPage<RendererMatter>(page, MATTER_RESPONSE_FIELDS) };
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
    // MATTER-AUD-1: project to the renderer-safe allowlist.
    return {
      ok: true,
      value: projectRow<RendererMatter>(matter as unknown as Record<string, unknown>, MATTER_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.matterArchive }) };
  }
}

// --- edit a matter's 6 editable free-text fields (matter-details-edit Phase C) ---
// The renderer supplies { matterId, patch, reason }; the server injects the actor
// identity (NEVER from the renderer) and enforces tenant scope via a getMatter
// preflight (mirror archiveMatterHandler). `patch` is reduced to a null-prototype
// own-keys view of ONLY the 6 editable fields (prototype-pollution defense, as the
// VS-2 ClaimTrack handler does), so a smuggled server/lifecycle key or an
// inherited Object.prototype value can never reach persistence. Persistence
// remains the source of truth: it re-validates the patch, change-detects, rejects
// no-op / archived / desynced edits, and appends the single MATTER_DETAILS_UPDATED
// event. The response is projected through MATTER_RESPONSE_FIELDS (authority
// stripped); mapThrownError surfaces each persistence outcome as a safe code.
export async function updateMatterDetailsHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<UpdateMatterDetailsResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of UPDATE_MATTER_DETAILS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(UPDATE_MATTER_DETAILS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in UpdateMatterDetailsDto", { schemaPath: key }),
      };
    }
  }
  // Own-keys-only, null-prototype view of the top-level DTO (mirror the VS-2
  // ClaimTrack handler): read matterId / reason / patch from copied OWN keys so a
  // globally-polluted Object.prototype can never leak an inherited value into a
  // field that was never an actual own key.
  const own: Record<string, unknown> = Object.create(null);
  for (const k of UPDATE_MATTER_DETAILS_DTO_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) own[k] = (payload as Record<string, unknown>)[k];
  }
  const dto = own as unknown as UpdateMatterDetailsDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (typeof dto.reason !== "string" || dto.reason.trim().length === 0) {
    return { ok: false, error: makeInvalidPayload("reason must be a non-empty string") };
  }
  const rawPatch: unknown = own.patch;
  if (!isPlainJsonObject(rawPatch)) {
    return {
      ok: false,
      error: makeInvalidPayload("patch must be a plain object of editable matter fields"),
    };
  }
  // Own-keys-only, null-prototype view of the PATCH: copy ONLY the 6 editable own
  // keys. Any patch key outside that set is a hard reject BEFORE persistence, and
  // an inherited Object.prototype key is never copied — so persistence receives a
  // clean patch of exactly the editable fields the renderer actually supplied.
  const patch: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(rawPatch)) {
    if (!(UPDATE_MATTER_DETAILS_PATCH_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("patch contains a non-editable or unknown field", { schemaPath: key }),
      };
    }
    patch[key] = (rawPatch as Record<string, unknown>)[key];
  }
  try {
    const { persistence } = provide();
    // Matter + tenant preflight BEFORE the edit (mirror archiveMatterHandler): a
    // missing or foreign-tenant matter never reaches updateMatterDetails.
    const existing = await persistence.getMatter(dto.matterId);
    if (existing === null) {
      return { ok: false, error: makeBoundaryError("unknown_matter") };
    }
    if (existing.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const matter = await persistence.updateMatterDetails(dto.matterId, {
      // Server authority: the acting identity is injected here, NEVER supplied by
      // the renderer (the DTO forbids actor_user_id at the top level).
      patch: patch as unknown as UpdateMatterDetailsPatch,
      actor_user_id: getActiveActorUserId(),
      reason: dto.reason,
    });
    // MATTER-AUD-1: project to the renderer-safe allowlist (strip tenant_id / actor_user_id).
    return {
      ok: true,
      value: projectRow<RendererMatter>(matter as unknown as Record<string, unknown>, MATTER_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.matterUpdateDetails }) };
  }
}
