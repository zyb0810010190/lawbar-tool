// Pending docket-proposals group for the matter view's Deadlines section (WI-D4).
// A proposed docket entry (confirmation_state="proposed") is durably persisted by
// casebox:docket:create but was invisible after reload (the Deadlines list shows
// only confirmed deadlines). This module surfaces those durable proposals via
// casebox:docket:list (proposed filter) and lets a lawyer DISMISS one via
// casebox:docket:dismiss. PROPOSED-only: the server enforces proposed-only +
// fail-closed scoping; the renderer forwards only { matterId, entryId,
// dismissal_reason } and never sees authority identities (stripped server-side).
//
// Extracted from viewMatterDeadlines.ts (loc-guardian) so the deadlines screen
// stays under the 800-LOC source cap. Mounted inside the Deadlines disclosure;
// load() is triggered when that disclosure opens. The group is HIDDEN entirely
// when there are zero proposals (no empty chrome). Pagination mirrors the facts
// list: first page + an explicit "Show more" while next_cursor is non-null —
// proposals beyond page one are never silently hidden.

import type { CaseBoxApi } from "../api.js";
import type { DismissDocketEntryDto, ListDocketEntriesDto } from "../types.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime } from "../format.js";

// Display-only subset of the projected CaseBoxDocketEntry (DOCKET_ENTRY_RESPONSE_FIELDS).
interface ProposalRow {
  readonly id: string;
  readonly proposed_kind: string;
  readonly proposed_due_at: string;
  readonly proposed_due_at_timezone?: string;
  readonly proposed_at?: string;
  readonly source_type?: string;
}
interface ListDocketEntriesPage {
  readonly rows: ReadonlyArray<ProposalRow>;
  readonly next_cursor: string | null;
}

export interface DocketProposalsSection {
  readonly element: HTMLElement;
  load(): Promise<void>;
}

// Returns the section element (initially hidden) + a load() the host calls when
// the Deadlines disclosure opens (and again as `refresh` after a dismiss).
export function renderDocketProposalsSection(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): DocketProposalsSection {
  const section = el(
    "section",
    {
      class: "view-docket-proposals",
      "aria-label": "Pending proposals",
      "data-test-id": "view-docket-proposals",
      hidden: "",
    },
    [],
    doc,
  );

  // Generation guard: a refresh (after dismiss) supersedes any in-flight load so a
  // stale page cannot mutate the section the newer load already rebuilt.
  let loadGen = 0;
  const refresh = (): Promise<void> => load();

  async function load(): Promise<void> {
    const myGen = ++loadGen;
    const isCurrent = (): boolean => myGen === loadGen;

    setText(section, "");
    section.setAttribute("hidden", ""); // stay hidden until a proposal is seen

    const heading = el(
      "h3",
      { class: "view-docket-proposals-heading", "data-test-id": "view-docket-proposals-heading" },
      [],
      doc,
    );
    const list = el(
      "ul",
      { class: "view-docket-proposals-list", "data-test-id": "view-docket-proposals-list" },
      [],
      doc,
    );
    let mounted = false;
    const ensureMounted = (): void => {
      if (mounted) return;
      section.appendChild(heading);
      section.appendChild(list);
      mounted = true;
    };

    let total = 0;
    let cursor: string | null = null;
    let moreBtn: HTMLElement | null = null;
    let pageLoading = false; // re-entrancy guard: a fast double-click on "Show more" must not append the same page twice
    const seenCursors = new Set<string>();

    const loadPage = async (): Promise<void> => {
      if (pageLoading) return; // a page fetch is already in flight — drop the concurrent call
      pageLoading = true;
      const dto: ListDocketEntriesDto = {
        matterId,
        confirmation_state: "proposed",
        ...(cursor !== null ? { cursor } : {}),
      };
      let env;
      try {
        env = await api.listDocketEntries(dto);
      } finally {
        pageLoading = false;
      }
      if (!isCurrent()) return;
      if (moreBtn !== null) {
        moreBtn.remove();
        moreBtn = null;
      }
      if (!env.ok) {
        // Reveal the section so the error is visible even if no rows loaded.
        section.removeAttribute("hidden");
        ensureMounted();
        section.appendChild(
          el(
            "p",
            { role: "alert", "data-test-id": "view-docket-proposals-error" },
            [env.error.message],
            doc,
          ),
        );
        return;
      }
      const page = env.value as ListDocketEntriesPage;
      for (const row of page.rows) {
        list.appendChild(renderProposalRow(doc, row, api, matterId, refresh));
        total += 1;
      }
      if (total === 0) {
        // No proposals: keep the whole group hidden (no empty chrome).
        section.setAttribute("hidden", "");
        return;
      }
      section.removeAttribute("hidden");
      ensureMounted();
      setText(heading, `Pending proposals (${total})`);
      cursor = page.next_cursor;
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          section.appendChild(
            el(
              "p",
              { role: "alert", "data-test-id": "view-docket-proposals-error" },
              ["Proposal pagination did not advance (repeated cursor); load aborted."],
              doc,
            ),
          );
          return;
        }
        seenCursors.add(cursor);
        const btn = el(
          "button",
          { type: "button", class: "view-docket-proposals-more", "data-test-id": "view-docket-proposals-more" },
          ["Show more"],
          doc,
        );
        btn.addEventListener("click", () => {
          void loadPage();
        });
        moreBtn = btn;
        section.appendChild(btn);
      }
    };

    await loadPage();
  }

  return { element: section, load };
}

function renderProposalRow(
  doc: Document,
  p: ProposalRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const metaChildren: Array<HTMLElement | string> = [
    el(
      "span",
      { class: "view-docket-proposal-kind", "data-test-id": "view-docket-proposal-kind" },
      [p.source_type !== undefined && p.source_type.length > 0 ? `${p.proposed_kind} · ${p.source_type}` : p.proposed_kind],
      doc,
    ),
    " ",
    el(
      "span",
      { class: "view-docket-proposal-due", "data-test-id": "view-docket-proposal-due" },
      [`due ${formatLocalDateTime(p.proposed_due_at)}`],
      doc,
    ),
  ];
  if (p.proposed_at !== undefined && p.proposed_at.length > 0) {
    metaChildren.push(" ");
    metaChildren.push(
      el(
        "span",
        { class: "view-docket-proposal-proposed-at", "data-test-id": "view-docket-proposal-proposed-at" },
        [`proposed ${formatLocalDateTime(p.proposed_at)}`],
        doc,
      ),
    );
  }
  const meta = el("div", { class: "view-docket-proposal-meta" }, metaChildren, doc);
  const controls = renderDismissControl(doc, p, api, matterId, refresh);
  return el(
    "li",
    { class: "view-docket-proposal-row", "data-test-id": "view-docket-proposal-row", "data-entry-id": p.id },
    [meta, controls],
    doc,
  );
}

// Two-step in-row dismiss: Dismiss -> required reason input + Confirm dismiss /
// Cancel. The reason capture IS the confirmation (no separate modal — mirrors the
// fact-reject precedent). Forwards ONLY { matterId, entryId, dismissal_reason };
// the server injects the dismissal actor + timestamp and enforces proposed-only.
function renderDismissControl(
  doc: Document,
  p: ProposalRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const status = el(
    "span",
    { class: "view-docket-dismiss-status", "data-test-id": "view-docket-dismiss-status" },
    [],
    doc,
  );
  const reasonInput = el(
    "input",
    {
      type: "text",
      class: "view-docket-dismiss-reason",
      "data-test-id": "view-docket-dismiss-reason",
      "aria-label": "Dismissal reason",
      hidden: "",
    },
    [],
    doc,
  );
  const dismissBtn = el(
    "button",
    { type: "button", class: "view-docket-dismiss-btn", "data-test-id": "view-docket-dismiss" },
    ["Dismiss"],
    doc,
  );
  const confirmBtn = el(
    "button",
    { type: "button", class: "view-docket-dismiss-confirm", "data-test-id": "view-docket-dismiss-confirm", hidden: "" },
    ["Confirm dismiss"],
    doc,
  );
  const cancelBtn = el(
    "button",
    { type: "button", class: "view-docket-dismiss-cancel", "data-test-id": "view-docket-dismiss-cancel", hidden: "" },
    ["Cancel"],
    doc,
  );

  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-docket-dismiss-error");
    setText(status, msg);
  };
  const clearStatus = (): void => {
    status.removeAttribute("role");
    status.setAttribute("data-test-id", "view-docket-dismiss-status");
    setText(status, "");
  };
  const setDisabled = (disabled: boolean): void => {
    for (const b of [dismissBtn, confirmBtn, cancelBtn]) {
      if (disabled) b.setAttribute("disabled", "true");
      else b.removeAttribute("disabled");
    }
  };
  const reveal = (): void => {
    reasonInput.removeAttribute("hidden");
    reasonInput.setAttribute("aria-required", "true");
    confirmBtn.removeAttribute("hidden");
    cancelBtn.removeAttribute("hidden");
    dismissBtn.setAttribute("hidden", "");
  };
  const collapse = (): void => {
    reasonInput.setAttribute("hidden", "");
    confirmBtn.setAttribute("hidden", "");
    cancelBtn.setAttribute("hidden", "");
    dismissBtn.removeAttribute("hidden");
  };

  dismissBtn.addEventListener("click", () => {
    clearStatus();
    reveal();
  });
  cancelBtn.addEventListener("click", () => {
    clearStatus();
    collapse();
  });
  confirmBtn.addEventListener("click", () => {
    void (async () => {
      const reason = ((reasonInput as unknown as { value?: string }).value ?? "").trim();
      clearStatus();
      if (reason.length === 0) {
        showError("A dismissal reason is required.");
        return;
      }
      const dto: DismissDocketEntryDto = { matterId, entryId: p.id, dismissal_reason: reason };
      setDisabled(true);
      setText(status, "Dismissing…");
      try {
        const env = await api.dismissDocketEntry(dto);
        if (!env.ok) {
          // Fail-closed: keep the row + the revealed reason input, surface the
          // error inline, and re-enable so the lawyer can retry/cancel. Do NOT
          // refresh here — a reload would rebuild the section and wipe the inline
          // alert (mirrors the confirm-deadline error path, which keeps state).
          showError(env.error.message);
          setDisabled(false);
          return;
        }
        // Success: the entry left "proposed" -> a refresh drops it from the list.
        await refresh();
      } catch {
        showError("Could not dismiss the proposal. Please try again.");
        setDisabled(false);
      }
    })();
  });

  return el(
    "div",
    { class: "view-docket-dismiss-control", "data-test-id": "view-docket-dismiss-control" },
    [dismissBtn, " ", reasonInput, " ", confirmBtn, " ", cancelBtn, " ", status],
    doc,
  );
}
