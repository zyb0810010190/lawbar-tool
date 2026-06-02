// List-matters screen. Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.1.
//
// Consumes ONLY committed renderer primitives:
//   - ../api.js          (CaseBoxApi)
//   - ../dom.js          (el, setText, announce, ...)
//   - ../router.js       (buildHash)
//   - ../format.js       (matterTypeLabel, confidentialityLabel,
//                         statusLabel, formatLocalDateTime)
//   - ../types.js        (MatterStatus, MatterType, ConfidentialityClass)
//
// Mountable under any document instance (injected via deps.doc) so tests run
// under plain node:test with a mock document.

import type { CaseBoxApi } from "../api.js";
import type {
  ConfidentialityClass,
  MatterStatus,
  MatterType,
} from "../types.js";
import { el, setText } from "../dom.js";
import { buildHash } from "../router.js";
import {
  confidentialityLabel,
  formatLocalDateTime,
  matterTypeLabel,
  statusLabel,
} from "../format.js";

export const PAGE_SIZE = 20;

// Shape of a single matter row as returned by the IPC. The renderer-side
// validator runs on the main process; here we just cast at the boundary.
// Mirrors `CaseBoxMatter` shape from the contract; only the fields this
// screen actually displays are typed.
interface MatterRow {
  readonly id: string;
  readonly name: string;
  readonly matter_type: MatterType;
  readonly confidentiality_class: ConfidentialityClass;
  readonly created_at: string;
  readonly status: MatterStatus;
}

interface ListMattersPage {
  readonly rows: ReadonlyArray<MatterRow>;
  readonly next_cursor: string | null;
}

export interface ListMattersDeps {
  readonly api: CaseBoxApi;
  readonly navigate: (hash: string) => void;
  readonly doc?: Document;
}

export async function mountListMatters(
  root: HTMLElement,
  deps: ListMattersDeps,
  initialStatus: MatterStatus = "active",
): Promise<void> {
  const doc = deps.doc ?? document;

  // Build static scaffold and attach to root.
  const title = el("h1", {}, ["lawbar — case-box"], doc);
  const subtitle = el(
    "p",
    { class: "list-subtitle" },
    ["Matters list"],
    doc,
  );

  const activeTab = el(
    "button",
    {
      type: "button",
      class: "list-tab",
      role: "tab",
      "data-status": "active",
    },
    ["Active"],
    doc,
  );
  const archivedTab = el(
    "button",
    {
      type: "button",
      class: "list-tab",
      role: "tab",
      "data-status": "archived",
    },
    ["Archived"],
    doc,
  );
  const tabsNav = el(
    "nav",
    { class: "list-tabs", role: "tablist", "aria-label": "Matter status" },
    [activeTab, archivedTab],
    doc,
  );

  const newBtn = el(
    "button",
    { type: "button", class: "button button--primary list-new-btn" },
    ["+ New matter"],
    doc,
  );
  newBtn.addEventListener("click", () => {
    deps.navigate(buildHash("new"));
  });

  const body = el(
    "section",
    { class: "matter-list-body", "aria-live": "polite" },
    [],
    doc,
  );

  const announceRegion = el(
    "div",
    {
      role: "status",
      "aria-live": "polite",
      class: "visually-hidden",
      "data-test-id": "list-announce",
    },
    [],
    doc,
  );

  const header = el(
    "header",
    { class: "list-header" },
    [title, subtitle, tabsNav, newBtn],
    doc,
  );

  setText(root, "");
  root.appendChild(header);
  root.appendChild(body);
  root.appendChild(announceRegion);

  // Track current paging state across re-renders.
  let currentStatus: MatterStatus = initialStatus;
  let accumulatedRows: ReadonlyArray<MatterRow> = [];

  function setActiveTab(status: MatterStatus): void {
    activeTab.setAttribute(
      "aria-selected",
      status === "active" ? "true" : "false",
    );
    archivedTab.setAttribute(
      "aria-selected",
      status === "archived" ? "true" : "false",
    );
  }

  activeTab.addEventListener("click", () => {
    if (currentStatus === "active") return;
    currentStatus = "active";
    accumulatedRows = [];
    setActiveTab(currentStatus);
    void loadAndRender(undefined);
  });
  archivedTab.addEventListener("click", () => {
    if (currentStatus === "archived") return;
    currentStatus = "archived";
    accumulatedRows = [];
    setActiveTab(currentStatus);
    void loadAndRender(undefined);
  });

  async function loadAndRender(cursor: string | undefined): Promise<void> {
    renderLoading(body, currentStatus, doc);
    const dto: {
      status: MatterStatus;
      limit: number;
      cursor?: string;
    } = { status: currentStatus, limit: PAGE_SIZE };
    if (cursor !== undefined) dto.cursor = cursor;
    const env = await deps.api.listMatters(dto);
    if (!env.ok) {
      renderError(body, env.error.message, doc);
      return;
    }
    const page = env.value as ListMattersPage;
    accumulatedRows = [...accumulatedRows, ...page.rows];
    if (accumulatedRows.length === 0) {
      renderEmpty(body, currentStatus, doc);
      return;
    }
    renderRows(
      body,
      { rows: accumulatedRows, next_cursor: page.next_cursor },
      deps,
      doc,
      () => {
        if (page.next_cursor !== null) {
          void loadAndRender(page.next_cursor);
        }
      },
    );
  }

  setActiveTab(currentStatus);
  await loadAndRender(undefined);
}

function renderLoading(
  body: HTMLElement,
  status: MatterStatus,
  doc: Document,
): void {
  setText(body, "");
  body.appendChild(
    el(
      "p",
      { class: "list-loading", "data-test-id": "list-loading" },
      [`Loading ${status} matters…`],
      doc,
    ),
  );
}

function renderEmpty(
  body: HTMLElement,
  status: MatterStatus,
  doc: Document,
): void {
  setText(body, "");
  const copy =
    status === "active"
      ? "No matters yet. Click + New matter to create the first one. Matters are stored locally on this device."
      : "No archived matters.";
  body.appendChild(
    el(
      "p",
      { class: "list-empty", "data-test-id": "list-empty" },
      [copy],
      doc,
    ),
  );
}

function renderError(
  body: HTMLElement,
  message: string,
  doc: Document,
): void {
  setText(body, "");
  body.appendChild(
    el(
      "p",
      {
        class: "list-error",
        role: "alert",
        "data-test-id": "list-error",
      },
      [message],
      doc,
    ),
  );
}

function renderRows(
  body: HTMLElement,
  page: ListMattersPage,
  deps: ListMattersDeps,
  doc: Document,
  onLoadMore: () => void,
): void {
  setText(body, "");

  const thead = el(
    "thead",
    {},
    [
      el(
        "tr",
        {},
        [
          el("th", { scope: "col" }, ["Name"], doc),
          el("th", { scope: "col" }, ["Matter type"], doc),
          el("th", { scope: "col" }, ["Confidentiality"], doc),
          el("th", { scope: "col" }, ["Created"], doc),
          el("th", { scope: "col" }, ["Status"], doc),
        ],
        doc,
      ),
    ],
    doc,
  );

  const tbody = el("tbody", {}, [], doc);
  for (const row of page.rows) {
    const link = el(
      "a",
      {
        href: buildHash("view", { id: row.id }),
        class: "matter-link",
        "data-matter-id": row.id,
      },
      [row.name],
      doc,
    );
    link.addEventListener("click", (event) => {
      event.preventDefault();
      deps.navigate(buildHash("view", { id: row.id }));
    });
    const pill = el(
      "span",
      { class: `status-pill status-pill--${row.status}` },
      [statusLabel(row.status)],
      doc,
    );
    const tr = el(
      "tr",
      { class: "matter-row", "data-matter-id": row.id },
      [
        el("td", {}, [link], doc),
        el("td", {}, [matterTypeLabel(row.matter_type)], doc),
        el("td", {}, [confidentialityLabel(row.confidentiality_class)], doc),
        el("td", {}, [formatLocalDateTime(row.created_at)], doc),
        el("td", {}, [pill], doc),
      ],
      doc,
    );
    tbody.appendChild(tr);
  }

  const table = el(
    "table",
    { class: "matter-table", "data-test-id": "matter-table" },
    [thead, tbody],
    doc,
  );
  body.appendChild(table);

  if (page.next_cursor !== null) {
    const moreBtn = el(
      "button",
      {
        type: "button",
        class: "button list-load-more",
        "data-test-id": "list-load-more",
      },
      ["Load more"],
      doc,
    );
    moreBtn.addEventListener("click", onLoadMore);
    body.appendChild(moreBtn);
  }
}
