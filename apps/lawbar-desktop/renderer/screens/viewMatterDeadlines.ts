// Deadlines section for the matter view. Lazily lists the matter's persisted
// deadlines (B7 read surface); since WI-702 a lawyer can ADD a deadline via a
// two-step propose -> confirm control (casebox:docket:create then
// casebox:docket:confirm); and since WI-D4 the section also surfaces durable
// PENDING docket proposals (casebox:docket:list, proposed filter) with a
// per-proposal DISMISS control (casebox:docket:dismiss) — see
// viewMatterDocketProposals.ts; and since WI-DT3 each non-terminal deadline carries
// per-row status-transition controls (casebox:deadline:transition) — pending ->
// met / missed / withdrawn, and missed -> met with a required reason (met and
// withdrawn are terminal). NO deadline-FIELD edit (due_at / kind / owner). The
// renderer never imports the service; only the human-rendered fields are read,
// the renderer forwards narrow DTOs, and main is the authoritative validator (it
// injects all authority/provenance/lifecycle fields and does the fail-closed
// scoped confirm/dismiss/transition preflights).
//
// Urgency surfacing (brief §18 day-one must-have): each `pending` deadline is
// classified overdue / due-soon (≤7 days) / none against an injected clock; a
// `role="status"` banner summarises the counts and a per-row pill marks the
// urgent ones. Deadlines arrive sorted by due_at ASC, so the earliest sort to
// the top naturally — no client reordering needed. ALL pages are eager-loaded
// (see `loadDeadlines`) so the banner reflects every deadline: because settled
// and pending rows share the due_at ordering, a partial load could hide a
// pending overdue deadline behind older settled ones and undercount silently.

import type { CaseBoxApi } from "../api.js";
import type {
  ConfirmDocketEntryDto,
  CreateDocketEntryDto,
  DeadlineTransitionTarget,
  TransitionDeadlineDto,
} from "../types.js";
import { el, setText } from "../dom.js";
import { renderDocketProposalsSection } from "./viewMatterDocketProposals.js";
import { t } from "../i18n/t.js";
import { deadlineKindLabel, deadlineStatusLabel } from "../i18n/labels.js";
import { errorMessage } from "../i18n/errorMessage.js";
import {
  classifyDeadlineUrgency,
  formatLocalDateTime,
  ulidShort,
  type DeadlineUrgency,
} from "../format.js";

// --- Host-zone datetime resolution (WI-702) -------------------------------
// A datetime-local input has no zone, and for this slice the timezone is
// constrained to the host IANA zone. A host-local wall time can be NONEXISTENT
// (spring-forward gap) or AMBIGUOUS (fall-back overlap), which JS Date silently
// normalizes — so the forwarded instant could mismatch the displayed wall clock.
// findUniqueInstant forwards an instant ONLY when the wall time is existent AND
// unique. Detection is transition-size agnostic (a ±48h minute-granularity scan),
// so sub-hour transitions (e.g. Australia/Lord_Howe's 30-minute shift) are caught.
// It is a PURE function over injected zone adapters so it can be tested against
// synthetic zones without depending on the test runner's TZ.
export interface LocalComponents {
  readonly y: number;
  readonly mo: number; // 0-based, matching Date.getMonth()
  readonly da: number;
  readonly h: number;
  readonly mi: number;
}
const SCAN_MINUTES = 48 * 60;
function sameComponents(a: LocalComponents, b: LocalComponents): boolean {
  return a.y === b.y && a.mo === b.mo && a.da === b.da && a.h === b.h && a.mi === b.mi;
}
export function findUniqueInstant(
  input: LocalComponents,
  toInstant: (c: LocalComponents) => number | null,
  toComponents: (ms: number) => LocalComponents,
): number | null {
  const candidate = toInstant(input);
  if (candidate === null || Number.isNaN(candidate)) return null;
  // GAP: the candidate must re-derive to exactly the input wall time.
  if (!sameComponents(toComponents(candidate), input)) return null;
  // OVERLAP: reject if any OTHER nearby instant maps to the same wall time.
  for (let dm = -SCAN_MINUTES; dm <= SCAN_MINUTES; dm++) {
    if (dm === 0) continue;
    if (sameComponents(toComponents(candidate + dm * 60000), input)) return null;
  }
  return candidate;
}
// datetime-local string ("YYYY-MM-DDTHH:MM" with optional ":SS", which is
// ignored) -> components, or null. Fully anchored so trailing garbage is rejected
// (the Date round-trip then rejects out-of-range components).
function parseLocalComponents(value: string): LocalComponents | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (m === null) return null;
  return { y: +m[1], mo: +m[2] - 1, da: +m[3], h: +m[4], mi: +m[5] };
}
// Host-zone adapters: new Date(...components) builds in host-local time; the
// Date get*-family reads back host-local components.
function hostToInstant(c: LocalComponents): number {
  return new Date(c.y, c.mo, c.da, c.h, c.mi, 0, 0).getTime();
}
function hostToComponents(ms: number): LocalComponents {
  const d = new Date(ms);
  return { y: d.getFullYear(), mo: d.getMonth(), da: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
}
function hostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Display-only subset of CaseBoxDeadline.
interface DeadlineRow {
  readonly id: string;
  readonly kind: string;
  readonly due_at: string;
  readonly status: string;
  readonly owner_user_id?: string;
  readonly source_rule_citation?: string;
}

interface ListDeadlinesPage {
  readonly rows: ReadonlyArray<DeadlineRow>;
  readonly next_cursor: string | null;
}

export function renderDeadlinesDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  // Optional injected clock (tests pass a fixed value for determinism). When omitted, the
  // "now" used for urgency classification is resolved at LOAD time (the click handler below),
  // not at render time — the disclosure is lazy, so a matter view left open across a deadline
  // boundary must classify against the time the deadlines are actually loaded.
  nowMs?: number,
): HTMLElement {
  // The list container is owned by loadDeadlines (cleared + refilled), so a
  // confirmed deadline can refresh it in place. A generation token guards against
  // a superseded in-flight load mutating the container after a refresh.
  const listContainer = el(
    "div",
    { class: "view-deadlines-list-container", "data-test-id": "view-deadlines-list-container" },
    [],
    doc,
  );
  let loadGen = 0;
  const runLoad = (): Promise<void> => {
    const myGen = ++loadGen;
    // nowMs resolves at LOAD time (fixed in tests; live re-reads Date.now() per load).
    // runLoad is forwarded as the per-row transition refresh: a successful deadline
    // transition re-runs the load (new generation) so the row re-renders in its new state.
    return loadDeadlines(
      listContainer,
      doc,
      api,
      matterId,
      nowMs ?? Date.now(),
      () => myGen === loadGen,
      runLoad,
    );
  };
  const addControl = renderAddDeadlineControl(doc, api, matterId, runLoad);

  // WI-D4: durable pending docket proposals (confirmation_state="proposed") + a
  // per-proposal dismiss control, surfaced above the confirmed-deadline list.
  // Loaded on disclosure open (alongside the deadlines load) so a proposal that
  // outlived a reload is recoverable/dismissible instead of orphaned.
  const proposals = renderDocketProposalsSection(doc, api, matterId);

  const body = el(
    "div",
    { class: "view-deadlines-body", "data-test-id": "view-deadlines-body" },
    [addControl, proposals.element, listContainer],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-deadlines-summary" },
    [t("deadline.summary")],
    doc,
  );
  const details = el(
    "details",
    { class: "view-deadlines-details", "data-test-id": "view-deadlines-details" },
    [summary, body],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void runLoad();
    void proposals.load();
  });
  return details;
}

// Two-step "Add deadline" -> "Confirm deadline" control (WI-702). Propose creates
// a PROPOSED docket entry (casebox:docket:create); the entry id is held in
// ephemeral renderer state (no docket-read IPC) and Confirm materializes the
// deadline (casebox:docket:confirm), which then joins the list on refresh. The
// timezone is constrained to the host zone (read-only) for this slice; the
// datetime is forwarded only when it is an existent + unique host-local wall time.
function renderAddDeadlineControl(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const HOST_TZ = hostTimeZone();
  let proposedEntryId: string | null = null;

  const kindInput = el(
    "input",
    { type: "text", class: "view-deadlines-add-kind", "data-test-id": "view-deadlines-add-kind", "aria-label": t("deadline.aria.kind"), placeholder: "filing" },
    [],
    doc,
  );
  const dueInput = el(
    "input",
    { type: "datetime-local", class: "view-deadlines-add-due", "data-test-id": "view-deadlines-add-due", "aria-label": t("deadline.aria.due") },
    [],
    doc,
  );
  // Timezone is the host zone and non-editable for this slice.
  const tzField = el(
    "input",
    { type: "text", class: "view-deadlines-add-tz", "data-test-id": "view-deadlines-add-tz", "aria-label": t("deadline.aria.timezone"), value: HOST_TZ, readonly: "", disabled: "" },
    [],
    doc,
  );
  const addStatus = el(
    "span",
    { class: "view-deadlines-add-status", "data-test-id": "view-deadlines-add-status" },
    [],
    doc,
  );
  const proposeBtn = el(
    "button",
    { type: "button", class: "view-deadlines-add-btn", "data-test-id": "view-deadlines-add" },
    [t("deadline.propose")],
    doc,
  );

  const confirmStatus = el(
    "span",
    { class: "view-deadlines-confirm-status", "data-test-id": "view-deadlines-confirm-status" },
    [],
    doc,
  );
  const confirmBtn = el(
    "button",
    { type: "button", class: "view-deadlines-confirm-btn", "data-test-id": "view-deadlines-confirm" },
    [t("deadline.confirm")],
    doc,
  );
  const proposedRow = el(
    "div",
    { class: "view-deadlines-proposed-row", role: "status", "data-test-id": "view-deadlines-proposed-row" },
    [],
    doc,
  );
  const proposedArea = el(
    "div",
    { class: "view-deadlines-proposed", "data-test-id": "view-deadlines-proposed", hidden: "" },
    [proposedRow, " ", confirmBtn, " ", confirmStatus],
    doc,
  );

  const addError = (msg: string): void => {
    addStatus.setAttribute("role", "alert");
    addStatus.setAttribute("data-test-id", "view-deadlines-add-error");
    setText(addStatus, msg);
  };
  const confirmError = (msg: string): void => {
    confirmStatus.setAttribute("role", "alert");
    confirmStatus.setAttribute("data-test-id", "view-deadlines-confirm-error");
    setText(confirmStatus, msg);
  };

  proposeBtn.addEventListener("click", () => {
    void (async () => {
      const kind = ((kindInput as unknown as { value?: string }).value ?? "").trim();
      const dueLocal = ((dueInput as unknown as { value?: string }).value ?? "").trim();
      addStatus.removeAttribute("role");
      addStatus.setAttribute("data-test-id", "view-deadlines-add-status");
      if (kind.length === 0) {
        addError(t("deadline.error.kindRequired"));
        return;
      }
      if (dueLocal.length === 0) {
        addError(t("deadline.error.dueRequired"));
        return;
      }
      const components = parseLocalComponents(dueLocal);
      if (components === null) {
        addError(t("deadline.error.dueInvalid"));
        return;
      }
      const instantMs = findUniqueInstant(components, hostToInstant, hostToComponents);
      if (instantMs === null) {
        addError(t("deadline.error.dueAmbiguous"));
        return;
      }
      const proposed_due_at = new Date(instantMs).toISOString();
      const dto: CreateDocketEntryDto = {
        matterId,
        proposed_kind: kind,
        proposed_due_at,
        proposed_due_at_timezone: HOST_TZ,
      };
      proposeBtn.setAttribute("disabled", "true");
      setText(addStatus, t("deadline.status.proposing"));
      try {
        const env = await api.createDocketEntry(dto);
        if (!env.ok) {
          addError(errorMessage(env.error));
          return;
        }
        const entry = env.value as { id?: string; proposed_kind?: string; proposed_due_at?: string };
        if (typeof entry.id !== "string" || entry.id.length === 0) {
          // Defensive: a successful create must carry the entry id (confirm needs
          // it). A missing id means a backend/preload contract regression — surface
          // it instead of showing an unconfirmable proposed row.
          addError(t("deadline.error.missingId"));
          return;
        }
        proposedEntryId = entry.id;
        setText(
          proposedRow,
          t("deadline.proposedRow", {
            kind: entry.proposed_kind ?? kind,
            due: formatLocalDateTime(entry.proposed_due_at ?? proposed_due_at),
          }),
        );
        proposedArea.removeAttribute("hidden");
        confirmStatus.removeAttribute("role");
        confirmStatus.setAttribute("data-test-id", "view-deadlines-confirm-status");
        setText(confirmStatus, "");
        setText(addStatus, t("deadline.status.proposed"));
      } catch {
        addError(t("deadline.error.proposeFailed"));
      } finally {
        proposeBtn.removeAttribute("disabled");
      }
    })();
  });

  confirmBtn.addEventListener("click", () => {
    void (async () => {
      if (proposedEntryId === null) return;
      confirmStatus.removeAttribute("role");
      confirmStatus.setAttribute("data-test-id", "view-deadlines-confirm-status");
      const dto: ConfirmDocketEntryDto = { matterId, entryId: proposedEntryId };
      confirmBtn.setAttribute("disabled", "true");
      setText(confirmStatus, t("deadline.status.confirming"));
      try {
        const env = await api.confirmDocketEntry(dto);
        if (!env.ok) {
          // Fail-closed: keep the proposed row, do NOT refresh the deadline list.
          confirmError(errorMessage(env.error));
          return;
        }
        // Success: clear the proposed state and refresh the list in place.
        proposedEntryId = null;
        proposedArea.setAttribute("hidden", "");
        setText(confirmStatus, t("deadline.status.confirmed"));
        await refresh();
      } catch {
        confirmError(t("deadline.error.confirmFailed"));
      } finally {
        confirmBtn.removeAttribute("disabled");
      }
    })();
  });

  return el(
    "div",
    { class: "view-deadlines-add", "data-test-id": "view-deadlines-add-control" },
    [kindInput, " ", dueInput, " ", tzField, " ", proposeBtn, " ", addStatus, proposedArea],
    doc,
  );
}

function renderDeadlineRow(
  doc: Document,
  d: DeadlineRow,
  urgency: DeadlineUrgency,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement {
  const metaChildren: Array<HTMLElement | string> = [
    el(
      "span",
      { class: "view-deadlines-due", "data-test-id": "view-deadlines-due" },
      [formatLocalDateTime(d.due_at)],
      doc,
    ),
    " ",
    el(
      "span",
      { class: "view-deadlines-kind", "data-test-id": "view-deadlines-kind" },
      [`${deadlineKindLabel(d.kind)} · ${deadlineStatusLabel(d.status)}`],
      doc,
    ),
  ];
  if (urgency !== "none") {
    metaChildren.push(
      el(
        "span",
        {
          class: `view-deadlines-urgency view-deadlines-urgency--${urgency}`,
          "data-test-id": "view-deadlines-urgency",
          "data-urgency": urgency,
        },
        [t(`deadlineUrgency.${urgency}`)],
        doc,
      ),
    );
  }
  const meta = el("div", { class: "view-deadlines-row-meta" }, metaChildren, doc);
  const detailChildren: Array<HTMLElement | string> = [];
  if (d.source_rule_citation !== undefined && d.source_rule_citation.length > 0) {
    detailChildren.push(
      el(
        "span",
        { class: "view-deadlines-rule", "data-test-id": "view-deadlines-rule" },
        [t("deadline.rule", { citation: d.source_rule_citation })],
        doc,
      ),
    );
  }
  if (d.owner_user_id !== undefined && d.owner_user_id.length > 0) {
    if (detailChildren.length > 0) detailChildren.push(" ");
    detailChildren.push(
      el(
        "span",
        { class: "view-deadlines-owner" },
        [t("deadline.owner", { id: ulidShort(d.owner_user_id) })],
        doc,
      ),
    );
  }
  const children: Array<HTMLElement> = [meta];
  if (detailChildren.length > 0) {
    children.push(el("div", { class: "view-deadlines-row-detail" }, detailChildren, doc));
  }
  const transition = renderDeadlineTransitionControls(doc, d, api, matterId, refresh);
  if (transition !== null) children.push(transition);
  return el(
    "li",
    { class: "view-deadlines-row", "data-test-id": "view-deadlines-row" },
    children,
    doc,
  );
}

// Per-status deadline status-transition controls (WI-DT3, per the WI-DT2 design
// artifact). Renders nothing for terminal statuses (met / withdrawn). pending ->
// met / missed / withdrawn are single-click (no reason); missed -> met opens a
// two-step required-reason capture (the reason IS the confirmation, mirroring the
// docket-dismiss + fact-reject precedent). The renderer forwards only the narrow
// TransitionDeadlineDto; main injects authority + enforces the edge/reason rules.
// On error: inline role="alert", KEEP the row, re-enable, NO refresh (the WI-D4
// dismiss-error lesson). On success: refresh so the row re-renders in its new state.
function renderDeadlineTransitionControls(
  doc: Document,
  d: DeadlineRow,
  api: CaseBoxApi,
  matterId: string,
  refresh: () => Promise<void>,
): HTMLElement | null {
  if (d.status !== "pending" && d.status !== "missed") return null;

  const error = el(
    "span",
    {
      class: "view-deadlines-transition-error",
      "data-test-id": "view-deadlines-transition-error",
      hidden: "",
    },
    [],
    doc,
  );
  const showError = (msg: string): void => {
    error.setAttribute("role", "alert");
    error.removeAttribute("hidden");
    setText(error, msg);
  };
  const clearError = (): void => {
    error.removeAttribute("role");
    error.setAttribute("hidden", "");
    setText(error, "");
  };

  const mkBtn = (label: string, testId: string): HTMLElement =>
    el("button", { type: "button", class: "view-deadlines-transition-btn", "data-test-id": testId }, [label], doc);

  // Shared submit: forward the narrow dto, surface a transition error inline (keep
  // the row, re-enable via `reEnable`, NO refresh — the WI-D4 lesson), and on
  // success refresh exactly once. A post-success refresh failure is NON-FATAL: the
  // mutation already landed, so it must NOT surface as a transition error or
  // re-enable the now-stale controls (audit L1). The caller disables its controls
  // before calling; on success they stay disabled because the row is replaced.
  const submit = async (dto: TransitionDeadlineDto, reEnable: () => void): Promise<void> => {
    clearError();
    let env: Awaited<ReturnType<typeof api.transitionDeadline>>;
    try {
      env = await api.transitionDeadline(dto);
    } catch {
      showError(t("deadline.transition.updateFailed"));
      reEnable();
      return;
    }
    if (!env.ok) {
      showError(errorMessage(env.error));
      reEnable();
      return;
    }
    try {
      await refresh();
    } catch {
      /* mutation succeeded; a failed reload is non-fatal and must not read as a transition error */
    }
  };

  // No-reason transition (pending -> met/missed/withdrawn). `busy` are the buttons
  // to disable while the call is in flight (re-entrancy guard).
  const runSimple = (to: DeadlineTransitionTarget, busy: HTMLElement[]): Promise<void> => {
    for (const b of busy) b.setAttribute("disabled", "true");
    return submit({ matterId, deadlineId: d.id, to }, () => {
      for (const b of busy) b.removeAttribute("disabled");
    });
  };

  const children: Array<HTMLElement | string> = [];

  if (d.status === "pending") {
    const metBtn = mkBtn(t("deadline.transition.markMet"), "view-deadlines-transition-met");
    const missedBtn = mkBtn(t("deadline.transition.markMissed"), "view-deadlines-transition-missed");
    const withdrawBtn = mkBtn(t("deadline.transition.withdraw"), "view-deadlines-transition-withdrawn");
    const all = [metBtn, missedBtn, withdrawBtn];
    metBtn.addEventListener("click", () => void runSimple("met", all));
    missedBtn.addEventListener("click", () => void runSimple("missed", all));
    withdrawBtn.addEventListener("click", () => void runSimple("withdrawn", all));
    children.push(metBtn, " ", missedBtn, " ", withdrawBtn, " ", error);
  } else {
    // status === "missed": only missed -> met, with a required reason (two-step).
    const metBtn = mkBtn(t("deadline.transition.markMet"), "view-deadlines-transition-met");
    const reasonInput = el(
      "input",
      {
        type: "text",
        class: "view-deadlines-transition-reason",
        "data-test-id": "view-deadlines-transition-reason",
        "aria-label": t("deadline.transition.reasonAria"),
        hidden: "",
      },
      [],
      doc,
    );
    const confirmBtn = el(
      "button",
      { type: "button", class: "view-deadlines-transition-confirm", "data-test-id": "view-deadlines-transition-confirm", hidden: "" },
      [t("deadline.transition.confirm")],
      doc,
    );
    const cancelBtn = el(
      "button",
      { type: "button", class: "view-deadlines-transition-cancel", "data-test-id": "view-deadlines-transition-cancel", hidden: "" },
      [t("deadline.transition.cancel")],
      doc,
    );
    const reveal = (): void => {
      reasonInput.removeAttribute("hidden");
      reasonInput.setAttribute("aria-required", "true");
      confirmBtn.removeAttribute("hidden");
      cancelBtn.removeAttribute("hidden");
      metBtn.setAttribute("hidden", "");
      if (typeof (reasonInput as unknown as { focus?: () => void }).focus === "function") {
        (reasonInput as unknown as { focus: () => void }).focus();
      }
    };
    const collapse = (): void => {
      // Discard any typed reason so reopening the capture cannot submit a stale
      // audit reason (audit M1). The reason is re-entered each time intentionally.
      (reasonInput as unknown as { value: string }).value = "";
      reasonInput.setAttribute("hidden", "");
      confirmBtn.setAttribute("hidden", "");
      cancelBtn.setAttribute("hidden", "");
      metBtn.removeAttribute("hidden");
      if (typeof (metBtn as unknown as { focus?: () => void }).focus === "function") {
        (metBtn as unknown as { focus: () => void }).focus();
      }
    };
    const setBusy = (busy: boolean): void => {
      for (const b of [confirmBtn, cancelBtn]) {
        if (busy) b.setAttribute("disabled", "true");
        else b.removeAttribute("disabled");
      }
    };
    metBtn.addEventListener("click", () => {
      clearError();
      reveal();
    });
    cancelBtn.addEventListener("click", () => {
      clearError();
      collapse();
    });
    confirmBtn.addEventListener("click", () => {
      const reason = ((reasonInput as unknown as { value?: string }).value ?? "").trim();
      if (reason.length === 0) {
        clearError();
        showError(t("deadline.transition.reasonRequired"));
        return;
      }
      setBusy(true);
      void submit(
        { matterId, deadlineId: d.id, to: "met", transition_reason: reason },
        () => setBusy(false),
      );
    });
    children.push(metBtn, " ", reasonInput, " ", confirmBtn, " ", cancelBtn, " ", error);
  }

  return el(
    "div",
    { class: "view-deadlines-transition", "data-test-id": "view-deadlines-transition" },
    children,
    doc,
  );
}

async function loadDeadlines(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  nowMs: number,
  // True only while this load is the newest one. Checked after every await so a
  // superseded load (e.g. overtaken by a post-confirm refresh) cannot mutate the
  // container the newer load already cleared + refilled.
  isCurrent: () => boolean = () => true,
  // Re-run the load after a successful per-row transition so the row re-renders in
  // its new status. Defaults to a no-op for callers that don't transition.
  refresh: () => Promise<void> = async () => {},
): Promise<void> {
  // Clear any prior render so this can refresh in place after a confirm.
  setText(parent, "");
  // Banner sits above the list and summarises urgent counts. Created hidden;
  // shown only once an overdue / due-soon deadline is seen.
  const banner = el(
    "div",
    {
      class: "view-deadlines-banner",
      role: "status",
      "aria-live": "polite",
      "data-test-id": "view-deadlines-banner",
      hidden: "",
    },
    [],
    doc,
  );
  parent.appendChild(banner);
  const list = el(
    "ul",
    { class: "view-deadlines-list", "data-test-id": "view-deadlines-list" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el("p", { "data-test-id": "view-deadlines-loading" }, [t("deadline.loading")], doc);
  parent.appendChild(loading);

  let overdue = 0;
  let dueSoon = 0;

  function refreshBanner(): void {
    if (overdue === 0 && dueSoon === 0) {
      banner.setAttribute("hidden", "");
      return;
    }
    banner.removeAttribute("hidden");
    // Danger styling when anything is overdue; warning otherwise.
    banner.setAttribute(
      "class",
      overdue > 0 ? "view-deadlines-banner view-deadlines-banner--overdue" : "view-deadlines-banner",
    );
    const parts: string[] = [];
    if (overdue > 0) parts.push(t("deadline.banner.overdue", { count: overdue }));
    if (dueSoon > 0) parts.push(t("deadline.banner.dueSoon", { count: dueSoon }));
    setText(banner, parts.join(" · "));
  }

  // Eager-load EVERY page before finalising. Deadlines are sorted due_at ASC
  // across ALL statuses, so a page of old settled (met/missed/withdrawn)
  // deadlines could otherwise sit ahead of — and hide — a later pending overdue
  // one, making the urgency banner silently undercount. A complete overdue
  // picture is the whole point (brief §18: "visible overdue-deadline list"), so
  // partial loading is unsafe here. Per-matter deadline counts are bounded, so
  // exhausting the seek cursor is cheap; if matters ever grow huge, a
  // server-side overdue aggregate (new IPC) would replace this loop.
  // Guard against a malformed/stuck cursor: if listDeadlines ever returns a next_cursor we have
  // already used, the seek is not advancing and an unguarded loop would spin forever, hammering
  // IPC. Track seen cursors and abort with an inline alert instead.
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let total = 0;
  for (;;) {
    const env = await api.listDeadlines({
      matterId,
      ...(cursor !== null ? { cursor } : {}),
    });
    // A newer load has taken over this container — drop this stale response.
    if (!isCurrent()) return;
    if (!env.ok) {
      loading.remove();
      parent.appendChild(
        el("p", { role: "alert", "data-test-id": "view-deadlines-error" }, [errorMessage(env.error)], doc),
      );
      return;
    }
    const page = env.value as ListDeadlinesPage;
    for (const row of page.rows) {
      const urgency = classifyDeadlineUrgency(row.due_at, row.status, nowMs);
      if (urgency === "overdue") overdue += 1;
      else if (urgency === "due-soon") dueSoon += 1;
      list.appendChild(renderDeadlineRow(doc, row, urgency, api, matterId, refresh));
      total += 1;
    }
    cursor = page.next_cursor;
    if (cursor === null) break;
    if (seenCursors.has(cursor)) {
      loading.remove();
      parent.appendChild(
        el(
          "p",
          { role: "alert", "data-test-id": "view-deadlines-error" },
          [t("deadline.error.paginationStuck")],
          doc,
        ),
      );
      return;
    }
    seenCursors.add(cursor);
  }

  loading.remove();
  refreshBanner();
  if (total === 0) {
    parent.appendChild(
      el("p", { "data-test-id": "view-deadlines-empty" }, [t("deadline.empty")], doc),
    );
  }
}
