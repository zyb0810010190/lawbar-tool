// Evidence link IPC handlers (WI-A3-LINK-IPC-T1): the audited link lifecycle —
// create / unlink / relink / list / export-citations. Mirrors factHandlers.ts
// EXACTLY: shape-guard -> forbidden-field -> unknown-field -> DTO validation ->
// getMatter preflight (unknown_matter / tenant_mismatch) -> persistence call ->
// projectRow (authority-stripping allowlist) -> mapThrownError.
//
// SQLite-only: the link lifecycle lives on the concrete SqliteCaseBoxPersistence
// (createLink / unlinkLink / relinkLink are NOT on the shared interface) plus the
// standalone resolveLinkStatuses / buildExportCitations which read the raw
// Database. The LinkPersistenceProvider surfaces both.
//
// unlink/relink mirror transitionFactHandler's SCOPED preflight: the persistence
// unlink/relink methods are UNSCOPED (linkId only), so the handler verifies the
// link exists UNDER the active tenant + this matter and rejects a miss with
// invalid_payload WITHOUT calling the operation — fail-closed against confirming
// a guessed foreign linkId cross-matter/tenant.

import {
  CREATE_LINK_DTO_FIELDS,
  CREATE_LINK_FORBIDDEN_FIELDS,
  UNLINK_LINK_DTO_FIELDS,
  UNLINK_LINK_FORBIDDEN_FIELDS,
  RELINK_LINK_DTO_FIELDS,
  RELINK_LINK_FORBIDDEN_FIELDS,
  LIST_LINKS_DTO_FIELDS,
  LIST_LINKS_FORBIDDEN_FIELDS,
  EXPORT_LINK_CITATIONS_DTO_FIELDS,
  EXPORT_LINK_CITATIONS_FORBIDDEN_FIELDS,
  LINK_RESPONSE_FIELDS,
  type CreateLinkDto,
  type CreateLinkResult,
  type UnlinkLinkDto,
  type UnlinkLinkResult,
  type RelinkLinkDto,
  type RelinkLinkResult,
  type ListLinksDto,
  type ListLinksResult,
  type ExportLinkCitationsDto,
  type ExportLinkCitationsResult,
  type RendererLink,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import { getActiveActorUserId } from "../security/activeActor.js";
import { resolveLinkStatuses, buildExportCitations } from "case-box-persistence";
import {
  CHANNEL,
  isPlainJsonObject,
  shapeGuardFailure,
  forbiddenFieldFailure,
  projectRow,
  type LinkPersistenceProvider,
} from "./handlerShared.js";

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// The case_box_links source_type CHECK set (V11 schema). Validated at the IPC
// boundary (fail-fast); persistence is the second guard.
const LINK_SOURCE_TYPES = ["evidence", "note", "question", "calcTerm", "claimElement"] as const;

// SELECT for the renderer-safe link list. Enumerates exactly the
// LINK_RESPONSE_FIELDS columns (tenant_id / payload_json never selected).
const LIST_LINKS_SQL =
  "SELECT id, matter_id, source_type, source_id, anchor_id, status, created_at, unlinked_at, unlink_reason " +
  "FROM case_box_links WHERE tenant_id = ? AND matter_id = ? ORDER BY id";

// Scoped link-existence preflight (mirrors transitionFactHandler). The link must
// exist UNDER the active tenant + this matter.
const SCOPED_LINK_EXISTS_SQL =
  "SELECT 1 FROM case_box_links WHERE id = ? AND tenant_id = ? AND matter_id = ?";

export async function createLinkHandler(
  payload: unknown,
  provide: LinkPersistenceProvider,
): Promise<CreateLinkResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CREATE_LINK_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(CREATE_LINK_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in CreateLinkDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as CreateLinkDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.sourceType)) {
    return { ok: false, error: makeInvalidPayload("sourceType must be a non-empty string") };
  }
  // IPC-side enum check (the case_box_links source_type CHECK set); fail-fast at the
  // boundary before calling persistence (audit LINK-IPC-L1). Persistence is the second guard.
  if (!(LINK_SOURCE_TYPES as readonly string[]).includes(dto.sourceType)) {
    return {
      ok: false,
      error: makeInvalidPayload(`sourceType must be one of ${LINK_SOURCE_TYPES.join(", ")}`, {
        schemaPath: "sourceType",
      }),
    };
  }
  if (!nonEmptyString(dto.sourceId)) {
    return { ok: false, error: makeInvalidPayload("sourceId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.anchorId)) {
    return { ok: false, error: makeInvalidPayload("anchorId must be a non-empty string") };
  }
  try {
    const { persistence } = provide();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const row = await persistence.createLink({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      source_type: dto.sourceType,
      source_id: dto.sourceId,
      anchor_id: dto.anchorId,
      actor_user_id: getActiveActorUserId(),
    });
    return {
      ok: true,
      value: projectRow<RendererLink>(row as unknown as Record<string, unknown>, LINK_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.linkCreate }) };
  }
}

export async function unlinkLinkHandler(
  payload: unknown,
  provide: LinkPersistenceProvider,
): Promise<UnlinkLinkResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of UNLINK_LINK_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(UNLINK_LINK_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in UnlinkLinkDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as UnlinkLinkDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.linkId)) {
    return { ok: false, error: makeInvalidPayload("linkId must be a non-empty string") };
  }
  if (typeof dto.unlinkReason !== "string" || dto.unlinkReason.trim().length === 0) {
    return { ok: false, error: makeInvalidPayload("unlinkReason must be a non-empty, non-blank string") };
  }
  try {
    const { persistence, db } = provide();
    const tenantId = getActiveTenantId();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // SCOPED preflight: unlinkLink is unscoped, so a miss here means unknown /
    // wrong-matter / wrong-tenant linkId -> reject WITHOUT unlinking (fail-closed).
    const exists = db.prepare(SCOPED_LINK_EXISTS_SQL).get(dto.linkId, tenantId, dto.matterId);
    if (exists === undefined) {
      return { ok: false, error: makeInvalidPayload("linkId does not reference a link in this matter") };
    }
    const row = await persistence.unlinkLink(dto.linkId, {
      actor_user_id: getActiveActorUserId(),
      unlink_reason: dto.unlinkReason,
    });
    return {
      ok: true,
      value: projectRow<RendererLink>(row as unknown as Record<string, unknown>, LINK_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.linkUnlink }) };
  }
}

export async function relinkLinkHandler(
  payload: unknown,
  provide: LinkPersistenceProvider,
): Promise<RelinkLinkResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of RELINK_LINK_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(RELINK_LINK_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in RelinkLinkDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as RelinkLinkDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.linkId)) {
    return { ok: false, error: makeInvalidPayload("linkId must be a non-empty string") };
  }
  try {
    const { persistence, db } = provide();
    const tenantId = getActiveTenantId();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const exists = db.prepare(SCOPED_LINK_EXISTS_SQL).get(dto.linkId, tenantId, dto.matterId);
    if (exists === undefined) {
      return { ok: false, error: makeInvalidPayload("linkId does not reference a link in this matter") };
    }
    const row = await persistence.relinkLink(dto.linkId, {
      actor_user_id: getActiveActorUserId(),
    });
    return {
      ok: true,
      value: projectRow<RendererLink>(row as unknown as Record<string, unknown>, LINK_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.linkRelink }) };
  }
}

export async function listLinksHandler(
  payload: unknown,
  provide: LinkPersistenceProvider,
): Promise<ListLinksResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_LINKS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_LINKS_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in ListLinksDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as ListLinksDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  try {
    const { persistence, db } = provide();
    const tenantId = getActiveTenantId();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // Refresh case_box_links.status BEFORE reading, so the renderer sees the
    // resolver's authoritative status (the only write).
    resolveLinkStatuses(db, { tenant_id: tenantId, matter_id: dto.matterId });
    const rows = db.prepare(LIST_LINKS_SQL).all(tenantId, dto.matterId) as Record<string, unknown>[];
    return {
      ok: true,
      value: rows.map((r) => projectRow<RendererLink>(r, LINK_RESPONSE_FIELDS)),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.linkList }) };
  }
}

export async function exportLinkCitationsHandler(
  payload: unknown,
  provide: LinkPersistenceProvider,
): Promise<ExportLinkCitationsResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of EXPORT_LINK_CITATIONS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(EXPORT_LINK_CITATIONS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ExportLinkCitationsDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ExportLinkCitationsDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  try {
    const { persistence, db } = provide();
    const tenantId = getActiveTenantId();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== tenantId) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // The export result carries no actor/tenant authority fields (deterministic
    // citation set + byFlag counts), so it is returned verbatim.
    const result = buildExportCitations(db, { tenant_id: tenantId, matter_id: dto.matterId });
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.linkExport }) };
  }
}
