// Global (cross-matter) overdue-deadline dashboard banner.
// Per dev-memo/design/2026-07-05-global-overdue-dashboard-banner.md +
// WI-GATE3-R2-OVERDUE-DASHBOARD-BANNER-00 (brief §10: a banner shown whenever ANY
// deadline in ANY matter is overdue or due within 7 days, visible when the case-box
// UI opens).
//
// This is a UI-LAYER aggregation over the EXISTING per-matter channels — it adds NO
// new IPC channel, contract, DTO, or persistence query. It lists the active matters
// (casebox:matter:list) and, for each, its deadlines (casebox:deadline:list), then
// classifies every returned row with the REUSED `classifyDeadlineUrgency` from
// format.ts — the urgency rule is NOT reimplemented here.
//
// Distinct from the per-matter urgency banner in screens/viewMatterDeadlines.ts
// (which is unchanged): that one summarises a single matter's deadlines; this one
// summarises overdue + due-soon counts across ALL matters at the app-open home.

import { classifyDeadlineUrgency, DEADLINE_DUE_SOON_WINDOW_MS } from "./format.js";
import { el, setText } from "./dom.js";
import { t } from "./i18n/t.js";
import type { CaseBoxApi } from "./api.js";
import type { IpcEnvelope } from "./types.js";

// Each page stays bounded; the loop below DRAINS to next_cursor === null so a lawyer
// with >200 active matters, or a matter with >200 deadlines, is fully classified. A
// warning banner must never under-report, so a single bounded page is NOT sufficient
// — the drain over the EXISTING per-matter channels adds NO new IPC/persistence query
// (the design forbids a cross-matter aggregation query).
const MATTER_PAGE_LIMIT = 200;
const DEADLINE_PAGE_LIMIT = 200;

// Defensive upper bound on drain iterations per channel. Never expected to trip in
// practice; guards against a misbehaving cursor that never terminates. Because this
// is a non-blocking dashboard banner (not an export), tripping the cap DEGRADES
// gracefully rather than throwing.
const MAX_PAGES = 100000;

// DEADLINE_DUE_SOON_WINDOW_MS is imported (not redefined) so the "due within 7 days"
// window stays identical to the shared urgency rule. Referenced here to bind the
// import to the module's contract; the actual windowing lives in
// classifyDeadlineUrgency.
void DEADLINE_DUE_SOON_WINDOW_MS;

export interface OverdueDashboardBannerDeps {
  readonly api: CaseBoxApi;
  // Injected clock (tests pass a fixed value for determinism). Defaults to Date.now.
  readonly now?: () => number;
  // Injected document (tests pass a mock). Defaults to the global document.
  readonly doc?: Document;
}

// Minimal shapes read at the IPC boundary. Main is the authoritative validator; the
// renderer reads only the fields it needs.
interface MatterRowLite {
  readonly id: string;
}
interface DeadlineRowLite {
  readonly due_at: string;
  readonly status: string;
}
// Every bounded page carries the rows plus the opaque next_cursor (null ends the
// drain). Both channels share this shape at the read boundary.
interface PageLite<Row> {
  readonly rows?: ReadonlyArray<Row>;
  readonly next_cursor?: string | null;
}

// Drain outcome: either the fully-accumulated rows, or a signal to degrade (a read
// returned !ok, the defensive page cap was hit, or a repeated/non-terminating cursor
// was observed). The banner NEVER partially reports — a truncated drain degrades.
type DrainResult<Row> =
  | { readonly ok: true; readonly rows: ReadonlyArray<Row> }
  | { readonly ok: false };

// Follow next_cursor until it is null, accumulating rows. Bounded page size; a
// defensive MAX_PAGES cap + a repeated-cursor guard prevent an infinite loop. On any
// of {read !ok, cap hit, repeated cursor} the result is { ok: false } — the caller
// then renders the degraded banner (this is a non-blocking dashboard, so degrade,
// never throw). Mirrors the drain-safety idiom in src/caseBox/t3CatalogSource.ts,
// but degrades instead of erroring because a missed banner must not break the home.
async function drainPages<Row>(
  fetchPage: (cursor: string | undefined) => Promise<IpcEnvelope<unknown>>,
): Promise<DrainResult<Row>> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const env = await fetchPage(cursor);
    if (!env.ok) return { ok: false };
    const value = env.value as PageLite<Row>;
    for (const row of value.rows ?? []) rows.push(row);
    const next = value.next_cursor ?? null;
    if (next === null) return { ok: true, rows };
    // A cursor already followed means a looping/non-terminating source: stop and
    // degrade rather than spin or report a partial set.
    if (seenCursors.has(next)) return { ok: false };
    seenCursors.add(next);
    cursor = next;
  }
  // Reached the defensive page bound without a null cursor: treat as non-termination.
  return { ok: false };
}

function renderSummary(
  container: HTMLElement,
  doc: Document,
  overdue: number,
  dueSoon: number,
): void {
  // Danger tone when anything is overdue; warning tone otherwise — mirrors the
  // per-matter banner idiom (tokenised colour, no hard-coded colour).
  const cls =
    overdue > 0
      ? "dashboard-overdue-banner dashboard-overdue-banner--overdue"
      : "dashboard-overdue-banner";
  const banner = el(
    "div",
    {
      class: cls,
      role: "status",
      "aria-live": "polite",
      "data-test-id": "overdue-dashboard-banner",
    },
    [t("dashboard.overdue.summary", { overdue, dueSoon })],
    doc,
  );
  setText(container, "");
  container.appendChild(banner);
}

function renderDegraded(container: HTMLElement, doc: Document): void {
  // Non-blocking degraded state: a quiet "couldn't check deadlines" note. The home
  // matter list still renders (this banner is fire-and-forget from listMatters).
  const banner = el(
    "div",
    {
      class: "dashboard-overdue-banner dashboard-overdue-banner--degraded",
      role: "status",
      "aria-live": "polite",
      "data-test-id": "overdue-dashboard-banner-degraded",
    },
    [t("dashboard.overdue.error")],
    doc,
  );
  setText(container, "");
  container.appendChild(banner);
}

// Aggregate overdue + due-soon deadline counts across all ACTIVE matters and render
// a role="status" banner. States:
//   - overdue > 0 or dueSoon > 0 -> summary banner (counts).
//   - both zero                  -> render nothing (container left empty / hidden).
//   - any read !ok OR a throw    -> non-blocking degraded banner; NEVER throws out.
export async function mountOverdueDashboardBanner(
  container: HTMLElement,
  deps: OverdueDashboardBannerDeps,
): Promise<void> {
  const doc = deps.doc ?? document;
  const nowMs = (deps.now ?? Date.now)();
  try {
    // Drain ALL active-matter pages — a lawyer with >200 matters must be fully
    // classified, else the banner could under-report.
    const mattersDrain = await drainPages<MatterRowLite>((cursor) =>
      deps.api.listMatters({
        status: "active",
        limit: MATTER_PAGE_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      }),
    );
    if (!mattersDrain.ok) {
      renderDegraded(container, doc);
      return;
    }

    let overdue = 0;
    let dueSoon = 0;
    for (const matter of mattersDrain.rows) {
      // Drain ALL deadline pages for this matter — an overdue/due-soon deadline on a
      // later page must not be silently missed.
      const deadlinesDrain = await drainPages<DeadlineRowLite>((cursor) =>
        deps.api.listDeadlines({
          matterId: matter.id,
          limit: DEADLINE_PAGE_LIMIT,
          ...(cursor !== undefined ? { cursor } : {}),
        }),
      );
      if (!deadlinesDrain.ok) {
        renderDegraded(container, doc);
        return;
      }
      for (const row of deadlinesDrain.rows) {
        const urgency = classifyDeadlineUrgency(row.due_at, row.status, nowMs);
        if (urgency === "overdue") overdue += 1;
        else if (urgency === "due-soon") dueSoon += 1;
      }
    }

    if (overdue === 0 && dueSoon === 0) {
      // Hidden: no all-clear chrome for v1 (design §4). Leave the container empty.
      return;
    }
    renderSummary(container, doc, overdue, dueSoon);
  } catch {
    // A banner failure must never break the home surface.
    renderDegraded(container, doc);
  }
}
