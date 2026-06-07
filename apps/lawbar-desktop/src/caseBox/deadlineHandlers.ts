// Deadline IPC handlers. Read: listDeadlinesHandler. Write: transitionDeadlineHandler
// (WI-DT1, met / missed / withdrawn lifecycle incl. the audit-reason-required
// missed -> met edge). Mirrors the document/audit list handlers + the WI-802 fact
// transition handler: matter existence + active-tenant check before the read/write,
// server-side authority injection, renderer-safe allowlisted projection. The
// deadline state machine lives in persistence (illegal_transition is surfaced here,
// not re-implemented).

import {
  LIST_DEADLINES_DTO_FIELDS,
  LIST_DEADLINES_FORBIDDEN_FIELDS,
  LIST_DEADLINES_RESPONSE_FIELDS,
  TRANSITION_DEADLINE_DTO_FIELDS,
  TRANSITION_DEADLINE_FORBIDDEN_FIELDS,
  TRANSITION_DEADLINE_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ListDeadlinesDto,
  type ListDeadlinesResult,
  type RendererDeadlineRow,
  type TransitionDeadlineDto,
  type TransitionDeadlineResult,
  type RendererTransitionedDeadlineRow,
  type DeadlineTransitionTarget,
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

const DEADLINE_TRANSITION_TARGETS: ReadonlyArray<DeadlineTransitionTarget> = [
  "met",
  "missed",
  "withdrawn",
];

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

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

// transitionDeadlineHandler — mark a deadline met / missed / withdrawn (WI-DT1).
// Mirrors transitionFactHandler (WI-802). Security boundary:
// persistence.transitionDeadline(deadlineId, opts) is UNSCOPED (no tenant/matter),
// so the handler does a SCOPED getDeadline preflight and rejects a null with
// invalid_payload WITHOUT calling transitionDeadline — fail-closed against
// confirming a guessed foreign deadlineId cross-matter/tenant. The required-reason
// rule is EDGE-BOUND (missed -> met): it depends on the EXISTING status, which is
// only known after the preflight, so the reason decision happens post-preflight.
export async function transitionDeadlineHandler(
  payload: unknown,
  provide: PersistenceProvider,
  now: ClockFn,
): Promise<TransitionDeadlineResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of TRANSITION_DEADLINE_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(TRANSITION_DEADLINE_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in TransitionDeadlineDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as TransitionDeadlineDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!nonEmptyString(dto.deadlineId)) {
    return { ok: false, error: makeInvalidPayload("deadlineId must be a non-empty string") };
  }
  if (!(DEADLINE_TRANSITION_TARGETS as readonly string[]).includes(dto.to)) {
    return { ok: false, error: makeInvalidPayload("to must be one of met | missed | withdrawn") };
  }
  // transition_reason type is checked here; the required/forbidden-by-edge decision
  // is made after the scoped preflight reveals the current status.
  if (dto.transition_reason !== undefined && typeof dto.transition_reason !== "string") {
    return { ok: false, error: makeInvalidPayload("transition_reason must be a string") };
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
    // SCOPED preflight: the deadline must exist UNDER this matter + active tenant.
    // transitionDeadline is unscoped, so a null here means unknown / wrong-matter /
    // wrong-tenant deadline_id -> reject WITHOUT transitioning (fail-closed).
    const existing = await persistence.getDeadline({
      tenant_id: tenantId,
      matter_id: dto.matterId,
      deadline_id: dto.deadlineId,
    });
    if (existing === null) {
      return {
        ok: false,
        error: makeInvalidPayload("deadlineId does not reference a deadline in this matter"),
      };
    }
    // EDGE-BOUND reason rule: transition_reason is REQUIRED + non-empty IFF the
    // existing status is "missed" AND to is "met" (the audit-reason edge), and
    // FORBIDDEN (rejected, not dropped) for every other transition.
    const isMissedToMet = existing.status === "missed" && dto.to === "met";
    if (isMissedToMet) {
      if (!nonEmptyString(dto.transition_reason)) {
        return {
          ok: false,
          error: makeInvalidPayload(
            "transition_reason is required when transitioning a missed deadline to met",
          ),
        };
      }
    } else if (dto.transition_reason !== undefined) {
      return {
        ok: false,
        error: makeInvalidPayload(
          "transition_reason is only allowed when transitioning a missed deadline to met",
          { schemaPath: "transition_reason" },
        ),
      };
    }
    const deadline = await persistence.transitionDeadline(dto.deadlineId, {
      to: dto.to,
      actor_user_id: actorId,
      at: atIso,
      ...(isMissedToMet ? { transition_reason: dto.transition_reason } : {}),
    });
    return {
      ok: true,
      value: projectRow<RendererTransitionedDeadlineRow>(
        deadline as unknown as Record<string, unknown>,
        TRANSITION_DEADLINE_RESPONSE_FIELDS,
      ),
    };
  } catch (err) {
    // illegal_transition (e.g. met -> missed, withdrawn -> *) surfaces here.
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.deadlineTransition }) };
  }
}
