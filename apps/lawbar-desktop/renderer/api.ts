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
  ConfirmDocketEntryDto,
  CreateDocketEntryDto,
  CreateFactDto,
  CreateMatterDto,
  DismissDocketEntryDto,
  EditDocketEntryDto,
  GetDocumentDto,
  GetMatterDto,
  IpcEnvelope,
  ListAuditEventsDto,
  ListDeadlinesDto,
  ListDocketEntriesDto,
  ListDocumentsDto,
  ListFactsDto,
  ListMattersDto,
  RegisterDocumentDto,
  TransitionFactDto,
  TransitionDeadlineDto,
  CreateClaimTrackDto,
  ListClaimTracksDto,
  CreateLinkDto,
  UnlinkLinkDto,
  RelinkLinkDto,
  ListLinksDto,
  ExportLinkCitationsDto,
  T3PreviewCatalogDto,
  T3ExportDocxDto,
} from "./types.js";

import {
  RENDERER_ARCHIVE_MATTER_DTO_FIELDS,
  RENDERER_CHAIN_HEAD_DTO_FIELDS,
  RENDERER_CONFIRM_DOCKET_DTO_FIELDS,
  RENDERER_CREATE_DOCKET_DTO_FIELDS,
  RENDERER_CREATE_FACT_DTO_FIELDS,
  RENDERER_DISMISS_DOCKET_DTO_FIELDS,
  RENDERER_EDIT_DOCKET_DTO_FIELDS,
  RENDERER_LIST_DOCKET_DTO_FIELDS,
  RENDERER_TRANSITION_FACT_DTO_FIELDS,
  RENDERER_TRANSITION_DEADLINE_DTO_FIELDS,
  RENDERER_CREATE_CLAIM_TRACK_DTO_FIELDS,
  RENDERER_LIST_CLAIM_TRACKS_DTO_FIELDS,
  RENDERER_CREATE_MATTER_DTO_FIELDS,
  RENDERER_GET_DOCUMENT_DTO_FIELDS,
  RENDERER_GET_MATTER_DTO_FIELDS,
  RENDERER_LIST_AUDIT_EVENTS_DTO_FIELDS,
  RENDERER_LIST_DEADLINES_DTO_FIELDS,
  RENDERER_LIST_DOCUMENTS_DTO_FIELDS,
  RENDERER_LIST_FACTS_DTO_FIELDS,
  RENDERER_LIST_MATTERS_DTO_FIELDS,
  RENDERER_REGISTER_DOCUMENT_DTO_FIELDS,
  RENDERER_CREATE_LINK_DTO_FIELDS,
  RENDERER_UNLINK_LINK_DTO_FIELDS,
  RENDERER_RELINK_LINK_DTO_FIELDS,
  RENDERER_LIST_LINKS_DTO_FIELDS,
  RENDERER_EXPORT_LINK_CITATIONS_DTO_FIELDS,
  RENDERER_T3_PREVIEW_DTO_FIELDS,
  RENDERER_T3_EXPORT_DTO_FIELDS,
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
  listDeadlines(dto: ListDeadlinesDto): Promise<IpcEnvelope<unknown>>;
  transitionDeadline(dto: TransitionDeadlineDto): Promise<IpcEnvelope<unknown>>;
  listFacts(dto: ListFactsDto): Promise<IpcEnvelope<unknown>>;
  createFact(dto: CreateFactDto): Promise<IpcEnvelope<unknown>>;
  createDocketEntry(dto: CreateDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  confirmDocketEntry(dto: ConfirmDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  transitionFact(dto: TransitionFactDto): Promise<IpcEnvelope<unknown>>;
  createClaimTrack(dto: CreateClaimTrackDto): Promise<IpcEnvelope<unknown>>;
  listClaimTracks(dto: ListClaimTracksDto): Promise<IpcEnvelope<unknown>>;
  listDocketEntries(dto: ListDocketEntriesDto): Promise<IpcEnvelope<unknown>>;
  dismissDocketEntry(dto: DismissDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  editDocketEntry(dto: EditDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  createLink(dto: CreateLinkDto): Promise<IpcEnvelope<unknown>>;
  unlinkLink(dto: UnlinkLinkDto): Promise<IpcEnvelope<unknown>>;
  relinkLink(dto: RelinkLinkDto): Promise<IpcEnvelope<unknown>>;
  listLinks(dto: ListLinksDto): Promise<IpcEnvelope<unknown>>;
  exportLinkCitations(dto: ExportLinkCitationsDto): Promise<IpcEnvelope<unknown>>;
  previewT3Catalog(dto: T3PreviewCatalogDto): Promise<IpcEnvelope<unknown>>;
  exportT3Docx(dto: T3ExportDocxDto): Promise<IpcEnvelope<unknown>>;
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
  listDeadlines(dto: ListDeadlinesDto): Promise<IpcEnvelope<unknown>>;
  transitionDeadline(dto: TransitionDeadlineDto): Promise<IpcEnvelope<unknown>>;
  listFacts(dto: ListFactsDto): Promise<IpcEnvelope<unknown>>;
  createFact(dto: CreateFactDto): Promise<IpcEnvelope<unknown>>;
  createDocketEntry(dto: CreateDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  confirmDocketEntry(dto: ConfirmDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  transitionFact(dto: TransitionFactDto): Promise<IpcEnvelope<unknown>>;
  createClaimTrack(dto: CreateClaimTrackDto): Promise<IpcEnvelope<unknown>>;
  listClaimTracks(dto: ListClaimTracksDto): Promise<IpcEnvelope<unknown>>;
  listDocketEntries(dto: ListDocketEntriesDto): Promise<IpcEnvelope<unknown>>;
  dismissDocketEntry(dto: DismissDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  editDocketEntry(dto: EditDocketEntryDto): Promise<IpcEnvelope<unknown>>;
  createLink(dto: CreateLinkDto): Promise<IpcEnvelope<unknown>>;
  unlinkLink(dto: UnlinkLinkDto): Promise<IpcEnvelope<unknown>>;
  relinkLink(dto: RelinkLinkDto): Promise<IpcEnvelope<unknown>>;
  listLinks(dto: ListLinksDto): Promise<IpcEnvelope<unknown>>;
  exportLinkCitations(dto: ExportLinkCitationsDto): Promise<IpcEnvelope<unknown>>;
  previewT3Catalog(dto: T3PreviewCatalogDto): Promise<IpcEnvelope<unknown>>;
  exportT3Docx(dto: T3ExportDocxDto): Promise<IpcEnvelope<unknown>>;
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
    listDeadlines: (dto) =>
      client.listDeadlines(stripDtoFields(dto, RENDERER_LIST_DEADLINES_DTO_FIELDS)),
    transitionDeadline: (dto) =>
      client.transitionDeadline(stripDtoFields(dto, RENDERER_TRANSITION_DEADLINE_DTO_FIELDS)),
    listFacts: (dto) =>
      client.listFacts(stripDtoFields(dto, RENDERER_LIST_FACTS_DTO_FIELDS)),
    createFact: (dto) =>
      client.createFact(stripDtoFields(dto, RENDERER_CREATE_FACT_DTO_FIELDS)),
    createDocketEntry: (dto) =>
      client.createDocketEntry(stripDtoFields(dto, RENDERER_CREATE_DOCKET_DTO_FIELDS)),
    confirmDocketEntry: (dto) =>
      client.confirmDocketEntry(stripDtoFields(dto, RENDERER_CONFIRM_DOCKET_DTO_FIELDS)),
    transitionFact: (dto) =>
      client.transitionFact(stripDtoFields(dto, RENDERER_TRANSITION_FACT_DTO_FIELDS)),
    createClaimTrack: (dto) =>
      client.createClaimTrack(stripDtoFields(dto, RENDERER_CREATE_CLAIM_TRACK_DTO_FIELDS)),
    listClaimTracks: (dto) =>
      client.listClaimTracks(stripDtoFields(dto, RENDERER_LIST_CLAIM_TRACKS_DTO_FIELDS)),
    listDocketEntries: (dto) =>
      client.listDocketEntries(stripDtoFields(dto, RENDERER_LIST_DOCKET_DTO_FIELDS)),
    dismissDocketEntry: (dto) =>
      client.dismissDocketEntry(stripDtoFields(dto, RENDERER_DISMISS_DOCKET_DTO_FIELDS)),
    editDocketEntry: (dto) =>
      client.editDocketEntry(stripDtoFields(dto, RENDERER_EDIT_DOCKET_DTO_FIELDS)),
    createLink: (dto) =>
      client.createLink(stripDtoFields(dto, RENDERER_CREATE_LINK_DTO_FIELDS)),
    unlinkLink: (dto) =>
      client.unlinkLink(stripDtoFields(dto, RENDERER_UNLINK_LINK_DTO_FIELDS)),
    relinkLink: (dto) =>
      client.relinkLink(stripDtoFields(dto, RENDERER_RELINK_LINK_DTO_FIELDS)),
    listLinks: (dto) =>
      client.listLinks(stripDtoFields(dto, RENDERER_LIST_LINKS_DTO_FIELDS)),
    exportLinkCitations: (dto) =>
      client.exportLinkCitations(stripDtoFields(dto, RENDERER_EXPORT_LINK_CITATIONS_DTO_FIELDS)),
    previewT3Catalog: (dto) =>
      client.previewT3Catalog(stripDtoFields(dto, RENDERER_T3_PREVIEW_DTO_FIELDS)),
    exportT3Docx: (dto) =>
      client.exportT3Docx(stripDtoFields(dto, RENDERER_T3_EXPORT_DTO_FIELDS)),
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
