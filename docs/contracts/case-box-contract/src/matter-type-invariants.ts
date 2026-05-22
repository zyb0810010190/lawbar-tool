// Matter-type reconciliation invariants. Pure functions; no IO, no network,
// no persistence access. See dev-memo/plan-brief-matter-type.md §5 and §6.2.
//
// These helpers cover the cross-row invariants from R-5 that pure JSON Schema
// cannot express:
//
//   INV-4: CaseBoxDocument.supersedes_document_id must point to a document
//          in the same matter and same tenant. Schema-layer cannot enforce
//          cross-row references; this helper is the contract-layer check.
//          Persistence will call it at write time (deferred to the
//          persistence absorption WI).
//
//   INV-5: CaseBoxMatter.successor_matter_id must point to a matter in the
//          same tenant whose matter_type differs from the original matter
//          (matter-type immutability rule per project-requirements-brief
//          R-5 cross-category invariants).

export class DocumentSupersessionInvariantError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "DocumentSupersessionInvariantError";
    this.violation = violation;
  }
}

export class MatterSuccessorInvariantError extends Error {
  readonly violation: string;
  constructor(violation: string) {
    super(violation);
    this.name = "MatterSuccessorInvariantError";
    this.violation = violation;
  }
}

type DocumentSupersessionInput = {
  id: string;
  tenant_id: string;
  matter_id: string;
  supersedes_document_id?: string | null;
};

type MatterSuccessorInput = {
  id: string;
  tenant_id: string;
  matter_type: string;
  successor_matter_id?: string | null;
};

/**
 * Assert that a document's supersession reference is valid:
 *   1. No self-cycle (`id === supersedes_document_id`).
 *   2. Prior document is in the same tenant.
 *   3. Prior document is in the same matter.
 *
 * Caller is responsible for loading the prior document; this helper is pure.
 * When `supersedes_document_id` is null or undefined, the helper is a no-op.
 */
export function assertValidDocumentSupersession(input: {
  doc: DocumentSupersessionInput;
  prior: { id: string; tenant_id: string; matter_id: string } | null;
}): void {
  const { doc, prior } = input;
  const ref = doc.supersedes_document_id ?? null;
  if (ref === null) return;

  if (ref === doc.id) {
    throw new DocumentSupersessionInvariantError(
      "supersedes_document_id must not equal the document's own id",
    );
  }

  if (prior === null) {
    throw new DocumentSupersessionInvariantError(
      `supersedes_document_id ${ref} does not resolve to an existing document`,
    );
  }

  if (prior.id !== ref) {
    throw new DocumentSupersessionInvariantError(
      `prior document id ${prior.id} does not match supersedes_document_id ${ref}`,
    );
  }

  if (prior.tenant_id !== doc.tenant_id) {
    throw new DocumentSupersessionInvariantError(
      "prior document tenant_id must equal the new document's tenant_id",
    );
  }

  if (prior.matter_id !== doc.matter_id) {
    throw new DocumentSupersessionInvariantError(
      "prior document matter_id must equal the new document's matter_id",
    );
  }
}

/**
 * Assert that a matter's successor reference is valid:
 *   1. No self-cycle (`id === successor_matter_id`).
 *   2. Successor matter is in the same tenant.
 *   3. Successor matter's `matter_type` differs from the original's
 *      (per the matter-type-immutability workaround: counsel→litigation
 *      evolution creates a new matter rather than mutating the original).
 *
 * Caller is responsible for loading the successor matter; this helper is pure.
 * When `successor_matter_id` is null or undefined, the helper is a no-op.
 */
export function assertValidMatterSuccessor(input: {
  original: MatterSuccessorInput;
  successor: { id: string; tenant_id: string; matter_type: string } | null;
}): void {
  const { original, successor } = input;
  const ref = original.successor_matter_id ?? null;
  if (ref === null) return;

  if (ref === original.id) {
    throw new MatterSuccessorInvariantError(
      "successor_matter_id must not equal the matter's own id",
    );
  }

  if (successor === null) {
    throw new MatterSuccessorInvariantError(
      `successor_matter_id ${ref} does not resolve to an existing matter`,
    );
  }

  if (successor.id !== ref) {
    throw new MatterSuccessorInvariantError(
      `successor matter id ${successor.id} does not match successor_matter_id ${ref}`,
    );
  }

  if (successor.tenant_id !== original.tenant_id) {
    throw new MatterSuccessorInvariantError(
      "successor matter tenant_id must equal the original matter's tenant_id",
    );
  }

  if (successor.matter_type === original.matter_type) {
    throw new MatterSuccessorInvariantError(
      `successor matter_type must differ from original matter_type "${original.matter_type}" (matter-type immutability workaround)`,
    );
  }
}
