// ledgerCategory + ledgerCategoryLabel unit tests.
// Per dev-memo/plan-casebox-ui-design-hardening-00.md S5 + handoff §03 Task 5.
//
// Pure-Node; no DOM, no IPC, no fixtures from outside the renderer compiled
// output. Mapping:
//   litigation, arbitration, criminal_defense → "litigation"
//   advisory                                  → "counsel"
//   due_diligence, other                      → "non_litigation"

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ledgerCategory,
  ledgerCategoryLabel,
} from "../dist/renderer/format.js";

// --- ledgerCategory mapping (6 inputs × expected outputs) ---

test("ledgerCategory: litigation → litigation", () => {
  assert.equal(ledgerCategory("litigation"), "litigation");
});

test("ledgerCategory: arbitration → litigation", () => {
  assert.equal(ledgerCategory("arbitration"), "litigation");
});

test("ledgerCategory: criminal_defense → litigation", () => {
  assert.equal(ledgerCategory("criminal_defense"), "litigation");
});

test("ledgerCategory: advisory → counsel", () => {
  assert.equal(ledgerCategory("advisory"), "counsel");
});

test("ledgerCategory: due_diligence → non_litigation", () => {
  assert.equal(ledgerCategory("due_diligence"), "non_litigation");
});

test("ledgerCategory: other → non_litigation", () => {
  assert.equal(ledgerCategory("other"), "non_litigation");
});

// --- ledgerCategoryLabel display strings (English at S5; Chinese at S6 per plan) ---

test("ledgerCategoryLabel: litigation → 'Litigation'", () => {
  assert.equal(ledgerCategoryLabel("litigation"), "Litigation");
});

test("ledgerCategoryLabel: counsel → 'Counsel'", () => {
  assert.equal(ledgerCategoryLabel("counsel"), "Counsel");
});

test("ledgerCategoryLabel: non_litigation → 'Non-litigation'", () => {
  assert.equal(ledgerCategoryLabel("non_litigation"), "Non-litigation");
});

// --- Coverage cross-check: every MatterType value resolves cleanly ---

test("ledgerCategory: every MatterType from the contract enum returns a defined LedgerCategory", () => {
  // Mirror of the contract enum at services/case-box-persistence schemas.
  // If a new MatterType is ever added (which is a separate STOP-AND-ASK per
  // the IPC contract), this test fails loudly and forces the impl WI to
  // extend the mapping.
  const ALL_MATTER_TYPES = [
    "litigation",
    "arbitration",
    "advisory",
    "due_diligence",
    "criminal_defense",
    "other",
  ];
  for (const t of ALL_MATTER_TYPES) {
    const c = ledgerCategory(t);
    assert.ok(
      c === "litigation" || c === "counsel" || c === "non_litigation",
      `ledgerCategory(${t}) returned ${c}; expected one of litigation/counsel/non_litigation`,
    );
  }
});

test("ledgerCategoryLabel: every LedgerCategory has a non-empty string label", () => {
  const ALL = ["litigation", "counsel", "non_litigation"];
  for (const c of ALL) {
    const label = ledgerCategoryLabel(c);
    assert.ok(
      typeof label === "string" && label.length > 0,
      `ledgerCategoryLabel(${c}) returned ${label}; expected non-empty string`,
    );
  }
});
