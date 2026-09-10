// Evidence-item DTOs for the three `casebox:evidence:*` channels (product plan R2, WI-10).
//
// The write path the T3 catalogue has been waiting for. The schema
// (case-box-evidence-item.schema.json), the persistence API (appendEvidenceItem /
// transitionEvidenceItem / listEvidenceItems) and the T3 export all existed and were inert,
// because nothing in the product could create an evidence item. These DTOs mirror the fact
// channels exactly: the renderer forwards only what a lawyer typed plus the identity of the
// matter and the document the evidence is drawn from; main injects every authority, status
// and provenance field.
//
// Two decisions worth stating:
// - An evidence item is CREATED FROM A REGISTERED DOCUMENT (`documentId` is required), never as a
//   free-standing record. `source_document_id` is therefore always set, so an exhibit is described
//   once and the catalogue row can always be traced to the original it stands for.
// - Transitions are `accepted` (adopt) and `rejected` (exclude) only. `superseded` needs a
//   replacement reference and is a different workflow; it is not exposed here.

import type { CaseBoxEvidenceItem } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";

// MARK: - casebox:evidence:list

export interface ListEvidenceItemsDto {
  readonly matterId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export const LIST_EVIDENCE_ITEMS_DTO_FIELDS = Object.freeze([
  "matterId",
  "limit",
  "cursor",
] as const);

export const LIST_EVIDENCE_ITEMS_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "matter_id",
  "status",
  "source_document_id",
] as const);

export const LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS = Object.freeze([
  "id",
  "matter_id",
  "source_document_id",
  "exhibit_page_range",
  "lawyer_weight",
  "status",
  "supersedes_evidence_id",
  "notes",
  "evidence_title",
  "proof_statement",
  "display_order",
  "party_side",
  "created_at",
] as const);

export type RendererEvidenceRow = Pick<
  CaseBoxEvidenceItem,
  (typeof LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS)[number]
>;

export interface ListEvidenceItemsPage {
  readonly rows: ReadonlyArray<RendererEvidenceRow>;
  readonly next_cursor: string | null;
}

export type ListEvidenceItemsResult = IpcEnvelope<ListEvidenceItemsPage>;

// MARK: - casebox:evidence:create

export type EvidencePartySide = "our" | "opposing";
export type EvidenceLawyerWeight = "weak" | "moderate" | "strong";

export interface CreateEvidenceItemDto {
  readonly matterId: string;
  /** The registered document this evidence is drawn from. Required: no free-standing evidence. */
  readonly documentId: string;
  /** T3 证据名称. Required here even though the schema allows absence: an untitled catalogue row is useless. */
  readonly evidence_title: string;
  /** T3 证明内容. Optional; blank is expressed by absence. */
  readonly proof_statement?: string;
  /** T3 页码, lawyer-typed, free-form. Optional. */
  readonly exhibit_page_range?: string;
  /** Which side introduced it. Optional; absent means not yet decided. */
  readonly party_side?: EvidencePartySide;
  /** Defaults to "moderate" when absent. */
  readonly lawyer_weight?: EvidenceLawyerWeight;
  /** Catalogue order; absent rows sort after ordered rows. */
  readonly display_order?: number;
}

export const CREATE_EVIDENCE_ITEM_DTO_FIELDS = Object.freeze([
  "matterId",
  "documentId",
  "evidence_title",
  "proof_statement",
  "exhibit_page_range",
  "party_side",
  "lawyer_weight",
  "display_order",
] as const);

export const CREATE_EVIDENCE_ITEM_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "matter_id",
  "source_document_id",
  "status",
  "supersedes_evidence_id",
  "notes",
  "created_at",
] as const);

export const CREATE_EVIDENCE_ITEM_RESPONSE_FIELDS = LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS;

export type RendererCreatedEvidenceRow = RendererEvidenceRow;
export type CreateEvidenceItemResult = IpcEnvelope<RendererCreatedEvidenceRow>;

// MARK: - casebox:evidence:transition

export type EvidenceTransitionTarget = "accepted" | "rejected";

export interface TransitionEvidenceItemDto {
  readonly matterId: string;
  readonly evidenceId: string;
  readonly to: EvidenceTransitionTarget;
}

export const TRANSITION_EVIDENCE_ITEM_DTO_FIELDS = Object.freeze([
  "matterId",
  "evidenceId",
  "to",
] as const);

export const TRANSITION_EVIDENCE_ITEM_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "matter_id",
  "status",
  "supersedes_evidence_id",
  "replacement_evidence_id",
  "created_at",
] as const);

export const TRANSITION_EVIDENCE_ITEM_RESPONSE_FIELDS = LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS;

export type RendererTransitionedEvidenceRow = RendererEvidenceRow;
export type TransitionEvidenceItemResult = IpcEnvelope<RendererTransitionedEvidenceRow>;
