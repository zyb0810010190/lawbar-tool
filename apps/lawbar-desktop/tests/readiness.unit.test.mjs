// Tests for the first-run readiness window's pure logic.
//
// The window exists because the FileVault gate was a correct refusal and a dead end: it showed an
// error box and quit, leaving the owner with a message and nothing to act on. These assert the two
// properties that make the replacement safe rather than merely friendlier — that it does NOT decide
// anything the gate decides, and that a pre-gate window cannot be turned into a general opener.

import test from "node:test";
import assert from "node:assert/strict";

import {
  readinessState,
  isAllowedSettingsUrl,
  FILEVAULT_SETTINGS_URL,
  READINESS_CHANNEL,
} from "../dist/src/security/readinessState.js";
import { decideAction } from "../dist/src/security/fileVaultProbe.js";

// ---------------------------------------------------------------- the gate is not reimplemented

// The whole risk of this feature is a second implementation of "is FileVault acceptable" drifting
// away from the first. `blocked` must be derived from decideAction, never recomputed — asserted
// across the full matrix rather than on a sample.
test("blocked always equals decideAction's verdict, across every state and mode", () => {
  for (const state of ["on", "off", "unknown", "non-macos"]) {
    for (const mode of ["production", "dev"]) {
      assert.equal(
        readinessState(state, mode).blocked,
        decideAction(state, mode) === "block",
        `readiness disagreed with the gate for state=${state} mode=${mode}`,
      );
    }
  }
});

test("production blocks on off and on unknown", () => {
  assert.equal(readinessState("off", "production").blocked, true);
  assert.equal(readinessState("unknown", "production").blocked, true);
});

// If this ever returns blocked:false for a production `off`, the gate is open.
test("FileVault on is never blocked; dev never blocks", () => {
  assert.equal(readinessState("on", "production").blocked, false);
  assert.equal(readinessState("off", "dev").blocked, false);
  assert.equal(readinessState("unknown", "dev").blocked, false);
});

test("the state is reported verbatim alongside the copy", () => {
  const s = readinessState("off", "production");
  assert.equal(s.fileVaultState, "off");
  assert.ok(s.title.length > 0 && s.detail.length > 0);
  assert.ok(s.detail.includes("检测到的状态：off"));
});

// `unknown` is a weaker claim than `off` and the window must not overstate it.
test("an indeterminate probe is titled differently from a known-off one", () => {
  assert.notEqual(readinessState("unknown", "production").title, readinessState("off", "production").title);
});

test("a probe error reaches the window when present", () => {
  assert.ok(readinessState("unknown", "production", "fdesetup failed: ENOENT").detail.includes("ENOENT"));
});

// ---------------------------------------------------------------- the opener is not general

// This window runs BEFORE the storage precondition is met. An unrestricted external opener reachable
// from it would be a hole, so exactly one URL is permitted.
test("only the FileVault settings pane may be opened", () => {
  assert.equal(isAllowedSettingsUrl(FILEVAULT_SETTINGS_URL), true);
  for (const bad of [
    "https://example.invalid",
    "file:///etc/passwd",
    "x-apple.systempreferences:com.apple.settings.Network",
    FILEVAULT_SETTINGS_URL + "&extra=1",
    "",
  ]) {
    assert.equal(isAllowedSettingsUrl(bad), false, `${bad} must not be openable from a pre-gate window`);
  }
});

test("the settings URL targets the FileVault pane specifically", () => {
  assert.match(FILEVAULT_SETTINGS_URL, /^x-apple\.systempreferences:/);
  assert.match(FILEVAULT_SETTINGS_URL, /FileVault/);
});

// ---------------------------------------------------------------- channels

// The readiness channels are separate from the case-box surface on purpose: none of the product
// IPC may be reachable from a window shown before the gate clears.
test("the readiness channels are namespaced and carry no case-box surface", () => {
  const names = Object.values(READINESS_CHANNEL);
  assert.equal(names.length, 4);
  for (const n of names) {
    assert.match(n, /^readiness:/);
    assert.equal(n.startsWith("casebox:"), false);
  }
  assert.equal(new Set(names).size, names.length, "channel names must be distinct");
});
