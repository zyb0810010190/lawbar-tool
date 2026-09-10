// The evidence channels in a REAL Electron process with an isolated profile (WI-10).
//
// The unit tests prove the handlers against a real persistence and the screen against an injected
// bridge. What only a real process can prove: the preload exposes the three methods, and a call
// that crosses the real IPC boundary comes back as a boundary CODE, not as a thrown error or a
// message. Same launchIsolated discipline as every other Electron test here: a temp
// --user-data-dir, and a refusal if the app resolves the real profile.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_USER_DATA = path.join(os.homedir(), "Library", "Application Support", "lawbar");

async function launchIsolated(t) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "lawbar-evidence-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], cwd: projectRoot, env: { ...process.env, LAWBAR_MODE: "" } });
  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.equal(realpathSync(resolved), realpathSync(profile), "the app ignored --user-data-dir");
  assert.notEqual(realpathSync(resolved), existsSync(REAL_USER_DATA) ? realpathSync(REAL_USER_DATA) : REAL_USER_DATA,
    "REFUSING: the app resolved the REAL user-data directory.");
  t.after(async () => { await app.close().catch(() => {}); rmSync(profile, { recursive: true, force: true }); });
  return { app, profile };
}

async function productWindow(app) {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  return (await win.locator("#readiness-title").count()) > 0 ? null : win;
}

test("the bridge exposes listEvidenceItems / createEvidenceItem / transitionEvidenceItem on casebox", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { t.skip("readiness gate is blocking on this host; the bridge is not reachable"); return; }
  const keys = await win.evaluate(() => Object.keys(window.lawbar.caseBox).filter((k) => /Evidence/.test(k)).sort());
  assert.deepEqual(keys, ["createEvidenceItem", "listEvidenceItems", "transitionEvidenceItem"]);
});

test("across the real IPC boundary: an unknown matter is a CODE, a server-authority field is refused, nothing throws", async (t) => {
  const { app } = await launchIsolated(t);
  const win = await productWindow(app);
  if (win === null) { t.skip("readiness gate is blocking on this host"); return; }
  const r = await win.evaluate(async () => {
    const unknown = await window.lawbar.caseBox.listEvidenceItems({ matterId: "01j0000000000000000000nomat".slice(0, 26) });
    const forbidden = await window.lawbar.caseBox.createEvidenceItem({ matterId: "01j0000000000000000000nomat".slice(0, 26), documentId: "x".repeat(26), evidence_title: "t", status: "accepted" });
    const badTarget = await window.lawbar.caseBox.transitionEvidenceItem({ matterId: "01j0000000000000000000nomat".slice(0, 26), evidenceId: "x".repeat(26), to: "reviewed" });
    return { unknown, forbidden, badTarget };
  });
  assert.equal(r.unknown.ok, false);
  assert.equal(r.unknown.error.code, "unknown_matter");
  assert.equal(r.forbidden.ok, false);
  assert.equal(r.forbidden.error.code, "invalid_payload");
  assert.equal(r.badTarget.ok, false);
  assert.equal(r.badTarget.error.code, "invalid_payload");
  for (const env of Object.values(r)) {
    assert.equal(typeof env.error.message, "string");
    assert.equal(/\/Users\/|\/private\//.test(env.error.message), false, "no filesystem path in a boundary message");
  }
});
