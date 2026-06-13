// List-matters screen. Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.1.
//
// PR2 (renderer UI revision — matter list desktop variant): the DOM is reworked
// onto the desktop-shell list classes integrated in PR1
// (dev-memo/design-source/desktop-shell.css): `.tabs-row` / `.desk-tab` for the
// status tabs, `.matter-table-desktop` for the table, `.list-empty-desktop` for
// the empty state, plus the editorial `.status-pill` / `.conf-pill` / `.matter-name`.
// Behaviour (active/archived tabs, paging, navigation) is unchanged.
//
// Phase 0 found NO i18n layer, so the list's visible labels are hardcoded
// Chinese strings local to this screen (matterTypeLabelZh / confidentialityLabelZh
// / statusLabelZh below). The shared English helpers in ../format.js are left
// untouched — they still back the detail/create/archive screens, which are
// reworked in later stacked PRs; a future i18n WI consolidates the two.
//
// Consumes ONLY committed renderer primitives:
//   - ../api.js          (CaseBoxApi)
//   - ../dom.js          (el, setText)
//   - ../router.js       (buildHash)
//   - ../format.js       (formatLocalDateTime — language-neutral date format)
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
import { formatLocalDateTime } from "../format.js";

export const PAGE_SIZE = 20;

// --- List-local Chinese labels (no i18n layer yet; see file header) ----------
// Exhaustive switches so a future enum change fails the TypeScript build here.

function matterTypeLabelZh(t: MatterType): string {
  switch (t) {
    case "litigation":
      return "诉讼";
    case "advisory":
      return "顾问";
    case "arbitration":
      return "仲裁";
    case "due_diligence":
      return "尽职调查";
    case "criminal_defense":
      return "刑事辩护";
    case "other":
      return "其他";
  }
}

function confidentialityLabelZh(c: ConfidentialityClass): string {
  switch (c) {
    case "normal":
      return "普通";
    case "heightened":
      return "加强";
    case "sealed":
      return "密封";
  }
}

function statusLabelZh(s: MatterStatus): string {
  switch (s) {
    case "active":
      return "进行中";
    case "archived":
      return "已归档";
  }
}

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
  const title = el("h1", {}, ["案件台账"], doc);
  const subtitle = el(
    "p",
    { class: "list-subtitle header-sublede" },
    ["本机案件 · 按创建时间排列"],
    doc,
  );

  const newBtn = el(
    "button",
    { type: "button", class: "button button--accent list-new-btn" },
    ["+ 新建案件"],
    doc,
  );
  newBtn.addEventListener("click", () => {
    deps.navigate(buildHash("new"));
  });

  const header = el(
    "header",
    { class: "list-header" },
    [
      el("div", { class: "main-header-title" }, [title, subtitle], doc),
      el("div", { class: "list-header-actions" }, [newBtn], doc),
    ],
    doc,
  );

  const activeTab = el(
    "button",
    {
      type: "button",
      class: "desk-tab",
      role: "tab",
      "data-status": "active",
    },
    [statusLabelZh("active")],
    doc,
  );
  const archivedTab = el(
    "button",
    {
      type: "button",
      class: "desk-tab",
      role: "tab",
      "data-status": "archived",
    },
    [statusLabelZh("archived")],
    doc,
  );
  const tabsNav = el(
    "nav",
    { class: "tabs-row", role: "tablist", "aria-label": "案件状态" },
    [activeTab, archivedTab],
    doc,
  );

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

  setText(root, "");
  root.appendChild(header);
  root.appendChild(tabsNav);
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
      renderEmpty(body, currentStatus, deps, doc);
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
      [`正在加载${statusLabelZh(status)}案件…`],
      doc,
    ),
  );
}

function renderEmpty(
  body: HTMLElement,
  status: MatterStatus,
  deps: ListMattersDeps,
  doc: Document,
): void {
  setText(body, "");
  const glyph = el("div", { class: "empty-glyph", "aria-hidden": "true" }, ["§"], doc);
  if (status === "active") {
    // Secondary CTA — deliberately NOT `.list-new-btn`; that class is the
    // header button's stable handle (smoke locates `button.list-new-btn`).
    const newBtn = el(
      "button",
      {
        type: "button",
        class: "button button--accent",
        "data-test-id": "list-empty-new",
      },
      ["+ 新建案件"],
      doc,
    );
    newBtn.addEventListener("click", () => {
      deps.navigate(buildHash("new"));
    });
    body.appendChild(
      el(
        "section",
        { class: "list-empty-desktop", "data-test-id": "list-empty" },
        [
          glyph,
          el("h2", {}, ["暂无案件"], doc),
          el(
            "p",
            {},
            ["点击「新建案件」创建第一个。案件数据仅保存在本机。"],
            doc,
          ),
          newBtn,
        ],
        doc,
      ),
    );
    return;
  }
  body.appendChild(
    el(
      "section",
      { class: "list-empty-desktop", "data-test-id": "list-empty" },
      [glyph, el("h2", {}, ["暂无已归档案件"], doc)],
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

function confPill(c: ConfidentialityClass, doc: Document): HTMLElement {
  // `normal` keeps the base `.conf-pill`; heightened/sealed add the modifier.
  const cls = c === "normal" ? "conf-pill" : `conf-pill conf-pill--${c}`;
  return el("span", { class: cls }, [confidentialityLabelZh(c)], doc);
}

function statusPill(s: MatterStatus, doc: Document): HTMLElement {
  return el(
    "span",
    { class: `status-pill status-pill--${s}` },
    [statusLabelZh(s)],
    doc,
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
          el("th", { scope: "col" }, ["案件名称"], doc),
          el("th", { scope: "col" }, ["类型"], doc),
          el("th", { scope: "col" }, ["保密级别"], doc),
          el("th", { scope: "col" }, ["创建时间"], doc),
          el("th", { scope: "col", class: "col-status" }, ["状态"], doc),
        ],
        doc,
      ),
    ],
    doc,
  );

  const tbody = el("tbody", {}, [], doc);
  for (const row of page.rows) {
    // The name anchor carries both `.matter-link` (hover underline) and
    // `.matter-name` (serif desktop title); the name is a direct text child so
    // it renders verbatim (no innerHTML).
    const link = el(
      "a",
      {
        href: buildHash("view", { id: row.id }),
        class: "matter-link matter-name",
        "data-matter-id": row.id,
      },
      [row.name],
      doc,
    );
    link.addEventListener("click", (event) => {
      event.preventDefault();
      deps.navigate(buildHash("view", { id: row.id }));
    });
    const tr = el(
      "tr",
      { class: "matter-row", "data-matter-id": row.id },
      [
        el("td", {}, [link], doc),
        el("td", { class: "cell-type" }, [matterTypeLabelZh(row.matter_type)], doc),
        el("td", {}, [confPill(row.confidentiality_class, doc)], doc),
        el("td", { class: "cell-mono" }, [formatLocalDateTime(row.created_at)], doc),
        el("td", {}, [statusPill(row.status, doc)], doc),
      ],
      doc,
    );
    tbody.appendChild(tr);
  }

  const table = el(
    "table",
    { class: "matter-table-desktop", "data-test-id": "matter-table" },
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
      ["加载更多"],
      doc,
    );
    moreBtn.addEventListener("click", onLoadMore);
    body.appendChild(moreBtn);
  }
}
