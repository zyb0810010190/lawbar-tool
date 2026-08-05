// Edit-matter screen. Per dev-memo/design/2026-08-05-matter-details-edit-screen.md
// (matter-details-edit Phase D) + dev-memo/plan-matter-details-edit-D-docket.md.
//
// Lets a lawyer correct the 6 free-text descriptive matter fields after creation,
// recording a required court-facing reason on each edit. Mirrors archiveMatter.ts
// (form + required reason + audited IPC + safe-message error mapping + nav-on-success).
// The backend IPC (casebox:matter:updateDetails) is already wired (Phase C); this is
// renderer-only.
//
// Behaviour highlights:
//   - Seeds all 6 fields from getMatter; keeps the seeded snapshot for live
//     dirty-tracking. Submit is enabled only when >= 1 field differs from its seed
//     AND name is non-empty (pre-empts the server no_editable_change / empty-name).
//   - "Changes to be recorded" summary lists the changed field labels live.
//   - The 5 descriptors are clearable ("" is an explicit change); name is required.
//   - Archived matter (direct /edit route): a read-only disabled variant + banner,
//     no reason field, no submit.

import type { CaseBoxApi } from "../api.js";
import type { MatterStatus } from "../types.js";
import { announce, el, focusEl, setText } from "../dom.js";
import { buildHash, parseHash } from "../router.js";
import { t } from "../i18n/t.js";
import type { CatalogId } from "../i18n/catalog.js";
import { errorMessage } from "../i18n/errorMessage.js";

type EditableKey =
  | "name"
  | "retainer_scope"
  | "case_type_text"
  | "case_progress_text"
  | "court_contact_text"
  | "contention_summary_text";

interface EditMatterRow {
  readonly id: string;
  readonly name: string;
  readonly status: MatterStatus;
  readonly retainer_scope?: string;
  readonly case_type_text?: string;
  readonly case_progress_text?: string;
  readonly court_contact_text?: string;
  readonly contention_summary_text?: string;
}

const REASON_MIN_LENGTH = 10;
const REASON_MAX_LENGTH = 500;

// The 6 editable fields, in render order. `name` is a required text input; the 5
// descriptors are clearable textareas. Descriptor labels reuse the read-only
// view's `detail.field.*` keys for consistency.
interface FieldDef {
  readonly key: EditableKey;
  readonly labelKey: CatalogId;
  readonly id: string;
  readonly multiline: boolean;
}

const FIELDS: ReadonlyArray<FieldDef> = [
  { key: "name", labelKey: "matterEdit.field.name", id: "me-name", multiline: false },
  { key: "retainer_scope", labelKey: "detail.field.retainerScope", id: "me-retainer-scope", multiline: true },
  { key: "case_type_text", labelKey: "detail.field.caseType", id: "me-case-type", multiline: true },
  { key: "case_progress_text", labelKey: "detail.field.caseProgress", id: "me-case-progress", multiline: true },
  { key: "court_contact_text", labelKey: "detail.field.courtContact", id: "me-court-contact", multiline: true },
  {
    key: "contention_summary_text",
    labelKey: "detail.field.contentionSummary",
    id: "me-contention-summary",
    multiline: true,
  },
];

export interface EditMatterDeps {
  readonly api: CaseBoxApi;
  readonly navigate: (hash: string) => void;
  readonly doc?: Document;
}

// Reuse the router's ULID validation by parsing a synthetic view hash (no regex
// duplication; zero changes to router.ts).
function isValidMatterId(id: string): boolean {
  return parseHash(`#/matters/${id}`).name === "view";
}

function backLink(
  deps: EditMatterDeps,
  doc: Document,
  target: "list" | "view",
  matterId: string,
): HTMLElement {
  const href = target === "list" ? buildHash("list") : buildHash("view", { id: matterId });
  const text = target === "list" ? t("matterEdit.backToMatters") : t("matterEdit.backToMatter");
  const link = el(
    "a",
    { href, class: "back-link", "data-test-id": `edit-back-link-${target}` },
    [text],
    doc,
  );
  link.addEventListener("click", (event) => {
    const e = event as Event & { preventDefault?: () => void };
    if (typeof e.preventDefault === "function") e.preventDefault();
    deps.navigate(href);
  });
  return link;
}

export async function mountEditMatter(
  root: HTMLElement,
  deps: EditMatterDeps,
  matterId: string,
): Promise<void> {
  const doc = deps.doc ?? document;

  if (!isValidMatterId(matterId)) {
    renderInvalidId(root, doc, deps);
    return;
  }

  renderLoading(root, doc, deps, matterId);

  const env = await deps.api.getMatter({ matterId });
  if (!env.ok) {
    renderEnvelopeError(root, doc, deps, matterId, errorMessage(env.error));
    return;
  }
  if (env.value === null) {
    renderNotFound(root, doc, deps);
    return;
  }

  const row = env.value as EditMatterRow;
  if (row.status !== "active") {
    renderArchivedReadOnly(root, doc, deps, row);
    return;
  }

  renderEditForm(root, doc, deps, row);
}

function renderInvalidId(root: HTMLElement, doc: Document, deps: EditMatterDeps): void {
  setText(root, "");
  const link = backLink(deps, doc, "list", "");
  root.appendChild(
    el(
      "section",
      { class: "edit-error", "data-test-id": "edit-invalid-id" },
      [
        el("h1", {}, [t("matterEdit.notFoundTitle")], doc),
        el("p", { role: "alert" }, [t("matterEdit.invalidIdBody")], doc),
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
  deps: EditMatterDeps,
  matterId: string,
): void {
  setText(root, "");
  root.appendChild(backLink(deps, doc, "view", matterId));
  root.appendChild(
    el(
      "p",
      { class: "edit-loading", "data-test-id": "edit-loading" },
      [t("matterEdit.loading")],
      doc,
    ),
  );
}

function renderEnvelopeError(
  root: HTMLElement,
  doc: Document,
  deps: EditMatterDeps,
  matterId: string,
  safeMessage: string,
): void {
  setText(root, "");
  const link = backLink(deps, doc, "view", matterId);
  root.appendChild(
    el(
      "section",
      { class: "edit-error", "data-test-id": "edit-envelope-error" },
      [
        el("h1", {}, [t("matterEdit.unavailableTitle")], doc),
        el("p", { role: "alert" }, [safeMessage], doc),
        link,
      ],
      doc,
    ),
  );
  focusEl(link);
}

function renderNotFound(root: HTMLElement, doc: Document, deps: EditMatterDeps): void {
  setText(root, "");
  const link = backLink(deps, doc, "list", "");
  root.appendChild(
    el(
      "section",
      { class: "edit-error", "data-test-id": "edit-not-found" },
      [
        el("h1", {}, [t("matterEdit.notFoundTitle")], doc),
        el("p", {}, [t("matterEdit.staleLinkBody")], doc),
        link,
      ],
      doc,
    ),
  );
  focusEl(link);
}

// Seed value for a field from the loaded row: name is always present; descriptors
// default to "" when absent.
function seedValue(row: EditMatterRow, key: EditableKey): string {
  const v = (row as unknown as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

function makeControl(
  def: FieldDef,
  seed: string,
  doc: Document,
  disabled: boolean,
): HTMLInputElement | HTMLTextAreaElement {
  if (def.multiline) {
    const ta = doc.createElement("textarea");
    ta.setAttribute("id", def.id);
    ta.setAttribute("rows", "3");
    ta.setAttribute("data-test-id", `edit-field-${def.key}`);
    // Initial display value; JS state is tracked independently in `current`.
    ta.textContent = seed;
    if (disabled) ta.setAttribute("disabled", "");
    return ta;
  }
  const input = doc.createElement("input");
  input.setAttribute("type", "text");
  input.setAttribute("id", def.id);
  input.setAttribute("data-test-id", `edit-field-${def.key}`);
  input.setAttribute("required", "");
  input.setAttribute("value", seed);
  if (disabled) input.setAttribute("disabled", "");
  return input;
}

function renderArchivedReadOnly(
  root: HTMLElement,
  doc: Document,
  deps: EditMatterDeps,
  row: EditMatterRow,
): void {
  setText(root, "");
  const back = backLink(deps, doc, "view", row.id);
  const title = el(
    "h1",
    { class: "matter-edit-title", "data-test-id": "edit-title" },
    [t("matterEdit.title", { name: row.name })],
    doc,
  );
  const banner = el(
    "p",
    { class: "form-error", role: "alert", "data-test-id": "edit-archived-banner" },
    [t("matterEdit.archivedBanner")],
    doc,
  );

  const fields: HTMLElement[] = FIELDS.map((def) => {
    const control = makeControl(def, seedValue(row, def.key), doc, true);
    return el(
      "div",
      { class: "field" },
      [el("label", { for: def.id }, [t(def.labelKey)], doc), control],
      doc,
    );
  });

  root.appendChild(back);
  root.appendChild(title);
  root.appendChild(banner);
  root.appendChild(
    el("section", { class: "matter-edit-readonly", "data-test-id": "edit-readonly" }, fields, doc),
  );
  focusEl(back);
}

function renderEditForm(
  root: HTMLElement,
  doc: Document,
  deps: EditMatterDeps,
  row: EditMatterRow,
): void {
  setText(root, "");

  const back = backLink(deps, doc, "view", row.id);
  const title = el(
    "h1",
    { class: "matter-edit-title", "data-test-id": "edit-title" },
    [t("matterEdit.title", { name: row.name })],
    doc,
  );

  // Seeded snapshot + live-edited state (tracked in JS, independent of the DOM).
  const seed: Record<EditableKey, string> = {} as Record<EditableKey, string>;
  const current: Record<EditableKey, string> = {} as Record<EditableKey, string>;
  for (const def of FIELDS) {
    const v = seedValue(row, def.key);
    seed[def.key] = v;
    current[def.key] = v;
  }

  const labelByKey = new Map<EditableKey, CatalogId>(FIELDS.map((f) => [f.key, f.labelKey]));

  const formError = el(
    "p",
    { class: "form-error", role: "alert", "data-test-id": "edit-form-error", hidden: true },
    [],
    doc,
  );
  const nameError = el(
    "p",
    { class: "field-hint--error", role: "alert", "data-test-id": "edit-name-error", hidden: true },
    [],
    doc,
  );
  const statusRegion = el(
    "div",
    { role: "status", "aria-live": "polite", class: "visually-hidden", "data-test-id": "edit-status" },
    [],
    doc,
  );

  // "Changes to be recorded" summary — recomputed live against the seed.
  const changesList = el(
    "div",
    { class: "matter-edit-changes-list", "data-test-id": "edit-changes" },
    [],
    doc,
  );

  const submitBtn = el(
    "button",
    { type: "submit", class: "button button--primary edit-submit-btn", "data-test-id": "edit-submit" },
    [t("matterEdit.submit")],
    doc,
  );
  const cancelBtn = el(
    "button",
    { type: "button", class: "button edit-cancel-btn", "data-test-id": "edit-cancel" },
    [t("matterEdit.cancel")],
    doc,
  );
  cancelBtn.addEventListener("click", () => {
    deps.navigate(buildHash("view", { id: row.id }));
  });

  let nameControl: HTMLInputElement | HTMLTextAreaElement | null = null;

  function changedKeys(): EditableKey[] {
    return FIELDS.filter((f) => current[f.key] !== seed[f.key]).map((f) => f.key);
  }

  function renderChangesSummary(changed: EditableKey[]): void {
    setText(changesList, "");
    if (changed.length === 0) {
      changesList.appendChild(
        el(
          "p",
          { class: "matter-edit-changes-none", "data-test-id": "edit-changes-none" },
          [t("matterEdit.changesNone")],
          doc,
        ),
      );
      return;
    }
    const ul = el("ul", { class: "matter-edit-changes-items" }, [], doc);
    for (const key of changed) {
      const labelKey = labelByKey.get(key);
      if (labelKey === undefined) continue;
      ul.appendChild(el("li", { "data-test-id": "edit-changes-item" }, [t(labelKey)], doc));
    }
    changesList.appendChild(ul);
  }

  function updateSubmitState(): void {
    const changed = changedKeys();
    const nameOk = current.name.trim() !== "";
    if (changed.length > 0 && nameOk) submitBtn.removeAttribute("disabled");
    else submitBtn.setAttribute("disabled", "");
    renderChangesSummary(changed);
  }

  // Build the 6 field controls with live input listeners.
  const fieldEls: HTMLElement[] = FIELDS.map((def) => {
    const control = makeControl(def, seed[def.key], doc, false);
    if (def.key === "name") nameControl = control;
    control.addEventListener("input", (event) => {
      const target = (event as Event & { target?: { value?: unknown } }).target;
      current[def.key] = String(target?.value ?? "");
      updateSubmitState();
    });
    const children: Array<Node | string> = [el("label", { for: def.id }, [t(def.labelKey)], doc), control];
    if (def.key === "name") children.push(nameError);
    return el("div", { class: "field" }, children, doc);
  });

  // Reason field (required; bounds mirror archive).
  const reasonTextarea = doc.createElement("textarea");
  reasonTextarea.setAttribute("id", "me-reason");
  reasonTextarea.setAttribute("required", "");
  reasonTextarea.setAttribute("rows", "4");
  reasonTextarea.setAttribute("minlength", String(REASON_MIN_LENGTH));
  reasonTextarea.setAttribute("maxlength", String(REASON_MAX_LENGTH));
  reasonTextarea.setAttribute("data-test-id", "edit-reason");
  let reasonValue = "";
  reasonTextarea.addEventListener("input", (event) => {
    const target = (event as Event & { target?: { value?: unknown } }).target;
    reasonValue = String(target?.value ?? "");
  });
  const reasonLabel = el(
    "label",
    { for: "me-reason" },
    [t("matterEdit.reasonLabel", { min: REASON_MIN_LENGTH, max: REASON_MAX_LENGTH })],
    doc,
  );

  let submitting = false;
  async function handleSubmit(): Promise<void> {
    if (submitting) return;
    formError.setAttribute("hidden", "");
    setText(formError, "");
    nameError.setAttribute("hidden", "");
    setText(nameError, "");

    // Dirty-gate parity: the submit button is disabled when nothing changed, but a
    // form `submit` event (Enter / programmatic) can reach here regardless of button
    // state. Enforce the same invariant so a no-op edit never fires an IPC (pre-empts
    // a spurious no_editable_change on a permanent, court-facing action).
    if (changedKeys().length === 0) {
      return;
    }

    if (current.name.trim() === "") {
      nameError.removeAttribute("hidden");
      setText(nameError, t("matterEdit.error.nameRequired"));
      focusEl(nameControl);
      return;
    }

    const reason = reasonValue.trim();
    if (reason.length < REASON_MIN_LENGTH) {
      formError.removeAttribute("hidden");
      setText(formError, t("matterEdit.error.reasonTooShort", { min: REASON_MIN_LENGTH }));
      focusEl(reasonTextarea);
      return;
    }
    if (reason.length > REASON_MAX_LENGTH) {
      formError.removeAttribute("hidden");
      setText(formError, t("matterEdit.error.reasonTooLong", { max: REASON_MAX_LENGTH }));
      focusEl(reasonTextarea);
      return;
    }

    // Patch carries exactly the 6 editable fields; a cleared descriptor is sent as
    // an explicit "" change. The server canonicalizes + rejects a true no-op, which
    // the dirty-gate already pre-empts.
    const patch = {
      name: current.name,
      retainer_scope: current.retainer_scope,
      case_type_text: current.case_type_text,
      case_progress_text: current.case_progress_text,
      court_contact_text: current.court_contact_text,
      contention_summary_text: current.contention_summary_text,
    };

    submitting = true;
    submitBtn.setAttribute("disabled", "");
    announce(statusRegion, t("matterEdit.status.saving"));

    const envSubmit = await deps.api.updateMatterDetails({ matterId: row.id, patch, reason });
    submitting = false;

    if (!envSubmit.ok) {
      formError.removeAttribute("hidden");
      setText(formError, errorMessage(envSubmit.error));
      updateSubmitState();
      return;
    }
    announce(statusRegion, t("matterEdit.status.saved"));
    deps.navigate(buildHash("view", { id: row.id }));
  }

  submitBtn.addEventListener("click", (event) => {
    const e = event as Event & { preventDefault?: () => void };
    if (typeof e.preventDefault === "function") e.preventDefault();
    void handleSubmit();
  });

  const changesCard = el(
    "section",
    { class: "view-card matter-edit-changes" },
    [
      el("h2", { class: "matter-edit-changes-title" }, [t("matterEdit.changesTitle")], doc),
      changesList,
    ],
    doc,
  );

  const form = el(
    "form",
    { class: "matter-edit-form", novalidate: true, "data-test-id": "edit-form" },
    [
      ...fieldEls,
      changesCard,
      el("div", { class: "field" }, [reasonLabel, reasonTextarea], doc),
      el("div", { class: "form-actions" }, [submitBtn, cancelBtn], doc),
    ],
    doc,
  );
  form.addEventListener("submit", (event) => {
    const e = event as Event & { preventDefault?: () => void };
    if (typeof e.preventDefault === "function") e.preventDefault();
    void handleSubmit();
  });

  root.appendChild(back);
  root.appendChild(title);
  root.appendChild(formError);
  root.appendChild(form);
  root.appendChild(statusRegion);

  // Initial state: nothing changed yet -> submit disabled + "no changes" summary.
  updateSubmitState();
  focusEl(nameControl);
}
