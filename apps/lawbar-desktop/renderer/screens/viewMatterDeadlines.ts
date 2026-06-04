// Read-only Deadlines section for the matter view (B7 deadline read surface).
// Lazily lists the matter's persisted deadlines. NO create / confirm / dismiss
// / transition — display only. The renderer never imports the service; only the
// human-rendered fields are read, and main is the authoritative validator.
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
import { el, setText } from "../dom.js";
import {
  classifyDeadlineUrgency,
  deadlineUrgencyLabel,
  formatLocalDateTime,
  ulidShort,
  type DeadlineUrgency,
} from "../format.js";

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
  const body = el(
    "div",
    { class: "view-deadlines-body", "data-test-id": "view-deadlines-body" },
    [],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-deadlines-summary" },
    ["Show deadlines"],
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
    void loadDeadlines(body, doc, api, matterId, nowMs ?? Date.now());
  });
  return details;
}

function renderDeadlineRow(doc: Document, d: DeadlineRow, urgency: DeadlineUrgency): HTMLElement {
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
      [`${d.kind} · ${d.status}`],
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
        [deadlineUrgencyLabel(urgency)],
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
        [`rule: ${d.source_rule_citation}`],
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
        [`owner: ${ulidShort(d.owner_user_id)}`],
        doc,
      ),
    );
  }
  const children: Array<HTMLElement> = [meta];
  if (detailChildren.length > 0) {
    children.push(el("div", { class: "view-deadlines-row-detail" }, detailChildren, doc));
  }
  return el(
    "li",
    { class: "view-deadlines-row", "data-test-id": "view-deadlines-row" },
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
): Promise<void> {
  // Banner sits above the list and summarises urgent counts. Created hidden;
  // shown only once an overdue / due-soon deadline is seen.
  const banner = el(
    "div",
    {
      class: "view-deadlines-banner",
      role: "status",
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
  const loading = el("p", { "data-test-id": "view-deadlines-loading" }, ["Loading deadlines…"], doc);
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
    if (overdue > 0) parts.push(`${overdue} overdue`);
    if (dueSoon > 0) parts.push(`${dueSoon} due within 7 days`);
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
    if (!env.ok) {
      loading.remove();
      parent.appendChild(
        el("p", { role: "alert", "data-test-id": "view-deadlines-error" }, [env.error.message], doc),
      );
      return;
    }
    const page = env.value as ListDeadlinesPage;
    for (const row of page.rows) {
      const urgency = classifyDeadlineUrgency(row.due_at, row.status, nowMs);
      if (urgency === "overdue") overdue += 1;
      else if (urgency === "due-soon") dueSoon += 1;
      list.appendChild(renderDeadlineRow(doc, row, urgency));
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
          ["Deadline pagination did not advance (repeated cursor); load aborted."],
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
      el("p", { "data-test-id": "view-deadlines-empty" }, ["No deadlines recorded for this matter."], doc),
    );
  }
}
