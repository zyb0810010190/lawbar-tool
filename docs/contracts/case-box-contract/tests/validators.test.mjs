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
  // Step 4
  CASE_BOX_AUDIT_ENTITY_TYPES,
  CASE_BOX_AUDIT_EVENT_KINDS,
  isKnownAuditEntityType,
  canonicalAuditEventHashInput,
  assertReasonForAuditEventKind,
  buildCaseBoxAuditEvent,
  verifyAuditChain,
  asAuditEventHash,
  AuditEventReasonRequiredError,
} from "../dist/index.js";
import { createHash } from "node:crypto";

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
// Step 4 — audit log helpers
// ---------------------------------------------------------------------------

// Sample event for canonical-hash exact-string test. Field values picked so
// JSON.stringify output is stable and short.
const SAMPLE_AUDIT_EVENT = {
  id: "01jrcasebox0000000000000a1",
  tenant_id: "tenant-local-v1",
  actor_user_id: "local-user",
  matter_id: "01jrcasebox0000000000000m1",
  action: "create",
  entity_type: "matter",
  entity_id: "01jrcasebox0000000000000m1",
  before_state_hash: null,
  after_state_hash: "sha256:abc",
  prev_event_hash: null,
  timestamp: "2026-05-20T09:00:00.000Z",
};
const SAMPLE_CANONICAL =
  '{"action":"create","actor_user_id":"local-user","after_state_hash":"sha256:abc","before_state_hash":null,"entity_id":"01jrcasebox0000000000000m1","entity_type":"matter","id":"01jrcasebox0000000000000a1","matter_id":"01jrcasebox0000000000000m1","prev_event_hash":null,"reason":null,"tenant_id":"tenant-local-v1","timestamp":"2026-05-20T09:00:00.000Z"}';

test("canonicalAuditEventHashInput: produces the exact pinned canonical string", () => {
  assert.equal(canonicalAuditEventHashInput(SAMPLE_AUDIT_EVENT), SAMPLE_CANONICAL);
});

test("canonicalAuditEventHashInput: includes id and timestamp (plan-review correction)", () => {
  const s = canonicalAuditEventHashInput(SAMPLE_AUDIT_EVENT);
  assert.ok(s.includes('"id":"01jrcasebox0000000000000a1"'));
  assert.ok(s.includes('"timestamp":"2026-05-20T09:00:00.000Z"'));
});

test("canonicalAuditEventHashInput: determinism — same input twice → same output", () => {
  const a = canonicalAuditEventHashInput(SAMPLE_AUDIT_EVENT);
  const b = canonicalAuditEventHashInput({ ...SAMPLE_AUDIT_EVENT });
  assert.equal(a, b);
});

test("canonicalAuditEventHashInput: throws when a required canonical field is undefined", () => {
  const broken = { ...SAMPLE_AUDIT_EVENT, action: undefined };
  assert.throws(() => canonicalAuditEventHashInput(broken), /undefined/);
});

test("assertReasonForAuditEventKind: PRIVILEGE_MARKER_WAIVED empty reason throws", () => {
  assert.throws(() => assertReasonForAuditEventKind("PRIVILEGE_MARKER_WAIVED", ""), AuditEventReasonRequiredError);
  assert.throws(() => assertReasonForAuditEventKind("PRIVILEGE_MARKER_WAIVED", null), AuditEventReasonRequiredError);
  assert.throws(() => assertReasonForAuditEventKind("PRIVILEGE_MARKER_WAIVED", undefined), AuditEventReasonRequiredError);
});

test("assertReasonForAuditEventKind: DEADLINE_MISSED_TO_MET requires reason (helper ceiling beyond schema)", () => {
  assert.throws(() => assertReasonForAuditEventKind("DEADLINE_MISSED_TO_MET", undefined), AuditEventReasonRequiredError);
  assert.doesNotThrow(() => assertReasonForAuditEventKind("DEADLINE_MISSED_TO_MET", "filed within grace period"));
});

test("assertReasonForAuditEventKind: FACT_ACCEPTED does NOT require reason", () => {
  assert.doesNotThrow(() => assertReasonForAuditEventKind("FACT_ACCEPTED", undefined));
});

test("assertReasonForAuditEventKind: FACT_REJECTED requires reason", () => {
  assert.throws(() => assertReasonForAuditEventKind("FACT_REJECTED", undefined), AuditEventReasonRequiredError);
});

test("assertReasonForAuditEventKind: PRIVILEGE_MARKER_DISMISSED requires reason", () => {
  assert.throws(() => assertReasonForAuditEventKind("PRIVILEGE_MARKER_DISMISSED", undefined), AuditEventReasonRequiredError);
});

test("assertReasonForAuditEventKind: EXTERNAL_OCR_REVOKED / SYNC_GRANT_REVOKED / LLM_EXTRACTION_OPT_OUT require reason", () => {
  for (const k of ["EXTERNAL_OCR_REVOKED", "SYNC_GRANT_REVOKED", "LLM_EXTRACTION_OPT_OUT"]) {
    assert.throws(() => assertReasonForAuditEventKind(k, undefined), AuditEventReasonRequiredError, `${k} should require reason`);
  }
});

test("buildCaseBoxAuditEvent: FACT_ACCEPTED happy path returns ok=true with action=update, entity_type=fact", () => {
  const r = buildCaseBoxAuditEvent({
    kind: "FACT_ACCEPTED",
    id: "01jrcasebox0000000000000a4",
    tenant_id: "tenant-local-v1",
    actor_user_id: "local-user",
    matter_id: "01jrcasebox0000000000000m1",
    entity_id: "01jrcasebox0000000000000f5",
    before_state_hash: "sha256:before",
    after_state_hash: "sha256:after",
    prev_event_hash: "sha256:prior",
    timestamp: "2026-05-20T11:20:30.000Z",
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.action, "update");
  assert.equal(r.value.entity_type, "fact");
});

test("buildCaseBoxAuditEvent: FACT_REPLACEMENT_ACCEPTED uses action=create (plan-review D1.3)", () => {
  const r = buildCaseBoxAuditEvent({
    kind: "FACT_REPLACEMENT_ACCEPTED",
    id: "01jrcasebox0000000000000a5",
    tenant_id: "tenant-local-v1",
    actor_user_id: "local-user",
    matter_id: "01jrcasebox0000000000000m1",
    entity_id: "01jrcasebox0000000000000f6",
    before_state_hash: null,
    after_state_hash: "sha256:newrow",
    prev_event_hash: "sha256:prior",
    timestamp: "2026-05-20T12:00:30.000Z",
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.action, "create");
});

test("buildCaseBoxAuditEvent: reason-required kind without reason returns ok=false (helper)", () => {
  const r = buildCaseBoxAuditEvent({
    kind: "PRIVILEGE_MARKER_DISMISSED",
    id: "01jrcasebox0000000000000a6",
    tenant_id: "tenant-local-v1",
    actor_user_id: "local-user",
    matter_id: "01jrcasebox0000000000000m1",
    entity_id: "01jrcasebox0000000000000p5",
    before_state_hash: "sha256:before",
    after_state_hash: "sha256:after",
    prev_event_hash: "sha256:prior",
    timestamp: "2026-05-20T14:35:00.000Z",
  });
  assert.equal(r.ok, false);
});

test("buildCaseBoxAuditEvent: PRIVILEGE_MARKER_WAIVED empty reason fails (schema floor + helper)", () => {
  const r = buildCaseBoxAuditEvent({
    kind: "PRIVILEGE_MARKER_WAIVED",
    id: "01jrcasebox0000000000000a7",
    tenant_id: "tenant-local-v1",
    actor_user_id: "local-user",
    matter_id: "01jrcasebox0000000000000m1",
    entity_id: "01jrcasebox0000000000000p6",
    before_state_hash: "sha256:before",
    after_state_hash: "sha256:after",
    prev_event_hash: "sha256:prior",
    timestamp: "2026-06-15T09:00:00.000Z",
    reason: "",
  });
  assert.equal(r.ok, false);
});

test("buildCaseBoxAuditEvent: never throws", () => {
  // Even a bogus kind should be returned as ok=false, not thrown.
  const r = buildCaseBoxAuditEvent({ kind: "BOGUS", id: "x", tenant_id: "x", actor_user_id: "x", matter_id: "x", entity_id: "x", before_state_hash: null, after_state_hash: "x", prev_event_hash: null, timestamp: "x" });
  assert.equal(r.ok, false);
});

test("asAuditEventHash: accepts 64-char lowercase hex; rejects everything else", () => {
  const valid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  assert.equal(asAuditEventHash(valid), valid);
  assert.throws(() => asAuditEventHash("ABC"), /not a valid/);
  assert.throws(() => asAuditEventHash(valid.toUpperCase()), /not a valid/);
  assert.throws(() => asAuditEventHash("z".repeat(64)), /not a valid/);
  assert.throws(() => asAuditEventHash(""), /not a valid/);
});

test("isKnownAuditEntityType: returns true for v1 vocabulary, false for unknown", () => {
  for (const t of CASE_BOX_AUDIT_ENTITY_TYPES) {
    assert.equal(isKnownAuditEntityType(t), true);
  }
  assert.equal(isKnownAuditEntityType("wibble"), false);
});

// ---------------------------------------------------------------------------
// Audit chain verifier — uses real SHA-256 for hash fn
// ---------------------------------------------------------------------------

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
function eventHashFn(event) {
  return asAuditEventHash(sha256Hex(canonicalAuditEventHashInput(event)));
}

test("verifyAuditChain: empty chain returns ok=true, verifiedCount=0, headHash=null", () => {
  const r = verifyAuditChain([], { eventHashFn });
  assert.equal(r.ok, true);
  assert.equal(r.verifiedCount, 0);
  assert.equal(r.headHash, null);
});

test("verifyAuditChain: single create event with null prev_event_hash passes", () => {
  const e = { ...SAMPLE_AUDIT_EVENT };
  const r = verifyAuditChain([e], { eventHashFn });
  assert.equal(r.ok, true);
  assert.equal(r.verifiedCount, 1);
  assert.equal(typeof r.headHash, "string");
  assert.equal(r.headHash.length, 64);
});

test("verifyAuditChain: first event with non-null prev_event_hash returns ok=false", () => {
  const e = { ...SAMPLE_AUDIT_EVENT, prev_event_hash: "sha256:something" };
  const r = verifyAuditChain([e], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "prev_event_hash_non_null_for_first_event");
  assert.equal(r.errorIndex, 0);
});

test("verifyAuditChain: create event with non-null before_state_hash returns ok=false", () => {
  const e = { ...SAMPLE_AUDIT_EVENT, before_state_hash: "sha256:bad" };
  const r = verifyAuditChain([e], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "before_state_hash_not_null_on_create");
});

test("verifyAuditChain: 3-event chain with correct prev_event_hash via real SHA-256 returns ok=true", () => {
  const e1 = { ...SAMPLE_AUDIT_EVENT };
  const h1 = eventHashFn(e1);
  const e2 = { ...SAMPLE_AUDIT_EVENT, id: "01jrcasebox0000000000000a2", action: "update", before_state_hash: "sha256:before2", after_state_hash: "sha256:after2", prev_event_hash: h1, timestamp: "2026-05-20T09:01:00.000Z" };
  const h2 = eventHashFn(e2);
  const e3 = { ...SAMPLE_AUDIT_EVENT, id: "01jrcasebox0000000000000a3", action: "update", before_state_hash: "sha256:before3", after_state_hash: "sha256:after3", prev_event_hash: h2, timestamp: "2026-05-20T09:02:00.000Z" };
  const r = verifyAuditChain([e1, e2, e3], { eventHashFn });
  assert.equal(r.ok, true);
  assert.equal(r.verifiedCount, 3);
  assert.equal(r.headHash, eventHashFn(e3));
});

test("verifyAuditChain: corrupted middle event returns ok=false with errorIndex=2", () => {
  const e1 = { ...SAMPLE_AUDIT_EVENT };
  const h1 = eventHashFn(e1);
  const e2 = { ...SAMPLE_AUDIT_EVENT, id: "01jrcasebox0000000000000a2", action: "update", before_state_hash: "sha256:before2", after_state_hash: "sha256:after2", prev_event_hash: h1, timestamp: "2026-05-20T09:01:00.000Z" };
  // Tamper: change e2's after_state_hash AFTER computing its hash, so its hash
  // changes and the chain breaks at e3.
  const e3 = { ...SAMPLE_AUDIT_EVENT, id: "01jrcasebox0000000000000a3", action: "update", before_state_hash: "sha256:before3", after_state_hash: "sha256:after3", prev_event_hash: eventHashFn(e2), timestamp: "2026-05-20T09:02:00.000Z" };
  const tamperedE2 = { ...e2, after_state_hash: "sha256:tampered" };
  const r = verifyAuditChain([e1, tamperedE2, e3], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "prev_event_hash_mismatch");
  assert.equal(r.errorIndex, 2);
});

test("verifyAuditChain: tenant_id mismatch in event 2 returns ok=false", () => {
  const e1 = { ...SAMPLE_AUDIT_EVENT };
  const h1 = eventHashFn(e1);
  const e2 = { ...SAMPLE_AUDIT_EVENT, id: "01jrcasebox0000000000000a2", tenant_id: "tenant-other", action: "update", before_state_hash: "sha256:before2", after_state_hash: "sha256:after2", prev_event_hash: h1, timestamp: "2026-05-20T09:01:00.000Z" };
  const r = verifyAuditChain([e1, e2], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "tenant_id_mismatch");
  assert.equal(r.errorIndex, 1);
});

test("verifyAuditChain: matter_id mismatch in event 2 returns ok=false", () => {
  const e1 = { ...SAMPLE_AUDIT_EVENT };
  const h1 = eventHashFn(e1);
  const e2 = { ...SAMPLE_AUDIT_EVENT, id: "01jrcasebox0000000000000a2", matter_id: "01jrcasebox0000000000000m9", action: "update", before_state_hash: "sha256:before2", after_state_hash: "sha256:after2", prev_event_hash: h1, timestamp: "2026-05-20T09:01:00.000Z" };
  const r = verifyAuditChain([e1, e2], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "matter_id_mismatch");
  assert.equal(r.errorIndex, 1);
});

test("verifyAuditChain: schema-invalid event in middle returns event_schema_invalid", () => {
  const e1 = { ...SAMPLE_AUDIT_EVENT };
  const e2_bad = { ...SAMPLE_AUDIT_EVENT, id: "01jrcasebox0000000000000a2", entity_type: "wibble" };
  const r = verifyAuditChain([e1, e2_bad], { eventHashFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorReason, "event_schema_invalid");
  assert.equal(r.errorIndex, 1);
});

// ---------------------------------------------------------------------------
// Drift guards (schema vs TS vocabulary)
// ---------------------------------------------------------------------------

test("drift: every CASE_BOX_AUDIT_EVENT_KINDS[k].action is a valid schema action", () => {
  const SCHEMA_ACTIONS = new Set([
    "create", "update", "delete-soft", "access", "export", "print", "share", "privilege-waive",
  ]);
  for (const [k, meta] of Object.entries(CASE_BOX_AUDIT_EVENT_KINDS)) {
    assert.ok(SCHEMA_ACTIONS.has(meta.action), `${k} has invalid action ${meta.action}`);
  }
});

test("drift: every CASE_BOX_AUDIT_EVENT_KINDS[k].entity_type is in CASE_BOX_AUDIT_ENTITY_TYPES", () => {
  for (const [k, meta] of Object.entries(CASE_BOX_AUDIT_EVENT_KINDS)) {
    assert.ok(CASE_BOX_AUDIT_ENTITY_TYPES.includes(meta.entity_type), `${k} has unknown entity_type ${meta.entity_type}`);
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
