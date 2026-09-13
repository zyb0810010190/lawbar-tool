// Read-only Documents section for the matter view (B2 documents vertical,
// WI-2a). Lazily lists the matter's persisted documents and lets the user
// expand one to view its metadata via the get channel. NO registration, file
// picker, hashing, storage copy, or file opening — display only. The renderer
// never imports the service; only human-rendered fields are read, and main is
// the authoritative validator.

import type { CaseBoxApi } from "../api.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime, hashTruncate, ulidShort } from "../format.js";
import { t } from "../i18n/t.js";
import { errorMessage } from "../i18n/errorMessage.js";
import { renderOcrDisclosure, type OcrBridge } from "./viewMatterOcr.js";

// Known doc_type / document status enum values whose zh-CN labels live in the
// catalog (docs/contracts/case-box-contract/schemas/case-box-document.schema.json).
// The stored/wire VALUE stays English; only the visible LABEL is translated. An
// unrecognized value falls back to its raw code so a future enum extension can
// never make t() throw on a missing key at render time.
const DOC_TYPE_VALUES: ReadonlySet<string> = new Set([
  "pleading",
  "contract",
  "correspondence",
  "transcript",
  "exhibit",
  "other",
]);
const DOC_STATUS_VALUES: ReadonlySet<string> = new Set([
  "registered",
  "ocr_pending",
  "ocr_complete",
  "ocr_failed",
  "triaged",
  "tagged",
  "reviewed",
]);

function docTypeLabel(value: string): string {
  return DOC_TYPE_VALUES.has(value)
    ? t(`document.docType.${value}` as Parameters<typeof t>[0])
    : value;
}

function docStatusLabel(value: string): string {
  return DOC_STATUS_VALUES.has(value)
    ? t(`document.status.${value}` as Parameters<typeof t>[0])
    : value;
}

// Minimal structural shapes (display-only subset of CaseBoxDocument).
interface DocumentRow {
  readonly id: string;
  readonly filename: string;
  readonly doc_type: string;
  readonly status: string;
  readonly received_at: string;
}

interface DocumentDetail extends DocumentRow {
  readonly content_hash?: string;
  readonly storage_uri?: string;
  readonly page_count?: number;
  readonly language?: string;
  readonly mime_type?: string;
  readonly byte_size?: number;
}

interface ListDocumentsPage {
  readonly rows: ReadonlyArray<DocumentRow>;
  readonly next_cursor: string | null;
}

const DOC_TYPES = [
  "pleading",
  "contract",
  "correspondence",
  "transcript",
  "exhibit",
  "other",
] as const;

export function renderDocumentsDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  // Optional and last, so every existing caller is untouched: production resolves the preload
  // bridge; tests inject a stub. `null` renders no open control at all.
  openOriginal: OpenOriginalFn | null = defaultOpenOriginal(),
  // Same contract as openOriginal, one step looser: `undefined` means "let the OCR module resolve
  // the preload bridge itself", so no caller here has to know how that bridge is found.
  ocr?: OcrBridge | null,
): HTMLElement {
  // The list container is owned by loadDocuments (cleared + refilled), so a
  // successful registration can refresh it in place.
  const listContainer = el(
    "div",
    { class: "view-docs-list-container", "data-test-id": "view-docs-list-container" },
    [],
    doc,
  );
  const refresh = (): Promise<void> => loadDocuments(listContainer, doc, api, matterId, openOriginal, ocr);
  const addControl = renderAddControl(doc, api, matterId, refresh);

  const body = el(
    "div",
    { class: "view-docs-body", "data-test-id": "view-docs-body" },
    [addControl, listContainer],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-docs-summary" },
    [t("document.disclosure.summary")],
    doc,
  );
  const details = el(
    "details",
    { class: "view-docs-details", "data-test-id": "view-docs-details" },
    [summary, body],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void loadDocuments(listContainer, doc, api, matterId, openOriginal, ocr);
  });
  return details;
}

// "Add document" control: pick a doc type, then register a local file. The file
// itself is chosen by the MAIN process (the renderer never supplies a path);
// on success the list refreshes. Read-only display elsewhere — this is the only
// write affordance, and it never opens a file.
function renderAddControl(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const select = el(
    "select",
    { class: "view-docs-add-type", "data-test-id": "view-docs-add-type", "aria-label": t("document.add.typeAria") },
    DOC_TYPES.map((value) => el("option", { value }, [docTypeLabel(value)], doc)),
    doc,
  );
  const status = el(
    "span",
    { class: "view-docs-add-status", "data-test-id": "view-docs-add-status" },
    [],
    doc,
  );
  const btn = el(
    "button",
    { type: "button", class: "button button--primary view-docs-add-btn", "data-test-id": "view-docs-add", "aria-label": t("document.add.button") },
    [t("document.add.button")],
    doc,
  );
  btn.addEventListener("click", () => {
    void (async () => {
      const docType =
        ((select as unknown as { value?: string }).value as (typeof DOC_TYPES)[number]) || "other";
      btn.setAttribute("disabled", "true");
      status.removeAttribute("role");
      setText(status, t("document.add.working"));
      // An ACTION path: the button was disabled above and only re-enabled after the await, so a
      // rejection left it disabled permanently — the owner could not retry without navigating away.
      // A different failure from the load paths, the same cause.
      let env: Awaited<ReturnType<typeof api.registerDocument>>;
      try {
        env = await api.registerDocument({ matterId, doc_type: docType });
      } catch {
        btn.removeAttribute("disabled");
        status.setAttribute("role", "alert");
        setText(status, t("document.add.failed"));
        return;
      }
      btn.removeAttribute("disabled");
      if (!env.ok) {
        status.setAttribute("role", "alert");
        status.setAttribute("data-test-id", "view-docs-add-error");
        setText(status, errorMessage(env.error));
        return;
      }
      if (env.value === null) {
        // User cancelled the file chooser — nothing registered.
        setText(status, t("document.add.cancelled"));
        return;
      }
      setText(status, t("document.add.added"));
      await refresh();
    })();
  });
  return el(
    "div",
    { class: "view-docs-add", "data-test-id": "view-docs-add-control" },
    [select, " ", btn, " ", status],
    doc,
  );
}

function metaField(doc: Document, label: string, value: string): HTMLElement {
  return el(
    "div",
    { class: "view-docs-detail-field" },
    [
      el("span", { class: "view-docs-detail-label" }, [`${label}: `], doc),
      el("span", {}, [value], doc),
    ],
    doc,
  );
}

function renderDocumentDetail(doc: Document, d: DocumentDetail): HTMLElement {
  const fields: HTMLElement[] = [];
  if (d.content_hash !== undefined && d.content_hash.length > 0) {
    fields.push(
      el(
        "div",
        { class: "view-docs-detail-field" },
        [
          el("span", { class: "view-docs-detail-label" }, [`${t("document.detail.contentHash")}: `], doc),
          el("code", { "data-test-id": "view-docs-detail-hash" }, [hashTruncate(d.content_hash)], doc),
        ],
        doc,
      ),
    );
  }
  if (d.storage_uri !== undefined && d.storage_uri.length > 0) {
    fields.push(metaField(doc, t("document.detail.storage"), d.storage_uri));
  }
  if (d.page_count !== undefined) fields.push(metaField(doc, t("document.detail.pages"), String(d.page_count)));
  if (d.language !== undefined && d.language.length > 0) fields.push(metaField(doc, t("document.detail.language"), d.language));
  if (d.mime_type !== undefined && d.mime_type.length > 0) fields.push(metaField(doc, t("document.detail.mime"), d.mime_type));
  if (d.byte_size !== undefined) fields.push(metaField(doc, t("document.detail.bytes"), String(d.byte_size)));
  return el(
    "div",
    { class: "view-docs-detail", "data-test-id": "view-docs-detail" },
    fields,
    doc,
  );
}

// Opening a registered original (product plan R1, WI-6).
//
// The renderer sends an IDENTITY — matter id and document id — and nothing else. The main process
// resolves the path, verifies the file, and hands a READ-ONLY COPY to the OS. What comes back is a
// code, never a message and never a path: a path can carry a client's name, and this status line
// is exactly the kind of thing that gets photographed into a bug report.
type OpenOriginalResult = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly reason?: string };
export type OpenOriginalFn = (matterId: string, documentId: string) => Promise<OpenOriginalResult>;

/**
 * The preload bridge, or null when there is none — in which case the control is not rendered
 * at all. A button that promises to open a document and cannot is the readiness-window defect
 * (#283) in a new place. The `typeof window` guard is not test scaffolding: this module is loaded
 * where no window exists, and an unguarded reference throws during render.
 */
function defaultOpenOriginal(): OpenOriginalFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    lawbar?: { documentOpen?: { open: (req: { matterId: string; documentId: string }) => Promise<OpenOriginalResult> } };
  };
  const bridge = w.lawbar?.documentOpen;
  return bridge === undefined ? null : (matterId, documentId) => bridge.open({ matterId, documentId });
}

/** Every code main can send, mapped to copy. Unknown codes degrade to the request-failed sentence. */
function openFailureKey(code: string): Parameters<typeof t>[0] {
  switch (code) {
    case "unknown_document": return "document.open.failed.unknown";
    case "document_missing": return "document.open.failed.missing";
    case "document_altered": return "document.open.failed.altered";
    case "document_unverifiable": return "document.open.failed.unverifiable";
    case "open_failed": return "document.open.failed.open";
    default: return "document.open.failed.request"; // invalid_request, and anything a later version adds
  }
}

function renderOpenControl(
  doc: Document,
  matterId: string,
  documentId: string,
  openOriginal: OpenOriginalFn,
): HTMLElement {
  const status = el("p", { class: "view-docs-open-status", "data-test-id": "view-docs-open-status" }, [], doc);
  const btn = el(
    "button",
    { type: "button", class: "button view-docs-open-btn", "data-test-id": "view-docs-open" },
    [t("document.open.button")],
    doc,
  ) as HTMLButtonElement;
  btn.addEventListener("click", () => {
    btn.disabled = true; // a second click mid-verification would queue a second open
    status.removeAttribute("role");
    setText(status, t("document.open.working"));
    void (async () => {
      try {
        const r = await openOriginal(matterId, documentId);
        if (r.ok) {
          status.setAttribute("role", "status");
          setText(status, t("document.open.done"));
          return;
        }
        status.setAttribute("role", "alert");
        setText(status, t(openFailureKey(r.code)));
      } catch {
        // A rejection is a transport failure; the bridge never throws on a refusal.
        status.setAttribute("role", "alert");
        setText(status, t("document.open.failed.open"));
      } finally {
        btn.disabled = false;
      }
    })();
  });
  return el("div", { class: "view-docs-open", "data-test-id": "view-docs-open-control" }, [btn, status], doc);
}

function renderDocumentRow(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  row: DocumentRow,
  openOriginal: OpenOriginalFn | null,
  ocr: OcrBridge | null | undefined,
): HTMLElement {
  const summary = el(
    "summary",
    { "data-test-id": "view-docs-item-summary" },
    [
      el("span", { class: "view-docs-filename", "data-test-id": "view-docs-filename" }, [row.filename], doc),
      " ",
      el("span", { class: "view-docs-type" }, [`${docTypeLabel(row.doc_type)} · ${docStatusLabel(row.status)}`], doc),
      " ",
      el("span", { class: "view-docs-received" }, [formatLocalDateTime(row.received_at)], doc),
    ],
    doc,
  );
  const detailBody = el("div", { class: "view-docs-item-body" }, [], doc);
  const details = el(
    "details",
    { class: "view-docs-item", "data-test-id": "view-docs-item" },
    [summary, detailBody],
    doc,
  );
  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void (async () => {
      setText(detailBody, t("document.detail.loading"));
      // A LOAD path, not an action: the placeholder is set before the await and only cleared after
      // it, so a rejection left this disclosure showing "loading" forever. Same shape as the five
      // load paths already fixed, and it is invoked inside a `void (async () => ...)` which swallows
      // the rejection whole.
      let env: Awaited<ReturnType<typeof api.getDocument>>;
      try {
        env = await api.getDocument({ matterId, documentId: row.id });
      } catch {
        setText(detailBody, "");
        detailBody.appendChild(
          el("p", { role: "alert", "data-test-id": "view-docs-detail-error" },
             [t("document.detail.failed")], doc),
        );
        return;
      }
      setText(detailBody, "");
      if (!env.ok) {
        detailBody.appendChild(
          el("p", { role: "alert", "data-test-id": "view-docs-detail-error" }, [errorMessage(env.error)], doc),
        );
        return;
      }
      if (env.value === null) {
        detailBody.appendChild(
          el("p", { "data-test-id": "view-docs-detail-empty" }, [t("document.detail.notFound")], doc),
        );
        return;
      }
      detailBody.appendChild(renderDocumentDetail(doc, env.value as DocumentDetail));
      // The open control exists only once the detail has loaded, and only when a bridge exists.
      if (openOriginal !== null) {
        detailBody.appendChild(renderOpenControl(doc, matterId, row.id, openOriginal));
      }
      // The recognised text sits BESIDE the control that opens the original, not on a screen of
      // its own. Every sentence this panel shows has to be checked against the page it came from,
      // and a check that needs navigation is a check that does not happen.
      const ocrSection = renderOcrDisclosure(doc, matterId, row.id, ocr);
      if (ocrSection !== null) detailBody.appendChild(ocrSection);
    })();
  });
  return el("li", { class: "view-docs-item-li" }, [details], doc);
}

async function loadDocuments(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  openOriginal: OpenOriginalFn | null,
  ocr: OcrBridge | null | undefined,
): Promise<void> {
  // Clear any prior render so this can be called again to refresh after a
  // successful registration.
  setText(parent, "");
  const list = el(
    "ul",
    { class: "view-docs-list", "data-test-id": "view-docs-list" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-docs-loading" }, [t("document.list.loading")], doc);
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;
  let total = 0;
  let pageLoading = false; // re-entrancy guard: a fast double-click on "Show more" must not fetch/append a page twice
  let pageError: HTMLElement | null = null; // cleared on a successful retry so the UI cannot contradict itself

  async function loadPage(): Promise<void> {
    if (pageLoading) return; // a page fetch is already in flight — drop the concurrent call
    pageLoading = true;
    let env: Awaited<ReturnType<typeof api.listDocuments>>;
    try {
      env = await api.listDocuments({
        matterId,
        ...(cursor !== null ? { cursor } : {}),
      });
    } catch {
      // The finally below resets the re-entrancy flag but does NOT catch, so a transport rejection
      // propagated out of a `void`ed caller and left the loading placeholder on screen forever. The
      // same partial guard existed on the audit screen and in viewMatterDocketProposals — a `finally`
      // that tidies state reads as handled, which is why all three survived review.
      pageLoading = false;
      loading.remove();
      pageError?.remove();
      pageError = el(
        "p", { role: "alert", "data-test-id": "view-docs-error" }, [t("documents.load.failed")], doc,
      );
      parent.appendChild(pageError);
      return;
    } finally {
      pageLoading = false;
    }
    loading.remove();
    pageError?.remove();
    pageError = null;
    if (moreBtn !== null) {
      moreBtn.remove();
      moreBtn = null;
    }
    if (!env.ok) {
      parent.appendChild(
        el("p", { role: "alert", "data-test-id": "view-docs-error" }, [errorMessage(env.error)], doc),
      );
      return;
    }
    const page = env.value as ListDocumentsPage;
    for (const row of page.rows) {
      list.appendChild(renderDocumentRow(doc, api, matterId, row, openOriginal, ocr));
      total += 1;
    }
    if (total === 0) {
      parent.appendChild(
        el(
          "div",
          { "data-test-id": "view-docs-empty" },
          [
            el("p", {}, [t("document.list.empty")], doc),
            // Next-step line, matching the viewMatterLinks exemplar. Added only because this screen
            // HAS an add control ("view-docs-add") — the hint names a button that is really there.
            el("p", { class: "empty-hint" }, [t("document.list.emptyHint")], doc),
          ],
          doc,
        ),
      );
      return;
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      const btn = el(
        "button",
        { type: "button", class: "button button--secondary view-docs-more", "data-test-id": "view-docs-more" },
        [t("common.loadMore")],
        doc,
      );
      btn.addEventListener("click", () => {
        void loadPage();
      });
      moreBtn = btn;
      parent.appendChild(btn);
    }
  }

  await loadPage();
}
