// Document-registration extraction for Phase A5 LOC discipline.
//
// Mechanical move of registerDocument's body from inMemoryRepo so the
// repo class stays under the 800 pure-LOC fail threshold. Behavior is
// unchanged.

import {
  buildCaseBoxAuditEvent,
  validateDocument,
  type CaseBoxAuditEventKind,
  type CaseBoxDocument,
  type CaseBoxMatter,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import {
  entityStateHash,
  priorHeadOf,
  type StoredAuditEvent,
} from "./auditChain.js";

interface PrepareRegisterDocumentResult {
  document: CaseBoxDocument;
  audit: StoredAuditEvent;
}

interface RegisterDocumentDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
}

export function prepareRegisterDocument(
  matterId: string,
  matter: CaseBoxMatter,
  input: unknown,
  hasExistingDocumentId: (id: string) => boolean,
  deps: RegisterDocumentDeps,
): PrepareRegisterDocumentResult {
  const v = validateDocument(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid document submission: ${v.summary}`);
  }
  const document = structuredClone(v.value) as CaseBoxDocument;
  if (document.matter_id !== matterId) {
    throw new CaseBoxPersistenceError(
      "matter_id_mismatch",
      `document.matter_id (${document.matter_id}) does not match matterId argument (${matterId})`,
    );
  }
  if (document.tenant_id !== matter.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `document.tenant_id (${document.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  if (document.status !== "registered") {
    throw new CaseBoxPersistenceError(
      "invalid_initial_state",
      `document must be created with status="registered" (got ${JSON.stringify(document.status)})`,
    );
  }
  if (hasExistingDocumentId(document.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `document already exists: ${document.id}`);
  }
  const afterHash = entityStateHash(document);
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const stamp = deps.nowIso();
  const built = buildCaseBoxAuditEvent({
    kind: "DOCUMENT_REGISTERED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: document.tenant_id,
    actor_user_id: document.actor_user_id,
    matter_id: matterId,
    entity_id: document.id,
    before_state_hash: null,
    after_state_hash: afterHash,
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }
  return {
    document,
    audit: { sequence: stored.length + 1, event: built.value },
  };
}
