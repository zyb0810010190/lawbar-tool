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
import fs from "node:fs";
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
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

const DB_FILE_GLOBS = [/\.db$/, /\.sqlite$/, /\.sqlite3$/, /\.db-wal$/, /\.db-shm$/, /\.sqlite-wal$/, /\.sqlite-shm$/, /case-box\.db/];

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
      if (entry === "node_modules" || entry === "dist" || entry === "dist-tarballs" || entry === "staging" || entry === ".git") continue;
      const full = path.join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (DB_FILE_GLOBS.some((re) => re.test(entry))) {
        out.push(full);
      }
    }
  }
  walk(rootDir);
  return out.sort();
}


async function waitForCaseBoxSurface(win) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const ready = await win.evaluate(() =>
      typeof window.lawbar?.caseBox?.createMatter === "function" &&
      typeof window.lawbar?.caseBox?.getMatter === "function" &&
      typeof window.lawbar?.caseBox?.listMatters === "function" &&
      typeof window.lawbar?.caseBox?.archiveMatter === "function" &&
      typeof window.lawbar?.caseBox?.chainHead === "function",
    );
    if (ready) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("HARNESS FAILURE — window.lawbar.caseBox surface not ready within 5s");
}

test("case-box IPC packaged renderer→main round-trip persists across restart in isolated userData", async (t) => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "lawbar-ipc-test-"));
  t.after(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  // Pre-launch snapshot
  const preTemp = persistenceFiles(tempRoot);
  const preRepo = persistenceFiles(REPO_ROOT);
  assert.equal(preTemp.length, 0, `pre-launch temp root should have no DB files: ${preTemp.join(", ")}`);

  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null, `packaged .app not found under ${releaseDirs.join(" | ")}; run \`npm run dist\` first`);
  const executablePath = path.join(appBundle, "Contents", "MacOS", "lawbar");

  // Use Electron's --user-data-dir flag (not HOME override) to redirect
  // `app.getPath("userData")` into the temp root. Overriding HOME breaks
  // Playwright's connection (its CDP / accessibility helpers need HOME).
  // --user-data-dir is the official Electron switch and is honored before
  // any of the app's own code runs.
  const app = await launchPackaged(
    {
      executablePath,
      args: [`--user-data-dir=${tempRoot}`],
      env: {
        ...process.env,
        LAWBAR_MODE: "dev",
      },
      timeout: 30000,
    },
    { testName: "casebox-ipc-round-trip" },
  );
  let createdMatterId;
  let chainAfterCount;
  try {
    const win = await app.firstWindow();
    // Bounded readiness poll: wait up to 5s for window.lawbar.caseBox.createMatter
    const deadline = Date.now() + 5000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await win.evaluate(() =>
        typeof window.lawbar?.caseBox?.createMatter === "function" &&
        typeof window.lawbar?.caseBox?.getMatter === "function" &&
        typeof window.lawbar?.caseBox?.listMatters === "function" &&
        typeof window.lawbar?.caseBox?.archiveMatter === "function" &&
        typeof window.lawbar?.caseBox?.chainHead === "function",
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ready, true, "HARNESS FAILURE — window.lawbar.caseBox surface not ready within 5s");

    // 1) createMatter happy path
    const createRes = await win.evaluate(() =>
      window.lawbar.caseBox.createMatter({
        name: "PoC synthetic matter",
        matter_type: "advisory",
        jurisdiction: { value: "us-fed", locked: false },
        parties: [
          { role: "client", display_name: "Acme Demonstration LLC", party_kind: "organization" },
        ],
        confidentiality_class: "normal",
      }),
    );
    assert.equal(createRes.ok, true, JSON.stringify(createRes));
    assert.equal(createRes.value.tenant_id, "default-tenant");
    assert.equal(createRes.value.actor_user_id, "local-user");
    assert.equal(createRes.value.external_ocr_authorized, false);
    assert.equal(createRes.value.sync_grant_present, false);
    assert.equal(createRes.value.llm_extraction_opt_in, false);
    createdMatterId = createRes.value.id;
    assert.match(createdMatterId, /^[0-9a-z]{26}$/);

    // 2) createMatter forbidden-field path → invalid_payload
    const forbidden = await win.evaluate(() =>
      window.lawbar.caseBox.createMatter({
        tenant_id: "evil-tenant",
        name: "x",
        matter_type: "advisory",
        jurisdiction: { value: "us-fed", locked: false },
        parties: [{ role: "client", display_name: "Y", party_kind: "individual" }],
        confidentiality_class: "normal",
      }),
    );
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.error.kind, "case_box_persistence_error");
    assert.equal(forbidden.error.code, "invalid_payload");
    assert.equal(forbidden.error.details?.schemaPath, "tenant_id");

    // 3) getMatter
    const getRes = await win.evaluate((id) =>
      window.lawbar.caseBox.getMatter({ matterId: id }),
    createdMatterId);
    assert.equal(getRes.ok, true);
    assert.equal(getRes.value.id, createdMatterId);

    // 4) listMatters
    const listRes = await win.evaluate(() =>
      window.lawbar.caseBox.listMatters({ status: "active", limit: 50 }),
    );
    assert.equal(listRes.ok, true);
    assert.ok(Array.isArray(listRes.value.rows));
    assert.ok(listRes.value.rows.length >= 1);

    // 5) chainHead BEFORE archive
    const chainBefore = await win.evaluate((id) =>
      window.lawbar.caseBox.chainHead({ matterId: id }),
    createdMatterId);
    assert.equal(chainBefore.ok, true);
    assert.equal(typeof chainBefore.value.count, "number");

    // 6) archiveMatter
    const archiveRes = await win.evaluate((id) =>
      window.lawbar.caseBox.archiveMatter({ matterId: id, reason: "PoC test cleanup" }),
    createdMatterId);
    assert.equal(archiveRes.ok, true);
    assert.equal(archiveRes.value.status, "archived");
    assert.ok(typeof archiveRes.value.archived_at === "string");

    // 7) chainHead AFTER archive — count should be >= chainBefore.count + 1
    const chainAfter = await win.evaluate((id) =>
      window.lawbar.caseBox.chainHead({ matterId: id }),
    createdMatterId);
    assert.equal(chainAfter.ok, true);
    assert.ok(chainAfter.value.count > chainBefore.value.count, `chain head count did not grow: before=${chainBefore.value.count} after=${chainAfter.value.count}`);
    chainAfterCount = chainAfter.value.count;
  } finally {
    await app.close();
  }

  assert.ok(createdMatterId, "created matter id must be captured before restart");
  assert.ok(typeof chainAfterCount === "number", "chain count must be captured before restart");

  // Relaunch against the SAME isolated userData dir. This is the product
  // durability canary: data created through packaged renderer→main IPC must
  // survive an Electron process boundary.
  const relaunched = await launchPackaged(
    {
      executablePath,
      args: [`--user-data-dir=${tempRoot}`],
      env: {
        ...process.env,
        LAWBAR_MODE: "dev",
      },
      timeout: 30000,
    },
    { testName: "casebox-ipc-restart" },
  );
  try {
    const win = await relaunched.firstWindow();
    await waitForCaseBoxSurface(win);

    const persisted = await win.evaluate((id) =>
      window.lawbar.caseBox.getMatter({ matterId: id }),
    createdMatterId);
    assert.equal(persisted.ok, true, JSON.stringify(persisted));
    assert.equal(persisted.value.id, createdMatterId);
    assert.equal(persisted.value.name, "PoC synthetic matter");
    assert.equal(persisted.value.status, "archived");

    const archivedList = await win.evaluate(() =>
      window.lawbar.caseBox.listMatters({ status: "archived", limit: 50 }),
    );
    assert.equal(archivedList.ok, true, JSON.stringify(archivedList));
    assert.ok(
      archivedList.value.rows.some((row) => row.id === createdMatterId),
      `archived list after restart did not contain ${createdMatterId}`,
    );

    const chainAfterRestart = await win.evaluate((id) =>
      window.lawbar.caseBox.chainHead({ matterId: id }),
    createdMatterId);
    assert.equal(chainAfterRestart.ok, true, JSON.stringify(chainAfterRestart));
    assert.ok(
      chainAfterRestart.value.count >= chainAfterCount,
      `chain count regressed across restart: before=${chainAfterCount} after=${chainAfterRestart.value.count}`,
    );
  } finally {
    await relaunched.close();
  }

  // Post-suite snapshot: scan BOTH isolated userData AND repo working tree.
  const postTemp = persistenceFiles(tempRoot);
  const postRepo = persistenceFiles(REPO_ROOT);
  const expectedDb = path.join(tempRoot, "case-box.sqlite");
  assert.ok(
    postTemp.includes(expectedDb),
    `post-suite: expected SQLite DB at ${expectedDb}; found: ${postTemp.join(", ")}`,
  );
  // Repo working tree diff: no new entries between pre and post.
  const newRepoEntries = postRepo.filter((p) => !preRepo.includes(p));
  assert.deepEqual(newRepoEntries, [], `post-suite: new DB files appeared in repo: ${newRepoEntries.join(", ")}`);
});
