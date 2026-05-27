// Create-matter screen. Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.2.
//
// State-driven form: an internal `state` object is the source of truth; each
// input event updates state. Validation runs at submit time only (per D10).
// Parties[] supports add/remove with per-row identity tracked by a monotonic
// counter so React-like re-render preserves sibling values.

import type { CaseBoxApi } from "../api.js";
import type {
  ConfidentialityClass,
  CreateMatterDto,
  MatterType,
  Party,
} from "../types.js";
import { announce, el, field, focusEl, setText } from "../dom.js";
import { buildHash } from "../router.js";

export interface CreateMatterDeps {
  readonly api: CaseBoxApi;
  readonly navigate: (hash: string) => void;
  readonly doc?: Document;
}

interface PartyRow {
  readonly key: number;
  role: string;
  display_name: string;
  party_kind: string;
  notes: string;
}

interface FormState {
  name: string;
  matter_type: MatterType | null;
  jurisdiction_value: string;
  jurisdiction_locked: boolean;
  parties: PartyRow[];
  confidentiality_class: ConfidentialityClass | null;
  retainer_scope: string;
  case_type_text: string;
  case_progress_text: string;
  court_contact_text: string;
  contention_summary_text: string;
}

const NAME_MAX_LENGTH = 200;

export function mountCreateMatter(
  root: HTMLElement,
  deps: CreateMatterDeps,
): void {
  const doc = deps.doc ?? document;
  let partyCounter = 1;

  const state: FormState = {
    name: "",
    matter_type: null,
    jurisdiction_value: "",
    jurisdiction_locked: false,
    parties: [{ key: 0, role: "", display_name: "", party_kind: "", notes: "" }],
    confidentiality_class: null,
    retainer_scope: "",
    case_type_text: "",
    case_progress_text: "",
    court_contact_text: "",
    contention_summary_text: "",
  };

  // Header.
  const title = el("h1", {}, ["New matter"], doc);

  // Form-level error region (above the form).
  const formError = el(
    "p",
    {
      class: "form-error",
      role: "alert",
      "data-test-id": "create-form-error",
      hidden: true,
    },
    [],
    doc,
  );

  // Status announcement region.
  const statusRegion = el(
    "div",
    {
      role: "status",
      "aria-live": "polite",
      class: "visually-hidden",
      "data-test-id": "create-status",
    },
    [],
    doc,
  );

  // --- Inputs ---

  const nameInput = el(
    "input",
    { type: "text", maxlength: NAME_MAX_LENGTH },
    [],
    doc,
  );
  nameInput.addEventListener("input", (event) => {
    const target = (event as Event & { target?: { value?: unknown } }).target;
    state.name = String(target?.value ?? "");
  });

  const litRadio = el(
    "input",
    { type: "radio", name: "matter_type", value: "litigation" },
    [],
    doc,
  );
  litRadio.addEventListener("click", () => {
    state.matter_type = "litigation";
  });
  const advRadio = el(
    "input",
    { type: "radio", name: "matter_type", value: "advisory" },
    [],
    doc,
  );
  advRadio.addEventListener("click", () => {
    state.matter_type = "advisory";
  });

  const matterTypeFieldset = el(
    "fieldset",
    { class: "fieldset matter-type-fieldset" },
    [
      el("legend", {}, ["Matter type *"], doc),
      el(
        "label",
        {},
        [
          litRadio,
          " ",
          el("span", {}, ["Litigation"], doc),
        ],
        doc,
      ),
      el(
        "label",
        {},
        [
          advRadio,
          " ",
          el("span", {}, ["Counsel"], doc),
        ],
        doc,
      ),
    ],
    doc,
  );

  const jurisdictionValueInput = el("input", { type: "text" }, [], doc);
  jurisdictionValueInput.addEventListener("input", (event) => {
    const target = (event as Event & { target?: { value?: unknown } }).target;
    state.jurisdiction_value = String(target?.value ?? "");
  });

  const jurisdictionLockedCheckbox = el(
    "input",
    { type: "checkbox" },
    [],
    doc,
  );
  jurisdictionLockedCheckbox.addEventListener("click", () => {
    state.jurisdiction_locked = !state.jurisdiction_locked;
  });

  const partiesSection = el(
    "section",
    {
      class: "parties-section",
      "data-test-id": "parties-section",
      "aria-label": "Parties",
    },
    [],
    doc,
  );

  function renderPartiesSection(): void {
    setText(partiesSection, "");
    partiesSection.appendChild(
      el("h2", { class: "parties-heading" }, ["Parties *"], doc),
    );
    state.parties.forEach((p, idx) => {
      const row = el(
        "div",
        {
          class: "party-row",
          "data-test-id": "party-row",
          "data-party-key": String(p.key),
        },
        [],
        doc,
      );

      const roleInput = el("input", { type: "text", value: p.role }, [], doc);
      roleInput.addEventListener("input", (event) => {
        const t = (event as Event & { target?: { value?: unknown } }).target;
        p.role = String(t?.value ?? "");
      });

      const displayNameInput = el(
        "input",
        { type: "text", value: p.display_name },
        [],
        doc,
      );
      displayNameInput.addEventListener("input", (event) => {
        const t = (event as Event & { target?: { value?: unknown } }).target;
        p.display_name = String(t?.value ?? "");
      });

      const partyKindInput = el(
        "input",
        { type: "text", value: p.party_kind },
        [],
        doc,
      );
      partyKindInput.addEventListener("input", (event) => {
        const t = (event as Event & { target?: { value?: unknown } }).target;
        p.party_kind = String(t?.value ?? "");
      });

      const notesTextarea = el("textarea", { rows: 2 }, [p.notes], doc);
      notesTextarea.addEventListener("input", (event) => {
        const t = (event as Event & { target?: { value?: unknown } }).target;
        p.notes = String(t?.value ?? "");
      });

      row.appendChild(
        field({ id: `cm-party-${p.key}-role`, label: "Role", required: true }, roleInput, doc),
      );
      row.appendChild(
        field(
          { id: `cm-party-${p.key}-display-name`, label: "Display name", required: true },
          displayNameInput,
          doc,
        ),
      );
      row.appendChild(
        field(
          { id: `cm-party-${p.key}-party-kind`, label: "Party kind", required: true },
          partyKindInput,
          doc,
        ),
      );
      row.appendChild(
        field({ id: `cm-party-${p.key}-notes`, label: "Notes" }, notesTextarea, doc),
      );

      // Remove button: NOT on the first row.
      if (idx > 0) {
        const removeBtn = el(
          "button",
          {
            type: "button",
            class: "button button--secondary party-remove-btn",
            "data-test-id": "party-remove",
            "data-party-key": String(p.key),
          },
          ["Remove party"],
          doc,
        );
        removeBtn.addEventListener("click", () => {
          state.parties = state.parties.filter((other) => other.key !== p.key);
          renderPartiesSection();
        });
        row.appendChild(removeBtn);
      }

      partiesSection.appendChild(row);
    });

    const addBtn = el(
      "button",
      {
        type: "button",
        class: "button button--secondary party-add-btn",
        "data-test-id": "party-add",
      },
      ["Add party"],
      doc,
    );
    addBtn.addEventListener("click", () => {
      const key = partyCounter++;
      state.parties.push({
        key,
        role: "",
        display_name: "",
        party_kind: "",
        notes: "",
      });
      renderPartiesSection();
      const newRoleId = `cm-party-${key}-role`;
      // Best-effort focus: walk the rendered section for the matching field.
      const newRow = partiesSection.children[partiesSection.children.length - 2];
      if (newRow !== undefined) {
        const first = newRow.querySelector(`#${newRoleId}`);
        if (first !== null) focusEl(first as HTMLElement);
      }
    });
    partiesSection.appendChild(addBtn);
  }

  renderPartiesSection();

  const normalRadio = el(
    "input",
    { type: "radio", name: "confidentiality_class", value: "normal" },
    [],
    doc,
  );
  normalRadio.addEventListener("click", () => {
    state.confidentiality_class = "normal";
  });
  const heightenedRadio = el(
    "input",
    { type: "radio", name: "confidentiality_class", value: "heightened" },
    [],
    doc,
  );
  heightenedRadio.addEventListener("click", () => {
    state.confidentiality_class = "heightened";
  });
  const sealedRadio = el(
    "input",
    { type: "radio", name: "confidentiality_class", value: "sealed" },
    [],
    doc,
  );
  sealedRadio.addEventListener("click", () => {
    state.confidentiality_class = "sealed";
  });

  const confidentialityFieldset = el(
    "fieldset",
    { class: "fieldset confidentiality-fieldset" },
    [
      el("legend", {}, ["Confidentiality *"], doc),
      el(
        "label",
        {},
        [normalRadio, " ", el("span", {}, ["Normal"], doc)],
        doc,
      ),
      el(
        "label",
        {},
        [heightenedRadio, " ", el("span", {}, ["Heightened"], doc)],
        doc,
      ),
      el("label", {}, [sealedRadio, " ", el("span", {}, ["Sealed"], doc)], doc),
    ],
    doc,
  );

  // Optional free-text fields. Each binds to state via `input` listener.
  const retainerScope = makeOptionalTextarea(
    "cm-retainer-scope",
    "Retainer scope",
    (v) => {
      state.retainer_scope = v;
    },
    doc,
  );
  const caseTypeText = makeOptionalInput(
    "cm-case-type-text",
    "Case type",
    (v) => {
      state.case_type_text = v;
    },
    doc,
  );
  const caseProgressText = makeOptionalTextarea(
    "cm-case-progress-text",
    "Case progress",
    (v) => {
      state.case_progress_text = v;
    },
    doc,
  );
  const courtContactText = makeOptionalInput(
    "cm-court-contact-text",
    "Court contact",
    (v) => {
      state.court_contact_text = v;
    },
    doc,
  );
  const contentionSummaryText = makeOptionalTextarea(
    "cm-contention-summary-text",
    "Contention summary",
    (v) => {
      state.contention_summary_text = v;
    },
    doc,
  );

  const submitBtn = el(
    "button",
    {
      type: "submit",
      class: "button button--primary create-submit-btn",
      "data-test-id": "create-submit",
    },
    ["Create matter"],
    doc,
  );
  const cancelBtn = el(
    "button",
    {
      type: "button",
      class: "button create-cancel-btn",
      "data-test-id": "create-cancel",
    },
    ["Cancel"],
    doc,
  );
  cancelBtn.addEventListener("click", () => {
    deps.navigate(buildHash("list"));
  });

  async function handleSubmit(): Promise<void> {
    formError.setAttribute("hidden", "");
    setText(formError, "");
    const trimmedName = state.name.trim();
    const trimmedJx = state.jurisdiction_value.trim();
    const issues: Array<{ message: string; focusOn: HTMLElement | null }> = [];
    if (trimmedName === "") {
      issues.push({ message: "Name is required.", focusOn: nameInput });
    } else if (trimmedName.length > NAME_MAX_LENGTH) {
      issues.push({
        message: `Name must be ${NAME_MAX_LENGTH} characters or fewer.`,
        focusOn: nameInput,
      });
    }
    if (state.matter_type === null) {
      issues.push({ message: "Matter type is required.", focusOn: litRadio });
    }
    if (trimmedJx === "") {
      issues.push({
        message: "Jurisdiction value is required.",
        focusOn: jurisdictionValueInput,
      });
    }
    const validParties = state.parties
      .map((p) => ({
        role: p.role.trim(),
        display_name: p.display_name.trim(),
        party_kind: p.party_kind.trim(),
        notes: p.notes.trim(),
      }))
      .filter(
        (p) => p.role !== "" && p.display_name !== "" && p.party_kind !== "",
      );
    if (validParties.length < 1) {
      issues.push({
        message:
          "At least one party with role, display name, and party kind is required.",
        focusOn: null,
      });
    }
    if (state.confidentiality_class === null) {
      issues.push({
        message: "Confidentiality is required.",
        focusOn: normalRadio,
      });
    }

    if (issues.length > 0) {
      formError.removeAttribute("hidden");
      setText(formError, issues.map((i) => i.message).join(" "));
      focusEl(issues[0].focusOn);
      return;
    }

    announce(statusRegion, "Creating…");

    // Build DTO. Strip empty optional strings (don't send "" — schema treats
    // absence as the default).
    const dto: CreateMatterDto = {
      name: trimmedName,
      matter_type: state.matter_type!,
      jurisdiction: {
        value: trimmedJx,
        locked: state.jurisdiction_locked,
      },
      parties: validParties.map<Party>((p) => {
        const out: Party = {
          role: p.role,
          display_name: p.display_name,
          party_kind: p.party_kind,
        };
        if (p.notes !== "") {
          return { ...out, notes: p.notes };
        }
        return out;
      }),
      confidentiality_class: state.confidentiality_class!,
      ...(state.retainer_scope.trim() !== ""
        ? { retainer_scope: state.retainer_scope.trim() }
        : {}),
      ...(state.case_type_text.trim() !== ""
        ? { case_type_text: state.case_type_text.trim() }
        : {}),
      ...(state.case_progress_text.trim() !== ""
        ? { case_progress_text: state.case_progress_text.trim() }
        : {}),
      ...(state.court_contact_text.trim() !== ""
        ? { court_contact_text: state.court_contact_text.trim() }
        : {}),
      ...(state.contention_summary_text.trim() !== ""
        ? { contention_summary_text: state.contention_summary_text.trim() }
        : {}),
    };

    const env = await deps.api.createMatter(dto);
    if (!env.ok) {
      formError.removeAttribute("hidden");
      setText(formError, env.error.message);
      announce(statusRegion, `Error: ${env.error.message}`);
      return;
    }
    const value = env.value as { id: string };
    announce(statusRegion, "Created");
    deps.navigate(buildHash("view", { id: value.id }));
  }

  submitBtn.addEventListener("click", (event) => {
    const e = event as Event & { preventDefault?: () => void };
    if (typeof e.preventDefault === "function") e.preventDefault();
    void handleSubmit();
  });

  const form = el(
    "form",
    {
      class: "create-matter-form",
      novalidate: true,
      "data-test-id": "create-form",
    },
    [
      field({ id: "cm-name", label: "Name", required: true }, nameInput, doc),
      matterTypeFieldset,
      field(
        { id: "cm-jurisdiction-value", label: "Jurisdiction", required: true },
        jurisdictionValueInput,
        doc,
      ),
      field(
        { id: "cm-jurisdiction-locked", label: "Jurisdiction locked" },
        jurisdictionLockedCheckbox,
        doc,
      ),
      partiesSection,
      confidentialityFieldset,
      retainerScope,
      caseTypeText,
      caseProgressText,
      courtContactText,
      contentionSummaryText,
      el(
        "div",
        { class: "form-actions" },
        [submitBtn, cancelBtn],
        doc,
      ),
    ],
    doc,
  );

  setText(root, "");
  root.appendChild(title);
  root.appendChild(formError);
  root.appendChild(form);
  root.appendChild(statusRegion);

  focusEl(nameInput);
}

function makeOptionalInput(
  id: string,
  label: string,
  setter: (v: string) => void,
  doc: Document,
): HTMLElement {
  const input = doc.createElement("input");
  input.setAttribute("type", "text");
  input.addEventListener("input", (event) => {
    const t = (event as Event & { target?: { value?: unknown } }).target;
    setter(String(t?.value ?? ""));
  });
  return field({ id, label }, input, doc);
}

function makeOptionalTextarea(
  id: string,
  label: string,
  setter: (v: string) => void,
  doc: Document,
): HTMLElement {
  const ta = doc.createElement("textarea");
  ta.setAttribute("rows", "3");
  ta.addEventListener("input", (event) => {
    const t = (event as Event & { target?: { value?: unknown } }).target;
    setter(String(t?.value ?? ""));
  });
  return field({ id, label }, ta, doc);
}
