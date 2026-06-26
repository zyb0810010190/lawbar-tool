import { contextBridge, ipcRenderer } from "electron";

import type {
  ResolvedTheme,
  ThemePreference,
} from "../src/theme/resolveSystemMode.js";
import type {
  CreateMatterDto,
  GetMatterDto,
  ListMattersDto,
  ArchiveMatterDto,
  ChainHeadDto,
  ListAuditEventsDto,
  ListDocumentsDto,
  GetDocumentDto,
  RegisterDocumentDto,
  ListDeadlinesDto,
  ListFactsDto,
  CreateFactDto,
  CreateDocketEntryDto,
  ConfirmDocketEntryDto,
  ListDocketEntriesDto,
  DismissDocketEntryDto,
  EditDocketEntryDto,
  TransitionFactDto,
  TransitionDeadlineDto,
  CreateLinkDto,
  UnlinkLinkDto,
  RelinkLinkDto,
  ListLinksDto,
  ExportLinkCitationsDto,
  CreateMatterResult,
  GetMatterResult,
  ListMattersResult,
  ArchiveMatterResult,
  ChainHeadResult,
  ListAuditEventsResult,
  ListDocumentsResult,
  GetDocumentResult,
  RegisterDocumentResult,
  ListDeadlinesResult,
  ListFactsResult,
  CreateFactResult,
  CreateDocketEntryResult,
  ConfirmDocketEntryResult,
  ListDocketEntriesResult,
  DismissDocketEntryResult,
  EditDocketEntryResult,
  TransitionFactResult,
  TransitionDeadlineResult,
  CreateLinkResult,
  UnlinkLinkResult,
  RelinkLinkResult,
  ListLinksResult,
  ExportLinkCitationsResult,
} from "../src/caseBox/dto.js";

export interface ThemeApi {
  get(): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  set(mode: ThemePreference): Promise<{ preference: ThemePreference; resolved: ResolvedTheme }>;
  onSystemChange(
    callback: (resolved: ResolvedTheme, preference: ThemePreference) => void,
  ): void;
}

export interface CaseBoxApi {
  createMatter(dto: CreateMatterDto): Promise<CreateMatterResult>;
  getMatter(dto: GetMatterDto): Promise<GetMatterResult>;
  listMatters(dto: ListMattersDto): Promise<ListMattersResult>;
  archiveMatter(dto: ArchiveMatterDto): Promise<ArchiveMatterResult>;
  chainHead(dto: ChainHeadDto): Promise<ChainHeadResult>;
  listAuditEvents(dto: ListAuditEventsDto): Promise<ListAuditEventsResult>;
  listDocuments(dto: ListDocumentsDto): Promise<ListDocumentsResult>;
  getDocument(dto: GetDocumentDto): Promise<GetDocumentResult>;
  registerDocument(dto: RegisterDocumentDto): Promise<RegisterDocumentResult>;
  listDeadlines(dto: ListDeadlinesDto): Promise<ListDeadlinesResult>;
  // WI-DT1: the preload exposure of the transition write IS part of this WI (preload
  // lives under electron/, not renderer/). Only the renderer-side bridge
  // (renderer/api.ts + renderer/types.ts) is deferred to WI-DT3. The write surface is
  // guarded server-side (tenant/matter/scoped-preflight + forbidden-field rejection).
  transitionDeadline(dto: TransitionDeadlineDto): Promise<TransitionDeadlineResult>;
  listFacts(dto: ListFactsDto): Promise<ListFactsResult>;
  createFact(dto: CreateFactDto): Promise<CreateFactResult>;
  createDocketEntry(dto: CreateDocketEntryDto): Promise<CreateDocketEntryResult>;
  confirmDocketEntry(dto: ConfirmDocketEntryDto): Promise<ConfirmDocketEntryResult>;
  transitionFact(dto: TransitionFactDto): Promise<TransitionFactResult>;
  listDocketEntries(dto: ListDocketEntriesDto): Promise<ListDocketEntriesResult>;
  dismissDocketEntry(dto: DismissDocketEntryDto): Promise<DismissDocketEntryResult>;
  // WI-DPE4: edit a proposed docket entry (IPC/DTO only; renderer call sites are DPE5).
  editDocketEntry(dto: EditDocketEntryDto): Promise<EditDocketEntryResult>;
  // WI-A3-LINK-IPC-T1: the audited Evidence link lifecycle (IPC/DTO + preload
  // only; renderer bridge deferred). The write surface is guarded server-side
  // (tenant/matter preflight + scoped link preflight + forbidden-field rejection);
  // SQLite-only (the InMemory fallback returns a not_implemented boundary error).
  createLink(dto: CreateLinkDto): Promise<CreateLinkResult>;
  unlinkLink(dto: UnlinkLinkDto): Promise<UnlinkLinkResult>;
  relinkLink(dto: RelinkLinkDto): Promise<RelinkLinkResult>;
  listLinks(dto: ListLinksDto): Promise<ListLinksResult>;
  exportLinkCitations(dto: ExportLinkCitationsDto): Promise<ExportLinkCitationsResult>;
}

const themeApi: ThemeApi = {
  get: () => ipcRenderer.invoke("theme:get"),
  set: (mode: ThemePreference) => ipcRenderer.invoke("theme:set", mode),
  onSystemChange: (callback) => {
    ipcRenderer.on(
      "theme:system-change",
      (_event, resolved: ResolvedTheme, preference: ThemePreference) => {
        callback(resolved, preference);
      },
    );
  },
};

const caseBoxApi: CaseBoxApi = {
  createMatter: (dto) => ipcRenderer.invoke("casebox:matter:create", dto),
  getMatter: (dto) => ipcRenderer.invoke("casebox:matter:get", dto),
  listMatters: (dto) => ipcRenderer.invoke("casebox:matter:list", dto),
  archiveMatter: (dto) => ipcRenderer.invoke("casebox:matter:archive", dto),
  chainHead: (dto) => ipcRenderer.invoke("casebox:audit:chainHead", dto),
  listAuditEvents: (dto) => ipcRenderer.invoke("casebox:audit:listEvents", dto),
  listDocuments: (dto) => ipcRenderer.invoke("casebox:document:list", dto),
  getDocument: (dto) => ipcRenderer.invoke("casebox:document:get", dto),
  registerDocument: (dto) => ipcRenderer.invoke("casebox:document:register", dto),
  listDeadlines: (dto) => ipcRenderer.invoke("casebox:deadline:list", dto),
  transitionDeadline: (dto) => ipcRenderer.invoke("casebox:deadline:transition", dto),
  listFacts: (dto) => ipcRenderer.invoke("casebox:fact:list", dto),
  createFact: (dto) => ipcRenderer.invoke("casebox:fact:create", dto),
  createDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:create", dto),
  confirmDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:confirm", dto),
  transitionFact: (dto) => ipcRenderer.invoke("casebox:fact:transition", dto),
  listDocketEntries: (dto) => ipcRenderer.invoke("casebox:docket:list", dto),
  dismissDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:dismiss", dto),
  editDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:edit", dto),
  createLink: (dto) => ipcRenderer.invoke("casebox:link:create", dto),
  unlinkLink: (dto) => ipcRenderer.invoke("casebox:link:unlink", dto),
  relinkLink: (dto) => ipcRenderer.invoke("casebox:link:relink", dto),
  listLinks: (dto) => ipcRenderer.invoke("casebox:link:list", dto),
  exportLinkCitations: (dto) => ipcRenderer.invoke("casebox:link:export", dto),
};

contextBridge.exposeInMainWorld("lawbar", { theme: themeApi, caseBox: caseBoxApi });
