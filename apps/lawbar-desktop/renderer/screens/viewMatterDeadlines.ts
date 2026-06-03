// Read-only Deadlines section for the matter view (B7 deadline read surface).
// Lazily lists the matter's persisted deadlines. NO create / confirm / dismiss
// / transition — display only. The renderer never imports the service; only the
// human-rendered fields are read, and main is the authoritative validator.

import type { CaseBoxApi } from "../api.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime, ulidShort } from "../format.js";

// Display-only subset of CaseBoxDeadline.
interface DeadlineRow {
  readonly id: string;
  readonly kind: string;
  readonly due_at: string;
  readonly status: string;
  readonly owner_user_id?: string;
  readonly source_rule_citation?: string;
}

interface ListDeadlinesPage {
  readonly rows: ReadonlyArray<DeadlineRow>;
  readonly next_cursor: string | null;
}

export function renderDeadlinesDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): HTMLElement {
  const body = el(
    "div",
    { class: "view-deadlines-body", "data-test-id": "view-deadlines-body" },
    [],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-deadlines-summary" },
    ["Show deadlines"],
    doc,
  );
  const details = el(
    "details",
    { class: "view-deadlines-details", "data-test-id": "view-deadlines-details" },
    [summary, body],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void loadDeadlines(body, doc, api, matterId);
  });
  return details;
}

function renderDeadlineRow(doc: Document, d: DeadlineRow): HTMLElement {
  const meta = el(
    "div",
    { class: "view-deadlines-row-meta" },
    [
      el(
        "span",
        { class: "view-deadlines-due", "data-test-id": "view-deadlines-due" },
        [formatLocalDateTime(d.due_at)],
        doc,
      ),
      " ",
      el(
        "span",
        { class: "view-deadlines-kind", "data-test-id": "view-deadlines-kind" },
        [`${d.kind} · ${d.status}`],
        doc,
      ),
    ],
    doc,
  );
  const detailChildren: Array<HTMLElement | string> = [];
  if (d.source_rule_citation !== undefined && d.source_rule_citation.length > 0) {
    detailChildren.push(
      el(
        "span",
        { class: "view-deadlines-rule", "data-test-id": "view-deadlines-rule" },
        [`rule: ${d.source_rule_citation}`],
        doc,
      ),
    );
  }
  if (d.owner_user_id !== undefined && d.owner_user_id.length > 0) {
    if (detailChildren.length > 0) detailChildren.push(" ");
    detailChildren.push(
      el(
        "span",
        { class: "view-deadlines-owner" },
        [`owner: ${ulidShort(d.owner_user_id)}`],
        doc,
      ),
    );
  }
  const children: Array<HTMLElement> = [meta];
  if (detailChildren.length > 0) {
    children.push(el("div", { class: "view-deadlines-row-detail" }, detailChildren, doc));
  }
  return el(
    "li",
    { class: "view-deadlines-row", "data-test-id": "view-deadlines-row" },
    children,
    doc,
  );
}

async function loadDeadlines(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  const list = el(
    "ul",
    { class: "view-deadlines-list", "data-test-id": "view-deadlines-list" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-deadlines-loading" }, ["Loading deadlines…"], doc);
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;
  let total = 0;

  async function loadPage(): Promise<void> {
    const env = await api.listDeadlines({
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
        el("p", { role: "alert", "data-test-id": "view-deadlines-error" }, [env.error.message], doc),
      );
      return;
    }
    const page = env.value as ListDeadlinesPage;
    for (const row of page.rows) {
      list.appendChild(renderDeadlineRow(doc, row));
      total += 1;
    }
    if (total === 0) {
      parent.appendChild(
        el("p", { "data-test-id": "view-deadlines-empty" }, ["No deadlines recorded for this matter."], doc),
      );
      return;
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      const btn = el(
        "button",
        { type: "button", class: "view-deadlines-more", "data-test-id": "view-deadlines-more" },
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
