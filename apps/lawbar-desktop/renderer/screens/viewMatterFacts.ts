// Read-only Facts section for the matter view (B6 fact read surface). Lazily
// lists the matter's persisted facts. NO create / edit / delete / document or
// evidence linking — display only. The renderer never imports the service; only
// the human-rendered fields are read, and main is the authoritative validator.

import type { CaseBoxApi } from "../api.js";
import { el } from "../dom.js";
import { formatLocalDateTime } from "../format.js";

// Display-only subset of CaseBoxFact.
interface FactRow {
  readonly id: string;
  readonly statement_text: string;
  readonly status: string;
  readonly source_type: string;
  readonly created_at: string;
  readonly as_of_date?: string;
  readonly extraction_confidence?: number | null;
}

interface ListFactsPage {
  readonly rows: ReadonlyArray<FactRow>;
  readonly next_cursor: string | null;
}

export function renderFactsDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): HTMLElement {
  const body = el(
    "div",
    { class: "view-facts-body", "data-test-id": "view-facts-body" },
    [],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-facts-summary" },
    ["Show facts"],
    doc,
  );
  const details = el(
    "details",
    { class: "view-facts-details", "data-test-id": "view-facts-details" },
    [summary, body],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void loadFacts(body, doc, api, matterId);
  });
  return details;
}

function renderFactRow(doc: Document, f: FactRow): HTMLElement {
  const statement = el(
    "div",
    { class: "view-facts-statement", "data-test-id": "view-facts-statement" },
    [f.statement_text],
    doc,
  );
  const metaChildren: Array<HTMLElement | string> = [
    el(
      "span",
      { class: "view-facts-status", "data-test-id": "view-facts-status" },
      [`${f.status} · ${f.source_type}`],
      doc,
    ),
    " ",
    el(
      "span",
      { class: "view-facts-when" },
      [formatLocalDateTime(f.as_of_date !== undefined && f.as_of_date.length > 0 ? f.as_of_date : f.created_at)],
      doc,
    ),
  ];
  if (f.extraction_confidence !== undefined && f.extraction_confidence !== null) {
    metaChildren.push(
      " ",
      el(
        "span",
        { class: "view-facts-confidence", "data-test-id": "view-facts-confidence" },
        [`confidence: ${f.extraction_confidence}`],
        doc,
      ),
    );
  }
  const meta = el("div", { class: "view-facts-row-meta" }, metaChildren, doc);
  return el(
    "li",
    { class: "view-facts-row", "data-test-id": "view-facts-row" },
    [statement, meta],
    doc,
  );
}

async function loadFacts(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  const list = el(
    "ul",
    { class: "view-facts-list", "data-test-id": "view-facts-list" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-facts-loading" }, ["Loading facts…"], doc);
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;
  let total = 0;

  async function loadPage(): Promise<void> {
    const env = await api.listFacts({
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
        el("p", { role: "alert", "data-test-id": "view-facts-error" }, [env.error.message], doc),
      );
      return;
    }
    const page = env.value as ListFactsPage;
    for (const row of page.rows) {
      list.appendChild(renderFactRow(doc, row));
      total += 1;
    }
    if (total === 0) {
      parent.appendChild(
        el("p", { "data-test-id": "view-facts-empty" }, ["No facts recorded for this matter."], doc),
      );
      return;
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      const btn = el(
        "button",
        { type: "button", class: "view-facts-more", "data-test-id": "view-facts-more" },
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
