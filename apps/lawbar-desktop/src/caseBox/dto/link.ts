// Evidence link IPC DTOs / allowlists / response projections / result types
// (WI-A3-LINK-IPC-T1) for the audited link lifecycle: create / unlink / relink /
// list / export-citations. Mirrors dto/fact.ts. Every request DTO is camelCase
// renderer-facing; the server injects every authority field (tenant_id /
// actor_user_id) and persistence owns id / status / created_at / unlink markers.
//
// The link lifecycle is SQLite-only (the concrete SqliteCaseBoxPersistence
// methods + the standalone resolveLinkStatuses / buildExportCitations); the
// renderer never sees tenant_id or payload_json (LINK_RESPONSE_FIELDS excludes
// both — same authority-stripping discipline as the fact allowlists).

import type { ExportCitationResult } from "case-box-persistence";
import type { IpcEnvelope } from "./shared.js";


// ---------------------------------------------------------------------------
// createLink — insert a durable active link row + emit LINK_CREATED. The
// renderer supplies ONLY the matter scope + the source/anchor identifiers; the
// server injects tenant_id + actor_user_id and persistence generates id /
// status / created_at.
// ---------------------------------------------------------------------------

export interface CreateLinkDto {
  readonly matterId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly anchorId: string;
}

export const CREATE_LINK_DTO_FIELDS = Object.freeze([
  "matterId",
  "sourceType",
  "sourceId",
  "anchorId",
] as const);

// Server-authority / server-injected / persistence-owned fields forbidden from
// the renderer create DTO (the server constructs every one of them).
export const CREATE_LINK_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenantId",
  "tenant_id",
  "actorUserId",
  "actor_user_id",
  "matter_id",
  "status",
  "created_at",
  "createdAt",
  "unlinked_at",
  "unlinkedAt",
  "unlink_reason",
  "unlinkReason",
] as const);


// ---------------------------------------------------------------------------
// unlinkLink — set the V12 marker columns (unlinked_at + unlink_reason) + emit
// LINK_UNLINKED. An explicit unlink REQUIRES a non-blank reason.
// ---------------------------------------------------------------------------

export interface UnlinkLinkDto {
  readonly matterId: string;
  readonly linkId: string;
  readonly unlinkReason: string;
}

export const UNLINK_LINK_DTO_FIELDS = Object.freeze([
  "matterId",
  "linkId",
  "unlinkReason",
] as const);

export const UNLINK_LINK_FORBIDDEN_FIELDS = Object.freeze([
  "tenantId",
  "tenant_id",
  "actorUserId",
  "actor_user_id",
  "id",
  "link_id",
  "unlinked_at",
  "unlink_reason",
] as const);


// ---------------------------------------------------------------------------
// relinkLink — clear the V12 marker columns + emit LINK_RELINKED. Relink takes
// NO reason (it restores the link to active and clears unlink_reason).
// ---------------------------------------------------------------------------

export interface RelinkLinkDto {
  readonly matterId: string;
  readonly linkId: string;
}

export const RELINK_LINK_DTO_FIELDS = Object.freeze([
  "matterId",
  "linkId",
] as const);

export const RELINK_LINK_FORBIDDEN_FIELDS = Object.freeze([
  "tenantId",
  "tenant_id",
  "actorUserId",
  "actor_user_id",
  "id",
  "link_id",
  "unlinkReason",
  "unlink_reason",
  "reason",
] as const);


// ---------------------------------------------------------------------------
// listLinks — list every link row in the matter (resolver-refreshed status).
// ---------------------------------------------------------------------------

export interface ListLinksDto {
  readonly matterId: string;
}

export const LIST_LINKS_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const LIST_LINKS_FORBIDDEN_FIELDS = Object.freeze([
  "tenantId",
  "tenant_id",
  "actorUserId",
  "actor_user_id",
  "matter_id",
] as const);


// ---------------------------------------------------------------------------
// exportLinkCitations — deterministic export-citation run (buildExportCitations).
// Same renderer-supplied scope as listLinks (matterId only).
// ---------------------------------------------------------------------------

export interface ExportLinkCitationsDto {
  readonly matterId: string;
}

export const EXPORT_LINK_CITATIONS_DTO_FIELDS = Object.freeze([
  "matterId",
] as const);

export const EXPORT_LINK_CITATIONS_FORBIDDEN_FIELDS = Object.freeze([
  "tenantId",
  "tenant_id",
  "actorUserId",
  "actor_user_id",
  "matter_id",
] as const);


// ---------------------------------------------------------------------------
// Renderer-safe RESPONSE-row allowlist + projected row type. EXCLUDES the
// server-authority field tenant_id AND the internal payload_json (never crosses
// the IPC boundary). Same projection discipline as the fact allowlists.
// ---------------------------------------------------------------------------

export const LINK_RESPONSE_FIELDS = Object.freeze([
  "id",
  "matter_id",
  "source_type",
  "source_id",
  "anchor_id",
  "status",
  "created_at",
  "unlinked_at",
  "unlink_reason",
] as const);

// The renderer-facing link row. A CLOSED type over the allowlist (not Omit of
// CaseBoxLinkRow) so an authority field would be a compile error and the type
// is tied to the single runtime source of truth (LINK_RESPONSE_FIELDS).
export interface RendererLink {
  readonly id: string;
  readonly matter_id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly anchor_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly unlinked_at: string | null;
  readonly unlink_reason: string | null;
}


// ---------------------------------------------------------------------------
// Result envelopes.
// ---------------------------------------------------------------------------

export type CreateLinkResult = IpcEnvelope<RendererLink>;
export type UnlinkLinkResult = IpcEnvelope<RendererLink>;
export type RelinkLinkResult = IpcEnvelope<RendererLink>;
export type ListLinksResult = IpcEnvelope<readonly RendererLink[]>;
export type ExportLinkCitationsResult = IpcEnvelope<ExportCitationResult>;
