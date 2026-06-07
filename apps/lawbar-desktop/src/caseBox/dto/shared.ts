// Shared IPC DTO primitives — the cross-entity envelope + list bounds. Extracted
// from dto.ts (WI-DTO1, behavior-preserving) so the DTO hub splits per entity
// behind the dto.ts barrel. Imported by every per-entity dto module.
import type { CaseBoxPersistenceErrorCode } from "case-box-persistence";


export type IpcEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcErrorEnvelope };


export interface IpcErrorEnvelope {
  readonly kind: "case_box_persistence_error";
  readonly code: CaseBoxPersistenceErrorCode;
  readonly message: string;
  readonly details?: { readonly schemaPath?: string; readonly keyword?: string };
}


export const MAX_LIST_LIMIT = 200;

export const MAX_CURSOR_LENGTH = 512;
