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

test("palette-sync: renderer/index.css token blocks byte-equal src/theme/tokens.ts (S2.5 editorial token system)", async () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.css"), "utf-8");
  const {
    LIGHT_THEME_TOKENS,
    DARK_THEME_TOKENS,
    SCALE_TOKENS,
  } = await import("../dist/src/theme/tokens.js");

  // Parse a brace-delimited block into a name→value map. Captures ALL custom
  // properties (colors, conf-*, status-*, shadow-*, traffic-*, scales),
  // value verbatim (hex / var() / transparent / numeric / string).
  function parseBlock(blockRegex) {
    const match = css.match(blockRegex);
    if (match === null) return null;
    const out = {};
    match[1].split(";").forEach((decl) => {
      const m = decl.match(/(--[a-z0-9-]+)\s*:\s*(.+)/s);
      if (m !== null) out[m[1].trim()] = m[2].trim();
    });
    return out;
  }

  const lightCss = parseBlock(/:root\s*\{([^}]+)\}/);
  const darkCss = parseBlock(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/);
  const htmlCss = parseBlock(/html\s*\{([^}]+)\}/);
  assert.ok(lightCss !== null, "missing light :root block");
  assert.ok(darkCss !== null, "missing :root[data-theme=\"dark\"] block");
  assert.ok(htmlCss !== null, "missing html token block");

  // 1) Light/dark theme blocks declare EXACTLY the LIGHT/DARK_THEME_TOKENS key
  //    sets, byte-equal values.
  assert.deepEqual(
    Object.keys(lightCss).sort(),
    Object.keys(LIGHT_THEME_TOKENS).sort(),
    "light :root token NAME set must equal LIGHT_THEME_TOKENS",
  );
  assert.deepEqual(
    Object.keys(darkCss).sort(),
    Object.keys(DARK_THEME_TOKENS).sort(),
    "dark :root token NAME set must equal DARK_THEME_TOKENS",
  );
  for (const [k, v] of Object.entries(LIGHT_THEME_TOKENS)) {
    assert.equal(lightCss[k], v, `LIGHT theme drift: ${k} CSS=${lightCss[k]} TS=${v}`);
  }
  for (const [k, v] of Object.entries(DARK_THEME_TOKENS)) {
    assert.equal(darkCss[k], v, `DARK theme drift: ${k} CSS=${darkCss[k]} TS=${v}`);
  }

  // 2) Light + dark declare the SAME theme-token name set (parity).
  assert.deepEqual(
    Object.keys(LIGHT_THEME_TOKENS).sort(),
    Object.keys(DARK_THEME_TOKENS).sort(),
    "LIGHT/DARK theme token key sets must match (theme parity)",
  );

  // 3) Invariant scale tokens: every SCALE_TOKENS entry present in the html
  //    block, byte-equal. (The html block also carries the 3 S1 font vars,
  //    which are NOT scale tokens and intentionally excluded from SCALE_TOKENS.)
  for (const [k, v] of Object.entries(SCALE_TOKENS)) {
    assert.equal(htmlCss[k], v, `SCALE drift: ${k} CSS=${htmlCss[k]} TS=${v}`);
  }
  for (const f of ["--font-ui", "--font-serif", "--font-mono"]) {
    assert.ok(htmlCss[f] !== undefined, `S1 font var ${f} must remain in html block`);
  }
  const htmlExtras = Object.keys(htmlCss).filter(
    (k) => SCALE_TOKENS[k] === undefined && !["--font-ui", "--font-serif", "--font-mono"].includes(k),
  );
  assert.deepEqual(htmlExtras, [], `unexpected non-scale custom props in html block: ${htmlExtras}`);

  // 4) Compat: the 12-camel LIGHT_TOKENS/DARK_TOKENS (consumed by
  //    electron/main.ts) stay byte-equal to their kebab counterparts.
  const CAMEL_TO_KEBAB = {
    background: "--color-background",
    surface: "--color-surface",
    surfaceElevated: "--color-surface-elevated",
    text: "--color-text",
    mutedText: "--color-muted-text",
    border: "--color-border",
    accent: "--color-accent",
    textOnAccent: "--color-text-on-accent",
    danger: "--color-danger",
    warning: "--color-warning",
    success: "--color-success",
    focusRing: "--color-focus-ring",
  };
  for (const [camel, kebab] of Object.entries(CAMEL_TO_KEBAB)) {
    // focus-ring is a var() ref in the theme set; the 12-camel keeps a hex
    // literal for main.ts (resolves to accent). Compare only the hex tokens.
    if (kebab === "--color-focus-ring") continue;
    assert.equal(
      LIGHT_THEME_TOKENS[kebab],
      LIGHT_TOKENS[camel],
      `LIGHT compat drift: ${camel}/${kebab}`,
    );
    assert.equal(
      DARK_THEME_TOKENS[kebab],
      DARK_TOKENS[camel],
      `DARK compat drift: ${camel}/${kebab}`,
    );
  }
});

test("productName is 'lawbar' in package.json (drives app.getPath('userData'))", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  assert.equal(pkg.productName, "lawbar", "package.json productName must be 'lawbar'");
  assert.equal(pkg.build?.productName, "lawbar", "electron-builder productName must be 'lawbar'");
});

// WI-retire-probe-case-box (post-017c560 detection-impl): the
// `--probe-case-box` flag handler in electron/main.ts and the
// src/probes/caseBoxProbe.ts source are RETIRED per parent plan rev-3.1
// §26 step 4 + §12 Option A. The prior flag-detect test (which mirrored
// the Array.includes check that has been removed) is also retired.
// Replacement coverage for the better-sqlite3 native-module loadability
// inside packaged Electron is DEFERRED to WI-3 (the pkg-verify-playwright-
// evaluate-poc; gated on the ESM evidence-2 plan amendment per parent
// §26 step 3). The retirement commit message records this intentional
// coverage delta.

test("retire: --probe-case-box flag handler removed from electron/main.ts", () => {
  const mainTs = fs.readFileSync(path.join(__dirname, "..", "electron", "main.ts"), "utf-8");
  assert.doesNotMatch(
    mainTs,
    /--probe-case-box/,
    "electron/main.ts must NOT reference --probe-case-box after WI-retire-probe-case-box",
  );
  assert.doesNotMatch(
    mainTs,
    /runCaseBoxProbe|caseBoxProbe/,
    "electron/main.ts must NOT import or reference runCaseBoxProbe",
  );
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

// AT1-L1 (WI-401): the parse must be END-ANCHORED so an unexpected trailing suffix or extra line is
// NOT prefix-matched to on/off (a fail-OPEN for a FileVault-enforcement probe) but classified unknown
// (fail-closed: decideAction(unknown, production) === "block").
test("parseFdesetupStatus: unexpected trailing suffix → unknown (fail-closed, AT1-L1)", () => {
  assert.equal(parseFdesetupStatus("FileVault is On: unexpected suffix"), "unknown");
  assert.equal(parseFdesetupStatus("FileVault is Off: weird"), "unknown");
  assert.equal(parseFdesetupStatus("FileVault is On then more text"), "unknown");
  // multi-line valid-first-line + garbage second line: $ without the m flag means whole-string match.
  assert.equal(parseFdesetupStatus("FileVault is On.\nDecryption queued"), "unknown");
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

// WI-07 wiring guard. Lives here, with the other built-artifact assertions, because it must
// NOT import the module it is guarding (acquireOrExit): a static import of a not-yet-existing
// module kills
// the whole file against a pre-change baseline, and this case has to survive to assert.
// Limit, stated plainly: it proves the call site exists in the built main, not that every
// path reaches it.
test("WI07-8 main routes a failed runtime open through acquireOrExit", () => {
  const main = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "electron", "main.js"),
    "utf8",
  );
  assert.match(main, /acquireOrExit/, "main.js must route startup failures through acquireOrExit");
  assert.match(main, /getCaseBoxRuntime/, "sanity: main.js still acquires the runtime");
});

// WI07-12. F1 from the independent audit, converted from a worry into a checked invariant.
// `app.quit()` is graceful and CANCELLABLE: a `before-quit` listener calling preventDefault
// would leave the process alive with no window after a startup refusal — the very state
// WI-07 removed. Verified today that no such preventer exists, so app.quit() is correct and
// stays consistent with the FileVault gate 15 lines above it. This guard fails the day
// someone adds one, forcing the startup-abort path to be reconsidered rather than silently
// broken. (Switching this one path to app.exit() was the audit's suggestion; it was declined
// because two startup gates in one file behaving differently is its own defect.)
test("WI07-12 nothing cancels app.quit(), so the startup-refusal path really terminates", () => {
  const main = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "electron", "main.js"),
    "utf8",
  );
  const quitHandler = /app\.on\(\s*["'](?:before-quit|will-quit)["'][\s\S]{0,400}?\}\s*\)/g;
  for (const m of main.match(quitHandler) ?? []) {
    assert.ok(!/preventDefault/.test(m),
      "a quit handler calls preventDefault — the startup-refusal path can no longer guarantee " +
      "the app exits, so it must switch to app.exit() or the dialog's promise is false");
  }
});
