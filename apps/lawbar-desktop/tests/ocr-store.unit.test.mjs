// The derived OCR store (product plan R3, WI-12).
//
// What these tests pin, and why each one exists:
//
//  1. WHERE IT LIVES. `<userData>/ocr-derived/ocr.sqlite`, in its own directory, never beside
//     case-box.sqlite. The backup copies exactly one database by hardcoded name; a store that sat
//     next to it would be silently missing from every backup while the app reported the backup
//     verified. The directory name is the contract, so the path is asserted, not assumed.
//  2. WHAT IT MAY HOLD. The column set is pinned exactly. Nothing the owner authors may live in a
//     store that is excluded from backup by design, and a future column would have to fail this
//     test before it could quietly become unbackupable data.
//  3. SCOPE. A document id alone is a bearer token, so it is never the whole key: reads take the
//     matter too, and the same document id under another matter reaches nothing.
//  4. IDEMPOTENCE, KEYED BY HELPER DIGEST. Re-extracting replaces its own row; a DIFFERENT helper
//     writes its own row and is never served in place of another's.
//  5. EVERY PAGE HAS AN OUTCOME, AND TRUNCATION IS VISIBLE. A failed page is a row with a code.
//     A run that stopped early is not merely fewer rows — `completeness()` reports the gap,
//     because "every page's outcome" is the product bar, not "every stored page's outcome".
//  6. NO NUMBER WITHOUT A MEASUREMENT. A failed page carries no text, no timing, no render digest.
//  7. NOTHING IS CERTIFIED IN THIS BUILD. Marking a page agreed requires naming the different
//     engine that agreed, and no control engine ships, so it cannot be done at all.
//
// Uses the plain-node better-sqlite3 from case-box-persistence, injected: the desktop's own copy
// is built for Electron's ABI and cannot load here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OCR_DB_FILENAME, OCR_DERIVED_DIRNAME, ocrDbPath, openOcrStore } from "../dist/src/ocr/ocrStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);
const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const openDatabase = (file) => new Database(file);

function store(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-store-"));
  const s = openOcrStore({ userDataDir: dir, openDatabase });
  t.after(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });
  return { s, dir };
}

const DIGEST = "a".repeat(64);
const RECORD = {
  matterId: "m-1", documentId: "doc-1", page: 1, pageCount: 1, helperDigest: DIGEST,
  outcome: "text_layer", text: "本院经审理查明", source: "pdf", failureCode: null,
  renderDigest: null, layerMs: 3, visionMs: null, renderMs: null,
  lines: [{ lineNo: 1, text: "本院经审理查明", confidence: 1, x: null, y: null, w: null, h: null, control: "unchecked", controlEngine: null }],
  extractedAt: "2026-09-12T00:00:00Z",
};
/**
 * A line, so a test can vary one field without restating the shape. NO BOX by default, because the
 * default RECORD is a TEXT-LAYER page and such a page was never rendered — its lines cannot have a
 * position. A test about a recognised page passes one.
 */
const line = (o = {}) => ({ lineNo: 1, text: RECORD.text, confidence: 1, x: null, y: null, w: null, h: null, control: "unchecked", controlEngine: null, ...o });
/** A recognised line: rendered, so it has the box its recognition reported. */
const ocrLine = (o = {}) => line({ x: 0.1, y: 0.1, w: 0.5, h: 0.05, ...o });
/** A recognised page, with the timings and the render digest a recognised page must carry. */
const recognisedPage = (text, over = {}) => ({
  ...RECORD, outcome: "ocr", text, layerMs: null, visionMs: 220, renderMs: 30,
  renderDigest: "0".repeat(64), lines: [ocrLine({ text })], ...over,
});
const FAILED = { ...RECORD, outcome: "failed", text: "", failureCode: "helper_timeout", layerMs: null, lines: [] };

test("the derived store lives in its OWN directory, never beside the case box", (t) => {
  const { s, dir } = store(t);
  assert.equal(ocrDbPath(dir), path.join(dir, OCR_DERIVED_DIRNAME, OCR_DB_FILENAME));
  assert.equal(OCR_DERIVED_DIRNAME, "ocr-derived", "the directory name is the contract a reader sees during a restore");
  assert.ok(existsSync(s.dbPath));
  assert.notEqual(path.dirname(s.dbPath), dir, "the derived store must not sit in the profile root beside case-box.sqlite");
  assert.equal(existsSync(path.join(dir, "case-box.sqlite")), false, "opening the derived store must not create a case box");
});

test("the column set is pinned: nothing the owner authors can live in a store excluded from backup", (t) => {
  const { s } = store(t);
  const db = new Database(s.dbPath, { readonly: true });
  t.after(() => db.close());
  const cols = db.prepare("PRAGMA table_info(ocr_page)").all().map((c) => c.name).sort();
  assert.deepEqual(cols, [
    "document_id", "extracted_at", "failure_code", "helper_digest",
    "layer_ms", "matter_id", "outcome", "page", "page_count", "render_digest", "render_ms",
    "source", "text", "vision_ms",
  ], "a new column here would become data that no backup carries — change this test deliberately or not at all");
  // `control` is NOT among them, deliberately. The verdict is line-level, because that is what the
  // measurement validated; a page-level copy would be a second place for it to disagree.
  const lineCols = db.prepare("PRAGMA table_info(ocr_line)").all().map((c) => c.name).sort();
  assert.deepEqual(lineCols, [
    "confidence", "control", "control_engine", "document_id", "h", "helper_digest",
    "line_no", "matter_id", "page", "text", "w", "x", "y",
  ]);
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name),
    ["ocr_line", "ocr_page", "schema_version"],
  );
  // 3, not 2: `uncompared` joined the control's values, and a CHECK constraint is baked into the
  // table at CREATE time, so a v2 file on disk keeps the old three-value rule and rejects the new
  // verdict at INSERT. The number is written out rather than read from the module on purpose — a
  // test that imports the constant agrees with any bump, including an accidental one.
  assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 3);
});

test("a document id alone reaches nothing: reads are scoped to the matter", (t) => {
  const { s } = store(t);
  s.putPage(RECORD);
  assert.equal(s.getPage("m-1", "doc-1", 1, DIGEST).text, RECORD.text);
  assert.equal(s.getPage("m-2", "doc-1", 1, DIGEST), null, "the same document id under another matter must reach nothing");
  assert.deepEqual(s.listPages("m-2", "doc-1", DIGEST), []);
  // The same document id in two matters is two rows, not one overwriting the other.
  s.putPage({ ...RECORD, matterId: "m-2", text: "another matter's reading", lines: [line({ text: "another matter's reading" })] });
  assert.equal(s.getPage("m-1", "doc-1", 1, DIGEST).text, RECORD.text);
  assert.equal(s.getPage("m-2", "doc-1", 1, DIGEST).text, "another matter's reading");
});

test("re-extracting with the same helper replaces its row; a different helper writes its own", (t) => {
  const { s } = store(t);
  s.putPage(RECORD);
  s.putPage({ ...RECORD, text: "本院经审理查明：", layerMs: 4, lines: [line({ text: "本院经审理查明：" })] });
  const rows = s.listPages("m-1", "doc-1", DIGEST);
  assert.equal(rows.length, 1, "same helper, same page: one row, not two");
  assert.equal(rows[0].text, "本院经审理查明：");
  const other = "b".repeat(64);
  s.putPage({ ...RECORD, helperDigest: other, text: "a different binary read this", lines: [line({ text: "a different binary read this" })] });
  assert.equal(s.listPages("m-1", "doc-1", DIGEST).length, 1, "the old helper's reading is untouched");
  assert.equal(s.getPage("m-1", "doc-1", 1, "c".repeat(64)), null, "an unknown helper must not be served another helper's text");
});

test("every page has an outcome, and a run that stopped early is VISIBLE rather than merely shorter", (t) => {
  const { s } = store(t);
  const three = { ...RECORD, pageCount: 3 };
  s.putPage({ ...three, page: 1, outcome: "text_layer" });
  s.putPage({ ...recognisedPage("读出来的字"), pageCount: 3, page: 2 });
  s.putPage({ ...three, page: 3, outcome: "failed", text: "", failureCode: "helper_timeout", layerMs: null, lines: [] });
  const pages = s.listPages("m-1", "doc-1", DIGEST);
  assert.deepEqual(pages.map((p) => p.page), [1, 2, 3], "pages come back in page order");
  assert.deepEqual(pages.map((p) => p.outcome), ["text_layer", "ocr", "failed"]);
  assert.equal(pages[2].text, "", "a failed page has empty text, never null");
  assert.deepEqual(s.countByOutcome("m-1", "doc-1", DIGEST), { text_layer: 1, ocr: 1, failed: 1 });
  assert.deepEqual(s.completeness("m-1", "doc-1", DIGEST), { expected: 3, stored: 3, missing: 0 });

  // The case the counts alone cannot show: a hundred-page document that stopped after two.
  const long = { ...RECORD, documentId: "doc-2", pageCount: 100 };
  s.putPage({ ...long, page: 1 });
  s.putPage({ ...long, page: 2 });
  assert.deepEqual(s.countByOutcome("m-1", "doc-2", DIGEST), { text_layer: 2, ocr: 0, failed: 0 },
    "the outcome counts look perfectly healthy");
  assert.deepEqual(s.completeness("m-1", "doc-2", DIGEST), { expected: 100, stored: 2, missing: 98 },
    "and completeness is what says 98 pages are unaccounted for");
});

test("no number without a measurement behind it: a failed page carries no text, no timing, no digest", (t) => {
  const { s } = store(t);
  s.putPage(FAILED);
  const row = s.getPage("m-1", "doc-1", 1, DIGEST);
  assert.equal(row.outcome, "failed");
  assert.equal(row.failureCode, "helper_timeout");
  assert.deepEqual([row.text, row.layerMs, row.visionMs, row.renderMs, row.renderDigest], ["", null, null, null, null]);
  assert.throws(() => s.putPage({ ...FAILED, text: "invented" }), /must carry no text/);
  assert.throws(() => s.putPage({ ...FAILED, layerMs: 3 }), /no timings/);
  assert.throws(() => s.putPage({ ...FAILED, renderDigest: "0".repeat(64) }), /no timings/);
});

test("the store refuses records that would make an outcome unreadable or a page misfiled", (t) => {
  const { s } = store(t);
  assert.throws(() => s.putPage({ ...RECORD, outcome: "failed", failureCode: null }), /must carry its failure code/);
  assert.throws(() => s.putPage({ ...RECORD, failureCode: "helper_timeout" }), /only a failed page/);
  assert.throws(() => s.putPage({ ...RECORD, page: 0 }), /positive integer/);
  assert.throws(() => s.putPage({ ...RECORD, page: 1.6 }), /positive integer/);
  assert.throws(() => s.putPage({ ...RECORD, page: 4, pageCount: 3 }), /must not exceed pageCount/);
  assert.throws(() => s.putPage({ ...RECORD, pageCount: 0 }), /pageCount must be a positive integer/);
  assert.throws(() => s.putPage({ ...RECORD, matterId: "" }), /matterId is required/);
  // Closed sets are checked at run time, not only by the type: an unknown outcome would vanish
  // from the counts and take a page's visibility with it.
  assert.throws(() => s.putPage({ ...RECORD, outcome: "unknown" }), /unknown outcome/);
  assert.throws(() => s.putPage({ ...RECORD, source: "tiff" }), /unknown source/);
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ control: "verified" })] }), /unknown control/);
});

test("nothing can be marked agreed in this build, because no control engine ships", (t) => {
  const { s } = store(t);
  s.putPage(RECORD);
  assert.deepEqual(s.getPage("m-1", "doc-1", 1, DIGEST).lines.map((l) => l.control), ["unchecked"],
    "the verdict lives on the LINE, because line-level agreement is what was measured");
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ control: "agreed", controlEngine: null })] }),
    /must name the different engine/, "a bare agreement names nothing and is refused");
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ control: "agreed", controlEngine: "paddleocr-onnx" })] }),
    /no control engine ships/, "and naming an engine this build does not carry is refused too");
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ control: "unchecked", controlEngine: "paddleocr-onnx" })] }),
    /may not name a control engine/);
  // `uncompared` is a verdict like any other: a second engine ran to produce it, so it must name
  // that engine, and no engine ships. It is NOT a back door to writing control state today.
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ control: "uncompared", controlEngine: null })] }),
    /must name the different engine/);
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ control: "uncompared", controlEngine: "paddleocr-onnx" })] }),
    /no control engine ships/);
});

test("a store written under another schema version is discarded and rebuilt, not read", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = openOcrStore({ userDataDir: dir, openDatabase });
  first.putPage(RECORD);
  const dbPath = first.dbPath;
  first.close();
  // Pretend a future build wrote this file.
  const raw = new Database(dbPath);
  raw.prepare("UPDATE schema_version SET version = 99").run();
  raw.close();
  const second = openOcrStore({ userDataDir: dir, openDatabase });
  t.after(() => second.close());
  assert.equal(second.getPage("m-1", "doc-1", 1, DIGEST), null, "rows from a schema we do not understand must not be served");
  const db = new Database(second.dbPath, { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 3, "and the store is rebuilt at the version we do understand");
});

test("opening an existing store again is a no-op, and the data survives", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = openOcrStore({ userDataDir: dir, openDatabase });
  first.putPage(RECORD);
  first.close();
  const second = openOcrStore({ userDataDir: dir, openDatabase });
  t.after(() => second.close());
  assert.equal(second.getPage("m-1", "doc-1", 1, DIGEST).text, RECORD.text);
});

test("a FAILED page may carry no lines: text with no reading behind it is not storable", (t) => {
  const { s } = store(t);
  assert.throws(() => s.putPage({ ...FAILED, lines: [line({ text: "半截识别结果" })] }),
    /a failed page must carry no lines/,
    "a page that failed read nothing, so a line on it would be text nobody can account for");
  // And the honest version stores clean.
  s.putPage(FAILED);
  assert.deepEqual(s.getPage("m-1", "doc-1", 1, DIGEST).lines, []);
});

test("a line must be a line: its number, its box and its verdict are all checked", (t) => {
  const { s } = store(t);
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ lineNo: 0 })] }), /lineNo must be a positive integer/);
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ lineNo: 1 }), line({ lineNo: 1 })] }), /appears twice/);
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ confidence: 1.5 })] }), /confidence must be a number in 0\.\.1/);
  assert.throws(() => s.putPage({ ...recognisedPage(RECORD.text), lines: [ocrLine({ text: RECORD.text, x: -0.1 })] }),
    /x must be a number in 0\.\.1/);
  assert.throws(() => s.putPage({ ...RECORD, lines: [line({ text: 12 })] }), /a line must carry its text/);
});

test("a line's box is complete or absent, never partial, and null is a real answer", (t) => {
  const { s } = store(t);
  // A text-layer line has no position; the store must be able to say so.
  s.putPage({ ...RECORD, lines: [line({ x: null, y: null, w: null, h: null })] });
  assert.deepEqual(s.getPage("m-1", "doc-1", 1, DIGEST).lines[0].x, null);
  // Half a box is not a position. Asserted on a RECOGNISED page, because that is the outcome where
  // a box is allowed at all — on a text-layer page any box is refused earlier and for a different
  // reason, which would have made this assertion pass without ever testing what it names.
  assert.throws(() => s.putPage({ ...recognisedPage(RECORD.text), lines: [ocrLine({ text: RECORD.text, x: null })] }),
    /complete or absent/, "three numbers and a null is not a location");
});

test("a store from a FUTURE schema is thrown away, even when its columns no longer match ours", (t) => {
  // The self-healing this design rests on, exercised on the case most likely to need it. Applying
  // our CREATE TABLE / CREATE INDEX before reading the version meant a future build that renamed a
  // column left an ocr_page our index could not be built on: the open threw `no such column: page`
  // and every read answered store_unavailable for ever. Reproduced before the fix.
  const dir = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = ocrDbPath(dir);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const future = new Database(dbPath);
  future.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (99);");
  future.exec("CREATE TABLE ocr_page (matter_id TEXT, document_id TEXT, page_index INTEGER);");
  future.close();

  const s = openOcrStore({ userDataDir: dir, openDatabase });
  t.after(() => s.close());
  s.putPage(RECORD);
  assert.equal(s.getPage("m-1", "doc-1", 1, DIGEST).text, RECORD.text, "the rebuilt store must work");
  const db = new Database(s.dbPath, { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 3);
  assert.deepEqual(
    db.prepare("PRAGMA table_info(ocr_page)").all().map((c) => c.name).filter((n) => n === "page" || n === "page_index"),
    ["page"], "the future build's column is gone, not merged");
});

test("text and lines are one fact: a page whose line contradicts its text is refused", (t) => {
  const { s } = store(t);
  // For an amount, 10000 and 100000 are different documents. The screen draws the line; search
  // reads the text. A transaction makes the write atomic, not consistent.
  assert.throws(() => s.putPage({ ...RECORD, text: "10000", lines: [line({ text: "100000" })] }),
    /does not appear in the page's text/);
  // And text with no lines would make the panel call a page empty while search finds words on it.
  assert.throws(() => s.putPage({ ...RECORD, text: "有字的一页", lines: [] }),
    /must carry the lines that text is made of/);
  // A whitespace-only page legitimately has none.
  s.putPage({ ...RECORD, text: "   ", lines: [] });
  assert.deepEqual(s.getPage("m-1", "doc-1", 1, DIGEST).lines, []);
});

test("the OUTCOME decides whether a line has a position at all", (t) => {
  const { s } = store(t);
  const boxed = { x: 0.1, y: 0.1, w: 0.5, h: 0.05 };
  // A text-layer page was never rendered, so the invented full-page box cannot come back in.
  assert.throws(() => s.putPage({ ...RECORD, outcome: "text_layer", lines: [line({ text: "本院经审理查明", ...boxed })] }),
    /never rendered/);
  // A recognised page WAS rendered, so a line without a box could never be matched by position.
  assert.throws(() => s.putPage({
    ...RECORD, outcome: "ocr", visionMs: 5, renderMs: 5, renderDigest: "0".repeat(64), layerMs: null,
    lines: [line({ text: "本院经审理查明", x: null, y: null, w: null, h: null })],
  }), /must carry the box it was recognised at/);
});
