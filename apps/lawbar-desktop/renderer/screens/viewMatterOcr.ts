// The OCR disclosure on a document row (product plan R3, WI-12).
//
// WHAT THIS SCREEN IS ALLOWED TO CLAIM. The measurement on the owner's own scans is the reason
// this file is written the way it is. Folded character error rate 0.190 on real scanned lines,
// but 0.31 on lines of six characters or fewer — and short lines are where case numbers, dates
// and amounts live. Error is per-document, not per-engine: 11 of 20 documents came in under 0.05
// and 3 above 0.4. Agreement between two different engines was validated blind, 15 of 15, and it
// still only PRIORITISES attention. Fifteen blind samples bound the failure rate near one in five,
// not at zero.
//
// So this panel is a finding aid, not a transcript of record:
//   • Nothing here is ever labelled verified, checked, or correct. The catalogue is tested for it.
//   • Every page says HOW its text was obtained — a file's own text layer, or machine recognition.
//   • Digit-bearing fields are pulled out and listed for the reader to check one by one, because
//     that is the class the machine is worst at and the class that ends up in a filing.
//   • The original stays one control away, in the same disclosure, so checking is a click.
//
// SEPARATE FILE, DELIBERATELY. renderer/i18n/ui-strings-allowlist.json pins literals by exact
// {file,line}; every screen section here is already its own module for that reason. A new section
// inside an existing file shifts those line numbers for no semantic reason.
//
// NO innerHTML. Page text is real document content and goes through text nodes only (dom.ts).

import { el, setText } from "../dom.js";
import { t } from "../i18n/t.js";

export type OcrOutcome = "text_layer" | "ocr" | "failed";
export type OcrControl = "unchecked" | "agreed" | "disagreed";

export interface OcrPageView {
  readonly page: number;
  readonly pageCount: number;
  readonly outcome: OcrOutcome;
  readonly text: string;
  readonly failureCode: string | null;
  readonly control: OcrControl;
}

export interface OcrExtractSummary {
  readonly pageCount: number;
  readonly fromTextLayer: number;
  readonly recognised: number;
  readonly failed: number;
  readonly missing: number;
  readonly needsReview: number;
}

export interface OcrPagesValue {
  readonly pages: readonly OcrPageView[];
  /** Null means completeness is unknown, which is not the same as zero missing pages. */
  readonly missing: number | null;
}

type OcrResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

export interface OcrBridge {
  pages(matterId: string, documentId: string): Promise<OcrResult<OcrPagesValue>>;
  extract(matterId: string, documentId: string): Promise<OcrResult<OcrExtractSummary>>;
}

/**
 * The preload bridge, or null when there is none — in which case no OCR section is rendered at all.
 * Offering to read a document and then being unable to is worse than not offering. The
 * `typeof window` guard is not test scaffolding: this module is imported where no window exists.
 */
function defaultOcrBridge(): OcrBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    lawbar?: {
      ocr?: {
        pages: (r: { matterId: string; documentId: string }) => Promise<unknown>;
        extract: (r: { matterId: string; documentId: string }) => Promise<unknown>;
      };
    };
  };
  const bridge = w.lawbar?.ocr;
  if (bridge === undefined) return null;
  return {
    pages: (matterId, documentId) => bridge.pages({ matterId, documentId }) as Promise<OcrResult<OcrPagesValue>>,
    extract: (matterId, documentId) => bridge.extract({ matterId, documentId }) as Promise<OcrResult<OcrExtractSummary>>,
  };
}

/** Every refusal main can send, mapped to copy. Unknown codes degrade to the request sentence. */
export function ocrFailureKey(code: string): Parameters<typeof t>[0] {
  switch (code) {
    case "unknown_document": return "document.ocr.failed.unknown";
    case "unsupported_document": return "document.ocr.failed.unsupported";
    case "helper_unavailable": return "document.ocr.failed.helper";
    case "store_unavailable": return "document.ocr.failed.store";
    case "extract_failed": return "document.ocr.failed.extract";
    default: return "document.ocr.failed.request"; // invalid_request, and anything a later version adds
  }
}

const OUTCOME_KEY: Readonly<Record<OcrOutcome, Parameters<typeof t>[0]>> = {
  text_layer: "document.ocr.outcome.text_layer",
  ocr: "document.ocr.outcome.ocr",
  failed: "document.ocr.outcome.unreadable",
};

const CONTROL_KEY: Readonly<Record<OcrControl, Parameters<typeof t>[0]>> = {
  unchecked: "document.ocr.control.unchecked",
  agreed: "document.ocr.control.agreed",
  disagreed: "document.ocr.control.disagreed",
};

/**
 * The fields on a page that carry a number, for the reader to check one by one.
 *
 * WHY MORE THAN A DIGIT RUN. Digits are not how a Chinese court document writes its most binding
 * numbers. A judgment dates itself 二〇二四年九月十二日 and awards 人民币壹拾万元整; both are pure
 * Chinese numerals and a digit-only scan sees nothing at all. A case number is written
 * （2024）京0105民初12345号, which a digit-only scan shreds into three fragments, none of which is
 * the thing the reader actually has to check. So there are four patterns, in order of how much
 * meaning they carry, and a containment rule that drops any match wholly inside a longer one — so
 * the case number is listed once, whole, instead of three times in pieces.
 *
 * It stays deliberately GENEROUS and deliberately dumb. Over-listing costs a glance; missing an
 * amount costs a filing. It makes no attempt to decide which numbers matter, because the tool
 * cannot know, and a wrong guess there would be a judgement it has not earned. An enumeration
 * marker like the 1 in 「1、原告身份证明」 is listed too; that is the price of the same rule.
 */
// Regex LITERALS, not strings fed to new RegExp: a CJK character class written as a string is
// indistinguishable, to the i18n drift scanner, from user-facing copy sitting outside the
// catalogue. It is also one less layer of backslash escaping to get wrong.
const FIELD_PATTERNS: readonly RegExp[] = [
  // A case number, whole: （2024）京0105民初12345号. The single most consequential short field
  // in a Chinese court document, and the one the machine is least reliable on.
  /[（(][0-9０-９〇零一二三四五六七八九十两]{2,6}[）)][^\s，。；、：:]{0,24}号/gu,
  // A date in Chinese numerals: 二〇二四年九月十二日.
  /[〇零一二三四五六七八九十两]{1,6}年[〇零一二三四五六七八九十两]{1,3}月[〇零一二三四五六七八九十两]{1,3}日/gu,
  // An amount in capital numerals, which is the binding form in a judgment: 人民币壹拾万元整.
  /[壹贰叁肆伍陆柒捌玖零拾佰仟万萬亿億圆元角分整两]{2,}/gu,
  // Everything else built out of digits, with the units that make a bare digit mean something
  // (条, 款, 项, 页, 元, 年月日) — otherwise 第1条 would be listed as "1".
  /[0-9０-９][0-9０-９.,，、:：\-–—/／年月日时分秒元万亿千百十％%号第条款项页（）()\[\]【】]*/gu,
];

/** A capital-numeral run carrying no capital digit is a bare unit like 「万元」, not an amount. */
const BARE_UNIT = /^[零拾佰仟万萬亿億圆元角分整两]+$/u;

/**
 * Trim what the run swallowed but the field does not own: a tail that begins with punctuation and
 * contains no digit at all ("00000000000，年" from 「电话00000000000，年利率」 — the example uses a
 * run that check-no-real-data cannot mistake for a real telephone number), then any trailing
 * punctuation or a dangling connector ("2026年第" from 「2026年第一季度」). A unit that directly
 * follows a digit — the 元 in 12,345.67元, the 款 in 52条第2款 — is part of the field and stays.
 */
const trimField = (raw: string): string =>
  raw
    .replace(/[.,，、:：\-–—/／（）()\[\]【】][^0-9０-９]*$/u, "")
    .replace(/[.,，、:：\-–—/／第（）()\[\]【】]+$/u, "");

export function numericFields(text: string): readonly string[] {
  const hits: { readonly text: string; readonly start: number; readonly end: number }[] = [];
  for (const re of FIELD_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const field = trimField(m[0]);
      // A lone digit with nothing attached is an enumeration marker, not a field: the 1 in
      // 「1、原告身份证明」 tells the reader nothing to check. Anything with a unit survives, so
      // 5条 and 5元 are kept.
      if (field.length < 2) continue;
      // The capital-amount pattern would otherwise match bare units like 「万元」. An amount has to
      // carry at least one capital digit to be an amount.
      if (BARE_UNIT.test(field)) continue;
      hits.push({ text: field, start: m.index ?? 0, end: (m.index ?? 0) + field.length });
    }
  }
  // Containment by POSITION, not by substring: a field is dropped only when this very occurrence
  // sits inside a longer one. Matching on substrings would delete a real standalone "12" merely
  // because "2012年" appears elsewhere on the page.
  const kept = hits.filter((h, i) => !hits.some((g, j) =>
    j !== i && g.start <= h.start && g.end >= h.end && g.end - g.start > h.end - h.start));
  const seen = new Set<string>();
  return kept
    .sort((a, b) => a.start - b.start)
    .filter((h) => (seen.has(h.text) ? false : (seen.add(h.text), true)))
    .map((h) => h.text);
}

function renderPage(doc: Document, p: OcrPageView): HTMLElement {
  const parts: HTMLElement[] = [
    el("p", { class: "view-ocr-page-head", "data-test-id": "view-ocr-page-head" },
      [t("document.ocr.page", { page: p.page, pageCount: p.pageCount })], doc),
    el("p", { class: "view-ocr-page-outcome", "data-test-id": "view-ocr-page-outcome" },
      [t("document.ocr.outcomeLine", { outcome: t(OUTCOME_KEY[p.outcome]), control: t(CONTROL_KEY[p.control]) })], doc),
  ];
  if (p.outcome === "failed") {
    parts.push(el("p", { role: "alert", "data-test-id": "view-ocr-page-failure" },
      [t("document.ocr.failureCode", { code: p.failureCode ?? "" })], doc));
  } else if (p.text.length === 0) {
    parts.push(el("p", { "data-test-id": "view-ocr-page-empty" }, [t("document.ocr.pageEmpty")], doc));
  } else {
    // textContent, never markup: this is a client's document, and it may contain anything.
    const body = el("p", { class: "view-ocr-page-text", "data-test-id": "view-ocr-page-text" }, [], doc);
    setText(body, p.text);
    parts.push(body);
    const fields = numericFields(p.text);
    if (fields.length > 0) {
      parts.push(el("p", { class: "view-ocr-page-numbers", "data-test-id": "view-ocr-page-numbers" },
        [t("document.ocr.numbers", { fields: fields.join("、") })], doc));
    }
  }
  return el("li", { class: "view-ocr-page", "data-test-id": "view-ocr-page" }, parts, doc);
}

function renderPages(doc: Document, value: OcrPagesValue): HTMLElement {
  const kids: HTMLElement[] = [];
  if (value.missing === null) {
    kids.push(el("p", { "data-test-id": "view-ocr-missing" }, [t("document.ocr.missingUnknown")], doc));
  } else if (value.missing > 0) {
    kids.push(el("p", { role: "alert", "data-test-id": "view-ocr-missing" },
      [t("document.ocr.missing", { missing: value.missing })], doc));
  }
  kids.push(el("ol", { class: "view-ocr-pages", "data-test-id": "view-ocr-pages" },
    value.pages.map((p) => renderPage(doc, p)), doc));
  return el("div", { class: "view-ocr-result" }, kids, doc);
}

/**
 * The OCR section for one document, or null when no bridge exists.
 *
 * Mounted inside the document row's own detail body, beside the control that opens the original,
 * so the text and the thing it must be checked against are never more than one click apart.
 */
export function renderOcrDisclosure(
  doc: Document,
  matterId: string,
  documentId: string,
  // Optional and last, so a caller that does not know about OCR is unaffected: production resolves
  // the preload bridge, tests inject a stub, null renders nothing.
  ocr: OcrBridge | null = defaultOcrBridge(),
): HTMLElement | null {
  if (ocr === null) return null;

  const result = el("div", { class: "view-ocr-result-container", "data-test-id": "view-ocr-result-container" }, [], doc);
  const status = el("p", { class: "view-ocr-status", "data-test-id": "view-ocr-status" }, [], doc);
  const readBtn = el("button",
    { type: "button", class: "button view-ocr-read", "data-test-id": "view-ocr-read" },
    [t("document.ocr.readButton")], doc) as HTMLButtonElement;

  /**
   * Draw whatever the store holds. Returns false when the load failed, so a latch can be released.
   *
   * GENERATION TOKEN, because two of these can be in flight at once: one from opening the section,
   * one from finishing an extraction. Without it the slower request wins the screen, and the slower
   * request is the OLDER one — the reader would be shown the pre-extraction snapshot underneath a
   * status line reporting the new counts. Stale text under a fresh headline is the worst of the
   * three possible outcomes, because nothing on screen says it is stale.
   */
  let generation = 0;
  const showStored = async (): Promise<boolean> => {
    const mine = ++generation;
    const stale = (): boolean => mine !== generation;
    setText(result, t("document.ocr.loading"));
    let r: OcrResult<OcrPagesValue>;
    try {
      r = await ocr.pages(matterId, documentId);
    } catch {
      if (stale()) return true;
      // A rejection is a transport failure; the bridge never throws on a refusal. The placeholder
      // is set before the await, so it MUST be cleared on every path or the section says
      // "loading" for ever — the bug class this repository has fixed in six sibling files.
      setText(result, "");
      result.appendChild(el("p", { role: "alert", "data-test-id": "view-ocr-error" },
        [t("document.ocr.loadFailed")], doc));
      return false;
    }
    // A newer read has already drawn, or is about to. Say nothing and touch nothing.
    if (stale()) return true;
    setText(result, "");
    if (!r.ok) {
      result.appendChild(el("p", { role: "alert", "data-test-id": "view-ocr-error" },
        [t(ocrFailureKey(r.code))], doc));
      return false;
    }
    if (r.value.pages.length === 0) {
      result.appendChild(el("p", { "data-test-id": "view-ocr-none" }, [t("document.ocr.none")], doc));
      setText(readBtn, t("document.ocr.readButton"));
      return true;
    }
    result.appendChild(renderPages(doc, r.value));
    setText(readBtn, t("document.ocr.readAgainButton"));
    return true;
  };

  // An explicit latch, not just `disabled`. A disabled button stops a USER's second click, which
  // is the case that matters in production — but it is the host that enforces that, and a guard
  // this panel cannot itself demonstrate is a guard nobody can test. The house style for the list
  // loaders here is the same: an explicit boolean, checked before the work starts.
  let running = false;
  readBtn.addEventListener("click", () => {
    if (running) return;
    running = true;
    readBtn.disabled = true;
    status.removeAttribute("role");
    setText(status, t("document.ocr.working"));
    void (async () => {
      try {
        const r = await ocr.extract(matterId, documentId);
        if (!r.ok) {
          status.setAttribute("role", "alert");
          setText(status, t(ocrFailureKey(r.code)));
          return;
        }
        const s = r.value;
        status.setAttribute("role", "status");
        setText(status, t("document.ocr.counts", {
          pageCount: s.pageCount,
          fromTextLayer: s.fromTextLayer,
          recognised: s.recognised,
          failed: s.failed,
          missing: s.missing,
          needsReview: s.needsReview,
        }));
        await showStored();
      } catch {
        status.setAttribute("role", "alert");
        setText(status, t("document.ocr.failed.request"));
      } finally {
        running = false;
        readBtn.disabled = false;
      }
    })();
  });

  const body = el("div", { class: "view-ocr-body", "data-test-id": "view-ocr-body" }, [
    // The caveat is above the text, unconditionally, and is not dismissible. It is the one thing
    // on this panel that must be read before anything below it is trusted.
    el("p", { class: "view-ocr-caveat", "data-test-id": "view-ocr-caveat" }, [t("document.ocr.caveat")], doc),
    readBtn,
    status,
    result,
  ], doc);
  const summary = el("summary", { "data-test-id": "view-ocr-summary" }, [t("document.ocr.summary")], doc);
  const details = el("details", { class: "view-ocr-details", "data-test-id": "view-ocr-details" },
    [summary, body], doc);

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    // Release the latch on failure, or reopening the section could never retry — the defect the
    // audit disclosure already fixed once.
    void showStored().then((ok) => { if (!ok) loaded = false; });
  });
  return details;
}
