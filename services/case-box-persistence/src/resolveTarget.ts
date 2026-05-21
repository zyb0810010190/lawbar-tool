// Shared document-target resolver. Used by inMemoryClassification (A2),
// inMemoryPrivilege (A3), and inMemoryFact (A4) to perform the tenant /
// matter / document consistency check that previously was inlined three
// times. Closes A2 F2.2 and A3 F2.2 deferred-audit-backlog rows.
//
// Dependency-injected: callers pass a getDocument callback rather than
// importing the persistence's private InternalState. Preserves the
// existing pattern from A1's prepare* helpers.

import type { CaseBoxDocument } from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";

export interface ResolveDocumentDeps {
  getDocument: (documentId: string) => { document: CaseBoxDocument } | null;
}

export interface ResolveDocumentQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly target_id: string;
}

/**
 * Throws CaseBoxPersistenceError with code `unknown_document`,
 * `tenant_mismatch`, or `matter_id_mismatch`. Returns the resolved
 * document entry on success.
 */
export function resolveDocumentTarget(
  deps: ResolveDocumentDeps,
  query: ResolveDocumentQuery,
): { document: CaseBoxDocument } {
  const entry = deps.getDocument(query.target_id);
  if (entry === null) {
    throw new CaseBoxPersistenceError(
      "unknown_document",
      `unknown document: ${query.target_id}`,
    );
  }
  if (entry.document.tenant_id !== query.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `document.tenant_id (${entry.document.tenant_id}) does not match query.tenant_id (${query.tenant_id})`,
    );
  }
  if (entry.document.matter_id !== query.matter_id) {
    throw new CaseBoxPersistenceError(
      "matter_id_mismatch",
      `document.matter_id (${entry.document.matter_id}) does not match query.matter_id (${query.matter_id})`,
    );
  }
  return entry;
}
