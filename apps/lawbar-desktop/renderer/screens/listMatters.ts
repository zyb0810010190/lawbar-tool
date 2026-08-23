// List-matters screen. Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.1.
//
// PR2 (renderer UI revision) reworked the DOM onto the desktop-shell list classes.
// WI-i18n-2 (this change) wires the screen to the i18n catalog/facade: the list's
// visible labels now resolve through ../i18n/labels.js (typed enum-label facade) and
// ../i18n/t.js (catalog lookup) instead of list-local Chinese maps + hardcoded literals.
// Output is the SAME zh-CN copy as before — no semantic copy drift — but it is now the
// single catalog source, and the list's allowlist entries are burned down.
//
// Consumes ONLY committed renderer primitives:
//   - ../api.js          (CaseBoxApi)
//   - ../dom.js          (el, setText)
//   - ../router.js       (buildHash)
//   - ../format.js       (formatLocalDateTime — language-neutral date format)
//   - ../i18n/labels.js  (matterTypeLabel, confidentialityLabel, statusLabel)
//   - ../i18n/t.js       (t)
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
import { matterTypeLabel, confidentialityLabel, statusLabel } from "../i18n/labels.js";
import { t } from "../i18n/t.js";
import { mountOverdueDashboardBanner } from "../overdueDashboardBanner.js";
import { errorMessage } from "../i18n/errorMessage.js";

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

  // Global overdue-deadline dashboard banner (brief §10) — mounts above the header
  // so it is visible whenever the home surface opens. Its load is FIRE-AND-FORGET
  // and independent of the matter-list load: a banner failure must not break the
  // list, and a list failure must not break the banner.
  const bannerContainer = el(
    "div",
    { class: "dashboard-overdue-banner-host", "data-test-id": "overdue-dashboard-banner-host" },
    [],
    doc,
  );

  // Build static scaffold and attach to root.
  const title = el("h1", {}, [t("list.title")], doc);
  const subtitle = el(
    "p",
    { class: "list-subtitle header-sublede" },
    [t("list.subtitle")],
    doc,
  );

  const newBtn = el(
    "button",
    { type: "button", class: "button button--accent list-new-btn" },
    [t("list.newMatter")],
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
    [statusLabel("active")],
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
    [statusLabel("archived")],
    doc,
  );
  const tabsNav = el(
    "nav",
    { class: "tabs-row", role: "tablist", "aria-label": t("list.tabsAria") },
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
  root.appendChild(bannerContainer);
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
      renderError(body, errorMessage(env.error), doc);
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

  // Fire-and-forget: independent of the matter-list load below.
  void mountOverdueDashboardBanner(bannerContainer, { api: deps.api, doc });

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
      [t("list.loading", { status: statusLabel(status) })],
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
      [t("list.newMatter")],
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
          el("h2", {}, [t("list.empty.activeTitle")], doc),
          el("p", {}, [t("list.empty.activeBody")], doc),
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
      [el("h2", {}, [t("list.empty.archived")], doc)],
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
  return el("span", { class: cls }, [confidentialityLabel(c)], doc);
}

function statusPill(s: MatterStatus, doc: Document): HTMLElement {
  return el(
    "span",
    { class: `status-pill status-pill--${s}` },
    [statusLabel(s)],
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
          el("th", { scope: "col" }, [t("list.col.name")], doc),
          el("th", { scope: "col" }, [t("list.col.type")], doc),
          el("th", { scope: "col" }, [t("list.col.confidentiality")], doc),
          el("th", { scope: "col" }, [t("list.col.created")], doc),
          el("th", { scope: "col", class: "col-status" }, [t("list.col.status")], doc),
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
        el("td", { class: "cell-type" }, [matterTypeLabel(row.matter_type)], doc),
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
      [t("common.loadMore")],
      doc,
    );
    moreBtn.addEventListener("click", onLoadMore);
    body.appendChild(moreBtn);
  }
}
