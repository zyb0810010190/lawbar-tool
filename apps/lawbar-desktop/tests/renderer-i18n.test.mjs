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
// Canonical audit-event-kind vocabulary (the contract owns it). Deriving the
// coverage list from here keeps the per-kind label test exhaustive + self-
// maintaining for any future kind (WI-A3-LINK-T2-AUD-L1, closing T2-AUD-L1).
// Same import pattern as tests/renderer-audit-labels.test.mjs.
import { CASE_BOX_AUDIT_EVENT_KINDS } from "case-box-contract";

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

// Derived from the canonical contract vocabulary (not a hand-maintained list),
// so the per-kind label test below covers EVERY audit kind — incl. the A3 link
// kinds LINK_CREATED/LINK_UNLINKED/LINK_RELINKED — and any future kind.
const ALL_EVENT_KINDS = Object.keys(CASE_BOX_AUDIT_EVENT_KINDS);

test("facade: eventKindLabel resolves a non-empty zh-CN label for every audit event kind", () => {
  for (const kind of ALL_EVENT_KINDS) {
    const label = eventKindLabel(kind);
    assert.ok(typeof label === "string" && label.length > 0, `empty label for ${kind}`);
  }
});

test("catalog: holds an eventKind.* key for every contract audit kind + the enum-label keys", () => {
  const keys = Object.keys(CATALOG);
  const eventKindKeys = keys.filter((k) => k.startsWith("eventKind."));
  // Derived from the contract kind set (never a hardcoded count) so additive vocabulary growth
  // (e.g. WI-PTA-03's 18 pre-trial kinds) cannot silently desync catalog ↔ contract.
  assert.equal(eventKindKeys.length, ALL_EVENT_KINDS.length, "expected one eventKind.* catalog key per contract audit kind");
  for (const id of ["matterType.litigation", "confidentiality.sealed", "status.active",
    "deadlineUrgency.overdue", "ledgerCategory.counsel"]) {
    assert.ok(id in CATALOG, `missing catalog key ${id}`);
  }
});
