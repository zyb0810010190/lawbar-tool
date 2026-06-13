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
  matterTypeLabel,
  statusLabel,
  ulidShort,
} from "../format.js";
import { renderChainHeadDisclosure } from "./viewMatterAudit.js";
import { renderDocumentsDisclosure } from "./viewMatterDocuments.js";
import { renderDeadlinesDisclosure } from "./viewMatterDeadlines.js";
import { renderFactsDisclosure } from "./viewMatterFacts.js";

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
  // Editorial meta strip — monospace eyebrows under the title (id · type ·
  // created). Additive; the authoritative fields stay in the <dl> below.
  const metaStrip = el(
    "div",
    { class: "view-meta-strip", "data-test-id": "view-meta" },
    [
      el("span", { class: "meta-id" }, [ulidShort(row.id)], doc),
      el("span", { class: "meta-pipe" }, [], doc),
      el("span", {}, [matterTypeLabel(row.matter_type)], doc),
      el("span", { class: "meta-pipe" }, [], doc),
      el("span", {}, [statusLabel(row.status)], doc),
    ],
    doc,
  );
  const header = el(
    "header",
    { class: "view-header" },
    [back, titleEl, pill, metaStrip],
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

  // ULID disclosure (full id under a <details>). Lives in the right-column
  // colophon panel below.
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

  // Primary content card — authoritative detail fields + parties (the <dl>
  // keeps its data-test-id + English labels; only the surrounding chrome is new).
  const infoCard = el(
    "section",
    { class: "view-card", "data-test-id": "view-info-card" },
    [
      el(
        "h2",
        { class: "view-card-title" },
        ["Matter details", el("span", { class: "card-eyebrow" }, ["§ DETAIL"], doc)],
        doc,
      ),
      dl,
    ],
    doc,
  );

  // Read-only lazy sections (B2/B6/B7 — internals + lazy <details> behavior
  // unchanged; PR3 only relocates them into the desktop two-column layout).
  const documentsDetails = renderDocumentsDisclosure(doc, deps.api, row.id);
  const deadlinesDetails = renderDeadlinesDisclosure(doc, deps.api, row.id);
  const factsDetails = renderFactsDisclosure(doc, deps.api, row.id);
  const chainHeadDetails = renderChainHeadDisclosure(doc, deps.api, row.id);

  const mainCol = el(
    "div",
    { class: "view-main" },
    [infoCard, documentsDetails, deadlinesDetails, factsDetails],
    doc,
  );

  // Right column — colophon (id/created dispatch) + audit chain + archive zone.
  const colophon = el(
    "aside",
    { class: "colophon" },
    [
      el(
        "div",
        { class: "colophon-header" },
        ["Colophon", el("span", { class: "colophon-marker" }, ["§"], doc)],
        doc,
      ),
      el(
        "div",
        { class: "colophon-body" },
        [
          el(
            "div",
            { class: "colophon-row" },
            [el("dt", {}, ["Created"], doc), el("dd", {}, [formatLocalDateTime(row.created_at)], doc)],
            doc,
          ),
          el(
            "div",
            { class: "colophon-row" },
            [el("dt", {}, ["Matter ID"], doc), el("dd", {}, [fullIdDetails], doc)],
            doc,
          ),
        ],
        doc,
      ),
    ],
    doc,
  );

  // Archive affordance: a danger-zone pull card for active matters; a quiet
  // marker for archived ones. (Archive button keeps its data-test-id + nav.)
  let archiveBlock: HTMLElement;
  let archiveBtn: HTMLElement | null = null;
  if (row.status === "active") {
    archiveBtn = el(
      "button",
      {
        type: "button",
        class: "button button--danger view-archive-btn",
        "data-test-id": "view-archive",
      },
      ["Archive…"],
      doc,
    );
    archiveBtn.addEventListener("click", () => {
      deps.navigate(buildHash("archive", { id: row.id }));
    });
    archiveBlock = el(
      "section",
      { class: "archive-pull" },
      [
        el("span", { class: "archive-pull-marker" }, ["Danger zone"], doc),
        el(
          "p",
          {},
          ["Archiving locks this matter. The action is recorded in the audit log."],
          doc,
        ),
        archiveBtn,
      ],
      doc,
    );
  } else {
    archiveBlock = el(
      "p",
      { class: "view-archived-marker" },
      ["This matter is archived."],
      doc,
    );
  }

  const aside = el(
    "div",
    { class: "view-aside" },
    [colophon, chainHeadDetails, archiveBlock],
    doc,
  );

  const grid = el(
    "div",
    { class: "view-desktop", "data-test-id": "view-desktop" },
    [mainCol, aside],
    doc,
  );

  const announce = announceRegion(doc);

  root.appendChild(header);
  root.appendChild(grid);
  root.appendChild(announce);

  // Initial focus per §7.4: archive button if active, else back link.
  if (archiveBtn !== null) {
    focusEl(archiveBtn);
  } else {
    focusEl(back);
  }
}
