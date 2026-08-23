// release-preflight.test.mjs — WI-3 (signing axis), WI-4 (notarization axis) and
// WI-6 (secret non-disclosure) for apps/lawbar-desktop/scripts/release-preflight.sh.
//
// POSTURE: regression-first. The script was fixed before these tests were written, so
// every case asserts CORRECT behaviour. Cases tagged [REGRESSION] must FAIL when the
// suite is pointed at the preserved pre-fix copy and PASS against the current script:
//
//   LAWBAR_SCRIPT_DIR=<prefix-scripts> node --test tests/release-preflight.test.mjs
//
// A [REGRESSION] case that passes against BOTH is not testing the fix.
//
// FIX REGISTER covered here (addendum §2, WI-11):
//   finding 2 — whitespace-only credentials satisfied `-n`      -> present()          -> T4.7, T4.8, T4.10
//   finding 3 — a keychain identity short-circuited the
//               CSC_KEY_PASSWORD check, so the gate passed a
//               config electron-builder rejects at build time   -> branch order flip  -> T3.9, T3.2, T3.6
//   finding 4 — unanchored `grep -q "Developer ID Application"` -> anchored row regex -> T3.7, T3.8, T3.10, T3.11
//   finding 7 — the failure message cited a document deleted
//               in 88c8c46                                      -> product-plan.md §6 -> T4.9
//
// MOCK BOUNDARY, stated once: the `security` stub only. It is a genuine system
// boundary — the real binary reads the maintainer's login keychain, so an unstubbed
// run's verdict would depend on whose Mac it executes on and would place real
// keychain contents inside test assertions.
//
// THE HONEST UNMET OBLIGATION: no real-path test can exist for this unit. Exercising
// the real keychain branch needs a Developer ID identity installed, and the notary
// branches need real Apple credentials. Both are forbidden by the standing
// constraints. Every case below is stub-bound with no integration counterpart, and
// that is a finding, not a preference (base matrix, Deferred §2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  PREFLIGHT, PKG_DIR, SENTINEL, KEYCHAIN_ONLY,
  IDENTITY_PRESENT, NO_IDENTITY, EXPIRED_UNANCHORED,
  APPLE_DEVELOPMENT_ONLY, PHRASE_IN_TRAILER_ONLY,
  makeCase, runScript, lines, countOccurrences, countMissingLines,
} from "./_release-script-harness.mjs";

// ---------------------------------------------------------------------------
// Emitted strings, quoted from the script so a reword is caught here.
// ---------------------------------------------------------------------------
const OK_KEYCHAIN = "[ok] Developer ID Application identity found in the keychain.";
const OK_CSC =
  "[ok] CSC_LINK is set (electron-builder will sign from this certificate, not the keychain).";
const MISSING_CSC_PWD = "[MISSING] CSC_KEY_PASSWORD (password for the CSC_LINK cert).";
const MISSING_IDENTITY =
  "[MISSING] no Developer ID Application identity in the keychain and CSC_LINK is unset.";
const IDENTITY_NOTE =
  "  - import the cert into the login keychain, OR set CSC_LINK + CSC_KEY_PASSWORD.";
const MISSING_TEAM_ID = "[MISSING] APPLE_TEAM_ID.";
const OK_APPLE_ID = "[ok] notary method: Apple-ID (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD).";
const OK_API_KEY =
  "[ok] notary method: App Store Connect API key (APPLE_API_KEY + KEY_ID + ISSUER).";
const MISSING_NOTARY =
  "[MISSING] notarization credentials: set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, " +
  "OR APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER.";
const BANNER_OK = "release preflight OK — proceeding with the signed + notarized build.";
const BANNER_FAIL = "release preflight FAILED — signing/notarization credentials are incomplete.";
const POINTER =
  "See docs/product/product-plan.md -> 'macOS Developer-ID signing + notarization' section 6.";
const ABORT = "Aborting the release build (the unsigned dev build is 'npm run dist').";
const DELETED_DOC = "dev-memo/desktop-macos-signing-notarization.md";

/** Notarization held satisfied, so a WI-3 exit code is attributable to signing alone. */
const NOTARY_OK = {
  APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
  APPLE_ID: SENTINEL.APPLE_ID,
  APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
};

/** Run preflight with a `security` fixture and an env delta. */
function preflight(securitySpec, env, extraCaseOpts = {}) {
  const k = makeCase({ stubs: { security: securitySpec }, ...extraCaseOpts });
  const r = runScript(PREFLIGHT, [], k, { env });
  const log = k.log();
  k.cleanup();
  return { ...r, log, out: r.stdout, combined: `${r.stdout}${r.stderr}` };
}

const identity = (stdout, exitCode = 0) => ({ exitCode, stdout });

// ===========================================================================
// WI-3 — signing-identity axis
// ===========================================================================

test("T3.1 keychain identity present, no CSC_LINK -> keychain [ok] and exit 0", () => {
  const r = preflight(identity(IDENTITY_PRESENT), NOTARY_OK);
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes(OK_KEYCHAIN), r.out);
  assert.ok(r.out.includes(BANNER_OK), r.out);
  // Counting [MISSING] lines, never "contains [ok]": T3.3 and T4.5 are the
  // counter-examples that make "contains [ok]" useless as a pass oracle.
  assert.equal(countMissingLines(r.out), 0, r.out);
});

test("T3.2 [REGRESSION] CSC_LINK + password wins outright; the keychain is never consulted", () => {
  const r = preflight(identity(NO_IDENTITY), {
    ...NOTARY_OK,
    CSC_LINK: SENTINEL.CSC_LINK,
    CSC_KEY_PASSWORD: SENTINEL.CSC_KEY_PASSWORD,
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes(OK_CSC), r.out);
  assert.equal(countMissingLines(r.out), 0, r.out);
  // The sharp half, and what fails pre-fix: CSC_LINK is now tested FIRST, so
  // `security` is not invoked at all. Pre-fix the keychain was queried first and
  // this log held one record. app-builder-lib builds a temporary keychain from
  // CSC_LINK and never reads the login keychain, so consulting it was misleading.
  assert.deepEqual(r.log, []);
});

test("T3.3 CSC_LINK without a password emits BOTH an [ok] and a [MISSING], and exits 1", () => {
  const r = preflight(identity(NO_IDENTITY), { ...NOTARY_OK, CSC_LINK: SENTINEL.CSC_LINK });
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(OK_CSC), r.out);
  assert.ok(r.out.includes(MISSING_CSC_PWD), r.out);
  assert.ok(r.out.includes(BANNER_FAIL), r.out);
});

test("T3.4 [REGRESSION] CSC_LINK empty AND whitespace-only both behave as unset", () => {
  for (const value of ["", "   ", "\t", "\n"]) {
    const r = preflight(identity(NO_IDENTITY), { ...NOTARY_OK, CSC_LINK: value });
    assert.equal(r.status, 1, `CSC_LINK=${JSON.stringify(value)}: ${r.combined}`);
    assert.ok(r.out.includes(MISSING_IDENTITY), `CSC_LINK=${JSON.stringify(value)}: ${r.out}`);
    assert.ok(r.out.includes(IDENTITY_NOTE), r.out);
    // The negative assertion is what pins "it took the else, not the CSC branch".
    // Pre-fix `[ -n "   " ]` was true, so the whitespace rows printed the CSC [ok]
    // line and a CSC_KEY_PASSWORD complaint instead.
    assert.ok(!r.out.includes(MISSING_CSC_PWD), `CSC_LINK=${JSON.stringify(value)}: ${r.out}`);
    assert.ok(!r.out.includes(OK_CSC), `CSC_LINK=${JSON.stringify(value)}: ${r.out}`);
  }
});

test("T3.5 neither keychain nor CSC_LINK -> missing-identity line with the note on the NEXT line", () => {
  const r = preflight(identity(NO_IDENTITY), NOTARY_OK);
  assert.equal(r.status, 1, r.combined);
  const ls = lines(r.out);
  const i = ls.indexOf(MISSING_IDENTITY);
  assert.notEqual(i, -1, r.out);
  // Adjacency, not mere presence: a refactor collecting notes into a trailing
  // summary block would still "contain" the note.
  assert.equal(ls[i + 1], IDENTITY_NOTE, r.out);
});

test("T3.6 [REGRESSION] a failing `security` never decides the branch, and its stderr is swallowed", () => {
  const broken = { exitCode: 127, stdout: "", stderr: "security: command not found\n" };

  // (a) CSC_LINK set: the keychain is not consulted at all, so a broken `security`
  //     is irrelevant. Pre-fix it WAS consulted first and this log held one record.
  const a = preflight(broken, {
    ...NOTARY_OK,
    CSC_LINK: SENTINEL.CSC_LINK,
    CSC_KEY_PASSWORD: SENTINEL.CSC_KEY_PASSWORD,
  });
  assert.equal(a.status, 0, a.combined);
  assert.ok(a.out.includes(OK_CSC), a.out);
  assert.ok(!a.out.includes(OK_KEYCHAIN), a.out);
  assert.deepEqual(a.log, []);

  // (b) No CSC_LINK: `security` runs, exits 127 with empty stdout, and the pipeline's
  //     status is grep's — no match, so the else arm is taken. `2>/dev/null` on the
  //     script's line means the tool's diagnostic never reaches the terminal; no
  //     output-only assertion reaches that redirect.
  const b = preflight(broken, NOTARY_OK);
  assert.equal(b.status, 1, b.combined);
  assert.ok(b.out.includes(MISSING_IDENTITY), b.out);
  assert.equal(b.stderr, "", `stderr must be swallowed by 2>/dev/null, got: ${b.stderr}`);
  assert.equal(b.log.filter((rec) => rec.name === "security").length, 1);
});

test("T3.7 [REGRESSION] the branch is decided by the ROW SHAPE, not by security's exit status", () => {
  // (a) A clean, well-formed row is accepted even though `security` exited non-zero:
  //     the pipeline's status is grep's. Unchanged by the fix, asserted so the pair
  //     below isolates a single variable.
  const clean = preflight(identity(IDENTITY_PRESENT, 1), NOTARY_OK);
  assert.equal(clean.status, 0, clean.combined);
  assert.ok(clean.out.includes(OK_KEYCHAIN), clean.out);

  // (b) The SAME non-zero status, but the phrase appears only as prose rather than as
  //     a numbered identity row -> rejected. Pre-fix the unanchored substring `grep -q`
  //     accepted this and exited 0.
  const prose = preflight(
    identity("Developer ID Application: SENTINEL-ORG is not installed\n", 1),
    NOTARY_OK,
  );
  assert.equal(prose.status, 1, prose.combined);
  assert.ok(prose.out.includes(MISSING_IDENTITY), prose.out);
  assert.ok(!prose.out.includes(OK_KEYCHAIN), prose.out);
});

test("T3.8 [REGRESSION] an expired identity row plus '0 valid identities found' is rejected", () => {
  // The row carries `(CSSMERR_TP_CERT_EXPIRED)` AFTER the closing quote. The `$`
  // anchor is what rejects it — and it rejects any future error marker printed in
  // that position, which a blacklist of known CSSMERR codes would not.
  const r = preflight(identity(EXPIRED_UNANCHORED), NOTARY_OK);
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(MISSING_IDENTITY), r.out);
  assert.ok(!r.out.includes(OK_KEYCHAIN), r.out);
  // The keychain listing itself never reaches stdout: `grep -q` suppresses it.
  assert.ok(!r.out.includes(KEYCHAIN_ONLY), r.out);
});

test("T3.9 [REGRESSION] a keychain identity does NOT excuse a missing CSC_KEY_PASSWORD", () => {
  // Finding 3, and the whole reason the branch order was inverted. Pre-fix this
  // configuration exited 0: the keychain arm won and the password check was never
  // reached. electron-builder would then sign from CSC_LINK and fail at build time,
  // after the gate had already said OK.
  const r = preflight(identity(IDENTITY_PRESENT), { ...NOTARY_OK, CSC_LINK: SENTINEL.CSC_LINK });
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(MISSING_CSC_PWD), r.out);
  assert.ok(r.out.includes(OK_CSC), r.out);
  assert.ok(!r.out.includes(OK_KEYCHAIN), r.out);
});

test("T3.10 a keychain holding only an Apple Development identity is rejected", () => {
  // A count-based check ("N valid identities found" > 0) would have passed this:
  // the row is valid, it simply cannot sign a release.
  const r = preflight(identity(APPLE_DEVELOPMENT_ONLY), NOTARY_OK);
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(MISSING_IDENTITY), r.out);
  assert.ok(!r.out.includes(OK_KEYCHAIN), r.out);
});

test("T3.11 [REGRESSION] the phrase appearing only in the trailer is not an identity", () => {
  // Pins the `^` anchor. Pre-fix the bare substring match fired on this trailer and
  // the gate reported an identity that does not exist.
  const r = preflight(identity(PHRASE_IN_TRAILER_ONLY), NOTARY_OK);
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(MISSING_IDENTITY), r.out);
  assert.ok(!r.out.includes(OK_KEYCHAIN), r.out);
});

// ===========================================================================
// WI-4 — notarization axis. `security` is pinned to IDENTITY_PRESENT and CSC_* are
// unset throughout, so the signing axis contributes nothing to the exit code.
// ===========================================================================

const KEYCHAIN_OK = identity(IDENTITY_PRESENT);

test("T4.1 complete Apple-ID method + team id -> exit 0 and the Apple-ID method line", () => {
  const r = preflight(KEYCHAIN_OK, {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes(OK_APPLE_ID), r.out);
  assert.ok(!r.out.includes("App Store Connect API key"), r.out);
});

test("T4.2 complete API-key method + team id -> exit 0 and the API-key method line", () => {
  const r = preflight(KEYCHAIN_OK, {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_API_KEY: SENTINEL.APPLE_API_KEY,
    APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID,
    APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER,
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes(OK_API_KEY), r.out);
  assert.ok(!r.out.includes("notary method: Apple-ID"), r.out);
});

test("T4.3 both methods complete -> Apple-ID wins and the API-key line is NOT printed", () => {
  const r = preflight(KEYCHAIN_OK, {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_API_KEY: SENTINEL.APPLE_API_KEY,
    APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID,
    APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER,
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes("notary method: Apple-ID"), r.out);
  // The ABSENCE assertion carries the case: presence alone passes under an if/if
  // structure as well as an if/elif. Only absence distinguishes them.
  assert.ok(!r.out.includes("App Store Connect API key"), r.out);
});

test("T4.4 partial Apple-ID + complete API-key falls through to the elif and passes", () => {
  const r = preflight(KEYCHAIN_OK, {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_ID: SENTINEL.APPLE_ID, // password deliberately unset
    APPLE_API_KEY: SENTINEL.APPLE_API_KEY,
    APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID,
    APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER,
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes("App Store Connect API key"), r.out);
  assert.ok(!r.out.includes("notary method: Apple-ID"), r.out);
  assert.equal(countMissingLines(r.out), 0, r.out);
});

test("T4.5 APPLE_TEAM_ID is checked independently: a complete method still fails without it", () => {
  const r = preflight(KEYCHAIN_OK, {
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
  });
  assert.equal(r.status, 1, r.combined);
  // Both, in one run: the team-id check is a separate statement, not part of the
  // method `if`. This is the second counter-example against "contains [ok]" = pass.
  assert.ok(r.out.includes(MISSING_TEAM_ID), r.out);
  assert.ok(r.out.includes(OK_APPLE_ID), r.out);
});

test("T4.6 every partial method combination fails with exactly one combined guidance line", () => {
  const rows = [
    ["a APPLE_ID only", { APPLE_ID: SENTINEL.APPLE_ID }],
    ["b password only", { APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD }],
    ["c API_KEY only", { APPLE_API_KEY: SENTINEL.APPLE_API_KEY }],
    ["d API_KEY + KEY_ID", { APPLE_API_KEY: SENTINEL.APPLE_API_KEY, APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID }],
    ["e API_KEY + ISSUER", { APPLE_API_KEY: SENTINEL.APPLE_API_KEY, APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER }],
    ["f KEY_ID + ISSUER", { APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID, APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER }],
  ];
  for (const [label, extra] of rows) {
    const r = preflight(KEYCHAIN_OK, { APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID, ...extra });
    assert.equal(r.status, 1, `${label}: ${r.combined}`);
    // Count, not merely presence: rows d/e/f are the three ways to hold two of the
    // three API-key variables, and a naive APPLE_API_KEY-only check passes all three.
    assert.equal(countOccurrences(r.out, MISSING_NOTARY), 1, `${label}: ${r.out}`);
    assert.ok(!r.out.includes("notary method:"), `${label}: ${r.out}`);
  }
});

test("T4.7 [REGRESSION] whitespace-only APPLE_TEAM_ID is rejected", () => {
  // Finding 2. Pre-fix `[ -n " " ]` was true and this exited 0 — the same defect
  // class the repo hardened for audited reasons in e9ff43c.
  const r = preflight(KEYCHAIN_OK, {
    APPLE_TEAM_ID: " ",
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
  });
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(MISSING_TEAM_ID), r.out);
  assert.ok(!r.out.includes(BANNER_OK), r.out);
});

test("T4.8 [REGRESSION] whitespace-only APPLE_APP_SPECIFIC_PASSWORD does not complete the method", () => {
  // Finding 2 is a CLASS, not a single site: fixing only APPLE_TEAM_ID would leave a
  // whitespace password advertising a complete notary method.
  const r = preflight(KEYCHAIN_OK, {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: " ",
  });
  assert.equal(r.status, 1, r.combined);
  assert.ok(!r.out.includes(OK_APPLE_ID), r.out);
  assert.ok(r.out.includes(MISSING_NOTARY), r.out);
});

test("T4.9 [REGRESSION] the failure block points at product-plan.md, never the deleted document", () => {
  const r = preflight(identity(NO_IDENTITY), {});
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(MISSING_IDENTITY), r.out);
  assert.ok(r.out.includes(MISSING_TEAM_ID), r.out);
  assert.ok(r.out.includes(MISSING_NOTARY), r.out);
  // `fail=1` is idempotent, so three independent failures must still produce ONE
  // banner. An implementation echoing the banner per failure would produce three.
  assert.equal(countOccurrences(r.out, BANNER_FAIL), 1, r.out);
  assert.ok(r.out.includes(POINTER), r.out);
  assert.ok(r.out.includes(ABORT), r.out);
  // Finding 7: the pre-fix pointer sent the reader to a file deleted in 88c8c46.
  assert.ok(!r.out.includes(DELETED_DOC), r.out);
});

test("T4.10 [REGRESSION] tab-only and newline-only credential values are rejected", () => {
  // `present()` strips the whole [[:space:]] class, not just the space character.
  for (const ws of ["\t", "\n", " \t\n "]) {
    const teamOnly = preflight(KEYCHAIN_OK, {
      APPLE_TEAM_ID: ws,
      APPLE_ID: SENTINEL.APPLE_ID,
      APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
    });
    assert.equal(teamOnly.status, 1, `APPLE_TEAM_ID=${JSON.stringify(ws)}: ${teamOnly.combined}`);
    assert.ok(teamOnly.out.includes(MISSING_TEAM_ID), teamOnly.out);

    const apiOnly = preflight(KEYCHAIN_OK, {
      APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
      APPLE_API_KEY: SENTINEL.APPLE_API_KEY,
      APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID,
      APPLE_API_ISSUER: ws,
    });
    assert.equal(apiOnly.status, 1, `APPLE_API_ISSUER=${JSON.stringify(ws)}: ${apiOnly.combined}`);
    assert.ok(apiOnly.out.includes(MISSING_NOTARY), apiOnly.out);
  }
});

// ===========================================================================
// WI-6 — secret non-disclosure.
//
// Every case pairs the non-disclosure assertions with a POSITIVE branch assertion in
// the same test. Alone, a non-disclosure assertion is vacuous: a script replaced by
// `echo OK; exit 0` would satisfy it. The pairing is mandatory, not stylistic.
// ===========================================================================

const ALL_SENTINELS = Object.entries(SENTINEL);

function assertNoLeak(combined, label) {
  for (const [name, value] of ALL_SENTINELS) {
    assert.ok(!combined.includes(value), `${label}: leaked ${name}`);
  }
}

test("T6.1 a passing run leaks no sentinel, and never echoes the keychain listing", () => {
  // (a) CSC branch: both CSC_* sentinels are genuinely in play.
  const csc = preflight(identity(NO_IDENTITY), {
    ...Object.fromEntries(ALL_SENTINELS),
  });
  assert.equal(csc.status, 0, csc.combined);
  assert.ok(csc.out.includes(OK_CSC), csc.out);
  assert.ok(csc.out.includes(BANNER_OK), csc.out);
  assertNoLeak(csc.combined, "passing CSC run");

  // (b) Keychain branch, so `security` actually runs and its output passes through
  //     `grep -q`. The keychain-only marker pins that -q suppresses the listing.
  const key = preflight(identity(IDENTITY_PRESENT), {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_API_KEY: SENTINEL.APPLE_API_KEY,
    APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID,
    APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER,
  });
  assert.equal(key.status, 0, key.combined);
  assert.ok(key.out.includes(OK_KEYCHAIN), key.out);
  assert.ok(key.out.includes(BANNER_OK), key.out);
  assertNoLeak(key.combined, "passing keychain run");
  assert.ok(!key.combined.includes(KEYCHAIN_ONLY), "keychain listing reached stdout");
});

test("T6.2 a failing run leaks no sentinel either", () => {
  // The failure path is where leakage is most likely: error messages are where
  // "helpful context" gets added. CSC_KEY_PASSWORD is set while CSC_LINK is not —
  // an unusual but realistic half-configuration.
  const r = preflight(identity(NO_IDENTITY), {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_API_KEY: SENTINEL.APPLE_API_KEY,
    APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID,
    APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER,
    CSC_KEY_PASSWORD: SENTINEL.CSC_KEY_PASSWORD,
  });
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(BANNER_FAIL), r.out);
  assert.ok(r.out.includes(MISSING_IDENTITY), r.out);
  assertNoLeak(r.combined, "failing run");
  assert.ok(!r.combined.includes(KEYCHAIN_ONLY), "keychain listing reached stdout");
});

test("T6.3 no sentinel appears in the security invocation log", () => {
  const k = makeCase({ stubs: { security: identity(IDENTITY_PRESENT) } });
  const r = runScript(PREFLIGHT, [], k, { env: Object.fromEntries(ALL_SENTINELS.filter(([n]) => !n.startsWith("CSC_"))) });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const log = k.log();
  // Argv equality is the stronger assertion: it forbids ANY extra argument, not
  // merely sentinel-shaped ones. Passing a credential on the argument list would
  // expose it to `ps` for every user on the machine.
  assert.deepEqual(log, [{ name: "security", argv: ["find-identity", "-v", "-p", "codesigning"] }]);
  const serialised = JSON.stringify(k.allLog());
  for (const [name, value] of ALL_SENTINELS) {
    assert.ok(!serialised.includes(value), `leaked ${name} into the invocation log`);
  }
  k.cleanup();
});

test("T6.4 check-no-real-data.mjs stays green on all six new files", () => {
  // Explicit paths are resolved against the REPOSITORY ROOT, not the cwd — verified
  // by reading resolveScanFiles(). Passing `tests/…` here would resolve to
  // <repo>/tests/…, match nothing, and the scanner would report a clean pass having
  // scanned ZERO files. That is why the count is asserted below: a scan that looked
  // at nothing is a failure, never a pass.
  const files = [
    "_release-script-harness.mjs",
    "release-script-harness.test.mjs",
    "release-preflight.test.mjs",
    "release-preflight-failclosed.test.mjs",
    "verify-macos-signing.test.mjs",
    "verify-macos-signing.real-bundle.test.mjs",
  ].map((f) => `apps/lawbar-desktop/tests/${f}`);

  // The real scanner, on the real files, through its real CLI — never a
  // re-implementation of its regexes. A "more realistic" fixture (an email-shaped
  // APPLE_ID, an xxxx-xxxx-xxxx-xxxx password, a digit-run team id) would trip the
  // email / phone-us / id-cn patterns here, which is why the §2 sentinels are
  // letter-suffixed with no digit runs.
  const r = spawnSync(process.execPath, [path.join("scripts", "check-no-real-data.mjs"), ...files], {
    cwd: PKG_DIR,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /OK — 6 file\(s\) in case-box scope \(mode=explicit\); no markers/, r.stdout);
});

// ---------------------------------------------------------------------------
// T3.12 — added 2026-08-13 after mutation testing. Mutant M03 (delete the leading
// `^` from the identity regex) SURVIVED the whole 93-case suite: T3.11's fixture is
// rejected by the ROW SHAPE (`N) HEX "…"`), not by the anchor, so no case forced the
// anchor to exist. Line coverage was 100% and still missed it.
// ---------------------------------------------------------------------------

/** The identity-row shape appearing mid-line instead of at the start of a row. */
const ROW_SHAPE_MID_LINE =
  `     0 valid identities found\n` +
  `     hint: a row reads  1) AAAABBBBCCCCDDDD "Developer ID Application: SENTINEL-ORG (SENTINEL-TEAMID-A)"\n`;

test("T3.12 the identity row must start the line — the same shape mid-line is not an identity", () => {
  // Every other clause of the regex is satisfied here: numbered marker, all-hex hash,
  // the quoted Developer ID name, and the line ends at the closing quote. ONLY the `^`
  // anchor rejects it. Delete the anchor and this fixture reports an identity that the
  // keychain does not hold, which is the same false-green class as the original
  // unanchored `grep -q`.
  const r = preflight(identity(ROW_SHAPE_MID_LINE), NOTARY_OK);
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes(MISSING_IDENTITY), r.out);
  assert.ok(!r.out.includes(OK_KEYCHAIN), r.out);
});

// ---------------------------------------------------------------------------
// T4.11 — added 2026-08-13 after review finding M-2. `present()` guards EIGHT
// variables; whitespace was tested at only four of them. T4.8's own comment argues
// finding 2 is "a CLASS, not a single site", so covering half the class was the gap.
// The sharp one is CSC_KEY_PASSWORD: it is finding 3's variable, and
// CSC_LINK=<real> + CSC_KEY_PASSWORD="   " is exactly the configuration
// electron-builder accepts and then fails on at signing time.
// ---------------------------------------------------------------------------

test("T4.11 every present()-guarded credential rejects a whitespace-only value", () => {
  const WS = "   ";
  // Each row: the variable to blank out, the rest of a would-otherwise-pass env, and
  // the [MISSING] line that must appear.
  const rows = [
    {
      name: "CSC_KEY_PASSWORD",
      security: identity(NO_IDENTITY),
      env: { CSC_LINK: SENTINEL.CSC_LINK, CSC_KEY_PASSWORD: WS, ...NOTARY_OK },
      missing: "[MISSING] CSC_KEY_PASSWORD",
    },
    {
      name: "APPLE_ID",
      security: KEYCHAIN_OK,
      env: {
        APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
        APPLE_ID: WS,
        APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
      },
      missing: "[MISSING] notarization credentials",
    },
    {
      name: "APPLE_API_KEY",
      security: KEYCHAIN_OK,
      env: {
        APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
        APPLE_API_KEY: WS,
        APPLE_API_KEY_ID: SENTINEL.APPLE_API_KEY_ID,
        APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER,
      },
      missing: "[MISSING] notarization credentials",
    },
    {
      name: "APPLE_API_KEY_ID",
      security: KEYCHAIN_OK,
      env: {
        APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
        APPLE_API_KEY: SENTINEL.APPLE_API_KEY,
        APPLE_API_KEY_ID: WS,
        APPLE_API_ISSUER: SENTINEL.APPLE_API_ISSUER,
      },
      missing: "[MISSING] notarization credentials",
    },
  ];
  for (const row of rows) {
    const r = preflight(row.security, row.env);
    assert.equal(r.status, 1, `${row.name} whitespace-only should fail: ${r.combined}`);
    assert.ok(r.out.includes(row.missing), `${row.name}: ${r.out}`);
  }
});
