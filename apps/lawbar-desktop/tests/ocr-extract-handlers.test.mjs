// ocr:extract and ocr:pages — the tier ladder and its scoping (product plan R3, WI-12).
//
// What these pin, and why:
//
//  1. SCOPING. A document id is a bearer token. Wrong tenant, wrong matter and no such document all
//     answer `unknown_document`, so no refusal confirms that a record exists on the other side of a
//     boundary. Nothing is read and no helper runs before that check passes.
//  2. THE LADDER RUNS IN THE ORDER MEASUREMENT DECIDED. The text layer is asked for once, for the
//     whole document. Recognition runs ONLY for pages with no usable layer, one call per page, so a
//     hang on one page costs one page. A page with a layer must never reach recognition.
//  3. THE THRESHOLD GATES ESCALATION, NEVER ACCEPTANCE. A short layer escalates to recognition;
//     nothing is accepted merely because its layer looked long enough.
//  4. NOTHING IS CERTIFIED. Every stored page is `unchecked`, and the summary states the number of
//     pages needing review rather than leaving it implied.
//  5. A FAILED PAGE IS STILL A PAGE. A helper failure on one page stores that page as failed with
//     its code and does not abort the document.
//  6. WHAT CROSSES BACK. Counts on extract; text only on the second, explicit call; codes never a
//     path or a raw message.
//
// The helper is injected as a fake throughout, so these are about the ladder and the boundary, not
// about Vision. The store is real (plain-node better-sqlite3), because the interesting mistakes are
// in what gets written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MIN_USABLE_LAYER_CHARS, OCR_EXTRACT_CHANNEL, ocrExtractHandler, ocrPagesHandler, layerLines } from "../dist/src/ocr/ocrExtractHandlers.js";
import { openOcrStore } from "../dist/src/ocr/ocrStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);
const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const openDatabase = (file) => new Database(file);

const DIGEST = "a".repeat(64);
const TENANT = "t-1";
const REQ = { matterId: "m-1", documentId: "doc-1" };

function page(n, count, over = {}) {
  return {
    page: n, page_count: count, source: "pdf", mode: "layer_only",
    layer_text: null, layer_chars: 0, layer_ms: 2,
    vision_text: null, vision_lines: null, vision_ms: null, render_ms: null, render_digest: null, error: null,
    ...over,
  };
}
const withLayer = (n, count, text) => page(n, count, { layer_text: text, layer_chars: text.length });
/** A recognised page, with the per-line records the real helper emits alongside the joined text. */
const recognised = (n, count, text) => ({
  ...page(n, count), mode: "full", vision_text: text, vision_ms: 220, render_ms: 30,
  vision_lines: text.split("\n").map((t, i) => ({ text: t, confidence: 0.9, x: 0.1, y: 0.9 - i * 0.05, w: 0.8, h: 0.04 })),
  render_digest: "0".repeat(64),
});

/** A fake helper that records every call, so the LADDER itself can be asserted. */
function fakeHelper(plan) {
  const calls = [];
  return {
    calls,
    extract: async (helperDeps, options) => {
      calls.push({ layerOnly: options.layerOnly === true, pages: options.pages ?? null, timeoutMs: helperDeps.timeoutMs });
      return plan(options, calls.length);
    },
  };
}

function harness(t, { plan, persistence, tenant = TENANT, storeExists = true } = {}) {
  // `storeExists: false` models a profile where nothing has ever been extracted: the provider
  // returns null and the store is never touched, because touching it is what would create it.
  const dir = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-h-"));
  const real = openOcrStore({ userDataDir: dir, openDatabase });
  t.after(() => { real.close(); rmSync(dir, { recursive: true, force: true }); });
  const helper = fakeHelper(plan ?? (() => ({ ok: true, pages: [], elapsed_ms: 1 })));
  // EVERY dependency is counted, not only the helper: "nothing is read before scoping passes"
  // must cover the derived store and the file resolver too, or it is a claim about one of three.
  const touched = [];
  const store = new Proxy(real, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args) => { touched.push(`store.${String(prop)}`); return v.apply(target, args); };
    },
  });
  const deps = {
    provide: () => {
      touched.push("provide");
      return {
        persistence: persistence ?? {
          getMatter: async (id) => { touched.push("getMatter"); return id === "m-1" ? { tenant_id: TENANT } : null; },
          getDocument: async (id) => { touched.push("getDocument"); return id === "doc-1" ? { id, tenant_id: TENANT, matter_id: "m-1", filename: "a.pdf" } : null; },
        },
      };
    },
    storageRoot: "/store",
    store: () => { touched.push("openStore"); return store; },
    // Default true: most tests here concern a profile that already has readings. The test for a
    // profile with none sets it false and asserts the store is never opened at all — because
    // opening it is what CREATES it, and browsing must not create a database.
    existingStore: () => { touched.push("existingStore"); return storeExists ? store : null; },
    // The same two deadlines main passes, so a test that asserts them is asserting production's shape.
    helper: { helperPath: "/nowhere/lawbar-ocr", pinnedDigest: DIGEST, timeoutMs: 15_000 },
    recogniseTimeoutMs: 120_000,
    tenantId: () => tenant,
    now: () => "2026-09-12T00:00:00Z",
    extract: helper.extract,
    resolveFile: (root, docId, filename) => { touched.push("resolveFile"); return `${root}/${docId}/${filename}`; },
  };
  return { deps, store: real, helper, touched };
}

test("the channel names are what the preload will invoke", () => {
  assert.deepEqual(OCR_EXTRACT_CHANNEL, { extract: "ocr:extract", pages: "ocr:pages" });
});

test("scoping: a wrong tenant, a wrong matter and an unknown document all answer the same, and no helper runs", async (t) => {
  for (const [label, over] of [
    ["another tenant's matter", { tenant: "t-2" }],
    ["a document in another matter", { persistence: {
      getMatter: async () => ({ tenant_id: TENANT }),
      getDocument: async (id) => ({ id, tenant_id: TENANT, matter_id: "m-OTHER", filename: "a.pdf" }),
    } }],
    ["a document of another tenant", { persistence: {
      getMatter: async () => ({ tenant_id: TENANT }),
      getDocument: async (id) => ({ id, tenant_id: "t-2", matter_id: "m-1", filename: "a.pdf" }),
    } }],
    ["no such document", { persistence: {
      getMatter: async () => ({ tenant_id: TENANT }), getDocument: async () => null,
    } }],
    ["no such matter", { persistence: {
      getMatter: async () => null, getDocument: async () => null,
    } }],
  ]) {
    const { deps, helper, touched } = harness(t, over);
    assert.deepEqual(await ocrExtractHandler(REQ, deps), { ok: false, code: "unknown_document" }, label);
    assert.deepEqual(await ocrPagesHandler(REQ, deps), { ok: false, code: "unknown_document" }, label);
    assert.equal(helper.calls.length, 0, `${label}: nothing may be read before scoping passes`);
    assert.deepEqual(touched.filter((c) => c.startsWith("store.") || c === "resolveFile" || c === "openStore"), [],
      `${label}: the derived store must not even be OPENED, nor a path built, before scoping passes`);
  }
});

test("the matter's own tenant is checked, not only the document's — the case for an inconsistent box", async (t) => {
  // Mutation testing found this gap: with the matter's tenant check removed, every other scoping
  // case still failed via the DOCUMENT's tenant, so the matter check looked untested and was.
  // The case it exists for is a box that disagrees with itself — a document marked as this
  // tenant's, sitting in a matter that belongs to someone else. Defence in depth means the first
  // lock is checked even when the second would also hold.
  const { deps, helper } = harness(t, {
    persistence: {
      getMatter: async () => ({ tenant_id: "t-OTHER" }),
      getDocument: async (id) => ({ id, tenant_id: TENANT, matter_id: "m-1", filename: "a.pdf" }),
    },
  });
  assert.deepEqual(await ocrExtractHandler(REQ, deps), { ok: false, code: "unknown_document" });
  assert.deepEqual(await ocrPagesHandler(REQ, deps), { ok: false, code: "unknown_document" });
  assert.equal(helper.calls.length, 0, "the matter is rejected before the document is even looked up");
});

test("the payload is exactly two known keys, and anything else is refused before any lookup", async (t) => {
  const { deps, helper, touched } = harness(t);
  for (const bad of [undefined, null, {}, "x", [], { matterId: "m-1" },
    { matterId: "m-1", documentId: "doc-1", extra: 1 }, { matterId: "", documentId: "doc-1" },
    { matterId: "m-1", documentId: 7 }]) {
    assert.deepEqual(await ocrExtractHandler(bad, deps), { ok: false, code: "invalid_request" }, JSON.stringify(bad));
    assert.deepEqual(await ocrPagesHandler(bad, deps), { ok: false, code: "invalid_request" }, JSON.stringify(bad));
  }
  assert.equal(helper.calls.length, 0);
  assert.deepEqual(touched, [], "a malformed payload touches NOTHING — not persistence, not the store");
});

test("the ladder: the layer is asked for ONCE for the whole document, and a page with a layer never reaches recognition", async (t) => {
  const long = "本院经审理查明：被告于二零二五年五月签订合同。";
  const { deps, store, helper } = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [withLayer(1, 2, long), withLayer(2, 2, long)], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(options.pages.from, 2, "should never be asked for")], elapsed_ms: 5 },
  });
  const res = await ocrExtractHandler(REQ, deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(helper.calls.map(({ layerOnly, pages }) => ({ layerOnly, pages })),
    [{ layerOnly: true, pages: null }], "one layer call, and no recognition at all");
  assert.deepEqual(res.value, { pageCount: 2, fromTextLayer: 2, recognised: 0, failed: 0, missing: 0, needsReview: 2 });
  assert.deepEqual(Object.keys(res.value).sort(),
    ["failed", "fromTextLayer", "missing", "needsReview", "pageCount", "recognised"],
    "the summary carries counts and nothing else — no path, no digest, no timing");
  const rows = store.listPages("m-1", "doc-1", DIGEST);
  assert.deepEqual(rows.map((r) => r.outcome), ["text_layer", "text_layer"]);
  assert.deepEqual(rows.map((r) => r.text), [long, long]);
});

test("recognition runs ONLY for pages without a usable layer, one call per page", async (t) => {
  const long = "本院经审理查明：被告于二零二五年五月签订合同。";
  const { deps, store, helper } = harness(t, {
    plan: (options) => options.layerOnly
      // page 2 is a scan: no layer at all. Page 3's layer is too short to use.
      ? { ok: true, pages: [withLayer(1, 3, long), page(2, 3), withLayer(3, 3, "第 3 页")], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(options.pages.from, 3, `read page ${options.pages.from}`)], elapsed_ms: 5 },
  });
  const res = await ocrExtractHandler(REQ, deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(helper.calls.map(({ layerOnly, pages }) => ({ layerOnly, pages })), [
    { layerOnly: true, pages: null },
    { layerOnly: false, pages: { from: 2, to: 2 } },
    { layerOnly: false, pages: { from: 3, to: 3 } },
  ], "one call per page needing recognition, and never a whole-document recognition pass");
  assert.deepEqual(res.value, { pageCount: 3, fromTextLayer: 1, recognised: 2, failed: 0, missing: 0, needsReview: 3 });
  const rows = store.listPages("m-1", "doc-1", DIGEST);
  assert.deepEqual(rows.map((r) => r.outcome), ["text_layer", "ocr", "ocr"]);
  assert.equal(rows[2].text, "read page 3", "a short layer escalates: the recognised text wins, not the layer");
});

test("the threshold gates escalation only: one under recognises, one over uses the layer, exactly at it uses the layer", async (t) => {
  const under = "字".repeat(MIN_USABLE_LAYER_CHARS - 1);
  const over = "字".repeat(MIN_USABLE_LAYER_CHARS + 1);
  const { deps, store, helper } = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [withLayer(1, 2, under), withLayer(2, 2, over)], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(options.pages.from, 2, "recognised")], elapsed_ms: 5 },
  });
  await ocrExtractHandler(REQ, deps);
  assert.deepEqual(helper.calls.map((c) => c.pages), [null, { from: 1, to: 1 }], "only the short page escalates");
  const rows = store.listPages("m-1", "doc-1", DIGEST);
  assert.deepEqual(rows.map((r) => r.outcome), ["ocr", "text_layer"]);
  // Exactly at the threshold is INSIDE the usable side — the boundary itself, not merely near it.
  const at = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [withLayer(1, 1, "字".repeat(MIN_USABLE_LAYER_CHARS))], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(1, 1, "recognised")], elapsed_ms: 5 },
  });
  await ocrExtractHandler(REQ, at.deps);
  assert.equal(at.store.listPages("m-1", "doc-1", DIGEST)[0].outcome, "text_layer");
  assert.equal(at.helper.calls.length, 1, "exactly at the threshold does not escalate");

  // A layer of only whitespace is no layer, however long.
  const blank = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [withLayer(1, 1, " ".repeat(MIN_USABLE_LAYER_CHARS + 5))], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(1, 1, "recognised")], elapsed_ms: 5 },
  });
  await ocrExtractHandler(REQ, blank.deps);
  assert.equal(blank.store.listPages("m-1", "doc-1", DIGEST)[0].outcome, "ocr");
});

test("a page whose recognition fails is stored as a failed page with its code, and the document continues", async (t) => {
  const { deps, store } = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [page(1, 3), page(2, 3), page(3, 3)], elapsed_ms: 5 }
      : options.pages.from === 2
        ? { ok: false, code: "helper_timeout", elapsed_ms: 5 }
        : { ok: true, pages: [recognised(options.pages.from, 3, "read")], elapsed_ms: 5 },
  });
  const res = await ocrExtractHandler(REQ, deps);
  assert.equal(res.ok, true, "one bad page must not abort the document");
  assert.deepEqual(res.value, { pageCount: 3, fromTextLayer: 0, recognised: 2, failed: 1, missing: 0, needsReview: 3 },
    "the failed page needs the owner's eyes MORE than the others, so it counts toward review");
  const rows = store.listPages("m-1", "doc-1", DIGEST);
  assert.deepEqual(rows.map((r) => r.outcome), ["ocr", "failed", "ocr"]);
  assert.equal(rows[1].failureCode, "helper_timeout");
  assert.deepEqual([rows[1].text, rows[1].visionMs, rows[1].renderMs], ["", null, null]);
});

test("a helper the build cannot stand behind refuses the whole call rather than storing anything", async (t) => {
  for (const [code, expected] of [
    ["helper_unreadable_input", "unsupported_document"],
    ["helper_bad_arguments", "unsupported_document"],
    ["helper_stale", "helper_unavailable"],
    ["helper_missing", "helper_unavailable"],
    ["helper_timeout", "extract_failed"],
    ["helper_bad_output", "extract_failed"],
  ]) {
    const { deps, store } = harness(t, { plan: () => ({ ok: false, code, elapsed_ms: 1 }) });
    assert.deepEqual(await ocrExtractHandler(REQ, deps), { ok: false, code: expected }, code);
    assert.deepEqual(store.listPages("m-1", "doc-1", DIGEST), [], `${code}: nothing may be stored`);
  }
  // No pin at all: the build cannot say which binary would read, so it does not read.
  const { deps, store } = harness(t);
  deps.helper = { helperPath: "/nowhere", pinnedDigest: null };
  assert.deepEqual(await ocrExtractHandler(REQ, deps), { ok: false, code: "helper_unavailable" });
  // Reading back REFUSES rather than returning an empty list: "no OCR for this document" and
  // "this build cannot tell you" are different facts and must not share an answer.
  assert.deepEqual(await ocrPagesHandler(REQ, deps), { ok: false, code: "helper_unavailable" });
  assert.deepEqual(store.listPages("m-1", "doc-1", DIGEST), []);
});

test("nothing is certified: every stored page is unchecked and the summary says how many need reading", async (t) => {
  const long = "本院经审理查明：被告于二零二五年五月签订合同。";
  const { deps, store } = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [withLayer(1, 2, long), page(2, 2)], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(2, 2, "recognised")], elapsed_ms: 5 },
  });
  const res = await ocrExtractHandler(REQ, deps);
  assert.equal(res.value.needsReview, 2, "both pages need reading, because no control ships");
  assert.equal(res.value.needsReview, res.value.pageCount, "every page of the document, not every page that succeeded");
  const stored = store.listPages("m-1", "doc-1", DIGEST);
  assert.equal(stored.length, 2, "and the loop below is not vacuous");
  for (const r of stored) {
    assert.ok(r.lines.length > 0, "a read page must store the lines it was read as");
    for (const l of r.lines) {
      assert.equal(l.control, "unchecked", "no control engine ships, so nothing may be marked");
      assert.equal(l.controlEngine, null);
    }
  }
});

test("a THROWN dependency becomes a code, never raw text across the boundary", async (t) => {
  // extractPages returns failures as fields, but an injected implementation, an OOM, or a
  // programming error can still reject — and whatever message that carries may name a path.
  const { deps, store } = harness(t, {
    plan: () => { throw new Error("ENOENT: no such file or directory, open '/Users/someone/Documents/client/case.pdf'"); },
  });
  const res = await ocrExtractHandler(REQ, deps);
  assert.equal(res.ok, false);
  assert.deepEqual(Object.keys(res).sort(), ["code", "ok"], "a refusal is a code and nothing else");
  assert.equal(res.code, "extract_failed");
  assert.ok(!JSON.stringify(res).includes("/Users"), "no path may cross");
  assert.deepEqual(store.listPages("m-1", "doc-1", DIGEST), []);

  // The same for a page-level throw, mid-document: that page fails, the document continues.
  let call = 0;
  const mid = harness(t, {
    plan: (options) => {
      call += 1;
      if (options.layerOnly) return { ok: true, pages: [page(1, 2), page(2, 2)], elapsed_ms: 5 };
      if (call === 2) throw new Error("boom /Users/someone/secret.pdf");
      return { ok: true, pages: [recognised(options.pages.from, 2, "read")], elapsed_ms: 5 };
    },
  });
  const res2 = await ocrExtractHandler(REQ, mid.deps);
  assert.equal(res2.ok, true, "a thrown page must not abort the document");
  const rows = mid.store.listPages("m-1", "doc-1", DIGEST);
  assert.deepEqual(rows.map((r) => r.outcome), ["failed", "ocr"]);
  assert.equal(rows[0].failureCode, "helper_bad_output");
  assert.ok(!JSON.stringify(rows).includes("/Users"), "no path may be stored either");
});

test("the two calls carry the deadlines their work needs, not one number for both", async (t) => {
  const { deps, helper } = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [page(1, 1)], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(1, 1, "read")], elapsed_ms: 5 },
  });
  await ocrExtractHandler(REQ, deps);
  assert.deepEqual(helper.calls.map((c) => [c.layerOnly, c.timeoutMs]), [[true, 15_000], [false, 120_000]],
    "a whole-document layer read is not a per-page recognition and must not share its deadline");
});

test("a derived store that cannot be opened or written is a CODE, never raw text naming a file", async (t) => {
  // Opening sqlite throws an error whose message names the file. That must not reach the renderer.
  const boom = () => { throw new Error("SQLITE_CANTOPEN: unable to open database file /Users/someone/Library/ocr.sqlite"); };
  const { deps } = harness(t, { plan: () => ({ ok: true, pages: [page(1, 1)], elapsed_ms: 5 }) });
  // BOTH providers: extraction opens the store to write, reading asks for the one already there,
  // and a failure in either must arrive as a code. Overriding only `store` left the read path
  // untested the moment the handler stopped using it.
  deps.store = boom;
  deps.existingStore = boom;
  for (const res of [await ocrExtractHandler(REQ, deps), await ocrPagesHandler(REQ, deps)]) {
    assert.deepEqual(Object.keys(res).sort(), ["code", "ok"]);
    assert.equal(res.code, "store_unavailable");
    assert.ok(!JSON.stringify(res).includes("/Users"), "no path may cross");
  }
  // A store that opens but fails mid-document answers the same way.
  const mid = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [page(1, 2), page(2, 2)], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(options.pages.from, 2, "read")], elapsed_ms: 5 },
  });
  const realStore = mid.store;
  mid.deps.store = () => ({
    ...realStore,
    putPage: () => { throw new Error("disk I/O error at /Users/someone/ocr.sqlite"); },
  });
  const res = await ocrExtractHandler(REQ, mid.deps);
  assert.equal(res.code, "store_unavailable");
  assert.ok(!JSON.stringify(res).includes("/Users"));
});

test("re-running is idempotent: the same pages, not doubled", async (t) => {
  const long = "本院经审理查明：被告于二零二五年五月签订合同。";
  const { deps, store } = harness(t, {
    plan: () => ({ ok: true, pages: [withLayer(1, 1, long)], elapsed_ms: 5 }),
  });
  const first = await ocrExtractHandler(REQ, deps);
  const second = await ocrExtractHandler(REQ, deps);
  assert.deepEqual(first.value, second.value);
  assert.equal(store.listPages("m-1", "doc-1", DIGEST).length, 1);
});

test("ocr:pages returns text only on its own call, rebuilt field by field, with the unaccounted-for pages named", async (t) => {
  const long = "本院经审理查明：被告于二零二五年五月签订合同。";
  const { deps } = harness(t, {
    plan: (options) => options.layerOnly
      // The helper claims a 5-page document but returns 2: extraction would refuse this upstream,
      // so it is forced here to prove `missing` is reported rather than inferred from silence.
      ? { ok: true, pages: [withLayer(1, 5, long), withLayer(2, 5, long)], elapsed_ms: 5 }
      : { ok: true, pages: [recognised(options.pages.from, 5, "read")], elapsed_ms: 5 },
  });
  await ocrExtractHandler(REQ, deps);
  const res = await ocrPagesHandler(REQ, deps);
  assert.equal(res.ok, true);
  assert.equal(res.value.missing, 3, "three pages have no outcome at all and the caller is told so");
  assert.deepEqual(Object.keys(res.value).sort(), ["missing", "pages"], "the value itself carries nothing else");
  assert.equal(res.value.pages.length, 2, "and the per-page check below is not vacuous");
  for (const p of res.value.pages) {
    assert.deepEqual(Object.keys(p).sort(),
      ["failureCode", "lines", "outcome", "page", "pageCount", "text"],
      "EVERY page: no path, no digest, no timing crosses; a column added to the store cannot cross by default");
    for (const l of p.lines) {
      assert.deepEqual(Object.keys(l).sort(), ["control", "text"],
        "a LINE crosses its text and its verdict, and not its confidence or its box");
    }
  }
  assert.equal(res.value.pages[0].text, long);
});

test("asking what a document has had read does NOT create the derived store when nothing ever has", async (t) => {
  // The packaged acceptance caught this: opening the OCR disclosure on a document answered the
  // question by OPENING the store, which creates it. A profile where the owner only ever looked
  // then grew a second database — the exact thing ocrStore.ts is built to avoid, since runBackup
  // copies one database by hardcoded name and would never carry this one.
  const { deps, touched } = harness(t, { storeExists: false });
  const r = await ocrPagesHandler({ matterId: "m-1", documentId: "doc-1" }, deps);
  assert.deepEqual(r, { ok: true, value: { pages: [], missing: null } },
    "no store means no pages, and completeness UNKNOWN rather than a claim of zero missing");
  assert.equal(touched.includes("openStore"), false,
    `the store was opened to answer a question that did not need it: ${touched.join(", ")}`);
  assert.equal(touched.includes("existingStore"), true, "the handler must actually ask");
});

test("but once a reading exists, the same request reads it", async (t) => {
  // The other side, so the short-circuit above cannot be satisfied by never reading at all.
  const { deps, store } = harness(t);
  store.putPage({
    matterId: "m-1", documentId: "doc-1", page: 1, pageCount: 1, helperDigest: DIGEST,
    outcome: "text_layer", text: "已存在的一页", source: "pdf", failureCode: null,
    renderDigest: null, layerMs: 1, visionMs: null, renderMs: null,
    lines: [{ lineNo: 1, text: "已存在的一页", confidence: 1, x: 0, y: 0, w: 1, h: 1, control: "unchecked", controlEngine: null }],
    extractedAt: "2026-09-12T00:00:00Z",
  });
  const r = await ocrPagesHandler({ matterId: "m-1", documentId: "doc-1" }, deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value.pages.length, 1);
  assert.equal(r.value.pages[0].text, "已存在的一页");
});

test("a RECOGNISED page stores the helper's OWN line records, not a split of the joined text", async (t) => {
  // The control compares line by line, so where the lines come from is load-bearing. Vision reports
  // them; reconstructing them by splitting the join would be a guess where the recogniser already
  // has the answer — and the two differ the moment a line contains a newline of its own.
  const { deps, store } = harness(t, {
    plan: (options) => options.layerOnly
      ? { ok: true, pages: [page(1, 1)], elapsed_ms: 4 }
      : { ok: true, pages: [recognised(1, 1, "第一行\n第二行\n第三行")], elapsed_ms: 9 },
  });
  const res = await ocrExtractHandler(REQ, deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  const stored = store.getPage("m-1", "doc-1", 1, DIGEST);
  assert.deepEqual(stored.lines.map((l) => l.text), ["第一行", "第二行", "第三行"]);
  assert.deepEqual(stored.lines.map((l) => l.lineNo), [1, 2, 3], "numbered in the recogniser's order");
  // The box and confidence come from the helper and are kept: a second engine's lines will be
  // matched to these by POSITION, not by hoping two engines emit them in the same order.
  assert.deepEqual(stored.lines.map((l) => l.confidence), [0.9, 0.9, 0.9]);
  assert.equal(stored.lines[0].x, 0.1);
  assert.ok(stored.lines[0].y > stored.lines[1].y, "the boxes descend the page as the lines do");
});

test("a TEXT-LAYER page stores lines too, split on the layer's own newlines", async (t) => {
  // A PDF's text layer has no line records — it is a string, and its newlines are the whole of the
  // line information that exists. Splitting them is not a guess here; it is what the file says.
  const { deps, store } = harness(t, {
    plan: () => ({ ok: true, pages: [withLayer(1, 1, "合同金额为 12,345.67元。\n\n本合同自签字之日起生效。")], elapsed_ms: 3 }),
  });
  assert.equal((await ocrExtractHandler(REQ, deps)).ok, true);
  const stored = store.getPage("m-1", "doc-1", 1, DIGEST);
  assert.equal(stored.outcome, "text_layer");
  assert.deepEqual(stored.lines.map((l) => l.text), ["合同金额为 12,345.67元。", "本合同自签字之日起生效。"]);
  // No render happened, so no line has a position. The unit square says "unmeasured" instead of a
  // fabricated rectangle, and confidence is 1 because these characters were READ, not recognised.
  // NO POSITION, because there was no render. The unit square would assert that every line covers
  // the whole page, which is a measurement that did not happen and would later match a second
  // engine's line to the wrong one.
  for (const l of stored.lines) {
    assert.deepEqual([l.x, l.y, l.w, l.h], [null, null, null, null],
      "a text-layer line has no position; null says so, (0,0,1,1) would claim otherwise");
    assert.equal(l.confidence, 1, "read, not recognised");
  }
});

test("layerLines reads back what the layer says, and nothing else", () => {
  const noBox = { confidence: 1, x: null, y: null, w: null, h: null, control: "unchecked", controlEngine: null };
  assert.deepEqual(layerLines("a\nb\nc"), [
    { lineNo: 1, text: "a", ...noBox },
    { lineNo: 2, text: "b", ...noBox },
    { lineNo: 3, text: "c", ...noBox },
  ]);
  assert.deepEqual(layerLines("a\r\nb").map((l) => l.text), ["a", "b"], "a carriage return is not a line of text");
  assert.deepEqual(layerLines("a\n\n\nb").map((l) => l.text), ["a", "b"], "blank lines are not lines");
  assert.deepEqual(layerLines("   \n\t\n"), [], "whitespace-only input has no lines");
  assert.deepEqual(layerLines("keep  inner   spaces").map((l) => l.text), ["keep  inner   spaces"],
    "only the ENDS are trimmed; a document's own spacing is its own");
});

test("re-extracting a page REPLACES its lines; a shorter second reading leaves no surplus behind", async (t) => {
  // A page that came back with fewer lines the second time must not keep the first run's extras, or
  // the store would show text the helper no longer reports.
  const { deps, store } = harness(t, {
    plan: (options, n) => options.layerOnly
      ? { ok: true, pages: [page(1, 1)], elapsed_ms: 4 }
      : { ok: true, pages: [recognised(1, 1, n <= 2 ? "甲\n乙\n丙" : "甲")], elapsed_ms: 9 },
  });
  assert.equal((await ocrExtractHandler(REQ, deps)).ok, true);
  assert.deepEqual(store.getPage("m-1", "doc-1", 1, DIGEST).lines.map((l) => l.text), ["甲", "乙", "丙"]);
  assert.equal((await ocrExtractHandler(REQ, deps)).ok, true);
  assert.deepEqual(store.getPage("m-1", "doc-1", 1, DIGEST).lines.map((l) => l.text), ["甲"],
    "the second reading's lines are the page's lines; the first run's are gone");
});
