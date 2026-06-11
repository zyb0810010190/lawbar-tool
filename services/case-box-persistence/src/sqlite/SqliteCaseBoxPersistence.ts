// SQLite-backed CaseBoxPersistence — Phase B SQLite implementation
// complete (B1-B11; per dev-memo/plan-case-box-persistence-B11-once-variants.md).
//
// Every method on the CaseBoxPersistence interface is implemented
// end-to-end against better-sqlite3. No `not_implemented` stubs remain.
// Phase B SQLite implementation completion was verified by the full
// no-filter conformance sweep at tests/sqlite-final.conformance.test.mjs.
// (Go-live readiness is a separately gated decision per
// .claude/rules/autonomy.md §"Hard-stop list".)
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
import { prepareRegisterDocument } from "../inMemoryDocument.js";
import {
  listAuditEventsSqlite,
  verifyAuditChainForMatterSqlite,
} from "./auditRepoQueries.js";
import {
  applyAppendClassificationSqlite,
  getEffectiveClassificationSqlite,
  listConfidentialityClassificationsSqlite,
} from "./classificationRepoQueries.js";
import {
  applyAppendPrivilegeMarkerSqlite,
  applyTransitionPrivilegeMarkerSqlite,
  getPrivilegeStatusSqlite,
  listPrivilegeMarkersSqlite,
} from "./privilegeRepoQueries.js";
import {
  applyAppendFactOnceSqlite,
  applyAppendFactSqlite,
  applyTransitionFactSqlite,
  getFactSqlite,
  listFactsSqlite,
} from "./factsRepoQueries.js";
import {
  applyAppendDocketEntrySqlite,
  applyConfirmDocketEntrySqlite,
  applyDismissDocketEntrySqlite,
  applyEditDocketEntrySqlite,
  getDocketEntrySqlite,
  listDocketEntriesSqlite,
} from "./docketRepoQueries.js";
import {
  applyTransitionDeadlineSqlite,
  getDeadlineSqlite,
  listDeadlinesSqlite,
} from "./deadlineRepoQueries.js";
import {
  applyAppendEvidenceItemSqlite,
  applyTransitionEvidenceItemSqlite,
  getEvidenceItemSqlite,
  listEvidenceItemsSqlite,
} from "./evidenceRepoQueries.js";
import {
  applyUpsertOcrLinkSqlite,
  getOcrLinkSqlite,
  listOcrLinksSqlite,
} from "./ocrLinkRepoQueries.js";
import {
  getDeadlineCalendarSqlite,
  getDocumentDetailSqlite,
  getFactSupersessionChainSqlite,
  getMatterSummarySqlite,
  listMattersSqlite,
} from "./aggregationsRepoQueries.js";
import { prepareCreateMatter, prepareMatterTransition } from "../inMemoryMatter.js";
import { generateUlid } from "../ulid.js";
import {
  hasDocumentId,
  insertDocumentRow,
  listDocumentsSqlite,
  selectDocumentById,
  selectDocumentRefById,
  selectMatterForDocument,
} from "./documentRepoQueries.js";
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
  EditDocketEntryOpts,
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

interface SqliteWriteDeps {
  readonly generateId: () => string;
  readonly nowIso: () => string;
  readonly storedAuditEventsForMatter: (matterId: string) => StoredAuditEvent[];
  readonly writeAuditEventAndUpdateHead: (audit: StoredAuditEvent, eventHash: string) => void;
}

// `notImplemented` + `methodSubWiHint` were retired at B11 — every
// Phase B SQLite sub-WI (B1-B11) is shipped; no stubs remain.
// Re-introduce only if a future phase adds new not-yet-implemented
// methods to the persistence interface.

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
  // Private shared helpers (extraction per B4 deferred Low D4#1 + B5
  // natural-touch under NIGHT-RUN-SQLITE-B5-IMPL lane instruction).
  // -------------------------------------------------------------------------

  /** Write a prepared audit event + update its chain head. Atomic per
   *  enclosing transaction. Shared by B4 classification append and B5
   *  privilege append+transition write paths.
   */
  #writeAudit(audit: StoredAuditEvent, eventHash: string): void {
    insertAuditEvent(this.#db, audit, eventHash);
    upsertAuditChainHead(
      this.#db,
      audit.event.matter_id,
      audit.event.id,
      audit.sequence,
      audit.event.timestamp,
      eventHash,
    );
  }

  /** Standard write-transaction deps passed to repo-queries helpers. */
  #writeDeps(): SqliteWriteDeps {
    const db = this.#db;
    const now = this.#now;
    return {
      generateId: this.#generateId,
      nowIso: () => now().toISOString(),
      storedAuditEventsForMatter: (matterId: string) => loadSyntheticStoredEvents(db, matterId),
      writeAuditEventAndUpdateHead: (audit, eventHash) => this.#writeAudit(audit, eventHash),
    };
  }

  /** Wrap a synchronous SQLite write in `BEGIN IMMEDIATE`, returning the
   *  helper's row result. The write function receives the DB + the
   *  standard write-transaction deps so the body stays small.
   */
  #runImmediateWrite<T>(work: (db: Database, deps: SqliteWriteDeps) => T): T {
    const db = this.#db;
    const deps = this.#writeDeps();
    let result: T | null = null;
    const run = db.transaction(() => {
      result = work(db, deps);
    });
    run.immediate();
    return result as T;
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

      const prepared = prepareMatterTransition(
        matter,
        opts,
        to,
        kind,
        {
          generateId,
          nowIso: () => now().toISOString(),
          storedAuditEventsForMatter: () => loadSyntheticStoredEvents(db, matterId),
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

  async registerDocument(matterId: string, input: unknown): Promise<CaseBoxDocument> {
    const db = this.#db;
    const now = this.#now;
    const generateId = this.#generateId;
    let resultDocument: CaseBoxDocument | null = null;

    const run = db.transaction(() => {
      // Matter-existence + full payload in ONE SELECT (per B2 audit
      // Low D5#1; previously two round trips).
      const matterRow = selectMatterForDocument(db, matterId);
      if (matterRow === null) {
        throw new CaseBoxPersistenceError("unknown_matter", `unknown matter: ${matterId}`);
      }
      const matter = JSON.parse(matterRow.payload_json) as CaseBoxMatter;

      const prepared = prepareRegisterDocument(
        matterId,
        matter,
        input,
        (id) => hasDocumentId(db, id),
        {
          generateId,
          nowIso: () => now().toISOString(),
          storedAuditEventsForMatter: () => loadSyntheticStoredEvents(db, matterId),
          getDocumentById: (id) => selectDocumentRefById(db, id),
        },
      );

      const eventHash = eventHashFn(prepared.audit.event);
      insertDocumentRow(db, prepared.document);
      insertAuditEvent(db, prepared.audit, eventHash);
      upsertAuditChainHead(
        db,
        matterId,
        prepared.audit.event.id,
        prepared.audit.sequence,
        prepared.audit.event.timestamp,
        eventHash,
      );
      resultDocument = prepared.document;
    });
    run.immediate();

    return structuredClone(resultDocument!) as CaseBoxDocument;
  }

  async getDocument(documentId: string): Promise<CaseBoxDocument | null> {
    return selectDocumentById(this.#db, documentId);
  }

  async listDocuments(query: ListDocumentsQuery): Promise<ListDocumentsPage> {
    return listDocumentsSqlite(this.#db, query);
  }
  async listAuditEvents(query: ListAuditEventsQuery): Promise<ListAuditEventsPage> {
    return listAuditEventsSqlite(this.#db, query);
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
  async verifyAuditChainForMatter(matterId: string): Promise<VerifyAuditChainResult> {
    return verifyAuditChainForMatterSqlite(this.#db, matterId);
  }
  async appendConfidentialityClassification(input: unknown): Promise<CaseBoxConfidentialityClassification> {
    const row = this.#runImmediateWrite((db, deps) => applyAppendClassificationSqlite(db, input, deps));
    return structuredClone(row) as CaseBoxConfidentialityClassification;
  }
  async getEffectiveClassification(query: GetEffectiveClassificationQuery): Promise<EffectiveClassificationResult> {
    return getEffectiveClassificationSqlite(this.#db, query);
  }
  async listConfidentialityClassifications(query: ListConfidentialityClassificationsQuery): Promise<ListConfidentialityClassificationsPage> {
    return listConfidentialityClassificationsSqlite(this.#db, query);
  }
  async appendPrivilegeMarker(input: unknown): Promise<CaseBoxPrivilegeMarker> {
    const row = this.#runImmediateWrite((db, deps) => applyAppendPrivilegeMarkerSqlite(db, input, deps));
    return structuredClone(row) as CaseBoxPrivilegeMarker;
  }
  async transitionPrivilegeMarker(markerId: string, opts: PrivilegeTransitionOpts): Promise<CaseBoxPrivilegeMarker> {
    const row = this.#runImmediateWrite((db, deps) => applyTransitionPrivilegeMarkerSqlite(db, markerId, opts, deps));
    return structuredClone(row) as CaseBoxPrivilegeMarker;
  }
  async getPrivilegeStatus(query: GetPrivilegeStatusQuery): Promise<PrivilegeResolution> {
    return getPrivilegeStatusSqlite(this.#db, query);
  }
  async listPrivilegeMarkers(query: ListPrivilegeMarkersQuery): Promise<ListPrivilegeMarkersPage> {
    return listPrivilegeMarkersSqlite(this.#db, query);
  }
  async appendFact(input: unknown): Promise<CaseBoxFact> {
    const row = this.#runImmediateWrite((db, deps) => applyAppendFactSqlite(db, input, deps));
    return structuredClone(row) as CaseBoxFact;
  }
  async appendFactOnce(input: unknown): Promise<CaseBoxFact> {
    const row = this.#runImmediateWrite((db, deps) => applyAppendFactOnceSqlite(db, input, deps));
    return structuredClone(row) as CaseBoxFact;
  }
  async transitionFact(factId: string, opts: FactTransitionOpts): Promise<CaseBoxFact> {
    const row = this.#runImmediateWrite((db, deps) => applyTransitionFactSqlite(db, factId, opts, deps));
    return structuredClone(row) as CaseBoxFact;
  }
  async getFact(query: GetFactQuery): Promise<CaseBoxFact | null> {
    return getFactSqlite(this.#db, query);
  }
  async listFacts(query: ListFactsQuery): Promise<ListFactsPage> {
    return listFactsSqlite(this.#db, query);
  }
  async appendDocketEntry(input: unknown): Promise<CaseBoxDocketEntry> {
    const row = this.#runImmediateWrite((db, deps) => applyAppendDocketEntrySqlite(db, input, deps));
    return structuredClone(row) as CaseBoxDocketEntry;
  }
  async confirmDocketEntry(entryId: string, opts: ConfirmDocketEntryOpts): Promise<ConfirmDocketEntryResult> {
    const result = this.#runImmediateWrite((db, deps) => applyConfirmDocketEntrySqlite(db, entryId, opts, deps));
    return structuredClone(result) as ConfirmDocketEntryResult;
  }
  async dismissDocketEntry(entryId: string, opts: DismissDocketEntryOpts): Promise<CaseBoxDocketEntry> {
    const row = this.#runImmediateWrite((db, deps) => applyDismissDocketEntrySqlite(db, entryId, opts, deps));
    return structuredClone(row) as CaseBoxDocketEntry;
  }
  async editDocketEntry(opts: EditDocketEntryOpts): Promise<CaseBoxDocketEntry> {
    const row = this.#runImmediateWrite((db, deps) => applyEditDocketEntrySqlite(db, opts, deps));
    return structuredClone(row) as CaseBoxDocketEntry;
  }
  async getDocketEntry(query: GetDocketEntryQuery): Promise<CaseBoxDocketEntry | null> {
    return getDocketEntrySqlite(this.#db, query);
  }
  async listDocketEntries(query: ListDocketEntriesQuery): Promise<ListDocketEntriesPage> {
    return listDocketEntriesSqlite(this.#db, query);
  }
  async transitionDeadline(deadlineId: string, opts: DeadlineTransitionOpts): Promise<CaseBoxDeadline> {
    const row = this.#runImmediateWrite((db, deps) => applyTransitionDeadlineSqlite(db, deadlineId, opts, deps));
    return structuredClone(row) as CaseBoxDeadline;
  }
  async appendEvidenceItem(input: unknown): Promise<CaseBoxEvidenceItem> {
    const row = this.#runImmediateWrite((db, deps) => applyAppendEvidenceItemSqlite(db, input, deps));
    return structuredClone(row) as CaseBoxEvidenceItem;
  }
  async transitionEvidenceItem(evidenceId: string, opts: EvidenceTransitionOpts): Promise<CaseBoxEvidenceItem> {
    const row = this.#runImmediateWrite((db, deps) => applyTransitionEvidenceItemSqlite(db, evidenceId, opts, deps));
    return structuredClone(row) as CaseBoxEvidenceItem;
  }
  async getEvidenceItem(query: GetEvidenceItemQuery): Promise<CaseBoxEvidenceItem | null> {
    return getEvidenceItemSqlite(this.#db, query);
  }
  async listEvidenceItems(query: ListEvidenceItemsQuery): Promise<ListEvidenceItemsPage> {
    return listEvidenceItemsSqlite(this.#db, query);
  }
  async upsertOcrLink(input: unknown): Promise<UpsertOcrLinkResult> {
    const result = this.#runImmediateWrite((db, deps) => applyUpsertOcrLinkSqlite(db, input, deps));
    return structuredClone(result) as UpsertOcrLinkResult;
  }
  async getOcrLink(query: GetOcrLinkQuery): Promise<CaseBoxOcrLink | null> {
    return getOcrLinkSqlite(this.#db, query);
  }
  async listOcrLinks(query: ListOcrLinksQuery): Promise<ListOcrLinksPage> {
    return listOcrLinksSqlite(this.#db, query);
  }
  async listMatters(query: ListMattersQuery): Promise<ListMattersPage> {
    return listMattersSqlite(this.#db, query);
  }
  async getMatterSummary(query: GetMatterSummaryQuery): Promise<MatterSummary | null> {
    return getMatterSummarySqlite(this.#db, query);
  }
  async getDocumentDetail(query: GetDocumentDetailQuery): Promise<DocumentDetail | null> {
    return getDocumentDetailSqlite(this.#db, query);
  }
  async getDeadline(query: GetDeadlineQuery): Promise<CaseBoxDeadline | null> {
    return getDeadlineSqlite(this.#db, query);
  }
  async listDeadlines(query: ListDeadlinesQuery): Promise<ListDeadlinesPage> {
    return listDeadlinesSqlite(this.#db, query);
  }
  async getDeadlineCalendar(query: DeadlineCalendarQuery): Promise<ReadonlyArray<CaseBoxDeadline>> {
    return getDeadlineCalendarSqlite(this.#db, query);
  }
  async getFactSupersessionChain(query: GetFactSupersessionChainQuery): Promise<ReadonlyArray<CaseBoxFact>> {
    return getFactSupersessionChainSqlite(this.#db, query);
  }
}

// ---------------------------------------------------------------------------
// SQL helpers (kept here for B1 LOC budget; extract when class approaches
// 500 pure LOC per B1 plan §5).
// ---------------------------------------------------------------------------

// SQL helpers live in `./matterRepoQueries.ts` + `./documentRepoQueries.ts`
// (extracted per B1 plan §5 / B2 plan §6 LOC trigger).

// ---------------------------------------------------------------------------
// loadSyntheticStoredEvents — shared between prepareMatterTransition
// (B1) and prepareRegisterDocument (B2). Both helpers consume a
// StoredAuditEvent[] from which they read ONLY (a) the LAST element's
// event (for priorHeadOf → prev_event_hash) and (b) the array LENGTH
// (for `stored.length + 1` → next sequence). We synthesize that array
// from `case_box_audit_chain_heads` + the latest event row, padding
// the array with placeholders so its LENGTH matches event_count.
// Placeholders are never hashed.
// ---------------------------------------------------------------------------

function loadSyntheticStoredEvents(db: Database, matterId: string): StoredAuditEvent[] {
  const headRow = db
    .prepare("SELECT last_event_id, event_count FROM case_box_audit_chain_heads WHERE matter_id = ?")
    .get(matterId) as { last_event_id: string | null; event_count: number } | undefined;
  if (headRow === undefined || headRow.last_event_id === null) return [];
  const lastEventRow = db
    .prepare("SELECT event_json, sequence FROM case_box_audit_events WHERE event_id = ?")
    .get(headRow.last_event_id) as { event_json: string; sequence: number } | undefined;
  if (lastEventRow === undefined) return [];
  const last: StoredAuditEvent = {
    sequence: lastEventRow.sequence,
    event: JSON.parse(lastEventRow.event_json) as CaseBoxAuditEvent,
  };
  if (headRow.event_count <= 1) return [last];
  // Pad with placeholders (event repeated; priorHeadOf only inspects
  // the last element so placeholder contents never matter).
  const pads = headRow.event_count - 1;
  const result: StoredAuditEvent[] = new Array(pads).fill(null).map((_, i) => ({
    sequence: i + 1,
    event: last.event,
  }));
  result.push(last);
  return result;
}
