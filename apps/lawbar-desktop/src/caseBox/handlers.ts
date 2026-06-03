// Barrel for the case-box IPC handlers. The handler logic lives in per-entity
// sibling modules (matterHandlers / auditHandlers / documentHandlers — plus
// handlerShared for the cross-cutting CHANNEL + guards). This file preserves
// the historical import surface (`from "./handlers.js"`) so callers and tests
// are unchanged. Mechanical split, no behavior change.

export { CHANNEL } from "./handlerShared.js";
export type { PersistenceProvider, ClockFn } from "./handlerShared.js";

export {
  createMatterHandler,
  getMatterHandler,
  listMattersHandler,
  archiveMatterHandler,
} from "./matterHandlers.js";

export { chainHeadHandler, listAuditEventsHandler } from "./auditHandlers.js";

export {
  listDocumentsHandler,
  getDocumentHandler,
  registerDocumentHandler,
  type RegisterDocumentDeps,
} from "./documentHandlers.js";

export { listDeadlinesHandler } from "./deadlineHandlers.js";
