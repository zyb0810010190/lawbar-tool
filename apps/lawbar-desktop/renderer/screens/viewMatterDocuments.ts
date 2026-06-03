// Read-only Documents section for the matter view (B2 documents vertical,
// WI-2a). Lazily lists the matter's persisted documents and lets the user
// expand one to view its metadata via the get channel. NO registration, file
// picker, hashing, storage copy, or file opening — display only. The renderer
// never imports the service; only human-rendered fields are read, and main is
// the authoritative validator.

import type { CaseBoxApi } from "../api.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime, hashTruncate, ulidShort } from "../format.js";

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

export function renderDocumentsDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): HTMLElement {
  const body = el(
    "div",
    { class: "view-docs-body", "data-test-id": "view-docs-body" },
    [],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-docs-summary" },
    ["Show documents"],
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
    void loadDocuments(body, doc, api, matterId);
  });
  return details;
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
          el("span", { class: "view-docs-detail-label" }, ["Content hash: "], doc),
          el("code", { "data-test-id": "view-docs-detail-hash" }, [hashTruncate(d.content_hash)], doc),
        ],
        doc,
      ),
    );
  }
  if (d.storage_uri !== undefined && d.storage_uri.length > 0) {
    fields.push(metaField(doc, "Storage", d.storage_uri));
  }
  if (d.page_count !== undefined) fields.push(metaField(doc, "Pages", String(d.page_count)));
  if (d.language !== undefined && d.language.length > 0) fields.push(metaField(doc, "Language", d.language));
  if (d.mime_type !== undefined && d.mime_type.length > 0) fields.push(metaField(doc, "MIME", d.mime_type));
  if (d.byte_size !== undefined) fields.push(metaField(doc, "Bytes", String(d.byte_size)));
  return el(
    "div",
    { class: "view-docs-detail", "data-test-id": "view-docs-detail" },
    fields,
    doc,
  );
}

function renderDocumentRow(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  row: DocumentRow,
): HTMLElement {
  const summary = el(
    "summary",
    { "data-test-id": "view-docs-item-summary" },
    [
      el("span", { class: "view-docs-filename", "data-test-id": "view-docs-filename" }, [row.filename], doc),
      " ",
      el("span", { class: "view-docs-type" }, [`${row.doc_type} · ${row.status}`], doc),
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
      setText(detailBody, "Loading details…");
      const env = await api.getDocument({ matterId, documentId: row.id });
      setText(detailBody, "");
      if (!env.ok) {
        detailBody.appendChild(
          el("p", { role: "alert", "data-test-id": "view-docs-detail-error" }, [env.error.message], doc),
        );
        return;
      }
      if (env.value === null) {
        detailBody.appendChild(
          el("p", { "data-test-id": "view-docs-detail-empty" }, ["Document not found."], doc),
        );
        return;
      }
      detailBody.appendChild(renderDocumentDetail(doc, env.value as DocumentDetail));
    })();
  });
  return el("li", { class: "view-docs-item-li" }, [details], doc);
}

async function loadDocuments(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  const list = el(
    "ul",
    { class: "view-docs-list", "data-test-id": "view-docs-list" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-docs-loading" }, ["Loading documents…"], doc);
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;
  let total = 0;

  async function loadPage(): Promise<void> {
    const env = await api.listDocuments({
      matterId,
      ...(cursor !== null ? { cursor } : {}),
    });
    loading.remove();
    if (moreBtn !== null) {
      moreBtn.remove();
      moreBtn = null;
    }
    if (!env.ok) {
      parent.appendChild(
        el("p", { role: "alert", "data-test-id": "view-docs-error" }, [env.error.message], doc),
      );
      return;
    }
    const page = env.value as ListDocumentsPage;
    for (const row of page.rows) {
      list.appendChild(renderDocumentRow(doc, api, matterId, row));
      total += 1;
    }
    if (total === 0) {
      parent.appendChild(
        el("p", { "data-test-id": "view-docs-empty" }, ["No documents in this matter yet."], doc),
      );
      return;
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      const btn = el(
        "button",
        { type: "button", class: "view-docs-more", "data-test-id": "view-docs-more" },
        ["Show more"],
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
