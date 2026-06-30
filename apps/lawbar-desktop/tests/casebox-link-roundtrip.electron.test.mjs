// WI-A3-LINK-D1-ROUNDTRIP-T1 — closes deferred finding LINK-IPC-T1-D1.
// Real-db packaged-Electron round-trip for the casebox:link:* surface, seeded by
// the DEFAULT-OFF, env-gated globalThis hook in electron/main.ts
// (LAWBAR_CASEBOX_LINK_SEED_TEST_HOOK). See
// docs/adr/ADR-evidence-a3-link-d1-roundtrip-closure.md rev-1 §0/§11/§12/§13.
//
// Guard #3 sentinel pair (must be present so the wrapper recognizes the test).
if (process.env.LAWBAR_TEST_PID_LOG === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_TEST_PID_LOG not set; run via scripts/test-packaged-wrapper.mjs");
}
if (process.env.LAWBAR_WRAPPER_VERSION === undefined) {
  throw new Error("HARNESS FAILURE — LAWBAR_WRAPPER_VERSION not set; run via scripts/test-packaged-wrapper.mjs");
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchPackaged } from "./_launch-with-pid-log.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseDirs = [path.join(projectRoot, "dist"), path.join(projectRoot, "release")];

function findPackagedAppDir() {
  const isArm64 = os.arch() === "arm64";
  const subdirs = isArm64 ? ["mac-arm64", "mac-x64", "mac"] : ["mac-x64", "mac", "mac-arm64"];
  for (const sub of subdirs) {
    for (const dir of releaseDirs) {
      const appBundle = path.join(dir, sub, "lawbar.app");
      if (fs.existsSync(appBundle)) return appBundle;
    }
  }
  return null;
}

function resolveExecutable() {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle !== null, `packaged .app not found under ${releaseDirs.join(" | ")}; run \`npm run dist\` first`);
  return path.join(appBundle, "Contents", "MacOS", "lawbar");
}

async function waitFor(fn, label, deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`HARNESS FAILURE — ${label} not ready within ${deadlineMs}ms`);
}

test("D1: real-db casebox:link:* round-trip resolves valid + clean export via the env-gated seed hook", { timeout: 120000 }, async (t) => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "lawbar-link-rt-"));
  t.after(() => { try { rmSync(tempRoot, { recursive: true, force: true }); } catch {} });

  const app = await launchPackaged(
    {
      executablePath: resolveExecutable(),
      args: [`--user-data-dir=${tempRoot}`],
      env: { ...process.env, LAWBAR_MODE: "dev", LAWBAR_CASEBOX_LINK_SEED_TEST_HOOK: "true" },
      timeout: 30000,
    },
    { testName: "casebox-link-roundtrip" },
  );

  try {
    const win = await app.firstWindow();
    await waitFor(
      () => win.evaluate(() =>
        typeof window.lawbar?.caseBox?.createMatter === "function" &&
        typeof window.lawbar?.caseBox?.createLink === "function" &&
        typeof window.lawbar?.caseBox?.listLinks === "function" &&
        typeof window.lawbar?.caseBox?.exportLinkCitations === "function"),
      "window.lawbar.caseBox link surface",
    );
    await waitFor(() => app.evaluate(() => typeof globalThis.__lawbarCaseBoxLinkSeed === "function"), "seed hook");

    // 1) Create a matter (real IPC; tenant_id is main-injected, not returned).
    const createMatter = await win.evaluate(() =>
      window.lawbar.caseBox.createMatter({
        name: "D1 round-trip synthetic matter",
        matter_type: "advisory",
        jurisdiction: { value: "us-fed", locked: false },
        parties: [{ role: "client", display_name: "Synthetic LLC", party_kind: "organization" }],
        confidentiality_class: "normal",
      }),
    );
    assert.equal(createMatter.ok, true, JSON.stringify(createMatter));
    const matterId = createMatter.value.id;

    // 2) Synthetic documentId — createLink/resolver/export need no case_box_documents row,
    //    and registerDocument is interactive (modal file picker) so it blocks headless.
    const documentId = "d1rt-doc-0";

    // 3) Seed the resolver/export dependency set via the env-gated main-process hook
    //    (runs against main's real, already-open SQLite handle — NOT mocked).
    const seeded = await app.evaluate((_electron, input) => {
      const fn = globalThis.__lawbarCaseBoxLinkSeed;
      if (typeof fn !== "function") throw new Error("seed hook missing");
      return fn(input);
    }, { matterId, documentId });
    assert.ok(seeded.anchorId, `seed did not return an anchorId: ${JSON.stringify(seeded)}`);
    assert.ok(seeded.evidenceId, "seed did not return an evidenceId");

    // 4) Create the link against the seeded anchor + evidence (real IPC).
    const created = await win.evaluate((args) =>
      window.lawbar.caseBox.createLink({
        matterId: args.matterId, sourceType: "evidence", sourceId: args.evidenceId, anchorId: args.anchorId,
      }),
    { matterId, evidenceId: seeded.evidenceId, anchorId: seeded.anchorId });
    assert.equal(created.ok, true, `createLink failed: ${JSON.stringify(created)}`);
    const linkId = created.value.id;
    assert.ok(linkId, "createLink did not return a link id");
    for (const f of ["tenant_id", "actor_user_id", "payload_json"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(created.value, f), false, `authority field ${f} leaked`);
    }

    // 5) List/resolve — resolver runs; status must be valid.
    const listed = await win.evaluate((id) => window.lawbar.caseBox.listLinks({ matterId: id }), matterId);
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const row = listed.value.find((r) => r.id === linkId);
    assert.ok(row, `listLinks did not contain the created link ${linkId}`);
    assert.equal(row.status, "valid", `resolver status not valid: ${row.status}`);
    assert.equal(row.anchor_id, seeded.anchorId);

    // 6) Export — clean citation: exportFlag null, byFlag.CLEAN === 1, synthesized 卷X页Y.
    const exported = await win.evaluate((id) => window.lawbar.caseBox.exportLinkCitations({ matterId: id }), matterId);
    assert.equal(exported.ok, true, JSON.stringify(exported));
    assert.equal(exported.value.byFlag.CLEAN, 1, `byFlag.CLEAN !== 1: ${JSON.stringify(exported.value.byFlag)}`);
    const citation = exported.value.citations.find((c) => c.linkId === linkId);
    assert.ok(citation, "export did not include the link citation");
    assert.equal(citation.exportFlag, null, `exportFlag not null: ${citation.exportFlag}`);
    assert.ok(citation.citation, "clean citation identity missing");
    assert.equal(citation.citation.citationVolume, seeded.citationVolume);
    assert.equal(citation.citation.citationPageLabel, seeded.citationPageLabel);
    assert.equal(citation.citation.text, `卷${seeded.citationVolume}页${seeded.citationPageLabel}`, `synthesized text mismatch: ${citation.citation.text}`);

    // 6b) A10 live-pipeline wiring (WI-EVIDENCE-A10-LIVE-PIPELINE-WIRING-00): the live handler attaches the
    // deterministic A10 CanonicalExportModel (text-or-flag rows, internalHref excluded) + its sha256, while
    // preserving the pre-existing citations/byFlag fields.
    const canon = exported.value.canonicalExport;
    assert.ok(canon, "live export did not attach canonicalExport");
    assert.match(canon.canonicalModelSha256, /^[0-9a-f]{64}$/, "canonicalModelSha256 not 64-hex");
    const canonRow = canon.canonicalModel.rows.find((r) => r.linkId === linkId);
    assert.deepEqual(canonRow, { linkId, citationText: `卷${seeded.citationVolume}页${seeded.citationPageLabel}` },
      `canonical row mismatch: ${JSON.stringify(canonRow)}`);
    assert.equal("internalHref" in canonRow, false, "internalHref must not be in the court-facing model");
    const canonSer = JSON.stringify(canon.canonicalModel);
    assert.ok(!/lawbar:|internalHref|"href"/i.test(canonSer), "no href/nav metadata in the canonical model");

    // 7) Lifecycle: unlink (required reason) then relink → unlinked_at cleared.
    const unlinked = await win.evaluate((args) =>
      window.lawbar.caseBox.unlinkLink({ matterId: args.matterId, linkId: args.linkId, unlinkReason: "synthetic test unlink" }),
    { matterId, linkId });
    assert.equal(unlinked.ok, true, JSON.stringify(unlinked));
    const relinked = await win.evaluate((args) =>
      window.lawbar.caseBox.relinkLink({ matterId: args.matterId, linkId: args.linkId }),
    { matterId, linkId });
    assert.equal(relinked.ok, true, JSON.stringify(relinked));
    const afterRelink = await win.evaluate((id) => window.lawbar.caseBox.listLinks({ matterId: id }), matterId);
    assert.equal(afterRelink.ok, true);
    const relinkedRow = afterRelink.value.find((r) => r.id === linkId);
    assert.ok(relinkedRow && relinkedRow.unlinked_at === null, "relink did not clear unlinked_at");

    // 8) Negative scope: a link create against an unknown anchor fails safely.
    const badAnchor = await win.evaluate((id) =>
      window.lawbar.caseBox.createLink({ matterId: id, sourceType: "evidence", sourceId: "d1rt-evidence-0", anchorId: "no-such-anchor" }),
    matterId);
    assert.equal(badAnchor.ok, false, "createLink with unknown anchor should fail");
    assert.equal(badAnchor.error.code, "invalid_argument", JSON.stringify(badAnchor.error));
  } finally {
    await app.close();
  }
});

test("D1 containment: with the env var unset, the seed hook is not installed and not renderer-reachable", { timeout: 60000 }, async (t) => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "lawbar-link-rt-contain-"));
  t.after(() => { try { rmSync(tempRoot, { recursive: true, force: true }); } catch {} });

  const env = { ...process.env, LAWBAR_MODE: "dev" };
  delete env.LAWBAR_CASEBOX_LINK_SEED_TEST_HOOK;

  const app = await launchPackaged(
    { executablePath: resolveExecutable(), args: [`--user-data-dir=${tempRoot}`], env, timeout: 30000 },
    { testName: "casebox-link-roundtrip-containment" },
  );
  try {
    const win = await app.firstWindow();
    await waitFor(() => win.evaluate(() => typeof window.lawbar?.caseBox?.createLink === "function"), "link surface");

    // Main: the seed global must be absent (default-off / fail-closed).
    const hookInMain = await app.evaluate(() => typeof globalThis.__lawbarCaseBoxLinkSeed);
    assert.equal(hookInMain, "undefined", "seed hook must NOT be installed when the env var is unset");

    // Renderer: the seed must not be reachable via the preload/contextBridge surface.
    const rendererExposure = await win.evaluate(() => ({
      onLawbar: typeof window.lawbar?.caseBox?.__lawbarCaseBoxLinkSeed,
      onWindow: typeof window.__lawbarCaseBoxLinkSeed,
      hasSeedKey: Object.keys(window.lawbar?.caseBox ?? {}).some((k) => k.toLowerCase().includes("seed")),
    }));
    assert.equal(rendererExposure.onLawbar, "undefined", "seed must not be on window.lawbar.caseBox");
    assert.equal(rendererExposure.onWindow, "undefined", "seed must not be a renderer global");
    assert.equal(rendererExposure.hasSeedKey, false, "no seed-named method may be exposed to the renderer");
  } finally {
    await app.close();
  }
});
