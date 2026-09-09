// documentOpenHandlers.ts — the main-process side of "open this original".
//
// THE RENDERER SUPPLIES AN IDENTITY, NEVER A PATH. The payload is `{ matterId, documentId }` and
// nothing else; every other shape is refused before any lookup happens. Main resolves the record,
// main authorizes it, main hands the read-only copy to the OS. That is the same invariant
// `chooseDocumentFile`, the T3 export and `backup:run` already hold.
//
// WHAT CROSSES BACK IS A WHITELIST. The engine's outcome already carries no path since WI-1, but
// the IPC result is rebuilt field by field here rather than forwarded, so a field added to the
// engine later cannot leak across the boundary by default. Codes, and for `document_unverifiable`
// a reason, are the entire vocabulary the renderer receives.
//
// SCOPING DOES NOT DISTINGUISH "WRONG TENANT" FROM "NO SUCH DOCUMENT". A document id alone is a
// bearer token for any document in the box, and a matter id likewise. Answering "that exists but
// is not yours" would confirm existence across a tenant boundary; both cases are `unknown_document`.

import { openRegisteredOriginal } from "./documentOpen.js";
import type { DocumentOpenRefusal } from "./documentOpen.js";
import type { DocumentVerifyReason, DocumentVerifyRecord } from "./documentVerify.js";
import { verifyDocumentStore } from "./documentVerify.js";
import { getActiveTenantId } from "../security/activeTenant.js";

export const DOCUMENT_OPEN_CHANNEL = {
  open: "document:open",
} as const;

/** Exactly what the renderer may receive. Nothing derived from the filesystem is ever in it. */
export type DocumentOpenIpcResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "document_unverifiable"; readonly reason: DocumentVerifyReason }
  | { readonly ok: false; readonly code: Exclude<DocumentOpenRefusal, "document_unverifiable"> | "invalid_request" };

/** The slice of persistence this handler needs. Structural, so the runtime satisfies it as-is. */
export interface DocumentOpenPersistence {
  getMatter(matterId: string): Promise<{ readonly tenant_id: string } | null>;
  getDocument(documentId: string): Promise<{
    readonly id: string;
    readonly tenant_id: string;
    readonly matter_id: string;
    readonly filename: string;
    readonly content_hash: string;
  } | null>;
}

export interface DocumentOpenHandlerDeps {
  readonly provide: () => { readonly persistence: DocumentOpenPersistence };
  readonly storageRoot: string;
  /** `shell.openPath` in production: resolves to "" on success, otherwise an OS message we never forward. */
  readonly reveal: (file: string) => Promise<string>;
  /** Injectable for tests only; defaults to the active tenant. */
  readonly tenantId?: () => string;
  /** Passed through to the engine; injectable for the same reason it is there. */
  readonly verify?: typeof verifyDocumentStore;
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set(["matterId", "documentId"]);

function isValidRequest(payload: unknown): payload is { matterId: string; documentId: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.every((k) => ALLOWED_KEYS.has(k))) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.matterId === "string" && p.matterId.length > 0
    && typeof p.documentId === "string" && p.documentId.length > 0;
}

export async function documentOpenHandler(
  payload: unknown,
  deps: DocumentOpenHandlerDeps,
): Promise<DocumentOpenIpcResult> {
  if (!isValidRequest(payload)) return { ok: false, code: "invalid_request" };
  const tenant = (deps.tenantId ?? getActiveTenantId)();

  const lookup = async (matterId: string, documentId: string): Promise<DocumentVerifyRecord | null> => {
    const { persistence } = deps.provide();
    const matter = await persistence.getMatter(matterId);
    if (matter === null || matter.tenant_id !== tenant) return null;
    const doc = await persistence.getDocument(documentId);
    if (doc === null || doc.tenant_id !== tenant || doc.matter_id !== matterId) return null;
    return { id: doc.id, filename: doc.filename, content_hash: doc.content_hash };
  };

  const outcome = await openRegisteredOriginal(payload.matterId, payload.documentId, {
    lookup,
    storageRoot: deps.storageRoot,
    reveal: deps.reveal,
    ...(deps.verify !== undefined ? { verify: deps.verify } : {}),
  });

  // Rebuilt, not forwarded.
  if (outcome.ok) return { ok: true };
  if (outcome.code === "document_unverifiable") {
    return { ok: false, code: "document_unverifiable", reason: outcome.reason };
  }
  return { ok: false, code: outcome.code };
}
