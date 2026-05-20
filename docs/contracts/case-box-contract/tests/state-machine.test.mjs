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
  ALLOWED_MATTER_EDGES,
  ALLOWED_DOCUMENT_EDGES,
  ALLOWED_EVIDENCE_EDGES,
  ALLOWED_DEADLINE_EDGES,
  isAllowedMatterTransition,
  isAllowedDocumentTransition,
  isAllowedEvidenceTransition,
  isAllowedDeadlineTransition,
  assertValidMatterTransition,
  assertValidDocumentTransition,
  assertValidEvidenceTransition,
  assertValidDeadlineTransition,
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
});

test("terminal lists are subsets of state lists", () => {
  for (const s of TERMINAL_MATTER_STATES) assert.ok(MATTER_STATES.includes(s));
  for (const s of TERMINAL_DOCUMENT_STATES) assert.ok(DOCUMENT_STATES.includes(s));
  for (const s of TERMINAL_EVIDENCE_STATES) assert.ok(EVIDENCE_STATES.includes(s));
  for (const s of TERMINAL_DEADLINE_STATES) assert.ok(DEADLINE_STATES.includes(s));
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
  ];
  for (const e of allEdges) {
    assert.ok(Array.isArray(e.by) && e.by.length > 0, `edge ${e.from}→${e.to} has no actor`);
  }
});
