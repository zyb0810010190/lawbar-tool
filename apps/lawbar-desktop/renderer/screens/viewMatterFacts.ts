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

// R-5 fact purposes (case-box-fact.schema.json). The select offers all eight;
// the server validates the enum. Default selection is "other".
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
      "aria-label": "Statement of fact",
      placeholder: "Statement of fact",
    },
    [],
    doc,
  );
  const purpose = el(
    "select",
    { class: "view-facts-add-purpose", "data-test-id": "view-facts-add-purpose", "aria-label": "Purpose" },
    // Mark "other" the SELECTED default so an untouched select resolves to "other"
    // in a real browser (a <select> with no selected option defaults to its FIRST
    // option — here "claim" — which is NOT the intended default). The handler's
    // `|| "other"` fallback remains as defense-in-depth, not the primary mechanism.
    FACT_PURPOSES.map((p) =>
      el("option", p === "other" ? { value: p, selected: "" } : { value: p }, [p], doc),
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
      "aria-label": "As-of date",
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
    { type: "button", class: "view-facts-add-btn", "data-test-id": "view-facts-add" },
    ["Add fact"],
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
        showError("Statement is required.");
        return;
      }
      const selectedPurpose =
        ((purpose as unknown as { value?: string }).value as FactPurpose) || "other";
      const asOfValue = ((asOfDate as unknown as { value?: string }).value ?? "").trim();
      // Client-side guard for the timeline_event date (the `required` attr is inert
      // on a type=button form). Server still re-validates; this is a fast UX path.
      if (selectedPurpose === "timeline_event" && asOfValue.length === 0) {
        showError("An as-of date is required for a timeline event.");
        return;
      }
      // Build the DTO off the CURRENT purpose — never forward a stale as_of_date.
      const dto: CreateFactDto = { matterId, statement_text: statementText, purpose: selectedPurpose };
      const withAsOf: CreateFactDto =
        selectedPurpose === "timeline_event" ? { ...dto, as_of_date: asOfValue } : dto;
      btn.setAttribute("disabled", "true");
      setText(status, "Adding…");
      try {
        const env = await api.createFact(withAsOf);
        if (!env.ok) {
          showError(env.error.message);
          return;
        }
        setText(status, "Added.");
        await refresh();
      } catch {
        // Transport / unexpected rejection — surface a safe generic alert rather
        // than leaving an unhandled rejection and a stuck disabled button.
        showError("Could not add the fact. Please try again.");
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
      { label: "Review", to: "reviewed" },
      { label: "Reject", to: "rejected" },
    ];
  }
  if (status === "reviewed") {
    return [
      { label: "Accept", to: "accepted" },
      { label: "Reject", to: "rejected" },
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
  const children: Array<HTMLElement> = [statement, meta];
  // A rejected fact shows its reason as visible text.
  if (f.status === "rejected" && f.rejection_reason !== undefined && f.rejection_reason !== null && f.rejection_reason.length > 0) {
    children.push(
      el(
        "div",
        { class: "view-facts-rejection-reason", "data-test-id": "view-facts-rejection-reason" },
        [`Rejection reason: ${f.rejection_reason}`],
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
      setText(status, "Saving…");
      try {
        const env = await api.transitionFact(dto);
        if (!env.ok) {
          showError(env.error.message);
          return;
        }
        setText(status, "Saved.");
        await refresh();
      } catch {
        showError("Could not update the fact. Please try again.");
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
      "aria-label": "Rejection reason",
      placeholder: "Reason for rejection",
      hidden: "",
    },
    [],
    doc,
  );
  const confirmReject = el(
    "button",
    { type: "button", class: "view-facts-reject-confirm", "data-test-id": "view-facts-reject-confirm", hidden: "" },
    ["Confirm reject"],
    doc,
  );
  const revealReject = (): void => {
    reasonInput.removeAttribute("hidden");
    reasonInput.setAttribute("aria-required", "true");
    confirmReject.removeAttribute("hidden");
  };
  confirmReject.addEventListener("click", () => {
    const reason = ((reasonInput as unknown as { value?: string }).value ?? "").trim();
    if (reason.length === 0) {
      showError("A rejection reason is required.");
      return;
    }
    runTransition("rejected", reason);
  });

  const actionEls: Array<HTMLElement | string> = [];
  for (const action of actions) {
    const btn = el(
      "button",
      { type: "button", class: `view-facts-review-${action.to}`, "data-test-id": `view-facts-review-${action.to}` },
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
  buttons.push(confirmReject);

  return el(
    "div",
    { class: "view-facts-review", "data-test-id": "view-facts-review-control" },
    [...actionEls, reasonInput, " ", confirmReject, " ", status],
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
    // A newer load has taken over this container — drop this stale response.
    if (!isCurrent()) return;
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
      list.appendChild(renderFactRow(doc, row, api, matterId, refresh));
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
