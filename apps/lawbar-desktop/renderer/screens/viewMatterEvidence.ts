// Evidence disclosure on the matter view (product plan R2, WI-10).
//
// The write path the T3 catalogue has been waiting for: create an evidence item FROM a registered
// document, then adopt or exclude it. Only adopted items reach the 证据目录; excluded ones are
// absent from it. Mirrors the Facts disclosure's shape (lazy load on first open, one add control,
// per-row review controls, refresh after every write) so the screen conventions stay the same.
//
// What this screen refuses to do:
// - create evidence that is not drawn from a registered document. The add control offers ONLY
//   the matter's documents; there is no free-standing form. An exhibit is described once, and a
//   catalogue row can always be traced to the original it stands for.
// - re-implement any rule. Which transitions are legal, whether the document is this matter's,
//   what the row looks like — all of that is main's; this screen forwards identities and text,
//   and turns codes into sentences through the shared errorMessage mapper.

import type { CaseBoxApi } from "../api.js";
import type {
  CreateEvidenceItemDto,
  EvidencePartySide,
  EvidenceTransitionTarget,
  TransitionEvidenceItemDto,
} from "../types.js";
import { el, setText } from "../dom.js";
import { t } from "../i18n/t.js";
import type { CatalogId } from "../i18n/catalog.js";
import { errorMessage } from "../i18n/errorMessage.js";

interface EvidenceRow {
  readonly id: string;
  readonly status: string;
  readonly evidence_title?: string;
  readonly proof_statement?: string;
  readonly exhibit_page_range?: string | null;
  readonly party_side?: EvidencePartySide | null;
  readonly source_document_id?: string | null;
  readonly display_order?: number;
}

interface EvidencePage {
  readonly rows: ReadonlyArray<EvidenceRow>;
  readonly next_cursor: string | null;
}

interface DocumentOption {
  readonly id: string;
  readonly filename: string;
}

interface DocumentsPage {
  readonly rows: ReadonlyArray<DocumentOption>;
  readonly next_cursor: string | null;
}

const STATUS_ID: Readonly<Record<string, CatalogId>> = {
  proposed: "evidence.status.proposed",
  accepted: "evidence.status.accepted",
  rejected: "evidence.status.rejected",
  superseded: "evidence.status.superseded",
};

function statusLabel(status: string): string {
  const id = STATUS_ID[status];
  return id !== undefined ? t(id) : status;
}

const SIDE_ID: Readonly<Record<EvidencePartySide, CatalogId>> = {
  our: "evidence.side.our",
  opposing: "evidence.side.opposing",
};

function sideLabel(side: EvidencePartySide | null | undefined): string {
  return side === "our" || side === "opposing" ? t(SIDE_ID[side]) : t("evidence.side.unset");
}

export function renderEvidenceDisclosure(doc: Document, api: CaseBoxApi, matterId: string): HTMLElement {
  const listContainer = el(
    "div",
    { class: "view-evidence-list-container", "data-test-id": "view-evidence-list-container" },
    [],
    doc,
  );
  let loadGen = 0;
  const runLoad = (): Promise<void> => {
    const myGen = ++loadGen;
    return loadEvidence(listContainer, doc, api, matterId, runLoad, () => myGen === loadGen);
  };
  const { control: addControl, loadDocuments } = renderAddEvidenceControl(doc, api, matterId, runLoad);
  const body = el(
    "div",
    { class: "view-evidence-body", "data-test-id": "view-evidence-body" },
    [addControl, listContainer],
    doc,
  );
  const summary = el("summary", { "data-test-id": "view-evidence-summary" }, [t("evidence.showEvidence")], doc);
  const details = el(
    "details",
    { class: "view-evidence-details", "data-test-id": "view-evidence-details" },
    [summary, body],
    doc,
  );
  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    // The add control's document list rides along with the first open, not with render, so a
    // closed disclosure costs nothing.
    void loadDocuments();
    void runLoad();
  });
  return details;
}

/**
 * The add control. Its document list is loaded lazily on first open of the disclosure, through
 * the SAME listDocuments channel the Documents disclosure uses, so the choice set is exactly the
 * matter's registered documents and nothing else.
 */
function renderAddEvidenceControl(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): { readonly control: HTMLElement; readonly loadDocuments: () => Promise<void> } {
  const documentSelect = el(
    "select",
    {
      class: "view-evidence-add-document",
      "data-test-id": "view-evidence-add-document",
      "aria-label": t("evidence.add.document"),
    },
    [el("option", { value: "", selected: "" }, [t("evidence.add.documentPlaceholder")], doc)],
    doc,
  );
  const title = el(
    "input",
    {
      type: "text",
      class: "view-evidence-add-title",
      "data-test-id": "view-evidence-add-title",
      "aria-label": t("evidence.add.title"),
      placeholder: t("evidence.add.title"),
    },
    [],
    doc,
  );
  const proof = el(
    "textarea",
    {
      class: "view-evidence-add-proof",
      "data-test-id": "view-evidence-add-proof",
      "aria-label": t("evidence.add.proof"),
      placeholder: t("evidence.add.proof"),
    },
    [],
    doc,
  );
  const pages = el(
    "input",
    {
      type: "text",
      class: "view-evidence-add-pages",
      "data-test-id": "view-evidence-add-pages",
      "aria-label": t("evidence.add.pages"),
      placeholder: t("evidence.add.pages"),
    },
    [],
    doc,
  );
  const side = el(
    "select",
    { class: "view-evidence-add-side", "data-test-id": "view-evidence-add-side", "aria-label": t("evidence.add.side") },
    [
      el("option", { value: "", selected: "" }, [t("evidence.side.unset")], doc),
      el("option", { value: "our" }, [t("evidence.side.our")], doc),
      el("option", { value: "opposing" }, [t("evidence.side.opposing")], doc),
    ],
    doc,
  );
  const status = el("span", { class: "view-evidence-add-status", "data-test-id": "view-evidence-add-status" }, [], doc);
  const btn = el(
    "button",
    { type: "button", class: "button button--primary view-evidence-add-btn", "data-test-id": "view-evidence-add" },
    [t("evidence.add.submit")],
    doc,
  );
  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-evidence-add-error");
    setText(status, msg);
  };

  // Document choices. Filenames are the lawyer's own registration names, already shown on the
  // Documents disclosure; they are the natural default title for the evidence drawn from them.
  const filenameById = new Map<string, string>();
  let documentsLoaded = false;
  const loadDocuments = async (): Promise<void> => {
    if (documentsLoaded) return;
    documentsLoaded = true;
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      let env: Awaited<ReturnType<typeof api.listDocuments>>;
      try {
        env = await api.listDocuments({ matterId, ...(cursor !== null ? { cursor } : {}) });
      } catch {
        return;
      }
      if (!env.ok) return;
      const value = env.value as DocumentsPage;
      for (const row of value.rows) {
        filenameById.set(row.id, row.filename);
        documentSelect.appendChild(el("option", { value: row.id }, [row.filename], doc));
      }
      cursor = value.next_cursor;
      if (cursor === null) break;
    }
    if (filenameById.size === 0) {
      status.setAttribute("data-test-id", "view-evidence-add-no-documents");
      setText(status, t("evidence.add.noDocuments"));
      btn.setAttribute("disabled", "true");
    }
  };
  documentSelect.addEventListener("change", () => {
    const chosen = (documentSelect as unknown as { value?: string }).value ?? "";
    const current = ((title as unknown as { value?: string }).value ?? "").trim();
    const name = filenameById.get(chosen);
    if (name !== undefined && current.length === 0) {
      (title as unknown as { value: string }).value = name;
    }
  });

  btn.addEventListener("click", () => {
    void (async () => {
      status.removeAttribute("role");
      status.setAttribute("data-test-id", "view-evidence-add-status");
      const documentId = (documentSelect as unknown as { value?: string }).value ?? "";
      const titleText = ((title as unknown as { value?: string }).value ?? "").trim();
      const proofText = ((proof as unknown as { value?: string }).value ?? "").trim();
      const pagesText = ((pages as unknown as { value?: string }).value ?? "").trim();
      const sideValue = (side as unknown as { value?: string }).value ?? "";
      if (documentId.length === 0) {
        showError(t("evidence.error.documentRequired"));
        return;
      }
      if (titleText.length === 0) {
        showError(t("evidence.error.titleRequired"));
        return;
      }
      const dto: CreateEvidenceItemDto = {
        matterId,
        documentId,
        evidence_title: titleText,
        ...(proofText.length > 0 ? { proof_statement: proofText } : {}),
        ...(pagesText.length > 0 ? { exhibit_page_range: pagesText } : {}),
        ...(sideValue === "our" || sideValue === "opposing" ? { party_side: sideValue } : {}),
      };
      btn.setAttribute("disabled", "true");
      setText(status, t("evidence.adding"));
      try {
        const env = await api.createEvidenceItem(dto);
        if (!env.ok) {
          showError(errorMessage(env.error));
          return;
        }
        setText(status, t("evidence.added"));
        (title as unknown as { value: string }).value = "";
        (proof as unknown as { value: string }).value = "";
        (pages as unknown as { value: string }).value = "";
        await refresh();
      } catch {
        showError(t("evidence.error.addFailed"));
      } finally {
        btn.removeAttribute("disabled");
      }
    })();
  });

  const control = el(
    "div",
    { class: "view-evidence-add", "data-test-id": "view-evidence-add-control" },
    [documentSelect, " ", title, " ", proof, " ", pages, " ", side, " ", btn, " ", status],
    doc,
  );
  return { control, loadDocuments };
}

function reviewActionsFor(status: string): ReadonlyArray<{ label: string; to: EvidenceTransitionTarget }> {
  if (status === "proposed") {
    return [
      { label: t("evidence.action.adopt"), to: "accepted" },
      { label: t("evidence.action.exclude"), to: "rejected" },
    ];
  }
  return [];
}

function renderEvidenceRow(
  doc: Document,
  row: EvidenceRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const titleEl = el(
    "div",
    { class: "view-evidence-title", "data-test-id": "view-evidence-title" },
    [row.evidence_title ?? ""],
    doc,
  );
  const meta = el(
    "div",
    { class: "view-evidence-row-meta" },
    [
      el(
        "span",
        { class: "view-evidence-status", "data-test-id": "view-evidence-status", "data-status": row.status },
        [`${statusLabel(row.status)} · ${sideLabel(row.party_side)}`],
        doc,
      ),
    ],
    doc,
  );
  const children: HTMLElement[] = [titleEl, meta];
  if (row.proof_statement !== undefined && row.proof_statement.length > 0) {
    children.push(
      el("div", { class: "view-evidence-proof", "data-test-id": "view-evidence-proof" }, [t("evidence.proofPrefix", { proof: row.proof_statement })], doc),
    );
  }
  if (row.exhibit_page_range !== undefined && row.exhibit_page_range !== null && row.exhibit_page_range.length > 0) {
    children.push(
      el("div", { class: "view-evidence-pages", "data-test-id": "view-evidence-pages" }, [t("evidence.pagesPrefix", { pages: row.exhibit_page_range })], doc),
    );
  }
  const controls = renderReviewControls(doc, row, api, matterId, refresh);
  if (controls !== null) children.push(controls);
  return el(
    "li",
    { class: "view-evidence-row", "data-test-id": "view-evidence-row", "data-status": row.status, "data-evidence-id": row.id },
    children,
    doc,
  );
}

function renderReviewControls(
  doc: Document,
  row: EvidenceRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement | null {
  const actions = reviewActionsFor(row.status);
  if (actions.length === 0) return null;
  const status = el("span", { class: "view-evidence-review-status", "data-test-id": "view-evidence-review-status" }, [], doc);
  const buttons: HTMLElement[] = [];
  const setDisabled = (disabled: boolean): void => {
    for (const b of buttons) {
      if (disabled) b.setAttribute("disabled", "true");
      else b.removeAttribute("disabled");
    }
  };
  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-evidence-review-error");
    setText(status, msg);
  };
  const runTransition = (to: EvidenceTransitionTarget): void => {
    void (async () => {
      status.removeAttribute("role");
      status.setAttribute("data-test-id", "view-evidence-review-status");
      const dto: TransitionEvidenceItemDto = { matterId, evidenceId: row.id, to };
      setDisabled(true);
      setText(status, t("evidence.saving"));
      try {
        const env = await api.transitionEvidenceItem(dto);
        if (!env.ok) {
          showError(errorMessage(env.error));
          return;
        }
        setText(status, t("evidence.saved"));
        await refresh();
      } catch {
        showError(t("evidence.error.updateFailed"));
      } finally {
        setDisabled(false);
      }
    })();
  };
  const actionEls: Array<HTMLElement | string> = [];
  for (const action of actions) {
    const btn = el(
      "button",
      {
        type: "button",
        class: `button button--${action.to === "rejected" ? "danger" : "secondary"} view-evidence-review-${action.to}`,
        "data-test-id": `view-evidence-review-${action.to}`,
      },
      [action.label],
      doc,
    );
    btn.addEventListener("click", () => runTransition(action.to));
    buttons.push(btn);
    actionEls.push(btn, " ");
  }
  return el(
    "div",
    { class: "view-evidence-review", "data-test-id": "view-evidence-review-control" },
    [...actionEls, status],
    doc,
  );
}

async function loadEvidence(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  setText(parent, "");
  const list = el("ul", { class: "view-evidence-list", "data-test-id": "view-evidence-list" }, [], doc);
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-evidence-loading" }, [t("evidence.loading")], doc);
  parent.appendChild(loading);
  let cursor: string | null = null;
  let total = 0;
  for (let page = 0; page < 50; page += 1) {
    let env: Awaited<ReturnType<typeof api.listEvidenceItems>>;
    try {
      env = await api.listEvidenceItems({ matterId, ...(cursor !== null ? { cursor } : {}) });
    } catch {
      if (!isCurrent()) return;
      loading.remove();
      parent.appendChild(el("p", { role: "alert", "data-test-id": "view-evidence-error" }, [t("evidence.load.failed")], doc));
      return;
    }
    if (!isCurrent()) return;
    if (!env.ok) {
      loading.remove();
      parent.appendChild(el("p", { role: "alert", "data-test-id": "view-evidence-error" }, [errorMessage(env.error)], doc));
      return;
    }
    const value = env.value as EvidencePage;
    for (const row of value.rows) {
      list.appendChild(renderEvidenceRow(doc, row, api, matterId, refresh));
      total += 1;
    }
    cursor = value.next_cursor;
    if (cursor === null) break;
  }
  loading.remove();
  if (total === 0) {
    parent.appendChild(
      el(
        "div",
        { "data-test-id": "view-evidence-empty" },
        [el("p", {}, [t("evidence.empty")], doc), el("p", { class: "empty-hint" }, [t("evidence.emptyHint")], doc)],
        doc,
      ),
    );
  }
}
