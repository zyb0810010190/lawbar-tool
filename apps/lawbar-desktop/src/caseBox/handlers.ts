import { validateMatter, validateDocument } from "case-box-contract";
import type { CaseBoxPersistence } from "case-box-persistence";

import {
  CREATE_MATTER_DTO_FIELDS,
  CREATE_MATTER_FORBIDDEN_FIELDS,
  LIST_MATTERS_DTO_FIELDS,
  LIST_MATTERS_FORBIDDEN_FIELDS,
  ARCHIVE_MATTER_DTO_FIELDS,
  ARCHIVE_MATTER_FORBIDDEN_FIELDS,
  GET_MATTER_DTO_FIELDS,
  GET_MATTER_FORBIDDEN_FIELDS,
  CHAIN_HEAD_DTO_FIELDS,
  CHAIN_HEAD_FORBIDDEN_FIELDS,
  LIST_AUDIT_EVENTS_DTO_FIELDS,
  LIST_AUDIT_EVENTS_FORBIDDEN_FIELDS,
  LIST_DOCUMENTS_DTO_FIELDS,
  LIST_DOCUMENTS_FORBIDDEN_FIELDS,
  GET_DOCUMENT_DTO_FIELDS,
  GET_DOCUMENT_FORBIDDEN_FIELDS,
  REGISTER_DOCUMENT_DTO_FIELDS,
  REGISTER_DOCUMENT_FORBIDDEN_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
  type CreateMatterDto,
  type GetMatterDto,
  type ListMattersDto,
  type ArchiveMatterDto,
  type ChainHeadDto,
  type ListAuditEventsDto,
  type ListDocumentsDto,
  type GetDocumentDto,
  type RegisterDocumentDto,
  type DocType,
  type CreateMatterResult,
  type GetMatterResult,
  type ListMattersResult,
  type ArchiveMatterResult,
  type ChainHeadResult,
  type ListAuditEventsResult,
  type ListDocumentsResult,
  type GetDocumentResult,
  type RegisterDocumentResult,
  type IpcEnvelope,
} from "./dto.js";
import { mapThrownError, makeInvalidPayload, makeBoundaryError } from "./errorMap.js";
import { getActiveTenantId } from "../security/activeTenant.js";
import { getActiveActorUserId } from "../security/activeActor.js";

export const CHANNEL = {
  matterCreate: "casebox:matter:create",
  matterGet: "casebox:matter:get",
  matterList: "casebox:matter:list",
  matterArchive: "casebox:matter:archive",
  auditChainHead: "casebox:audit:chainHead",
  auditListEvents: "casebox:audit:listEvents",
  documentList: "casebox:document:list",
  documentGet: "casebox:document:get",
  documentRegister: "casebox:document:register",
} as const;

export type PersistenceProvider = () => { readonly persistence: CaseBoxPersistence };
export type ClockFn = () => Date;

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

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint" || typeof v === "undefined") {
      return false;
    }
    if (v instanceof Date || v instanceof Map || v instanceof Set) return false;
  }
  return true;
}

function shapeGuardFailure<T>(): IpcEnvelope<T> {
  return {
    ok: false,
    error: makeInvalidPayload("DTO must be a plain JSON-shaped object"),
  };
}

function forbiddenFieldFailure<T>(field: string): IpcEnvelope<T> {
  return {
    ok: false,
    error: makeInvalidPayload("DTO contains a server-authority field", { schemaPath: field }),
  };
}

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

export async function chainHeadHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ChainHeadResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of CHAIN_HEAD_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(CHAIN_HEAD_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ChainHeadDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ChainHeadDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("matterId must be a non-empty string"),
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
    const head = await persistence.getAuditChainHead(dto.matterId);
    return { ok: true, value: head };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.auditChainHead }) };
  }
}

export async function listAuditEventsHandler(
  payload: unknown,
  provide: PersistenceProvider,
): Promise<ListAuditEventsResult> {
  if (!isPlainJsonObject(payload)) return shapeGuardFailure();
  for (const f of LIST_AUDIT_EVENTS_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, f)) {
      return forbiddenFieldFailure(f);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!(LIST_AUDIT_EVENTS_DTO_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: makeInvalidPayload("unknown field in ListAuditEventsDto", { schemaPath: key }),
      };
    }
  }
  const dto = payload as unknown as ListAuditEventsDto;
  if (typeof dto.matterId !== "string" || dto.matterId.length === 0) {
    return {
      ok: false,
      error: makeInvalidPayload("matterId must be a non-empty string"),
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
    const existing = await persistence.getMatter(dto.matterId);
    if (existing === null) {
      return { ok: false, error: makeBoundaryError("unknown_matter") };
    }
    if (existing.tenant_id !== getActiveTenantId()) {
      return { ok: false, error: makeBoundaryError("tenant_mismatch") };
    }
    const page = await persistence.listAuditEvents({
      tenant_id: getActiveTenantId(),
      matter_id: dto.matterId,
      ...(limit !== undefined ? { limit } : {}),
      ...(dto.cursor !== undefined ? { cursor: dto.cursor } : {}),
    });
    return { ok: true, value: page };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.auditListEvents }) };
  }
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
    return { ok: true, value: page };
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
    return { ok: true, value: document };
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
    return { ok: true, value: registered };
  } catch (err) {
    return { ok: false, error: mapThrownError(err, { channel: CHANNEL.documentRegister }) };
  }
}
