// Facts section for the matter view. Lazily lists the matter's persisted facts
// (B6 read surface), lets a lawyer ADD a manual fact via the in-section "Add fact"
// control (consuming casebox:fact:create, since WI-701), and REVIEW / ACCEPT /
// REJECT a fact via per-fact controls (consuming casebox:fact:transition, since
// WI-804). NO edit / delete / evidence linking. The renderer never imports the
// service; only human-rendered fields are read, the renderer forwards narrow DTOs,
// and main is the authoritative validator (it injects identity/status/provenance).

import type { CaseBoxApi } from "../api.js";
import type { CreateFactDto, FactPurpose, FactTransitionTarget, TransitionFactDto } from "../types.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime } from "../format.js";
import { t } from "../i18n/t.js";
import type { CatalogId } from "../i18n/catalog.js";
import { errorMessage } from "../i18n/errorMessage.js";

// R-5 fact purposes (case-box-fact.schema.json). The select offers all eight;
// the server validates the enum. Default selection is "other". The underlying
// option VALUE stays the English enum member; only the visible LABEL is zh-CN.
const FACT_PURPOSES: ReadonlyArray<FactPurpose> = [
  "claim",
  "defense",
  "counterclaim",
  "timeline_event",
  "work_order_result",
  "consultation_q",
  "consultation_a",
  "other",
];

// Visible label for a fact purpose (the option VALUE stays the English enum member).
const FACT_PURPOSE_ID: Record<FactPurpose, CatalogId> = {
  claim: "fact.factKind.claim",
  defense: "fact.factKind.defense",
  counterclaim: "fact.factKind.counterclaim",
  timeline_event: "fact.factKind.timeline_event",
  work_order_result: "fact.factKind.work_order_result",
  consultation_q: "fact.factKind.consultation_q",
  consultation_a: "fact.factKind.consultation_a",
  other: "fact.factKind.other",
};
function factPurposeLabel(p: FactPurpose): string {
  return t(FACT_PURPOSE_ID[p]);
}

// Visible label for a fact status / source_type. Both arrive as an open `string`
// (persistence owns the state machine), so this maps the KNOWN values to zh-CN and
// passes any unrecognized value through verbatim — never throwing on unknown data.
const FACT_STATUS_ID: Readonly<Record<string, CatalogId>> = {
  candidate: "fact.status.candidate",
  reviewed: "fact.status.reviewed",
  accepted: "fact.status.accepted",
  rejected: "fact.status.rejected",
};
function factStatusLabel(status: string): string {
  const id = FACT_STATUS_ID[status];
  return id !== undefined ? t(id) : status;
}
const FACT_SOURCE_TYPE_ID: Readonly<Record<string, CatalogId>> = {
  manual: "fact.sourceType.manual",
  court_order_excerpt: "fact.sourceType.court_order_excerpt",
  llm_extraction: "fact.sourceType.llm_extraction",
  imported: "fact.sourceType.imported",
};
function factSourceTypeLabel(sourceType: string): string {
  const id = FACT_SOURCE_TYPE_ID[sourceType];
  return id !== undefined ? t(id) : sourceType;
}

// Display-only subset of CaseBoxFact.
interface FactRow {
  readonly id: string;
  readonly statement_text: string;
  readonly status: string;
  readonly source_type: string;
  readonly created_at: string;
  readonly as_of_date?: string;
  readonly extraction_confidence?: number | null;
  // Review-lifecycle fields (already in LIST_FACTS_RESPONSE_FIELDS; widened here so
  // the row can render review state — WI-804).
  readonly reviewed_at?: string | null;
  readonly accepted_at?: string | null;
  readonly rejected_at?: string | null;
  readonly rejection_reason?: string | null;
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
  // The list container is owned by loadFacts (cleared + refilled), so a
  // successful add can refresh it in place.
  const listContainer = el(
    "div",
    { class: "view-facts-list-container", "data-test-id": "view-facts-list-container" },
    [],
    doc,
  );
  // Stale-request guard: every load (initial / "Show more" / post-add refresh)
  // bumps a generation token; a load may only mutate listContainer while it is
  // still the newest one. Prevents a slow in-flight load from appending stale
  // empty/error/more nodes after a refresh has cleared + refilled the container.
  let loadGen = 0;
  const runLoad = (): Promise<void> => {
    const myGen = ++loadGen;
    // Pass runLoad itself as the per-row refresh (a successful transition reloads
    // the list in place; the generation guard drops any superseded load).
    return loadFacts(listContainer, doc, api, matterId, runLoad, () => myGen === loadGen);
  };
  const addControl = renderAddFactControl(doc, api, matterId, runLoad);

  const body = el(
    "div",
    { class: "view-facts-body", "data-test-id": "view-facts-body" },
    [addControl, listContainer],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-facts-summary" },
    [t("fact.showFacts")],
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
    void runLoad();
  });
  return details;
}

// "Add fact" control: type a statement, optionally pick a purpose, and — only
// for a timeline_event — an as_of_date. The renderer forwards only the four
// allowlisted fields; main injects identity/status/provenance and is the
// authoritative validator. Mirrors viewMatterDocuments.ts renderAddControl.
function renderAddFactControl(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const statement = el(
    "textarea",
    {
      class: "view-facts-add-statement",
      "data-test-id": "view-facts-add-statement",
      "aria-label": t("fact.statementLabel"),
      placeholder: t("fact.statementLabel"),
    },
    [],
    doc,
  );
  const purpose = el(
    "select",
    { class: "view-facts-add-purpose", "data-test-id": "view-facts-add-purpose", "aria-label": t("fact.purposeLabel") },
    // Mark "other" the SELECTED default so an untouched select resolves to "other"
    // in a real browser (a <select> with no selected option defaults to its FIRST
    // option — here "claim" — which is NOT the intended default). The handler's
    // `|| "other"` fallback remains as defense-in-depth, not the primary mechanism.
    // The option VALUE stays the English enum member; only the visible label is zh-CN.
    FACT_PURPOSES.map((p) =>
      el("option", p === "other" ? { value: p, selected: "" } : { value: p }, [factPurposeLabel(p)], doc),
    ),
    doc,
  );
  // as_of_date is hidden by default; revealed + required only for timeline_event.
  const asOfDate = el(
    "input",
    {
      type: "date",
      class: "view-facts-add-asof",
      "data-test-id": "view-facts-add-asof",
      "aria-label": t("fact.asOfDateLabel"),
      hidden: "",
    },
    [],
    doc,
  );
  const isTimelineEvent = (): boolean =>
    ((purpose as unknown as { value?: string }).value ?? "other") === "timeline_event";
  const syncAsOfVisibility = (): void => {
    if (isTimelineEvent()) {
      asOfDate.removeAttribute("hidden");
      asOfDate.setAttribute("required", "true");
      asOfDate.setAttribute("aria-required", "true");
    } else {
      asOfDate.setAttribute("hidden", "");
      asOfDate.removeAttribute("required");
      asOfDate.removeAttribute("aria-required");
    }
  };
  purpose.addEventListener("change", syncAsOfVisibility);

  const status = el(
    "span",
    { class: "view-facts-add-status", "data-test-id": "view-facts-add-status" },
    [],
    doc,
  );
  const btn = el(
    "button",
    { type: "button", class: "button button--primary view-facts-add-btn", "data-test-id": "view-facts-add" },
    [t("fact.addFact")],
    doc,
  );
  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-facts-add-error");
    setText(status, msg);
  };
  btn.addEventListener("click", () => {
    void (async () => {
      const statementText = ((statement as unknown as { value?: string }).value ?? "").trim();
      status.removeAttribute("role");
      status.setAttribute("data-test-id", "view-facts-add-status");
      if (statementText.length === 0) {
        showError(t("fact.error.statementRequired"));
        return;
      }
      const selectedPurpose =
        ((purpose as unknown as { value?: string }).value as FactPurpose) || "other";
      const asOfValue = ((asOfDate as unknown as { value?: string }).value ?? "").trim();
      // Client-side guard for the timeline_event date (the `required` attr is inert
      // on a type=button form). Server still re-validates; this is a fast UX path.
      if (selectedPurpose === "timeline_event" && asOfValue.length === 0) {
        showError(t("fact.error.asOfDateRequired"));
        return;
      }
      // Build the DTO off the CURRENT purpose — never forward a stale as_of_date.
      const dto: CreateFactDto = { matterId, statement_text: statementText, purpose: selectedPurpose };
      const withAsOf: CreateFactDto =
        selectedPurpose === "timeline_event" ? { ...dto, as_of_date: asOfValue } : dto;
      btn.setAttribute("disabled", "true");
      setText(status, t("fact.adding"));
      try {
        const env = await api.createFact(withAsOf);
        if (!env.ok) {
          showError(errorMessage(env.error));
          return;
        }
        setText(status, t("fact.added"));
        await refresh();
      } catch {
        // Transport / unexpected rejection — surface a safe generic alert rather
        // than leaving an unhandled rejection and a stuck disabled button.
        showError(t("fact.error.addFailed"));
      } finally {
        btn.removeAttribute("disabled");
      }
    })();
  });
  return el(
    "div",
    { class: "view-facts-add", "data-test-id": "view-facts-add-control" },
    [statement, " ", purpose, " ", asOfDate, " ", btn, " ", status],
    doc,
  );
}

// The legal transition actions offered from a given status (WI-804). Terminal
// states (accepted / rejected) offer none. There is deliberately NO candidate ->
// accepted action (the no-auto-accept ADR); persistence is the final authority and
// any illegal attempt surfaces as an inline error.
function reviewActionsFor(status: string): ReadonlyArray<{ label: string; to: FactTransitionTarget }> {
  if (status === "candidate") {
    return [
      { label: t("fact.action.review"), to: "reviewed" },
      { label: t("fact.action.reject"), to: "rejected" },
    ];
  }
  if (status === "reviewed") {
    return [
      { label: t("fact.action.accept"), to: "accepted" },
      { label: t("fact.action.reject"), to: "rejected" },
    ];
  }
  return [];
}

function renderFactRow(
  doc: Document,
  f: FactRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const statement = el(
    "div",
    { class: "view-facts-statement", "data-test-id": "view-facts-statement" },
    [f.statement_text],
    doc,
  );
  const metaChildren: Array<HTMLElement | string> = [
    el(
      "span",
      // status carries a data-status attribute for testability; the visible text
      // label is the a11y substance (status is NOT conveyed by color alone).
      { class: "view-facts-status", "data-test-id": "view-facts-status", "data-status": f.status },
      [`${factStatusLabel(f.status)} · ${factSourceTypeLabel(f.source_type)}`],
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
        [t("fact.confidence", { n: f.extraction_confidence })],
        doc,
      ),
    );
  }
  const meta = el("div", { class: "view-facts-row-meta" }, metaChildren, doc);
  const children: Array<HTMLElement> = [statement, meta];
  // A rejected fact shows its reason as visible text.
  if (f.status === "rejected" && f.rejection_reason !== undefined && f.rejection_reason !== null && f.rejection_reason.length > 0) {
    children.push(
      el(
        "div",
        { class: "view-facts-rejection-reason", "data-test-id": "view-facts-rejection-reason" },
        [t("fact.rejectionReasonPrefix", { reason: f.rejection_reason })],
        doc,
      ),
    );
  }
  const controls = renderReviewControls(doc, f, api, matterId, refresh);
  if (controls !== null) children.push(controls);
  return el(
    "li",
    { class: "view-facts-row", "data-test-id": "view-facts-row", "data-status": f.status },
    children,
    doc,
  );
}

// Per-row Review / Accept / Reject controls — only the legal edges for the current
// status. Returns null for terminal facts (accepted / rejected). The renderer
// forwards only { matterId, factId, to, rejection_reason? }; the server injects the
// reviewer + timestamp and owns the state machine.
function renderReviewControls(
  doc: Document,
  f: FactRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement | null {
  const actions = reviewActionsFor(f.status);
  if (actions.length === 0) return null;

  const status = el(
    "span",
    { class: "view-facts-review-status", "data-test-id": "view-facts-review-status" },
    [],
    doc,
  );
  const buttons: HTMLElement[] = [];
  const setDisabled = (disabled: boolean): void => {
    for (const b of buttons) {
      if (disabled) b.setAttribute("disabled", "true");
      else b.removeAttribute("disabled");
    }
  };
  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-facts-review-error");
    setText(status, msg);
  };
  const runTransition = (to: FactTransitionTarget, rejectionReason?: string): void => {
    void (async () => {
      status.removeAttribute("role");
      status.setAttribute("data-test-id", "view-facts-review-status");
      // Build the DTO off the action — rejection_reason is sent ONLY for reject.
      const dto: TransitionFactDto =
        to === "rejected" && rejectionReason !== undefined
          ? { matterId, factId: f.id, to, rejection_reason: rejectionReason }
          : { matterId, factId: f.id, to };
      setDisabled(true);
      setText(status, t("fact.saving"));
      try {
        const env = await api.transitionFact(dto);
        if (!env.ok) {
          showError(errorMessage(env.error));
          return;
        }
        setText(status, t("fact.saved"));
        await refresh();
      } catch {
        showError(t("fact.error.updateFailed"));
      } finally {
        setDisabled(false);
      }
    })();
  };

  // Reject reveals a required reason input + a Confirm-reject button.
  const reasonInput = el(
    "input",
    {
      type: "text",
      class: "view-facts-reject-reason",
      "data-test-id": "view-facts-reject-reason",
      "aria-label": t("fact.rejectionReasonLabel"),
      placeholder: t("fact.rejectionReasonPlaceholder"),
      hidden: "",
    },
    [],
    doc,
  );
  const confirmReject = el(
    "button",
    { type: "button", class: "button button--danger view-facts-reject-confirm", "data-test-id": "view-facts-reject-confirm", hidden: "" },
    [t("fact.confirmReject")],
    doc,
  );
  // Escape hatch for the two-step reject (the docket-dismiss precedent): revealing a
  // required-reason step must always offer a way back out. Cancel makes no api call.
  const cancelReject = el(
    "button",
    { type: "button", class: "button button--secondary view-facts-reject-cancel", "data-test-id": "view-facts-reject-cancel", hidden: "" },
    [t("fact.cancelReject")],
    doc,
  );
  const clearStatus = (): void => {
    status.removeAttribute("role");
    status.setAttribute("data-test-id", "view-facts-review-status");
    setText(status, "");
  };
  const revealReject = (): void => {
    reasonInput.removeAttribute("hidden");
    reasonInput.setAttribute("aria-required", "true");
    confirmReject.removeAttribute("hidden");
    cancelReject.removeAttribute("hidden");
  };
  // Restore the pre-reveal state: collapse the reason input + both reject buttons,
  // drop the typed reason and the aria-required marker, and clear any inline error.
  const collapseReject = (): void => {
    (reasonInput as unknown as { value: string }).value = "";
    reasonInput.setAttribute("hidden", "");
    reasonInput.removeAttribute("aria-required");
    confirmReject.setAttribute("hidden", "");
    cancelReject.setAttribute("hidden", "");
    clearStatus();
  };
  cancelReject.addEventListener("click", () => {
    collapseReject();
  });
  confirmReject.addEventListener("click", () => {
    const reason = ((reasonInput as unknown as { value?: string }).value ?? "").trim();
    if (reason.length === 0) {
      showError(t("fact.error.rejectionReasonRequired"));
      return;
    }
    runTransition("rejected", reason);
  });

  const actionEls: Array<HTMLElement | string> = [];
  for (const action of actions) {
    const btn = el(
      "button",
      { type: "button", class: `button button--${action.to === "rejected" ? "danger" : "secondary"} view-facts-review-${action.to}`, "data-test-id": `view-facts-review-${action.to}` },
      [action.label],
      doc,
    );
    if (action.to === "rejected") {
      btn.addEventListener("click", () => revealReject());
    } else {
      btn.addEventListener("click", () => runTransition(action.to));
    }
    buttons.push(btn);
    actionEls.push(btn, " ");
  }
  buttons.push(confirmReject, cancelReject);

  return el(
    "div",
    { class: "view-facts-review", "data-test-id": "view-facts-review-control" },
    [...actionEls, reasonInput, " ", confirmReject, " ", cancelReject, " ", status],
    doc,
  );
}

async function loadFacts(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  // Reload the list in place after a successful per-row transition (WI-804).
  refresh: () => Promise<void>,
  // True only while this load is the newest one. Checked after every await so a
  // superseded load (e.g. a slow "Show more" overtaken by a post-add refresh)
  // cannot mutate the container the newer load already cleared + refilled.
  isCurrent: () => boolean = () => true,
): Promise<void> {
  // Clear any prior render (list / empty / error / more nodes) so this can be
  // called again to refresh in place after a successful add.
  setText(parent, "");
  const list = el(
    "ul",
    { class: "view-facts-list", "data-test-id": "view-facts-list" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-facts-loading" }, [t("fact.loading")], doc);
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;
  let total = 0;
  let pageLoading = false; // re-entrancy guard: a fast double-click on "Show more" must not fetch/append a page twice

  async function loadPage(): Promise<void> {
    if (pageLoading) return; // a page fetch is already in flight — drop the concurrent call
    pageLoading = true;
    let env: Awaited<ReturnType<typeof api.listFacts>>;
    try {
      env = await api.listFacts({
        matterId,
        ...(cursor !== null ? { cursor } : {}),
      });
    } finally {
      pageLoading = false;
    }
    // A newer load has taken over this container — drop this stale response.
    if (!isCurrent()) return;
    loading.remove();
    if (moreBtn !== null) {
      moreBtn.remove();
      moreBtn = null;
    }
    if (!env.ok) {
      parent.appendChild(
        el("p", { role: "alert", "data-test-id": "view-facts-error" }, [errorMessage(env.error)], doc),
      );
      return;
    }
    const page = env.value as ListFactsPage;
    for (const row of page.rows) {
      list.appendChild(renderFactRow(doc, row, api, matterId, refresh));
      total += 1;
    }
    if (total === 0) {
      parent.appendChild(
        el("p", { "data-test-id": "view-facts-empty" }, [t("fact.empty")], doc),
      );
      return;
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      const btn = el(
        "button",
        { type: "button", class: "button button--secondary view-facts-more", "data-test-id": "view-facts-more" },
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
