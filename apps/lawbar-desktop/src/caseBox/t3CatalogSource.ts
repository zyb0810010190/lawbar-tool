// T3 证据目录及说明 model-source helper (WI-FORMS-T3-S3-DOCX-EXPORT-00).
//
// Mechanical, no-behavior-change extraction of the matter+drain+buildT3CatalogModel
// logic that previously lived inline in t3Handlers.ts (the S2 preview). BOTH the S2
// preview channel (casebox:t3:previewCatalog) and the S3 DOCX export channel
// (casebox:t3:exportDocx) build the model from the SAME source through this one helper,
// so the drain / tenant-scoping / refusal semantics can never diverge between preview
// and export.
//
// The helper returns a DISCRIMINATED result the caller maps to its own envelope:
//   - { kind: "model" }   → a built T3CatalogModel (caller packs/serializes as needed)
//   - { kind: "refusal" } → an EXPECTED submitter-review state (never an error/crash)
//   - { kind: "error" }   → an IPC error envelope (invalid payload / boundary / drain)
//
// DTO validation precedes any persistence read; matter existence + active-tenant checks
// precede any evidence read; the accepted-evidence pages are DRAINED to next_cursor ===
// null (S1 numbers 序号 over the FULL input) with repeated-cursor + page-cap guards so a
// truncated/mis-numbered model can never be built.

import type { CaseBoxEvidenceItem } from "case-box-contract";

import {
  T3_PREVIEW_CATALOG_DTO_FIELDS,
  T3_PREVIEW_CATALOG_FORBIDDEN_FIELDS,
  type IpcErrorEnvelope,
  type T3PreviewCatalogDto,
  type T3SubmitterSelectionDto,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import { isPlainJsonObject, type PersistenceProvider } from "./handlerShared.js";
import {
  buildT3CatalogModel,
  T3CatalogRefusal,
  type T3CatalogModel,
  type T3RefusalCode,
} from "./export/t3CatalogModel.js";

// Bounded page size for the accepted-evidence drain. S1 numbers 序号 over the FULL
// input, so the drain loops until next_cursor === null (never a single page).
const EVIDENCE_PAGE_LIMIT = 200;
// Defensive upper bound on drain iterations; never expected to trip in practice.
// Guards against a misbehaving cursor that never terminates.
const MAX_EVIDENCE_PAGES = 100000;

/** Discriminated model-source outcome consumed by the preview + export handlers. */
export type T3CatalogSourceResult =
  | { readonly kind: "model"; readonly model: T3CatalogModel }
  | { readonly kind: "refusal"; readonly code: T3RefusalCode }
  | { readonly kind: "error"; readonly error: IpcErrorEnvelope };

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

/**
 * Validate the DTO, preflight the matter + active tenant, drain all accepted evidence,
 * and build the S1 model. `channel` is used only for the diagnostic log prefix on a
 * drain/thrown error (so preview and export log under their own channel name).
 */
export async function buildT3CatalogModelForMatter(
  payload: unknown,
  provide: PersistenceProvider,
  channel: string,
): Promise<T3CatalogSourceResult> {
  if (!isPlainJsonObject(payload)) {
    return { kind: "error", error: makeInvalidPayload("DTO must be a plain JSON-shaped object") };
  }
  for (const f of T3_PREVIEW_CATALOG_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return {
        kind: "error",
        error: makeInvalidPayload("DTO contains a server-authority field", { schemaPath: f }),
      };
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(T3_PREVIEW_CATALOG_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        kind: "error",
        error: makeInvalidPayload("unknown field in T3PreviewCatalogDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as T3PreviewCatalogDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return { kind: "error", error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  let submitterSelection: T3SubmitterSelectionDto | undefined;
  if (dto.submitterSelection !== undefined) {
    const checked = validateSubmitterSelection(dto.submitterSelection);
    if (!checked.ok) {
      return {
        kind: "error",
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
      return { kind: "error", error: makeBoundaryError("unknown_matter") };
    }
    if (matter.tenant_id !== getActiveTenantId()) {
      return { kind: "error", error: makeBoundaryError("tenant_mismatch") };
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
          kind: "error",
          error: mapThrownError(
            new Error("evidence pagination did not terminate for T3 catalog"),
            { channel },
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
        kind: "error",
        error: mapThrownError(
          new Error("evidence pagination did not terminate for T3 catalog"),
          { channel },
        ),
      };
    }
    try {
      const model = buildT3CatalogModel({
        matter,
        evidenceItems,
        ...(submitterSelection !== undefined ? { submitterSelection } : {}),
      });
      return { kind: "model", model };
    } catch (err) {
      // A submitter refusal is an EXPECTED review state, not an error/crash.
      if (err instanceof T3CatalogRefusal) {
        return { kind: "refusal", code: err.code };
      }
      throw err;
    }
  } catch (err) {
    return { kind: "error", error: mapThrownError(err, { channel }) };
  }
}
