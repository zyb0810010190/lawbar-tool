// Archive-matter confirmation screen. Per dev-memo/plan-casebox-ui-plan-00.md
// rev-0.1 §6.4.
//
// Mutation is gated by explicit user submit. Before showing the confirmation
// form the screen fetches the matter so the header can display the matter
// name AND so it can defensively short-circuit when the matter is already
// archived.

import type { CaseBoxApi } from "../api.js";
import type { MatterStatus, MatterType } from "../types.js";
import { announce, el, focusEl, setText } from "../dom.js";
import { buildHash, parseHash } from "../router.js";
import { t } from "../i18n/t.js";

interface ArchiveMatterRow {
  readonly id: string;
  readonly name: string;
  readonly matter_type: MatterType;
  readonly status: MatterStatus;
}

const REASON_MIN_LENGTH = 10;
const REASON_MAX_LENGTH = 500;

export interface ArchiveMatterDeps {
  readonly api: CaseBoxApi;
  readonly navigate: (hash: string) => void;
  readonly doc?: Document;
}

function isValidMatterId(id: string): boolean {
  return parseHash(`#/matters/${id}`).name === "view";
}

function backLink(
  deps: ArchiveMatterDeps,
  doc: Document,
  target: "list" | "view",
  matterId: string,
): HTMLElement {
  const href =
    target === "list"
      ? buildHash("list")
      : buildHash("view", { id: matterId });
  const text = target === "list" ? t("matterArchive.backToMatters") : t("matterArchive.backToMatter");
  const link = el(
    "a",
    {
      href,
      class: "back-link",
      "data-test-id": `archive-back-link-${target}`,
    },
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

export async function mountArchiveMatter(
  root: HTMLElement,
  deps: ArchiveMatterDeps,
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
    renderEnvelopeError(root, doc, deps, matterId, env.error.message);
    return;
  }
  if (env.value === null) {
    renderNotFound(root, doc, deps);
    return;
  }

  const row = env.value as ArchiveMatterRow;
  if (row.status === "archived") {
    renderAlreadyArchived(root, doc, deps, row);
    return;
  }

  renderConfirmation(root, doc, deps, row);
}

function renderInvalidId(
  root: HTMLElement,
  doc: Document,
  deps: ArchiveMatterDeps,
): void {
  setText(root, "");
  const link = backLink(deps, doc, "list", "");
  root.appendChild(
    el(
      "section",
      { class: "archive-error", "data-test-id": "archive-invalid-id" },
      [
        el("h1", {}, [t("matterArchive.notFoundTitle")], doc),
        el(
          "p",
          { role: "alert" },
          [t("matterArchive.invalidIdBody")],
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
  deps: ArchiveMatterDeps,
  matterId: string,
): void {
  setText(root, "");
  root.appendChild(backLink(deps, doc, "view", matterId));
  root.appendChild(
    el(
      "p",
      { class: "archive-loading", "data-test-id": "archive-loading" },
      [t("matterArchive.loading")],
      doc,
    ),
  );
}

function renderEnvelopeError(
  root: HTMLElement,
  doc: Document,
  deps: ArchiveMatterDeps,
  matterId: string,
  safeMessage: string,
): void {
  setText(root, "");
  const link = backLink(deps, doc, "view", matterId);
  root.appendChild(
    el(
      "section",
      { class: "archive-error", "data-test-id": "archive-envelope-error" },
      [
        el("h1", {}, [t("matterArchive.unavailableTitle")], doc),
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
  deps: ArchiveMatterDeps,
): void {
  setText(root, "");
  const link = backLink(deps, doc, "list", "");
  root.appendChild(
    el(
      "section",
      { class: "archive-error", "data-test-id": "archive-not-found" },
      [
        el("h1", {}, [t("matterArchive.notFoundTitle")], doc),
        el(
          "p",
          {},
          [
            t("matterArchive.staleLinkBody"),
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

function renderAlreadyArchived(
  root: HTMLElement,
  doc: Document,
  deps: ArchiveMatterDeps,
  row: ArchiveMatterRow,
): void {
  setText(root, "");
  const link = backLink(deps, doc, "view", row.id);
  root.appendChild(
    el(
      "section",
      {
        class: "archive-already-archived",
        "data-test-id": "archive-already-archived",
      },
      [
        el(
          "h1",
          { "data-test-id": "archive-already-title" },
          [t("matterArchive.alreadyTitle", { name: row.name })],
          doc,
        ),
        el(
          "p",
          {},
          [
            t("matterArchive.alreadyBody"),
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

function renderConfirmation(
  root: HTMLElement,
  doc: Document,
  deps: ArchiveMatterDeps,
  row: ArchiveMatterRow,
): void {
  setText(root, "");

  const back = backLink(deps, doc, "view", row.id);
  const title = el(
    "h1",
    { class: "archive-title", "data-test-id": "archive-title" },
    [t("matterArchive.title", { name: row.name })],
    doc,
  );
  const warning = el(
    "p",
    { class: "archive-warning" },
    [
      t("matterArchive.warning"),
    ],
    doc,
  );

  const formError = el(
    "p",
    {
      class: "form-error",
      role: "alert",
      "data-test-id": "archive-form-error",
      hidden: true,
    },
    [],
    doc,
  );

  const statusRegion = el(
    "div",
    {
      role: "status",
      "aria-live": "polite",
      class: "visually-hidden",
      "data-test-id": "archive-status",
    },
    [],
    doc,
  );

  const reasonTextarea = doc.createElement("textarea");
  reasonTextarea.setAttribute("id", "am-reason");
  reasonTextarea.setAttribute("required", "");
  reasonTextarea.setAttribute("rows", "4");
  reasonTextarea.setAttribute("minlength", String(REASON_MIN_LENGTH));
  reasonTextarea.setAttribute("maxlength", String(REASON_MAX_LENGTH));
  let reasonValue = "";
  reasonTextarea.addEventListener("input", (event) => {
    const t = (event as Event & { target?: { value?: unknown } }).target;
    reasonValue = String(t?.value ?? "");
  });

  const reasonLabel = el(
    "label",
    { for: "am-reason" },
    [t("matterArchive.reasonLabel", { min: REASON_MIN_LENGTH, max: REASON_MAX_LENGTH })],
    doc,
  );

  const submitBtn = el(
    "button",
    {
      type: "submit",
      class: "button button--danger archive-submit-btn",
      "data-test-id": "archive-submit",
    },
    [t("matterArchive.submit")],
    doc,
  );
  const cancelBtn = el(
    "button",
    {
      type: "button",
      class: "button archive-cancel-btn",
      "data-test-id": "archive-cancel",
    },
    [t("matterArchive.cancel")],
    doc,
  );
  cancelBtn.addEventListener("click", () => {
    deps.navigate(buildHash("view", { id: row.id }));
  });

  let submitting = false;
  async function handleSubmit(): Promise<void> {
    if (submitting) return;
    formError.setAttribute("hidden", "");
    setText(formError, "");
    const trimmed = reasonValue.trim();
    if (trimmed.length < REASON_MIN_LENGTH) {
      formError.removeAttribute("hidden");
      setText(
        formError,
        t("matterArchive.error.reasonTooShort", { min: REASON_MIN_LENGTH }),
      );
      focusEl(reasonTextarea);
      return;
    }
    if (trimmed.length > REASON_MAX_LENGTH) {
      formError.removeAttribute("hidden");
      setText(
        formError,
        t("matterArchive.error.reasonTooLong", { max: REASON_MAX_LENGTH }),
      );
      focusEl(reasonTextarea);
      return;
    }

    submitting = true;
    submitBtn.setAttribute("disabled", "");
    announce(statusRegion, t("matterArchive.status.archiving"));

    const envSubmit = await deps.api.archiveMatter({
      matterId: row.id,
      reason: trimmed,
    });
    submitting = false;
    submitBtn.removeAttribute("disabled");

    if (!envSubmit.ok) {
      formError.removeAttribute("hidden");
      setText(formError, envSubmit.error.message);
      announce(statusRegion, t("matterArchive.status.error", { message: envSubmit.error.message }));
      return;
    }
    announce(statusRegion, t("matterArchive.status.archived"));
    deps.navigate(buildHash("view", { id: row.id }));
  }

  submitBtn.addEventListener("click", (event) => {
    const e = event as Event & { preventDefault?: () => void };
    if (typeof e.preventDefault === "function") e.preventDefault();
    void handleSubmit();
  });

  const form = el(
    "form",
    {
      class: "archive-matter-form",
      novalidate: true,
      "data-test-id": "archive-form",
    },
    [
      el(
        "div",
        { class: "field" },
        [reasonLabel, reasonTextarea],
        doc,
      ),
      el(
        "div",
        { class: "form-actions" },
        [submitBtn, cancelBtn],
        doc,
      ),
    ],
    doc,
  );
  // Wire the form's `submit` event so Enter-in-input triggers the same path
  // as a button click (per audit M2 + §7.4 Enter-to-submit). Without this,
  // the browser default would attempt to navigate the page.
  form.addEventListener("submit", (event) => {
    const e = event as Event & { preventDefault?: () => void };
    if (typeof e.preventDefault === "function") e.preventDefault();
    void handleSubmit();
  });

  root.appendChild(back);
  root.appendChild(title);
  root.appendChild(warning);
  root.appendChild(formError);
  root.appendChild(form);
  root.appendChild(statusRegion);

  focusEl(reasonTextarea);
}
