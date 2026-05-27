// Packaged renderer→main case-box UI flow test.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §9.6 + G-UI-10..13.
//
// Drives the FULL v1 flow via Playwright clicks/fills against the actual
// packaged product UI. Does NOT use page.evaluate to call window.lawbar.caseBox.*
// directly — that surface is covered by tests/casebox-ipc.electron.test.mjs.
//
// Flow: load #/matters (empty) → New matter → fill form → submit → view detail
// → Archive… → fill reason → submit → view (archived) → expand chain head
// → assert count + headHash visible (truncated per §6.5).
//
// Invariants: pre/post no-DB-file scan across tempRoot + repo working tree;
// no-real-data scanner exits 0 after the test; wrapper crash count invariant.

// Guard #3 sentinel pair (WI-2): must be present so the wrapper recognizes
// the test as opted-in to wrapper-driven runs.
if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error(
    "HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs",
  );
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error(
    "HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs",
  );
}

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const projectRoot = path.resolve(__dirname, "..");
const releaseDirs = [
  path.join(projectRoot, "dist"),
  path.join(projectRoot, "release"),
];

function findPackagedAppDir() {
  const isArm64 = os.arch() === "arm64";
  const hostArchSubdirs = isArm64 ? ["mac-arm64"] : ["mac-x64", "mac"];
  const otherArchSubdirs = isArm64 ? ["mac-x64", "mac"] : ["mac-arm64"];
  for (const sub of [...hostArchSubdirs, ...otherArchSubdirs]) {
    for (const dir of releaseDirs) {
      const appBundle = path.join(dir, sub, "lawbar.app");
      if (fs.existsSync(appBundle)) return appBundle;
    }
  }
  return null;
}

const NO_DB_GLOBS = [
  /\.db$/,
  /\.sqlite$/,
  /\.sqlite3$/,
  /\.db-wal$/,
  /\.db-shm$/,
  /case-box\.db/,
];

function persistenceFiles(rootDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === "dist-tarballs" ||
        entry === "staging" ||
        entry === ".git"
      ) continue;
      const full = path.join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (NO_DB_GLOBS.some((re) => re.test(entry))) {
        out.push(full);
      }
    }
  }
  walk(rootDir);
  return out.sort();
}

test("case-box UI packaged flow: list → create → view → archive → chain head", async (t) => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "lawbar-ui-test-"));
  t.after(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  // Pre-launch DB-file snapshot.
  const preTemp = persistenceFiles(tempRoot);
  const preRepo = persistenceFiles(REPO_ROOT);
  assert.equal(
    preTemp.length,
    0,
    `pre-launch temp root should have no DB files: ${preTemp.join(", ")}`,
  );

  const appBundle = findPackagedAppDir();
  assert.ok(
    appBundle !== null,
    `packaged .app not found under ${releaseDirs.join(" | ")}; run \`npm run dist\` first`,
  );
  const executablePath = path.join(appBundle, "Contents", "MacOS", "lawbar");

  const app = await launchPackaged(
    {
      executablePath,
      args: [`--user-data-dir=${tempRoot}`],
      env: { ...process.env, LAWBAR_MODE: "dev" },
      timeout: 30000,
    },
    { testName: "casebox-ui-flow" },
  );

  try {
    const win = await app.firstWindow();
    // Poll selectors directly instead of relying on `waitForLoadState`,
    // which is intermittently slow under Playwright Electron + asar. The
    // existing IPC packaged test uses the same direct-evaluate-poll pattern.
    await win.waitForSelector("main#app", { timeout: 20000 });
    await win.waitForSelector('h1', { timeout: 20000 });
    const h1Text = await win.locator("h1").first().textContent();
    assert.equal(h1Text, "lawbar — case-box");
    await win.waitForSelector('[data-test-id="list-empty"]', { timeout: 5000 });
    const emptyText = await win.locator('[data-test-id="list-empty"]').textContent();
    assert.match(
      emptyText,
      /Data is held in memory only — relaunching the app clears it\./,
    );

    // 2) Click + New matter → create form.
    await win.locator("button.list-new-btn").click();
    await win.waitForSelector('[data-test-id="create-form"]');
    const newTitle = await win.locator("h1").first().textContent();
    assert.equal(newTitle, "New matter");

    // 3) Fill form.
    await win.fill("#cm-name", "matter-fixture-A");
    // Matter type radio: Litigation.
    await win.locator('input[name="matter_type"][value="litigation"]').check();
    await win.fill("#cm-jurisdiction-value", "test-jx");
    await win.fill("#cm-party-0-role", "client");
    await win.fill("#cm-party-0-display-name", "syn-party-A");
    await win.fill("#cm-party-0-party-kind", "individual");
    await win.locator('input[name="confidentiality_class"][value="normal"]').check();

    // 4) Submit.
    await win.locator('[data-test-id="create-submit"]').click();

    // 5) View detail rendered.
    await win.waitForSelector('[data-test-id="view-title"]', { timeout: 5000 });
    const viewTitle = await win.locator('[data-test-id="view-title"]').textContent();
    assert.equal(viewTitle, "matter-fixture-A");
    // Status pill present + active modifier.
    await win.waitForSelector(".status-pill--active");

    // Detail fields contain the matter type label.
    const fieldsText = await win.locator('[data-test-id="view-fields"]').textContent();
    assert.match(fieldsText, /Litigation matter/);
    assert.match(fieldsText, /test-jx/);
    assert.match(fieldsText, /Normal/);

    // 6) Click Archive… → archive form.
    await win.locator('[data-test-id="view-archive"]').click();
    await win.waitForSelector('[data-test-id="archive-form"]');
    const archiveTitle = await win.locator('[data-test-id="archive-title"]').textContent();
    assert.match(archiveTitle, /Archive matter — matter-fixture-A/);

    // 7) Fill reason + submit.
    await win.fill("#am-reason", "synthetic-archive-reason-fixture");
    await win.locator('[data-test-id="archive-submit"]').click();

    // 8) Back on view; status now archived.
    await win.waitForSelector(".status-pill--archived", { timeout: 5000 });
    const fieldsAfterArchive = await win
      .locator('[data-test-id="view-fields"]')
      .textContent();
    assert.match(fieldsAfterArchive, /Reason recorded in audit log\./);
    // Archive button absent in archived state.
    const archiveBtnCount = await win.locator('[data-test-id="view-archive"]').count();
    assert.equal(archiveBtnCount, 0);

    // 9) Expand audit chain head disclosure.
    await win.locator('[data-test-id="view-chain-summary"]').click();
    await win.waitForSelector('[data-test-id="view-chain-headhash"]', { timeout: 5000 });
    const headHashText = await win
      .locator('[data-test-id="view-chain-headhash-truncated"]')
      .textContent();
    // Truncated form contains "..." per §6.5 rule.
    assert.match(headHashText, /\.\.\./);
    const countText = await win
      .locator('[data-test-id="view-chain-count"]')
      .textContent();
    assert.ok(
      Number(countText) >= 1,
      `expected chain count >= 1; got ${countText}`,
    );
  } finally {
    await app.close();
  }

  // 10) Post-suite no-DB-file scan: both tempRoot and repo working tree.
  const postTemp = persistenceFiles(tempRoot);
  const postRepo = persistenceFiles(REPO_ROOT);
  assert.deepEqual(
    postTemp,
    [],
    `post-suite: temp root contains DB files: ${postTemp.join(", ")}`,
  );
  const newRepoEntries = postRepo.filter((p) => !preRepo.includes(p));
  assert.deepEqual(
    newRepoEntries,
    [],
    `post-suite: new DB files appeared in repo: ${newRepoEntries.join(", ")}`,
  );

  // 11) Programmatic invocation of the no-real-data scanner against the
  // working tree (G-UI-12).
  try {
    execFileSync(
      "node",
      [path.join(projectRoot, "scripts", "check-no-real-data.mjs")],
      { stdio: "pipe" },
    );
  } catch (err) {
    assert.fail(
      `check-no-real-data scanner failed after test body: ${err.stdout?.toString() ?? err.message}`,
    );
  }
});
