// Read-only T3 证据目录及说明 (catalog) preview section for the matter view
// (WI-FORMS-T3-S2-CATALOG-PREVIEW-00). Lazily fetches the merged S1 model via the
// casebox:t3:previewCatalog read channel on first disclosure open, then renders a
// read-only header (提交人诉讼地位 + 名称/姓名) + a 4-column table
// (序号 / 证据名称 / 证明内容 / 页码). NO evidence write path, NO file/export, NO
// 卷X页Y citation column. The renderer renders the main-built S1 model VERBATIM —
// it does NOT re-implement buildT3CatalogModel (renderer cannot import the
// node:crypto module). Per dev-memo/design/2026-07-04-t3-catalog-review-preview.md.
//
// States (design §Behavior): loading / empty / envelope-error / submitter-refusal /
// populated. Each reviewNeeded cell renders an explicit visible marker, never
// blank-that-reads-as-data and never a substituted value. Row order is the S1 model
// order — the UI does NOT re-sort. All user-facing strings route through the i18n
// catalog via t() (renderer/i18n/catalog.ts).

import type { CaseBoxApi } from "../api.js";
import type { Party } from "../types.js";
import type {
  T3Cell,
  T3PositionCell,
  T3CatalogModelView,
  T3PreviewCatalogValue,
  T3ExportDocxValue,
  T3RefusalCode,
} from "../types.js";
import { el, setText } from "../dom.js";
import { t } from "../i18n/t.js";
import { errorMessage } from "../i18n/errorMessage.js";

// A visible, non-fabricated needs-review marker with accessible text (not
// color-only). Used for any reviewNeeded cell + an absent/out-of-enum position.
function reviewNeededMarker(doc: Document): HTMLElement {
  return el(
    "span",
    { class: "view-t3-review-needed", "data-test-id": "view-t3-review-needed" },
    [t("viewT3.reviewNeeded")],
    doc,
  );
}

// Render a text-XOR-reviewNeeded cell. A resolved value is rendered VERBATIM
// (already NFC from the model) via a text node; a marker is rendered otherwise.
function renderCell(doc: Document, cell: T3Cell): HTMLElement | string {
  if ("text" in cell) return cell.text;
  return reviewNeededMarker(doc);
}

// 提交人诉讼地位 → localized position value XOR the needs-review marker.
function renderPosition(doc: Document, cell: T3PositionCell): HTMLElement | string {
  if ("value" in cell) {
    return cell.value === "plaintiff" ? t("viewT3.position.plaintiff") : t("viewT3.position.defendant");
  }
  return reviewNeededMarker(doc);
}

// Refusal code → localized reason. Falls back to the title only for an unexpected
// code (never throws); the raw code is always shown alongside so the state is named.
function refusalReason(code: T3RefusalCode): string {
  switch (code) {
    case "submitter_selection_required":
      return t("viewT3.refusal.submitter_selection_required");
    case "submitter_index_out_of_range":
      return t("viewT3.refusal.submitter_index_out_of_range");
    case "submitter_not_client":
      return t("viewT3.refusal.submitter_not_client");
    case "submitter_selection_stale":
      return t("viewT3.refusal.submitter_selection_stale");
    default:
      return t("viewT3.refusal.title");
  }
}

function renderRefusal(doc: Document, code: T3RefusalCode): HTMLElement {
  return el(
    "p",
    { role: "alert", class: "view-t3-refusal", "data-test-id": "view-t3-refusal" },
    [
      t("viewT3.refusal.title"),
      refusalReason(code),
      el("code", { class: "view-t3-refusal-code" }, [code], doc),
    ],
    doc,
  );
}

function headerRow(doc: Document, label: string, value: HTMLElement | string): HTMLElement {
  // The label already carries its trailing separator from the catalog (zh-CN
  // fullwidth colon) — no punctuation literal is composed here, so the i18n
  // drift-guard scanner never sees a hardcoded string on this screen.
  return el(
    "div",
    { class: "view-t3-header-row" },
    [el("span", { class: "view-t3-header-label" }, [label], doc), el("span", {}, [value], doc)],
    doc,
  );
}

function renderModel(doc: Document, model: T3CatalogModelView): HTMLElement {
  const header = el(
    "div",
    { class: "view-t3-header", "data-test-id": "view-t3-header" },
    [
      headerRow(doc, t("viewT3.header.position"), renderPosition(doc, model.litigationPosition)),
      headerRow(doc, t("viewT3.header.submitter"), renderCell(doc, model.submitterName)),
    ],
    doc,
  );

  if (model.rows.length === 0) {
    return el(
      "div",
      { class: "view-t3-body" },
      [header, el("p", { "data-test-id": "view-t3-empty" }, [t("viewT3.empty")], doc)],
      doc,
    );
  }

  const headCells = [
    el("th", { scope: "col" }, [t("viewT3.col.seq")], doc),
    el("th", { scope: "col" }, [t("viewT3.col.name")], doc),
    el("th", { scope: "col" }, [t("viewT3.col.proof")], doc),
    el("th", { scope: "col" }, [t("viewT3.col.page")], doc),
  ];
  const thead = el("thead", {}, [el("tr", {}, headCells, doc)], doc);

  // Render rows in the S1 model order — the UI does NOT re-sort.
  const bodyRows = model.rows.map((row) =>
    el(
      "tr",
      { class: "view-t3-row", "data-test-id": "view-t3-row" },
      [
        el("td", { class: "view-t3-seq" }, [String(row.sequence)], doc),
        el("td", { class: "view-t3-name" }, [renderCell(doc, row.evidenceName)], doc),
        el("td", { class: "view-t3-proof" }, [renderCell(doc, row.proofStatement)], doc),
        el("td", { class: "view-t3-page" }, [renderCell(doc, row.pageRange)], doc),
      ],
      doc,
    ),
  );
  const tbody = el("tbody", {}, bodyRows, doc);

  const table = el(
    "table",
    { class: "view-t3-table", "data-test-id": "view-t3-table" },
    [el("caption", {}, [t("viewT3.caption")], doc), thead, tbody],
    doc,
  );
  return el("div", { class: "view-t3-body" }, [header, table], doc);
}

export interface SubmitterSelection {
  readonly partyIndex: number;
  readonly displayNameEcho: string;
}

async function loadCatalog(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  selection?: SubmitterSelection,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  setText(parent, "");
  const loading = el("p", { "data-test-id": "view-t3-loading" }, [t("viewT3.loading")], doc);
  parent.appendChild(loading);

  let env: Awaited<ReturnType<typeof api.previewT3Catalog>>;
  try {
    env = await api.previewT3Catalog({ matterId, ...(selection !== undefined ? { submitterSelection: selection } : {}) });
  } catch {
    // Stuck-spinner defect, same as the five load paths already fixed: the placeholder above is set
    // before the await and only removed after it, so a rejection left it on screen permanently.
    if (!isCurrent()) return;
    loading.remove();
    parent.appendChild(
      el("p", { role: "alert", "data-test-id": "view-t3-error" }, [t("viewT3.load.failed")], doc),
    );
    return;
  }
  if (!isCurrent()) return; // a later choice superseded this load; its answer must not render
  loading.remove();

  if (!env.ok) {
    parent.appendChild(
      el("p", { role: "alert", "data-test-id": "view-t3-error" }, [errorMessage(env.error)], doc),
    );
    return;
  }
  const value = env.value as T3PreviewCatalogValue;
  if (value.kind === "refusal") {
    parent.appendChild(renderRefusal(doc, value.code));
    return;
  }
  parent.appendChild(renderModel(doc, value.model));
}

// Run the main-process DOCX export and report the outcome inline. The renderer NEVER
// handles raw `.docx` bytes — it only surfaces the structured status (written /
// cancelled / refusal / error). The button is disabled while the export is in flight,
// and is ALWAYS re-enabled + the working indicator ALWAYS cleared in `finally` — even
// when the export call REJECTS (preload/IPC throws instead of returning an envelope),
// so the surface is never left stuck disabled with no feedback.
async function runExport(
  status: HTMLElement,
  button: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  selection?: SubmitterSelection,
): Promise<void> {
  button.setAttribute("disabled", "");
  setText(status, "");
  const working = el(
    "span",
    { "data-test-id": "view-t3-export-working" },
    [t("viewT3.export.working")],
    doc,
  );
  status.appendChild(working);

  try {
    const env = await api.exportT3Docx({ matterId, ...(selection !== undefined ? { submitterSelection: selection } : {}) });

    if (!env.ok) {
      status.appendChild(
        el("span", { role: "alert", "data-test-id": "view-t3-export-error" }, [errorMessage(env.error)], doc),
      );
      return;
    }
    const value = env.value as T3ExportDocxValue;
    if ("refusal" in value) {
      // Reuse the S2 refusal banner — a refusal produces NO document.
      status.appendChild(renderRefusal(doc, value.refusal.code));
      return;
    }
    if (value.written) {
      status.appendChild(
        el("span", { "data-test-id": "view-t3-export-written" }, [t("viewT3.export.written")], doc),
      );
    } else {
      // Cancelling the save is a neutral no-op, NOT an error.
      status.appendChild(
        el("span", { "data-test-id": "view-t3-export-cancelled" }, [t("viewT3.export.cancelled")], doc),
      );
    }
  } catch {
    // The export call REJECTED (preload/IPC threw instead of returning an envelope).
    // Surface an i18n-backed generic error inline; never leak raw error text.
    status.appendChild(
      el(
        "span",
        { role: "alert", "data-test-id": "view-t3-export-error" },
        [t("viewT3.export.failed")],
        doc,
      ),
    );
  } finally {
    // ALWAYS clear the working indicator + re-enable the button, on every path.
    working.remove();
    button.removeAttribute("disabled");
  }
}

/**
 * The submitter picker (WI-11). The model refuses a matter without exactly one client party and
 * accepts an explicit `{ partyIndex, displayNameEcho }`; until now the screen showed only the
 * refusal. The picker is rendered when the matter has anything other than exactly one client
 * party and at least one to choose from: one option per `client` party, labelled by display
 * name, valued by its index in the FULL parties array (that is what the model indexes). Choosing
 * re-previews with the selection and the export forwards the same one. The rule is not
 * re-implemented here: a non-client index or a stale echo still comes back from the model as a
 * refusal, and the screen shows that sentence.
 */
function renderSubmitterPicker(
  doc: Document,
  parties: ReadonlyArray<Party>,
  onChange: (selection: SubmitterSelection | undefined) => void,
): { readonly control: HTMLElement; readonly select: HTMLElement } | null {
  const clientIndexes: number[] = [];
  parties.forEach((p, i) => { if (p.role === "client") clientIndexes.push(i); });
  if (clientIndexes.length === 1) return null; // the model auto-selects; nothing to choose
  if (clientIndexes.length === 0) return null; // nothing to choose from; the refusal stands
  const select = el(
    "select",
    { class: "view-t3-submitter", "data-test-id": "view-t3-submitter", "aria-label": t("viewT3.submitter.label") },
    [
      el("option", { value: "", selected: "" }, [t("viewT3.submitter.placeholder")], doc),
      ...clientIndexes.map((i) => el("option", { value: String(i) }, [parties[i].display_name], doc)),
    ],
    doc,
  );
  select.addEventListener("change", () => {
    const raw = (select as unknown as { value?: string }).value ?? "";
    const idx = raw === "" ? -1 : Number(raw);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parties.length) { onChange(undefined); return; }
    onChange({ partyIndex: idx, displayNameEcho: parties[idx].display_name });
  });
  const control = el(
    "label",
    { class: "view-t3-submitter-label", "data-test-id": "view-t3-submitter-control" },
    [t("viewT3.submitter.label"), " ", select],
    doc,
  );
  return { control, select };
}

export function renderT3CatalogDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  parties: ReadonlyArray<Party>,
): HTMLElement {
  let selection: SubmitterSelection | undefined;
  // Review finding (2026-09-10): choosing A, starting an export, then choosing B before it finished
  // produced a DOCX for A under a screen that said B and "written". The picker is disabled for the
  // whole export. And two previews in flight could land out of order, leaving A's catalogue under
  // B's name: each load carries a generation and only the latest may render.
  let previewGen = 0;
  let pickerSelect: HTMLElement | null = null;
  const bodyContainer = el(
    "div",
    { class: "view-t3-container", "data-test-id": "view-t3-container" },
    [],
    doc,
  );
  const exportStatus = el(
    "span",
    { class: "view-t3-export-status", "data-test-id": "view-t3-export-status" },
    [],
    doc,
  );
  const exportButton = el(
    "button",
    { type: "button", class: "button button--secondary view-t3-export-button", "data-test-id": "view-t3-export-docx" },
    [t("viewT3.export.button")],
    doc,
  );
  exportButton.addEventListener("click", () => {
    if (pickerSelect !== null) pickerSelect.setAttribute("disabled", "");
    void runExport(exportStatus, exportButton, doc, api, matterId, selection).finally(() => {
      if (pickerSelect !== null) pickerSelect.removeAttribute("disabled");
    });
  });
  const picked = renderSubmitterPicker(doc, parties, (next) => {
    selection = next;
    setText(exportStatus, "");
    const gen = ++previewGen;
    void loadCatalog(bodyContainer, doc, api, matterId, selection, () => gen === previewGen);
  });
  const picker = picked === null ? null : picked.control;
  pickerSelect = picked === null ? null : picked.select;
  const exportBar = el(
    "div",
    { class: "view-t3-export-bar" },
    picker !== null ? [picker, " ", exportButton, exportStatus] : [exportButton, exportStatus],
    doc,
  );
  const summary = el("summary", { "data-test-id": "view-t3-summary" }, [t("viewT3.summary")], doc);
  const details = el(
    "details",
    { class: "view-t3-details", "data-test-id": "view-t3-details" },
    [summary, exportBar, bodyContainer],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    const gen = ++previewGen;
    void loadCatalog(bodyContainer, doc, api, matterId, selection, () => gen === previewGen);
  });
  return details;
}
