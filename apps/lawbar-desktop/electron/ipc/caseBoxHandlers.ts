import { ipcMain } from "electron";

import {
  CHANNEL,
  createMatterHandler,
  getMatterHandler,
  listMattersHandler,
  archiveMatterHandler,
  chainHeadHandler,
  listAuditEventsHandler,
  listDocumentsHandler,
  getDocumentHandler,
  registerDocumentHandler,
  listDeadlinesHandler,
  listFactsHandler,
  type PersistenceProvider,
  type ClockFn,
  type RegisterDocumentDeps,
} from "../../src/caseBox/handlers.js";
// WI-601 docket write handlers — imported DIRECTLY from the per-entity module
// (not the handlers.js barrel) because handlers.ts is outside this WI's governed
// Allowed-files; the barrel re-export is a follow-up reconciliation.
import {
  createDocketEntryHandler,
  confirmDocketEntryHandler,
} from "../../src/caseBox/docketHandlers.js";
import { getCaseBoxRuntime } from "../../src/caseBox/caseBoxRuntime.js";
import { newUlid } from "../../src/caseBox/ulid.js";

export { CHANNEL };

export interface RegisterCaseBoxIpcHandlersOptions {
  readonly persistenceProvider?: PersistenceProvider;
  readonly now?: ClockFn;
  readonly idFactory?: () => string;
  // Main-process file-chooser + storage for document registration. Both must be
  // supplied by electron main for the document:register channel to function;
  // when absent (e.g. unit harness), register reports a safe boundary error.
  readonly chooseDocumentFile?: RegisterDocumentDeps["chooseFile"];
  readonly storeDocumentFile?: RegisterDocumentDeps["storeFile"];
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
  ipcMain.handle(CHANNEL.documentList, async (_evt, payload: unknown) => {
    return listDocumentsHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.documentGet, async (_evt, payload: unknown) => {
    return getDocumentHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.documentRegister, async (_evt, payload: unknown) => {
    if (options.chooseDocumentFile === undefined || options.storeDocumentFile === undefined) {
      // Misconfiguration safeguard: never proceed with a half-wired file path.
      return {
        ok: false,
        error: {
          kind: "case_box_persistence_error",
          code: "not_implemented",
          message: "document registration is not available (file handling not configured)",
        },
      };
    }
    return registerDocumentHandler(payload, provide, {
      chooseFile: options.chooseDocumentFile,
      storeFile: options.storeDocumentFile,
      now: nowFn,
      idFactory,
    });
  });
  ipcMain.handle(CHANNEL.deadlineList, async (_evt, payload: unknown) => {
    return listDeadlinesHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.docketCreate, async (_evt, payload: unknown) => {
    return createDocketEntryHandler(payload, provide, nowFn, idFactory);
  });
  ipcMain.handle(CHANNEL.docketConfirm, async (_evt, payload: unknown) => {
    return confirmDocketEntryHandler(payload, provide, nowFn, idFactory);
  });
  ipcMain.handle(CHANNEL.factList, async (_evt, payload: unknown) => {
    return listFactsHandler(payload, provide);
  });
}

export function unregisterCaseBoxIpcHandlers(): void {
  for (const channel of Object.values(CHANNEL)) {
    ipcMain.removeHandler(channel);
  }
}
