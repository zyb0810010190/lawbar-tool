// Evidence-links section for the matter view (WI-A3-LINK-UI-T1). Lazily lists the
// matter's audited evidence links (resolver status + lifecycle), lets a lawyer
// CREATE a link (casebox:link:create), UNLINK it with a required reason
// (casebox:link:unlink — two-step, breaks the citation, recorded in the audit
// trail), RELINK it one-click (casebox:link:relink), and view the deterministic
// export-citation set (casebox:link:export). The renderer never imports the
// service; main is the authoritative validator and injects identity/tenant. Per
// dev-memo/design/2026-06-26-audited-evidence-links-ui.md.
//
// Data contract (design §2): a LIST ROW is a RendererLink ONLY — resolver status
// (valid/needs_review/broken) + lifecycle (active vs unlinked + reason). Export
// FLAGS are NOT on a row; they live ONLY in the export-citations panel, joined to
// their link by linkId. A0.7 is a dev/commit-time gate (no runtime marker UI);
// the user-facing confirmation is the two-step unlink reason + the create form.

import type { CaseBoxApi } from "../api.js";
import type {
  CreateLinkDto,
  LinkSourceType,
  RendererExportCitation,
  RendererExportCitationFlag,
  RendererExportCitationResult,
  RendererLink,
  UnlinkLinkDto,
} from "../types.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime } from "../format.js";
import { t } from "../i18n/t.js";
import { linkSourceTypeLabel } from "../i18n/labels.js";
import { errorMessage } from "../i18n/errorMessage.js";

// The 5 source kinds (case_box_links CHECK enum). The select offers exactly these;
// the server re-validates. Rendered as the raw enum value (a loop variable, not a
// string literal — so the i18n drift-guard does not flag it, matching the facts
// purpose-select precedent).
const LINK_SOURCE_TYPES: ReadonlyArray<LinkSourceType> = [
  "evidence",
  "note",
  "question",
  "calcTerm",
  "claimElement",
];

// Resolver-status → catalog key (literal keys only; no dynamic-key cast). Falls
// back to the raw status string for an unexpected value (never throws).
function statusLabel(status: string): string {
  switch (status) {
    case "valid":
      return t("linkStatus.valid");
    case "needs_review":
      return t("linkStatus.needs_review");
    case "broken":
      return t("linkStatus.broken");
    default:
      return status;
  }
}

// Export-flag → catalog key (null ⇒ a clean citation).
function flagLabel(flag: RendererExportCitationFlag | null): string {
  switch (flag) {
    case null:
      return t("linkFlag.CLEAN");
    case "UNLINKED":
      return t("linkFlag.UNLINKED");
    case "BROKEN":
      return t("linkFlag.BROKEN");
    case "NEEDS_REVIEW":
      return t("linkFlag.NEEDS_REVIEW");
    case "NON_CITABLE":
      return t("linkFlag.NON_CITABLE");
    case "AMBIGUOUS":
      return t("linkFlag.AMBIGUOUS");
    default:
      return String(flag);
  }
}

export function renderLinksDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): HTMLElement {
  const listContainer = el(
    "div",
    { class: "view-links-list-container", "data-test-id": "view-links-list-container" },
    [],
    doc,
  );
  // Stale-request guard (the facts-disclosure pattern): a superseded load may not
  // mutate the container a newer load already cleared + refilled.
  let loadGen = 0;
  const runLoad = (): Promise<void> => {
    const myGen = ++loadGen;
    return loadLinks(listContainer, doc, api, matterId, runLoad, () => myGen === loadGen);
  };

  const createControl = renderCreateLinkControl(doc, api, matterId, runLoad);

  // Export-citations panel: a header button reveals/refreshes a read-only panel.
  const exportPanel = el(
    "div",
    { class: "view-links-export-panel", "data-test-id": "view-links-export-panel" },
    [],
    doc,
  );
  const exportBtn = el(
    "button",
    { type: "button", class: "button button--secondary view-links-export-btn", "data-test-id": "view-links-export-btn" },
    [t("links.export.button")],
    doc,
  );
  // Disable the button while a run is in flight + a generation guard so a slower
  // earlier response cannot overwrite a newer panel state (mirrors the list loader
  // + the create/unlink/relink disabled/finally discipline).
  let exportGen = 0;
  exportBtn.addEventListener("click", () => {
    const myGen = ++exportGen;
    exportBtn.setAttribute("disabled", "true");
    void loadExport(exportPanel, doc, api, matterId, () => myGen === exportGen).finally(() => {
      if (myGen === exportGen) exportBtn.removeAttribute("disabled");
    });
  });

  const body = el(
    "div",
    { class: "view-links-body", "data-test-id": "view-links-body" },
    [createControl, exportBtn, exportPanel, listContainer],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-links-summary" },
    [t("links.section.summary")],
    doc,
  );
  const details = el(
    "details",
    { class: "view-links-details", "data-test-id": "view-links-details" },
    [summary, body],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void runLoad();
  });
  return details;
}

// "Create link" control: a sourceType select (5-enum) + sourceId + anchorId. The
// renderer forwards only the four allowlisted fields; main injects identity and
// is the authoritative validator. Not destructive → the form submit IS the
// confirmation (design §3/§4).
function renderCreateLinkControl(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const sourceType = el(
    "select",
    {
      class: "view-links-create-source-type",
      "data-test-id": "view-links-create-source-type",
      "aria-label": t("links.create.sourceTypeLabel"),
    },
    LINK_SOURCE_TYPES.map((s) =>
      el("option", s === "evidence" ? { value: s, selected: "" } : { value: s }, [linkSourceTypeLabel(s)], doc),
    ),
    doc,
  );
  const sourceId = el(
    "input",
    {
      type: "text",
      class: "view-links-create-source-id",
      "data-test-id": "view-links-create-source-id",
      "aria-label": t("links.create.sourceIdLabel"),
      placeholder: t("links.create.sourceIdLabel"),
    },
    [],
    doc,
  );
  const anchorId = el(
    "input",
    {
      type: "text",
      class: "view-links-create-anchor-id",
      "data-test-id": "view-links-create-anchor-id",
      "aria-label": t("links.create.anchorIdLabel"),
      placeholder: t("links.create.anchorIdLabel"),
    },
    [],
    doc,
  );
  const status = el(
    "span",
    { class: "view-links-create-status", "data-test-id": "view-links-create-status" },
    [],
    doc,
  );
  const btn = el(
    "button",
    { type: "button", class: "button button--primary view-links-create-btn", "data-test-id": "view-links-create-btn" },
    [t("links.create.button")],
    doc,
  );
  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-links-create-error");
    setText(status, msg);
  };
  const valueOf = (node: HTMLElement): string =>
    ((node as unknown as { value?: string }).value ?? "").trim();

  btn.addEventListener("click", () => {
    void (async () => {
      status.removeAttribute("role");
      status.setAttribute("data-test-id", "view-links-create-status");
      const srcId = valueOf(sourceId);
      const anchId = valueOf(anchorId);
      if (srcId.length === 0) {
        showError(t("links.create.sourceIdRequired"));
        return;
      }
      if (anchId.length === 0) {
        showError(t("links.create.anchorIdRequired"));
        return;
      }
      const dto: CreateLinkDto = {
        matterId,
        sourceType: (sourceType as unknown as { value?: string }).value ?? "evidence",
        sourceId: srcId,
        anchorId: anchId,
      };
      btn.setAttribute("disabled", "true");
      setText(status, t("links.create.working"));
      try {
        const env = await api.createLink(dto);
        if (!env.ok) {
          showError(errorMessage(env.error));
          return;
        }
        setText(status, t("links.create.success"));
        await refresh();
      } catch {
        showError(t("links.create.failed"));
      } finally {
        btn.removeAttribute("disabled");
      }
    })();
  });
  return el(
    "div",
    { class: "view-links-create", "data-test-id": "view-links-create-control" },
    [sourceType, " ", sourceId, " ", anchorId, " ", btn, " ", status],
    doc,
  );
}

function renderLinkRow(
  doc: Document,
  link: RendererLink,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const isUnlinked = link.unlinked_at !== null;

  const ident = el(
    "div",
    { class: "view-links-ident", "data-test-id": "view-links-ident" },
    [`${linkSourceTypeLabel(link.source_type)} · ${link.source_id} → ${link.anchor_id}`],
    doc,
  );

  // Resolver status (always shown) + a data-status attribute; the visible label
  // is the a11y substance (status is NOT conveyed by color alone).
  const metaChildren: Array<HTMLElement | string> = [
    el(
      "span",
      { class: "view-links-status", "data-test-id": "view-links-status", "data-status": link.status },
      [statusLabel(link.status)],
      doc,
    ),
    " ",
    el(
      "span",
      { class: "view-links-when", "data-test-id": "view-links-when" },
      [`${t("links.row.created")} ${formatLocalDateTime(link.created_at)}`],
      doc,
    ),
  ];
  // Unlinked lifecycle marker: a distinct pill + the unlinked-at timestamp.
  if (isUnlinked) {
    metaChildren.push(
      " ",
      el(
        "span",
        {
          class: "view-links-lifecycle",
          "data-test-id": "view-links-lifecycle",
          "data-lifecycle": "unlinked",
        },
        [
          `${t("linkStatus.unlinked")} · ${t("links.row.unlinkedAt")} ${formatLocalDateTime(
            link.unlinked_at ?? link.created_at,
          )}`,
        ],
        doc,
      ),
    );
  }
  const meta = el("div", { class: "view-links-row-meta" }, metaChildren, doc);
  const children: Array<HTMLElement> = [ident, meta];

  // An unlinked link shows its reason as visible text.
  if (isUnlinked && link.unlink_reason !== null && link.unlink_reason.length > 0) {
    children.push(
      el(
        "div",
        { class: "view-links-reason", "data-test-id": "view-links-reason" },
        [`${t("links.row.reason")}: ${link.unlink_reason}`],
        doc,
      ),
    );
  }

  children.push(renderLinkActions(doc, link, api, matterId, refresh));
  return el(
    "li",
    {
      class: "view-links-row",
      "data-test-id": "view-links-row",
      "data-status": link.status,
      "data-lifecycle": isUnlinked ? "unlinked" : "active",
    },
    children,
    doc,
  );
}

// Per-row action(s): an active link offers a two-step required-reason UNLINK; an
// unlinked link offers a one-click RELINK. The renderer forwards only the
// allowlisted fields; the server injects the actor + timestamp and owns the
// state machine (an illegal transition surfaces as an inline safe-message error).
function renderLinkActions(
  doc: Document,
  link: RendererLink,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const isUnlinked = link.unlinked_at !== null;
  const status = el(
    "span",
    { class: "view-links-action-status", "data-test-id": "view-links-action-status" },
    [],
    doc,
  );
  const controls: Array<HTMLElement | string> = [];
  const buttons: HTMLElement[] = [];
  const setDisabled = (disabled: boolean): void => {
    for (const b of buttons) {
      if (disabled) b.setAttribute("disabled", "true");
      else b.removeAttribute("disabled");
    }
  };
  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-links-action-error");
    setText(status, msg);
  };
  const clearStatusRole = (): void => {
    status.removeAttribute("role");
    status.setAttribute("data-test-id", "view-links-action-status");
  };

  if (!isUnlinked) {
    // Unlink: a two-step required reason (the fact-reject / deadline missed→met
    // precedent). The reason input + a confirm button are revealed on click; copy
    // warns the unlink breaks the citation and is recorded in the audit trail.
    const warning = el(
      "span",
      { class: "view-links-unlink-warning", "data-test-id": "view-links-unlink-warning", hidden: "" },
      [t("links.unlink.warning")],
      doc,
    );
    const reasonInput = el(
      "input",
      {
        type: "text",
        class: "view-links-unlink-reason",
        "data-test-id": "view-links-unlink-reason",
        "aria-label": t("links.unlink.reasonLabel"),
        placeholder: t("links.unlink.reasonLabel"),
        hidden: "",
      },
      [],
      doc,
    );
    const confirmBtn = el(
      "button",
      {
        type: "button",
        class: "button button--danger view-links-unlink-confirm",
        "data-test-id": "view-links-unlink-confirm",
        hidden: "",
      },
      [t("links.unlink.confirm")],
      doc,
    );
    // Escape hatch for the two-step unlink (the docket-dismiss precedent): revealing a
    // required-reason step must always offer a way back out. Cancel makes no api call.
    const cancelBtn = el(
      "button",
      {
        type: "button",
        class: "button button--secondary view-links-unlink-cancel",
        "data-test-id": "view-links-unlink-cancel",
        hidden: "",
      },
      [t("links.unlink.cancel")],
      doc,
    );
    const unlinkBtn = el(
      "button",
      { type: "button", class: "button button--danger view-links-unlink", "data-test-id": "view-links-unlink" },
      [t("links.unlink.button")],
      doc,
    );
    unlinkBtn.addEventListener("click", () => {
      warning.removeAttribute("hidden");
      reasonInput.removeAttribute("hidden");
      reasonInput.setAttribute("aria-required", "true");
      confirmBtn.removeAttribute("hidden");
      cancelBtn.removeAttribute("hidden");
    });
    // Restore the pre-reveal state: collapse the warning, the reason input and both
    // unlink buttons, drop the typed reason + the aria-required marker, and clear any
    // inline error/status text for this row.
    cancelBtn.addEventListener("click", () => {
      (reasonInput as unknown as { value: string }).value = "";
      warning.setAttribute("hidden", "");
      reasonInput.setAttribute("hidden", "");
      reasonInput.removeAttribute("aria-required");
      confirmBtn.setAttribute("hidden", "");
      cancelBtn.setAttribute("hidden", "");
      clearStatusRole();
      setText(status, "");
    });
    confirmBtn.addEventListener("click", () => {
      void (async () => {
        clearStatusRole();
        const reason = ((reasonInput as unknown as { value?: string }).value ?? "").trim();
        if (reason.length === 0) {
          showError(t("links.unlink.reasonRequired"));
          return;
        }
        const dto: UnlinkLinkDto = { matterId, linkId: link.id, unlinkReason: reason };
        setDisabled(true);
        setText(status, t("links.unlink.working"));
        try {
          const env = await api.unlinkLink(dto);
          if (!env.ok) {
            showError(errorMessage(env.error));
            return;
          }
          setText(status, t("links.unlink.success"));
          await refresh();
        } catch {
          showError(t("links.unlink.failed"));
        } finally {
          setDisabled(false);
        }
      })();
    });
    buttons.push(unlinkBtn, confirmBtn, cancelBtn);
    controls.push(unlinkBtn, " ", warning, " ", reasonInput, " ", confirmBtn, " ", cancelBtn, " ", status);
  } else {
    // Relink: one reversible click, no reason (the persistence relink takes none).
    const relinkBtn = el(
      "button",
      { type: "button", class: "button button--secondary view-links-relink", "data-test-id": "view-links-relink" },
      [t("links.relink.button")],
      doc,
    );
    relinkBtn.addEventListener("click", () => {
      void (async () => {
        clearStatusRole();
        setDisabled(true);
        setText(status, t("links.relink.working"));
        try {
          const env = await api.relinkLink({ matterId, linkId: link.id });
          if (!env.ok) {
            showError(errorMessage(env.error));
            return;
          }
          setText(status, t("links.relink.success"));
          await refresh();
        } catch {
          showError(t("links.relink.failed"));
        } finally {
          setDisabled(false);
        }
      })();
    });
    buttons.push(relinkBtn);
    controls.push(relinkBtn, " ", status);
  }

  return el(
    "div",
    { class: "view-links-actions", "data-test-id": "view-links-actions" },
    controls,
    doc,
  );
}

async function loadLinks(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  setText(parent, "");
  const list = el("ul", { class: "view-links-list", "data-test-id": "view-links-list" }, [], doc);
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-links-loading" }, [t("links.loading")], doc);
  parent.appendChild(loading);

  let env: Awaited<ReturnType<typeof api.listLinks>>;
  try {
    env = await api.listLinks({ matterId });
  } catch {
    if (!isCurrent()) return;
    loading.remove();
    parent.appendChild(
      el("p", { role: "alert", "data-test-id": "view-links-error" }, [t("links.load.failed")], doc),
    );
    return;
  }
  // A newer load has taken over this container — drop this stale response.
  if (!isCurrent()) return;
  loading.remove();
  if (!env.ok) {
    parent.appendChild(
      el("p", { role: "alert", "data-test-id": "view-links-error" }, [errorMessage(env.error)], doc),
    );
    return;
  }
  const rows = env.value as ReadonlyArray<RendererLink>;
  if (rows.length === 0) {
    parent.appendChild(
      el(
        "div",
        { "data-test-id": "view-links-empty" },
        [
          el("h3", {}, [t("links.empty.title")], doc),
          el("p", {}, [t("links.empty.body")], doc),
        ],
        doc,
      ),
    );
    return;
  }
  for (const row of rows) {
    list.appendChild(renderLinkRow(doc, row, api, matterId, refresh));
  }
}

// Export-citations panel: a read-only render of exportLinkCitations { citations,
// byFlag }. Export FLAGS appear ONLY here (design §2), joined to their link by
// linkId. A clean citation (exportFlag null) shows its 卷X页Y text.
async function loadExport(
  panel: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  setText(panel, "");
  const loading = el("p", { "data-test-id": "view-links-export-loading" }, [t("links.export.working")], doc);
  panel.appendChild(loading);

  let env: Awaited<ReturnType<typeof api.exportLinkCitations>>;
  try {
    env = await api.exportLinkCitations({ matterId });
  } catch {
    if (!isCurrent()) return;
    loading.remove();
    panel.appendChild(
      el("p", { role: "alert", "data-test-id": "view-links-export-error" }, [t("links.export.failed")], doc),
    );
    return;
  }
  // A newer export run has taken over this panel — drop this stale response.
  if (!isCurrent()) return;
  loading.remove();
  if (!env.ok) {
    panel.appendChild(
      el("p", { role: "alert", "data-test-id": "view-links-export-error" }, [errorMessage(env.error)], doc),
    );
    return;
  }
  const result = env.value as RendererExportCitationResult;
  panel.appendChild(el("h3", { "data-test-id": "view-links-export-title" }, [t("links.export.title")], doc));

  if (result.citations.length === 0) {
    panel.appendChild(el("p", { "data-test-id": "view-links-export-empty" }, [t("links.export.empty")], doc));
    return;
  }

  // byFlag summary (CLEAN + each flag → count). Deterministic key order.
  const summaryParts: string[] = [];
  for (const key of ["CLEAN", "UNLINKED", "BROKEN", "NEEDS_REVIEW", "NON_CITABLE", "AMBIGUOUS"]) {
    const count = result.byFlag[key];
    if (typeof count === "number" && count > 0) {
      summaryParts.push(`${flagLabel(key === "CLEAN" ? null : (key as RendererExportCitationFlag))}: ${count}`);
    }
  }
  panel.appendChild(
    el(
      "p",
      { class: "view-links-export-summary", "data-test-id": "view-links-export-summary" },
      [`${t("links.export.summaryLabel")} — ${summaryParts.join(" · ")}`],
      doc,
    ),
  );

  const list = el("ul", { class: "view-links-export-list", "data-test-id": "view-links-export-list" }, [], doc);
  for (const c of result.citations) {
    list.appendChild(renderExportCitation(doc, c));
  }
  panel.appendChild(list);
}

function renderExportCitation(doc: Document, c: RendererExportCitation): HTMLElement {
  const children: Array<HTMLElement | string> = [
    el(
      "span",
      {
        class: "view-links-export-flag",
        "data-test-id": "view-links-export-flag",
        "data-flag": c.exportFlag === null ? "CLEAN" : c.exportFlag,
      },
      [flagLabel(c.exportFlag)],
      doc,
    ),
    " ",
    el("span", { class: "view-links-export-source" }, [`${linkSourceTypeLabel(c.sourceType)} · ${c.sourceId}`], doc),
  ];
  // A clean citation (exportFlag null) carries the 卷X页Y citation text.
  if (c.exportFlag === null && c.citation !== null) {
    children.push(
      " ",
      el(
        "span",
        { class: "view-links-export-citation-text", "data-test-id": "view-links-export-citation-text" },
        [c.citation.text],
        doc,
      ),
    );
  }
  return el(
    "li",
    { class: "view-links-export-citation", "data-test-id": "view-links-export-citation", "data-flag": c.exportFlag === null ? "CLEAN" : c.exportFlag },
    children,
    doc,
  );
}
