// T3 证据目录及说明 preview IPC DTOs / allowlists / result type
// (WI-FORMS-T3-S2-CATALOG-PREVIEW-00). ONE new read-only channel
// (casebox:t3:previewCatalog) that builds and returns the merged S1
// T3CatalogModel for a matter. The request DTO + result type live here (mirrors
// dto/document.ts); the renderer's read type mirrors T3CatalogModel structurally
// in renderer/types.ts (the renderer cannot import the main-process node:crypto
// model). A submitter refusal is an EXPECTED review state carried in the SUCCESS
// value as a discriminated union — NEVER an error envelope, NEVER null.
import type { IpcEnvelope } from "./shared.js";
// TYPE-ONLY reference to the merged S1 model (src/caseBox/export/t3CatalogModel.ts).
// Erased at compile time — no runtime import, no node:crypto coupling on the DTO
// barrel. The S1 module is consumed READ-ONLY (never modified, never reimplemented).
import type { T3CatalogModel, T3RefusalCode } from "../export/t3CatalogModel.js";


// Export-time submitter selection for a matter that does NOT have exactly one
// client party. Mirrors T3SubmitterSelection in the S1 model. The renderer never
// supplies tenant_id / actor_user_id (server injects the active tenant).
export interface T3SubmitterSelectionDto {
  readonly partyIndex: number;
  readonly displayNameEcho: string;
}


export interface T3PreviewCatalogDto {
  readonly matterId: string;
  readonly submitterSelection?: T3SubmitterSelectionDto;
}


export const T3_PREVIEW_CATALOG_DTO_FIELDS = Object.freeze([
  "matterId",
  "submitterSelection",
] as const);


export const T3_PREVIEW_CATALOG_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);


// Discriminated SUCCESS value: a built model XOR a submitter-refusal review state.
// A read error (unknown_matter / tenant_mismatch / invalid_payload) rides in the
// { ok: false, error } arm of IpcEnvelope, not here.
export type T3PreviewCatalogValue =
  | { readonly kind: "model"; readonly model: T3CatalogModel; readonly modelSha256?: string }
  | { readonly kind: "refusal"; readonly code: T3RefusalCode };


export type T3PreviewCatalogResult = IpcEnvelope<T3PreviewCatalogValue>;
