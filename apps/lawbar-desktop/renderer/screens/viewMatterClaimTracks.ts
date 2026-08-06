// ClaimTrack section for the matter view (WI-PTA-VS3). Lazily lists the matter's
// persisted claim tracks (VS-1 read surface, VS-2 IPC), grouped 本诉 (main_claim)
// then 反诉 (counterclaim), and lets a lawyer ADD a claim track via the in-section
// add form (consuming casebox:claimTrack:create). NO edit / status transitions /
// delete / reorder (design §7). The renderer never imports the service; only the
// human-rendered response fields are read, the renderer forwards a narrow DTO, and
// main is the authoritative validator (it injects id/tenant/actor/status/timestamps).
//
// Three court concepts stay DISTINCT (design §1, load-bearing): 我方立场 (our_role)
// and 诉请方向 (claimant → respondent) are separate cells, neither derived from the
// other nor from 诉讼地位 (原告/被告). Fusing them would mislabel a counterclaim.

import type { CaseBoxApi } from "../api.js";
import type {
  ClaimTrackOurRole,
  ClaimTrackType,
  CreateClaimTrackDto,
  Party,
} from "../types.js";
import { el, field, setText } from "../dom.js";
import { t } from "../i18n/t.js";
import {
  claimTrackOurRoleLabel,
  claimTrackStatusLabel,
  partyRoleLabel,
} from "../i18n/labels.js";
import { errorMessage } from "../i18n/errorMessage.js";

// Display-only subset of CaseBoxClaimTrack — the VS-2 CREATE_CLAIM_TRACK_RESPONSE_FIELDS
// projection (authority fields tenant_id / actor_user_id are never sent). Local, like
// the FactRow interface in viewMatterFacts.ts (NOT a new exported type). track_type /
// our_role carry the closed unions the row is trusted to hold (server CHECK-constrained,
// same pattern as ViewMatterRow.matter_type).
interface ClaimTrackRow {
  readonly id: string;
  readonly matter_id: string;
  readonly track_type: ClaimTrackType;
  readonly claimant_party_id: string;
  readonly respondent_party_id: string;
  readonly our_role: ClaimTrackOurRole;
  readonly title: string;
  readonly claim_summary: string;
  readonly response_summary: string;
  readonly legal_basis: string;
  readonly calculation_summary: string;
  readonly status: string;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
}

// Fixed group order (design §3): 本诉 then 反诉.
const TRACK_GROUPS: ReadonlyArray<ClaimTrackType> = ["main_claim", "counterclaim"];

type IdBearingParty = Party & { readonly id: string };

function hasId(p: Party): p is IdBearingParty {
  return typeof p.id === "string" && p.id.trim() !== "";
}

// Party display for a row cell / select option: `名称（诉讼地位）` when the party's
// role is available, else the plain display name. Uses partyRoleLabel (委托人/对方当事
// 人/第三人) — NEVER a fabricated 原告/被告 (design D8: per-party plaintiff/defendant is
// not modeled; the model stores party.role + a matter-level litigation_position).
function partyLabel(p: Party): string {
  const role = p.role;
  if (typeof role === "string" && role.trim() !== "") {
    return t("claimTrack.partyWithRole", { name: p.display_name, role: partyRoleLabel(role) });
  }
  return p.display_name;
}

function readValue(node: HTMLElement): string {
  return (node as unknown as { value?: string }).value ?? "";
}

export function renderClaimTracksDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  parties: ReadonlyArray<Party>,
): HTMLElement {
  // Party lookup for row cells (only id-bearing parties are addressable).
  const partyById = new Map<string, Party>();
  for (const p of parties) {
    if (hasId(p)) partyById.set(p.id, p);
  }
  // id-bearing parties feed the add-form selects. VS-0 assigns party ULIDs at
  // matter-create; legacy ids are backfilled later (no desktop trigger yet — D3),
  // so a matter may carry parties WITHOUT ids.
  const idBearingParties = parties.filter(hasId);
  const formEnabled = idBearingParties.length >= 2;

  // The currently-loaded rows (used for sort_order auto-append and refresh).
  let currentRows: ReadonlyArray<ClaimTrackRow> = [];
  const getRows = (): ReadonlyArray<ClaimTrackRow> => currentRows;

  const listContainer = el(
    "div",
    { class: "view-claim-tracks-list-container", "data-test-id": "view-claim-tracks-list-container" },
    [],
    doc,
  );

  const refresh = (): Promise<boolean> =>
    loadClaimTracks(listContainer, doc, api, matterId, partyById, formEnabled, (rows) => {
      currentRows = rows;
    });

  const addArea = renderAddArea(doc, api, matterId, parties, idBearingParties, getRows, refresh);

  const body = el(
    "div",
    { class: "view-claim-tracks-body", "data-test-id": "view-claim-tracks-body" },
    [addArea, listContainer],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-claim-tracks-summary" },
    [t("claimTrack.disclosure.title")],
    doc,
  );
  const details = el(
    "details",
    { class: "view-claim-tracks-details", "data-test-id": "view-claim-tracks-details" },
    [summary, body],
    doc,
  );

  // Load lazily on first open, but mark loaded ONLY after a successful load and guard
  // against concurrent loads — a transient list failure must let reopen retry (audit F2).
  let loaded = false;
  let inFlight = false;
  summary.addEventListener("click", () => {
    if (loaded || inFlight) return;
    inFlight = true;
    void refresh().then((ok) => {
      loaded = ok;
      inFlight = false;
    });
  });
  return details;
}

async function loadClaimTracks(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  partyById: ReadonlyMap<string, Party>,
  formEnabled: boolean,
  setRows: (rows: ReadonlyArray<ClaimTrackRow>) => void,
): Promise<boolean> {
  // Clear any prior render so a post-add refresh re-renders in place.
  setText(parent, "");
  const loading = el("p", { "data-test-id": "view-claim-tracks-loading" }, [t("claimTrack.loading")], doc);
  parent.appendChild(loading);

  // The IPC invoke can reject on a transport/unexpected failure (the create path already
  // guards this); catch it, drop the loading node, and render a localized generic error
  // rather than leaking an unhandled rejection and a stuck spinner (audit F3).
  let env: Awaited<ReturnType<CaseBoxApi["listClaimTracks"]>>;
  try {
    env = await api.listClaimTracks({ matterId });
  } catch {
    loading.remove();
    parent.appendChild(
      el("p", { role: "alert", "data-test-id": "view-claim-tracks-error" }, [t("claimTrack.loadFailed")], doc),
    );
    return false;
  }
  loading.remove();
  if (!env.ok) {
    parent.appendChild(
      el("p", { role: "alert", "data-test-id": "view-claim-tracks-error" }, [errorMessage(env.error)], doc),
    );
    return false;
  }
  // Unpaginated (D7): the list handler returns a plain projected array, not a page.
  const rows = (env.value as ReadonlyArray<ClaimTrackRow>).slice();
  setRows(rows);

  if (rows.length === 0) {
    // Empty / first-run copy only when the form is usable (design §6); when the
    // form is disabled the add-area message stands alone (no fake sample cards).
    if (formEnabled) {
      parent.appendChild(
        el(
          "div",
          { "data-test-id": "view-claim-tracks-empty" },
          [
            el("p", { class: "view-claim-tracks-empty-title" }, [t("claimTrack.empty.title")], doc),
            el("p", { class: "view-claim-tracks-empty-hint" }, [t("claimTrack.empty.hint")], doc),
          ],
          doc,
        ),
      );
    }
    return true;
  }

  for (const group of TRACK_GROUPS) {
    const groupRows = rows
      .filter((r) => r.track_type === group)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (groupRows.length === 0) continue;
    parent.appendChild(renderGroup(doc, group, groupRows, partyById));
  }
  return true;
}

function renderGroup(
  doc: Document,
  group: ClaimTrackType,
  groupRows: ReadonlyArray<ClaimTrackRow>,
  partyById: ReadonlyMap<string, Party>,
): HTMLElement {
  const isMain = group === "main_claim";
  const heading = el(
    "div",
    {
      class: "view-claim-tracks-group-heading",
      "data-test-id": isMain ? "view-claim-tracks-group-main" : "view-claim-tracks-group-counter",
    },
    [isMain ? t("claimTrack.group.mainClaim") : t("claimTrack.group.counterclaim")],
    doc,
  );
  const list = el("ul", { class: "view-claim-tracks-list", "data-test-id": "view-claim-tracks-list" }, [], doc);
  groupRows.forEach((row, idx) => list.appendChild(renderRow(doc, row, idx, partyById)));
  return el(
    "section",
    { class: "view-claim-tracks-group", "data-track-type": group },
    [heading, list],
    doc,
  );
}

// One register row: 序号 · 标题 · 我方立场 · 主张方 → 相对方 · 状态徽章. 我方立场
// (our_role) and 诉请方向 (direction) are SEPARATE cells — neither derived from the
// other (D1); in a 反诉 they invert relative to a 本诉, so fusing them mislabels it.
function renderRow(
  doc: Document,
  row: ClaimTrackRow,
  idx: number,
  partyById: ReadonlyMap<string, Party>,
): HTMLElement {
  const seq = el(
    "span",
    { class: "view-claim-tracks-seq", "data-test-id": "view-claim-tracks-seq" },
    [String(idx + 1)],
    doc,
  );
  const title = el(
    "span",
    { class: "view-claim-tracks-title", "data-test-id": "view-claim-tracks-title" },
    [row.title],
    doc,
  );
  const posture = el(
    "span",
    { class: "view-claim-tracks-posture", "data-test-id": "view-claim-tracks-posture", "data-our-role": row.our_role },
    [claimTrackOurRoleLabel(row.our_role)],
    doc,
  );
  const direction = renderDirection(doc, row, partyById);
  const status = el(
    "span",
    { class: "view-claim-tracks-status", "data-test-id": "view-claim-tracks-status", "data-status": row.status },
    [claimTrackStatusLabel(row.status)],
    doc,
  );
  return el(
    "li",
    { class: "view-claim-tracks-row", "data-test-id": "view-claim-tracks-row", "data-track-type": row.track_type },
    [seq, " · ", title, " · ", posture, " · ", direction, " · ", status],
    doc,
  );
}

function renderDirection(
  doc: Document,
  row: ClaimTrackRow,
  partyById: ReadonlyMap<string, Party>,
): HTMLElement {
  return el(
    "span",
    { class: "view-claim-tracks-direction", "data-test-id": "view-claim-tracks-direction" },
    [
      renderPartyCell(doc, row.claimant_party_id, partyById),
      " → ",
      renderPartyCell(doc, row.respondent_party_id, partyById),
    ],
    doc,
  );
}

// A stored party id absent from the loaded matter (a party removed after the track
// was created, or an id-less legacy party) renders a localized fallback — never
// blank, never a crash, never the raw id (D3 / review-plan clarification b).
function renderPartyCell(
  doc: Document,
  partyId: string,
  partyById: ReadonlyMap<string, Party>,
): HTMLElement {
  const party = partyById.get(partyId);
  const known = party !== undefined;
  const attrs: Record<string, string> = {
    class: "view-claim-tracks-party",
    "data-test-id": "view-claim-tracks-party",
  };
  if (!known) attrs["data-unknown"] = "true";
  return el(
    "span",
    attrs,
    [party !== undefined ? partyLabel(party) : t("claimTrack.unknownParty")],
    doc,
  );
}

// The add area is EITHER the add form (≥ 2 id-bearing parties) OR one of two
// truthful disabled messages (D3): "< 2 parties" ⇒ add parties; "≥ 2 parties but
// < 2 id-bearing" ⇒ party identities not yet assigned (backfill unwired in v1).
function renderAddArea(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
  parties: ReadonlyArray<Party>,
  idBearingParties: ReadonlyArray<IdBearingParty>,
  getRows: () => ReadonlyArray<ClaimTrackRow>,
  refresh: () => Promise<boolean>,
): HTMLElement {
  if (idBearingParties.length < 2) {
    const messageKey =
      parties.length < 2 ? "claimTrack.disabled.tooFewParties" : "claimTrack.disabled.noPartyIds";
    return el(
      "div",
      { class: "view-claim-tracks-disabled", role: "note", "data-test-id": "view-claim-tracks-disabled" },
      [t(messageKey)],
      doc,
    );
  }

  // track_type / our_role are INDEPENDENT controls (D1 / AC 8b): a default is fine,
  // run-time coupling is not — selecting a track_type must NOT auto-mutate our_role.
  const state: { track_type: ClaimTrackType; our_role: ClaimTrackOurRole } = {
    track_type: "main_claim",
    our_role: "asserting",
  };
  const trackTypeField = renderRadioGroup(
    doc,
    "view-ct-track-type",
    t("claimTrack.form.trackType"),
    [
      ["main_claim", t("claimTrack.trackType.main_claim")],
      ["counterclaim", t("claimTrack.trackType.counterclaim")],
    ],
    "main_claim",
    (v) => {
      state.track_type = v as ClaimTrackType;
    },
  );
  const ourRoleField = renderRadioGroup(
    doc,
    "view-ct-our-role",
    t("claimTrack.form.ourRole"),
    [
      ["asserting", t("claimTrack.ourRole.asserting")],
      ["responding", t("claimTrack.ourRole.responding")],
    ],
    "asserting",
    (v) => {
      state.our_role = v as ClaimTrackOurRole;
    },
  );

  const claimantSelect = renderPartySelect(doc, "view-ct-claimant", idBearingParties);
  const respondentSelect = renderPartySelect(doc, "view-ct-respondent", idBearingParties);
  const titleInput = el(
    "input",
    { type: "text", class: "view-ct-title", "data-test-id": "view-ct-title", "aria-label": t("claimTrack.form.titleField") },
    [],
    doc,
  );

  const claimSummary = supplementalTextarea(doc, "view-ct-claim-summary", t("claimTrack.form.claimSummary"));
  const responseSummary = supplementalTextarea(doc, "view-ct-response-summary", t("claimTrack.form.responseSummary"));
  const legalBasis = supplementalTextarea(doc, "view-ct-legal-basis", t("claimTrack.form.legalBasis"));
  const calculationSummary = supplementalTextarea(
    doc,
    "view-ct-calculation-summary",
    t("claimTrack.form.calculationSummary"),
  );
  const supplemental = el(
    "details",
    { class: "view-ct-supplemental", "data-test-id": "view-ct-supplemental" },
    [
      el("summary", { "data-test-id": "view-ct-supplemental-summary" }, [t("claimTrack.form.supplemental")], doc),
      claimSummary,
      responseSummary,
      legalBasis,
      calculationSummary,
    ],
    doc,
  );

  const status = el(
    "span",
    { class: "view-ct-status-line", "data-test-id": "view-ct-status" },
    [],
    doc,
  );
  const resetStatus = (): void => {
    status.removeAttribute("role");
    status.setAttribute("data-test-id", "view-ct-status");
    setText(status, "");
  };
  const showError = (msg: string): void => {
    status.setAttribute("role", "alert");
    status.setAttribute("data-test-id", "view-ct-error");
    setText(status, msg);
  };

  const saveBtn = el(
    "button",
    { type: "button", class: "button button--primary view-ct-save", "data-test-id": "view-ct-save" },
    [t("claimTrack.form.save")],
    doc,
  );
  const cancelBtn = el(
    "button",
    { type: "button", class: "button button--secondary view-ct-cancel", "data-test-id": "view-ct-cancel" },
    [t("claimTrack.form.cancel")],
    doc,
  );

  const form = el(
    "div",
    { class: "view-ct-form", "data-test-id": "view-ct-form", hidden: true },
    [
      el("p", { class: "view-ct-form-title" }, [t("claimTrack.form.title")], doc),
      trackTypeField,
      ourRoleField,
      field({ id: "ct-claimant", label: t("claimTrack.form.claimant"), required: true }, claimantSelect, doc),
      field({ id: "ct-respondent", label: t("claimTrack.form.respondent"), required: true }, respondentSelect, doc),
      field({ id: "ct-title", label: t("claimTrack.form.titleField"), required: true }, titleInput, doc),
      supplemental,
      el("div", { class: "view-ct-actions" }, [cancelBtn, " ", saveBtn], doc),
      status,
    ],
    doc,
  );

  const addBtn = el(
    "button",
    { type: "button", class: "button button--primary view-claim-tracks-add-btn", "data-test-id": "view-claim-tracks-add" },
    [t("claimTrack.add.button")],
    doc,
  );
  addBtn.addEventListener("click", () => {
    form.removeAttribute("hidden");
    addBtn.setAttribute("hidden", "");
  });
  cancelBtn.addEventListener("click", () => {
    form.setAttribute("hidden", "");
    addBtn.removeAttribute("hidden");
    resetStatus();
  });

  saveBtn.addEventListener("click", () => {
    void (async () => {
      resetStatus();
      const claimantId = readValue(claimantSelect);
      const respondentId = readValue(respondentSelect);
      const title = readValue(titleInput).trim();
      // Radios are default-selected, so only the selects + title can be missing.
      if (claimantId === "" || respondentId === "" || title === "") {
        showError(t("claimTrack.validation.required"));
        return;
      }
      if (claimantId === respondentId) {
        showError(t("claimTrack.validation.samePartyBothSides"));
        return;
      }
      // sort_order auto-append = count of existing rows in the SELECTED group (D4).
      const sortOrder = getRows().filter((r) => r.track_type === state.track_type).length;
      const dto: CreateClaimTrackDto = {
        matterId,
        track_type: state.track_type,
        our_role: state.our_role,
        claimant_party_id: claimantId,
        respondent_party_id: respondentId,
        title,
        claim_summary: readValue(claimSummary).trim(),
        response_summary: readValue(responseSummary).trim(),
        legal_basis: readValue(legalBasis).trim(),
        calculation_summary: readValue(calculationSummary).trim(),
        sort_order: sortOrder,
      };
      saveBtn.setAttribute("disabled", "true");
      try {
        const env = await api.createClaimTrack(dto);
        if (!env.ok) {
          showError(errorMessage(env.error));
          return;
        }
        resetStatus();
        setText(status, t("claimTrack.status.added"));
        form.setAttribute("hidden", "");
        addBtn.removeAttribute("hidden");
        await refresh();
      } catch {
        // Transport / unexpected rejection — a safe generic alert (facts precedent).
        showError(t("claimTrack.status.addFailed"));
      } finally {
        saveBtn.removeAttribute("disabled");
      }
    })();
  });

  return el(
    "div",
    { class: "view-claim-tracks-add", "data-test-id": "view-claim-tracks-add-control" },
    [addBtn, form],
    doc,
  );
}

// A labelled radio group. The option VALUE stays the bare English enum member; only
// the visible LABEL is zh-CN (the createMatter enum-select idiom). Each radio's click
// forwards its value to the caller's setter — the groups stay independent.
function renderRadioGroup(
  doc: Document,
  name: string,
  legendText: string,
  options: ReadonlyArray<readonly [string, string]>,
  defaultValue: string,
  onChange: (value: string) => void,
): HTMLElement {
  const legend = el("legend", {}, [legendText], doc);
  const labels = options.map(([value, label]) => {
    const input = el(
      "input",
      {
        type: "radio",
        name,
        value,
        ...(value === defaultValue ? { checked: true } : {}),
        "data-test-id": `${name}-${value}`,
      },
      [],
      doc,
    );
    // Listen on BOTH click and change: keyboard arrow-navigation between radios fires
    // "change" but not "click", and submit reads the shadow state — without "change" a
    // keyboard user could visibly select one value yet submit another (audit F1).
    input.addEventListener("click", () => onChange(value));
    input.addEventListener("change", () => onChange(value));
    return el("label", { class: "view-ct-radio" }, [input, " ", el("span", {}, [label], doc)], doc);
  });
  return el("fieldset", { class: "view-ct-fieldset", "data-test-id": name }, [legend, ...labels], doc);
}

// A party <select>: a leading empty placeholder (keeps the initial value "" so the
// submit-time required check fires) then one option per id-bearing party — VALUE =
// party.id, LABEL = 名称（诉讼地位）. The lawyer never types an id or an ad-hoc name (D2).
function renderPartySelect(
  doc: Document,
  testId: string,
  idBearingParties: ReadonlyArray<IdBearingParty>,
): HTMLElement {
  const placeholder = el("option", { value: "", selected: true }, [t("claimTrack.form.selectPlaceholder")], doc);
  const options = idBearingParties.map((p) => el("option", { value: p.id }, [partyLabel(p)], doc));
  return el("select", { class: "view-ct-party-select", "data-test-id": testId }, [placeholder, ...options], doc);
}

function supplementalTextarea(doc: Document, testId: string, labelText: string): HTMLElement {
  return el(
    "textarea",
    { class: "view-ct-supplemental-input", "data-test-id": testId, "aria-label": labelText, placeholder: labelText, rows: 2 },
    [],
    doc,
  );
}
