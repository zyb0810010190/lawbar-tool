// T3 证据目录及说明 preview IPC handler (WI-FORMS-T3-S2-CATALOG-PREVIEW-00).
// ONE read-only channel: reads the matter + DRAINS all status:"accepted" evidence
// pages, then calls the MERGED S1 buildT3CatalogModel ONCE over the complete set
// (S1 is the single source of truth — never re-implemented). Mirrors the
// document/matter read-channel scoping: tenant injection + matter-existence check
// BEFORE any evidence read, forbidden-DTO rejection, and refusal-not-crash mapping.
//
// A submitter refusal is an EXPECTED review state carried in the SUCCESS value as a
// discriminated union { kind: "refusal", code }; a read error stays { ok: false, error }.
// The handler NEVER returns null and NEVER lets a T3CatalogRefusal escape as a crash.

import type { CaseBoxEvidenceItem } from "case-box-contract";

import {
  T3_PREVIEW_CATALOG_DTO_FIELDS,
  T3_PREVIEW_CATALOG_FORBIDDEN_FIELDS,
  type T3PreviewCatalogDto,
  type T3PreviewCatalogResult,
  type T3SubmitterSelectionDto,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import {
  CHANNEL,
  isPlainJsonObject,
  shapeGuardFailure,
  forbiddenFieldFailure,
  type PersistenceProvider,
} from "./handlerShared.js";
import {
  buildT3CatalogModel,
  t3CatalogModelSha256,
  T3CatalogRefusal,
} from "./export/t3CatalogModel.js";

// Bounded page size for the accepted-evidence drain. S1 numbers 序号 over the FULL
// input, so the handler loops until next_cursor === null (never a single page).
const EVIDENCE_PAGE_LIMIT = 200;
// Defensive upper bound on drain iterations; never expected to trip in practice.
// Guards against a misbehaving cursor that never terminates.
const MAX_EVIDENCE_PAGES = 100000;

// Validate an optional submitterSelection: a plain object with EXACTLY an integer
// partyIndex + a string displayNameEcho. Anything else → invalid_payload (the model
// then refuses/accepts it deterministically once the shape is well-formed).
function validateSubmitterSelection(
  raw: unknown,
): { readonly ok: true; readonly value: T3SubmitterSelectionDto } | { readonly ok: false; readonly field?: string } {
  if (!isPlainJsonObject(raw)) return { ok: false };
  for (const key of Object.keys(raw)) {
    if (key !== "partyIndex" && key !== "displayNameEcho") return { ok: false, field: key };
  }
  const partyIndex = raw.partyIndex;
  const displayNameEcho = raw.displayNameEcho;
  if (typeof partyIndex !== "number" || !Number.isInteger(partyIndex)) return { ok: false, field: "partyIndex" };
  if (typeof displayNameEcho !== "string") return { ok: false, field: "displayNameEcho" };
  return { ok: true, value: { partyIndex, displayNameEcho } };
}

export async function previewT3CatalogHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<T3PreviewCatalogResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of T3_PREVIEW_CATALOG_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(T3_PREVIEW_CATALOG_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in T3PreviewCatalogDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as T3PreviewCatalogDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  let submitterSelection: T3SubmitterSelectionDto | undefined;
  if (dto.submitterSelection !== undefined) {
    const checked = validateSubmitterSelection(dto.submitterSelection);
    if (!checked.ok) {
      return {
        ok: false,
        error: makeInvalidPayload(
          "submitterSelection must be { partyIndex: integer, displayNameEcho: string }",
          checked.field !== undefined ? { schemaPath: checked.field } : undefined,
        ),
      };
    }
    submitterSelection = checked.value;
  }
  try {
    const { persistence } = provide();
    // Matter existence + active-tenant check BEFORE any evidence read.
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) {
      return { ok: false, error: makeBoundaryError("unknown_matter") };
    }
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    // Drain ALL accepted-evidence pages before building — S1 assigns order/序号 over
    // the FULL input, so a single truncated page would misnumber the catalog. The
    // drain MUST reach next_cursor === null; a non-terminating cursor source (a
    // repeating cursor, or MAX_EVIDENCE_PAGES exhausted without a null) is an ERROR,
    // never a silently-truncated (mis-numbered) partial model.
    const evidenceItems: CaseBoxEvidenceItem[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let drained = false;
    for (let page = 0; page < MAX_EVIDENCE_PAGES; page++) {
      const result = await persistence.listEvidenceItems({
        tenant_id: getActiveTenantId(),
        matter_id: dto.matterId,
        status: "accepted",
        limit: EVIDENCE_PAGE_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      for (const row of result.rows) evidenceItems.push(row);
      if (result.next_cursor === null) {
        drained = true;
        break;
      }
      // A cursor we have already followed means a looping/non-terminating cursor
      // source: STOP and error rather than build over an incomplete set.
      if (seenCursors.has(result.next_cursor)) {
        return {
          ok: false,
          error: mapThrownError(
            new Error("evidence pagination did not terminate for T3 catalog preview"),
            { channel: CHANNEL.t3PreviewCatalog },
          ),
        };
      }
      seenCursors.add(result.next_cursor);
      cursor = result.next_cursor;
    }
    // Reached the defensive page bound without observing next_cursor === null:
    // treat as non-termination, never build a truncated catalog.
    if (!drained) {
      return {
        ok: false,
        error: mapThrownError(
          new Error("evidence pagination did not terminate for T3 catalog preview"),
          { channel: CHANNEL.t3PreviewCatalog },
        ),
      };
    }
    try {
      const model = buildT3CatalogModel({
        matter,
        evidenceItems,
        ...(submitterSelection !== undefined ? { submitterSelection } : {}),
      });
      return { ok: true, value: { kind: "model", model, modelSha256: t3CatalogModelSha256(model) } };
    } catch (err) {
      // A submitter refusal is an EXPECTED review state, not an error/crash.
      if (err instanceof T3CatalogRefusal) {
        return { ok: true, value: { kind: "refusal", code: err.code } };
      }
      throw err;
    }
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.t3PreviewCatalog }) };
  }
}
