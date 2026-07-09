// Audit chain-head + audit-event-log disclosure for the matter view.
// Extracted from viewMatter.ts (mechanical move, no behavior change) so the
// screen stays comfortably below the loc-guardian 800-LOC fail threshold as
// more entity sections are added. Read-only; loads lazily on first <details>
// click. The renderer never imports the service; only the human-rendered
// fields are read, and main is the authoritative validator.

import type { CaseBoxApi } from "../api.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime, hashTruncate, ulidShort } from "../format.js";
import { t } from "../i18n/t.js";
import {
  auditEntityTypeLabel,
  eventKindLabel,
  isKnownAuditEventKind,
} from "../i18n/labels.js";

// Humanized zh-CN label for an audit row. A known event_kind resolves via the shared eventKindLabel
// facade (catalog eventKind.* keys); a null / missing / unknown kind falls back to the raw `action`
// (the row's entity detail supplies the "· entity_type" half). isKnownAuditEventKind is the membership
// guard over the audit event-kind set (renderer/i18n/labels.ts) — it also narrows `kind` to
// CaseBoxAuditEventKind so eventKindLabel is called safely. Never infers a transition kind.
function auditEventLabel(ev: { readonly action: string; readonly event_kind?: string }): string {
  const kind = ev.event_kind;
  if (kind !== undefined && kind !== null && isKnownAuditEventKind(kind)) {
    return eventKindLabel(kind);
  }
  return ev.action;
}

interface AuditChainHead {
  readonly headHash: string | null;
  readonly lastEventId: string | null;
  readonly count: number;
}

interface AuditEventRow {
  readonly timestamp: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly reason?: string;
  // v2 (WI-U1 projection): the normalized kind the panel humanizes; absent on legacy v1 rows.
  readonly event_kind?: string;
}

interface ListAuditEventsPage {
  readonly rows: ReadonlyArray<AuditEventRow>;
  readonly next_cursor: string | null;
}

function clipboardAvailable(): boolean {
  if (typeof navigator === "undefined" || navigator === null) return false;
  const nav = navigator as { clipboard?: { writeText?: unknown } };
  return (
    nav.clipboard !== undefined &&
    typeof nav.clipboard.writeText === "function"
  );
}

export function renderChainHeadDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): HTMLElement {
  const body = el(
    "div",
    { class: "view-chain-body", "data-test-id": "view-chain-body" },
    [],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-chain-summary", "aria-label": t("audit.chainHead.summaryAria") },
    [t("audit.chainHead.summary")],
    doc,
  );
  const details = el(
    "details",
    { class: "view-chain-details", "data-test-id": "view-chain-details" },
    [summary, body],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void loadChainHead(body, doc, api, matterId);
  });
  return details;
}

async function loadChainHead(
  body: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  setText(body, t("audit.chainHead.loading"));
  const env = await api.chainHead({ matterId });
  setText(body, "");
  if (!env.ok) {
    body.appendChild(
      el(
        "p",
        { role: "alert", "data-test-id": "view-chain-error" },
        [env.error.message],
        doc,
      ),
    );
    return;
  }
  const head = env.value as AuditChainHead | null;
  if (
    head === null ||
    head.count === 0 ||
    head.headHash === null
  ) {
    body.appendChild(
      el(
        "p",
        { "data-test-id": "view-chain-empty" },
        [t("audit.chainHead.empty")],
        doc,
      ),
    );
    return;
  }

  const truncated = hashTruncate(head.headHash);
  const copyAvail = clipboardAvailable();
  const copyBtn = el(
    "button",
    {
      type: "button",
      class: "view-chain-copy",
      "data-test-id": "view-chain-copy",
      "aria-label": t("audit.copyHash.aria"),
      ...(copyAvail
        ? {}
        : {
            disabled: true,
            title: t("audit.copyHash.unavailable"),
          }),
    },
    [t("audit.copyHash.button")],
    doc,
  );
  if (copyAvail) {
    copyBtn.addEventListener("click", () => {
      const nav = navigator as { clipboard: { writeText: (s: string) => Promise<void> } };
      void nav.clipboard.writeText(head.headHash as string);
    });
  }

  const headHashLine = el(
    "div",
    { class: "view-chain-headhash", "data-test-id": "view-chain-headhash" },
    [
      el("span", { class: "view-chain-label" }, [t("audit.chainHead.headHashLabel")], doc),
      " ",
      el(
        "code",
        { "data-test-id": "view-chain-headhash-truncated" },
        [truncated],
        doc,
      ),
      " ",
      copyBtn,
      el(
        "details",
        {},
        [
          el("summary", {}, [t("audit.chainHead.showFullHash")], doc),
          el(
            "code",
            { "data-test-id": "view-chain-headhash-full" },
            [head.headHash],
            doc,
          ),
        ],
        doc,
      ),
    ],
    doc,
  );

  const lastEventLine =
    head.lastEventId !== null
      ? el(
          "div",
          { class: "view-chain-lastevent" },
          [
            el(
              "span",
              { class: "view-chain-label" },
              [t("audit.chainHead.lastEventLabel")],
              doc,
            ),
            " ",
            el(
              "code",
              { "data-test-id": "view-chain-lastevent-short" },
              [ulidShort(head.lastEventId)],
              doc,
            ),
            el(
              "details",
              {},
              [
                el("summary", {}, [t("audit.chainHead.showFullEventId")], doc),
                el(
                  "code",
                  { "data-test-id": "view-chain-lastevent-full" },
                  [head.lastEventId],
                  doc,
                ),
              ],
              doc,
            ),
          ],
          doc,
        )
      : null;

  const countLine = el(
    "div",
    { class: "view-chain-count" },
    [
      el("span", { class: "view-chain-label" }, [t("audit.chainHead.countLabel")], doc),
      " ",
      el(
        "code",
        { "data-test-id": "view-chain-count" },
        [String(head.count)],
        doc,
      ),
    ],
    doc,
  );

  body.appendChild(headHashLine);
  if (lastEventLine !== null) body.appendChild(lastEventLine);
  body.appendChild(countLine);

  // The full ordered audit-event log loads in the same disclosure (read-only).
  await loadAuditEvents(body, doc, api, matterId);
}

function renderAuditEventRow(doc: Document, ev: AuditEventRow): HTMLElement {
  const meta = el(
    "div",
    { class: "view-audit-event-meta" },
    [
      el(
        "span",
        { class: "view-audit-time", "data-test-id": "view-audit-time" },
        [formatLocalDateTime(ev.timestamp)],
        doc,
      ),
      " ",
      el(
        "span",
        { class: "view-audit-action", "data-test-id": "view-audit-action" },
        // Humanized label for a known event_kind; raw action (with the entity detail's "· entity_type")
        // for legacy / null / unknown kinds. Plain text → part of the accessible row name; the audit
        // list's aria-live="polite" announces it.
        [auditEventLabel(ev)],
        doc,
      ),
    ],
    doc,
  );
  const detailChildren: Array<HTMLElement | string> = [
    el(
      "span",
      { class: "view-audit-entity" },
      [`${auditEntityTypeLabel(ev.entity_type)} · ${ulidShort(ev.entity_id)}`],
      doc,
    ),
  ];
  if (ev.reason !== undefined && ev.reason.length > 0) {
    detailChildren.push(
      " ",
      el(
        "span",
        { class: "view-audit-reason", "data-test-id": "view-audit-reason" },
        [t("audit.events.reason", { reason: ev.reason })],
        doc,
      ),
    );
  }
  const detail = el("div", { class: "view-audit-event-detail" }, detailChildren, doc);
  return el(
    "li",
    { class: "view-audit-event", "data-test-id": "view-audit-event" },
    [meta, detail],
    doc,
  );
}

async function loadAuditEvents(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  parent.appendChild(
    el("div", { class: "view-audit-heading" }, [t("audit.events.heading")], doc),
  );
  const list = el(
    "ol",
    { class: "view-audit-list", "data-test-id": "view-audit-list", "aria-live": "polite" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el(
    "p",
    { "data-test-id": "view-audit-loading" },
    [t("audit.events.loading")],
    doc,
  );
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;
  let pageLoading = false; // re-entrancy guard: a fast double-click on "Show more" must not fetch/append a page twice

  async function loadPage(): Promise<void> {
    if (pageLoading) return; // a page fetch is already in flight — drop the concurrent call
    pageLoading = true;
    // Visibly suppress the in-flight Show-more (the guard already drops the concurrent call).
    if (moreBtn !== null) moreBtn.setAttribute("disabled", "");
    let env: Awaited<ReturnType<typeof api.listAuditEvents>>;
    try {
      env = await api.listAuditEvents({
        matterId,
        ...(cursor !== null ? { cursor } : {}),
      });
    } finally {
      pageLoading = false;
      // Re-enable the in-flight Show-more even if the fetch rejected out-of-contract,
      // so a transport-level throw cannot leave pagination permanently wedged (a normal
      // failure returns { ok: false } and is handled below; this guards the throw path).
      if (moreBtn !== null) moreBtn.removeAttribute("disabled");
    }
    loading.remove();
    if (moreBtn !== null) {
      moreBtn.remove();
      moreBtn = null;
    }
    if (!env.ok) {
      parent.appendChild(
        el(
          "p",
          { role: "alert", "data-test-id": "view-audit-error" },
          [env.error.message],
          doc,
        ),
      );
      return;
    }
    const page = env.value as ListAuditEventsPage;
    for (const ev of page.rows) {
      list.appendChild(renderAuditEventRow(doc, ev));
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "view-audit-more",
          "data-test-id": "view-audit-more",
          "aria-label": t("audit.events.showMoreAria"),
        },
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
