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
  TransitionFactDto,
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
  TransitionFactResult,
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
  listFacts(dto: ListFactsDto): Promise<ListFactsResult>;
  createFact(dto: CreateFactDto): Promise<CreateFactResult>;
  createDocketEntry(dto: CreateDocketEntryDto): Promise<CreateDocketEntryResult>;
  confirmDocketEntry(dto: ConfirmDocketEntryDto): Promise<ConfirmDocketEntryResult>;
  transitionFact(dto: TransitionFactDto): Promise<TransitionFactResult>;
  listDocketEntries(dto: ListDocketEntriesDto): Promise<ListDocketEntriesResult>;
  dismissDocketEntry(dto: DismissDocketEntryDto): Promise<DismissDocketEntryResult>;
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
  listFacts: (dto) => ipcRenderer.invoke("casebox:fact:list", dto),
  createFact: (dto) => ipcRenderer.invoke("casebox:fact:create", dto),
  createDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:create", dto),
  confirmDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:confirm", dto),
  transitionFact: (dto) => ipcRenderer.invoke("casebox:fact:transition", dto),
  listDocketEntries: (dto) => ipcRenderer.invoke("casebox:docket:list", dto),
  dismissDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:dismiss", dto),
};

contextBridge.exposeInMainWorld("lawbar", { theme: themeApi, caseBox: caseBoxApi });
