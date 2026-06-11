// Docket-entry storage + Mode A/B/C lifecycle for Phase A5.
//
// Step 6 ADR §6 modes:
//   Mode A — propose: appendDocketEntry creates entry in proposed state.
//   Mode B — confirm: ATOMIC two-write step. Entry transitions to
//     confirmed AND a new CaseBoxDeadline row is materialized. Both
//     commit or both roll back. Emits DOCKET_ENTRY_CONFIRMED (update)
//     followed by DEADLINE_REGISTERED (create, before_state_hash null
//     per audit-log.ts:365).
//   Mode C — dismiss: entry transitions to dismissed; reason required.
//
// Idempotent re-confirm (Step 6 ADR §6 step 1): if entry is already
// confirmed AND confirmed_deadline_id resolves to an existing deadline
// row, return the existing materialization and emit NO audit.
//
// v1 date_only confirmation is FORBIDDEN; assertValidDocketEntryConfirmation
// enforces. Persistence maps DocketEntryConfirmationError → invalid_argument.

import {
  assertValidDocketEntryConfirmation,
  assertValidDocketEntryEdit,
  assertValidDocketEntryTransition,
  assertValidIanaTimezone,
  assertValidNewDocketEntry,
  buildCaseBoxAuditEvent,
  DocketEntryConfirmationError,
  DocketEntryCreationError,
  DocketEntryEditError,
  IllegalTransitionError,
  InvalidIanaTimezoneError,
  validateDeadline,
  validateDocketEntry,
  type CaseBoxAuditEventKind,
  type CaseBoxDeadline,
  type CaseBoxDocketEntry,
} from "case-box-contract";

import { CaseBoxPersistenceError } from "./errors.js";
import type { EditDocketEntryOpts } from "./types.js";
import {
  computeFiltersHash,
  decodeCursor,
  encodeCursor,
  resolveLimit,
} from "./cursor.js";
import {
  entityStateHash,
  eventHashFn,
  priorHeadOf,
  type StoredAuditEvent,
} from "./auditChain.js";
import {
  resolveDocumentTarget,
  type ResolveDocumentDeps,
} from "./resolveTarget.js";
import {
  buildDeadlineRowFromDocketEntry,
  type DeadlineState,
} from "./inMemoryDeadline.js";

export interface DocketState {
  entriesByMatter: Map<string, CaseBoxDocketEntry[]>;
  docketIds: Set<string>;
  docketIndex: Map<string, string>;
  docketById: Map<string, CaseBoxDocketEntry>;
}

export function createDocketState(): DocketState {
  return {
    entriesByMatter: new Map(),
    docketIds: new Set(),
    docketIndex: new Map(),
    docketById: new Map(),
  };
}

function compareDocketEntriesChronological(
  a: CaseBoxDocketEntry,
  b: CaseBoxDocketEntry,
): number {
  const ap = a.proposed_at ?? "";
  const bp = b.proposed_at ?? "";
  if (ap < bp) return -1;
  if (ap > bp) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Mode A — appendDocketEntry
// ---------------------------------------------------------------------------

interface AppendDeps extends ResolveDocumentDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: () => StoredAuditEvent[];
}

interface PrepareAppendResult {
  row: CaseBoxDocketEntry;
  audit: StoredAuditEvent;
  matterId: string;
}

export function prepareAppendDocketEntry(
  state: DocketState,
  input: unknown,
  deps: AppendDeps,
): PrepareAppendResult {
  if (input !== null && typeof input === "object") {
    const cs = (input as { confirmation_state?: unknown }).confirmation_state;
    if (cs !== undefined && cs !== "proposed") {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `appendDocketEntry accepts only confirmation_state === "proposed" (got ${JSON.stringify(cs)}); use confirmDocketEntry or dismissDocketEntry for transitions`,
      );
    }
  }

  const v = validateDocketEntry(input);
  if (!v.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `invalid docket entry: ${v.summary}`);
  }
  const row = structuredClone(v.value) as CaseBoxDocketEntry;

  if (state.docketIds.has(row.id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `docket entry already exists: ${row.id}`);
  }

  try {
    assertValidNewDocketEntry(row);
  } catch (e) {
    if (e instanceof DocketEntryCreationError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }

  // IANA validation runs whenever timezone is non-null (regardless of kind).
  if (row.proposed_due_at_timezone !== null) {
    try {
      assertValidIanaTimezone(row.proposed_due_at_timezone);
    } catch (e) {
      if (e instanceof InvalidIanaTimezoneError) {
        throw new CaseBoxPersistenceError("invalid_payload", e.message);
      }
      throw e;
    }
  }

  // Source-document tenant/matter consistency when set.
  if (row.source_document_id !== null) {
    resolveDocumentTarget(
      { getDocument: deps.getDocument },
      {
        tenant_id: row.tenant_id,
        matter_id: row.matter_id,
        target_id: row.source_document_id,
      },
    );
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter();
  const prevHash = priorHeadOf(stored);
  const built = buildCaseBoxAuditEvent({
    kind: "DOCKET_ENTRY_PROPOSED" as CaseBoxAuditEventKind,
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
// Mode B — confirmDocketEntry (atomic; emits 2 audit events)
// ---------------------------------------------------------------------------

export interface ConfirmDocketEntryOpts {
  readonly confirmation_actor_user_id: string;
  readonly confirmed_at: string;
  readonly deadline_id: string;
}

export interface PrepareConfirmResult {
  /** When true, the call is idempotent: return existing entry + deadline; no audit. */
  readonly idempotent: boolean;
  readonly entry: CaseBoxDocketEntry;
  readonly deadline: CaseBoxDeadline;
  /** Empty when idempotent. */
  readonly audits: ReadonlyArray<StoredAuditEvent>;
  readonly matterId: string;
}

interface ConfirmDeps {
  generateId: () => string;
  nowIso: () => string;
  storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
}

export function prepareConfirmDocketEntry(
  docketState: DocketState,
  deadlineState: DeadlineState,
  entryId: string,
  opts: ConfirmDocketEntryOpts,
  deps: ConfirmDeps,
): PrepareConfirmResult {
  if (typeof entryId !== "string" || entryId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `entryId must be a non-empty string`);
  }
  if (opts === null || typeof opts !== "object") {
    throw new CaseBoxPersistenceError("invalid_argument", `opts must be an object`);
  }
  if (typeof opts.confirmation_actor_user_id !== "string" || opts.confirmation_actor_user_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `confirmation_actor_user_id must be a non-empty string`);
  }
  if (typeof opts.confirmed_at !== "string" || opts.confirmed_at.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `confirmed_at must be a non-empty ISO-8601 timestamp`);
  }
  if (typeof opts.deadline_id !== "string" || opts.deadline_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `deadline_id must be a non-empty string`);
  }
  const matterId = docketState.docketIndex.get(entryId);
  if (matterId === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown docket entry: ${entryId}`);
  }
  const prior = docketState.docketById.get(entryId);
  if (prior === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown docket entry (docketById miss): ${entryId}`);
  }

  // Idempotency preflight (Step 6 ADR §6 Mode B step 1).
  if (
    prior.confirmation_state === "confirmed" &&
    typeof prior.confirmed_deadline_id === "string" &&
    prior.confirmed_deadline_id.length > 0
  ) {
    const existingDeadline = deadlineState.deadlineById.get(prior.confirmed_deadline_id);
    if (existingDeadline !== undefined) {
      return {
        idempotent: true,
        entry: prior,
        deadline: existingDeadline,
        audits: [],
        matterId,
      };
    }
  }

  // State-machine + date_only check via the contract's confirmation helper.
  try {
    assertValidDocketEntryConfirmation(
      { confirmation_state: prior.confirmation_state, proposed_due_at_kind: prior.proposed_due_at_kind },
      "lawyer",
    );
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    if (e instanceof DocketEntryConfirmationError) {
      throw new CaseBoxPersistenceError("invalid_argument", e.message);
    }
    throw e;
  }

  // Patched entry.
  const next: CaseBoxDocketEntry = structuredClone(prior) as CaseBoxDocketEntry;
  (next as { confirmation_state: string }).confirmation_state = "confirmed";
  (next as { confirmation_actor_user_id?: string | null }).confirmation_actor_user_id = opts.confirmation_actor_user_id;
  (next as { confirmed_at?: string | null }).confirmed_at = opts.confirmed_at;
  (next as { confirmed_deadline_id?: string | null }).confirmed_deadline_id = opts.deadline_id;

  const entryReValid = validateDocketEntry(next);
  if (!entryReValid.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `confirm would produce schema-invalid docket entry: ${entryReValid.summary}`,
    );
  }

  // Build the new deadline row + validate it BEFORE any mutation.
  // Mode B atomicity: if deadline build/validate fails, the entry patch is
  // never applied and zero audit events are emitted.
  if (deadlineState.deadlineIds.has(opts.deadline_id)) {
    throw new CaseBoxPersistenceError("duplicate_id", `deadline_id already exists: ${opts.deadline_id}`);
  }
  const deadline = buildDeadlineRowFromDocketEntry(next, {
    deadline_id: opts.deadline_id,
    confirmation_actor_user_id: opts.confirmation_actor_user_id,
  });
  const deadlineReValid = validateDeadline(deadline);
  if (!deadlineReValid.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `confirm would produce schema-invalid deadline: ${deadlineReValid.summary}`,
    );
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter(matterId);
  const prevHash1 = priorHeadOf(stored);

  // Audit 1: DOCKET_ENTRY_CONFIRMED (update; reason absent).
  const built1 = buildCaseBoxAuditEvent({
    kind: "DOCKET_ENTRY_CONFIRMED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: next.tenant_id,
    actor_user_id: opts.confirmation_actor_user_id,
    matter_id: matterId,
    entity_id: next.id,
    before_state_hash: entityStateHash(prior),
    after_state_hash: entityStateHash(next),
    prev_event_hash: prevHash1,
    timestamp: stamp,
  });
  if (!built1.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected (confirmed): ${built1.summary}`);
  }
  const audit1: StoredAuditEvent = { sequence: stored.length + 1, event: built1.value };

  // Audit 2: DEADLINE_REGISTERED (create; before_state_hash null per :365).
  // prev_event_hash chains from audit1's eventHashFn (NOT entityStateHash).
  const prevHash2 = eventHashFn(built1.value);
  const built2 = buildCaseBoxAuditEvent({
    kind: "DEADLINE_REGISTERED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: deadline.tenant_id,
    actor_user_id: opts.confirmation_actor_user_id,
    matter_id: matterId,
    entity_id: deadline.id,
    before_state_hash: null,
    after_state_hash: entityStateHash(deadline),
    prev_event_hash: prevHash2,
    timestamp: stamp,
  });
  if (!built2.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected (deadline_registered): ${built2.summary}`);
  }
  const audit2: StoredAuditEvent = { sequence: stored.length + 2, event: built2.value };

  return {
    idempotent: false,
    entry: next,
    deadline,
    audits: [audit1, audit2],
    matterId,
  };
}

// ---------------------------------------------------------------------------
// Mode C — dismissDocketEntry
// ---------------------------------------------------------------------------

export interface DismissDocketEntryOpts {
  readonly dismissal_actor_user_id: string;
  readonly dismissed_at: string;
  readonly dismissal_reason: string;
}

interface PrepareDismissResult {
  next: CaseBoxDocketEntry;
  audit: StoredAuditEvent;
  matterId: string;
}

export function prepareDismissDocketEntry(
  state: DocketState,
  entryId: string,
  opts: DismissDocketEntryOpts,
  deps: ConfirmDeps,
): PrepareDismissResult {
  if (typeof entryId !== "string" || entryId.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `entryId must be a non-empty string`);
  }
  if (opts === null || typeof opts !== "object") {
    throw new CaseBoxPersistenceError("invalid_argument", `opts must be an object`);
  }
  if (typeof opts.dismissal_actor_user_id !== "string" || opts.dismissal_actor_user_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `dismissal_actor_user_id must be a non-empty string`);
  }
  if (typeof opts.dismissed_at !== "string" || opts.dismissed_at.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `dismissed_at must be a non-empty ISO-8601 timestamp`);
  }
  if (typeof opts.dismissal_reason !== "string" || opts.dismissal_reason.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", `dismissal_reason must be a non-empty string`);
  }
  const matterId = state.docketIndex.get(entryId);
  if (matterId === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown docket entry: ${entryId}`);
  }
  const prior = state.docketById.get(entryId);
  if (prior === undefined) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown docket entry (docketById miss): ${entryId}`);
  }

  try {
    assertValidDocketEntryTransition(prior.confirmation_state, "dismissed", "lawyer", opts.dismissal_reason);
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    throw e;
  }

  const next: CaseBoxDocketEntry = structuredClone(prior) as CaseBoxDocketEntry;
  (next as { confirmation_state: string }).confirmation_state = "dismissed";
  (next as { dismissal_actor_user_id?: string | null }).dismissal_actor_user_id = opts.dismissal_actor_user_id;
  (next as { dismissed_at?: string | null }).dismissed_at = opts.dismissed_at;
  (next as { dismissal_reason?: string | null }).dismissal_reason = opts.dismissal_reason;

  const reValid = validateDocketEntry(next);
  if (!reValid.ok) {
    throw new CaseBoxPersistenceError(
      "invalid_argument",
      `dismiss would produce schema-invalid docket entry: ${reValid.summary}`,
    );
  }

  const stamp = deps.nowIso();
  const stored = deps.storedAuditEventsForMatter(matterId);
  const prevHash = priorHeadOf(stored);
  const built = buildCaseBoxAuditEvent({
    kind: "DOCKET_ENTRY_DISMISSED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: next.tenant_id,
    actor_user_id: opts.dismissal_actor_user_id,
    matter_id: matterId,
    entity_id: next.id,
    before_state_hash: entityStateHash(prior),
    after_state_hash: entityStateHash(next),
    prev_event_hash: prevHash,
    timestamp: stamp,
    reason: opts.dismissal_reason,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected: ${built.summary}`);
  }

  return {
    next,
    audit: { sequence: stored.length + 1, event: built.value },
    matterId,
  };
}

// ---------------------------------------------------------------------------
// listDocketEntries
// ---------------------------------------------------------------------------

export interface ListDocketEntriesQuery {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly confirmation_state?: "proposed" | "confirmed" | "dismissed";
  readonly source_type?: "manual" | "court_order_excerpt" | "llm_extraction" | "imported";
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListDocketEntriesPage {
  readonly rows: ReadonlyArray<CaseBoxDocketEntry>;
  readonly next_cursor: string | null;
}

export function listDocketEntries(
  state: DocketState,
  query: ListDocketEntriesQuery,
): ListDocketEntriesPage {
  const limit = resolveLimit(query.limit);
  const filters = {
    tenant_id: query.tenant_id,
    matter_id: query.matter_id,
    confirmation_state: query.confirmation_state,
    source_type: query.source_type,
  };
  const filters_hash = computeFiltersHash(filters);
  const cursor =
    query.cursor !== undefined
      ? decodeCursor(query.cursor, { kind: "docket_entries_by_matter", filters_hash })
      : null;
  const raw = state.entriesByMatter.get(query.matter_id) ?? [];
  let rows = raw.filter((e) => {
    if (e.tenant_id !== query.tenant_id) return false;
    if (query.confirmation_state !== undefined && e.confirmation_state !== query.confirmation_state) return false;
    if (query.source_type !== undefined && e.source_type !== query.source_type) return false;
    return true;
  });
  rows.sort(compareDocketEntriesChronological);
  if (cursor !== null) {
    const [tProposed, tId] = cursor.last_sort_tuple as [string, string];
    rows = rows.filter((e) => {
      const ep = e.proposed_at ?? "";
      if (ep > tProposed) return true;
      if (ep === tProposed && e.id > tId) return true;
      return false;
    });
  }
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const next_cursor =
    hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          kind: "docket_entries_by_matter",
          filters_hash,
          last_sort_tuple: [last.proposed_at ?? "", last.id],
        })
      : null;
  return {
    rows: slice.map((e) => structuredClone(e) as CaseBoxDocketEntry),
    next_cursor,
  };
}

// ---------------------------------------------------------------------------
// applyAppendDocketEntry — A7 LOC discipline
// ---------------------------------------------------------------------------

import type { CaseBoxMatter as _CBM7Docket } from "case-box-contract";

interface DocketRepoView {
  matters: Map<string, _CBM7Docket>;
  documents: Map<string, { document: import("case-box-contract").CaseBoxDocument; matter_id: string }>;
  auditByMatter: Map<string, StoredAuditEvent[]>;
}
interface DocketCDeps { generateId: () => string; nowIso: () => string; }

export function applyAppendDocketEntry(
  state: DocketState,
  repo: DocketRepoView,
  deps: DocketCDeps,
  input: unknown,
): CaseBoxDocketEntry {
  const matterIdFromInput = input !== null && typeof input === "object"
    ? (input as { matter_id?: unknown }).matter_id
    : undefined;
  if (typeof matterIdFromInput === "string" && !repo.matters.has(matterIdFromInput)) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterIdFromInput}`);
  }
  const prepared = prepareAppendDocketEntry(state, input, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: () => {
      if (typeof matterIdFromInput !== "string") return [];
      return repo.auditByMatter.get(matterIdFromInput) ?? [];
    },
    getDocument: (documentId) => {
      const entry = repo.documents.get(documentId);
      return entry === undefined ? null : { document: entry.document };
    },
  });
  const matter = repo.matters.get(prepared.matterId);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${prepared.matterId}`);
  }
  if (matter.tenant_id !== prepared.row.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `entry.tenant_id (${prepared.row.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const arr = state.entriesByMatter.get(prepared.matterId) ?? [];
  arr.push(prepared.row);
  state.entriesByMatter.set(prepared.matterId, arr);
  state.docketIds.add(prepared.row.id);
  state.docketIndex.set(prepared.row.id, prepared.matterId);
  state.docketById.set(prepared.row.id, prepared.row);
  const stored = repo.auditByMatter.get(prepared.matterId) ?? [];
  stored.push(prepared.audit);
  repo.auditByMatter.set(prepared.matterId, stored);
  return structuredClone(prepared.row) as CaseBoxDocketEntry;
}

// ---------------------------------------------------------------------------
// WI-DPE3 — editDocketEntry (in-place edit of a proposed entry)
// ---------------------------------------------------------------------------

interface PrepareEditResult {
  next: CaseBoxDocketEntry;
  audit: StoredAuditEvent;
  matterId: string;
}

/**
 * Pure prepare for editDocketEntry. Resolves + scope-checks the prior entry,
 * applies ONLY the six editable content fields via a strict allow-list (caller-
 * supplied non-editable fields are never read), derives revised_at from the
 * persistence clock (one sample reused for revised_at + the audit timestamp),
 * enforces the DPE2 contract invariant, validates IANA tz, and builds ONE
 * DOCKET_ENTRY_REVISED event. Matter existence + matter-tenant (unknown_matter)
 * are checked by the caller (applyEditDocketEntry / SQLite requireMatterTenant).
 */
export function prepareEditDocketEntry(
  state: DocketState,
  opts: EditDocketEntryOpts,
  deps: ConfirmDeps,
): PrepareEditResult {
  for (const [k, v] of [
    ["tenant_id", opts?.tenant_id],
    ["matter_id", opts?.matter_id],
    ["entry_id", opts?.entry_id],
    ["editor_actor_user_id", opts?.editor_actor_user_id],
  ] as const) {
    if (typeof v !== "string" || v.length === 0) {
      throw new CaseBoxPersistenceError("invalid_argument", `${k} must be a non-empty string`);
    }
  }
  const prior = state.docketById.get(opts.entry_id);
  // Tenant-scope the entry resolution FIRST: an entry that does not belong to the
  // caller's tenant is reported as simply "unknown" — never matter_id_mismatch with a
  // foreign matter_id (which would disclose a cross-tenant entry's existence + matter).
  // Only after the entry is confirmed to belong to the caller's tenant do we compare the
  // requested matter (now a same-tenant comparison, safe to name).
  if (prior === undefined || prior.tenant_id !== opts.tenant_id) {
    throw new CaseBoxPersistenceError("invalid_argument", `unknown docket entry: ${opts.entry_id}`);
  }
  if (prior.matter_id !== opts.matter_id) {
    throw new CaseBoxPersistenceError(
      "matter_id_mismatch",
      `docket entry ${opts.entry_id} belongs to matter ${prior.matter_id}, not ${opts.matter_id}`,
    );
  }

  const stamp = deps.nowIso();
  // Strict allow-list apply: ONLY the six editable content fields are read from
  // opts. Caller-supplied non-editable/internal fields (revised_at, confirmed_*,
  // id, …) are never read → cannot affect the persisted entry or audit.
  const next = structuredClone(prior) as CaseBoxDocketEntry;
  (next as Record<string, unknown>).proposed_kind = opts.proposed_kind;
  (next as Record<string, unknown>).proposed_due_at = opts.proposed_due_at;
  (next as Record<string, unknown>).proposed_due_at_kind = opts.proposed_due_at_kind;
  (next as Record<string, unknown>).proposed_due_at_timezone = opts.proposed_due_at_timezone;
  (next as Record<string, unknown>).proposed_owner_user_id = opts.proposed_owner_user_id;
  (next as Record<string, unknown>).reminder_offsets =
    opts.reminder_offsets === null ? null : structuredClone(opts.reminder_offsets);
  (next as Record<string, unknown>).revised_at = stamp;

  // Contract invariant (DPE2): proposed-only (→ illegal_transition) +
  // provenance/lifecycle immutable + revised schema-valid (→ invalid_payload).
  try {
    assertValidDocketEntryEdit(prior, next);
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new CaseBoxPersistenceError("illegal_transition", e.message);
    }
    if (e instanceof DocketEntryEditError) {
      throw new CaseBoxPersistenceError("invalid_payload", e.message);
    }
    throw e;
  }

  // Semantic IANA validation when a timezone is present (mirrors append).
  if (next.proposed_due_at_timezone !== null) {
    try {
      assertValidIanaTimezone(next.proposed_due_at_timezone);
    } catch (e) {
      if (e instanceof InvalidIanaTimezoneError) {
        throw new CaseBoxPersistenceError("invalid_payload", e.message);
      }
      throw e;
    }
  }

  const matterId = prior.matter_id;
  const stored = deps.storedAuditEventsForMatter(matterId);
  const prevHash = priorHeadOf(stored);
  const built = buildCaseBoxAuditEvent({
    kind: "DOCKET_ENTRY_REVISED" as CaseBoxAuditEventKind,
    id: deps.generateId(),
    tenant_id: next.tenant_id,
    actor_user_id: opts.editor_actor_user_id,
    matter_id: matterId,
    entity_id: next.id,
    before_state_hash: entityStateHash(prior),
    after_state_hash: entityStateHash(next),
    prev_event_hash: prevHash,
    timestamp: stamp,
  });
  if (!built.ok) {
    throw new CaseBoxPersistenceError("invalid_payload", `audit-event builder rejected (revised): ${built.summary}`);
  }
  return { next, audit: { sequence: stored.length + 1, event: built.value }, matterId };
}

export function applyEditDocketEntry(
  state: DocketState,
  repo: DocketRepoView,
  deps: DocketCDeps,
  opts: EditDocketEntryOpts,
): CaseBoxDocketEntry {
  // Matter existence + matter-tenant isolation FIRST (mirror getDocketEntry/applyAppend).
  const matter = repo.matters.get(opts.matter_id);
  if (matter === undefined) {
    throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${opts.matter_id}`);
  }
  if (matter.tenant_id !== opts.tenant_id) {
    throw new CaseBoxPersistenceError(
      "tenant_mismatch",
      `opts.tenant_id (${opts.tenant_id}) does not match matter.tenant_id (${matter.tenant_id})`,
    );
  }
  const prepared = prepareEditDocketEntry(state, opts, {
    generateId: deps.generateId,
    nowIso: deps.nowIso,
    storedAuditEventsForMatter: (matterId) => repo.auditByMatter.get(matterId) ?? [],
  });
  const arr = state.entriesByMatter.get(prepared.matterId) ?? [];
  const idx = arr.findIndex((e) => e.id === opts.entry_id);
  if (idx >= 0) arr[idx] = prepared.next;
  state.entriesByMatter.set(prepared.matterId, arr);
  state.docketById.set(opts.entry_id, prepared.next);
  const stored = repo.auditByMatter.get(prepared.matterId) ?? [];
  stored.push(prepared.audit);
  repo.auditByMatter.set(prepared.matterId, stored);
  return structuredClone(prepared.next) as CaseBoxDocketEntry;
}
