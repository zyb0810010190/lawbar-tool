// Typed renderer-side wrapper around `window.lawbar.caseBox.*` IPC.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §"NEW (impl WI)" api.ts row +
// §3 "Server-authority injection" defense-in-depth field stripping.
//
// One function per channel. No retry. No caching. Pass envelopes through
// unchanged so the caller sees the existing safe-message envelope from the
// IPC impl's errorMap.

import type {
  ArchiveMatterDto,
  ChainHeadDto,
  CreateMatterDto,
  GetDocumentDto,
  GetMatterDto,
  IpcEnvelope,
  ListAuditEventsDto,
  ListDocumentsDto,
  ListMattersDto,
  RegisterDocumentDto,
} from "./types.js";

import {
  RENDERER_ARCHIVE_MATTER_DTO_FIELDS,
  RENDERER_CHAIN_HEAD_DTO_FIELDS,
  RENDERER_CREATE_MATTER_DTO_FIELDS,
  RENDERER_GET_DOCUMENT_DTO_FIELDS,
  RENDERER_GET_MATTER_DTO_FIELDS,
  RENDERER_LIST_AUDIT_EVENTS_DTO_FIELDS,
  RENDERER_LIST_DOCUMENTS_DTO_FIELDS,
  RENDERER_LIST_MATTERS_DTO_FIELDS,
  RENDERER_REGISTER_DOCUMENT_DTO_FIELDS,
} from "./types.js";

// Shape of the preload-injected client (`window.lawbar.caseBox`).
export interface CaseBoxClient {
  createMatter(dto: CreateMatterDto): Promise<IpcEnvelope<unknown>>;
  getMatter(dto: GetMatterDto): Promise<IpcEnvelope<unknown>>;
  listMatters(dto: ListMattersDto): Promise<IpcEnvelope<unknown>>;
  archiveMatter(dto: ArchiveMatterDto): Promise<IpcEnvelope<unknown>>;
  chainHead(dto: ChainHeadDto): Promise<IpcEnvelope<unknown>>;
  listAuditEvents(dto: ListAuditEventsDto): Promise<IpcEnvelope<unknown>>;
  listDocuments(dto: ListDocumentsDto): Promise<IpcEnvelope<unknown>>;
  getDocument(dto: GetDocumentDto): Promise<IpcEnvelope<unknown>>;
  registerDocument(dto: RegisterDocumentDto): Promise<IpcEnvelope<unknown>>;
}

export interface CaseBoxApi {
  createMatter(dto: CreateMatterDto): Promise<IpcEnvelope<unknown>>;
  getMatter(dto: GetMatterDto): Promise<IpcEnvelope<unknown>>;
  listMatters(dto: ListMattersDto): Promise<IpcEnvelope<unknown>>;
  archiveMatter(dto: ArchiveMatterDto): Promise<IpcEnvelope<unknown>>;
  chainHead(dto: ChainHeadDto): Promise<IpcEnvelope<unknown>>;
  listAuditEvents(dto: ListAuditEventsDto): Promise<IpcEnvelope<unknown>>;
  listDocuments(dto: ListDocumentsDto): Promise<IpcEnvelope<unknown>>;
  getDocument(dto: GetDocumentDto): Promise<IpcEnvelope<unknown>>;
  registerDocument(dto: RegisterDocumentDto): Promise<IpcEnvelope<unknown>>;
}

// Strip any DTO key not in the renderer-side allowlist. Drops with a
// console.warn so renderer-side typos surface immediately. Main is the
// authoritative validator; this is defense-in-depth.
export function stripDtoFields<T extends object>(
  dto: T,
  allow: ReadonlyArray<string>,
): T {
  const allowSet = new Set<string>(allow);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(dto)) {
    if (allowSet.has(k)) {
      out[k] = (dto as Record<string, unknown>)[k];
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[caseBoxApi] dropped extra DTO field "${k}"`);
    }
  }
  return out as T;
}

// Build an api over an injected client. Tests pass a mock client; production
// passes `window.lawbar.caseBox` via `getDefaultApi()`.
export function createCaseBoxApi(client: CaseBoxClient): CaseBoxApi {
  return {
    createMatter: (dto) =>
      client.createMatter(stripDtoFields(dto, RENDERER_CREATE_MATTER_DTO_FIELDS)),
    getMatter: (dto) =>
      client.getMatter(stripDtoFields(dto, RENDERER_GET_MATTER_DTO_FIELDS)),
    listMatters: (dto) =>
      client.listMatters(stripDtoFields(dto, RENDERER_LIST_MATTERS_DTO_FIELDS)),
    archiveMatter: (dto) =>
      client.archiveMatter(stripDtoFields(dto, RENDERER_ARCHIVE_MATTER_DTO_FIELDS)),
    chainHead: (dto) =>
      client.chainHead(stripDtoFields(dto, RENDERER_CHAIN_HEAD_DTO_FIELDS)),
    listAuditEvents: (dto) =>
      client.listAuditEvents(stripDtoFields(dto, RENDERER_LIST_AUDIT_EVENTS_DTO_FIELDS)),
    listDocuments: (dto) =>
      client.listDocuments(stripDtoFields(dto, RENDERER_LIST_DOCUMENTS_DTO_FIELDS)),
    getDocument: (dto) =>
      client.getDocument(stripDtoFields(dto, RENDERER_GET_DOCUMENT_DTO_FIELDS)),
    registerDocument: (dto) =>
      client.registerDocument(stripDtoFields(dto, RENDERER_REGISTER_DOCUMENT_DTO_FIELDS)),
  };
}

// Production accessor. Resolves the preload-exposed client on each call.
// Screens that need the api should call this once at boot and pass the
// returned object down. Tests SHOULD use `createCaseBoxApi(mock)` directly.
export function getDefaultApi(): CaseBoxApi {
  const w = window as unknown as { lawbar?: { caseBox?: CaseBoxClient } };
  if (w.lawbar === undefined || w.lawbar.caseBox === undefined) {
    throw new Error("[caseBoxApi] window.lawbar.caseBox is not exposed");
  }
  return createCaseBoxApi(w.lawbar.caseBox);
}
