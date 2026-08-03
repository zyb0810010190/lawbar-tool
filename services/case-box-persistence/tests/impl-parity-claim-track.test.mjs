// Impl-parity WI-PTA-VS1 — claim-track scenarios. Mirrors impl-parity-evidence.test.mjs.
// InMemory + SQLite must be deep-equal identical on create/get/list (ordering
// included) and error-code identical on every rejection path.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CLAIM_TRACK_ID,
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeClaimTrackInput,
  makeMatterWithClaimPartiesInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPairForClaimTrack() {
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterWithClaimPartiesInput());
  await sqlite.createMatter(makeMatterWithClaimPartiesInput());
  return { inMem, sqlite, db };
}

test("impl-parity VS1.1: createClaimTrack happy path identical", async () => {
  const { inMem, sqlite } = await buildPairForClaimTrack();
  const input = makeClaimTrackInput();
  const im = await inMem.createClaimTrack(input);
  const sq = await sqlite.createClaimTrack(input);
  assert.deepEqual(sq, im);
});

test("impl-parity VS1.2: getClaimTrack identical", async () => {
  const { inMem, sqlite } = await buildPairForClaimTrack();
  await inMem.createClaimTrack(makeClaimTrackInput());
  await sqlite.createClaimTrack(makeClaimTrackInput());
  const query = { tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, claim_track_id: DEFAULT_CLAIM_TRACK_ID };
  const im = await inMem.getClaimTrack(query);
  const sq = await sqlite.getClaimTrack(query);
  assert.deepEqual(sq, im);
});

test("impl-parity VS1.3: listClaimTracks ordering identical (sort_order ASC, created_at ASC, id ASC tiebreak)", async () => {
  const { inMem, sqlite } = await buildPairForClaimTrack();
  // Insert deliberately out-of-order, with a sort_order tie on the same created_at
  // to force the id tiebreak, and an earlier created_at within the same sort_order.
  const tracks = [
    { id: "01jcasecltrmockid0000000aa", sort_order: 2, created_at: "2026-05-22T12:00:00.000Z" },
    { id: "01jcasecltrmockid0000000cc", sort_order: 1, created_at: "2026-05-22T11:00:00.000Z" }, // tie with bb → id tiebreak
    { id: "01jcasecltrmockid0000000bb", sort_order: 1, created_at: "2026-05-22T11:00:00.000Z" }, // tie with cc → id tiebreak
    { id: "01jcasecltrmockid0000000dd", sort_order: 1, created_at: "2026-05-22T10:00:00.000Z" }, // earliest in sort_order 1
  ];
  for (const t of tracks) {
    const input = makeClaimTrackInput({ id: t.id, sort_order: t.sort_order, created_at: t.created_at, updated_at: t.created_at });
    await inMem.createClaimTrack(input);
    await sqlite.createClaimTrack(input);
  }
  const query = { tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID };
  const im = await inMem.listClaimTracks(query);
  const sq = await sqlite.listClaimTracks(query);
  assert.deepEqual(sq, im);
  // Pin the exact deterministic order: sort_order 1 group by created_at then id, then sort_order 2.
  assert.deepEqual(
    sq.map((c) => c.id),
    [
      "01jcasecltrmockid0000000dd", // sort 1, 10:00
      "01jcasecltrmockid0000000bb", // sort 1, 11:00, id bb
      "01jcasecltrmockid0000000cc", // sort 1, 11:00, id cc
      "01jcasecltrmockid0000000aa", // sort 2, 12:00
    ],
  );
});

test("impl-parity VS1.4: rejection-code parity across every create-path guard", async () => {
  const scenarios = [
    ["duplicate id", async (p) => { await p.createClaimTrack(makeClaimTrackInput()); return p.createClaimTrack(makeClaimTrackInput()); }],
    ["unknown matter", (p) => p.createClaimTrack(makeClaimTrackInput({ matter_id: "01jcasematterunknown000001" }))],
    ["tenant mismatch", (p) => p.createClaimTrack(makeClaimTrackInput({ tenant_id: "tenant-evil" }))],
    ["invalid payload (bad our_role)", (p) => p.createClaimTrack(makeClaimTrackInput({ our_role: "bystander" }))],
    ["non-active create", (p) => p.createClaimTrack(makeClaimTrackInput({ status: "withdrawn" }))],
    ["updated_at divergence", (p) => p.createClaimTrack(makeClaimTrackInput({ updated_at: "2026-05-22T09:00:01.000Z" }))],
    ["unknown_party (claimant)", (p) => p.createClaimTrack(makeClaimTrackInput({ claimant_party_id: "01jcasepartyghost000000001" }))],
    ["unknown_party (respondent)", (p) => p.createClaimTrack(makeClaimTrackInput({ respondent_party_id: "01jcasepartyghost000000001" }))],
  ];
  for (const [label, fn] of scenarios) {
    const { inMem, sqlite } = await buildPairForClaimTrack();
    let imErr, sqErr;
    try { await fn(inMem); } catch (e) { imErr = e; }
    try { await fn(sqlite); } catch (e) { sqErr = e; }
    assert.ok(imErr, `${label}: in-memory should reject`);
    assert.ok(sqErr, `${label}: sqlite should reject`);
    assert.equal(sqErr.code, imErr.code, `${label}: error-code parity (im=${imErr.code}, sq=${sqErr.code})`);
  }
});
