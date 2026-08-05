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
  transitionDeadlineHandler,
  listFactsHandler,
  previewT3CatalogHandler,
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
  listDocketEntriesHandler,
  dismissDocketEntryHandler,
  editDocketEntryHandler,
} from "../../src/caseBox/docketHandlers.js";
// WI-602 fact write handler — imported DIRECTLY from the per-entity module for
// the same reason as the docket handlers above (handlers.ts barrel is outside
// this WI's governed Allowed-files; CBW-601-BARREL follow-up).
import { createFactHandler, transitionFactHandler } from "../../src/caseBox/factHandlers.js";
// WI-PTA-VS2 ClaimTrack IPC handlers — imported DIRECTLY from the per-entity
// module for the same reason as the docket/fact handlers above (the handlers.ts
// barrel is outside this WI's governed Allowed-files).
import { createClaimTrackHandler, listClaimTracksHandler } from "../../src/caseBox/claimTrackHandlers.js";
// matter-details-edit Phase C — the updateMatterDetails write handler, imported
// DIRECTLY from the per-entity matterHandlers module for the same reason as the
// docket/fact/claim-track handlers above (the handlers.ts barrel is outside this
// WI's governed Allowed-files).
import { updateMatterDetailsHandler } from "../../src/caseBox/matterHandlers.js";
// WI-FORMS-T3-S3 DOCX export handler — imported DIRECTLY from the per-entity module
// for the same reason as the docket/fact handlers above (the handlers.ts barrel is
// outside this WI's governed Allowed-files).
import { exportT3DocxHandler, type T3ExportDocxDeps } from "../../src/caseBox/t3ExportHandlers.js";
// WI-A3-LINK-IPC-T1 Evidence link write/read handlers — imported DIRECTLY from
// the per-entity module for the same reason as the docket/fact handlers above
// (the handlers.ts barrel is outside this WI's governed Allowed-files).
import {
  createLinkHandler,
  unlinkLinkHandler,
  relinkLinkHandler,
  listLinksHandler,
  exportLinkCitationsHandler,
} from "../../src/caseBox/linkHandlers.js";
import type { LinkPersistenceProvider } from "../../src/caseBox/handlerShared.js";
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
  // SQLite-only Evidence link provider. When absent, derived from the runtime;
  // if the runtime is the InMemory fallback (no SQLite), each link channel
  // returns a safe not_implemented boundary error instead of throwing.
  readonly linkPersistenceProvider?: LinkPersistenceProvider;
  // Main-process save-dialog + file-write for the T3 DOCX export channel. Supplied by
  // electron main; when absent (e.g. unit harness), the export channel returns a safe
  // boundary error (mirrors the document-register misconfiguration safeguard).
  readonly t3ExportDeps?: T3ExportDocxDeps;
}

// Safe boundary envelope returned by every link channel when the SQLite runtime
// is unavailable (mirrors the document-register misconfiguration safeguard).
const LINK_UNAVAILABLE_ENVELOPE = {
  ok: false as const,
  error: {
    kind: "case_box_persistence_error" as const,
    code: "not_implemented" as const,
    message: "link IPC is not available (SQLite runtime required)",
  },
};

export function registerCaseBoxIpcHandlers(
  options: RegisterCaseBoxIpcHandlersOptions = {},
): void {
  const provide = options.persistenceProvider ?? getCaseBoxRuntime;
  const nowFn = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? newUlid;

  // Resolve a LinkPersistenceProvider on demand. An explicit injected provider
  // (unit harness) is used as-is; otherwise we read the runtime and only return
  // a provider when the SQLite handles are present. `null` => the runtime is the
  // InMemory fallback, so the link channel returns the unavailable envelope.
  const resolveLinkProvider = (): LinkPersistenceProvider | null => {
    if (options.linkPersistenceProvider !== undefined) return options.linkPersistenceProvider;
    const rt = getCaseBoxRuntime();
    if (rt.sqlite === null || rt.db === null) return null;
    const sqlite = rt.sqlite;
    const db = rt.db;
    return () => ({ persistence: sqlite, db });
  };

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
  ipcMain.handle(CHANNEL.matterUpdateDetails, async (_evt, payload: unknown) => {
    return updateMatterDetailsHandler(payload, provide);
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
  ipcMain.handle(CHANNEL.deadlineTransition, async (_evt, payload: unknown) => {
    return transitionDeadlineHandler(payload, provide, nowFn);
  });
  ipcMain.handle(CHANNEL.docketCreate, async (_evt, payload: unknown) => {
    return createDocketEntryHandler(payload, provide, nowFn, idFactory);
  });
  ipcMain.handle(CHANNEL.docketConfirm, async (_evt, payload: unknown) => {
    return confirmDocketEntryHandler(payload, provide, nowFn, idFactory);
  });
  ipcMain.handle(CHANNEL.docketList, async (_evt, payload: unknown) => {
    return listDocketEntriesHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.docketDismiss, async (_evt, payload: unknown) => {
    return dismissDocketEntryHandler(payload, provide, nowFn);
  });
  ipcMain.handle(CHANNEL.docketEdit, async (_evt, payload: unknown) => {
    return editDocketEntryHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.factList, async (_evt, payload: unknown) => {
    return listFactsHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.factCreate, async (_evt, payload: unknown) => {
    return createFactHandler(payload, provide, nowFn, idFactory);
  });
  ipcMain.handle(CHANNEL.factTransition, async (_evt, payload: unknown) => {
    return transitionFactHandler(payload, provide, nowFn);
  });
  ipcMain.handle(CHANNEL.claimTrackCreate, async (_evt, payload: unknown) => {
    return createClaimTrackHandler(payload, provide, nowFn, idFactory);
  });
  ipcMain.handle(CHANNEL.claimTrackList, async (_evt, payload: unknown) => {
    return listClaimTracksHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.t3PreviewCatalog, async (_evt, payload: unknown) => {
    return previewT3CatalogHandler(payload, provide);
  });
  ipcMain.handle(CHANNEL.t3ExportDocx, async (_evt, payload: unknown) => {
    if (options.t3ExportDeps === undefined) {
      // Misconfiguration safeguard: never proceed with a half-wired export path.
      return {
        ok: false,
        error: {
          kind: "case_box_persistence_error",
          code: "not_implemented",
          message: "T3 DOCX export is not available (save dialog not configured)",
        },
      };
    }
    return exportT3DocxHandler(payload, provide, options.t3ExportDeps);
  });
  ipcMain.handle(CHANNEL.linkCreate, async (_evt, payload: unknown) => {
    const linkProvide = resolveLinkProvider();
    if (linkProvide === null) return LINK_UNAVAILABLE_ENVELOPE;
    return createLinkHandler(payload, linkProvide);
  });
  ipcMain.handle(CHANNEL.linkUnlink, async (_evt, payload: unknown) => {
    const linkProvide = resolveLinkProvider();
    if (linkProvide === null) return LINK_UNAVAILABLE_ENVELOPE;
    return unlinkLinkHandler(payload, linkProvide);
  });
  ipcMain.handle(CHANNEL.linkRelink, async (_evt, payload: unknown) => {
    const linkProvide = resolveLinkProvider();
    if (linkProvide === null) return LINK_UNAVAILABLE_ENVELOPE;
    return relinkLinkHandler(payload, linkProvide);
  });
  ipcMain.handle(CHANNEL.linkList, async (_evt, payload: unknown) => {
    const linkProvide = resolveLinkProvider();
    if (linkProvide === null) return LINK_UNAVAILABLE_ENVELOPE;
    return listLinksHandler(payload, linkProvide);
  });
  ipcMain.handle(CHANNEL.linkExport, async (_evt, payload: unknown) => {
    const linkProvide = resolveLinkProvider();
    if (linkProvide === null) return LINK_UNAVAILABLE_ENVELOPE;
    return exportLinkCitationsHandler(payload, linkProvide);
  });
}

export function unregisterCaseBoxIpcHandlers(): void {
  for (const channel of Object.values(CHANNEL)) {
    ipcMain.removeHandler(channel);
  }
}
