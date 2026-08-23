// _release-script-harness.mjs — hermetic runner for the two macOS release shell
// scripts (WI-1 / WI-2 of plan-20260813-013156). `_`-prefixed on purpose: it is a
// helper, NOT a test file, and is deliberately absent from `scripts.test`.
//
// THREE PROPERTIES THIS FILE EXISTS TO GUARANTEE
//
// 1. ISOLATED PATH (base-matrix correction C-1). The child's PATH contains ONLY the
//    generated stub dir — never `/usr/bin`. A merely-*prepended* PATH leaves
//    `verify-macos-signing.sh`'s "xcrun stapler unavailable" branch dead on any host
//    carrying /usr/bin/stapler (this one does), because `xcrun -f stapler` would keep
//    resolving. Under isolation, "no stub" means "not found" deterministically.
//    `bash`, `grep` and `sed` are supplied as logging pass-through stubs that `exec`
//    the real absolute binaries, so the scripts' genuine dependencies still work.
//
// 2. NO PARENT ENV INHERITANCE. The child env is built FROM SCRATCH. It is never
//    `{ ...process.env, ...env }` — that idiom (used by tests/backup-local-data.test.mjs,
//    where it is harmless) is a defect here: `release-preflight.sh` reads exactly the
//    variables a maintainer's release shell exports (APPLE_TEAM_ID, CSC_LINK, …), so
//    inheritance would make every result machine-dependent and would drag real
//    credentials into test assertions.
//
// 3. ABSOLUTE INTERPRETER. Children are spawned as `spawnSync("/bin/bash", [script, …])`
//    so launching never depends on the child's PATH.
//
// TWO-SIDED VERIFICATION. Set LAWBAR_SCRIPT_DIR to a directory holding pre-fix copies
// of the two scripts and the whole suite runs against them. Every case the addendum
// marks FLIPS / regression must FAIL there and PASS against the real scripts.
//   LAWBAR_SCRIPT_DIR=/path/to/prefix-scripts node --test tests/release-preflight.test.mjs
// LAWBAR_SCRIPT_DIR is read in the PARENT only; it never reaches a child.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, realpathSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** apps/lawbar-desktop — the package root. */
export const PKG_DIR = path.resolve(__dirname, "..");

/** Script directory under test. Overridable for two-sided (pre-fix vs post-fix) runs. */
export const SCRIPT_DIR = process.env.LAWBAR_SCRIPT_DIR
  ? path.resolve(process.env.LAWBAR_SCRIPT_DIR)
  : path.join(PKG_DIR, "scripts");

export const PREFLIGHT = path.join(SCRIPT_DIR, "release-preflight.sh");
export const VERIFY = path.join(SCRIPT_DIR, "verify-macos-signing.sh");

/** True when the suite is pointed at the preserved pre-fix copies. */
export const IS_PREFIX_RUN = SCRIPT_DIR !== path.join(PKG_DIR, "scripts");

/** The cwd-relative default bundle path baked into verify-macos-signing.sh. */
export const REAL_BUNDLE_REL = "release/mac-arm64/lawbar.app";

/** The five system binaries the two scripts may invoke. All are stubbed. */
export const STUBBED_BINARIES = ["security", "codesign", "spctl", "xcrun", "stapler"];

/**
 * Pass-through stubs. These are NOT mocks — they log the call and then `exec` the real
 * absolute binary. They exist only because the isolated PATH would otherwise hide the
 * scripts' legitimate dependencies (`grep`, `sed`) and the `dist:release` recipe's own
 * `bash`.
 */
export const PASSTHROUGH_BINARIES = {
  bash: "/bin/bash",
  grep: "/usr/bin/grep",
  sed: "/usr/bin/sed",
};

const PASSTHROUGH_NAMES = new Set(Object.keys(PASSTHROUGH_BINARIES));

// ---------------------------------------------------------------------------
// §2 sentinel register (base matrix). Letter-suffixed on purpose: no digit run
// anywhere and no `@`, so none can match check-no-real-data.mjs's phone-us,
// phone-cn, ssn-us, id-cn or email patterns. APPLE_ID is deliberately NOT
// email-shaped — the scripts only test presence, and an email-shaped value WOULD
// be flagged by the scanner. That choice is load-bearing, not cautious.
// ---------------------------------------------------------------------------
export const SENTINEL = {
  APPLE_TEAM_ID: "SENTINEL-TEAMID-A",
  APPLE_ID: "SENTINEL-APPLEID-B",
  APPLE_APP_SPECIFIC_PASSWORD: "SENTINEL-APPPWD-C",
  APPLE_API_KEY: "SENTINEL-APIKEY-D",
  APPLE_API_KEY_ID: "SENTINEL-APIKEYID-E",
  APPLE_API_ISSUER: "SENTINEL-ISSUER-F",
  CSC_LINK: "SENTINEL-CSCLINK-G",
  CSC_KEY_PASSWORD: "SENTINEL-CSCPWD-H",
};

/** Appears ONLY in simulated keychain output, so a leak is attributable. */
export const KEYCHAIN_ONLY = "SENTINEL-KEYCHAIN-ONLY-Z";

// `security find-identity -v -p codesigning` stdout fixtures.
//
// The hash column is all-hex-letters (A–F) with NO digits: the post-fix row regex
// requires `[0-9A-Fa-f]+` there, and a digit run would risk the scanner's numeric
// patterns. The base matrix's illustrative `FAKEHASHAAAA` is not hex and could never
// match the anchored regex — corrected here against the real script text.
export const IDENTITY_PRESENT =
  `  1) AAAABBBBCCCCDDDD "Developer ID Application: SENTINEL-ORG (${KEYCHAIN_ONLY})"\n` +
  `     1 valid identities found\n`;

export const NO_IDENTITY = `     0 valid identities found\n`;

/** Expired cert: the row carries a trailing parenthetical AFTER the closing quote. */
export const EXPIRED_UNANCHORED =
  `  1) DDDDEEEEFFFFAAAA "Developer ID Application: SENTINEL-ORG (${KEYCHAIN_ONLY})" (CSSMERR_TP_CERT_EXPIRED)\n` +
  `     0 valid identities found\n`;

/** Only an Apple Development identity — cannot sign a release. */
export const APPLE_DEVELOPMENT_ONLY =
  `  1) AAAABBBBCCCCDDDD "Apple Development: SENTINEL-ORG (${KEYCHAIN_ONLY})"\n` +
  `     1 valid identities found\n`;

/** The phrase appears only in prose, never as a numbered row. */
export const PHRASE_IN_TRAILER_ONLY =
  `     0 valid identities found\n` +
  `     (no Developer ID Application certificate is installed)\n`;

// ---------------------------------------------------------------------------
// Temp-dir bookkeeping
// ---------------------------------------------------------------------------
const TMP_ROOT = realpathSync(os.tmpdir());
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");
const CREATED = new Set();

/** Create a tracked temp dir under the OS tmpdir. Never inside the repo tree. */
export function makeTempRoot(prefix = "lawbar-relscript-") {
  const dir = realpathSync(mkdtempSync(path.join(TMP_ROOT, prefix)));
  CREATED.add(dir);
  return dir;
}

/** Remove every temp dir this module created. */
export function cleanupAll() {
  for (const dir of CREATED) rmSync(dir, { recursive: true, force: true });
  CREATED.clear();
}

/** Every tracked path, for T1.6's containment assertions. */
export function createdRoots() {
  return [...CREATED];
}

export function isUnderTmp(p) {
  return path.resolve(p).startsWith(TMP_ROOT + path.sep);
}

export function isUnderRepo(p) {
  return path.resolve(p).startsWith(REPO_ROOT + path.sep);
}

// ---------------------------------------------------------------------------
// Stub generation
// ---------------------------------------------------------------------------

/** Single-quote a string for bash. */
function sq(s) {
  return `'${String(s).split("'").join(`'\\''`)}'`;
}

// One log record per invocation, written under a MUTEX.
//
// This used to rely on a single `printf` being a single write(2) to an O_APPEND fd, and
// asserted in a comment that concurrent stubs in a pipeline "cannot interleave mid-record".
// That is false once a record exceeds the stdio buffer, and CI proved it: the anchored
// Developer-ID regex added to the preflight made the `grep` record long enough to split, and
// on a clean macOS runner the `security` and `grep` records of `security … | grep -Eq …`
// interleaved into one corrupt record. It had passed on every local run.
//
// The two sides of that pipeline are genuinely concurrent, so the fix is an actual lock
// rather than a bigger buffer. `mkdir` is atomic on every POSIX filesystem, needs no tools
// beyond the shell, and works on bash 3.2. The spin is bounded so a stub that dies holding
// the lock degrades to a possibly-interleaved record instead of hanging the suite.
//
// Format: name line, one line per argv element, blank-line terminator. One argv element per
// line means arguments containing SPACES round-trip exactly (T7.8). Known limit: an argv
// element that is itself the empty string would read as a terminator. No case here passes one.
function logPrelude(name) {
  return [
    `__rec=${sq(name)}`,
    `for __a in "$@"; do __rec="$__rec`,
    `$__a"; done`,
    `__log="\${LAWBAR_STUB_LOG:-/dev/null}"`,
    `if [ "$__log" != "/dev/null" ]; then`,
    `  __i=0`,
    `  while ! mkdir "$__log.lock" 2>/dev/null; do`,
    `    __i=$((__i + 1)); [ "$__i" -gt 5000 ] && break`,
    `  done`,
    `  printf '%s\\n\\n' "$__rec" >> "$__log"`,
    `  rmdir "$__log.lock" 2>/dev/null`,
    `else`,
    `  printf '%s\\n\\n' "$__rec" >> "$__log"`,
    `fi`,
  ].join("\n");
}

function emitBody(spec) {
  const out = spec.stdout ?? "";
  const err = spec.stderr ?? "";
  const rc = spec.exitCode ?? 0;
  const parts = [];
  if (out !== "") parts.push(`printf '%s' ${sq(out)}`);
  if (err !== "") parts.push(`printf '%s' ${sq(err)} >&2`);
  parts.push(`exit ${rc}`);
  return parts.join("; ");
}

/**
 * Render one stub script.
 *
 * spec := { exitCode, stdout, stderr, cases?: [{ when: <bash glob>, exitCode, stdout, stderr }] }
 *
 * `cases[].when` is matched against `"$*"` by a real bash `case`, which is what lets a
 * single stub answer differently to `codesign -dv …` and `codesign --verify …`, or to
 * `xcrun -f stapler` and `xcrun stapler validate …`. Stdout/stderr are embedded
 * verbatim via `printf '%s'` — never `echo`, which would append a newline the spec
 * did not ask for.
 *
 * A bash `case` pattern is a single WORD, so an unquoted space in it is a syntax
 * error (verified on bash 3.2.57). Spaces are backslash-escaped here; that is
 * lossless, because a space is never a glob metacharacter.
 */
function renderStub(name, spec) {
  const lines = ["#!/bin/bash", `# generated stub: ${name}`, logPrelude(name)];
  const cases = spec.cases ?? [];
  if (cases.length > 0) {
    lines.push(`case "$*" in`);
    for (const c of cases) {
      const glob = c.when.split(" ").join("\\ ");
      lines.push(`  ${glob}) ${emitBody({ ...spec, ...c })} ;;`);
    }
    lines.push(`  *) ${emitBody(spec)} ;;`);
    lines.push(`esac`);
  } else {
    lines.push(emitBody(spec));
  }
  return lines.join("\n") + "\n";
}

function renderPassthrough(name, realPath) {
  return [
    "#!/bin/bash",
    `# generated pass-through: ${name} -> ${realPath}`,
    logPrelude(name),
    `exec ${realPath} "$@"`,
    "",
  ].join("\n");
}

/**
 * Build a stub directory.
 *
 * @param {string} dir           destination (created if absent)
 * @param {object} stubs         name -> spec overrides
 * @param {string[]} omit        names NOT to write at all (their absence is the input)
 */
export function makeStubDir(dir, { stubs = {}, omit = [] } = {}) {
  mkdirSync(dir, { recursive: true });
  for (const name of STUBBED_BINARIES) {
    if (omit.includes(name)) continue;
    const file = path.join(dir, name);
    writeFileSync(file, renderStub(name, stubs[name] ?? { exitCode: 0 }), { mode: 0o755 });
  }
  for (const [name, real] of Object.entries(PASSTHROUGH_BINARIES)) {
    if (omit.includes(name)) continue;
    writeFileSync(path.join(dir, name), renderPassthrough(name, real), { mode: 0o755 });
  }
  return dir;
}

/**
 * Fail loudly when a binary the scripts may call would NOT resolve to a stub.
 * A bare `existsSync(stubDir)` would pass a directory holding zero stubs, which is
 * exactly the silent-fallthrough this guard exists to prevent.
 */
export function assertStubsShadow(stubDir, { allowMissing = [] } = {}) {
  const required = [...STUBBED_BINARIES, ...Object.keys(PASSTHROUGH_BINARIES)];
  for (const name of required) {
    if (allowMissing.includes(name)) continue;
    const file = path.join(stubDir, name);
    if (!existsSync(file)) {
      throw new Error(`${name} would not resolve to a stub: no ${file}`);
    }
    if ((statSync(file).mode & 0o111) === 0) {
      throw new Error(`${name} would not resolve to a stub: ${file} is not executable`);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Case construction + running
// ---------------------------------------------------------------------------

/**
 * Create an isolated case: temp root, stub dir, HOME, and a private invocation log.
 * Nothing is written inside the repo tree.
 */
export function makeCase({ stubs = {}, omit = [], allowMissing = [], verify = true } = {}) {
  const root = makeTempRoot();
  const stubDir = path.join(root, "bin");
  const home = path.join(root, "home");
  const logPath = path.join(root, "invocations.log");
  makeStubDir(stubDir, { stubs, omit });
  mkdirSync(home, { recursive: true });
  writeFileSync(logPath, "");
  if (verify) assertStubsShadow(stubDir, { allowMissing });
  return {
    root,
    stubDir,
    home,
    logPath,
    log: () => readInvocationLog(logPath),
    allLog: () => readInvocationLog(logPath, { all: true }),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
      CREATED.delete(root);
    },
  };
}

/**
 * The child environment, built FROM SCRATCH. See property 2 in the header.
 * Values that are `undefined` are dropped, so "unset" means genuinely absent
 * rather than the string "undefined".
 */
export function childEnv(kase, extra = {}) {
  const env = { PATH: kase.stubDir, HOME: kase.home, LAWBAR_STUB_LOG: kase.logPath };
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/** Run a script under the isolated environment. */
export function runScript(scriptPath, args, kase, { env = {}, cwd = kase.root } = {}) {
  return spawnSync("/bin/bash", [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: childEnv(kase, env),
  });
}

/** Run an ad-hoc probe script body under the same isolation. */
export function runProbe(body, kase, { env = {}, cwd = kase.root, args = [] } = {}) {
  const file = path.join(kase.root, `probe-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return spawnSync("/bin/bash", [file, ...args], {
    cwd,
    encoding: "utf8",
    env: childEnv(kase, env),
  });
}

/** Run a shell command string (`bash -c`) under the same isolation. */
export function runCommand(command, kase, { env = {}, cwd = kase.root } = {}) {
  return spawnSync("/bin/bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: childEnv(kase, env),
  });
}

/**
 * Run a script with NO stubbing and NO isolation — the real tools, the real PATH.
 * Used only by the opt-in real-bundle file. PATH and HOME are the only variables
 * forwarded; no credential variable is ever passed through.
 */
export function runRealScript(scriptPath, args, { cwd } = {}) {
  return spawnSync("/bin/bash", [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" },
  });
}

// ---------------------------------------------------------------------------
// Invocation log
// ---------------------------------------------------------------------------

/**
 * Parse the invocation log written by the stubs.
 * Pass-through records (bash/grep/sed) are filtered out by default: they are real
 * binaries, not boundaries, and their ordering relative to a piped-from stub is
 * genuinely nondeterministic. `{ all: true }` returns everything.
 */
export function readInvocationLog(logPath, { all = false } = {}) {
  if (!existsSync(logPath)) return [];
  const lines = readFileSync(logPath, "utf8").split("\n");
  const records = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i] === "") i++;
    if (i >= lines.length) break;
    const name = lines[i++];
    const argv = [];
    while (i < lines.length && lines[i] !== "") argv.push(lines[i++]);
    records.push({ name, argv });
  }
  return all ? records : records.filter((r) => !PASSTHROUGH_NAMES.has(r.name));
}

// ---------------------------------------------------------------------------
// Opt-in gating for the real-bundle file (WI-9)
// ---------------------------------------------------------------------------

/**
 * Why the real-bundle suite is being skipped, or null when it should run.
 * Pure: takes the env object and an `existsSync`-shaped predicate, so it is
 * testable from the registered lane without mutating process.env or the fs.
 * The flag is checked FIRST — the cheaper diagnostic wins, and no stat happens
 * on the overwhelmingly common "not opted in" path.
 */
export function skipReason(env, exists) {
  if (env.LAWBAR_SIGNING_REAL_BUNDLE !== "1") {
    return "SKIPPED: LAWBAR_SIGNING_REAL_BUNDLE is not set to 1";
  }
  if (!exists(REAL_BUNDLE_REL)) {
    // NOT a skip. The flag being set means someone deliberately asked for the
    // real-tool run; answering "nothing to verify, exit 0" is a vacuous pass on
    // the one lane whose entire purpose is real-bundle evidence. Opting in and
    // getting silence is worse than not opting in.
    return {
      fail: `LAWBAR_SIGNING_REAL_BUNDLE=1 was set, but no bundle exists at ${REAL_BUNDLE_REL}. ` +
        `This lane exists to produce real-tool evidence; with no bundle it can produce none. ` +
        `Run 'npm run dist' first, or unset the flag to skip deliberately.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small assertion helpers shared by the test files
// ---------------------------------------------------------------------------

export function lines(s) {
  return String(s).split("\n");
}

export function countOccurrences(haystack, needle) {
  if (needle === "") throw new Error("countOccurrences: empty needle");
  let n = 0;
  let idx = 0;
  for (;;) {
    const at = haystack.indexOf(needle, idx);
    if (at === -1) return n;
    n++;
    idx = at + needle.length;
  }
}

export function countMissingLines(stdout) {
  return lines(stdout).filter((l) => l.startsWith("[MISSING]")).length;
}

export function assertNoCommandNotFound(r, label) {
  const combined = `${r.stdout}${r.stderr}`;
  assert.ok(
    !/command not found|No such file or directory/.test(combined),
    `${label}: the isolated PATH was missing something the script needs:\n${combined}`,
  );
}
