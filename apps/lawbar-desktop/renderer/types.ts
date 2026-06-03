// Renderer-side DTO + IPC envelope type declarations.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §"NEW (impl WI)" types.ts row.
//
// Renderer cannot `import` from `src/caseBox/dto.ts` (renderer-import lint
// `FORBIDDEN_RELATIVE_RESOLVED_PREFIX` includes `src/caseBox`). Field-name
// drift between this file and the canonical `src/caseBox/dto.ts` is caught by
// `tests/renderer-dto-sync.test.mjs`.

export type MatterType =
  | "litigation"
  | "arbitration"
  | "advisory"
  | "due_diligence"
  | "criminal_defense"
  | "other";

export type ConfidentialityClass = "normal" | "heightened" | "sealed";

export type MatterStatus = "active" | "archived";

// Display-only ledger category derived from `MatterType`. Per
// dev-memo/plan-casebox-ui-design-hardening-00.md §3 row 9 + handoff §03 Task 5.
// Mapping lives in renderer/format.ts; this type is additive ONLY and does NOT
// change any DTO interface or RENDERER_*_DTO_FIELDS array — the DTO sync test
// continues passing unchanged.
export type LedgerCategory = "litigation" | "counsel" | "non_litigation";

export interface Party {
  readonly role: string;
  readonly display_name: string;
  readonly party_kind: string;
  readonly notes?: string;
}

export interface Jurisdiction {
  readonly value: string;
  readonly locked: boolean;
}

export interface CreateMatterDto {
  readonly name: string;
  readonly matter_type: MatterType;
  readonly jurisdiction: Jurisdiction;
  readonly parties: ReadonlyArray<Party>;
  readonly confidentiality_class: ConfidentialityClass;
  readonly retainer_scope?: string;
  readonly case_type_text?: string;
  readonly case_progress_text?: string;
  readonly court_contact_text?: string;
  readonly contention_summary_text?: string;
}

export interface GetMatterDto {
  readonly matterId: string;
}

export interface ListMattersDto {
  readonly status?: MatterStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ArchiveMatterDto {
  readonly matterId: string;
  readonly reason: string;
}

export interface ChainHeadDto {
  readonly matterId: string;
}

export interface ListAuditEventsDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListDocumentsDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface GetDocumentDto {
  readonly matterId: string;
  readonly documentId: string;
}

export type DocType =
  | "pleading"
  | "contract"
  | "correspondence"
  | "transcript"
  | "exhibit"
  | "other";

export interface RegisterDocumentDto {
  readonly matterId: string;
  readonly doc_type: DocType;
}

export interface IpcErrorEnvelope {
  readonly kind: "case_box_persistence_error";
  readonly code: string;
  readonly message: string;
  readonly details?: { readonly schemaPath?: string; readonly keyword?: string };
}

export type IpcEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcErrorEnvelope };

// Field-name allowlists. Sync-tested against `src/caseBox/dto.ts` by
// `tests/renderer-dto-sync.test.mjs`.

export const RENDERER_CREATE_MATTER_DTO_FIELDS = Object.freeze([
  "name",
  "matter_type",
  "jurisdiction",
  "parties",
  "confidentiality_class",
  "retainer_scope",
  "case_type_text",
  "case_progress_text",
  "court_contact_text",
  "contention_summary_text",
] as const);

export const RENDERER_GET_MATTER_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const RENDERER_LIST_MATTERS_DTO_FIELDS = Object.freeze([
  "status",
  "limit",
  "cursor",
] as const);

export const RENDERER_ARCHIVE_MATTER_DTO_FIELDS = Object.freeze([
  "matterId",
  "reason",
] as const);

export const RENDERER_CHAIN_HEAD_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const RENDERER_LIST_AUDIT_EVENTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const RENDERER_LIST_DOCUMENTS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const RENDERER_GET_DOCUMENT_DTO_FIELDS = Object.freeze([
  "matterId",
  "documentId",
] as const);

export const RENDERER_REGISTER_DOCUMENT_DTO_FIELDS = Object.freeze([
  "matterId",
  "doc_type",
] as const);
