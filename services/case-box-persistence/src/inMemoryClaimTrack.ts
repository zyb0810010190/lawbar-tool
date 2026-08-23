// ClaimTrack storage + create/list for WI-PTA-VS1.
//
// Module-private sibling of inMemoryRepo.ts, mirroring inMemoryEvidence.ts /
// inMemoryFact.ts. VS-1 is create/get/list ONLY — no update/withdraw/resolve/
// delete path (a later slice), so the only audit kind ever emitted here is
// CLAIM_TRACK_CREATED ({ action: create, entity_type: claim_track,
// reasonRequired: false }).
//
// `prepareCreateClaimTrack` is SHARED by both the in-memory and SQLite paths:
// validation, the create-path guards, and audit-event construction all live
// here so the two implementations cannot diverge. The list comparator here is
// byte-identical to the SQLite ORDER BY (sort_order ASC, created_at ASC, id ASC).

import {
  buildCaseBoxAuditEvent,
  validateClaimTrack,
  type CaseBoxAuditEventKind,
  type CaseBoxClaimTrack,
  type CaseBoxMatter,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import {
  entityStateHash,
  priorHeadOf,
  type StoredAuditEvent,
} from "./auditChain.js";
import { InMemoryAuditLog } from "./auditHeadAnchor.js";

export interface ClaimTrackState {
  /** Per-matter array in insertion order. */
  claimTracksByMatter: Map<string, CaseBoxClaimTrack[]>;
  /** Fast O(1) duplicate-id index. */
  claimTrackIds: Set<string>;
  /** claimTrackId → matterId (parity with the evidence/fact index shape). */
  claimTrackIndex: Map<string, string>;
  /** claimTrackId → row reference. */
  claimTrackById: Map<string, CaseBoxClaimTrack>;
}

export function createClaimTrackState(): ClaimTrackState {
  return {
    claimTracksByMatter: new Map(),
    claimTrackIds: new Set(),
    claimTrackIndex: new Map(),
    claimTrackById: new Map(),
  };
}

/**
 * List comparator: sort_order ASC (numeric), then created_at ASC (binary
 * string), then id ASC. MUST stay byte-identical to the SQLite ORDER BY
 * `sort_order ASC, created_at ASC, id ASC` on the
 * (matter_id, sort_order, created_at, id) index (parity is tested).
 */
function compareClaimTracks(a: CaseBoxClaimTrack, b: CaseBoxClaimTrack): number {
  const ao = a.sort_order;
  const bo = b.sort_order;
  if (ao < bo) return -1;
  if (ao > bo) return 1;
  const ac = a.created_at ?? "";
  const bc = b.created_at ?? "";
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * The matter reference the create-path needs: its tenant_id (for the
 * tenant_mismatch check) and the set of its party ids (for the O3 layer-2
 * `unknown_party` existence check). Returned by the shared `getMatterPartyRef`
 * dependency, backed by the WeakMap store (in-memory) or a matter payload_json
 * read (SQLite).
 */
export interface MatterPartyRef {
  readonly tenant_id: string;
  readonly partyIds: ReadonlySet<string>;
}

/** Build a `MatterPartyRef` from a stored matter, or null when unknown. */
export function matterPartyRefOf(matter: CaseBoxMatter | null | undefined): MatterPartyRef | null {
  if (matter === null || matter === undefined) return null;
  const partyIds = new Set<string>();
  const parties = (matter.parties ?? []) as ReadonlyArray<{ id?: unknown }>;
  for (const party of parties) {
    if (typeof party.id === "string" && party.id.length > 0) partyIds.add(party.id);
  }
  return { tenant_id: matter.tenant_id, partyIds };
}

interface PrepareCreateDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
  /** Resolve the referenced matter's tenant + party-id set, or null when unknown. */
  getMatterPartyRef: (matterId: string) => MatterPartyRef | null;
}

interface PrepareCreateResult {
  row: CaseBoxClaimTrack;
  audit: StoredAuditEvent;
  matterId: string;
}

/**
 * Shared create-path preparation for both impls. Runs the create-path guards
 * (all rejections have parity because both impls call this one function), then
 * builds the single CLAIM_TRACK_CREATED audit event. Mutates nothing.
 */
export function prepareCreateClaimTrack(
  state: ClaimTrackState,
  input: unknown,
  deps: PrepareCreateDeps,
): PrepareCreateResult {
  // Pre-schema raw guards.
  if (input !== null && typeof input === "object") {
    // status MUST be "active" at create (mirror the evidence proposed-only
    // guard); withdrawn/resolved are reachable only via the deferred update
    // slice.
    const status = (input as { status?: unknown }).status;
    if (status !== undefined && status !== "active") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `createClaimTrack accepts only status === "active" at create (got ${JSON.stringify(status)}); use the update slice for withdrawn/resolved`,
      );
    }
    // A freshly-created row has never been updated: updated_at === created_at.
    const createdAt = (input as { created_at?: unknown }).created_at;
    const updatedAt = (input as { updated_at?: unknown }).updated_at;
    if (typeof createdAt === "string" && typeof updatedAt === "string" && createdAt !== updatedAt) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `createClaimTrack requires updated_at === created_at at create (got created_at=${JSON.stringify(createdAt)}, updated_at=${JSON.stringify(updatedAt)})`,
      );
    }
  }

  // Schema validation.
  const v = validateClaimTrack(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid claim track: ${v.summary}`);
  }
  const row = structuredClone(v.value) as CaseBoxClaimTrack;

  // Duplicate-id guard.
  if (state.claimTrackIds.has(row.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `claim track already exists: ${row.id}`);
  }

  // Matter existence + tenant consistency.
  const matter = deps.getMatterPartyRef(row.matter_id);
  if (matter === null) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${row.matter_id}`);
  }
  if (matter.tenant_id !== row.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `claim-track.tenant_id (${row.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }

  // O3 layer 2: the referenced party ids MUST exist on the loaded matter's
  // parties[]. VS-0 guarantees every real party carries a ULID, so a missing
  // reference is a genuine error, not a legacy gap.
  if (!matter.partyIds.has(row.claimant_party_id)) {
    throw new CaseBoxPersistenceError(
      "unknown_party",
      `claimant_party_id references a party not present in matter ${row.matter_id}: ${row.claimant_party_id}`,
    );
  }
  if (!matter.partyIds.has(row.respondent_party_id)) {
    throw new CaseBoxPersistenceError(
      "unknown_party",
      `respondent_party_id references a party not present in matter ${row.matter_id}: ${row.respondent_party_id}`,
    );
  }

  // Single CLAIM_TRACK_CREATED audit event (action: create → before_state_hash null).
  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const built = buildCaseBoxAuditEvent({
    kind: "CLAIM_TRACK_CREATED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: row.tenant_id,
    actor_user_id: row.actor_user_id,
    matter_id: row.matter_id,
    entity_id: row.id,
    before_state_hash: null,
    after_state_hash: entityStateHash(row),
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    row,
    audit: { sequence: stored.length + 1, event: built.value },
    matterId: row.matter_id,
  };
}

// ---------------------------------------------------------------------------
// applyCreateClaimTrack — in-memory create (mirror of applyAppendEvidenceItem)
// ---------------------------------------------------------------------------

interface ClaimTrackRepoView {
  matters: Map<string, CaseBoxMatter>;
  audit: InMemoryAuditLog;
}
interface ClaimTrackCDeps {
  generateId: () => string;
  nowIso: () => string;
}

export function applyCreateClaimTrack(
  state: ClaimTrackState,
  repo: ClaimTrackRepoView,
  deps: ClaimTrackCDeps,
  input: unknown,
): CaseBoxClaimTrack {
  const matterIdFromInput = input !== null && typeof input === "object"
    ? (input as { matter_id?: unknown }).matter_id
    : undefined;
  const prepared = prepareCreateClaimTrack(state, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => {
      if (typeof matterIdFromInput !== "string") return [];
      return repo.audit.get(matterIdFromInput);
    },
    getMatterPartyRef: (matterId) => matterPartyRefOf(repo.matters.get(matterId)),
  });
  const arr = state.claimTracksByMatter.get(prepared.matterId) ?? [];
  arr.push(prepared.row);
  state.claimTracksByMatter.set(prepared.matterId, arr);
  state.claimTrackIds.add(prepared.row.id);
  state.claimTrackIndex.set(prepared.row.id, prepared.matterId);
  state.claimTrackById.set(prepared.row.id, prepared.row);
  repo.audit.append(prepared.matterId, prepared.audit);
  return structuredClone(prepared.row) as CaseBoxClaimTrack;
}

// ---------------------------------------------------------------------------
// listClaimTracks — unpaginated, deterministic order (matter/tenant preflight
// is the caller's; this filters + sorts + clones).
// ---------------------------------------------------------------------------

export interface ListClaimTracksQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
}

export function listClaimTracks(
  state: ClaimTrackState,
  query: ListClaimTracksQuery,
): ReadonlyArray<CaseBoxClaimTrack> {
  const raw = state.claimTracksByMatter.get(query.matter_id) ?? [];
  const rows = raw.filter((c) => c.tenant_id === query.tenant_id).slice();
  rows.sort(compareClaimTracks);
  return rows.map((c) => structuredClone(c) as CaseBoxClaimTrack);
}
