// Tests for the two halves of the synthetic-evaluation path: the non-dismissable dev-mode banner,
// and the sealed launcher that gives an evaluation run its own profile.
//
// Both exist for one reason. `LAWBAR_MODE=dev` disables the Tier 1 FileVault gate — the only
// precondition protecting privileged client material at rest. Dev mode is legitimate with SYNTHETIC
// data and unacceptable with real data, and nothing in the product previously made the difference
// visible or structural. These assert the parts that make it so.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { MockDoc, findAll, findByTestId } from "./_view-matter-dom.mjs";
import { mountDevModeBanner, devModeBannerHost } from "../dist/renderer/devModeBanner.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import {
  assertNotRealProfile,
  evaluationProfileDir,
  realProfileDir,
  findPackagedBinary,
  parseArgs,
  profileEntryCount,
} from "../scripts/evaluate.mjs";

const EVAL_DIR = "/Users/someone/Library/Application Support/lawbar-evaluation";

function appInfo(over = {}) {
  return {
    version: "0.1.0",
    mode: "dev",
    dataDir: EVAL_DIR,
    fileVaultState: "off",
    offline: true,
    telemetry: false,
    ...over,
  };
}

function mountInto(info) {
  const doc = new MockDoc();
  const host = doc.createElement("div");
  return mountDevModeBanner(host, { doc, getAppInfo: async () => info }).then(() => host);
}

const bannerIn = (host) => findByTestId(host, "dev-mode-banner");

// --------------------------------------------------------------------------- the banner

test("production renders NO banner — the unmarked state is the safe one", async () => {
  const host = await mountInto(appInfo({ mode: "production" }));
  assert.equal(bannerIn(host), null);
});

test("dev mode renders the banner, as an alert", async () => {
  const host = await mountInto(appInfo());
  const b = bannerIn(host);
  assert.ok(b, "dev mode must be visibly marked");
  assert.equal(b.getAttribute("role"), "alert", "a weakened confidentiality control is not incidental info");
});

test("the banner names the mode and says not to enter real client material", async () => {
  const b = bannerIn(await mountInto(appInfo()));
  assert.ok(b.textContent.includes(CATALOG["devMode.banner.title"]));
  assert.ok(
    b.textContent.includes("请勿在此模式下录入真实当事人材料"),
    "the banner must state the one rule that makes dev mode acceptable",
  );
});

// Two windows open at once is exactly when this matters.
test("the banner shows WHICH profile is open", async () => {
  const host = await mountInto(appInfo());
  const p = findByTestId(host, "dev-mode-banner-path");
  assert.ok(p, "the data directory must be visible without opening Settings");
  assert.ok(p.textContent.includes(EVAL_DIR));
});

// A banner you can close is a banner that gets closed once and never seen again.
test("the banner is NOT dismissable", async () => {
  const b = bannerIn(await mountInto(appInfo()));
  assert.equal(
    findAll(b, (n) => n.tagName === "BUTTON").length, 0,
    "no close control — the warning must persist for the whole session",
  );
});

// A broken warning must not take the application down. The absence of a banner is never read as
// an assurance, because production is the default and the unmarked state.
test("an unavailable app-info bridge fails silently rather than blocking the UI", async () => {
  const doc = new MockDoc();
  const host = doc.createElement("div");
  await assert.doesNotReject(() =>
    mountDevModeBanner(host, { doc, getAppInfo: async () => { throw new Error("no bridge"); } }));
  assert.equal(bannerIn(host), null);
});

// The router replaces `#app` on every route change; a warning that vanishes on navigation is not
// a warning. The host must therefore be the outer shell element.
test("the host is the app window, NOT the router-managed #app element", () => {
  const seen = [];
  const stubDoc = { querySelector: (sel) => { seen.push(sel); return { sel }; } };
  const host = devModeBannerHost(stubDoc);
  assert.deepEqual(seen, [".app-window"]);
  assert.notEqual(seen[0], "#app", "mounting inside #app would lose the banner on navigation");
  assert.ok(host);
});

test("a missing shell host is a no-op, not a crash", () => {
  assert.equal(devModeBannerHost({ querySelector: () => null }), null);
});

// --------------------------------------------------------------------------- the sealed launcher

test("the evaluation profile is a DIFFERENT directory from the real case store", () => {
  assert.notEqual(evaluationProfileDir(), realProfileDir());
  assert.ok(
    !evaluationProfileDir().startsWith(realProfileDir() + path.sep),
    "it must not be nested inside the real store either",
  );
});

test("it REFUSES when the evaluation profile is the real case store", () => {
  assert.throws(() => assertNotRealProfile(realProfileDir(), realProfileDir()), /REFUSING/);
});

// A plain string comparison would pass here. Symlinks are why the check resolves first — the same
// reason the Electron profile guards resolve before comparing.
test("the refusal survives a symlink pointing at the real store", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eval-seal-"));
  const real = path.join(dir, "lawbar");
  const link = path.join(dir, "lawbar-evaluation");
  mkdirSync(real);
  symlinkSync(real, link);
  assert.throws(() => assertNotRealProfile(link, real), /REFUSING/,
    "a symlinked evaluation profile reached the real case store");
  rmSync(dir, { recursive: true, force: true });
});

test("distinct directories are accepted", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eval-seal-"));
  const real = path.join(dir, "lawbar");
  const evald = path.join(dir, "lawbar-evaluation");
  mkdirSync(real); mkdirSync(evald);
  assert.doesNotThrow(() => assertNotRealProfile(evald, real));
  rmSync(dir, { recursive: true, force: true });
});

test("parseArgs accepts --reset and refuses anything else", () => {
  assert.deepEqual(parseArgs([]), { reset: false });
  assert.deepEqual(parseArgs(["--reset"]), { reset: true });
  assert.throws(() => parseArgs(["--user-data-dir=/somewhere"]), /unknown argument/,
    "the profile must not be overridable from the command line — that would break the seal");
});

test("findPackagedBinary returns null when nothing is built, rather than guessing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eval-bin-"));
  assert.equal(findPackagedBinary(dir), null);
  rmSync(dir, { recursive: true, force: true });
});

test("profileEntryCount reports 0 for an absent profile", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eval-cnt-"));
  assert.equal(profileEntryCount(path.join(dir, "nope")), 0);
  mkdirSync(path.join(dir, "some"));
  assert.equal(profileEntryCount(dir), 1);
  rmSync(dir, { recursive: true, force: true });
});

// The launcher must never be able to target the live store, whatever the environment says.
test("the real profile path is the one the launcher refuses, not one it can be pointed at", () => {
  assert.ok(realProfileDir().endsWith(path.join("Application Support", "lawbar")));
  assert.ok(evaluationProfileDir().endsWith("lawbar-evaluation"));
  assert.equal(existsSync(realProfileDir()) && realProfileDir() === evaluationProfileDir(), false);
});
