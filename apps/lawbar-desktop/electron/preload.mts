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
  UpdateMatterDetailsDto,
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
  CreateClaimTrackDto,
  ListClaimTracksDto,
  CreateLinkDto,
  UnlinkLinkDto,
  RelinkLinkDto,
  ListLinksDto,
  ExportLinkCitationsDto,
  T3PreviewCatalogDto,
  T3ExportDocxDto,
  CreateMatterResult,
  GetMatterResult,
  ListMattersResult,
  ArchiveMatterResult,
  UpdateMatterDetailsResult,
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
  CreateClaimTrackResult,
  ListClaimTracksResult,
  CreateLinkResult,
  UnlinkLinkResult,
  RelinkLinkResult,
  ListLinksResult,
  ExportLinkCitationsResult,
  T3PreviewCatalogResult,
  T3ExportDocxResult,
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
  // matter-details-edit Phase C: edit a matter's 6 editable free-text fields. The
  // write surface is guarded server-side (tenant/matter preflight + forbidden-field
  // rejection + server-authority injection); the renderer edit SCREEN is Phase D.
  updateMatterDetails(dto: UpdateMatterDetailsDto): Promise<UpdateMatterDetailsResult>;
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
  // WI-PTA-VS2: the ClaimTrack IPC layer (list + create). The write surface is
  // guarded server-side (matter/tenant preflight + party-ref preflight +
  // forbidden-field rejection + server-authority injection); renderer UI is VS-3.
  createClaimTrack(dto: CreateClaimTrackDto): Promise<CreateClaimTrackResult>;
  listClaimTracks(dto: ListClaimTracksDto): Promise<ListClaimTracksResult>;
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
  // WI-FORMS-T3-S2: read-only preview of the merged S1 T3 catalog model for a matter.
  // Matter-scoped; tenant injected server-side. A submitter refusal is an expected
  // review state carried in the success value, not an error.
  previewT3Catalog(dto: T3PreviewCatalogDto): Promise<T3PreviewCatalogResult>;
  // WI-FORMS-T3-S3: export the merged S1 T3 catalog to `.docx` via the main-process
  // save dialog. The renderer receives ONLY a structured status ({ written } / refusal
  // / error) — never raw `.docx` bytes.
  exportT3Docx(dto: T3ExportDocxDto): Promise<T3ExportDocxResult>;
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
  updateMatterDetails: (dto) => ipcRenderer.invoke("casebox:matter:updateDetails", dto),
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
  createClaimTrack: (dto) => ipcRenderer.invoke("casebox:claimTrack:create", dto),
  listClaimTracks: (dto) => ipcRenderer.invoke("casebox:claimTrack:list", dto),
  listDocketEntries: (dto) => ipcRenderer.invoke("casebox:docket:list", dto),
  dismissDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:dismiss", dto),
  editDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:edit", dto),
  createLink: (dto) => ipcRenderer.invoke("casebox:link:create", dto),
  unlinkLink: (dto) => ipcRenderer.invoke("casebox:link:unlink", dto),
  relinkLink: (dto) => ipcRenderer.invoke("casebox:link:relink", dto),
  listLinks: (dto) => ipcRenderer.invoke("casebox:link:list", dto),
  exportLinkCitations: (dto) => ipcRenderer.invoke("casebox:link:export", dto),
  previewT3Catalog: (dto) => ipcRenderer.invoke("casebox:t3:previewCatalog", dto),
  exportT3Docx: (dto) => ipcRenderer.invoke("casebox:t3:exportDocx", dto),
};

// Read-only app-info bridge (WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00). Additive; no
// existing surface changed. Surfaces the app's own version / launch mode / data
// directory / launch-time FileVault state to the Settings screen. No writes, no
// PII beyond the app's own userData path, no raw probe error/output crosses.
interface AppInfoApi {
  get(): Promise<{
    version: string;
    mode: "dev" | "production";
    dataDir: string;
    fileVaultState: "on" | "off" | "unknown" | "non-macos";
    offline: boolean;
    telemetry: boolean;
  }>;
}

const appInfoApi: AppInfoApi = {
  get: () => ipcRenderer.invoke("app:info"),
};

contextBridge.exposeInMainWorld("lawbar", { theme: themeApi, caseBox: caseBoxApi, appInfo: appInfoApi });
