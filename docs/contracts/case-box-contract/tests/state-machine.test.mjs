// State machine tests for the four case-box lifecycles. Covers:
//  - legal transitions accepted by isAllowed*
//  - illegal transitions rejected by assertValid* with IllegalTransitionError
//  - self-transitions rejected
//  - terminal-state starts rejected
//  - reason-required transitions enforced (deadline missed → met)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MATTER_STATES,
  TERMINAL_MATTER_STATES,
  DOCUMENT_STATES,
  TERMINAL_DOCUMENT_STATES,
  EVIDENCE_STATES,
  TERMINAL_EVIDENCE_STATES,
  DEADLINE_STATES,
  TERMINAL_DEADLINE_STATES,
  FACT_STATES,
  TERMINAL_FACT_STATES,
  PRIVILEGE_MARKER_STATES,
  TERMINAL_PRIVILEGE_MARKER_STATES,
  DOCKET_ENTRY_STATES,
  TERMINAL_DOCKET_ENTRY_STATES,
  ALLOWED_MATTER_EDGES,
  ALLOWED_DOCUMENT_EDGES,
  ALLOWED_EVIDENCE_EDGES,
  ALLOWED_DEADLINE_EDGES,
  ALLOWED_FACT_EDGES,
  ALLOWED_PRIVILEGE_MARKER_EDGES,
  ALLOWED_DOCKET_ENTRY_EDGES,
  isAllowedMatterTransition,
  isAllowedDocumentTransition,
  isAllowedEvidenceTransition,
  isAllowedDeadlineTransition,
  isAllowedFactTransition,
  isAllowedPrivilegeMarkerTransition,
  isAllowedDocketEntryTransition,
  assertValidMatterTransition,
  assertValidDocumentTransition,
  assertValidEvidenceTransition,
  assertValidDeadlineTransition,
  assertValidFactTransition,
  assertValidDocketEntryTransition,
  assertValidPrivilegeMarkerTransition,
  IllegalTransitionError,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Sanity: state lists are non-empty and terminal lists are subsets.
// ---------------------------------------------------------------------------

test("state lists are non-empty", () => {
  assert.ok(MATTER_STATES.length >= 2);
  assert.ok(DOCUMENT_STATES.length >= 2);
  assert.ok(EVIDENCE_STATES.length >= 2);
  assert.ok(DEADLINE_STATES.length >= 2);
  assert.ok(FACT_STATES.length >= 2);
  assert.ok(PRIVILEGE_MARKER_STATES.length >= 2);
});

test("terminal lists are subsets of state lists", () => {
  for (const s of TERMINAL_MATTER_STATES) assert.ok(MATTER_STATES.includes(s));
  for (const s of TERMINAL_DOCUMENT_STATES) assert.ok(DOCUMENT_STATES.includes(s));
  for (const s of TERMINAL_EVIDENCE_STATES) assert.ok(EVIDENCE_STATES.includes(s));
  for (const s of TERMINAL_DEADLINE_STATES) assert.ok(DEADLINE_STATES.includes(s));
  for (const s of TERMINAL_FACT_STATES) assert.ok(FACT_STATES.includes(s));
  for (const s of TERMINAL_PRIVILEGE_MARKER_STATES) assert.ok(PRIVILEGE_MARKER_STATES.includes(s));
});

// ---------------------------------------------------------------------------
// Matter
// ---------------------------------------------------------------------------

test("matter: active → archived by lawyer is allowed", () => {
  assert.equal(isAllowedMatterTransition("active", "archived", "lawyer"), true);
  assert.doesNotThrow(() => assertValidMatterTransition("active", "archived", "lawyer"));
});

test("matter: archived → active by lawyer is allowed (unarchive)", () => {
  assert.equal(isAllowedMatterTransition("archived", "active", "lawyer"), true);
  assert.doesNotThrow(() => assertValidMatterTransition("archived", "active", "lawyer"));
});

test("matter: active → archived by coordinator is rejected", () => {
  assert.equal(isAllowedMatterTransition("active", "archived", "coordinator"), false);
  assert.throws(() => assertValidMatterTransition("active", "archived", "coordinator"), IllegalTransitionError);
});

test("matter: self-transition active → active is rejected", () => {
  assert.throws(() => assertValidMatterTransition("active", "active", "lawyer"), IllegalTransitionError);
});

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

test("document: registered → ocr_pending by ingestion is allowed", () => {
  assert.equal(isAllowedDocumentTransition("registered", "ocr_pending", "ingestion"), true);
  assert.doesNotThrow(() => assertValidDocumentTransition("registered", "ocr_pending", "ingestion"));
});

test("document: ocr_pending → ocr_complete by coordinator is allowed", () => {
  assert.doesNotThrow(() => assertValidDocumentTransition("ocr_pending", "ocr_complete", "coordinator"));
});

test("document: ocr_complete → triaged by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidDocumentTransition("ocr_complete", "triaged", "lawyer"));
});

test("document: ocr_failed → triaged by lawyer is allowed (lawyer can triage failed OCR)", () => {
  assert.doesNotThrow(() => assertValidDocumentTransition("ocr_failed", "triaged", "lawyer"));
});

test("document: registered → triaged by lawyer (skip-OCR fast path)", () => {
  assert.doesNotThrow(() => assertValidDocumentTransition("registered", "triaged", "lawyer"));
});

test("document: registered → ocr_pending by lawyer is rejected (ingestion owns this edge)", () => {
  assert.equal(isAllowedDocumentTransition("registered", "ocr_pending", "lawyer"), false);
  assert.throws(() => assertValidDocumentTransition("registered", "ocr_pending", "lawyer"), IllegalTransitionError);
});

test("document: ocr_complete → ocr_pending by coordinator is rejected (no backward edge)", () => {
  assert.throws(() => assertValidDocumentTransition("ocr_complete", "ocr_pending", "coordinator"), IllegalTransitionError);
});

test("document: tagged → reviewed by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidDocumentTransition("tagged", "reviewed", "lawyer"));
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

test("evidence: proposed → accepted by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidEvidenceTransition("proposed", "accepted", "lawyer"));
});

test("evidence: proposed → rejected by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidEvidenceTransition("proposed", "rejected", "lawyer"));
});

test("evidence: accepted → superseded by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidEvidenceTransition("accepted", "superseded", "lawyer"));
});

test("evidence: rejected is terminal — rejected → accepted is rejected", () => {
  assert.throws(() => assertValidEvidenceTransition("rejected", "accepted", "lawyer"), IllegalTransitionError);
});

test("evidence: superseded is terminal — superseded → accepted is rejected", () => {
  assert.throws(() => assertValidEvidenceTransition("superseded", "accepted", "lawyer"), IllegalTransitionError);
});

test("evidence: accepted is NOT terminal — accepted → superseded permitted", () => {
  assert.equal(TERMINAL_EVIDENCE_STATES.includes("accepted"), false);
});

// ---------------------------------------------------------------------------
// Deadline
// ---------------------------------------------------------------------------

test("deadline: pending → met by lawyer is allowed (no reason required)", () => {
  assert.doesNotThrow(() => assertValidDeadlineTransition("pending", "met", "lawyer"));
});

test("deadline: pending → missed by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidDeadlineTransition("pending", "missed", "lawyer"));
});

test("deadline: pending → withdrawn by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidDeadlineTransition("pending", "withdrawn", "lawyer"));
});

test("deadline: missed → met requires non-empty reason", () => {
  assert.throws(() => assertValidDeadlineTransition("missed", "met", "lawyer"), IllegalTransitionError);
  assert.throws(() => assertValidDeadlineTransition("missed", "met", "lawyer", ""), IllegalTransitionError);
  assert.doesNotThrow(() => assertValidDeadlineTransition("missed", "met", "lawyer", "filed within grace period"));
});

test("deadline: withdrawn is terminal — withdrawn → pending is rejected", () => {
  assert.throws(() => assertValidDeadlineTransition("withdrawn", "pending", "lawyer"), IllegalTransitionError);
});

// ---------------------------------------------------------------------------
// Sanity: no edge table contains a self-loop. (Defensive — schema is in code.)
// ---------------------------------------------------------------------------

test("no edge table contains a self-loop", () => {
  for (const e of ALLOWED_MATTER_EDGES)   assert.notEqual(e.from, e.to);
  for (const e of ALLOWED_DOCUMENT_EDGES) assert.notEqual(e.from, e.to);
  for (const e of ALLOWED_EVIDENCE_EDGES) assert.notEqual(e.from, e.to);
  for (const e of ALLOWED_DEADLINE_EDGES) assert.notEqual(e.from, e.to);
  for (const e of ALLOWED_FACT_EDGES)     assert.notEqual(e.from, e.to);
  for (const e of ALLOWED_PRIVILEGE_MARKER_EDGES) assert.notEqual(e.from, e.to);
});

// ---------------------------------------------------------------------------
// Sanity: every edge cites at least one actor.
// ---------------------------------------------------------------------------

test("every edge cites at least one actor", () => {
  const allEdges = [
    ...ALLOWED_MATTER_EDGES,
    ...ALLOWED_DOCUMENT_EDGES,
    ...ALLOWED_EVIDENCE_EDGES,
    ...ALLOWED_DEADLINE_EDGES,
    ...ALLOWED_FACT_EDGES,
    ...ALLOWED_PRIVILEGE_MARKER_EDGES,
  ];
  for (const e of allEdges) {
    assert.ok(Array.isArray(e.by) && e.by.length > 0, `edge ${e.from}→${e.to} has no actor`);
  }
});

// ---------------------------------------------------------------------------
// Privilege marker lifecycle
// ---------------------------------------------------------------------------

test("privilege-marker: proposed → confirmed by lawyer is allowed (promotion to protective status)", () => {
  assert.doesNotThrow(() => assertValidPrivilegeMarkerTransition("proposed", "confirmed", "lawyer"));
});

test("privilege-marker: proposed → dismissed by lawyer requires non-empty reason", () => {
  assert.throws(() => assertValidPrivilegeMarkerTransition("proposed", "dismissed", "lawyer"), IllegalTransitionError);
  assert.throws(() => assertValidPrivilegeMarkerTransition("proposed", "dismissed", "lawyer", ""), IllegalTransitionError);
  assert.doesNotThrow(() => assertValidPrivilegeMarkerTransition("proposed", "dismissed", "lawyer", "Court filing, not privileged."));
});

test("privilege-marker: confirmed → waived by lawyer requires non-empty reason", () => {
  assert.throws(() => assertValidPrivilegeMarkerTransition("confirmed", "waived", "lawyer"), IllegalTransitionError);
  assert.throws(() => assertValidPrivilegeMarkerTransition("confirmed", "waived", "lawyer", ""), IllegalTransitionError);
  assert.doesNotThrow(() => assertValidPrivilegeMarkerTransition("confirmed", "waived", "lawyer", "Discovery production 2026-06-15."));
});

test("privilege-marker: every promotion edge by coordinator is rejected (actor gating)", () => {
  for (const [from, to, reason] of [["proposed", "confirmed", undefined], ["proposed", "dismissed", "ok"], ["confirmed", "waived", "ok"]]) {
    assert.throws(() => assertValidPrivilegeMarkerTransition(from, to, "coordinator", reason), IllegalTransitionError, `${from}→${to} by coordinator must throw`);
  }
});

test("privilege-marker: every promotion edge by ingestion is rejected (actor gating)", () => {
  for (const [from, to, reason] of [["proposed", "confirmed", undefined], ["proposed", "dismissed", "ok"], ["confirmed", "waived", "ok"]]) {
    assert.throws(() => assertValidPrivilegeMarkerTransition(from, to, "ingestion", reason), IllegalTransitionError, `${from}→${to} by ingestion must throw`);
  }
});

test("privilege-marker: every promotion edge by review is rejected (actor gating)", () => {
  for (const [from, to, reason] of [["proposed", "confirmed", undefined], ["proposed", "dismissed", "ok"], ["confirmed", "waived", "ok"]]) {
    assert.throws(() => assertValidPrivilegeMarkerTransition(from, to, "review", reason), IllegalTransitionError, `${from}→${to} by review must throw`);
  }
});

test("privilege-marker: proposed → waived rejected (must confirm first)", () => {
  assert.throws(() => assertValidPrivilegeMarkerTransition("proposed", "waived", "lawyer", "ok"), IllegalTransitionError);
});

test("privilege-marker: confirmed → proposed and confirmed → dismissed rejected", () => {
  assert.throws(() => assertValidPrivilegeMarkerTransition("confirmed", "proposed", "lawyer"), IllegalTransitionError);
  assert.throws(() => assertValidPrivilegeMarkerTransition("confirmed", "dismissed", "lawyer", "ok"), IllegalTransitionError);
});

test("privilege-marker: dismissed is terminal — dismissed → * rejected", () => {
  for (const to of ["proposed", "confirmed", "waived"]) {
    assert.throws(() => assertValidPrivilegeMarkerTransition("dismissed", to, "lawyer", "ok"), IllegalTransitionError, `dismissed→${to} must throw`);
  }
});

test("privilege-marker: waived is terminal — waived → * rejected", () => {
  for (const to of ["proposed", "confirmed", "dismissed"]) {
    assert.throws(() => assertValidPrivilegeMarkerTransition("waived", to, "lawyer", "ok"), IllegalTransitionError, `waived→${to} must throw`);
  }
});

test("privilege-marker: self-transitions all rejected", () => {
  for (const s of ["proposed", "confirmed", "dismissed", "waived"]) {
    assert.throws(() => assertValidPrivilegeMarkerTransition(s, s, "lawyer", "ok"), IllegalTransitionError, `${s}→${s} must throw`);
  }
});

test("privilege-marker: ALLOWED_PRIVILEGE_MARKER_EDGES content matches documented edge set exactly (drift guard)", () => {
  const documented = [
    { from: "proposed",  to: "confirmed", by: ["lawyer"], reason_required: undefined },
    { from: "proposed",  to: "dismissed", by: ["lawyer"], reason_required: true },
    { from: "confirmed", to: "waived",    by: ["lawyer"], reason_required: true },
  ];
  assert.equal(ALLOWED_PRIVILEGE_MARKER_EDGES.length, documented.length, "edge count drift");
  for (const d of documented) {
    const match = ALLOWED_PRIVILEGE_MARKER_EDGES.find((e) => e.from === d.from && e.to === d.to);
    assert.ok(match, `missing edge ${d.from}→${d.to}`);
    assert.deepEqual([...match.by], d.by, `actor list drift on ${d.from}→${d.to}`);
    assert.equal(match.reason_required === true ? true : undefined, d.reason_required, `reason_required drift on ${d.from}→${d.to}`);
  }
});

// ---------------------------------------------------------------------------
// Step 4 drift guard — schema entity_type enum matches CASE_BOX_AUDIT_ENTITY_TYPES
// ---------------------------------------------------------------------------

test("drift: schema entity_type.enum exactly matches CASE_BOX_AUDIT_ENTITY_TYPES", async () => {
  const { auditEventSchema, CASE_BOX_AUDIT_ENTITY_TYPES } = await import("../dist/index.js");
  const schemaEnum = auditEventSchema?.properties?.entity_type?.enum;
  assert.ok(Array.isArray(schemaEnum), "audit-event schema must declare entity_type as enum");
  assert.deepEqual([...schemaEnum].sort(), [...CASE_BOX_AUDIT_ENTITY_TYPES].sort());
});

// ---------------------------------------------------------------------------
// Step 6 — Docket entry state machine
// ---------------------------------------------------------------------------

test("docket entry: proposed → confirmed by lawyer is allowed (generic helper)", () => {
  assert.doesNotThrow(() => assertValidDocketEntryTransition("proposed", "confirmed", "lawyer"));
});

test("docket entry: proposed → dismissed requires non-empty reason", () => {
  assert.throws(() => assertValidDocketEntryTransition("proposed", "dismissed", "lawyer"));
  assert.throws(() => assertValidDocketEntryTransition("proposed", "dismissed", "lawyer", ""));
  assert.doesNotThrow(() => assertValidDocketEntryTransition("proposed", "dismissed", "lawyer", "LLM hallucinated"));
});

test("docket entry: non-lawyer actors throw on every edge", () => {
  for (const [from, to, reason] of [["proposed", "confirmed", undefined], ["proposed", "dismissed", "ok"]]) {
    for (const actor of ["coordinator", "ingestion", "review"]) {
      assert.throws(() => assertValidDocketEntryTransition(from, to, actor, reason), IllegalTransitionError, `${from}→${to} by ${actor} must throw`);
    }
  }
});

test("docket entry: confirmed is terminal — confirmed → * throws", () => {
  for (const to of ["proposed", "dismissed"]) {
    assert.throws(() => assertValidDocketEntryTransition("confirmed", to, "lawyer", "ok"), IllegalTransitionError, `confirmed→${to} must throw`);
  }
});

test("docket entry: dismissed is terminal — dismissed → * throws", () => {
  for (const to of ["proposed", "confirmed"]) {
    assert.throws(() => assertValidDocketEntryTransition("dismissed", to, "lawyer", "ok"), IllegalTransitionError);
  }
});

test("docket entry: self-transitions throw", () => {
  for (const s of ["proposed", "confirmed", "dismissed"]) {
    assert.throws(() => assertValidDocketEntryTransition(s, s, "lawyer", "ok"), IllegalTransitionError);
  }
});

test("docket entry: ALLOWED_DOCKET_ENTRY_EDGES content matches documented set (drift guard)", () => {
  const documented = [
    { from: "proposed", to: "confirmed", by: ["lawyer"], reason_required: undefined },
    { from: "proposed", to: "dismissed", by: ["lawyer"], reason_required: true },
  ];
  assert.equal(ALLOWED_DOCKET_ENTRY_EDGES.length, documented.length, "edge count drift");
  for (const d of documented) {
    const match = ALLOWED_DOCKET_ENTRY_EDGES.find((e) => e.from === d.from && e.to === d.to);
    assert.ok(match, `missing edge ${d.from}→${d.to}`);
    assert.deepEqual([...match.by], d.by);
    assert.equal(match.reason_required === true ? true : undefined, d.reason_required);
  }
});

test("docket entry: TERMINAL_DOCKET_ENTRY_STATES is [confirmed, dismissed]", () => {
  assert.deepEqual([...TERMINAL_DOCKET_ENTRY_STATES].sort(), ["confirmed", "dismissed"]);
});

// ---------------------------------------------------------------------------
// Fact lifecycle
// ---------------------------------------------------------------------------

test("fact: candidate → reviewed by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidFactTransition("candidate", "reviewed", "lawyer"));
});

test("fact: candidate → rejected by lawyer is allowed (shortcut)", () => {
  assert.doesNotThrow(() => assertValidFactTransition("candidate", "rejected", "lawyer"));
});

test("fact: reviewed → accepted by lawyer is allowed (promotion to SoT)", () => {
  assert.doesNotThrow(() => assertValidFactTransition("reviewed", "accepted", "lawyer"));
});

test("fact: reviewed → rejected by lawyer is allowed", () => {
  assert.doesNotThrow(() => assertValidFactTransition("reviewed", "rejected", "lawyer"));
});

test("fact: candidate → accepted by lawyer is REJECTED — load-bearing no-auto-accept gate", () => {
  assert.equal(isAllowedFactTransition("candidate", "accepted", "lawyer"), false);
  assert.throws(() => assertValidFactTransition("candidate", "accepted", "lawyer"), IllegalTransitionError);
});

test("fact: every promotion edge by coordinator is rejected (actor gating)", () => {
  for (const [from, to] of [["candidate", "reviewed"], ["candidate", "rejected"], ["reviewed", "accepted"], ["reviewed", "rejected"]]) {
    assert.throws(() => assertValidFactTransition(from, to, "coordinator"), IllegalTransitionError, `${from}→${to} by coordinator must throw`);
  }
});

test("fact: every promotion edge by ingestion is rejected (actor gating)", () => {
  for (const [from, to] of [["candidate", "reviewed"], ["candidate", "rejected"], ["reviewed", "accepted"], ["reviewed", "rejected"]]) {
    assert.throws(() => assertValidFactTransition(from, to, "ingestion"), IllegalTransitionError, `${from}→${to} by ingestion must throw`);
  }
});

test("fact: every promotion edge by review is rejected (actor gating)", () => {
  for (const [from, to] of [["candidate", "reviewed"], ["candidate", "rejected"], ["reviewed", "accepted"], ["reviewed", "rejected"]]) {
    assert.throws(() => assertValidFactTransition(from, to, "review"), IllegalTransitionError, `${from}→${to} by review must throw`);
  }
});

test("fact: accepted is terminal — every accepted→* transition rejected", () => {
  for (const to of ["candidate", "reviewed", "rejected"]) {
    assert.throws(() => assertValidFactTransition("accepted", to, "lawyer"), IllegalTransitionError, `accepted→${to} must throw`);
  }
});

test("fact: rejected is terminal — every rejected→* transition rejected", () => {
  for (const to of ["candidate", "reviewed", "accepted"]) {
    assert.throws(() => assertValidFactTransition("rejected", to, "lawyer"), IllegalTransitionError, `rejected→${to} must throw`);
  }
});

test("fact: self-transitions all rejected", () => {
  for (const s of ["candidate", "reviewed", "accepted", "rejected"]) {
    assert.throws(() => assertValidFactTransition(s, s, "lawyer"), IllegalTransitionError, `${s}→${s} must throw`);
  }
});
