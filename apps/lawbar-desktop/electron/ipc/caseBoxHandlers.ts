import { ipcMain } from "electron";

import {
  CHANNEL,
  createMatterHandler,
  getMatterHandler,
  listMattersHandler,
  archiveMatterHandler,
  chainHeadHandler,
  listAuditEventsHandler,
  type PersistenceProvider,
  type ClockFn,
} from "../../src/caseBox/handlers.js";
import { getCaseBoxRuntime } from "../../src/caseBox/caseBoxRuntime.js";
import { newUlid } from "../../src/caseBox/ulid.js";

export { CHANNEL };

export interface RegisterCaseBoxIpcHandlersOptions {
  readonly persistenceProvider?: PersistenceProvider;
  readonly now?: ClockFn;
  readonly idFactory?: () => string;
}

export function registerCaseBoxIpcHandlers(
  options: RegisterCaseBoxIpcHandlersOptions = {},
): void {
  const provide = options.persistenceProvider ?? getCaseBoxRuntime;
  const nowFn = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? newUlid;

  ipcMain.handle(CHANNEL.matterCreate, async (_evt, payload: unknown) => {
    return createMatterHandler(payload, provide, nowFn, idFactory);
  });
  ipcMain.handle(CHANNEL.matterGet, async (_evt, payload: unknown) => {
    return getMatterHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.matterList, async (_evt, payload: unknown) => {
    return listMattersHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.matterArchive, async (_evt, payload: unknown) => {
    return archiveMatterHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.auditChainHead, async (_evt, payload: unknown) => {
    return chainHeadHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.auditListEvents, async (_evt, payload: unknown) => {
    return listAuditEventsHandler(payload, provide);
  });
}

export function unregisterCaseBoxIpcHandlers(): void {
  for (const channel of Object.values(CHANNEL)) {
    ipcMain.removeHandler(channel);
  }
}
