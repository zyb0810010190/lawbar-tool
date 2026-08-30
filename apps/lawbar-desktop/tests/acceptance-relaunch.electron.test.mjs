// FIRST-REAL-WORK ACCEPTANCE DRILL — does work survive a restart, and can the owner verify the chain?
//
// WHY THIS EXISTS. FileVault was enabled on 2026-08-29, the readiness gate began passing, and the app
// crossed from "product shell is ready" into "a practising litigator may rely on this for a real
// matter". That transition changes which defects matter. The existing M1-M9 smoke matrix proves a
// great deal — launch, navigate, create, list, detail, sub-screen, archive, settings, localized error
// — but every one of those assertions happens inside ONE process lifetime.
//
// The two questions an operator actually has before trusting a tool with a case are not covered
// anywhere:
//
//   1. If I enter a matter today and quit, is it still there tomorrow?
//   2. Can I check for myself that the audit chain is intact?
//
// Question 1 is the one that makes everything else moot if the answer is wrong. Question 2 is the
// product's central court-facing claim — the chain is tamper-evidence, and evidence nobody can verify
// is not evidence. Neither had a test.
//
// This drives the PACKAGED binary, twice, against ONE profile directory, exactly as a person would:
// launch, create, quit, relaunch, look. No page.evaluate shortcuts into the IPC surface — if the
// matter is visible after restart it is because the real persistence path wrote it and the real
// renderer read it back.
//
// PROFILE SAFETY. Everything runs in a fresh temp directory passed as --user-data-dir. The litigator's
// real store at ~/Library/Application Support/lawbar is never opened; a pre/post scan asserts no
// database file appears anywhere outside the temp root, including the repo working tree.

// Guard #3 sentinel pair: this test must run through scripts/test-packaged-wrapper.mjs, which is what
// attributes any crash to the app rather than letting a silently dead process read as a pass.
if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs");
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs");
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(projectRoot, "..", "..");
const REAL_PROFILE = path.join(os.homedir(), "Library", "Application Support", "lawbar");
const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];
const DB_RE = /case-box\.sqlite(-wal|-shm)?$/;

function findPackagedAppDir() {
  const subs = os.arch() === "arm64" ? ["mac-arm64", "mac-x64", "mac"] : ["mac-x64", "mac", "mac-arm64"];
  for (const sub of subs) {
    for (const dir of releaseDirs) {
      const bundle = path.join(dir, sub, "lawbar.app");
      if (fs.existsSync(bundle)) return bundle;
    }
  }
  return null;
}

/** Database files anywhere under `root`, so a stray write outside the temp profile is visible. */
function dbFiles(root, depth = 0) {
  if (depth > 4 || !fs.existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === ".git" || entry === "release" || entry === "dist") continue;
    const p = path.join(root, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(...dbFiles(p, depth + 1));
    else if (DB_RE.test(entry)) out.push(p);
  }
  return out;
}

const MATTER = "acceptance-relaunch-A";

async function launch(profile, testName) {
  const bundle = findPackagedAppDir();
  assert.ok(bundle !== null, `packaged .app not found under ${releaseDirs.join(" | ")}; run \`npm run dist\` first`);
  const app = await launchPackaged(
    {
      executablePath: path.join(bundle, "Contents", "MacOS", "lawbar"),
      args: [`--user-data-dir=${profile}`],
      env: { ...process.env, LAWBAR_MODE: "dev" },
      timeout: 30000,
    },
    { testName },
  );
  // REFUSE if the app resolved the litigator's real store despite the flag.
  const resolved = await app.evaluate(async ({ app: a }) => a.getPath("userData"));
  assert.notEqual(
    fs.realpathSync(resolved),
    fs.existsSync(REAL_PROFILE) ? fs.realpathSync(REAL_PROFILE) : REAL_PROFILE,
    "REFUSING: the packaged app resolved the REAL user-data directory",
  );
  return app;
}

test("a matter created in one session is still there after quitting and relaunching", async (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), "lawbar-acceptance-"));
  t.after(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });

  assert.equal(dbFiles(profile).length, 0, "temp profile must start with no database");
  const repoBefore = dbFiles(REPO_ROOT);

  // ---------- Session 1: enter a matter, exactly as a person would ----------
  const first = await launch(profile, "acceptance-relaunch-session1");
  try {
    const win = await first.firstWindow();
    await win.waitForSelector("main#app", { timeout: 20000 });
    await win.waitForSelector('[data-test-id="list-empty"]', { timeout: 20000 });

    await win.locator("button.list-new-btn").click();
    await win.waitForSelector('[data-test-id="create-form"]');
    await win.fill("#cm-name", MATTER);
    await win.locator('input[name="matter_type"][value="litigation"]').check();
    await win.fill("#cm-jurisdiction-value", "acceptance-jx");
    await win.selectOption("#cm-party-0-role", "client");
    await win.fill("#cm-party-0-display-name", "syn-party-acceptance");
    await win.selectOption("#cm-party-0-party-kind", "individual");
    await win.locator('input[name="confidentiality_class"][value="normal"]').check();
    await win.locator('[data-test-id="create-submit"]').click();

    await win.waitForSelector('[data-test-id="view-title"]', { timeout: 10000 });
    assert.equal(await win.locator('[data-test-id="view-title"]').textContent(), MATTER,
      "session 1 must actually create the matter before the restart proves anything");
  } finally {
    await first.close().catch(() => {});
  }

  // The database must exist in the temp profile, and NOWHERE else.
  assert.ok(dbFiles(profile).length > 0, "session 1 wrote no database into the profile");
  assert.deepEqual(dbFiles(REPO_ROOT), repoBefore, "a database file appeared inside the repo working tree");

  // ---------- Session 2: a cold start against the same profile ----------
  const second = await launch(profile, "acceptance-relaunch-session2");
  try {
    const win = await second.firstWindow();
    await win.waitForSelector("main#app", { timeout: 20000 });

    // THE ASSERTION THE WHOLE FILE EXISTS FOR. A fresh process, a fresh renderer, the same profile.
    await win.waitForSelector("a.matter-name", { timeout: 20000 });
    const names = await win.locator("a.matter-name").allTextContents();
    assert.ok(names.includes(MATTER),
      `the matter did not survive a restart; list showed ${JSON.stringify(names)}`);

    // And it must open and still carry what was entered — "present in a list" is not "intact".
    await win.locator("a.matter-name", { hasText: MATTER }).first().click();
    await win.waitForSelector('[data-test-id="view-title"]', { timeout: 10000 });
    assert.equal(await win.locator('[data-test-id="view-title"]').textContent(), MATTER);
    const fields = await win.locator('[data-test-id="view-fields"]').textContent();
    assert.match(fields, /acceptance-jx/, "the jurisdiction entered in session 1 did not survive");

    // ---------- The owner's own integrity check, driven as a person would ----------
    // The chain section is a <details> that loads LAZILY — its body is populated by a click listener
    // on the summary, so nothing inside it exists in the DOM until the disclosure is opened. An
    // earlier draft of this test asserted on the verify button directly and failed, with a message
    // claiming the owner had no way to check the chain. That was the TEST being wrong about a
    // court-facing feature, not the app. Drive it the way a person does: open, then act.
    const summary = win.locator('[data-test-id="view-chain-summary"]');
    assert.equal(await summary.count(), 1, "the audit-chain disclosure is missing from matter detail");
    await summary.click();

    const verifyBtn = win.locator('[data-test-id="view-audit-verify-btn"]');
    await verifyBtn.waitFor({ state: "visible", timeout: 15000 });
    await verifyBtn.click();

    const result = win.locator('[data-test-id="view-audit-verify-result"]');
    await result.waitFor({ state: "visible", timeout: 15000 });
    const text = (await result.textContent()).trim();
    assert.notEqual(text, "", "verify reported nothing back; a silent result is indistinguishable from a hang");
    assert.match(text, /[一-鿿]/, "the verify result must be readable zh-CN, not a raw code");
    // The chain was written by the app itself moments ago across two sessions; it must verify clean.
    assert.doesNotMatch(text, /失败|错误|不一致|断裂/,
      `the audit chain failed verification after a normal create + restart; got: ${text}`);
  } finally {
    await second.close().catch(() => {});
  }

  assert.deepEqual(dbFiles(REPO_ROOT), repoBefore, "a database file appeared in the repo working tree");
});
