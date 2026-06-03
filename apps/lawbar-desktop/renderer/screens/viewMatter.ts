// View-matter screen. Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.3.
//
// Read-only detail view. Validates the supplied id against the router's ULID
// regex BEFORE making any IPC call (rejects garbage routes without round-trip
// to main). Audit chain head is loaded LAZILY on first <details> click.

import type { CaseBoxApi } from "../api.js";
import type {
  ConfidentialityClass,
  MatterStatus,
  MatterType,
  Party,
} from "../types.js";
import { el, focusEl, setText } from "../dom.js";
import { buildHash, parseHash } from "../router.js";
import {
  confidentialityLabel,
  formatLocalDateTime,
  hashTruncate,
  matterTypeLabel,
  statusLabel,
  ulidShort,
} from "../format.js";

interface ViewMatterRow {
  readonly id: string;
  readonly name: string;
  readonly matter_type: MatterType;
  readonly jurisdiction: { readonly value: string; readonly locked: boolean };
  readonly parties: ReadonlyArray<Party>;
  readonly confidentiality_class: ConfidentialityClass;
  readonly created_at: string;
  readonly status: MatterStatus;
  readonly archived_at?: string | null;
  readonly retainer_scope?: string;
  readonly case_type_text?: string;
  readonly case_progress_text?: string;
  readonly court_contact_text?: string;
  readonly contention_summary_text?: string;
}

interface AuditChainHead {
  readonly headHash: string | null;
  readonly lastEventId: string | null;
  readonly count: number;
}

// Minimal structural shape of a persisted audit event row (the renderer never
// imports the service; field-name drift is a non-issue because only these
// human-rendered fields are read, and main is the authoritative validator).
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

export interface ViewMatterDeps {
  readonly api: CaseBoxApi;
  readonly navigate: (hash: string) => void;
  readonly doc?: Document;
}

// Reuse the router's ULID validation by parsing a synthetic view hash.
// Avoids duplicating the regex; zero changes to router.ts.
function isValidMatterId(id: string): boolean {
  return parseHash(`#/matters/${id}`).name === "view";
}

function backLink(deps: ViewMatterDeps, doc: Document): HTMLElement {
  const link = el(
    "a",
    {
      href: buildHash("list"),
      class: "back-link",
      "data-test-id": "view-back-link",
    },
    ["← Back to matters"],
    doc,
  );
  link.addEventListener("click", (event) => {
    const e = event as Event & { preventDefault?: () => void };
    if (typeof e.preventDefault === "function") e.preventDefault();
    deps.navigate(buildHash("list"));
  });
  return link;
}

function announceRegion(doc: Document): HTMLElement {
  return el(
    "div",
    {
      role: "status",
      "aria-live": "polite",
      class: "visually-hidden",
      "data-test-id": "view-announce",
    },
    [],
    doc,
  );
}

export async function mountViewMatter(
  root: HTMLElement,
  deps: ViewMatterDeps,
  matterId: string,
): Promise<void> {
  const doc = deps.doc ?? document;

  if (!isValidMatterId(matterId)) {
    renderInvalidId(root, doc, deps);
    return;
  }

  renderLoading(root, doc, deps);

  const env = await deps.api.getMatter({ matterId });
  if (!env.ok) {
    renderEnvelopeError(root, doc, deps, env.error.message);
    return;
  }
  if (env.value === null) {
    renderNotFound(root, doc, deps);
    return;
  }

  renderDetail(root, doc, deps, env.value as ViewMatterRow);
}

function renderInvalidId(
  root: HTMLElement,
  doc: Document,
  deps: ViewMatterDeps,
): void {
  setText(root, "");
  const link = backLink(deps, doc);
  root.appendChild(
    el(
      "section",
      { class: "view-error", "data-test-id": "view-invalid-id" },
      [
        el("h1", {}, ["Matter not found"], doc),
        el(
          "p",
          { role: "alert" },
          ["The matter ID is malformed or unknown."],
          doc,
        ),
        link,
      ],
      doc,
    ),
  );
  focusEl(link);
}

function renderLoading(
  root: HTMLElement,
  doc: Document,
  deps: ViewMatterDeps,
): void {
  setText(root, "");
  root.appendChild(backLink(deps, doc));
  root.appendChild(
    el(
      "p",
      { class: "view-loading", "data-test-id": "view-loading" },
      ["Loading matter…"],
      doc,
    ),
  );
}

function renderEnvelopeError(
  root: HTMLElement,
  doc: Document,
  deps: ViewMatterDeps,
  safeMessage: string,
): void {
  setText(root, "");
  const link = backLink(deps, doc);
  root.appendChild(
    el(
      "section",
      { class: "view-error", "data-test-id": "view-envelope-error" },
      [
        el("h1", {}, ["Matter unavailable"], doc),
        el("p", { role: "alert" }, [safeMessage], doc),
        link,
      ],
      doc,
    ),
  );
  focusEl(link);
}

function renderNotFound(
  root: HTMLElement,
  doc: Document,
  deps: ViewMatterDeps,
): void {
  setText(root, "");
  const link = backLink(deps, doc);
  root.appendChild(
    el(
      "section",
      { class: "view-error", "data-test-id": "view-not-found" },
      [
        el("h1", {}, ["Matter not found"], doc),
        el(
          "p",
          {},
          [
            "The link may be out of date.",
          ],
          doc,
        ),
        link,
      ],
      doc,
    ),
  );
  focusEl(link);
}

function renderField(
  label: string,
  valueChild: Node | string,
  doc: Document,
): HTMLElement {
  return el(
    "div",
    { class: "view-field" },
    [
      el("dt", {}, [label], doc),
      el("dd", {}, [valueChild], doc),
    ],
    doc,
  );
}

function renderJurisdictionValue(
  jurisdiction: { value: string; locked: boolean },
  doc: Document,
): HTMLElement {
  const lockedMarker = jurisdiction.locked ? " (locked)" : "";
  return el(
    "span",
    {},
    [`${jurisdiction.value}${lockedMarker}`],
    doc,
  );
}

function renderParties(
  parties: ReadonlyArray<Party>,
  doc: Document,
): HTMLElement {
  const list = el(
    "ul",
    { class: "view-parties-list", "data-test-id": "view-parties" },
    [],
    doc,
  );
  for (const p of parties) {
    const lines: Array<Node | string> = [
      el(
        "div",
        { class: "party-role" },
        [`${p.role} — ${p.display_name} (${p.party_kind})`],
        doc,
      ),
    ];
    if (p.notes !== undefined && p.notes !== "") {
      lines.push(el("div", { class: "party-notes" }, [p.notes], doc));
    }
    list.appendChild(el("li", { class: "view-party-row" }, lines, doc));
  }
  return list;
}

function renderDetail(
  root: HTMLElement,
  doc: Document,
  deps: ViewMatterDeps,
  row: ViewMatterRow,
): void {
  setText(root, "");

  const back = backLink(deps, doc);
  const pill = el(
    "span",
    { class: `status-pill status-pill--${row.status}` },
    [statusLabel(row.status)],
    doc,
  );
  const titleEl = el(
    "h1",
    { class: "view-title", "data-test-id": "view-title" },
    [row.name],
    doc,
  );
  const header = el(
    "header",
    { class: "view-header" },
    [back, titleEl, pill],
    doc,
  );

  // Detail fields list (<dl>).
  const dl = el(
    "dl",
    { class: "view-fields", "data-test-id": "view-fields" },
    [
      renderField("Matter type", matterTypeLabel(row.matter_type), doc),
      renderField(
        "Jurisdiction",
        renderJurisdictionValue(row.jurisdiction, doc),
        doc,
      ),
      renderField(
        "Confidentiality",
        confidentialityLabel(row.confidentiality_class),
        doc,
      ),
      renderField("Created", formatLocalDateTime(row.created_at), doc),
    ],
    doc,
  );

  // Archived-at line + audit-reason copy (per L1).
  if (
    row.status === "archived" &&
    typeof row.archived_at === "string" &&
    row.archived_at !== ""
  ) {
    dl.appendChild(
      renderField("Archived at", formatLocalDateTime(row.archived_at), doc),
    );
    dl.appendChild(
      renderField(
        "Archive reason",
        "Reason recorded in audit log.",
        doc,
      ),
    );
  }

  // Optional free-text fields (only when non-empty after trim).
  const optionals: Array<[string, string | undefined]> = [
    ["Retainer scope", row.retainer_scope],
    ["Case type", row.case_type_text],
    ["Case progress", row.case_progress_text],
    ["Court contact", row.court_contact_text],
    ["Contention summary", row.contention_summary_text],
  ];
  for (const [label, value] of optionals) {
    if (value !== undefined && value.trim() !== "") {
      dl.appendChild(renderField(label, value, doc));
    }
  }

  // Parties.
  dl.appendChild(renderField("Parties", renderParties(row.parties, doc), doc));

  // Action buttons.
  let primaryAction: HTMLElement;
  if (row.status === "active") {
    primaryAction = el(
      "button",
      {
        type: "button",
        class: "button button--primary view-archive-btn",
        "data-test-id": "view-archive",
      },
      ["Archive…"],
      doc,
    );
    primaryAction.addEventListener("click", () => {
      deps.navigate(buildHash("archive", { id: row.id }));
    });
  } else {
    // Archived: no archive button. Primary affordance is the back link.
    primaryAction = el(
      "p",
      { class: "view-archived-marker" },
      ["This matter is archived."],
      doc,
    );
  }

  // ULID disclosure under the title.
  const fullIdDetails = el(
    "details",
    { class: "view-full-id" },
    [
      el(
        "summary",
        { "data-test-id": "view-full-id-summary" },
        [`Matter ID: ${ulidShort(row.id)}`],
        doc,
      ),
      el(
        "code",
        { class: "view-full-id-value", "data-test-id": "view-full-id" },
        [row.id],
        doc,
      ),
    ],
    doc,
  );

  // Audit chain head disclosure.
  const chainHeadDetails = renderChainHeadDisclosure(doc, deps, row.id);

  const announce = announceRegion(doc);

  root.appendChild(header);
  root.appendChild(fullIdDetails);
  root.appendChild(dl);
  root.appendChild(primaryAction);
  root.appendChild(chainHeadDetails);
  root.appendChild(announce);

  // Initial focus per §7.4: archive button if active, else back link.
  if (row.status === "active") {
    focusEl(primaryAction);
  } else {
    focusEl(back);
  }
}

function clipboardAvailable(): boolean {
  if (typeof navigator === "undefined" || navigator === null) return false;
  const nav = navigator as { clipboard?: { writeText?: unknown } };
  return (
    nav.clipboard !== undefined &&
    typeof nav.clipboard.writeText === "function"
  );
}

function renderChainHeadDisclosure(
  doc: Document,
  deps: ViewMatterDeps,
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
    void loadChainHead(body, doc, deps, matterId);
  });
  return details;
}

async function loadChainHead(
  body: HTMLElement,
  doc: Document,
  deps: ViewMatterDeps,
  matterId: string,
): Promise<void> {
  setText(body, "Loading audit chain head…");
  const env = await deps.api.chainHead({ matterId });
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
  await loadAuditEvents(body, doc, deps, matterId);
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
  deps: ViewMatterDeps,
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
    const env = await deps.api.listAuditEvents({
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
