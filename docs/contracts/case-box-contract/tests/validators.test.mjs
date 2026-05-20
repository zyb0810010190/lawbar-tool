// Per-entity validator wrapper tests. Confirms that the public TS API surfaces
// a typed { ok, value } | { ok: false, summary, errors } result and that the
// happy paths + error paths behave as documented.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateMatter,
  validateDocument,
  validateParty,
  validateDeadline,
  validateEvidenceItem,
  validateOcrLink,
  validateAuditEvent,
  validateFact,
  validatePrivilegeMarker,
  assertCaseBoxIsSubordinateToOcr,
  assertFactPromotionInvariants,
  assertValidNewFact,
  assertValidNewPrivilegeMarker,
  assertPrivilegeMarkerTimestamps,
  effectivePrivilegeStatus,
  isMarkerProtective,
  isMarkerLifecycleTerminal,
  isMachineSuggestedMarker,
  PrivilegeMarkerCreationError,
  FactPromotionInvariantError,
  FactCreationInvariantError,
  OcrSubordinationError,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const validDir = join(root, "fixtures", "valid");
const invalidDir = join(root, "fixtures", "invalid");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// Happy paths — every validator returns ok=true and the value preserves shape.
// ---------------------------------------------------------------------------

test("validateMatter happy path returns ok=true with value", () => {
  const r = validateMatter(readJson(join(validDir, "matter.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.matter_type, "litigation");
  assert.equal(r.value.external_ocr_authorized, false);
});

test("validateDocument happy path returns ok=true with value", () => {
  const r = validateDocument(readJson(join(validDir, "document.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "registered");
});

test("validateParty happy path returns ok=true", () => {
  const r = validateParty(readJson(join(validDir, "party.valid.json")));
  assert.equal(r.ok, true);
});

test("validateDeadline happy path returns ok=true", () => {
  const r = validateDeadline(readJson(join(validDir, "deadline.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "pending");
});

test("validateEvidenceItem happy path returns ok=true", () => {
  const r = validateEvidenceItem(readJson(join(validDir, "evidence-item.valid.json")));
  assert.equal(r.ok, true);
});

test("validateOcrLink happy path returns ok=true with direction=read-only", () => {
  const r = validateOcrLink(readJson(join(validDir, "ocr-link.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.direction, "read-only");
});

test("validateAuditEvent happy path returns ok=true", () => {
  const r = validateAuditEvent(readJson(join(validDir, "audit-event.valid.json")));
  assert.equal(r.ok, true);
});

test("validateFact happy path: candidate-lawyer-authored ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-lawyer-authored.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "candidate");
  assert.equal(r.value.source_type, "lawyer_authored");
});

test("validateFact happy path: candidate-llm ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-llm.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.extractor_name, "claude-opus-4-7");
});

test("validateFact happy path: candidate-ocr-excerpt ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-ocr-excerpt.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.source_type, "ocr_excerpt");
});

test("validateFact happy path: candidate-imported ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-candidate-imported.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.extractor_name, "clio-import-v1");
});

test("validateFact happy path: accepted-lawyer-authored ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-accepted-lawyer-authored.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "accepted");
});

test("validateFact happy path: accepted-supersedes-prior ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-accepted-supersedes-prior.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(typeof r.value.supersedes_fact_id, "string");
});

test("validateFact happy path: rejected ok=true", () => {
  const r = validateFact(readJson(join(validDir, "fact-rejected.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "rejected");
  assert.equal(typeof r.value.rejection_reason, "string");
});

// ---------------------------------------------------------------------------
// Error paths — every validator returns ok=false with non-empty errors[] and
// a sane summary string.
// ---------------------------------------------------------------------------

test("validateMatter error path returns ok=false with summary + errors", () => {
  const r = validateMatter(readJson(join(invalidDir, "matter-missing-opt-in.json")));
  assert.equal(r.ok, false);
  assert.ok(r.summary.length > 0);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
});

test("validateDocument error path returns ok=false with summary + errors", () => {
  const r = validateDocument(readJson(join(invalidDir, "document-bad-status.json")));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.instancePath === "/status"));
});

test("validateParty error path returns ok=false", () => {
  const r = validateParty(readJson(join(invalidDir, "party-bad-role.json")));
  assert.equal(r.ok, false);
});

test("validateDeadline error path returns ok=false", () => {
  const r = validateDeadline(readJson(join(invalidDir, "deadline-missed-to-met-no-reason.json")));
  assert.equal(r.ok, false);
});

test("validateEvidenceItem error path returns ok=false", () => {
  const r = validateEvidenceItem(readJson(join(invalidDir, "evidence-superseded-no-supersedes.json")));
  assert.equal(r.ok, false);
});

test("validateOcrLink error path returns ok=false (bad direction)", () => {
  const r = validateOcrLink(readJson(join(invalidDir, "ocr-link-bad-direction.json")));
  assert.equal(r.ok, false);
});

test("validateAuditEvent error path returns ok=false (privilege-waive without reason)", () => {
  const r = validateAuditEvent(readJson(join(invalidDir, "audit-event-privilege-waive-no-reason.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: candidate with accepted_at returns ok=false (N1)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-candidate-with-accepted-at.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: accepted with no reviewer returns ok=false (N3)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-accepted-no-reviewer.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: rejected with no reason returns ok=false (N4)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-rejected-no-reason.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: lawyer_authored with extractor_name returns ok=false (N5)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-lawyer-authored-with-extractor.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: llm_extraction without extractor_name returns ok=false (N6)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-llm-without-extractor-name.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: imported without extractor_name returns ok=false (N6.5)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-imported-without-extractor-name.json")));
  assert.equal(r.ok, false);
});

test("validateFact error path: ocr_excerpt missing fields returns ok=false (N7)", () => {
  const r = validateFact(readJson(join(invalidDir, "fact-ocr-excerpt-missing-fields.json")));
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// assertFactPromotionInvariants — validator-only checks.
// ---------------------------------------------------------------------------

test("assertFactPromotionInvariants passes on accepted with no supersedes", () => {
  const fact = readJson(join(validDir, "fact-accepted-lawyer-authored.valid.json"));
  assert.doesNotThrow(() => assertFactPromotionInvariants(fact));
});

test("assertFactPromotionInvariants passes on accepted with supersedes pointing elsewhere", () => {
  const fact = readJson(join(validDir, "fact-accepted-supersedes-prior.valid.json"));
  assert.doesNotThrow(() => assertFactPromotionInvariants(fact));
});

test("assertFactPromotionInvariants throws on self-cycle (id === supersedes_fact_id)", () => {
  const fact = readJson(join(root, "fixtures", "semantic-invalid", "fact-superseded-self-cycle.json"));
  assert.throws(() => assertFactPromotionInvariants(fact), FactPromotionInvariantError);
});

test("assertFactPromotionInvariants throws when supersedes set on non-accepted status", () => {
  const fact = {
    id: "01jrcasebox000000000000fxa",
    status: "candidate",
    supersedes_fact_id: "01jrcasebox000000000000fxb",
  };
  assert.throws(() => assertFactPromotionInvariants(fact), FactPromotionInvariantError);
});

test("assertFactPromotionInvariants treats undefined supersedes_fact_id as null (no throw)", () => {
  const fact = { id: "01jrcasebox000000000000fxc", status: "candidate" };
  assert.doesNotThrow(() => assertFactPromotionInvariants(fact));
});

// ---------------------------------------------------------------------------
// assertValidNewFact — creation-rule guard. Every promotion field must be null
// and status must be candidate. No exceptions.
// ---------------------------------------------------------------------------

test("assertValidNewFact passes for a clean candidate row", () => {
  const fact = readJson(join(validDir, "fact-candidate-lawyer-authored.valid.json"));
  assert.doesNotThrow(() => assertValidNewFact(fact));
});

test("assertValidNewFact throws when status !== candidate (load-bearing for no-auto-accept)", () => {
  const fact = readJson(join(validDir, "fact-accepted-lawyer-authored.valid.json"));
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws when status=candidate but reviewer_actor_user_id set", () => {
  const fact = { status: "candidate", reviewer_actor_user_id: "local-user" };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws when status=candidate but accepted_at set", () => {
  const fact = { status: "candidate", accepted_at: "2026-05-20T12:00:00.000Z" };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws when status=candidate but supersedes_fact_id set", () => {
  const fact = { status: "candidate", supersedes_fact_id: "01jrcasebox000000000000aaa" };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws for status=reviewed (only candidate is allowed at creation)", () => {
  const fact = {
    status: "reviewed",
    reviewer_actor_user_id: "local-user",
    reviewed_at: "2026-05-20T12:00:00.000Z",
  };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

test("assertValidNewFact throws for status=rejected", () => {
  const fact = {
    status: "rejected",
    reviewer_actor_user_id: "local-user",
    reviewed_at: "2026-05-20T12:00:00.000Z",
    rejected_at: "2026-05-20T12:00:30.000Z",
    rejection_reason: "no",
  };
  assert.throws(() => assertValidNewFact(fact), FactCreationInvariantError);
});

// ---------------------------------------------------------------------------
// Privilege marker validator + creation helper
// ---------------------------------------------------------------------------

test("validatePrivilegeMarker happy: proposed-llm ok=true", () => {
  const r = validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-proposed-llm.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "proposed");
  assert.equal(r.value.extractor_name, "claude-opus-4-7");
});

test("validatePrivilegeMarker happy: confirmed-lawyer-direct ok=true (proposed_at === confirmed_at)", () => {
  const r = validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "confirmed");
  assert.equal(r.value.proposed_at, r.value.confirmed_at);
});

test("validatePrivilegeMarker happy: waived ok=true", () => {
  const r = validatePrivilegeMarker(readJson(join(validDir, "privilege-marker-waived.valid.json")));
  assert.equal(r.ok, true);
  assert.equal(r.value.status, "waived");
  assert.equal(typeof r.value.waiver_reason, "string");
});

test("validatePrivilegeMarker error: dismissed-no-reason ok=false (M3)", () => {
  const r = validatePrivilegeMarker(readJson(join(invalidDir, "privilege-marker-dismissed-no-reason.json")));
  assert.equal(r.ok, false);
});

// --- assertValidNewPrivilegeMarker ---

test("assertValidNewPrivilegeMarker passes for proposed-llm fixture", () => {
  const m = readJson(join(validDir, "privilege-marker-proposed-llm.valid.json"));
  assert.doesNotThrow(() => assertValidNewPrivilegeMarker(m));
});

test("assertValidNewPrivilegeMarker passes for confirmed-lawyer-direct fixture", () => {
  const m = readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"));
  assert.doesNotThrow(() => assertValidNewPrivilegeMarker(m));
});

test("assertValidNewPrivilegeMarker throws for llm_suggested initial-status=confirmed (load-bearing no-auto-privilege)", () => {
  const m = {
    status: "confirmed",
    source_type: "llm_suggested",
    proposed_at: "2026-05-20T14:00:00.000Z",
    confirmed_actor_user_id: "local-user",
    confirmed_at: "2026-05-20T14:00:00.000Z",
  };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

test("assertValidNewPrivilegeMarker throws for imported initial-status=confirmed", () => {
  const m = {
    status: "confirmed",
    source_type: "imported",
    proposed_at: "2026-05-20T14:00:00.000Z",
    confirmed_actor_user_id: "local-user",
    confirmed_at: "2026-05-20T14:00:00.000Z",
  };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

test("assertValidNewPrivilegeMarker throws for initial-status=dismissed", () => {
  const m = { status: "dismissed", source_type: "lawyer_authored", proposed_at: "2026-05-20T14:00:00.000Z" };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

test("assertValidNewPrivilegeMarker throws for initial-status=waived", () => {
  const m = { status: "waived", source_type: "lawyer_authored", proposed_at: "2026-05-20T14:00:00.000Z" };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

test("assertValidNewPrivilegeMarker throws when new proposed marker has confirmation fields populated", () => {
  const m = {
    status: "proposed",
    source_type: "lawyer_authored",
    proposed_at: "2026-05-20T14:00:00.000Z",
    confirmed_actor_user_id: "local-user",
  };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

test("assertValidNewPrivilegeMarker throws when new marker has dismissal fields populated", () => {
  const m = {
    status: "proposed",
    source_type: "lawyer_authored",
    proposed_at: "2026-05-20T14:00:00.000Z",
    dismissal_reason: "no",
  };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

test("assertValidNewPrivilegeMarker throws when new marker has waiver fields populated", () => {
  const m = {
    status: "proposed",
    source_type: "lawyer_authored",
    proposed_at: "2026-05-20T14:00:00.000Z",
    waiver_reason: "produced",
  };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

test("assertValidNewPrivilegeMarker throws when proposed_at is null", () => {
  const m = { status: "proposed", source_type: "lawyer_authored", proposed_at: null };
  assert.throws(() => assertValidNewPrivilegeMarker(m), PrivilegeMarkerCreationError);
});

// --- assertPrivilegeMarkerTimestamps ---

test("assertPrivilegeMarkerTimestamps passes on lawful ordering", () => {
  const m = readJson(join(validDir, "privilege-marker-waived.valid.json"));
  assert.doesNotThrow(() => assertPrivilegeMarkerTimestamps(m));
});

test("assertPrivilegeMarkerTimestamps throws when confirmed_at < proposed_at", () => {
  const m = {
    proposed_at: "2026-05-20T14:00:00.000Z",
    confirmed_at: "2026-05-20T13:00:00.000Z",
  };
  assert.throws(() => assertPrivilegeMarkerTimestamps(m), PrivilegeMarkerCreationError);
});

test("assertPrivilegeMarkerTimestamps throws when waived_at < confirmed_at", () => {
  const m = {
    proposed_at: "2026-05-20T14:00:00.000Z",
    confirmed_at: "2026-05-20T14:00:00.000Z",
    waived_at: "2026-05-20T13:00:00.000Z",
  };
  assert.throws(() => assertPrivilegeMarkerTimestamps(m), PrivilegeMarkerCreationError);
});

test("assertPrivilegeMarkerTimestamps throws when dismissed_at < proposed_at", () => {
  const m = {
    proposed_at: "2026-05-20T14:00:00.000Z",
    dismissed_at: "2026-05-20T13:00:00.000Z",
  };
  assert.throws(() => assertPrivilegeMarkerTimestamps(m), PrivilegeMarkerCreationError);
});

// --- helper predicates ---

test("isMarkerProtective truth table", () => {
  assert.equal(isMarkerProtective({ status: "confirmed" }), true);
  assert.equal(isMarkerProtective({ status: "proposed" }), false);
  assert.equal(isMarkerProtective({ status: "dismissed" }), false);
  assert.equal(isMarkerProtective({ status: "waived" }), false);
});

test("isMarkerLifecycleTerminal truth table", () => {
  assert.equal(isMarkerLifecycleTerminal({ status: "dismissed" }), true);
  assert.equal(isMarkerLifecycleTerminal({ status: "waived" }), true);
  assert.equal(isMarkerLifecycleTerminal({ status: "proposed" }), false);
  assert.equal(isMarkerLifecycleTerminal({ status: "confirmed" }), false);
});

test("isMachineSuggestedMarker truth table", () => {
  assert.equal(isMachineSuggestedMarker({ source_type: "llm_suggested" }), true);
  assert.equal(isMachineSuggestedMarker({ source_type: "imported" }), true);
  assert.equal(isMachineSuggestedMarker({ source_type: "lawyer_authored" }), false);
});

// --- effectivePrivilegeStatus four-case truth table ---

test("effectivePrivilegeStatus: empty markers returns hasProtectiveAssertion=false, all historyHas false", () => {
  const r = effectivePrivilegeStatus("document", "01jrcasebox0000000000000d1", []);
  assert.equal(r.hasProtectiveAssertion, false);
  assert.equal(r.activeConfirmedMarkers.length, 0);
  assert.equal(r.historyHas.proposed, false);
  assert.equal(r.historyHas.confirmed, false);
  assert.equal(r.historyHas.dismissed, false);
  assert.equal(r.historyHas.waived, false);
  assert.equal(r.allTargetMarkers.length, 0);
});

test("effectivePrivilegeStatus: one confirmed marker → hasProtectiveAssertion=true, activeConfirmedMarkers=[A]", () => {
  const m = readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"));
  const r = effectivePrivilegeStatus(m.target_type, m.target_id, [m]);
  assert.equal(r.hasProtectiveAssertion, true);
  assert.equal(r.activeConfirmedMarkers.length, 1);
  assert.equal(r.historyHas.confirmed, true);
});

test("effectivePrivilegeStatus: two confirmed markers of different kinds → activeConfirmedMarkers=[A, B] (NOT collapsed)", () => {
  const baseA = readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"));
  const baseB = { ...baseA, id: "01jrcasebox0000000000000pX", kind: "work_product" };
  const r = effectivePrivilegeStatus(baseA.target_type, baseA.target_id, [baseA, baseB]);
  assert.equal(r.hasProtectiveAssertion, true);
  assert.equal(r.activeConfirmedMarkers.length, 2);
  const kinds = new Set(r.activeConfirmedMarkers.map((x) => x.kind));
  assert.ok(kinds.has("attorney_client") && kinds.has("work_product"));
});

test("effectivePrivilegeStatus: a single row in state=waived → hasProtectiveAssertion=false (NOT counted as confirmed)", () => {
  const m = readJson(join(validDir, "privilege-marker-waived.valid.json"));
  const r = effectivePrivilegeStatus(m.target_type, m.target_id, [m]);
  assert.equal(r.hasProtectiveAssertion, false);
  assert.equal(r.activeConfirmedMarkers.length, 0);
  assert.equal(r.historyHas.waived, true);
  assert.equal(r.historyHas.confirmed, true, "lifecycle witness reports confirmed-at-some-point");
});

test("effectivePrivilegeStatus: confirmed (live) + dismissed (separate row) → hasProtectiveAssertion=true", () => {
  const confirmed = readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"));
  const dismissed = { ...readJson(join(validDir, "privilege-marker-dismissed.valid.json")), target_id: confirmed.target_id, target_type: confirmed.target_type };
  const r = effectivePrivilegeStatus(confirmed.target_type, confirmed.target_id, [confirmed, dismissed]);
  assert.equal(r.hasProtectiveAssertion, true);
  assert.equal(r.activeConfirmedMarkers.length, 1);
  assert.equal(r.historyHas.confirmed, true);
  assert.equal(r.historyHas.dismissed, true);
});

test("effectivePrivilegeStatus: only-dismissed → hasProtectiveAssertion=false but historyHas.dismissed=true (NOT a clearance)", () => {
  const m = readJson(join(validDir, "privilege-marker-dismissed.valid.json"));
  const r = effectivePrivilegeStatus(m.target_type, m.target_id, [m]);
  assert.equal(r.hasProtectiveAssertion, false);
  assert.equal(r.historyHas.dismissed, true);
  assert.equal(r.historyHas.confirmed, false);
});

test("effectivePrivilegeStatus: only-proposed → hasProtectiveAssertion=false, historyHas.proposed=true", () => {
  const m = readJson(join(validDir, "privilege-marker-proposed-llm.valid.json"));
  const r = effectivePrivilegeStatus(m.target_type, m.target_id, [m]);
  assert.equal(r.hasProtectiveAssertion, false);
  assert.equal(r.historyHas.proposed, true);
  assert.equal(r.historyHas.confirmed, false);
});

test("effectivePrivilegeStatus: filters by target_type", () => {
  const m = readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"));
  const r = effectivePrivilegeStatus("fact", m.target_id, [m]);
  assert.equal(r.hasProtectiveAssertion, false);
  assert.equal(r.allTargetMarkers.length, 0);
});

test("effectivePrivilegeStatus: filters by target_id", () => {
  const m = readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"));
  const r = effectivePrivilegeStatus(m.target_type, "01jrcasebox000000000000xxx", [m]);
  assert.equal(r.hasProtectiveAssertion, false);
  assert.equal(r.allTargetMarkers.length, 0);
});

// --- Type guard: PrivilegeResolution has no green-light field ---

test("PrivilegeResolution shape has NO disclosure-clearance fields", () => {
  const m = readJson(join(validDir, "privilege-marker-confirmed-lawyer-direct.valid.json"));
  const r = effectivePrivilegeStatus(m.target_type, m.target_id, [m]);
  const banned = ["isPrivileged", "safeToDisclose", "disclosureClearance", "notPrivileged"];
  for (const k of banned) {
    assert.equal(k in r, false, `PrivilegeResolution must NOT have field ${k}`);
  }
});

// ---------------------------------------------------------------------------
// assertCaseBoxIsSubordinateToOcr — programmatic guard mirroring the schema's
// direction=const literal at IPC / persistence boundaries.
// ---------------------------------------------------------------------------

test("assertCaseBoxIsSubordinateToOcr passes for read-only direction", () => {
  assert.doesNotThrow(() => assertCaseBoxIsSubordinateToOcr({ direction: "read-only" }));
});

test("assertCaseBoxIsSubordinateToOcr throws OcrSubordinationError for any other direction", () => {
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({ direction: "read-write" }), OcrSubordinationError);
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({}), OcrSubordinationError);
  assert.throws(() => assertCaseBoxIsSubordinateToOcr({ direction: null }), OcrSubordinationError);
});

// ---------------------------------------------------------------------------
// Type-narrowing smoke: ok=true must narrow `value` to the typed shape.
// (Pure runtime check — TS narrowing is enforced by tsc on the .ts side.)
// ---------------------------------------------------------------------------

test("ok=true result narrows value (runtime smoke)", () => {
  const r = validateMatter(readJson(join(validDir, "matter.valid.json")));
  if (r.ok) {
    assert.equal(typeof r.value.id, "string");
    assert.equal(typeof r.value.actor_user_id, "string");
  } else {
    throw new Error("expected ok=true");
  }
});
