// Main-process unit tests. Pure-Node; no Electron runtime required.
// Tests:
//   1-4. loadThemePreference / saveThemePreference
//   5. resolveSystemMode truth table (6 cases)
//   6. palette-sync (renderer/index.css ↔ src/theme/tokens.ts byte-equal)
//   7. productName: "lawbar" in package.json

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadThemePreference,
  saveThemePreference,
} from "../dist/src/persistence/themePreference.js";
import {
  decideAction,
  parseFdesetupStatus,
  probeFileVault,
  resolveMode,
} from "../dist/src/security/fileVaultProbe.js";
import { resolveSystemMode } from "../dist/src/theme/resolveSystemMode.js";
import { LIGHT_TOKENS, DARK_TOKENS } from "../dist/src/theme/tokens.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawbar-theme-pref-"));
}

test("loadThemePreference returns defaults when file missing", () => {
  const dir = mkTempDir();
  const result = loadThemePreference(dir);
  assert.deepEqual(result, { version: 1, mode: "system" });
});

test("loadThemePreference round-trips a written value", () => {
  const dir = mkTempDir();
  saveThemePreference(dir, "dark");
  const result = loadThemePreference(dir);
  assert.deepEqual(result, { version: 1, mode: "dark" });
});

test("loadThemePreference returns defaults when file malformed JSON", () => {
  const dir = mkTempDir();
  fs.writeFileSync(path.join(dir, "theme-preference.json"), "{not valid json", "utf-8");
  const result = loadThemePreference(dir);
  assert.deepEqual(result, { version: 1, mode: "system" });
});

test("loadThemePreference returns defaults when mode is not in allowed set", () => {
  const dir = mkTempDir();
  fs.writeFileSync(
    path.join(dir, "theme-preference.json"),
    JSON.stringify({ version: 1, mode: "bogus" }),
    "utf-8",
  );
  const result = loadThemePreference(dir);
  assert.deepEqual(result, { version: 1, mode: "system" });
});

test("loadThemePreference returns defaults when version is missing or wrong", () => {
  const dir = mkTempDir();
  // Missing version
  fs.writeFileSync(
    path.join(dir, "theme-preference.json"),
    JSON.stringify({ mode: "dark" }),
    "utf-8",
  );
  assert.deepEqual(loadThemePreference(dir), { version: 1, mode: "system" });
  // Wrong version (forward-incompatible)
  fs.writeFileSync(
    path.join(dir, "theme-preference.json"),
    JSON.stringify({ version: 2, mode: "dark" }),
    "utf-8",
  );
  assert.deepEqual(loadThemePreference(dir), { version: 1, mode: "system" });
  // String version (wrong type)
  fs.writeFileSync(
    path.join(dir, "theme-preference.json"),
    JSON.stringify({ version: "1", mode: "dark" }),
    "utf-8",
  );
  assert.deepEqual(loadThemePreference(dir), { version: 1, mode: "system" });
});

test("saveThemePreference rejects invalid mode", () => {
  const dir = mkTempDir();
  assert.throws(() => saveThemePreference(dir, "bogus"), /invalid theme mode/);
});

test("resolveSystemMode truth table (6 cases)", () => {
  assert.equal(resolveSystemMode("light", true), "light");
  assert.equal(resolveSystemMode("light", false), "light");
  assert.equal(resolveSystemMode("dark", true), "dark");
  assert.equal(resolveSystemMode("dark", false), "dark");
  assert.equal(resolveSystemMode("system", true), "dark");
  assert.equal(resolveSystemMode("system", false), "light");
});

test("palette-sync: renderer/index.css matches src/theme/tokens.ts byte-equal", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.css"), "utf-8");

  function parseRootBlock(blockRegex) {
    const match = css.match(blockRegex);
    if (match === null) return null;
    const out = {};
    match[1].split(";").forEach((decl) => {
      const m = decl.match(/--color-([a-z-]+)\s*:\s*(#[0-9A-Fa-f]+)/);
      if (m !== null) {
        out[m[1]] = m[2].toUpperCase();
      }
    });
    return out;
  }

  const lightCss = parseRootBlock(/:root\s*\{([^}]+)\}/);
  const darkCss = parseRootBlock(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/);
  assert.ok(lightCss !== null, "missing :root block in renderer/index.css");
  assert.ok(darkCss !== null, "missing :root[data-theme=\"dark\"] block");

  const TOKEN_MAP = {
    background: "background",
    surface: "surface",
    surfaceElevated: "surface-elevated",
    text: "text",
    mutedText: "muted-text",
    border: "border",
    accent: "accent",
    textOnAccent: "text-on-accent",
    danger: "danger",
    warning: "warning",
    success: "success",
    focusRing: "focus-ring",
  };

  for (const [tsKey, cssKey] of Object.entries(TOKEN_MAP)) {
    assert.equal(
      lightCss[cssKey],
      LIGHT_TOKENS[tsKey].toUpperCase(),
      `LIGHT palette drift: ${cssKey} CSS=${lightCss[cssKey]} TS=${LIGHT_TOKENS[tsKey]}`,
    );
    assert.equal(
      darkCss[cssKey],
      DARK_TOKENS[tsKey].toUpperCase(),
      `DARK palette drift: ${cssKey} CSS=${darkCss[cssKey]} TS=${DARK_TOKENS[tsKey]}`,
    );
  }

  // Also assert ALL 12 tokens are present in BOTH palettes.
  assert.equal(Object.keys(lightCss).length, 12, "LIGHT palette must declare all 12 tokens");
  assert.equal(Object.keys(darkCss).length, 12, "DARK palette must declare all 12 tokens");
});

test("productName is 'lawbar' in package.json (drives app.getPath('userData'))", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  assert.equal(pkg.productName, "lawbar", "package.json productName must be 'lawbar'");
  assert.equal(pkg.build?.productName, "lawbar", "electron-builder productName must be 'lawbar'");
});

test("--probe-case-box flag-detect: production launch (no flag) does NOT trigger probe; only flag presence does", () => {
  // Mirror the exact check in electron/main.ts line ~21.
  // The detection is the literal Array.includes check — confirm both
  // branches of that condition.
  function isProbeFlagged(argv) {
    return argv.includes("--probe-case-box");
  }
  assert.equal(isProbeFlagged(["electron", "."]), false, "production launch must NOT trigger probe");
  assert.equal(isProbeFlagged(["electron", ".", "--probe-case-box"]), true, "flag presence must trigger probe");
  assert.equal(isProbeFlagged(["lawbar"]), false);
  assert.equal(isProbeFlagged(["lawbar", "--probe-case-box"]), true);
  assert.equal(isProbeFlagged(["lawbar", "--some-other-flag"]), false);
});

// Tier 1 FileVault enforcement tests (per dev-memo/plan-encryption-at-rest-00.md
// §6.1). Pure parse + pure decide + injected-execFile probe; no real fdesetup
// invocation, no Electron runtime required.

test("parseFdesetupStatus: 'FileVault is On.' variants → on", () => {
  assert.equal(parseFdesetupStatus("FileVault is On.\n"), "on");
  assert.equal(parseFdesetupStatus("FileVault is On"), "on");
  assert.equal(parseFdesetupStatus("  FileVault is On.  "), "on");
  assert.equal(parseFdesetupStatus("filevault is on."), "on");
});

test("parseFdesetupStatus: 'FileVault is Off.' variants → off", () => {
  assert.equal(parseFdesetupStatus("FileVault is Off.\n"), "off");
  assert.equal(parseFdesetupStatus("FileVault is Off"), "off");
  assert.equal(parseFdesetupStatus("FILEVAULT IS OFF."), "off");
});

test("parseFdesetupStatus: unrecognized stdout → unknown", () => {
  assert.equal(parseFdesetupStatus(""), "unknown");
  assert.equal(parseFdesetupStatus("garbage"), "unknown");
  assert.equal(parseFdesetupStatus("Decryption in Progress"), "unknown");
  assert.equal(parseFdesetupStatus("Encryption in Progress (45%)"), "unknown");
});

test("resolveMode: LAWBAR_MODE=dev → dev", () => {
  assert.equal(resolveMode({ LAWBAR_MODE: "dev" }), "dev");
});

test("resolveMode: anything other than 'dev' → production (fail-closed default)", () => {
  assert.equal(resolveMode({}), "production");
  assert.equal(resolveMode({ LAWBAR_MODE: "production" }), "production");
  assert.equal(resolveMode({ LAWBAR_MODE: "" }), "production");
  assert.equal(resolveMode({ LAWBAR_MODE: "DEV" }), "production", "case-sensitive");
  assert.equal(resolveMode({ LAWBAR_MODE: "test" }), "production");
  assert.equal(resolveMode({ LAWBAR_MODE: undefined }), "production");
});

test("decideAction: full matrix (state × mode → action)", () => {
  assert.equal(decideAction("on", "production"), "proceed");
  assert.equal(decideAction("on", "dev"), "proceed");
  assert.equal(decideAction("off", "production"), "block");
  assert.equal(decideAction("off", "dev"), "warn");
  assert.equal(decideAction("unknown", "production"), "block", "fail-closed: unknown == off in prod");
  assert.equal(decideAction("unknown", "dev"), "warn");
  assert.equal(decideAction("non-macos", "production"), "proceed");
  assert.equal(decideAction("non-macos", "dev"), "proceed");
});

test("probeFileVault: non-darwin platform → state=non-macos; fdesetup NOT invoked", async () => {
  let called = false;
  const fakeExec = () => {
    called = true;
  };
  for (const platform of ["linux", "win32", "freebsd", "aix"]) {
    const result = await probeFileVault({ platform, execFile: fakeExec });
    assert.equal(result.state, "non-macos", `platform=${platform}`);
  }
  assert.equal(called, false, "fdesetup must NOT be invoked on non-darwin");
});

test("probeFileVault: darwin + stdout 'FileVault is On.' → state=on; correct command + args", async () => {
  let cmdSeen = null;
  let argsSeen = null;
  let timeoutSeen = null;
  const fakeExec = (cmd, args, opts, cb) => {
    cmdSeen = cmd;
    argsSeen = [...args];
    timeoutSeen = opts.timeout;
    cb(null, "FileVault is On.\n", "");
  };
  const result = await probeFileVault({ platform: "darwin", execFile: fakeExec });
  assert.equal(result.state, "on");
  assert.equal(result.raw, "FileVault is On.\n");
  assert.equal(cmdSeen, "/usr/bin/fdesetup", "must invoke macOS fdesetup at absolute path");
  assert.deepEqual(argsSeen, ["status"]);
  assert.equal(typeof timeoutSeen, "number");
  assert.ok(timeoutSeen > 0 && timeoutSeen <= 10_000, "timeout must be positive and ≤10s");
});

test("probeFileVault: darwin + stdout 'FileVault is Off.' → state=off", async () => {
  const fakeExec = (_c, _a, _o, cb) => cb(null, "FileVault is Off.\n", "");
  const result = await probeFileVault({ platform: "darwin", execFile: fakeExec });
  assert.equal(result.state, "off");
});

test("probeFileVault: darwin + execFile error (e.g. ENOENT) → state=unknown + error captured", async () => {
  const fakeExec = (_c, _a, _o, cb) => {
    const err = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    cb(err, "", "fdesetup not found");
  };
  const result = await probeFileVault({ platform: "darwin", execFile: fakeExec });
  assert.equal(result.state, "unknown");
  assert.match(result.error ?? "", /fdesetup failed/);
  assert.match(result.error ?? "", /ENOENT/);
  assert.match(result.error ?? "", /fdesetup not found/);
});

test("probeFileVault: darwin + unrecognized stdout → state=unknown (no error)", async () => {
  const fakeExec = (_c, _a, _o, cb) => cb(null, "Decryption in Progress\n", "");
  const result = await probeFileVault({ platform: "darwin", execFile: fakeExec });
  assert.equal(result.state, "unknown");
  assert.equal(result.error, undefined, "no error on parse-unknown; only on exec failure");
});

test("probeFileVault: darwin + synchronous throw from execFile → state=unknown + error captured", async () => {
  const fakeExec = () => {
    throw new Error("spawn ENOMEM");
  };
  const result = await probeFileVault({ platform: "darwin", execFile: fakeExec });
  assert.equal(result.state, "unknown");
  assert.match(result.error ?? "", /spawn ENOMEM/);
});

test("probeFileVault: custom timeoutMs is forwarded to execFile options", async () => {
  let timeoutSeen = null;
  const fakeExec = (_c, _a, opts, cb) => {
    timeoutSeen = opts.timeout;
    cb(null, "FileVault is On.\n", "");
  };
  await probeFileVault({ platform: "darwin", execFile: fakeExec, timeoutMs: 1500 });
  assert.equal(timeoutSeen, 1500);
});
