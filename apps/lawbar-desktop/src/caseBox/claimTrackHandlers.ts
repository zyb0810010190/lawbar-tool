// ClaimTrack IPC handlers (WI-PTA-VS2). Read: listClaimTracksHandler. Write:
// createClaimTrackHandler (a single manual lawyer-authored write; no update /
// withdraw / resolve / delete). Mirrors the fact/matter case-box precedent:
// matter existence + active-tenant check BEFORE persistence (closes
// VS0-TENANT-1), server-side authority injection, a handler party-ref preflight
// (unknown_party — defense-in-depth over VS-1 persistence's source-of-truth
// check), validate-before-persist, and a renderer-safe allowlisted projection.
// `status` is server-set to "active" at create; created_at === updated_at.

import { validateClaimTrack } from "case-box-contract";

import {
  CREATE_CLAIM_TRACK_DTO_FIELDS,
  CREATE_CLAIM_TRACK_FORBIDDEN_FIELDS,
  CREATE_CLAIM_TRACK_RESPONSE_FIELDS,
  LIST_CLAIM_TRACKS_DTO_FIELDS,
  LIST_CLAIM_TRACKS_FORBIDDEN_FIELDS,
  type CreateClaimTrackDto,
  type CreateClaimTrackResult,
  type ListClaimTracksDto,
  type ListClaimTracksResult,
  type RendererClaimTrackRow,
  type RendererCreatedClaimTrack,
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
  type ClockFn,
  type PersistenceProvider,
} from "./handlerShared.js";

// track_type / our_role controlled vocab (case-box-claim-track.schema.json). The
// handler validates the value here; persistence + the schema re-validate.
const TRACK_TYPES = Object.freeze(["main_claim", "counterclaim"] as const);
const OUR_ROLES = Object.freeze(["asserting", "responding"] as const);
// The four free-text summaries default to "" when absent (the schema requires
// the keys present with empty allowed); when supplied they must be strings.
const OPTIONAL_SUMMARY_FIELDS = Object.freeze([
  "claim_summary",
  "response_summary",
  "legal_basis",
  "calculation_summary",
] as const);

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// --- create a manual lawyer-authored claim track ---------------------------
// The renderer supplies the content fields + the scope (matterId) + sort_order;
// the server injects id / tenant_id / actor_user_id / status="active" /
// created_at === updated_at. Two preflights run BEFORE persistence: the
// matter+tenant check (fail-closed against a foreign matter) and the party-ref
// check (fail-closed against a claimant/respondent id not on the loaded matter).
export async function createClaimTrackHandler(
  payload: unknown,
  provide: PersistenceProvider,
  now: ClockFn,
  idFactory: () => string,
): Promise<CreateClaimTrackResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CREATE_CLAIM_TRACK_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(CREATE_CLAIM_TRACK_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in CreateClaimTrackDto", { schemaPath: key }),
      };
    }
  }
  // Own-keys-only, null-prototype view. The shape guard already rejects any
  // payload whose prototype isn't exactly Object.prototype, but the required
  // field READS below use property access; reading from a null-prototype object
  // holding ONLY the copied own keys makes those reads self-defensive — a
  // globally-polluted Object.prototype can never leak an inherited value into a
  // field that was never an actual own key.
  const own: Record<string, unknown> = Object.create(null);
  for (const k of CREATE_CLAIM_TRACK_DTO_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) own[k] = (payload as Record<string, unknown>)[k];
  }
  const dto = own as unknown as CreateClaimTrackDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!(TRACK_TYPES as readonly string[]).includes(dto.track_type)) {
    return { ok: false, error: makeInvalidPayload("track_type must be main_claim | counterclaim") };
  }
  if (!(OUR_ROLES as readonly string[]).includes(dto.our_role)) {
    return { ok: false, error: makeInvalidPayload("our_role must be asserting | responding") };
  }
  if (!nonEmptyString(dto.claimant_party_id)) {
    return { ok: false, error: makeInvalidPayload("claimant_party_id must be a non-empty string") };
  }
  if (!nonEmptyString(dto.respondent_party_id)) {
    return { ok: false, error: makeInvalidPayload("respondent_party_id must be a non-empty string") };
  }
  if (!nonEmptyString(dto.title)) {
    return { ok: false, error: makeInvalidPayload("title must be a non-empty string") };
  }
  if (
    typeof dto.sort_order !== "number" ||
    !Number.isInteger(dto.sort_order) ||
    dto.sort_order < 0
  ) {
    return { ok: false, error: makeInvalidPayload("sort_order must be an integer >= 0") };
  }
  for (const f of OPTIONAL_SUMMARY_FIELDS) {
    const v = own[f];
    if (v !== undefined && typeof v !== "string") {
      return {
        ok: false,
        error: makeInvalidPayload(`${f}, when present, must be a string`, { schemaPath: f }),
      };
    }
  }
  try {
    const { persistence } = provide();
    // Matter + tenant preflight BEFORE persistence (closes VS0-TENANT-1). A
    // foreign matter never reaches createClaimTrack.
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // R5 party-ref preflight (defense-in-depth over VS-1's source-of-truth
    // check): the claimant/respondent party ids MUST exist on the loaded
    // matter's parties[]. VS-0 guarantees every real party carries a ULID, so a
    // missing reference is a genuine error — refuse with unknown_party BEFORE
    // the write (no row, no event).
    const partyIds = new Set<string>();
    for (const party of matter.parties) {
      if (typeof party.id === "string" && party.id.length > 0) partyIds.add(party.id);
    }
    if (!partyIds.has(dto.claimant_party_id) || !partyIds.has(dto.respondent_party_id)) {
      return { ok: false, error: makeBoundaryError("unknown_party") };
    }
    const nowIso = now().toISOString();
    const fullRow: Record<string, unknown> = {
      id: idFactory(),
      tenant_id: getActiveTenantId(),
      actor_user_id: getActiveActorUserId(),
      matter_id: dto.matterId,
      track_type: dto.track_type,
      claimant_party_id: dto.claimant_party_id,
      respondent_party_id: dto.respondent_party_id,
      our_role: dto.our_role,
      title: dto.title,
      claim_summary: dto.claim_summary ?? "",
      response_summary: dto.response_summary ?? "",
      legal_basis: dto.legal_basis ?? "",
      calculation_summary: dto.calculation_summary ?? "",
      status: "active",
      sort_order: dto.sort_order,
      created_at: nowIso,
      updated_at: nowIso,
    };
    // R8 validate-before-persist (a claim track has many required fields);
    // persistence remains the source of truth and re-validates.
    const validation = validateClaimTrack(fullRow);
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
    const created = await persistence.createClaimTrack(validation.value);
    // Project to the renderer-safe allowlist (strip tenant_id / actor_user_id /
    // any open-index extras before crossing the IPC boundary).
    return {
      ok: true,
      value: projectRow<RendererCreatedClaimTrack>(
        created as unknown as Record<string, unknown>,
        CREATE_CLAIM_TRACK_RESPONSE_FIELDS,
      ),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.claimTrackCreate }) };
  }
}

// --- list a matter's claim tracks ------------------------------------------
// Matter-scoped, unpaginated (R4). Matter+tenant preflight before the read; the
// server injects tenant_id and projects every row through the renderer-safe
// allowlist. Returns a projected ARRAY (not a { rows, next_cursor } page).
export async function listClaimTracksHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListClaimTracksResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_CLAIM_TRACKS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) return forbiddenFieldFailure(f);
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_CLAIM_TRACKS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListClaimTracksDto", { schemaPath: key }),
      };
    }
  }
  // Own-keys-only, null-prototype view (see createClaimTrackHandler): read
  // matterId from the copied own key, never from the raw payload, so an
  // inherited Object.prototype value can never satisfy the required read.
  const own: Record<string, unknown> = Object.create(null);
  for (const k of LIST_CLAIM_TRACKS_DTO_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) own[k] = (payload as Record<string, unknown>)[k];
  }
  const dto = own as unknown as ListClaimTracksDto;
  if (!nonEmptyString(dto.matterId)) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  try {
    const { persistence } = provide();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) return { ok: false, error: makeBoundaryError("unknown_matter") };
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const rows = await persistence.listClaimTracks({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
    });
    return {
      ok: true,
      value: rows.map((r) =>
        projectRow<RendererClaimTrackRow>(
          r as unknown as Record<string, unknown>,
          CREATE_CLAIM_TRACK_RESPONSE_FIELDS,
        ),
      ),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.claimTrackList }) };
  }
}
