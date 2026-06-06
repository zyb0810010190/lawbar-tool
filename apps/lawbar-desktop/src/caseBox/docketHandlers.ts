// Docket-entry WRITE IPC handlers (WI-601): create (propose) + confirm.
// The v1 deadlines/to-dos path per brief §7/§10 is docket-entry propose -> confirm:
// appendDocketEntry creates a PROPOSED CaseBoxDocketEntry (D1 manual), and
// confirmDocketEntry materializes the CaseBoxDeadline that surfaces in listDeadlines.
//
// Security boundary (tenant-scoped writes):
//  - Every write checks matter existence + active-tenant BEFORE the write
//    (unknown_matter / tenant_mismatch), like the read handlers.
//  - confirmDocketEntry(entryId, opts) is UNSCOPED (no tenant/matter param), so
//    confirm does a SCOPED getDocketEntry({tenant_id, matter_id, entry_id}) preflight
//    and rejects a null result with invalid_payload WITHOUT calling confirmDocketEntry —
//    this is what prevents confirming a guessed foreign entry_id cross-matter/tenant
//    (fail-closed). Per WI-601 (user Option 1) we reuse the existing invalid_payload
//    code rather than add a new boundary code (no error-surface / persistence change).
//  - Responses are projected through dedicated renderer-safe allowlists (NOT the
//    list-row constants, NOT a raw persistence row), stripping actor/tenant identities.

import {
  CREATE_DOCKET_DTO_FIELDS,
  CREATE_DOCKET_FORBIDDEN_FIELDS,
  CONFIRM_DOCKET_DTO_FIELDS,
  CONFIRM_DOCKET_FORBIDDEN_FIELDS,
  DOCKET_ENTRY_RESPONSE_FIELDS,
  CONFIRM_DOCKET_DEADLINE_RESPONSE_FIELDS,
  LIST_DOCKET_DTO_FIELDS,
  LIST_DOCKET_FORBIDDEN_FIELDS,
  DOCKET_CONFIRMATION_STATES,
  DOCKET_SOURCE_TYPES,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type CreateDocketEntryDto,
  type CreateDocketEntryResult,
  type ConfirmDocketEntryDto,
  type ConfirmDocketEntryResult,
  type ListDocketEntriesDto,
  type ListDocketEntriesResult,
  type RendererDocketEntryRow,
  type RendererConfirmDeadlineRow,
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
  projectRow,
  projectPage,
  type PersistenceProvider,
} from "./handlerShared.js";

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// --- create (propose) a manual D1 docket entry -----------------------------
export async function createDocketEntryHandler(
  payload: unknown,
  provide: PersistenceProvider,
  now: ClockFn,
  idFactory: () => string,
): Promise<CreateDocketEntryResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CREATE_DOCKET_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(CREATE_DOCKET_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in CreateDocketEntryDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as CreateDocketEntryDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.proposed_kind)) {
    return { ok: false, error: makeInvalidPayload("proposed_kind must be a non-empty string") };
  }
  if (!nonEmptyString(dto.proposed_due_at)) {
    return { ok: false, error: makeInvalidPayload("proposed_due_at must be a non-empty ISO-8601 datetime") };
  }
  if (!nonEmptyString(dto.proposed_due_at_timezone)) {
    return { ok: false, error: makeInvalidPayload("proposed_due_at_timezone must be a non-empty IANA timezone") };
  }
  if (dto.proposed_owner_user_id !== undefined && !nonEmptyString(dto.proposed_owner_user_id)) {
    return { ok: false, error: makeInvalidPayload("proposed_owner_user_id, when present, must be a non-empty string") };
  }
  try {
    const { persistence } = provide();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // Full contract-valid D1-manual proposed entry. Renderer supplies only the
    // proposed_* fields; everything else is server-injected (provenance null for
    // manual; lifecycle null until confirm/dismiss). proposed_due_at_kind is
    // always "datetime" (date_only confirmation is forbidden in v1).
    const nowIso = now().toISOString();
    const input = {
      id: idFactory(),
      tenant_id: getActiveTenantId(),
      actor_user_id: getActiveActorUserId(),
      matter_id: dto.matterId,
      source_type: "manual",
      proposed_kind: dto.proposed_kind,
      proposed_due_at: dto.proposed_due_at,
      proposed_due_at_kind: "datetime",
      proposed_due_at_timezone: dto.proposed_due_at_timezone,
      proposed_owner_user_id: dto.proposed_owner_user_id ?? getActiveActorUserId(),
      source_rule_citation: null,
      extractor_name: null,
      extractor_version: null,
      extraction_confidence: null,
      source_document_id: null,
      source_page_number: null,
      source_excerpt: null,
      reminder_offsets: [],
      confirmation_state: "proposed",
      proposed_at: nowIso,
      confirmation_actor_user_id: null,
      confirmed_at: null,
      confirmed_deadline_id: null,
      dismissal_actor_user_id: null,
      dismissed_at: null,
      dismissal_reason: null,
      created_at: nowIso,
    };
    const entry = await persistence.appendDocketEntry(input);
    return {
      ok: true,
      value: projectRow<RendererDocketEntryRow>(
        entry as unknown as Record<string, unknown>,
        DOCKET_ENTRY_RESPONSE_FIELDS,
      ),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.docketCreate }) };
  }
}

// --- confirm a proposed docket entry (materializes the deadline) -----------
export async function confirmDocketEntryHandler(
  payload: unknown,
  provide: PersistenceProvider,
  now: ClockFn,
  idFactory: () => string,
): Promise<ConfirmDocketEntryResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CONFIRM_DOCKET_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(CONFIRM_DOCKET_DTO_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: makeInvalidPayload("unknown field in ConfirmDocketEntryDto", { schemaPath: key }) };
    }
  }
  const dto = payload as unknown as ConfirmDocketEntryDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.entryId)) {
    return { ok: false, error: makeInvalidPayload("entryId must be a non-empty string") };
  }
  try {
    const { persistence } = provide();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // SCOPED preflight: the entry must exist UNDER this matter + active tenant.
    // confirmDocketEntry is unscoped, so a null here means unknown / wrong-matter /
    // wrong-tenant entry_id -> reject WITHOUT confirming (fail-closed).
    const existing = await persistence.getDocketEntry({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      entry_id: dto.entryId,
    });
    if (existing === null) {
      return {
        ok: false,
        error: makeInvalidPayload("entryId does not reference a confirmable docket entry in this matter"),
      };
    }
    const result = await persistence.confirmDocketEntry(dto.entryId, {
      confirmation_actor_user_id: getActiveActorUserId(),
      confirmed_at: now().toISOString(),
      deadline_id: idFactory(),
    });
    return {
      ok: true,
      value: {
        entry: projectRow<RendererDocketEntryRow>(
          result.entry as unknown as Record<string, unknown>,
          DOCKET_ENTRY_RESPONSE_FIELDS,
        ),
        deadline: projectRow<RendererConfirmDeadlineRow>(
          result.deadline as unknown as Record<string, unknown>,
          CONFIRM_DOCKET_DEADLINE_RESPONSE_FIELDS,
        ),
      },
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.docketConfirm }) };
  }
}

// --- list docket entries (read) --------------------------------------------
// WI-D1: surface durable docket entries (incl. confirmation_state="proposed"
// proposals that are otherwise lost from view after reload). Mirrors the
// read-list pattern (shape-guard -> forbidden-field guard -> unknown-field
// guard -> field validation -> getMatter existence + active-tenant -> read ->
// projectPage). Every row is projected through DOCKET_ENTRY_RESPONSE_FIELDS so
// tenant_id / actor_user_id / confirmation_actor_user_id / dismissal_actor_user_id
// never cross the IPC boundary. Read-only: no create/confirm/dismiss here.
export async function listDocketEntriesHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListDocketEntriesResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_DOCKET_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_DOCKET_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListDocketEntriesDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ListDocketEntriesDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (
    dto.confirmation_state !== undefined &&
    !(DOCKET_CONFIRMATION_STATES as readonly string[]).includes(dto.confirmation_state)
  ) {
    return {
      ok: false,
      error: makeInvalidPayload("confirmation_state must be one of proposed|confirmed|dismissed", {
        schemaPath: "confirmation_state",
      }),
    };
  }
  if (
    dto.source_type !== undefined &&
    !(DOCKET_SOURCE_TYPES as readonly string[]).includes(dto.source_type)
  ) {
    return {
      ok: false,
      error: makeInvalidPayload(
        "source_type must be one of manual|court_order_excerpt|llm_extraction|imported",
        { schemaPath: "source_type" },
      ),
    };
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
    const page = await persistence.listDocketEntries({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      ...(dto.confirmation_state !== undefined ? { confirmation_state: dto.confirmation_state } : {}),
      ...(dto.source_type !== undefined ? { source_type: dto.source_type } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    // Project every row to the renderer-safe allowlist so server-authority
    // identity fields never cross the IPC boundary. next_cursor preserved.
    return { ok: true, value: projectPage<RendererDocketEntryRow>(page, DOCKET_ENTRY_RESPONSE_FIELDS) };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.docketList }) };
  }
}
