// The DERIVED OCR store (product plan R3, WI-12).
//
// WHY THIS IS A SEPARATE FILE, AND WHY IT LIVES IN ITS OWN DIRECTORY.
// The backup copies exactly one database — `runBackup.ts` hardcodes `case-box.sqlite`, hashes that
// one file, and names it in the manifest; the restore refuses a manifest naming anything else.
// A second database beside it would therefore be silently absent from every backup while the app
// went on reporting the backup verified. That is the worst shape a bug can take in this tool, so
// this store is designed to make the omission CORRECT rather than to be fixed later:
//
//   • It holds ONLY what the app can produce again from the case box and the stored originals:
//     the helper's reading of a page. Nothing here is authored by the owner, and nothing here is
//     the authority for anything. The case box's ocr-link remains the authority, exactly as the
//     plan's cross-database rule requires.
//   • It lives at `<userData>/ocr-derived/ocr.sqlite`. The directory name is the contract: a
//     reader who finds it while debugging a restore learns immediately that losing it costs
//     recomputation and nothing else.
//   • Every row is keyed by the HELPER BUILD DIGEST that produced it. A different helper is a
//     different reading, so an upgrade re-extracts rather than serving text no shipped binary
//     would produce today. This is also the plan's idempotency rule: one row per
//     (document, page, helper digest), re-running is a no-op.
//
// The moment anything the owner writes needs to persist — a correction, an accepted reading — it
// belongs in the case box, not here, and `backupRecord`/`runBackup` must learn about it first.
// The schema below has no column for owner-authored content, and a test pins that column set.

import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Every page gets a row, so every page has a visible outcome — including the ones that failed. */
export type OcrOutcome = "text_layer" | "ocr" | "failed";

/**
 * The different-engine control's verdict. `unchecked` is honest and is what v1 writes: no control
 * ships yet, and measurement showed agreement is the only signal that certifies nothing wrong.
 * The column exists from the first commit so adding the control needs no migration.
 */
export type OcrControl = "unchecked" | "agreed" | "disagreed";

export interface OcrPageRecord {
  /**
   * The matter the document belongs to. A document id alone is a bearer token for any document in
   * the box, so it is never the whole key here either: reads take the matter too, and a leaked
   * document id on its own reaches nothing. The handler still checks tenant and matter against the
   * case box — this is the second lock, not the first.
   */
  readonly matterId: string;
  readonly documentId: string;
  readonly page: number;
  /**
   * How many pages the document has, as the helper reported it. Without this the store cannot tell
   * a three-page document fully read from a hundred-page one that stopped at three: the rows look
   * identical and every count agrees with itself. `completeness()` is what makes truncation
   * visible, which is the product bar — every page's outcome, not every stored page's outcome.
   */
  readonly pageCount: number;
  readonly helperDigest: string;
  readonly outcome: OcrOutcome;
  /** Empty when the outcome is `failed`; never null, so a reader never has to guess. */
  readonly text: string;
  readonly source: "pdf" | "image";
  readonly failureCode: string | null;
  readonly renderDigest: string | null;
  readonly layerMs: number | null;
  readonly visionMs: number | null;
  readonly renderMs: number | null;
  readonly control: OcrControl;
  /**
   * Which DIFFERENT engine produced the agreement. Required for `agreed` and `disagreed`, refused
   * for `unchecked`. Measurement is the reason this is not optional: agreement between two
   * different engines was the only signal that accepted nothing wrong, and the same engine twice
   * was not. A control verdict that cannot name its second engine is not a verdict.
   */
  readonly controlEngine: string | null;
  readonly extractedAt: string;
}

/** The slice of better-sqlite3 this store uses. Structural, so a test can pass its own database. */
export interface OcrDatabase {
  pragma(source: string): unknown;
  exec(source: string): unknown;
  prepare(source: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): unknown;
}

export interface OcrStoreOptions {
  /** The profile directory. The store places itself in `ocr-derived/` beneath it. */
  readonly userDataDir: string;
  /** Injectable for tests; defaults to better-sqlite3. */
  readonly openDatabase?: (file: string) => OcrDatabase;
}

export const OCR_DERIVED_DIRNAME = "ocr-derived";
export const OCR_DB_FILENAME = "ocr.sqlite";
const SCHEMA_VERSION = 1;

/** Where the derived store lives for a given profile. Exported so tests and guards can name it. */
export function ocrDbPath(userDataDir: string): string {
  return path.join(userDataDir, OCR_DERIVED_DIRNAME, OCR_DB_FILENAME);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ocr_page (
  matter_id     TEXT    NOT NULL,
  document_id   TEXT    NOT NULL,
  page          INTEGER NOT NULL,
  page_count    INTEGER NOT NULL CHECK (page_count >= 1 AND page <= page_count),
  helper_digest TEXT    NOT NULL,
  outcome       TEXT    NOT NULL CHECK (outcome IN ('text_layer','ocr','failed')),
  text          TEXT    NOT NULL,
  source        TEXT    NOT NULL CHECK (source IN ('pdf','image')),
  failure_code  TEXT,
  render_digest TEXT,
  layer_ms      INTEGER,
  vision_ms     INTEGER,
  render_ms     INTEGER,
  control       TEXT    NOT NULL CHECK (control IN ('unchecked','agreed','disagreed')),
  control_engine TEXT,
  extracted_at  TEXT    NOT NULL,
  -- A failed page carries its reason and no text; a read page carries neither a reason nor a lie.
  CHECK ((outcome = 'failed' AND failure_code IS NOT NULL AND text = '')
      OR (outcome <> 'failed' AND failure_code IS NULL)),
  -- A control verdict must name the different engine that produced it.
  CHECK ((control = 'unchecked' AND control_engine IS NULL)
      OR (control <> 'unchecked' AND control_engine IS NOT NULL)),
  -- A failed page measured nothing, so it reports nothing: no timing may be invented for it.
  CHECK (outcome <> 'failed'
      OR (layer_ms IS NULL AND vision_ms IS NULL AND render_ms IS NULL AND render_digest IS NULL)),
  PRIMARY KEY (matter_id, document_id, page, helper_digest)
);
CREATE INDEX IF NOT EXISTS ocr_page_by_document ON ocr_page (matter_id, document_id, page);
`;

export interface OcrStore {
  readonly dbPath: string;
  /** Idempotent per (document, page, helper digest): re-running an extraction replaces its own row. */
  putPage(record: OcrPageRecord): void;
  /** The reading THIS helper produced, or null — a different helper means re-extract, never reuse. */
  getPage(matterId: string, documentId: string, page: number, helperDigest: string): OcrPageRecord | null;
  /** Every page this helper has read of the document, in page order. */
  listPages(matterId: string, documentId: string, helperDigest: string): OcrPageRecord[];
  /** How many pages of the document this helper has read, by outcome. */
  countByOutcome(matterId: string, documentId: string, helperDigest: string): Readonly<Record<OcrOutcome, number>>;
  /**
   * What the document should have versus what is stored. `missing > 0` means an extraction stopped
   * early: the pages are not merely unread, they are unaccounted for, and the caller must say so
   * rather than present a partial document as a whole one.
   */
  completeness(matterId: string, documentId: string, helperDigest: string):
    { readonly expected: number; readonly stored: number; readonly missing: number };
  close(): void;
}

interface Row {
  matter_id: string; document_id: string; page: number; page_count: number; helper_digest: string; outcome: string;
  text: string; source: string; failure_code: string | null; render_digest: string | null;
  layer_ms: number | null; vision_ms: number | null; render_ms: number | null;
  control: string; control_engine: string | null; extracted_at: string;
}

const toRecord = (r: Row): OcrPageRecord => ({
  matterId: r.matter_id, documentId: r.document_id, page: r.page, pageCount: r.page_count, helperDigest: r.helper_digest,
  outcome: r.outcome as OcrOutcome, text: r.text, source: r.source as "pdf" | "image",
  failureCode: r.failure_code, renderDigest: r.render_digest,
  layerMs: r.layer_ms, visionMs: r.vision_ms, renderMs: r.render_ms,
  control: r.control as OcrControl, controlEngine: r.control_engine, extractedAt: r.extracted_at,
});

const OUTCOMES: ReadonlySet<string> = new Set(["text_layer", "ocr", "failed"]);
const SOURCES: ReadonlySet<string> = new Set(["pdf", "image"]);
const CONTROLS: ReadonlySet<string> = new Set(["unchecked", "agreed", "disagreed"]);

/**
 * The DIFFERENT engines whose agreement may be recorded as a control verdict. EMPTY in v1, and
 * that emptiness is the enforcement: no control ships yet, so no caller can mark a page agreed,
 * and nothing has to remember a version flag. Shipping the control means adding its name here,
 * which is a deliberate line to write and a deliberate line to review.
 */
const KNOWN_CONTROL_ENGINES: ReadonlySet<string> = new Set<string>([]);

function defaultOpen(file: string): OcrDatabase {
  // Required lazily so this module can be imported (and unit-tested) without a native build that
  // matches the host: the desktop's better-sqlite3 is compiled for Electron's ABI.
  const require_ = createRequire(import.meta.url);
  const Database = require_("better-sqlite3") as new (f: string) => OcrDatabase;
  return new Database(file);
}

/**
 * Open (creating if needed) the derived store for a profile. Cheap and safe to call again: the
 * schema is `IF NOT EXISTS` throughout and the version row is written once.
 */
export function openOcrStore(options: OcrStoreOptions): OcrStore {
  const dbPath = ocrDbPath(options.userDataDir);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = (options.openDatabase ?? defaultOpen)(dbPath);
  // WAL for the same reason the case box uses it, and a busy timeout so a second reader waits
  // rather than throwing. No integrity gate here: a corrupt DERIVED store is thrown away and
  // rebuilt, which is the whole point of it being derived.
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  // A DERIVED store answers a version it does not understand by throwing itself away. Reading rows
  // written under another schema, or writing new rows beside them, is how a cache becomes a
  // corruption; recomputing is what being derived buys.
  const found = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version?: number } | undefined;
  if (found === undefined) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  } else if (found.version !== SCHEMA_VERSION) {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
    return openOcrStore(options);
  }

  const put = db.prepare(`
    INSERT INTO ocr_page (matter_id, document_id, page, page_count, helper_digest, outcome, text,
                          source, failure_code, render_digest, layer_ms, vision_ms, render_ms,
                          control, control_engine, extracted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (matter_id, document_id, page, helper_digest) DO UPDATE SET
      page_count = excluded.page_count, outcome = excluded.outcome, text = excluded.text, source = excluded.source,
      failure_code = excluded.failure_code, render_digest = excluded.render_digest,
      layer_ms = excluded.layer_ms, vision_ms = excluded.vision_ms, render_ms = excluded.render_ms,
      control = excluded.control, control_engine = excluded.control_engine,
      extracted_at = excluded.extracted_at
  `);
  const one = db.prepare("SELECT * FROM ocr_page WHERE matter_id = ? AND document_id = ? AND page = ? AND helper_digest = ?");
  const many = db.prepare("SELECT * FROM ocr_page WHERE matter_id = ? AND document_id = ? AND helper_digest = ? ORDER BY page ASC");

  return {
    dbPath,
    putPage(record) {
      // Closed sets are checked at run time as well as in the schema: a TypeScript type stops a
      // typo, not a value that arrives from a helper or a widened union at run time.
      if (typeof record.matterId !== "string" || record.matterId.length === 0) throw new Error("matterId is required");
      if (typeof record.documentId !== "string" || record.documentId.length === 0) throw new Error("documentId is required");
      if (!Number.isSafeInteger(record.page) || record.page < 1) throw new Error("page must be a positive integer");
      if (!Number.isSafeInteger(record.pageCount) || record.pageCount < 1) throw new Error("pageCount must be a positive integer");
      if (record.page > record.pageCount) throw new Error("page must not exceed pageCount");
      if (!OUTCOMES.has(record.outcome)) throw new Error(`unknown outcome ${JSON.stringify(record.outcome)}`);
      if (!SOURCES.has(record.source)) throw new Error(`unknown source ${JSON.stringify(record.source)}`);
      if (!CONTROLS.has(record.control)) throw new Error(`unknown control ${JSON.stringify(record.control)}`);
      if (record.outcome === "failed") {
        if (record.failureCode === null) throw new Error("a failed page must carry its failure code");
        // A failed page with text would be text nobody can account for.
        if (record.text !== "") throw new Error("a failed page must carry no text");
        // It measured nothing either, so a timing on it would be a number with no measurement behind it.
        if (record.layerMs !== null || record.visionMs !== null || record.renderMs !== null || record.renderDigest !== null) {
          throw new Error("a failed page must carry no timings and no render digest");
        }
      } else if (record.failureCode !== null) {
        throw new Error("only a failed page may carry a failure code");
      }
      if (record.control === "unchecked") {
        if (record.controlEngine !== null) throw new Error("an unchecked page may not name a control engine");
      } else if (record.controlEngine === null || record.controlEngine.length === 0) {
        throw new Error("a control verdict must name the different engine that produced it");
      } else if (!KNOWN_CONTROL_ENGINES.has(record.controlEngine)) {
        throw new Error(`no control engine ships in this build, so nothing may be marked ${record.control}`);
      }
      put.run(record.matterId, record.documentId, record.page, record.pageCount, record.helperDigest, record.outcome,
        record.text, record.source, record.failureCode, record.renderDigest, record.layerMs,
        record.visionMs, record.renderMs, record.control, record.controlEngine, record.extractedAt);
    },
    getPage(matterId, documentId, page, helperDigest) {
      const row = one.get(matterId, documentId, page, helperDigest) as Row | undefined;
      return row === undefined ? null : toRecord(row);
    },
    listPages(matterId, documentId, helperDigest) {
      return (many.all(matterId, documentId, helperDigest) as Row[]).map(toRecord);
    },
    countByOutcome(matterId, documentId, helperDigest) {
      const counts: Record<OcrOutcome, number> = { text_layer: 0, ocr: 0, failed: 0 };
      for (const r of many.all(matterId, documentId, helperDigest) as Row[]) {
        const o = r.outcome as OcrOutcome;
        // Every stored row is a known outcome (schema CHECK plus the guard above), so nothing can
        // fall out of the counts and make a page invisible.
        counts[o] += 1;
      }
      return counts;
    },
    completeness(matterId, documentId, helperDigest) {
      const rows = many.all(matterId, documentId, helperDigest) as Row[];
      const expected = rows.reduce((m, r) => Math.max(m, r.page_count), 0);
      return { expected, stored: rows.length, missing: Math.max(0, expected - rows.length) };
    },
    close() { db.close(); },
  };
}
