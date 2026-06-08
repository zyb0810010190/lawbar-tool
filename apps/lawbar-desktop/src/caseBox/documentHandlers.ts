// Document IPC handlers (list / get / register). Mechanically extracted from
// handlers.ts (no behavior change). DOC_TYPES + RegisterDocumentDeps live here
// because only the register handler uses them.

import { validateDocument } from "case-box-contract";

import {
  LIST_DOCUMENTS_DTO_FIELDS,
  LIST_DOCUMENTS_FORBIDDEN_FIELDS,
  LIST_DOCUMENTS_RESPONSE_FIELDS,
  GET_DOCUMENT_DTO_FIELDS,
  GET_DOCUMENT_FORBIDDEN_FIELDS,
  GET_DOCUMENT_RESPONSE_FIELDS,
  REGISTER_DOCUMENT_DTO_FIELDS,
  REGISTER_DOCUMENT_FORBIDDEN_FIELDS,
  REGISTER_DOCUMENT_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type ListDocumentsDto,
  type GetDocumentDto,
  type RegisterDocumentDto,
  type DocType,
  type ListDocumentsResult,
  type GetDocumentResult,
  type RegisterDocumentResult,
  type RendererDocumentRow,
  type RendererDocumentDetail,
  type RendererRegisteredDocument,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import { getActiveActorUserId } from "../security/activeActor.js";
import {
  CHANNEL,
  isPlainJsonObject,
  shapeGuardFailure,
  forbiddenFieldFailure,
  projectPage,
  projectRow,
  type PersistenceProvider,
  type ClockFn,
} from "./handlerShared.js";

const DOC_TYPES: ReadonlyArray<DocType> = [
  "pleading",
  "contract",
  "correspondence",
  "transcript",
  "exhibit",
  "other",
];

// Injected main-process side effects for document registration. Kept as
// dependencies so the handler logic is unit-testable WITHOUT Electron's dialog
// or the real filesystem; production wires the dialog + documentStorage util.
export interface RegisterDocumentDeps {
  // Opens the OS file chooser in main; null when the user cancels. The renderer
  // never supplies a filesystem path — this is the only source of the path.
  readonly chooseFile: () => Promise<{ readonly sourcePath: string; readonly filename: string } | null>;
  // Hashes + copies the chosen file into app-controlled storage; returns the
  // computed content_hash / storage_uri / byte_size / stored filename.
  readonly storeFile: (a: {
    readonly sourcePath: string;
    readonly documentId: string;
    readonly filename: string;
  }) => Promise<{
    readonly content_hash: string;
    readonly storage_uri: string;
    readonly byte_size: number;
    readonly stored_filename: string;
  }>;
  readonly now: ClockFn;
  readonly idFactory: () => string;
}

export async function listDocumentsHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListDocumentsResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_DOCUMENTS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_DOCUMENTS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListDocumentsDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ListDocumentsDto;
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
    const page = await persistence.listDocuments({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    // Project every row to the renderer-safe allowlist so server-authority
    // fields (tenant_id / actor_user_id / custody_chain) never cross the IPC
    // boundary. next_cursor is preserved unchanged.
    return {
      ok: true,
      value: projectPage<RendererDocumentRow>(page, LIST_DOCUMENTS_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.documentList }) };
  }
}

export async function getDocumentHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<GetDocumentResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of GET_DOCUMENT_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(GET_DOCUMENT_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in GetDocumentDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as GetDocumentDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (typeof dto.documentId !== "string" || dto.documentId.length === 0) {
    return { ok: false, error: makeInvalidPayload("documentId must be a non-empty string") };
  }
  try {
    const { persistence } = provide();
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) {
      return { ok: false, error: makeBoundaryError("unknown_matter") };
    }
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const document = await persistence.getDocument(dto.documentId);
    if (document === null) return { ok: true, value: null };
    // Defense-in-depth: a document fetched by id must belong to the active
    // tenant AND the requested matter, else it is out of scope for this view.
    if (document.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    if (document.matter_id !== dto.matterId) {
      return { ok: true, value: null };
    }
    // Project to the renderer-safe allowlist so server-authority fields
    // (tenant_id / actor_user_id / custody_chain) never cross the IPC boundary
    // on the get-document channel (GET-AUD-1; parallels the list projection).
    return {
      ok: true,
      value: projectRow<RendererDocumentDetail>(document, GET_DOCUMENT_RESPONSE_FIELDS),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.documentGet }) };
  }
}

export async function registerDocumentHandler(
  payload: unknown,
  provide: PersistenceProvider,
  deps: RegisterDocumentDeps,
): Promise<RegisterDocumentResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of REGISTER_DOCUMENT_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(REGISTER_DOCUMENT_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in RegisterDocumentDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as RegisterDocumentDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return { ok: false, error: makeInvalidPayload("matterId must be a non-empty string") };
  }
  if (!DOC_TYPES.includes(dto.doc_type as DocType)) {
    return { ok: false, error: makeInvalidPayload("doc_type must be a known document type") };
  }
  try {
    const { persistence } = provide();
    // Validate the matter (and tenant scope) BEFORE opening any dialog or
    // touching the filesystem.
    const matter = await persistence.getMatter(dto.matterId);
    if (matter === null) {
      return { ok: false, error: makeBoundaryError("unknown_matter") };
    }
    if (matter.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const chosen = await deps.chooseFile();
    if (chosen === null) {
      // User cancelled the file chooser — not an error.
      return { ok: true, value: null };
    }
    const documentId = deps.idFactory();
    const stored = await deps.storeFile({
      sourcePath: chosen.sourcePath,
      documentId,
      filename: chosen.filename,
    });
    const document: Record<string, unknown> = {
      id: documentId,
      tenant_id: getActiveTenantId(),
      actor_user_id: getActiveActorUserId(),
      matter_id: dto.matterId,
      source: "uploaded",
      filename: stored.stored_filename,
      content_hash: stored.content_hash,
      storage_uri: stored.storage_uri,
      doc_type: dto.doc_type,
      received_at: deps.now().toISOString(),
      status: "registered",
      byte_size: stored.byte_size,
    };
    const validation = validateDocument(document);
    if (!validation.ok) {
      const first = validation.errors[0];
      return {
        ok: false,
        error: makeInvalidPayload("document schema violation", {
          schemaPath: first?.schemaPath,
          keyword: first?.keyword,
        }),
      };
    }
    const registered = await persistence.registerDocument(dto.matterId, validation.value);
    // REGDOC-AUD-1: project to the renderer-safe allowlist (strip tenant_id /
    // actor_user_id / custody_chain / open-index extras before crossing IPC).
    return {
      ok: true,
      value: projectRow<RendererRegisteredDocument>(
        registered as unknown as Record<string, unknown>,
        REGISTER_DOCUMENT_RESPONSE_FIELDS,
      ),
    };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.documentRegister }) };
  }
}
