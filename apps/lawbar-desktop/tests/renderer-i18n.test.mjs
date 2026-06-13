// i18n catalog / t() / facade tests (WI-i18n-1). Imports the COMPILED modules from dist/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import { t, LOCALE } from "../dist/renderer/i18n/t.js";
import {
  matterTypeLabel,
  confidentialityLabel,
  statusLabel,
  deadlineUrgencyLabel,
  ledgerCategoryLabel,
  eventKindLabel,
} from "../dist/renderer/i18n/labels.js";

test("LOCALE is zh-CN (v1, no runtime switch)", () => {
  assert.equal(LOCALE, "zh-CN");
});

test("t(): resolves a known key to its zh-CN value", () => {
  assert.equal(t("status.active"), "进行中");
  assert.equal(t("common.loadMore"), "加载更多");
});

test("t(): named interpolation substitutes params", () => {
  assert.equal(t("list.loading", { status: "进行中" }), "正在加载进行中案件…");
});

test("t(): ALWAYS throws on a missing required param (no partial render)", () => {
  assert.throws(() => t("list.loading"), /missing param "status"/);
  assert.throws(() => t("list.loading", {}), /missing param "status"/);
});

test("t(): throws on a missing key (defends a cast at the call site)", () => {
  // @ts-expect-error-equivalent: simulate an unchecked key reaching t()
  assert.throws(() => t("nope.not.a.key"), /missing catalog key/);
});

test("facade: small enums resolve via exhaustive switch (every member)", () => {
  for (const [m, want] of [
    ["litigation", "诉讼"],
    ["arbitration", "仲裁"],
    ["advisory", "顾问"],
    ["due_diligence", "尽职调查"],
    ["criminal_defense", "刑事辩护"],
    ["other", "其他"],
  ]) {
    assert.equal(matterTypeLabel(m), want);
  }
  assert.equal(confidentialityLabel("normal"), "普通");
  assert.equal(confidentialityLabel("heightened"), "加强");
  assert.equal(confidentialityLabel("sealed"), "密封");
  assert.equal(statusLabel("active"), "进行中");
  assert.equal(statusLabel("archived"), "已归档");
  assert.equal(deadlineUrgencyLabel("overdue"), "逾期");
  assert.equal(deadlineUrgencyLabel("due-soon"), "即将到期");
  assert.equal(deadlineUrgencyLabel("none"), ""); // intentionally empty
  assert.equal(ledgerCategoryLabel("litigation"), "诉讼");
  assert.equal(ledgerCategoryLabel("counsel"), "顾问");
  assert.equal(ledgerCategoryLabel("non_litigation"), "非诉讼");
});

const ALL_EVENT_KINDS = [
  "MATTER_REGISTERED", "MATTER_ARCHIVED", "MATTER_UNARCHIVED", "DOCUMENT_REGISTERED",
  "DOCUMENT_OCR_SUBMITTED", "DOCUMENT_OCR_COMPLETE", "DOCUMENT_OCR_FAILED", "DOCUMENT_TRIAGED",
  "DOCUMENT_TAGGED", "DOCUMENT_REVIEWED", "DOCUMENT_SOFT_DELETED", "OCR_LINK_SNAPSHOTTED",
  "OCR_LINK_REFRESHED", "DEADLINE_REGISTERED", "DEADLINE_MET", "DEADLINE_MISSED", "DEADLINE_WITHDRAWN",
  "DEADLINE_MISSED_TO_MET", "EVIDENCE_PROPOSED", "EVIDENCE_ACCEPTED", "EVIDENCE_REJECTED",
  "EVIDENCE_SUPERSEDED", "FACT_PROPOSED", "FACT_REVIEWED", "FACT_ACCEPTED", "FACT_REJECTED",
  "FACT_REPLACEMENT_ACCEPTED", "PRIVILEGE_MARKER_PROPOSED", "PRIVILEGE_MARKER_CONFIRMED",
  "PRIVILEGE_MARKER_DISMISSED", "PRIVILEGE_MARKER_WAIVED", "EXTERNAL_OCR_AUTHORIZED",
  "EXTERNAL_OCR_REVOKED", "SYNC_GRANT_GRANTED", "SYNC_GRANT_REVOKED", "LLM_EXTRACTION_OPT_IN",
  "LLM_EXTRACTION_OPT_OUT", "PRIVILEGE_LOG_EXPORTED", "CASE_DATA_EXPORTED", "DOCUMENT_ACCESSED",
  "DOCUMENT_PRINTED", "DOCUMENT_SHARED", "CLASSIFICATION_SET", "CLASSIFICATION_UPGRADED",
  "CLASSIFICATION_DOWNGRADED", "CLASSIFICATION_RESET_TO_UNCLASSIFIED", "DOCKET_ENTRY_PROPOSED",
  "DOCKET_ENTRY_CONFIRMED", "DOCKET_ENTRY_DISMISSED", "DOCKET_ENTRY_REVISED",
];

test("facade: eventKindLabel resolves a non-empty zh-CN label for every audit event kind", () => {
  for (const kind of ALL_EVENT_KINDS) {
    const label = eventKindLabel(kind);
    assert.ok(typeof label === "string" && label.length > 0, `empty label for ${kind}`);
  }
});

test("catalog: holds all 50 eventKind.* keys + the enum-label keys", () => {
  const keys = Object.keys(CATALOG);
  const eventKindKeys = keys.filter((k) => k.startsWith("eventKind."));
  assert.equal(eventKindKeys.length, 50, "expected 50 eventKind.* catalog keys");
  for (const id of ["matterType.litigation", "confidentiality.sealed", "status.active",
    "deadlineUrgency.overdue", "ledgerCategory.counsel"]) {
    assert.ok(id in CATALOG, `missing catalog key ${id}`);
  }
});
