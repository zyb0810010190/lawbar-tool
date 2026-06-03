// Audit chain-head + audit-event-log disclosure for the matter view.
// Extracted from viewMatter.ts (mechanical move, no behavior change) so the
// screen stays comfortably below the loc-guardian 800-LOC fail threshold as
// more entity sections are added. Read-only; loads lazily on first <details>
// click. The renderer never imports the service; only the human-rendered
// fields are read, and main is the authoritative validator.

import type { CaseBoxApi } from "../api.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime, hashTruncate, ulidShort } from "../format.js";

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
    { "data-test-id": "view-chain-summary" },
    ["Show audit chain head"],
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
  setText(body, "Loading audit chain head…");
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
        ["No audit events recorded yet."],
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
      ...(copyAvail
        ? {}
        : {
            disabled: true,
            title: "Copy unavailable in this context.",
          }),
    },
    ["Copy"],
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
      el("span", { class: "view-chain-label" }, ["Head hash:"], doc),
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
          el("summary", {}, ["Show full hash"], doc),
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
              ["Last event:"],
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
                el("summary", {}, ["Show full event id"], doc),
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
      el("span", { class: "view-chain-label" }, ["Event count:"], doc),
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
        [ev.action],
        doc,
      ),
    ],
    doc,
  );
  const detailChildren: Array<HTMLElement | string> = [
    el(
      "span",
      { class: "view-audit-entity" },
      [`${ev.entity_type} · ${ulidShort(ev.entity_id)}`],
      doc,
    ),
  ];
  if (ev.reason !== undefined && ev.reason.length > 0) {
    detailChildren.push(
      " ",
      el(
        "span",
        { class: "view-audit-reason", "data-test-id": "view-audit-reason" },
        [`reason: ${ev.reason}`],
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
    el("div", { class: "view-audit-heading" }, ["Audit events"], doc),
  );
  const list = el(
    "ol",
    { class: "view-audit-list", "data-test-id": "view-audit-list" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el(
    "p",
    { "data-test-id": "view-audit-loading" },
    ["Loading audit events…"],
    doc,
  );
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;

  async function loadPage(): Promise<void> {
    const env = await api.listAuditEvents({
      matterId,
      ...(cursor !== null ? { cursor } : {}),
    });
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
        },
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
