// ClaimTrack disclosure tests (WI-PTA-VS3): grouped read + add form + the three
// label facades. Mirrors renderer-fact-write.test.mjs — pure-Node mock document +
// mock api from the shared harness; imports the BUILT JS from dist/ (build runs in
// pretest). The disclosure is renderer-only; VS-0/VS-1/VS-2 (identity/persistence/
// IPC) are already shipped and unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import {
  claimTrackTypeLabel,
  claimTrackOurRoleLabel,
  claimTrackStatusLabel,
} from "../dist/renderer/i18n/labels.js";
import {
  VALID_ULID,
  MockDoc,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  makeStubApi,
  syntheticMatter,
} from "./_view-matter-dom.mjs";

// Party ids MIRROR the shared harness syntheticMatter() default (two id-bearing
// parties): A = client "syn-party-A", B = opposing "syn-party-B". Keeping the ids
// here lets a claim-track row fixture reference the loaded matter's parties.
const PARTY_A = "01jzparty0000000000000a01";
const PARTY_B = "01jzparty0000000000000b02";

function claimTrackRow(overrides = {}) {
  return {
    id: "01jzct0000000000000000000a",
    matter_id: VALID_ULID,
    track_type: "main_claim",
    claimant_party_id: PARTY_A,
    respondent_party_id: PARTY_B,
    our_role: "asserting",
    title: "claim-alpha",
    claim_summary: "",
    response_summary: "",
    legal_basis: "",
    calculation_summary: "",
    status: "active",
    sort_order: 0,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// Mount the matter view (default 2 id-bearing parties) and open the ClaimTrack
// disclosure. `impl` overrides listClaimTracks / createClaimTrack / getMatter.
async function mountClaimTracks(impl = {}) {
  const api = makeStubApi(impl);
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-claim-tracks-summary").dispatchEvent({ type: "click" });
  await flush();
  return { root, doc, api };
}

// Reveal the add form and fill the identity fields. Radios default to
// main_claim / asserting; pass trackType/ourRole to click a different radio.
function revealAndFill(root, { claimant, respondent, title, trackType, ourRole } = {}) {
  findByTestId(root, "view-claim-tracks-add").dispatchEvent({ type: "click" });
  if (trackType !== undefined) {
    findByTestId(root, `view-ct-track-type-${trackType}`).dispatchEvent({ type: "click" });
  }
  if (ourRole !== undefined) {
    findByTestId(root, `view-ct-our-role-${ourRole}`).dispatchEvent({ type: "click" });
  }
  if (claimant !== undefined) findByTestId(root, "view-ct-claimant").value = claimant;
  if (respondent !== undefined) findByTestId(root, "view-ct-respondent").value = respondent;
  if (title !== undefined) findByTestId(root, "view-ct-title").value = title;
}

// --- Grouped read ---

test("claim tracks: grouped list renders 本诉 before 反诉, each sorted by sort_order asc", async () => {
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => ({
      ok: true,
      value: [
        claimTrackRow({ id: "01jzct000000000000000000m1", track_type: "main_claim", title: "main-second", sort_order: 1 }),
        claimTrackRow({ id: "01jzct000000000000000000m0", track_type: "main_claim", title: "main-first", sort_order: 0 }),
        claimTrackRow({ id: "01jzct000000000000000000c0", track_type: "counterclaim", title: "counter-only", sort_order: 0, our_role: "responding", claimant_party_id: PARTY_B, respondent_party_id: PARTY_A }),
      ],
    }),
  });
  assert.ok(findByTestId(root, "view-claim-tracks-group-main") !== null);
  assert.ok(findByTestId(root, "view-claim-tracks-group-counter") !== null);
  assert.equal(collectText(findByTestId(root, "view-claim-tracks-group-main")), CATALOG["claimTrack.group.mainClaim"]);
  assert.equal(collectText(findByTestId(root, "view-claim-tracks-group-counter")), CATALOG["claimTrack.group.counterclaim"]);

  const rows = findAllByTestId(root, "view-claim-tracks-row");
  assert.equal(rows.length, 3);
  // 本诉 group renders first, sorted by sort_order (main-first before main-second);
  // 反诉 group renders last.
  assert.equal(rows[0].getAttribute("data-track-type"), "main_claim");
  assert.equal(rows[1].getAttribute("data-track-type"), "main_claim");
  assert.equal(rows[2].getAttribute("data-track-type"), "counterclaim");
  assert.equal(collectText(findByTestId(rows[0], "view-claim-tracks-title")), "main-first");
  assert.equal(collectText(findByTestId(rows[1], "view-claim-tracks-title")), "main-second");
  // 序号 is the 1-based position within the sorted group.
  assert.equal(collectText(findByTestId(rows[0], "view-claim-tracks-seq")), "1");
  assert.equal(collectText(findByTestId(rows[1], "view-claim-tracks-seq")), "2");
  assert.equal(collectText(findByTestId(rows[2], "view-claim-tracks-seq")), "1");
});

test("claim tracks: 反诉 row posture (our_role) and direction do NOT imply each other (AC 2)", async () => {
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => ({
      ok: true,
      value: [
        claimTrackRow({ id: "01jzct000000000000000000m0", track_type: "main_claim", our_role: "asserting", claimant_party_id: PARTY_A, respondent_party_id: PARTY_B, sort_order: 0 }),
        claimTrackRow({ id: "01jzct000000000000000000c0", track_type: "counterclaim", our_role: "responding", claimant_party_id: PARTY_B, respondent_party_id: PARTY_A, sort_order: 0 }),
      ],
    }),
  });
  const rows = findAllByTestId(root, "view-claim-tracks-row");
  const main = rows[0];
  const counter = rows[1];
  // Posture cell comes from our_role; it is a SEPARATE cell from direction.
  assert.equal(collectText(findByTestId(main, "view-claim-tracks-posture")), CATALOG["claimTrack.ourRole.asserting"]);
  assert.equal(collectText(findByTestId(counter, "view-claim-tracks-posture")), CATALOG["claimTrack.ourRole.responding"]);
  assert.equal(findByTestId(counter, "view-claim-tracks-posture").getAttribute("data-our-role"), "responding");
  // Direction cell comes from claimant → respondent; in the 反诉 it inverts relative
  // to the 本诉, independent of the posture cell.
  const mainParties = findAllByTestId(findByTestId(main, "view-claim-tracks-direction"), "view-claim-tracks-party");
  const counterParties = findAllByTestId(findByTestId(counter, "view-claim-tracks-direction"), "view-claim-tracks-party");
  assert.ok(collectText(mainParties[0]).includes("syn-party-A"));
  assert.ok(collectText(mainParties[1]).includes("syn-party-B"));
  assert.ok(collectText(counterParties[0]).includes("syn-party-B"));
  assert.ok(collectText(counterParties[1]).includes("syn-party-A"));
});

test("claim tracks: a row whose stored party id is absent renders 未知当事人 (AC 2b)", async () => {
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => ({
      ok: true,
      value: [
        claimTrackRow({ claimant_party_id: "01jzGONE0000000000000000xx", respondent_party_id: PARTY_B }),
      ],
    }),
  });
  const parties = findAllByTestId(findByTestId(root, "view-claim-tracks-direction"), "view-claim-tracks-party");
  // Absent claimant → localized fallback (never blank, never a raw id, never a crash).
  assert.equal(collectText(parties[0]), CATALOG["claimTrack.unknownParty"]);
  assert.equal(parties[0].getAttribute("data-unknown"), "true");
  assert.ok(!collectText(parties[0]).includes("01jzGONE"));
  // The other (known) party still resolves normally.
  assert.ok(collectText(parties[1]).includes("syn-party-B"));
});

test("claim tracks: list failure renders errorMessage in a role=alert node, no partial list (AC 3)", async () => {
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "tenant_mismatch", message: "no access" } }),
  });
  const err = findByTestId(root, "view-claim-tracks-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.tenant_mismatch"]);
  assert.equal(findAllByTestId(root, "view-claim-tracks-row").length, 0);
});

// --- Add form validation ---

test("claim tracks: missing required field blocks submit, createClaimTrack NOT called (AC 4)", async () => {
  let called = false;
  const { root } = await mountClaimTracks({
    createClaimTrack: async () => { called = true; return { ok: true, value: {} }; },
  });
  // Fill parties but leave the title empty.
  revealAndFill(root, { claimant: PARTY_A, respondent: PARTY_B });
  findByTestId(root, "view-ct-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  const err = findByTestId(root, "view-ct-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["claimTrack.validation.required"]);
});

test("claim tracks: same party on both sides blocks submit, createClaimTrack NOT called (AC 4)", async () => {
  let called = false;
  const { root } = await mountClaimTracks({
    createClaimTrack: async () => { called = true; return { ok: true, value: {} }; },
  });
  revealAndFill(root, { claimant: PARTY_A, respondent: PARTY_A, title: "claim-alpha" });
  findByTestId(root, "view-ct-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  const err = findByTestId(root, "view-ct-error");
  assert.equal(collectText(err), CATALOG["claimTrack.validation.samePartyBothSides"]);
});

test("claim tracks: successful create forwards the correct DTO (auto sort_order, no server fields) + refreshes (AC 5)", async () => {
  let createDto;
  let listCalls = 0;
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => {
      listCalls++;
      // Two existing 本诉 rows, so a new 本诉 auto-appends sort_order = 2.
      return {
        ok: true,
        value: [
          claimTrackRow({ id: "01jzct000000000000000000m0", track_type: "main_claim", sort_order: 0 }),
          claimTrackRow({ id: "01jzct000000000000000000m1", track_type: "main_claim", sort_order: 1 }),
        ],
      };
    },
    createClaimTrack: async (dto) => { createDto = dto; return { ok: true, value: { id: "01jzctnew00000000000000000" } }; },
  });
  assert.equal(listCalls, 1);
  revealAndFill(root, { claimant: PARTY_A, respondent: PARTY_B, title: "  claim-new  " });
  findByTestId(root, "view-ct-save").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, {
    matterId: VALID_ULID,
    track_type: "main_claim",
    our_role: "asserting",
    claimant_party_id: PARTY_A,
    respondent_party_id: PARTY_B,
    title: "claim-new",
    claim_summary: "",
    response_summary: "",
    legal_basis: "",
    calculation_summary: "",
    sort_order: 2,
  });
  // No server-authority field leaked into the DTO.
  for (const k of ["id", "matter_id", "tenant_id", "actor_user_id", "status", "created_at", "updated_at"]) {
    assert.ok(!(k in createDto), `DTO must not carry server field ${k}`);
  }
  assert.equal(collectText(findByTestId(root, "view-ct-status")), CATALOG["claimTrack.status.added"]);
  assert.equal(listCalls, 2, "list refreshed in place after create");
});

test("claim tracks: create rejection (unknown_party) renders mapped zh-CN error, list unchanged (AC 6)", async () => {
  let listCalls = 0;
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => { listCalls++; return { ok: true, value: [] }; },
    createClaimTrack: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "unknown_party", message: "party not found" } }),
  });
  assert.equal(listCalls, 1);
  revealAndFill(root, { claimant: PARTY_A, respondent: PARTY_B, title: "claim-alpha" });
  findByTestId(root, "view-ct-save").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-ct-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.unknown_party"]);
  assert.equal(listCalls, 1, "list NOT refreshed on error");
});

test("claim tracks: create transport rejection → generic inline alert, button re-enabled", async () => {
  const { root } = await mountClaimTracks({
    createClaimTrack: async () => { throw new Error("ipc boom"); },
  });
  revealAndFill(root, { claimant: PARTY_A, respondent: PARTY_B, title: "claim-alpha" });
  const saveBtn = findByTestId(root, "view-ct-save");
  saveBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-ct-error");
  assert.equal(collectText(err), CATALOG["claimTrack.status.addFailed"]);
  assert.equal(saveBtn.hasAttribute("disabled"), false, "save button re-enabled in finally");
});

test("claim tracks: track_type and our_role are independent — selecting 反诉 does not force 我方应对 (AC 8b)", async () => {
  let createDto;
  const { root } = await mountClaimTracks({
    createClaimTrack: async (dto) => { createDto = dto; return { ok: true, value: {} }; },
  });
  // Click 反诉 (counterclaim); leave our_role at its default (asserting).
  revealAndFill(root, { claimant: PARTY_A, respondent: PARTY_B, title: "claim-alpha", trackType: "counterclaim" });
  findByTestId(root, "view-ct-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(createDto.track_type, "counterclaim");
  // Coupling would have flipped our_role to "responding"; independence keeps it.
  assert.equal(createDto.our_role, "asserting");
  // sort_order auto-appends within the SELECTED (counterclaim) group — none exist yet.
  assert.equal(createDto.sort_order, 0);
});

// --- Audit fixes (F1 keyboard radios, F2 retry, F3 list rejection) ---

test("claim tracks: keyboard 'change' on the track_type/our_role radios updates the submitted DTO (audit F1)", async () => {
  let createDto;
  const { root } = await mountClaimTracks({
    createClaimTrack: async (dto) => { createDto = dto; return { ok: true, value: {} }; },
  });
  findByTestId(root, "view-claim-tracks-add").dispatchEvent({ type: "click" });
  // Keyboard arrow-navigation between radios fires "change", NOT "click". The submit
  // reads the shadow state, so the fix must capture "change" too — else a lawyer sees
  // one value selected but submits another.
  findByTestId(root, "view-ct-track-type-counterclaim").dispatchEvent({ type: "change" });
  findByTestId(root, "view-ct-our-role-responding").dispatchEvent({ type: "change" });
  findByTestId(root, "view-ct-claimant").value = PARTY_A;
  findByTestId(root, "view-ct-respondent").value = PARTY_B;
  findByTestId(root, "view-ct-title").value = "claim-kbd";
  findByTestId(root, "view-ct-save").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(createDto.track_type, "counterclaim");
  assert.equal(createDto.our_role, "responding");
});

test("claim tracks: a failed first load retries on reopen (audit F2)", async () => {
  let listCalls = 0;
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => {
      listCalls++;
      if (listCalls === 1) {
        return { ok: false, error: { kind: "case_box_persistence_error", code: "tenant_mismatch", message: "transient" } };
      }
      return { ok: true, value: [claimTrackRow({ title: "recovered" })] };
    },
  });
  // First open failed.
  assert.equal(listCalls, 1);
  assert.ok(findByTestId(root, "view-claim-tracks-error") !== null);
  // Reopen retries (loaded was NOT latched on the failure) and now succeeds in place.
  findByTestId(root, "view-claim-tracks-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(listCalls, 2);
  assert.equal(findByTestId(root, "view-claim-tracks-error"), null);
  const rows = findAllByTestId(root, "view-claim-tracks-row");
  assert.equal(rows.length, 1);
  assert.equal(collectText(findByTestId(rows[0], "view-claim-tracks-title")), "recovered");
});

test("claim tracks: a list transport rejection renders a localized generic error, no stuck spinner (audit F3)", async () => {
  const { root } = await mountClaimTracks({
    listClaimTracks: async () => { throw new Error("ipc boom"); },
  });
  const err = findByTestId(root, "view-claim-tracks-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["claimTrack.loadFailed"]);
  assert.equal(findByTestId(root, "view-claim-tracks-loading"), null);
});

// --- Disabled / empty states (AC 7) ---

test("claim tracks: < 2 total parties → the 'add parties' disabled message, no add button (AC 7)", async () => {
  const oneParty = syntheticMatter({
    parties: [{ id: PARTY_A, role: "client", display_name: "syn-party-A", party_kind: "individual" }],
  });
  const { root } = await mountClaimTracks({ getMatter: async () => ({ ok: true, value: oneParty }) });
  const disabled = findByTestId(root, "view-claim-tracks-disabled");
  assert.ok(disabled !== null);
  assert.equal(collectText(disabled), CATALOG["claimTrack.disabled.tooFewParties"]);
  assert.equal(findByTestId(root, "view-claim-tracks-add"), null);
});

test("claim tracks: >= 2 parties but < 2 id-bearing → the 'identities not assigned' disabled message (AC 7)", async () => {
  const noIds = syntheticMatter({
    parties: [
      { role: "client", display_name: "syn-party-A", party_kind: "individual" },
      { role: "opposing", display_name: "syn-party-B", party_kind: "organization" },
    ],
  });
  const { root } = await mountClaimTracks({ getMatter: async () => ({ ok: true, value: noIds }) });
  const disabled = findByTestId(root, "view-claim-tracks-disabled");
  assert.ok(disabled !== null);
  assert.equal(collectText(disabled), CATALOG["claimTrack.disabled.noPartyIds"]);
  assert.equal(findByTestId(root, "view-claim-tracks-add"), null);
});

test("claim tracks: >= 2 id-bearing parties + zero tracks → empty copy + 添加诉请 button (AC 7)", async () => {
  const { root } = await mountClaimTracks({ listClaimTracks: async () => ({ ok: true, value: [] }) });
  const empty = findByTestId(root, "view-claim-tracks-empty");
  assert.ok(empty !== null);
  assert.ok(collectText(empty).includes(CATALOG["claimTrack.empty.title"]));
  assert.ok(collectText(empty).includes(CATALOG["claimTrack.empty.hint"]));
  assert.ok(findByTestId(root, "view-claim-tracks-add") !== null);
});

// --- Label facades (AC 8) ---

test("claim tracks: label facades resolve zh-CN incl. the unknown-status fallback (AC 8)", () => {
  assert.equal(claimTrackTypeLabel("main_claim"), CATALOG["claimTrack.trackType.main_claim"]);
  assert.equal(claimTrackTypeLabel("counterclaim"), CATALOG["claimTrack.trackType.counterclaim"]);
  assert.equal(claimTrackOurRoleLabel("asserting"), CATALOG["claimTrack.ourRole.asserting"]);
  assert.equal(claimTrackOurRoleLabel("responding"), CATALOG["claimTrack.ourRole.responding"]);
  assert.equal(claimTrackStatusLabel("active"), CATALOG["claimTrack.status.active"]);
  assert.equal(claimTrackStatusLabel("withdrawn"), CATALOG["claimTrack.status.withdrawn"]);
  assert.equal(claimTrackStatusLabel("resolved"), CATALOG["claimTrack.status.resolved"]);
  // An unknown status returns its raw value (safe fallback), never throwing.
  assert.equal(claimTrackStatusLabel("mystery_status"), "mystery_status");
});
