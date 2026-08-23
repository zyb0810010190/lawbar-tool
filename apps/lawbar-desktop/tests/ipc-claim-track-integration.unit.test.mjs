// ClaimTrack IPC integration test (WI-PTA-VS2). Unlike the handler-unit file
// (which uses stub providers), this exercises the create + list handlers over a
// REAL InMemoryCaseBoxPersistence from case-box-persistence: a matter is created
// with parties carrying explicit ULID ids, a claim track is written through
// createClaimTrackHandler, then read back through listClaimTracksHandler from the
// SAME source — proving the two channels agree end-to-end and that the response
// projection strips authority off a real persistence row.

import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryCaseBoxPersistence } from "case-box-persistence";
import {
  createClaimTrackHandler,
  listClaimTracksHandler,
} from "../dist/src/caseBox/claimTrackHandlers.js";

const FIXED_NOW = new Date("2026-07-01T00:00:00.000Z");
const clock = () => FIXED_NOW;

// 26-char lowercase ULIDs (^[0-9a-z]{26}$).
const MATTER_ID = "01jz0000000000000000000000";
const CLAIMANT_ID = "01jzclaimant00000000000000";
const RESPONDENT_ID = "01jzrespondent000000000000";
const CLAIM_TRACK_ID = "01jzclaimtrk00000000000000";

// A complete, schema-valid matter with two explicit-ULID parties. tenant_id
// matches the desktop active tenant ("default-tenant") so the handler's
// matter+tenant preflight passes.
function fullMatter() {
  return {
    id: MATTER_ID,
    tenant_id: "default-tenant",
    actor_user_id: "local-user",
    name: "Integration matter",
    matter_type: "litigation",
    jurisdiction: { value: "us-fed", locked: false },
    parties: [
      { id: CLAIMANT_ID, role: "client", display_name: "ACME Corp", party_kind: "organization" },
      { id: RESPONDENT_ID, role: "opposing", display_name: "Globex", party_kind: "organization" },
    ],
    confidentiality_class: "normal",
    status: "active",
    external_ocr_authorized: false,
    sync_grant_present: false,
    llm_extraction_opt_in: false,
    created_at: FIXED_NOW.toISOString(),
  };
}

async function seededProvider() {
  const persistence = new InMemoryCaseBoxPersistence({ now: () => FIXED_NOW });
  await persistence.createMatter(fullMatter());
  return { provide: () => ({ persistence }), persistence };
}

test("integration: create then list reads the claim track back from the same real persistence", async () => {
  const { provide } = await seededProvider();

  const created = await createClaimTrackHandler(
    {
      matterId: MATTER_ID,
      track_type: "main_claim",
      claimant_party_id: CLAIMANT_ID,
      respondent_party_id: RESPONDENT_ID,
      our_role: "asserting",
      title: "Breach of contract — main claim",
      claim_summary: "Defendant failed to deliver.",
      sort_order: 0,
    },
    provide,
    clock,
    () => CLAIM_TRACK_ID,
  );
  assert.equal(created.ok, true);
  assert.equal(created.value.id, CLAIM_TRACK_ID);
  assert.equal(created.value.status, "active");
  assert.equal(created.value.claim_summary, "Defendant failed to deliver.");
  // absent summaries defaulted to "" and survived the round-trip.
  assert.equal(created.value.response_summary, "");
  assert.equal(created.value.legal_basis, "");
  assert.equal(created.value.calculation_summary, "");
  // authority stripped off the real persistence row.
  assert.equal("tenant_id" in created.value, false);
  assert.equal("actor_user_id" in created.value, false);

  const listed = await listClaimTracksHandler({ matterId: MATTER_ID }, provide);
  assert.equal(listed.ok, true);
  assert.ok(Array.isArray(listed.value), "list returns an array (no page wrapper)");
  assert.equal("rows" in listed.value, false);
  assert.equal("next_cursor" in listed.value, false);
  assert.equal(listed.value.length, 1);
  const row = listed.value[0];
  assert.equal(row.id, CLAIM_TRACK_ID);
  assert.equal(row.title, "Breach of contract — main claim");
  assert.equal(row.track_type, "main_claim");
  assert.equal(row.our_role, "asserting");
  assert.equal(row.claimant_party_id, CLAIMANT_ID);
  assert.equal(row.respondent_party_id, RESPONDENT_ID);
  assert.equal("tenant_id" in row, false);
  assert.equal("actor_user_id" in row, false);
});

test("integration: a claimant id not on the matter is refused unknown_party (no row persisted)", async () => {
  const { provide } = await seededProvider();
  const r = await createClaimTrackHandler(
    {
      matterId: MATTER_ID,
      track_type: "counterclaim",
      claimant_party_id: "01jzstranger00000000000000",
      respondent_party_id: RESPONDENT_ID,
      our_role: "responding",
      title: "Counterclaim",
      sort_order: 1,
    },
    provide,
    clock,
    () => "01jzcounter000000000000000",
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "unknown_party");
  // Nothing persisted — the list stays empty.
  const listed = await listClaimTracksHandler({ matterId: MATTER_ID }, provide);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.value, []);
});

test("integration: create is ordered by sort_order in the list read-back", async () => {
  const { provide } = await seededProvider();
  // Insert two tracks out of sort_order; the list read-back is sort_order ASC.
  const second = await createClaimTrackHandler(
    {
      matterId: MATTER_ID,
      track_type: "counterclaim",
      claimant_party_id: RESPONDENT_ID,
      respondent_party_id: CLAIMANT_ID,
      our_role: "responding",
      title: "Counterclaim (sort 5)",
      sort_order: 5,
    },
    provide,
    clock,
    () => "01jzclaimtrk0000000000000b",
  );
  assert.equal(second.ok, true);
  const first = await createClaimTrackHandler(
    {
      matterId: MATTER_ID,
      track_type: "main_claim",
      claimant_party_id: CLAIMANT_ID,
      respondent_party_id: RESPONDENT_ID,
      our_role: "asserting",
      title: "Main claim (sort 0)",
      sort_order: 0,
    },
    provide,
    clock,
    () => "01jzclaimtrk0000000000000a",
  );
  assert.equal(first.ok, true);

  const listed = await listClaimTracksHandler({ matterId: MATTER_ID }, provide);
  assert.equal(listed.ok, true);
  assert.equal(listed.value.length, 2);
  assert.equal(listed.value[0].sort_order, 0);
  assert.equal(listed.value[1].sort_order, 5);
});
