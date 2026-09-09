// Backup screen — the tests are mostly about what this screen must REFUSE to say.
//
// The realistic failure mode is not a crash. It is an external drive that is absent, full, or
// unplugged partway through, leaving a half-written archive and an owner who saw an encouraging
// message and believes the case box is protected. Every assertion below exists because some
// plausible, well-meaning implementation would have got it wrong in that direction:
//
//   * reporting "已备份" for a copy that failed verification
//   * treating a cancelled file dialog as an error
//   * letting a filesystem path (which can carry a client's name) reach the screen
//   * showing a soft, neutral empty state for "there has never been a verified backup", which is
//     the single condition where losing this machine loses the client's file outright
//   * leaving the button live-looking but inert when the status read throws (the #283 defect)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountBackup } from "../dist/renderer/screens/backup.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import { MockDoc, findByTestId, collectText } from "./_view-matter-dom.mjs";
import { readFileSync } from "node:fs";

const NEVER = { lastVerifiedAt: null, daysSinceLastVerified: null, hasEverBackedUp: false };
const RECENT = { lastVerifiedAt: "2026-09-02T00:00:00.000Z", daysSinceLastVerified: 0, hasEverBackedUp: true };
const STALE = { lastVerifiedAt: "2026-08-20T00:00:00.000Z", daysSinceLastVerified: 13, hasEverBackedUp: true };

function mount({ status = RECENT, run } = {}) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const deps = {
    doc,
    getStatus: typeof status === "function" ? status : async () => status,
    runBackup: run ?? (async () => ({ ok: true, verifiedAt: "2026-09-02T00:00:00.000Z" })),
  };
  return { doc, root, promise: mountBackup(root, deps) };
}

const clickRun = async (root) => {
  findByTestId(root, "backup-run").dispatchEvent({ type: "click" });
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

// MARK: - Status

test("never backed up is an ALERT, not a neutral empty state", async () => {
  const { root, promise } = mount({ status: NEVER });
  await promise;
  const node = findByTestId(root, "backup-never");
  assert.ok(node, "the never-backed-up state must render its own node");
  assert.equal(node.getAttribute("role"), "alert",
    "this is the one condition where losing the machine loses the file — it is not neutral");
  assert.equal(collectText(node), CATALOG["backup.status.never"]);
});

test("a verified backup reports its AGE, and says 校验 rather than merely 备份", async () => {
  const { root, promise } = mount({ status: STALE });
  await promise;
  const text = collectText(findByTestId(root, "backup-status"));
  assert.ok(text.includes("13"), `the age must be visible; got ${JSON.stringify(text)}`);
  assert.ok(text.includes("校验"),
    "a copy that has not been checked is not a backup, and the status must not claim otherwise");
});

test("a status read that throws says so instead of implying safety", async () => {
  const { root, promise } = mount({ status: async () => { throw new Error("bridge down"); } });
  await promise;
  const node = findByTestId(root, "backup-status-error");
  assert.ok(node, "silence would read as 'fine'");
  assert.equal(collectText(node), CATALOG["backup.status.unavailable"]);
  assert.equal(collectText(node).includes("bridge down"), false, "no raw transport text on screen");
});

test("a throwing status still leaves the button wired — the #283 defect", async () => {
  let ran = 0;
  const { root, promise } = mount({
    status: async () => { throw new Error("bridge down"); },
    run: async () => { ran += 1; return { ok: true, verifiedAt: "2026-09-02T00:00:00.000Z" }; },
  });
  await promise;
  await clickRun(root);
  assert.equal(ran, 1, "a dead button is indistinguishable from a broken app");
});

// MARK: - Running

test("success says verified, and refreshes the status", async () => {
  let calls = 0;
  const { root, promise } = mount({
    status: async () => (calls++ === 0 ? NEVER : RECENT),
    run: async () => ({ ok: true, verifiedAt: "2026-09-02T00:00:00.000Z" }),
  });
  await promise;
  assert.ok(findByTestId(root, "backup-never"), "starts with no backup");
  await clickRun(root);
  assert.equal(collectText(findByTestId(root, "backup-result")), CATALOG["backup.verified"]);
  assert.ok(findByTestId(root, "backup-status"), "the status must be re-read after a success");
  assert.equal(findByTestId(root, "backup-never"), null, "the alarm must clear once it is untrue");
});

test("a CANCELLED dialog is not an error and says nothing", async () => {
  const { root, promise } = mount({ run: async () => ({ ok: false, code: "cancelled" }) });
  await promise;
  await clickRun(root);
  assert.equal(findByTestId(root, "backup-result"), null,
    "closing a file dialog is not a failure and must not be reported as one");
});

test("verification failure NEVER reads as success, and does not just say 请重试", async () => {
  const { root, promise } = mount({ run: async () => ({ ok: false, code: "verification_failed" }) });
  await promise;
  await clickRun(root);
  const node = findByTestId(root, "backup-result");
  assert.equal(node.getAttribute("role"), "alert");
  const text = collectText(node);
  assert.equal(text, CATALOG["backup.failed.verification"]);
  assert.equal(text.includes("已完成"), false, "a failed verification is not a completed backup");
  assert.ok(text.includes("更换") || text.includes("磁盘"),
    "retrying on the same faulty medium is the least likely thing to help, so the copy must say more than 请重试");
});

test("each failure code maps to its own copy, and an unknown code degrades safely", async () => {
  const cases = [
    ["destination_inside_data_dir", "backup.failed.insideDataDir"],
    ["destination_unusable", "backup.failed.destinationUnusable"],
    ["snapshot_failed", "backup.failed.generic"],
    ["documents_copy_failed", "backup.failed.generic"],
    ["something_added_in_a_later_version", "backup.failed.generic"],
  ];
  for (const [code, key] of cases) {
    const { root, promise } = mount({ run: async () => ({ ok: false, code }) });
    await promise;
    await clickRun(root);
    assert.equal(collectText(findByTestId(root, "backup-result")), CATALOG[key], `code ${code}`);
  }
});

test("a rejecting run() is caught rather than becoming an unhandled rejection", async () => {
  const { root, promise } = mount({ run: async () => { throw new Error("/Volumes/Client Name/x"); } });
  await promise;
  await clickRun(root);
  const text = collectText(findByTestId(root, "backup-result"));
  assert.equal(text, CATALOG["backup.failed.generic"]);
  assert.equal(text.includes("Client Name"), false,
    "a destination path can carry a client's name — drives get labelled after the matter");
  assert.equal(text.includes("/Volumes"), false, "no filesystem path reaches the screen");
});

test("the button is disabled while running and re-enabled afterwards, including on failure", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { root, promise } = mount({ run: async () => { await gate; return { ok: false, code: "snapshot_failed" }; } });
  await promise;
  const button = findByTestId(root, "backup-run");
  button.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  assert.equal(button.disabled, true, "a second click mid-run would start a second archive");
  release();
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  assert.equal(button.disabled, false, "a failed run must not leave the owner unable to retry");
});

// MARK: - The custody caveat is on the screen, not in a footnote

test("the screen states that a still-connected backup is not a witness", async () => {
  const { root, promise } = mount();
  await promise;
  const text = collectText(findByTestId(root, "backup-custody"));
  assert.equal(text, CATALOG["backup.custody"]);
  assert.ok(text.includes("断开"),
    "the operational commitment the code cannot supply must be stated where it is read");
});

// MARK: - The deliberate deviation from the shared failure form

test("backup failure copy either follows 无法…请重试。 or names a corrective action", () => {
  // R3-FUP-2 pinned a shared shape for keys ending `.failed`. These keys are `backup.failed.*`,
  // so they fall outside that assertion — and they deviate on purpose: on a screen about an
  // external drive, "请重试" alone is often the WRONG advice. A destination inside the data
  // directory and a failed verification both need the owner to change something, and a bare
  // retry invites them to repeat the same failure on the same faulty medium.
  //
  // Asserting it here makes the deviation deliberate rather than an accident of key naming.
  // An explicit enumeration, deliberately. A looser check ("contains 请") would accept 请重试 and
  // defeat the whole point; this list grows only when a genuinely new corrective instruction is
  // written, and it caught `backup.failed.readOnly` on the way in — which said 请改用, a real
  // instruction that simply was not yet on the list.
  const CORRECTIVE = ["请选择", "请确认", "请改用", "更换", "断开", "格式化"];
  const keys = Object.keys(CATALOG).filter((k) => k.startsWith("backup.failed."));
  assert.ok(keys.length >= 4, `expected the backup failure family; found ${keys.length}`);
  for (const k of keys) {
    const v = CATALOG[k];
    assert.match(v, /[一-鿿]/, `${k} must be zh-CN`);
    const sharedForm = /^无法.+，请重试。$/.test(v);
    const corrective = CORRECTIVE.some((c) => v.includes(c));
    assert.ok(sharedForm || corrective,
      `${k} neither follows the shared failure form nor tells the owner what to change: ${v}`);
  }
});

test("no backup string claims success for something that was not verified", () => {
  for (const [k, v] of Object.entries(CATALOG)) {
    if (!k.startsWith("backup.") || typeof v !== "string") continue;
    if (k === "backup.verified" || k === "backup.status.today" || k === "backup.status.daysAgo") continue;
    assert.equal(/备份(已)?完成(?!.*校验)/.test(v), false,
      `${k} reads as a completed backup without naming verification: ${v}`);
  }
  // And the three that DO report success must all name verification.
  for (const k of ["backup.verified", "backup.status.today", "backup.status.daysAgo"]) {
    assert.ok(CATALOG[k].includes("校验"),
      `${k} reports success and must say 校验 — a copy that was not checked is not a backup`);
  }
});

test("every data-i18n key in index.html resolves — a missing one renders a blank label", () => {
  // Not previously covered anywhere: the shell fills `data-i18n` spans from the catalog, and a key
  // with no entry produces an EMPTY sidebar item rather than an error. Adding the backup nav link
  // is what surfaced the gap, so the guard lands with it.
  const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `expected the shell's i18n keys; found ${keys.length}`);
  const missing = keys.filter((k) => !(k in CATALOG));
  assert.deepEqual(missing, [], `data-i18n keys with no catalog entry: ${missing.join(", ")}`);
});
