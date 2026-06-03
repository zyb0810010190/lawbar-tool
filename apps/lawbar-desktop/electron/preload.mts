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
  CreateMatterResult,
  GetMatterResult,
  ListMattersResult,
  ArchiveMatterResult,
  ChainHeadResult,
  ListAuditEventsResult,
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
};

contextBridge.exposeInMainWorld("lawbar", { theme: themeApi, caseBox: caseBoxApi });
