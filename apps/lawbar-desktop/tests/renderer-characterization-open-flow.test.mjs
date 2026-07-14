// WI-PTA-02 — Characterization: existing matter open flow in the renderer (regression guard).
//
// Pins that the current matter view mounts and renders from the EXISTING api
// surface alone, with no pre-trial preparation data or preparation IPC methods.
// Must stay green after WI-PRETRIAL-TRIAL-ADDON-01 lands: opening a matter must
// never START requiring ClaimTrack / EvidencePreparation / opinion-card data to
// render. Pure-Node; mock document + mock api injected (existing harness).

import { test } from "node:test";
import assert from "node:assert/strict";

import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import {
  VALID_ULID,
  MockDoc,
  findByTestId,
  collectText,
  flush,
  syntheticMatter,
  makeStubApi,
} from "./_view-matter-dom.mjs";

test("characterization: matter view renders from the existing api with no preparation data", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  // The stub api exposes ONLY the existing surface (matter + empty
  // documents/audit); it has no preparation methods.
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: syntheticMatter() }),
  });

  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  await flush();

  // Matter opens (happy path): title + detail fields render, no error surface.
  assert.equal(findByTestId(root, "view-invalid-id"), null);
  assert.equal(findByTestId(root, "view-envelope-error"), null);
  assert.equal(findByTestId(root, "view-not-found"), null);
  const title = findByTestId(root, "view-title");
  assert.ok(title !== null, "matter title rendered");
  assert.equal(collectText(title), "matter-fixture-A");
  assert.ok(findByTestId(root, "view-fields") !== null, "detail fields rendered");
});
