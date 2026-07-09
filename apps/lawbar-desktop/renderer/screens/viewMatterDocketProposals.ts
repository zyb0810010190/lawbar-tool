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
import type { DismissDocketEntryDto, EditDocketEntryDto, ListDocketEntriesDto } from "../types.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime } from "../format.js";
import { t } from "../i18n/t.js";
import { deadlineKindLabel, docketSourceTypeLabel, reminderKindLabel } from "../i18n/labels.js";

// A reminder offset on the projected row (renderer-safe; passthrough in DPE5).
interface ReminderOffset {
  readonly offset_days: number;
  readonly kind: "advance_notice" | "final_notice";
}

// Display + edit-prefill subset of the projected CaseBoxDocketEntry
// (DOCKET_ENTRY_RESPONSE_FIELDS). WI-DPE5 widened this so the in-row edit form can
// prefill the six editable content fields and show the "(edited)" badge. reminder_offsets
// is read-only/passthrough; revised_at is display-only (never an input).
interface ProposalRow {
  readonly id: string;
  readonly proposed_kind: string;
  readonly proposed_due_at: string;
  readonly proposed_due_at_kind?: "datetime" | "date_only";
  readonly proposed_due_at_timezone?: string | null;
  readonly proposed_owner_user_id?: string;
  readonly reminder_offsets?: ReadonlyArray<ReminderOffset> | null;
  readonly revised_at?: string | null;
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
      "aria-label": t("docket.section.aria"),
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
      setText(heading, t("docket.heading", { total }));
      cursor = page.next_cursor;
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          section.appendChild(
            el(
              "p",
              { role: "alert", "data-test-id": "view-docket-proposals-error" },
              [t("docket.pagination.stalled")],
              doc,
            ),
          );
          return;
        }
        seenCursors.add(cursor);
        const btn = el(
          "button",
          { type: "button", class: "view-docket-proposals-more", "data-test-id": "view-docket-proposals-more" },
          [t("common.loadMore")],
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
      [p.source_type !== undefined && p.source_type.length > 0 ? `${deadlineKindLabel(p.proposed_kind)} · ${docketSourceTypeLabel(p.source_type)}` : deadlineKindLabel(p.proposed_kind)],
      doc,
    ),
    " ",
    el(
      "span",
      { class: "view-docket-proposal-due", "data-test-id": "view-docket-proposal-due" },
      [t("docket.row.due", { at: formatLocalDateTime(p.proposed_due_at) })],
      doc,
    ),
  ];
  if (p.proposed_at !== undefined && p.proposed_at.length > 0) {
    metaChildren.push(" ");
    metaChildren.push(
      el(
        "span",
        { class: "view-docket-proposal-proposed-at", "data-test-id": "view-docket-proposal-proposed-at" },
        [t("docket.row.proposedAt", { at: formatLocalDateTime(p.proposed_at) })],
        doc,
      ),
    );
  }
  // WI-DPE5: a row that has been edited (revised_at present) shows an "(edited)" badge.
  // Display-only — derived from the projected row; revised_at is never an input. The badge
  // (not the timestamp) is the primary signal; the localized time rides the title attribute.
  if (typeof p.revised_at === "string" && p.revised_at.length > 0) {
    metaChildren.push(" ");
    metaChildren.push(
      el(
        "span",
        {
          class: "view-docket-proposal-edited",
          "data-test-id": "view-docket-proposal-edited",
          "aria-label": t("docket.row.editedAria"),
          title: t("docket.row.editedTitle", { at: formatLocalDateTime(p.revised_at) }),
        },
        [t("docket.row.editedBadge")],
        doc,
      ),
    );
  }
  const meta = el("div", { class: "view-docket-proposal-meta" }, metaChildren, doc);

  // Two in-row controls that are mutually exclusive: revealing one hides the other's
  // trigger (only one mode per row at a time). Edit and Dismiss stay DISTINCT actions —
  // a saved edit keeps the entry proposed (no edit-then-confirm shortcut; ADR §3).
  const editHooks: { setTriggerHidden?: (h: boolean) => void } = {};
  const dismissHooks: { setTriggerHidden?: (h: boolean) => void } = {};
  const dismiss = renderDismissControl(doc, p, api, matterId, refresh, {
    onEnter: () => editHooks.setTriggerHidden?.(true),
    onExit: () => editHooks.setTriggerHidden?.(false),
  });
  dismissHooks.setTriggerHidden = dismiss.setTriggerHidden;
  const edit = renderEditControl(doc, p, api, matterId, refresh, {
    onEnter: () => dismissHooks.setTriggerHidden?.(true),
    onExit: () => dismissHooks.setTriggerHidden?.(false),
  });
  editHooks.setTriggerHidden = edit.setTriggerHidden;

  return el(
    "li",
    { class: "view-docket-proposal-row", "data-test-id": "view-docket-proposal-row", "data-entry-id": p.id },
    [meta, edit.element, " ", dismiss.element],
    doc,
  );
}

// An in-row control: its element + a setter to hide/show its trigger button so the
// sibling control can enforce one-mode-per-row.
interface InRowControl {
  readonly element: HTMLElement;
  readonly setTriggerHidden: (hidden: boolean) => void;
}

// Hooks fired when a control enters / leaves its active (revealed) mode, so the
// sibling control's trigger can be hidden/restored.
interface ControlHooks {
  readonly onEnter?: () => void;
  readonly onExit?: () => void;
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
  hooks: ControlHooks = {},
): InRowControl {
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
      "aria-label": t("docket.dismiss.reasonAria"),
      hidden: "",
    },
    [],
    doc,
  );
  const dismissBtn = el(
    "button",
    { type: "button", class: "view-docket-dismiss-btn", "data-test-id": "view-docket-dismiss" },
    [t("docket.dismiss.button")],
    doc,
  );
  const confirmBtn = el(
    "button",
    { type: "button", class: "view-docket-dismiss-confirm", "data-test-id": "view-docket-dismiss-confirm", hidden: "" },
    [t("docket.dismiss.confirm")],
    doc,
  );
  const cancelBtn = el(
    "button",
    { type: "button", class: "view-docket-dismiss-cancel", "data-test-id": "view-docket-dismiss-cancel", hidden: "" },
    [t("docket.cancel")],
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
    hooks.onEnter?.();
  };
  const collapse = (): void => {
    reasonInput.setAttribute("hidden", "");
    confirmBtn.setAttribute("hidden", "");
    cancelBtn.setAttribute("hidden", "");
    dismissBtn.removeAttribute("hidden");
    hooks.onExit?.();
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
        showError(t("docket.dismiss.reasonRequired"));
        return;
      }
      const dto: DismissDocketEntryDto = { matterId, entryId: p.id, dismissal_reason: reason };
      setDisabled(true);
      setText(status, t("docket.dismiss.working"));
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
        showError(t("docket.dismiss.failed"));
        setDisabled(false);
      }
    })();
  });

  const element = el(
    "div",
    { class: "view-docket-dismiss-control", "data-test-id": "view-docket-dismiss-control" },
    [dismissBtn, " ", reasonInput, " ", confirmBtn, " ", cancelBtn, " ", status],
    doc,
  );
  const setTriggerHidden = (hidden: boolean): void => {
    if (hidden) dismissBtn.setAttribute("hidden", "");
    else dismissBtn.removeAttribute("hidden");
  };
  return { element, setTriggerHidden };
}

// Two-step in-row EDIT (WI-DPE5): Edit -> inline form prefilled with the five editable
// scalar fields (reminder_offsets is read-only/passthrough) -> Save changes / Cancel.
// Mirrors the dismiss reveal. Forwards ONLY { matterId, entryId, + six content fields };
// the server derives tenant/matter/entry/editor authority and persistence derives
// revised_at. A saved edit keeps the entry PROPOSED (no edit-then-confirm; ADR §3): on
// success the section refreshes in place; on error the form stays open with a no-leak
// inline alert; Cancel makes no api call. DPE3 persistence remains the final authority —
// this client validation is UX-only defense-in-depth.
function renderEditControl(
  doc: Document,
  p: ProposalRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
  hooks: ControlHooks = {},
): InRowControl {
  // reminder_offsets is preserved verbatim and sent unchanged on save (passthrough).
  const retainedReminders: EditDocketEntryDto["reminder_offsets"] = p.reminder_offsets ?? null;
  // Re-entrancy guard: true while an editDocketEntry call is in flight. Blocks a second
  // Save and makes Cancel/Escape no-ops so the form cannot collapse mid-save (which would
  // re-enable controls and write a later error into a hidden form).
  let saving = false;

  const editBtn = el(
    "button",
    { type: "button", class: "view-docket-edit-btn", "data-test-id": "view-docket-edit" },
    [t("docket.edit.button")],
    doc,
  );
  const mkField = (testId: string, label: string, value: string): HTMLElement => {
    const input = el(
      "input",
      { type: "text", class: "view-docket-edit-input", "data-test-id": testId, "aria-label": label },
      [],
      doc,
    );
    (input as unknown as { value: string }).value = value;
    return input;
  };
  const kindInput = mkField("view-docket-edit-kind", t("docket.edit.kindAria"), p.proposed_kind);
  const dueInput = mkField("view-docket-edit-due", t("docket.edit.dueAria"), p.proposed_due_at);
  const dueKindSelect = el(
    "select",
    { class: "view-docket-edit-input", "data-test-id": "view-docket-edit-due-kind", "aria-label": t("docket.edit.dueKindAria") },
    [
      el("option", { value: "datetime" }, [t("docket.dueKind.datetime")], doc),
      el("option", { value: "date_only" }, [t("docket.dueKind.date_only")], doc),
    ],
    doc,
  );
  (dueKindSelect as unknown as { value: string }).value = p.proposed_due_at_kind ?? "datetime";
  const tzInput = mkField(
    "view-docket-edit-tz",
    t("docket.edit.tzAria"),
    typeof p.proposed_due_at_timezone === "string" ? p.proposed_due_at_timezone : "",
  );
  const ownerInput = mkField(
    "view-docket-edit-owner",
    t("docket.edit.ownerAria"),
    typeof p.proposed_owner_user_id === "string" ? p.proposed_owner_user_id : "",
  );
  const reminders = el(
    "span",
    { class: "view-docket-edit-reminders", "data-test-id": "view-docket-edit-reminders" },
    [t("docket.edit.reminders", { list: formatReminders(retainedReminders) })],
    doc,
  );
  const saveBtn = el(
    "button",
    { type: "button", class: "view-docket-edit-save", "data-test-id": "view-docket-edit-save" },
    [t("docket.edit.save")],
    doc,
  );
  const cancelBtn = el(
    "button",
    { type: "button", class: "view-docket-edit-cancel", "data-test-id": "view-docket-edit-cancel" },
    [t("docket.cancel")],
    doc,
  );
  const status = el(
    "span",
    { class: "view-docket-edit-status", "data-test-id": "view-docket-edit-status" },
    [],
    doc,
  );
  const form = el(
    "div",
    { class: "view-docket-edit-form", "data-test-id": "view-docket-edit-form", hidden: "" },
    [
      kindInput, " ", dueInput, " ", dueKindSelect, " ", tzInput, " ", ownerInput, " ",
      reminders, " ", saveBtn, " ", cancelBtn, " ", status,
    ],
    doc,
  );

  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-docket-edit-error");
    setText(status, msg);
  };
  const clearStatus = (): void => {
    status.removeAttribute("role");
    status.setAttribute("data-test-id", "view-docket-edit-status");
    setText(status, "");
  };
  const setDisabled = (disabled: boolean): void => {
    for (const b of [saveBtn, cancelBtn]) {
      if (disabled) b.setAttribute("disabled", "true");
      else b.removeAttribute("disabled");
    }
  };
  const reveal = (): void => {
    form.removeAttribute("hidden");
    editBtn.setAttribute("hidden", "");
    hooks.onEnter?.();
    (kindInput as unknown as { focus?: () => void }).focus?.();
  };
  const collapse = (): void => {
    form.setAttribute("hidden", "");
    editBtn.removeAttribute("hidden");
    clearStatus();
    setDisabled(false);
    hooks.onExit?.();
    (editBtn as unknown as { focus?: () => void }).focus?.();
  };

  const readVal = (input: HTMLElement): string =>
    ((input as unknown as { value?: string }).value ?? "").trim();

  editBtn.addEventListener("click", () => {
    clearStatus();
    reveal();
  });
  cancelBtn.addEventListener("click", () => {
    if (saving) return;
    collapse();
  });
  form.addEventListener("keydown", (event: Event) => {
    if (saving) return;
    if ((event as unknown as { key?: string }).key === "Escape") collapse();
  });
  saveBtn.addEventListener("click", () => {
    void (async () => {
      if (saving) return;
      clearStatus();
      const proposed_kind = readVal(kindInput);
      const proposed_due_at = readVal(dueInput);
      const proposed_due_at_kind = readVal(dueKindSelect) as "datetime" | "date_only";
      const tz = readVal(tzInput);
      const proposed_owner_user_id = readVal(ownerInput);
      if (proposed_kind.length === 0) {
        showError(t("docket.edit.err.kindRequired"));
        return;
      }
      if (proposed_due_at.length === 0 || Number.isNaN(Date.parse(proposed_due_at))) {
        showError(t("docket.edit.err.dueInvalid"));
        return;
      }
      if (proposed_due_at_kind !== "datetime" && proposed_due_at_kind !== "date_only") {
        showError(t("docket.edit.err.dueKindInvalid"));
        return;
      }
      if (proposed_due_at_kind === "datetime" && tz.length === 0) {
        showError(t("docket.edit.err.tzRequired"));
        return;
      }
      if (proposed_owner_user_id.length === 0) {
        showError(t("docket.edit.err.ownerRequired"));
        return;
      }
      const dto: EditDocketEntryDto = {
        matterId,
        entryId: p.id,
        proposed_kind,
        proposed_due_at,
        proposed_due_at_kind,
        proposed_due_at_timezone: proposed_due_at_kind === "date_only" && tz.length === 0 ? null : tz,
        proposed_owner_user_id,
        reminder_offsets: retainedReminders,
      };
      saving = true;
      setDisabled(true);
      setText(status, t("docket.edit.saving"));
      try {
        const env = await api.editDocketEntry(dto);
        if (!env.ok) {
          // Fail-closed: keep the form + values, surface the no-leak error inline, and
          // re-enable so the lawyer can retry/cancel. Do NOT refresh (a reload would wipe
          // the inline alert — mirrors the dismiss + confirm-deadline error paths).
          saving = false;
          showError(env.error.message);
          setDisabled(false);
          return;
        }
        // Success: the entry stays "proposed" with revised content -> refresh rebuilds the
        // section in place (the row reappears with new values + the "(edited)" badge). The
        // control is discarded by the rebuild, so `saving` is intentionally left true.
        await refresh();
      } catch {
        saving = false;
        showError(t("docket.edit.failed"));
        setDisabled(false);
      }
    })();
  });

  const element = el(
    "div",
    { class: "view-docket-edit-control", "data-test-id": "view-docket-edit-control" },
    [editBtn, " ", form],
    doc,
  );
  const setTriggerHidden = (hidden: boolean): void => {
    if (hidden) editBtn.setAttribute("hidden", "");
    else editBtn.removeAttribute("hidden");
  };
  return { element, setTriggerHidden };
}

// Read-only formatting of the passthrough reminder_offsets for display. Never edited in
// DPE5; sent unchanged on save.
function formatReminders(
  offsets: EditDocketEntryDto["reminder_offsets"],
): string {
  if (offsets === null || offsets === undefined || offsets.length === 0) return t("docket.reminders.none");
  return offsets
    .map((o) => `${reminderKindLabel(o.kind)} ${o.offset_days >= 0 ? "−" : "+"}${Math.abs(o.offset_days)}d`)
    .join(", ");
}
