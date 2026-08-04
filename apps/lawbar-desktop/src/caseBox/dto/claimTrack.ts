// ClaimTrack IPC DTOs / allowlists / response projection / result types
// (WI-PTA-VS2). Mirrors dto/fact.ts. Two channels: a READ listClaimTracks + a
// single WRITE createClaimTrack — no update/withdraw/resolve/delete (a later
// slice). `status` is server-set to "active" at create; the renderer never
// supplies id / tenant_id / actor_user_id / matter_id / status / created_at /
// updated_at.
import type { CaseBoxClaimTrack } from "case-box-contract";
import type { IpcEnvelope } from "./shared.js";


// ---------------------------------------------------------------------------
// createClaimTrack (WI-PTA-VS2). The renderer supplies the content fields + the
// scope (matterId) + a lawyer-controlled sort_order; the server injects every
// authority / lifecycle field (id / tenant_id / actor_user_id / status="active"
// / created_at === updated_at). track_type / our_role / title / sort_order are
// validated in the handler before the write; the four summaries default to ""
// when absent (the schema requires the keys present, empty allowed).
// ---------------------------------------------------------------------------

export interface CreateClaimTrackDto {
  readonly matterId: string;
  readonly track_type: "main_claim" | "counterclaim";
  readonly claimant_party_id: string;
  readonly respondent_party_id: string;
  readonly our_role: "asserting" | "responding";
  readonly title: string;
  readonly claim_summary?: string;
  readonly response_summary?: string;
  readonly legal_basis?: string;
  readonly calculation_summary?: string;
  readonly sort_order: number;
}

export const CREATE_CLAIM_TRACK_DTO_FIELDS = Object.freeze([
  "matterId",
  "track_type",
  "claimant_party_id",
  "respondent_party_id",
  "our_role",
  "title",
  "claim_summary",
  "response_summary",
  "legal_basis",
  "calculation_summary",
  "sort_order",
] as const);

// Server-authority / server-injected / lifecycle fields forbidden from the
// renderer create DTO (the server constructs them). matter_id is forbidden (the
// renderer supplies matterId); status / created_at / updated_at are server-set.
export const CREATE_CLAIM_TRACK_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "actor_user_id",
  "matter_id",
  "status",
  "created_at",
  "updated_at",
] as const);

// Renderer-safe RESPONSE allowlist. EXCLUDES the two authority identities
// tenant_id + actor_user_id; every other contract field is renderer-safe. Shared
// by BOTH the create response and the list-row projection (a claim track has no
// per-view divergence, unlike facts). Modelled as
// `Pick<CaseBoxClaimTrack, (typeof CREATE_CLAIM_TRACK_RESPONSE_FIELDS)[number]>`
// — NOT `Omit` — because the generated `CaseBoxClaimTrack` carries a
// `[k: string]: unknown` index signature that survives `Omit`, leaving the
// stripped authority fields still reachable (as `unknown`). `Pick` over the
// allowlist tuple yields a CLOSED type with no index signature, so an authority
// field is a compile error, and it ties the row type to the single runtime
// source of truth (the allowlist) — type and projection cannot drift.
export const CREATE_CLAIM_TRACK_RESPONSE_FIELDS = Object.freeze([
  "id",
  "matter_id",
  "track_type",
  "claimant_party_id",
  "respondent_party_id",
  "our_role",
  "title",
  "claim_summary",
  "response_summary",
  "legal_basis",
  "calculation_summary",
  "status",
  "sort_order",
  "created_at",
  "updated_at",
] as const);

export type RendererCreatedClaimTrack = Pick<
  CaseBoxClaimTrack,
  (typeof CREATE_CLAIM_TRACK_RESPONSE_FIELDS)[number]
>;

export type CreateClaimTrackResult = IpcEnvelope<RendererCreatedClaimTrack>;


// ---------------------------------------------------------------------------
// listClaimTracks (WI-PTA-VS2). Matter-scoped, UNPAGINATED (R4): the renderer
// supplies only { matterId }; the server injects tenant_id and returns a
// projected ARRAY (deterministic order owned by persistence), not a
// { rows, next_cursor } page.
// ---------------------------------------------------------------------------

export interface ListClaimTracksDto {
  readonly matterId: string;
}

export const LIST_CLAIM_TRACKS_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const LIST_CLAIM_TRACKS_FORBIDDEN_FIELDS = Object.freeze([
  "tenant_id",
  "actor_user_id",
] as const);

// The renderer-facing list ROW — the same allowlisted projection as the create
// response (claim tracks have no per-view divergence).
export type RendererClaimTrackRow = Pick<
  CaseBoxClaimTrack,
  (typeof CREATE_CLAIM_TRACK_RESPONSE_FIELDS)[number]
>;

// Unpaginated: the list handler returns a projected array, never a page wrapper.
export type ListClaimTracksResult = IpcEnvelope<ReadonlyArray<RendererClaimTrackRow>>;
