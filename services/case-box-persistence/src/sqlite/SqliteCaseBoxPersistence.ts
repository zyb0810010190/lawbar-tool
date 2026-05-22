// SQLite-backed CaseBoxPersistence — Phase B1 (matter entity only).
//
// Per dev-memo/plan-case-box-persistence-B1-matter.md §1.2:
//   - Implements the full CaseBoxPersistence interface (42 public methods).
//   - B1-scope methods (createMatter / getMatter / archiveMatter /
//     unarchiveMatter) are implemented end-to-end.
//   - All other methods throw CaseBoxPersistenceError("not_implemented", ...)
//     to satisfy the runtime contract until later B sub-WIs land.
//
// Invariants (per umbrella + B1 plan §4):
//   - Every write runs inside one `db.transaction(...).immediate()`.
//   - Audit event INSERT + chain-head UPDATE happen in the SAME transaction.
//   - event_count == COUNT(case_box_audit_events) == MAX(sequence) for the
//     same matter_id.
//
// payload_json is the canonical source on read; columns lifted only for
// index/filter. On read we parse payload_json and return verbatim.

import type { Database } from "better-sqlite3";

import type {
  CaseBoxAuditEvent,
  CaseBoxMatter,
  CaseBoxConfidentialityClassification,
  CaseBoxDocument,
  CaseBoxDeadline,
  CaseBoxDocketEntry,
  CaseBoxEvidenceItem,
  CaseBoxFact,
  CaseBoxOcrLink,
  CaseBoxPrivilegeMarker,
  PrivilegeResolution,
} from "case-box-contract";

import { eventHashFn, type StoredAuditEvent } from "../auditChain.js";
import { CaseBoxPersistenceError } from "../errors.js";
import { prepareCreateMatter, prepareMatterTransition } from "../inMemoryMatter.js";
import { generateUlid } from "../ulid.js";
import {
  insertAuditEvent,
  insertMatterRow,
  updateMatterRow,
  upsertAuditChainHead,
} from "./matterRepoQueries.js";
import type {
  ArchiveMatterOpts,
  AuditChainHead,
  CaseBoxPersistence,
  ConfirmDocketEntryOpts,
  ConfirmDocketEntryResult,
  DeadlineCalendarQuery,
  DeadlineTransitionOpts,
  DismissDocketEntryOpts,
  DocumentDetail,
  EffectiveClassificationResult,
  EvidenceTransitionOpts,
  FactTransitionOpts,
  GetDeadlineQuery,
  GetDocketEntryQuery,
  GetDocumentDetailQuery,
  GetEffectiveClassificationQuery,
  GetEvidenceItemQuery,
  GetFactQuery,
  GetFactSupersessionChainQuery,
  GetMatterSummaryQuery,
  GetOcrLinkQuery,
  GetPrivilegeStatusQuery,
  ListAuditEventsPage,
  ListAuditEventsQuery,
  ListConfidentialityClassificationsPage,
  ListConfidentialityClassificationsQuery,
  ListDeadlinesPage,
  ListDeadlinesQuery,
  ListDocketEntriesPage,
  ListDocketEntriesQuery,
  ListDocumentsPage,
  ListDocumentsQuery,
  ListEvidenceItemsPage,
  ListEvidenceItemsQuery,
  ListFactsPage,
  ListFactsQuery,
  ListMattersPage,
  ListMattersQuery,
  ListOcrLinksPage,
  ListOcrLinksQuery,
  ListPrivilegeMarkersPage,
  ListPrivilegeMarkersQuery,
  MatterSummary,
  PrivilegeTransitionOpts,
  UpsertOcrLinkResult,
  VerifyAuditChainResult,
} from "../types.js";

export interface SqliteCaseBoxPersistenceOptions {
  readonly db: Database;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

function notImplemented(method: string): never {
  throw new CaseBoxPersistenceError(
    "not_implemented",
    `${method} awaits a future SQLite sub-WI (Phase B${methodSubWiHint(method)})`,
  );
}

function methodSubWiHint(method: string): string {
  // Best-effort mapping per the umbrella plan §2 to give actionable
  // error messages. Not load-bearing.
  if (method === "registerDocument" || method === "getDocument" || method === "listDocuments") return "2";
  if (method === "listAuditEvents" || method === "getAuditChainHead" || method === "verifyAuditChainForMatter") return "3";
  if (method.includes("ConfidentialityClassification") || method === "getEffectiveClassification") return "4";
  if (method.includes("PrivilegeMarker") || method === "getPrivilegeStatus") return "5";
  if (method === "appendFact" || method === "transitionFact" || method === "getFact" || method === "listFacts") return "6";
  if (method.includes("Docket") || method === "transitionDeadline" || method === "getDeadline" || method === "listDeadlines" || method === "getDeadlineCalendar") return "7";
  if (method.includes("EvidenceItem")) return "8";
  if (method.includes("OcrLink")) return "9";
  if (method === "listMatters" || method === "getMatterSummary" || method === "getDocumentDetail" || method === "getFactSupersessionChain") return "10";
  if (method === "appendFactOnce") return "11";
  return "?";
}

export class SqliteCaseBoxPersistence implements CaseBoxPersistence {
  readonly #db: Database;
  readonly #now: () => Date;
  readonly #generateId: () => string;

  constructor(options: SqliteCaseBoxPersistenceOptions) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date());
    this.#generateId = options.generateId ?? generateUlid;
  }

  // -------------------------------------------------------------------------
  // Matter — write paths
  // -------------------------------------------------------------------------

  async createMatter(input: unknown): Promise<CaseBoxMatter> {
    const db = this.#db;
    const now = this.#now;
    const generateId = this.#generateId;
    let resultMatter: CaseBoxMatter | null = null;

    const run = db.transaction(() => {
      const prepared = prepareCreateMatter(
        input,
        (id) => db.prepare("SELECT 1 FROM case_box_matters WHERE id = ?").get(id) !== undefined,
        {
          generateId,
          nowIso: () => now().toISOString(),
          getMatterById: (id) => {
            const r = db
              .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
              .get(id) as { payload_json: string } | undefined;
            return r === undefined ? null : (JSON.parse(r.payload_json) as CaseBoxMatter);
          },
        },
      );
      const eventHash = eventHashFn(prepared.audit.event);
      insertMatterRow(db, prepared.matter);
      insertAuditEvent(db, prepared.audit, eventHash);
      upsertAuditChainHead(
        db,
        prepared.matter.id,
        prepared.audit.event.id,
        prepared.audit.sequence,
        prepared.audit.event.timestamp,
        eventHash,
      );
      resultMatter = prepared.matter;
    });
    run.immediate();

    return structuredClone(resultMatter!) as CaseBoxMatter;
  }

  async archiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter> {
    return this.#applyMatterTransition(matterId, opts, "archived", "MATTER_ARCHIVED");
  }

  async unarchiveMatter(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxMatter> {
    return this.#applyMatterTransition(matterId, opts, "active", "MATTER_UNARCHIVED");
  }

  #applyMatterTransition(
    matterId: string,
    opts: ArchiveMatterOpts,
    to: CaseBoxMatter["status"],
    kind: import("case-box-contract").CaseBoxAuditEventKind,
  ): Promise<CaseBoxMatter> {
    const db = this.#db;
    const now = this.#now;
    const generateId = this.#generateId;
    let resultMatter: CaseBoxMatter | null = null;

    const run = db.transaction(() => {
      const row = db
        .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
        .get(matterId) as { payload_json: string } | undefined;
      if (row === undefined) {
        throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
      }
      const matter = JSON.parse(row.payload_json) as CaseBoxMatter;

      // Load prior stored events for this matter so the shared transition
      // helper can compute priorHeadOf(stored). The helper does not need
      // the full event payload — only the LAST stored event to derive the
      // prev_event_hash. Reading the head row (cheap) is sufficient because
      // priorHeadOf only inspects the last entry; we synthesize a minimal
      // StoredAuditEvent[] from case_box_audit_chain_heads for that purpose.
      const headRow = db
        .prepare("SELECT last_event_id, event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
        .get(matterId) as { last_event_id: string | null; event_count: number } | undefined;
      let storedAuditEvents: StoredAuditEvent[] = [];
      if (headRow !== undefined && headRow.last_event_id !== null) {
        const lastEventRow = db
          .prepare("SELECT event_json, sequence FROM case_box_audit_events WHERE event_id = ?")
          .get(headRow.last_event_id) as { event_json: string; sequence: number } | undefined;
        if (lastEventRow !== undefined) {
          storedAuditEvents = [
            { sequence: lastEventRow.sequence, event: JSON.parse(lastEventRow.event_json) as CaseBoxAuditEvent },
          ];
          // Pad with sequence placeholders so storedAuditEvents.length matches the
          // committed event_count — prepareMatterTransition computes the next
          // sequence as `stored.length + 1`, which must equal headRow.event_count + 1.
          // priorHeadOf only inspects the last element, so the placeholders never
          // get hashed; we just need correct LENGTH.
          if (storedAuditEvents.length < headRow.event_count) {
            const pads = headRow.event_count - storedAuditEvents.length;
            // Move the real last element to the end after padding so priorHeadOf
            // still picks it up. Pads carry a stand-in event with the same
            // canonical-hash bytes is unnecessary because they are not hashed.
            const last = storedAuditEvents[0]!;
            storedAuditEvents = new Array(pads).fill(null).map((_, i) => ({
              sequence: i + 1,
              event: last.event, // placeholder; priorHeadOf only uses last
            }));
            storedAuditEvents.push(last);
          }
        }
      }

      const prepared = prepareMatterTransition(
        matter,
        opts,
        to,
        kind,
        {
          generateId,
          nowIso: () => now().toISOString(),
          storedAuditEventsForMatter: () => storedAuditEvents,
        },
      );

      const eventHash = eventHashFn(prepared.audit.event);
      updateMatterRow(db, prepared.next);
      insertAuditEvent(db, prepared.audit, eventHash);
      upsertAuditChainHead(
        db,
        prepared.next.id,
        prepared.audit.event.id,
        prepared.audit.sequence,
        prepared.audit.event.timestamp,
        eventHash,
      );
      resultMatter = prepared.next;
    });
    run.immediate();

    return Promise.resolve(structuredClone(resultMatter!) as CaseBoxMatter);
  }

  // -------------------------------------------------------------------------
  // Matter — read paths
  // -------------------------------------------------------------------------

  async getMatter(matterId: string): Promise<CaseBoxMatter | null> {
    const row = this.#db
      .prepare("SELECT payload_json FROM case_box_matters WHERE id = ?")
      .get(matterId) as { payload_json: string } | undefined;
    if (row === undefined) return null;
    return JSON.parse(row.payload_json) as CaseBoxMatter;
  }

  // -------------------------------------------------------------------------
  // Non-B1 methods — explicit not_implemented stubs.
  // -------------------------------------------------------------------------

  async registerDocument(_matterId: string, _document: unknown): Promise<CaseBoxDocument> {
    notImplemented("registerDocument");
  }
  async getDocument(_documentId: string): Promise<CaseBoxDocument | null> {
    notImplemented("getDocument");
  }
  async listDocuments(_query: ListDocumentsQuery): Promise<ListDocumentsPage> {
    notImplemented("listDocuments");
  }
  async listAuditEvents(_query: ListAuditEventsQuery): Promise<ListAuditEventsPage> {
    notImplemented("listAuditEvents");
  }
  // Implemented in B1 (not stubbed) because the case_box_audit_chain_heads
  // table is introduced by B1's DDL (matter writes update it from day one);
  // exposing the read is a natural extension. Umbrella plan's claim that
  // this method is "B3" is amended by this divergence — see commit message
  // and B1 plan §"Umbrella-divergence note".
  async getAuditChainHead(matterId: string): Promise<AuditChainHead> {
    // Mirror in-memory behavior: unknown matter throws unknown_matter
    // (per inMemoryAudit + conformance 6.1.31). Check matter existence
    // BEFORE the head read.
    const matterRow = this.#db
      .prepare("SELECT 1 FROM case_box_matters WHERE id = ?")
      .get(matterId);
    if (matterRow === undefined) {
      throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
    }
    const row = this.#db
      .prepare(
        "SELECT head_hash, last_event_id, event_count FROM case_box_audit_chain_heads WHERE matter_id = ?",
      )
      .get(matterId) as
      | { head_hash: string | null; last_event_id: string | null; event_count: number }
      | undefined;
    if (row === undefined) {
      return { headHash: null, lastEventId: null, count: 0 };
    }
    return {
      headHash: row.head_hash as AuditChainHead["headHash"],
      lastEventId: row.last_event_id,
      count: row.event_count,
    };
  }
  async verifyAuditChainForMatter(_matterId: string): Promise<VerifyAuditChainResult> {
    notImplemented("verifyAuditChainForMatter");
  }
  async appendConfidentialityClassification(_input: unknown): Promise<CaseBoxConfidentialityClassification> {
    notImplemented("appendConfidentialityClassification");
  }
  async getEffectiveClassification(_query: GetEffectiveClassificationQuery): Promise<EffectiveClassificationResult> {
    notImplemented("getEffectiveClassification");
  }
  async listConfidentialityClassifications(_query: ListConfidentialityClassificationsQuery): Promise<ListConfidentialityClassificationsPage> {
    notImplemented("listConfidentialityClassifications");
  }
  async appendPrivilegeMarker(_input: unknown): Promise<CaseBoxPrivilegeMarker> {
    notImplemented("appendPrivilegeMarker");
  }
  async transitionPrivilegeMarker(_markerId: string, _opts: PrivilegeTransitionOpts): Promise<CaseBoxPrivilegeMarker> {
    notImplemented("transitionPrivilegeMarker");
  }
  async getPrivilegeStatus(_query: GetPrivilegeStatusQuery): Promise<PrivilegeResolution> {
    notImplemented("getPrivilegeStatus");
  }
  async listPrivilegeMarkers(_query: ListPrivilegeMarkersQuery): Promise<ListPrivilegeMarkersPage> {
    notImplemented("listPrivilegeMarkers");
  }
  async appendFact(_input: unknown): Promise<CaseBoxFact> {
    notImplemented("appendFact");
  }
  async appendFactOnce(_input: unknown): Promise<CaseBoxFact> {
    notImplemented("appendFactOnce");
  }
  async transitionFact(_factId: string, _opts: FactTransitionOpts): Promise<CaseBoxFact> {
    notImplemented("transitionFact");
  }
  async getFact(_query: GetFactQuery): Promise<CaseBoxFact | null> {
    notImplemented("getFact");
  }
  async listFacts(_query: ListFactsQuery): Promise<ListFactsPage> {
    notImplemented("listFacts");
  }
  async appendDocketEntry(_input: unknown): Promise<CaseBoxDocketEntry> {
    notImplemented("appendDocketEntry");
  }
  async confirmDocketEntry(_entryId: string, _opts: ConfirmDocketEntryOpts): Promise<ConfirmDocketEntryResult> {
    notImplemented("confirmDocketEntry");
  }
  async dismissDocketEntry(_entryId: string, _opts: DismissDocketEntryOpts): Promise<CaseBoxDocketEntry> {
    notImplemented("dismissDocketEntry");
  }
  async getDocketEntry(_query: GetDocketEntryQuery): Promise<CaseBoxDocketEntry | null> {
    notImplemented("getDocketEntry");
  }
  async listDocketEntries(_query: ListDocketEntriesQuery): Promise<ListDocketEntriesPage> {
    notImplemented("listDocketEntries");
  }
  async transitionDeadline(_deadlineId: string, _opts: DeadlineTransitionOpts): Promise<CaseBoxDeadline> {
    notImplemented("transitionDeadline");
  }
  async appendEvidenceItem(_input: unknown): Promise<CaseBoxEvidenceItem> {
    notImplemented("appendEvidenceItem");
  }
  async transitionEvidenceItem(_evidenceId: string, _opts: EvidenceTransitionOpts): Promise<CaseBoxEvidenceItem> {
    notImplemented("transitionEvidenceItem");
  }
  async getEvidenceItem(_query: GetEvidenceItemQuery): Promise<CaseBoxEvidenceItem | null> {
    notImplemented("getEvidenceItem");
  }
  async listEvidenceItems(_query: ListEvidenceItemsQuery): Promise<ListEvidenceItemsPage> {
    notImplemented("listEvidenceItems");
  }
  async upsertOcrLink(_input: unknown): Promise<UpsertOcrLinkResult> {
    notImplemented("upsertOcrLink");
  }
  async getOcrLink(_query: GetOcrLinkQuery): Promise<CaseBoxOcrLink | null> {
    notImplemented("getOcrLink");
  }
  async listOcrLinks(_query: ListOcrLinksQuery): Promise<ListOcrLinksPage> {
    notImplemented("listOcrLinks");
  }
  async listMatters(_query: ListMattersQuery): Promise<ListMattersPage> {
    notImplemented("listMatters");
  }
  async getMatterSummary(_query: GetMatterSummaryQuery): Promise<MatterSummary | null> {
    notImplemented("getMatterSummary");
  }
  async getDocumentDetail(_query: GetDocumentDetailQuery): Promise<DocumentDetail | null> {
    notImplemented("getDocumentDetail");
  }
  async getDeadline(_query: GetDeadlineQuery): Promise<CaseBoxDeadline | null> {
    notImplemented("getDeadline");
  }
  async listDeadlines(_query: ListDeadlinesQuery): Promise<ListDeadlinesPage> {
    notImplemented("listDeadlines");
  }
  async getDeadlineCalendar(_query: DeadlineCalendarQuery): Promise<ReadonlyArray<CaseBoxDeadline>> {
    notImplemented("getDeadlineCalendar");
  }
  async getFactSupersessionChain(_query: GetFactSupersessionChainQuery): Promise<ReadonlyArray<CaseBoxFact>> {
    notImplemented("getFactSupersessionChain");
  }
}

// ---------------------------------------------------------------------------
// SQL helpers (kept here for B1 LOC budget; extract when class approaches
// 500 pure LOC per B1 plan §5).
// ---------------------------------------------------------------------------

// SQL helpers live in `./matterRepoQueries.ts` (extracted per B1 plan §5
// LOC trigger / rev-1 audit Dim-4 #1).
