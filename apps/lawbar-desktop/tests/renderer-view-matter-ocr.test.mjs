// The OCR disclosure on a document row (product plan R3, WI-12). Pure Node, mock document.
//
// The point of this suite is NOT that the panel renders. It is that the panel cannot make a claim
// the measurement does not support. The numbers behind that: on the owner's own scans, folded
// character error rate 0.190, and 0.31 on lines of six characters or fewer — which is where case
// numbers, dates and amounts live. Agreement between two engines was validated blind 15 of 15 and
// still bounds the failure rate near one in five, not at zero. So:
//
//   • no string this panel can show may say the text has been checked, confirmed or is correct;
//   • every page must say HOW its text was obtained;
//   • digit-bearing fields must be listed for the reader, on every page that has them;
//   • a refusal must produce its own sentence, never a swallowed failure or a stuck placeholder.
//
// Each test below provokes the failure it guards against, rather than asserting the happy path.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import { renderOcrDisclosure, numericFields, ocrFailureKey } from "../dist/renderer/screens/viewMatterOcr.js";
import { MockDoc, MockEl, MockText, findByTestId, findAllByTestId, findAll, collectText, flush } from "./_view-matter-dom.mjs";

/**
 * A document whose elements REFUSE innerHTML.
 *
 * The shared mock has no browser semantics for innerHTML: an assignment is an inert expando there
 * and parses markup in Electron, so a test that only checks textContent would pass an
 * implementation that sets textContent and then assigns innerHTML as well. dom.ts bans innerHTML
 * outright; this makes the ban observable in a unit test instead of taken on trust.
 */
class StrictDoc extends MockDoc {
  createElement(tag) {
    const node = super.createElement(tag);
    Object.defineProperty(node, "innerHTML", {
      set(v) { throw new Error(`innerHTML was assigned on <${tag}>: ${String(v).slice(0, 60)}`); },
      get() { throw new Error("innerHTML was read; this renderer does not use it"); },
      configurable: true,
    });
    return node;
  }
}

/** The <li> containers, one per page, so an assertion binds to the page it is about. */
const pageContainers = (root) => findAllByTestId(root, "view-ocr-page");
const within = (container, id) => findAllByTestId(container, id);
/** Every text node under a subtree, including content set via textContent. */
function allText(node) {
  const out = [];
  const rec = (n) => {
    if (n instanceof MockText) { out.push(n.textContent); return; }
    if (!(n instanceof MockEl)) return;
    if (n._textContent !== "") out.push(n._textContent);
    for (const c of n.children) rec(c);
  };
  rec(node);
  return out.join("\u0000");
}

const MATTER = "01jzabcdef0123456789ghjkmn";
const DOCUMENT = "01jzwxyzpq0123456789rstvwx";

function page(overrides = {}) {
  return {
    page: 1,
    pageCount: 1,
    outcome: "text_layer",
    text: "被告应于本判决生效之日起十日内支付",
    failureCode: null,
    control: "unchecked",
    ...overrides,
  };
}

/** A bridge that records what it was asked, so laziness and re-entrancy are observable. */
function stubBridge({ pages, extract } = {}) {
  const calls = { pages: 0, extract: 0 };
  return {
    calls,
    pages: async (m, d) => {
      calls.pages += 1;
      calls.lastPages = [m, d];
      return typeof pages === "function" ? pages(calls.pages) : (pages ?? { ok: true, value: { pages: [], missing: null } });
    },
    extract: async (m, d) => {
      calls.extract += 1;
      calls.lastExtract = [m, d];
      return typeof extract === "function" ? extract(calls.extract) : (extract ?? { ok: false, code: "helper_unavailable" });
    },
  };
}

const open = async (node) => {
  findByTestId(node, "view-ocr-summary").dispatchEvent({ type: "click" });
  await flush();
};

// ---------------------------------------------------------------------------
// The claim the panel is not allowed to make
// ---------------------------------------------------------------------------

// A blacklist alone cannot establish a negative. These are the phrasings a Chinese legal reader
// takes as certification, and the list is the CHEAP half of the guard: the expensive half is the
// exact-wording assertions below, which make any rewording of a high-risk label a deliberate act.
const CERTIFYING = [
  "已核对", "已核实", "核对无误", "无误", "准确无误", "确认无误", "校验通过", "已验证", "保证准确",
  "已审校", "经人工复核", "与原件一致", "内容属实", "识别准确", "结果可信", "审核通过", "可直接使用",
  "可直接用于", "已人工", "人工审校", "已确认",
];

test("NO OCR string in the CATALOGUE claims the text has been checked, confirmed, or is correct", () => {
  const offenders = [];
  for (const [id, text] of Object.entries(CATALOG)) {
    if (!id.startsWith("document.ocr.")) continue;
    for (const word of CERTIFYING) if (text.includes(word)) offenders.push(`${id}: ${word}`);
  }
  assert.deepEqual(offenders, [], `an OCR string claims the text is verified:\n  ${offenders.join("\n  ")}`);
});

test("NOTHING THE PANEL RENDERS claims the text has been checked — every reachable state, not just the catalogue", async () => {
  // The catalogue test above cannot see a literal written straight into the DOM. This one renders
  // every state the panel has and reads back what a person would actually see.
  const states = [
    { name: "unread", pages: { ok: true, value: { pages: [], missing: null } } },
    { name: "refused", pages: { ok: false, code: "store_unavailable" } },
    { name: "pages, every outcome and every control", pages: { ok: true, value: { missing: 2, pages: [
      page({ page: 1, pageCount: 4, outcome: "text_layer", control: "unchecked" }),
      page({ page: 2, pageCount: 4, outcome: "ocr", control: "agreed", text: "识别文字 12,345.67元" }),
      page({ page: 3, pageCount: 4, outcome: "ocr", control: "disagreed" }),
      page({ page: 4, pageCount: 4, outcome: "failed", text: "", failureCode: "render_failed" }),
    ] } } },
  ];
  for (const st of states) {
    const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, stubBridge({ pages: st.pages }));
    await open(node);
    const shown = allText(node);
    for (const word of CERTIFYING) {
      assert.equal(shown.includes(word), false, `state "${st.name}" renders a certifying claim: ${word}`);
    }
  }
});

test("the AGREED label is one exact reviewed sentence — agreement is not correctness", () => {
  // Exact, not a substring test: 「已与原件核验一致；机器识别本身不表示正确」 would satisfy any
  // substring check while telling a litigator the text was checked against the original.
  assert.equal(CATALOG["document.ocr.control.agreed"], "第二引擎读出相同结果（仅表示两者一致，不表示正确）");
  assert.equal(CATALOG["document.ocr.control.unchecked"], "未经第二引擎比对");
  assert.equal(CATALOG["document.ocr.control.disagreed"], "第二引擎读出不同结果，请优先核对本页");
  assert.equal(CATALOG["document.ocr.caveat"],
    "识别出来的文字只用于查找和定位，不能当作原文引用。要写进文书的任何内容，都请逐字对照原件。");
});

test("the caveat is present in EVERY state and sits above every line of extracted text", async () => {
  const unopened = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, stubBridge());
  assert.notEqual(findByTestId(unopened, "view-ocr-caveat"), null,
    "the caveat must exist without opening or loading anything");

  const bridge = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [page(), page({ page: 2, pageCount: 2 })] } } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const caveat = findByTestId(node, "view-ocr-caveat");
  assert.notEqual(caveat, null, "the caveat must survive a load, not be replaced by the result");
  assert.equal(collectText(caveat), CATALOG["document.ocr.caveat"]);
  // Position, not mere presence: a caveat under the text is a caveat read after the damage.
  const order = findAll(node, (n) => n === caveat || n.getAttribute("data-test-id") === "view-ocr-page-text");
  assert.equal(order[0], caveat, "the caveat must precede every page of text in document order");
  assert.ok(order.length >= 3, "both pages of text must be in the ordering, or this proves nothing");
});

// ---------------------------------------------------------------------------
// Reachability and laziness
// ---------------------------------------------------------------------------

test("no bridge means no section at all, rather than a control that cannot work", () => {
  assert.equal(renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, null), null);
});

test("nothing is read until the section is opened", async () => {
  const bridge = stubBridge();
  const doc = new StrictDoc();
  renderOcrDisclosure(doc, MATTER, DOCUMENT, bridge);
  await flush();
  assert.equal(bridge.calls.pages, 0, "building the panel must not touch the store");
});

test("opening the section reads the store ONCE, with the identity it was given", async () => {
  const bridge = stubBridge();
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  await open(node);
  assert.equal(bridge.calls.pages, 1, "a second click must not re-read");
  assert.deepEqual(bridge.calls.lastPages, [MATTER, DOCUMENT]);
});

// ---------------------------------------------------------------------------
// What the pages say
// ---------------------------------------------------------------------------

test("a document nothing has read yet says so, and offers to read it", async () => {
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, stubBridge());
  await open(node);
  assert.equal(collectText(findByTestId(node, "view-ocr-none")), CATALOG["document.ocr.none"]);
  assert.equal(collectText(findByTestId(node, "view-ocr-read")), CATALOG["document.ocr.readButton"]);
});

test("EACH page carries its OWN acquisition line and its OWN control state", async () => {
  // Scoped per container on purpose. Flattening every outcome line into one array lets a renderer
  // attach both lines to page 1 and leave page 2 with none, and the arrays still match.
  const bridge = stubBridge({
    pages: { ok: true, value: { missing: 0, pages: [
      page({ page: 1, pageCount: 3, outcome: "text_layer", control: "unchecked" }),
      page({ page: 2, pageCount: 3, outcome: "ocr", control: "agreed", text: "证人证言" }),
      page({ page: 3, pageCount: 3, outcome: "ocr", control: "disagreed", text: "鉴定意见" }),
    ] } },
  });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);

  const containers = pageContainers(node);
  assert.equal(containers.length, 3, "one container per page");
  const expected = [
    ["第 1 页 / 共 3 页", CATALOG["document.ocr.outcome.text_layer"], CATALOG["document.ocr.control.unchecked"]],
    ["第 2 页 / 共 3 页", CATALOG["document.ocr.outcome.ocr"], CATALOG["document.ocr.control.agreed"]],
    ["第 3 页 / 共 3 页", CATALOG["document.ocr.outcome.ocr"], CATALOG["document.ocr.control.disagreed"]],
  ];
  containers.forEach((c, i) => {
    const [head, outcome, control] = expected[i];
    const heads = within(c, "view-ocr-page-head");
    assert.equal(heads.length, 1, `page ${i + 1} must carry exactly one heading`);
    assert.equal(collectText(heads[0]), head);
    const lines = within(c, "view-ocr-page-outcome");
    assert.equal(lines.length, 1, `page ${i + 1} must carry exactly one acquisition line`);
    assert.equal(collectText(lines[0]), `${outcome} · ${control}`,
      `page ${i + 1} must state its own outcome and its own control, not another page's`);
  });
});

test("the page text is rendered as TEXT — markup in a client's document is never markup here", async () => {
  const hostile = '<script>alert(1)</script> 甲方：<b>某某</b>';
  const bridge = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [page({ text: hostile })] } } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const body = findByTestId(node, "view-ocr-page-text");
  // textContent, character for character. StrictDoc throws on any innerHTML access, so reaching
  // this line at all proves the panel never touched it — the mock alone could not show that,
  // because an innerHTML assignment there is an inert expando and markup in Electron.
  assert.equal(body.textContent, hostile);
  assert.equal(body.children.length, 0, "the text must be set as content, not parsed into nodes");
});

test("a FAILED page leaks NO text even when the record carries some, and still discloses itself", async () => {
  // Non-empty text on purpose. With text:"" a renderer written as `if (p.text) show(p.text)` passes
  // while happily printing a partial reading whenever a failed record arrives carrying one.
  const LEAK = "残缺的识别结果不得出现";
  const bridge = stubBridge({
    pages: { ok: true, value: { missing: 0, pages: [page({ outcome: "failed", text: LEAK, failureCode: "render_failed" })] } },
  });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const c = pageContainers(node)[0];
  assert.equal(collectText(within(c, "view-ocr-page-failure")[0]), "本页失败原因代码：render_failed");
  assert.equal(findByTestId(c, "view-ocr-page-text"), null, "a failed page must not present text");
  assert.equal(allText(c).includes(LEAK), false, "the failed page's text must appear NOWHERE in its container");
  // It must still say how it was attempted and that nothing compared it.
  assert.equal(collectText(within(c, "view-ocr-page-outcome")[0]),
    `${CATALOG["document.ocr.outcome.unreadable"]} · ${CATALOG["document.ocr.control.unchecked"]}`,
    "a failed page still owes the reader its acquisition and control disclosure");
});

test("an incomplete run is stated, and UNKNOWN completeness is not reported as complete", async () => {
  const some = stubBridge({ pages: { ok: true, value: { missing: 3, pages: [page()] } } });
  const a = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, some);
  await open(a);
  assert.equal(collectText(findByTestId(a, "view-ocr-missing")), "有 3 页没有任何结果，本次识别没有走完整个文档。");
  assert.equal(findByTestId(a, "view-ocr-missing").getAttribute("role"), "alert");

  const unknown = stubBridge({ pages: { ok: true, value: { missing: null, pages: [page()] } } });
  const b = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, unknown);
  await open(b);
  assert.equal(collectText(findByTestId(b, "view-ocr-missing")), CATALOG["document.ocr.missingUnknown"],
    "null completeness must say it is unknown, never imply zero missing pages");

  const complete = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [page()] } } });
  const c = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, complete);
  await open(c);
  assert.equal(findByTestId(c, "view-ocr-missing"), null, "a complete run says nothing about missing pages");
});

// ---------------------------------------------------------------------------
// The digit fields — the class the machine is worst at
// ---------------------------------------------------------------------------

test("numericFields keeps a case number WHOLE and reads Chinese numerals, which is how a judgment writes its binding numbers", () => {
  // Fragments are not checkable. A case number split into three digit runs points at nothing the
  // reader can look up, and a judgment's date and award are usually not digits at all.
  assert.deepEqual(numericFields("（2024）京0105民初12345号"), ["（2024）京0105民初12345号"]);
  assert.deepEqual(numericFields("（二〇二四）京0105民初12345号"), ["（二〇二四）京0105民初12345号"]);
  assert.deepEqual(numericFields("二〇二四年九月十二日"), ["二〇二四年九月十二日"]);
  assert.deepEqual(numericFields("赔偿人民币壹拾万元整，于二〇二四年九月十二日前付清"),
    ["壹拾万元整", "二〇二四年九月十二日"]);
});

test("numericFields covers the everyday digit-bearing fields, and lists nothing when there is nothing", () => {
  assert.deepEqual(numericFields("标的额为 12,345.67元"), ["12,345.67元"]);
  assert.deepEqual(numericFields("依照第52条第2款"), ["52条第2款"], "one citation, kept whole");
  // Long digit runs and a rate. The runs are deliberately NOT identity- or telephone-shaped:
  // check-no-real-data refuses any 18-digit run and any 1[3-9]-prefixed 11-digit run anywhere in
  // this repository, and a test fixture is not a reason to teach that gate exceptions.
  assert.deepEqual(numericFields("卷号000000190001，联系电话00000000000，年利率24%"),
    ["000000190001", "00000000000", "24%"], "a long reference number, an 11-digit run and a rate");
  assert.deepEqual(numericFields("本院认为，被告应当承担违约责任。"), [],
    "a page with no numbers must not be decorated with an empty warning");
  assert.deepEqual(numericFields("１２３４号"), ["１２３４号"], "full-width digits are digits");
  assert.deepEqual(numericFields("第1条 第1条"), ["1条"], "the same field is listed once, not once per occurrence");
  assert.deepEqual(numericFields("2026年第一季度"), ["2026年"], "a dangling connector is not part of the field");
});

test("numericFields drops a bare enumeration marker, and says so by keeping the same digit when it has a unit", () => {
  assert.deepEqual(numericFields("1、原告身份证明；2、授权委托书"), [],
    "the 1 in a numbered list is not a field the reader can check");
  assert.deepEqual(numericFields("第1条"), ["1条"], "the same digit WITH a unit is a field");
});

test("EVERY page with numbers gets its own prompt, listing that page's own fields", async () => {
  // Three pages, three different situations. One document-level warning, or a warning only on the
  // first page, would satisfy a test that searched the whole panel — so each is scoped.
  const bridge = stubBridge({
    pages: { ok: true, value: { missing: 0, pages: [
      page({ page: 1, pageCount: 3, text: "标的额为 12,345.67元" }),
      page({ page: 2, pageCount: 3, text: "本院认为，被告应当承担违约责任。" }),
      page({ page: 3, pageCount: 3, text: "（2024）京0105民初12345号，二〇二四年九月十二日" }),
    ] } },
  });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const [p1, p2, p3] = pageContainers(node);

  assert.equal(within(p1, "view-ocr-page-numbers").length, 1);
  assert.equal(collectText(within(p1, "view-ocr-page-numbers")[0]), "本页含数字字段，请对照原件逐字核对：12,345.67元");
  assert.equal(within(p2, "view-ocr-page-numbers").length, 0, "a page without numbers carries no prompt");
  assert.equal(within(p3, "view-ocr-page-numbers").length, 1);
  assert.equal(collectText(within(p3, "view-ocr-page-numbers")[0]),
    "本页含数字字段，请对照原件逐字核对：（2024）京0105民初12345号、二〇二四年九月十二日");
  // And page 1's amount must not have leaked into page 3's prompt.
  assert.equal(collectText(within(p3, "view-ocr-page-numbers")[0]).includes("12,345.67元"), false);
});

// ---------------------------------------------------------------------------
// Refusals and failures
// ---------------------------------------------------------------------------

test("every refusal code maps to its OWN sentence, and an unknown code degrades to the request one", () => {
  const codes = ["unknown_document", "unsupported_document", "helper_unavailable", "store_unavailable", "extract_failed"];
  const keys = codes.map(ocrFailureKey);
  assert.equal(new Set(keys).size, codes.length, "two codes must not map to one key");
  for (const k of keys) assert.notEqual(CATALOG[k], undefined, `${k} is not in the catalogue`);
  // Distinct keys prove nothing if they all resolve to 「请求失败」. The SENTENCES must differ too,
  // because the plan's done-when for this feature is that every code maps to its own sentence.
  assert.equal(new Set(keys.map((k) => CATALOG[k])).size, codes.length,
    "two codes resolve to the same sentence, so the reader cannot tell them apart");
  assert.equal(ocrFailureKey("invalid_request"), "document.ocr.failed.request");
  assert.equal(ocrFailureKey("something_a_later_version_adds"), "document.ocr.failed.request");
});

test("a refused read shows the mapped sentence, not a stuck placeholder", async () => {
  const bridge = stubBridge({ pages: { ok: false, code: "store_unavailable" } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const err = findByTestId(node, "view-ocr-error");
  assert.equal(collectText(err), CATALOG["document.ocr.failed.store"]);
  assert.equal(err.getAttribute("role"), "alert");
  // Absence of the loading WORD is not absence of a placeholder. The container must hold exactly
  // one node, the error, and nothing left over from the load.
  const container = findByTestId(node, "view-ocr-result-container");
  assert.equal(container.children.length, 1, "the container must reach one unambiguous terminal state");
  assert.equal(container.children[0], err);
  assert.equal(allText(container).includes(CATALOG["document.ocr.loading"]), false,
    "the loading placeholder must be cleared on the failure path");
});

test("a TRANSPORT failure releases the latch, so reopening the section retries", async () => {
  let attempt = 0;
  const bridge = {
    pages: async () => { attempt += 1; if (attempt === 1) throw new Error("bridge went away"); return { ok: true, value: { missing: 0, pages: [page()] } }; },
    extract: async () => ({ ok: false, code: "helper_unavailable" }),
  };
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  assert.equal(collectText(findByTestId(node, "view-ocr-error")), CATALOG["document.ocr.loadFailed"]);
  await open(node);
  assert.equal(attempt, 2, "a failed load must be retryable by reopening; a stuck latch is unrecoverable");
  assert.equal(findByTestId(node, "view-ocr-page-text").textContent, page().text);
});

// ---------------------------------------------------------------------------
// Reading a document
// ---------------------------------------------------------------------------

test("the read control extracts THIS document, reports counts that account for every page, then shows what was stored", async () => {
  let read = false;
  // The stub REFUSES any other identity. A bridge that ignored its arguments would let an
  // implementation extract the wrong document and still satisfy every assertion below.
  const requireIdentity = (m, d) => {
    if (m !== MATTER || d !== DOCUMENT) throw new Error(`wrong identity: ${m}/${d}`);
  };
  const bridge = {
    pages: async (m, d) => { requireIdentity(m, d); return read
      ? { ok: true, value: { missing: 1, pages: [page({ outcome: "ocr", text: "第一页" })] } }
      : { ok: true, value: { pages: [], missing: null } }; },
    extract: async (m, d) => { requireIdentity(m, d); read = true;
      return { ok: true, value: { pageCount: 3, fromTextLayer: 1, recognised: 1, failed: 0, missing: 1, needsReview: 3 } }; },
  };
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  assert.equal(collectText(findByTestId(node, "view-ocr-none")), CATALOG["document.ocr.none"]);

  findByTestId(node, "view-ocr-read").dispatchEvent({ type: "click" });
  await flush();

  const status = findByTestId(node, "view-ocr-status");
  // Every page is accounted for: 1 + 1 + 0 + 1 = 3. A breakdown that silently summed to 2 would let
  // a document look fully read when a page of it was never reached.
  assert.equal(collectText(status),
    "共 3 页：文本层 1 页，机器识别 1 页，未能读取 0 页，没有结果 1 页。其中 3 页需要您对照原件核对。");
  assert.equal(status.getAttribute("role"), "status");
  // needsReview is the WHOLE document, so the sentence must never shrink below the page count.
  assert.ok(collectText(status).includes("3 页需要您对照原件核对"));
  assert.equal(findByTestId(node, "view-ocr-page-text").textContent, "第一页");
  assert.equal(collectText(findByTestId(node, "view-ocr-read")), CATALOG["document.ocr.readAgainButton"]);
});

test("a refused extraction is reported and the control is usable again", async () => {
  const bridge = stubBridge({ extract: { ok: false, code: "unsupported_document" } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const btn = findByTestId(node, "view-ocr-read");
  btn.dispatchEvent({ type: "click" });
  await flush();
  const status = findByTestId(node, "view-ocr-status");
  assert.equal(collectText(status), CATALOG["document.ocr.failed.unsupported"]);
  assert.equal(status.getAttribute("role"), "alert");
  assert.equal(btn.disabled, false, "a refusal must leave the control usable, or the owner cannot retry");
  // The attribute is not the latch. An implementation that re-enables the button while leaving its
  // internal flag set looks recovered and answers no further click, so click again and prove it.
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(bridge.calls.extract, 2, "a retry after a refusal must actually reach the bridge");
});

test("a THROWN extraction is reported and the control is usable again", async () => {
  let attempts = 0;
  const bridge = {
    pages: async () => ({ ok: true, value: { pages: [], missing: null } }),
    extract: async () => { attempts += 1; throw new Error("gone"); },
  };
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const btn = findByTestId(node, "view-ocr-read");
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(collectText(findByTestId(node, "view-ocr-status")), CATALOG["document.ocr.failed.request"]);
  assert.equal(btn.disabled, false);
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(attempts, 2, "a retry after a thrown extraction must actually reach the bridge");
});

test("a second click cannot start a second extraction while one is running", async () => {
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const bridge = {
    pages: async () => ({ ok: true, value: { pages: [], missing: null } }),
    extract: async () => { started += 1; await gate; return { ok: true, value: { pageCount: 1, fromTextLayer: 1, recognised: 0, failed: 0, missing: 0, needsReview: 1 } }; },
  };
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const btn = findByTestId(node, "view-ocr-read");
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(btn.disabled, true, "the control must be disabled while the helper is working");
  btn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(started, 1, "a second click must not queue a second extraction over the same pages");
  release();
  await flush();
  assert.equal(btn.disabled, false);
});

test("an OLDER read cannot overwrite a NEWER one — stale text under a fresh headline is the worst outcome", async () => {
  // Two reads in flight: the one from opening the section, and the one that follows extraction.
  // The first is made to resolve LAST, carrying the pre-extraction snapshot. It must not win.
  let releaseFirst;
  const firstArrives = new Promise((r) => { releaseFirst = r; });
  let call = 0;
  const bridge = {
    pages: async () => {
      call += 1;
      if (call === 1) { await firstArrives; return { ok: true, value: { pages: [], missing: null } }; }
      return { ok: true, value: { missing: 0, pages: [page({ outcome: "ocr", text: "识别之后的新文字" })] } };
    },
    extract: async () => ({ ok: true, value: { pageCount: 1, fromTextLayer: 0, recognised: 1, failed: 0, missing: 0, needsReview: 1 } }),
  };
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);                       // read 1 starts and blocks
  findByTestId(node, "view-ocr-read").dispatchEvent({ type: "click" });
  await flush();                          // extraction finishes, read 2 runs and draws
  assert.equal(findByTestId(node, "view-ocr-page-text").textContent, "识别之后的新文字");

  releaseFirst();                         // now the OLD read comes back
  await flush();
  assert.equal(findByTestId(node, "view-ocr-page-text")?.textContent, "识别之后的新文字",
    "the older snapshot overwrote the newer one; the reader would see pre-extraction text under post-extraction counts");
  assert.equal(findByTestId(node, "view-ocr-none"), null, "the older read must not restore the empty state either");
});

test("an OLDER read that FAILS cannot replace a newer success with an error", async () => {
  let releaseFirst;
  const firstArrives = new Promise((r) => { releaseFirst = r; });
  let call = 0;
  const bridge = {
    pages: async () => {
      call += 1;
      if (call === 1) { await firstArrives; throw new Error("the slow one died"); }
      return { ok: true, value: { missing: 0, pages: [page({ text: "新的一页" })] } };
    },
    extract: async () => ({ ok: true, value: { pageCount: 1, fromTextLayer: 1, recognised: 0, failed: 0, missing: 0, needsReview: 1 } }),
  };
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  findByTestId(node, "view-ocr-read").dispatchEvent({ type: "click" });
  await flush();
  releaseFirst();
  await flush();
  assert.equal(findByTestId(node, "view-ocr-error"), null, "a dead older request must not report over a live newer result");
  assert.equal(findByTestId(node, "view-ocr-page-text").textContent, "新的一页");
});
