// Settings screen tests (WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00). Pure-Node; the
// mock document + helpers come from the shared view-matter DOM harness. The
// read-only appInfo bridge is injected via deps.getAppInfo so no preload/IPC is
// needed here (that boundary is covered separately by the IPC/preload tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSettings } from "../dist/renderer/screens/settings.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import { MockDoc, findByTestId, collectText } from "./_view-matter-dom.mjs";

const SAMPLE_INFO = {
  version: "0.1.0",
  mode: "dev",
  dataDir: "/Users/tester/Library/Application Support/lawbar",
  fileVaultState: "on",
  offline: true,
  telemetry: false,
};

function mount(infoOrThrow) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const getAppInfo =
    typeof infoOrThrow === "function"
      ? infoOrThrow
      : async () => infoOrThrow;
  return { doc, root, promise: mountSettings(root, { navigate: () => {}, doc, getAppInfo }) };
}

test("mount: renders the 设置 title", async () => {
  const { root, promise } = mount(SAMPLE_INFO);
  await promise;
  assert.equal(collectText(findByTestId(root, "settings-title")), CATALOG["settings.title"]);
});

test("populates version + launch mode from the injected appInfo bridge", async () => {
  const { root, promise } = mount(SAMPLE_INFO);
  await promise;
  const body = collectText(findByTestId(root, "settings-body"));
  assert.ok(body.includes(CATALOG["settings.field.version"]), "missing settings.field.version");
  assert.match(body, /0\.1\.0/);
  assert.ok(body.includes(CATALOG["settings.mode.dev"]), "missing settings.mode.dev");
});

test("renders data location + local-first/offline/privacy copy in Chinese", async () => {
  const { root, promise } = mount(SAMPLE_INFO);
  await promise;
  const body = collectText(findByTestId(root, "settings-body"));
  assert.match(body, /Library\/Application Support\/lawbar/);
  assert.ok(body.includes(CATALOG["settings.value.localFirst"]), "missing settings.value.localFirst");
  assert.ok(body.includes(CATALOG["settings.value.offline"]), "missing settings.value.offline");
  assert.ok(body.includes(CATALOG["settings.value.privacy"]), "missing settings.value.privacy");
});

test("FileVault state maps to its zh-CN label + shows the production note", async () => {
  const { root, promise } = mount({ ...SAMPLE_INFO, fileVaultState: "off" });
  await promise;
  const body = collectText(findByTestId(root, "settings-body"));
  assert.ok(body.includes(CATALOG["settings.fileVault.off"]), "missing settings.fileVault.off");
  assert.equal(
    collectText(findByTestId(root, "settings-filevault-note")),
    CATALOG["settings.fileVault.note"],
  );
});

test("bridge unavailable: keeps the title, does not throw, surfaces no raw error", async () => {
  const { root, promise } = mount(async () => {
    throw new Error("appInfo bridge unavailable");
  });
  await promise; // must resolve, not reject
  assert.equal(collectText(findByTestId(root, "settings-title")), CATALOG["settings.title"]);
  // No app sections were populated.
  assert.equal(findByTestId(root, "settings-section-app"), null);
});
