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

/**
 * A stored page as main now sends it: lines, each carrying its own verdict.
 *
 * `control` here is a convenience for the tests — it sets the verdict on EVERY line of the page,
 * which is what a page-shaped fixture used to mean. A test that needs lines to differ passes
 * `lines` directly.
 */
function page(overrides = {}) {
  const { control = "unchecked", ...rest } = {
    page: 1,
    pageCount: 1,
    outcome: "text_layer",
    text: "被告应于本判决生效之日起十日内支付",
    failureCode: null,
    ...overrides,
  };
  if (rest.lines !== undefined) return rest;
  const texts = rest.outcome === "failed"
    ? []
    : String(rest.text).split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  return { ...rest, lines: texts.map((text) => ({ text, control })) };
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
    const nos = within(c, "view-ocr-page-no");
    assert.equal(nos.length, 1, `page ${i + 1} must carry exactly one page number`);
    assert.equal(collectText(nos[0]), head);
    const acquisition = within(c, "view-ocr-page-outcome");
    assert.equal(acquisition.length, 1, `page ${i + 1} must carry exactly one acquisition line`);
    assert.equal(collectText(acquisition[0]), `${outcome} · ${control}`,
      `page ${i + 1} must state its own outcome and its own control, not another page's`);
    // THE APPROVED DESIGN, asserted directly: disagreement is marked and nothing else is. A page
    // whose engines AGREED must look exactly like one nothing has compared — a tick there would be
    // an endorsement the measurement does not support.
    const lines = within(c, "view-ocr-line");
    assert.ok(lines.length > 0, `page ${i + 1} rendered no lines`);
    // The EXACT class, not "does it contain --disagreed". Checking only for the disagreement class
    // let a mutant that added a tick to every agreed line pass: the rule is that agreed carries
    // NOTHING, and only an exact comparison says that.
    const expectClass = `view-ocr-line view-ocr-line--${["unchecked", "agreed", "disagreed"][i]}`;
    for (const n of lines) {
      assert.equal(n.getAttribute("class"), expectClass,
        `page ${i + 1} line carries a class the design does not allow`);
    }
    const marked = lines.filter((n) => (n.getAttribute("class") ?? "").includes("--disagreed"));
    const notes = within(c, "view-ocr-line-note");
    if (control === CATALOG["document.ocr.control.disagreed"]) {
      assert.equal(marked.length, lines.length, `page ${i + 1} disagreed, so every line must be marked`);
      assert.equal(notes.length, lines.length, `page ${i + 1} must say why on each marked line`);
    } else {
      assert.equal(marked.length, 0, `page ${i + 1} agreed or was unchecked, so NO line may be marked`);
      assert.equal(notes.length, 0, `page ${i + 1} must carry no disagreement note`);
    }
  });
});

test("the page text is rendered as TEXT — markup in a client's document is never markup here", async () => {
  const hostile = '<script>alert(1)</script> 甲方：<b>某某</b>';
  const bridge = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [page({ text: hostile })] } } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  // The line, character for character. StrictDoc throws on any innerHTML access, so reaching this
  // line at all proves the panel never touched it — the mock alone could not show that, because an
  // innerHTML assignment there is an inert expando and markup in Electron.
  const line = findByTestId(node, "view-ocr-line");
  assert.equal(line.textContent, hostile);
  // Now that fields are marked INSIDE the sentence, the text is spliced and reassembled rather
  // than set once. Every child must still be a bare text node: an element here would mean a
  // document's own characters had become part of the document tree.
  for (const child of line.children) {
    // A numeric mark is the ONE element this panel creates, and it holds text only. Anything else
    // would mean a document's own characters had become part of the tree.
    const isMark = child instanceof MockEl && child.getAttribute("data-test-id") === "view-ocr-num";
    assert.ok(child instanceof MockText || isMark,
      `a client's text became an element: <${child.tagName}> ${JSON.stringify(child.textContent)}`);
    if (isMark) for (const g of child.children) assert.ok(g instanceof MockText, "a mark may only contain text");
  }
});

test("a marked numeric field is a SPAN around text, never markup, even when the document fights back", async () => {
  // A hostile string that also contains a real numeric field, so the splice path runs.
  const hostile = '<img src=x onerror=alert(1)> 金额 12,345.67元 </p><script>bad()</script>';
  const bridge = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [page({ text: hostile })] } } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const line = findByTestId(node, "view-ocr-line");
  assert.equal(line.textContent, hostile, "splicing must reassemble the line exactly");
  const marks = findAllByTestId(node, "view-ocr-num");
  // "1" comes from alert(1): a lone digit is marked now, deliberately, since length cannot tell an
  // enumeration marker from an amount.
  assert.deepEqual(marks.map((m) => m.textContent), ["1", "12,345.67元"]);
  for (const m of marks) {
    assert.equal(m.tagName, "SPAN");
    for (const child of m.children) assert.ok(child instanceof MockText, "a mark may only contain text");
  }
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

test("a MIXED-notation amount is marked whole, not split at the character the two patterns share", () => {
  // 「5亿叁仟万元整」 is a digit run 「5亿」 and a capital-numeral run 「亿叁仟万元整」 overlapping on
  // the 亿, with neither containing the other. Dropping one of them marked only 「5亿」 and left the
  // rest of the award unmarked — found by mutation testing, and the worst possible field to
  // half-mark. Overlapping numeric material is one field.
  assert.deepEqual(numericFields("赔偿5亿叁仟万元整"), ["5亿叁仟万元整"]);
  assert.deepEqual(numericFields("合计3万贰仟元"), ["3万贰仟元"]);
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

  // Marked WHERE THEY SIT, not listed underneath: a reader checking an amount wants it underlined
  // in the sentence, not repeated in a footnote they have to map back by hand.
  assert.deepEqual(within(p1, "view-ocr-num").map((n) => n.textContent), ["12,345.67元"]);
  assert.deepEqual(within(p2, "view-ocr-num").map((n) => n.textContent), [],
    "a page without numbers carries no marks");
  assert.deepEqual(within(p3, "view-ocr-num").map((n) => n.textContent),
    ["（2024）京0105民初12345号", "二〇二四年九月十二日"]);
  // Every mark says why it is there, one hover away and without shouting.
  for (const m of within(p1, "view-ocr-num")) {
    assert.equal(m.getAttribute("title"), CATALOG["document.ocr.numberHint"]);
  }
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

test("a page is rendered LINE BY LINE, in order, with blank lines dropped", async () => {
  // The helper found the lines and the store joined them with newlines; splitting them back apart
  // is reading that back, not guessing. Without this, a renderer that printed the whole page as one
  // paragraph passed every other test here — the fixtures elsewhere are one line long.
  const text = "第一行：本院查明。\n\n第二行：金额 12,345.67元。\n   \n第三行：如不服本判决。";
  const bridge = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [page({ text })] } } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);

  const lines = findAllByTestId(node, "view-ocr-line");
  assert.equal(lines.length, 3, "three lines of text, and the two blank ones are not rows");
  assert.deepEqual(lines.map((l) => l.textContent), [
    "第一行：本院查明。",
    "第二行：金额 12,345.67元。",
    "第三行：如不服本判决。",
  ], "the lines must come back in the recogniser's order, unaltered");
  // The mark belongs to the line it is in, not to the page.
  assert.deepEqual(within(lines[1], "view-ocr-num").map((n) => n.textContent), ["12,345.67元"]);
  assert.deepEqual(within(lines[0], "view-ocr-num"), []);
});


test("ONE disagreeing line in a page of agreeing ones marks THAT line, and marks the page", async () => {
  // The whole reason the verdict is line-level. A page-level control would have to call this page
  // either wholly agreed or wholly disputed, and both are false. Nothing before this test had a
  // page whose lines differ from each other, so a renderer that painted every line with the PAGE's
  // verdict — or a summary that needed EVERY line to disagree — passed.
  const mixed = page({
    outcome: "ocr",
    lines: [
      { text: "本院经审理查明，双方均已履行。", control: "agreed" },
      { text: "被告应支付违约金 12,345.67元。", control: "disagreed" },
      { text: "如不服本判决，可提起上诉。", control: "agreed" },
    ],
  });
  const bridge = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [mixed] } } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);

  const lines = findAllByTestId(node, "view-ocr-line");
  assert.deepEqual(lines.map((l) => l.getAttribute("class")), [
    "view-ocr-line view-ocr-line--agreed",
    "view-ocr-line view-ocr-line--disagreed",
    "view-ocr-line view-ocr-line--agreed",
  ], "each line wears its OWN verdict, not the page's");
  assert.equal(findAllByTestId(node, "view-ocr-line-note").length, 1, "only the disagreeing line explains itself");

  // And the page's summary: one bad line is enough to make the page worth opening.
  assert.ok(collectText(findByTestId(node, "view-ocr-page-outcome")).includes(CATALOG["document.ocr.control.disagreed"]),
    "a page with any disagreeing line must not be summarised as agreed or unchecked");
});

test("a page is summarised as AGREED only when every line on it was compared", async () => {
  const partly = page({ outcome: "ocr", lines: [
    { text: "已比对的一行。", control: "agreed" },
    { text: "没有比对过的一行。", control: "unchecked" },
  ] });
  const bridge = stubBridge({ pages: { ok: true, value: { missing: 0, pages: [partly] } } });
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  const summary = collectText(findByTestId(node, "view-ocr-page-outcome"));
  assert.ok(summary.includes(CATALOG["document.ocr.control.unchecked"]),
    `half a page compared is not a compared page; got ${JSON.stringify(summary)}`);
  assert.equal(summary.includes(CATALOG["document.ocr.control.agreed"]), false);
});

test("a single-digit field is marked: length cannot tell an enumeration marker from an amount", () => {
  // 「金额（万元）：5」 got no mark while 「…：15」 did, and a recognised table puts exactly that cell
  // on a line of its own. The rule this file states is that over-listing costs a glance and a missed
  // amount costs a filing, so the short field wins and the enumeration marker is the price.
  assert.deepEqual(numericFields("金额（万元）：5"), ["5"]);
  assert.deepEqual(numericFields("金额（万元）：15"), ["15"]);
  assert.deepEqual(numericFields("1、原告身份证明；2、授权委托书"), ["1", "2"],
    "the enumeration marker is listed too; that is the accepted price of not missing a lone amount");
});

test("零, 两 and 拾 name quantities, so the amounts written with them are marked", () => {
  // They were classed as bare units, so the amount pattern matched these and the filter then threw
  // them away — three perfectly ordinary ways of writing a sum, left unmarked.
  assert.deepEqual(numericFields("人民币零元整"), ["零元整"]);
  assert.deepEqual(numericFields("人民币两万元"), ["两万元"]);
  assert.deepEqual(numericFields("人民币拾万元整"), ["拾万元整"]);
  // A run of pure UNITS still carries no value and is still dropped.
  assert.deepEqual(numericFields("金额以万元计"), []);
});

test("a read that fails AFTER an extraction leaves the section retryable", async () => {
  // The generation guard suppressed the stale read correctly, but the newer read's failure was
  // ignored, so the once-only latch stayed shut and reopening the disclosure never tried again.
  let reads = 0;
  const bridge = {
    pages: async () => {
      reads += 1;
      if (reads === 1) return { ok: true, value: { pages: [], missing: null } };
      if (reads === 2) throw new Error("the read after extraction died");
      return { ok: true, value: { missing: 0, pages: [page({ text: "终于读到了" })] } };
    },
    extract: async () => ({ ok: true, value: { pageCount: 1, fromTextLayer: 1, recognised: 0, failed: 0, missing: 0, needsReview: 1 } }),
  };
  const node = renderOcrDisclosure(new StrictDoc(), MATTER, DOCUMENT, bridge);
  await open(node);
  findByTestId(node, "view-ocr-read").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(collectText(findByTestId(node, "view-ocr-error")), CATALOG["document.ocr.loadFailed"]);

  await open(node);
  assert.equal(reads, 3, "reopening after a failed post-extraction read must try again");
  assert.equal(findByTestId(node, "view-ocr-page-text").textContent, "终于读到了");
});
