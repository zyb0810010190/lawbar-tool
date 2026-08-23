import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanFile,
  scanContent,
  scanFixtureProvenance,
  isInScope,
  SWEEP_ROOTS,
  isBinaryAsset,
  isDetectorDoc,
  isFixtureJson,
  isApprovedFictionalPartyName,
  resolveScanFiles,
  DOC_EXEMPT_MARKER,
  PATTERNS,
  PARTY_NAME_FIELDS,
  APPROVED_FICTIONAL_PARTY_NAMES,
} from "../scripts/check-no-real-data.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // apps/lawbar-desktop
const REPO_ROOT = path.resolve(APP_ROOT, "..", ".."); // repo root, as the scanner computes it

test("PATTERNS list covers court / bar / phone / email / SSN / national-ID", () => {
  const names = PATTERNS.map((p) => p.name);
  assert.ok(names.includes("real-court-en"));
  assert.ok(names.includes("real-court-zh"));
  assert.ok(names.includes("phone-us"));
  assert.ok(names.includes("email"));
  assert.ok(names.includes("ssn-us"));
  assert.ok(names.includes("id-cn"));
});

test("scanFile flags US court name", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const name = "Acme v. Specimen, Northern District Court of California";\n`, "utf8");
  const hits = scanFile(f);
  assert.ok(hits.some((h) => h.pattern === "real-court-en"));
});

test("scanFile flags Chinese court name", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const v = "北京市高级人民法院";\n`, "utf8");
  const hits = scanFile(f);
  assert.ok(hits.some((h) => h.pattern === "real-court-zh"));
});

test("scanFile flags US phone number", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const v = "Call (415) 555-9876";\n`, "utf8");
  const hits = scanFile(f);
  assert.ok(hits.some((h) => h.pattern === "phone-us"));
});

test("scanFile flags US SSN-shaped pattern", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const v = "123-45-6789";\n`, "utf8");
  const hits = scanFile(f);
  assert.ok(hits.some((h) => h.pattern === "ssn-us"));
});

test("scanFile ignores synthetic strings", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const v = "PoC synthetic matter — Acme Demonstration LLC";\n`, "utf8");
  const hits = scanFile(f);
  assert.deepEqual(hits, []);
});

test("scanFile ignores example.com emails", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const v = "alice@example.com";\n`, "utf8");
  const hits = scanFile(f);
  assert.equal(hits.filter((h) => h.pattern === "email").length, 0);
});

// --- binary asset skip (WI: ignore binary font assets in no-real-data scanner) ---

test("isBinaryAsset recognises binary extensions and not text ones", () => {
  for (const ext of [".woff2", ".woff", ".ttf", ".otf", ".png", ".jpg", ".pdf", ".wasm", ".WOFF2"]) {
    assert.ok(isBinaryAsset(`x${ext}`), `${ext} should be binary`);
  }
  for (const ext of [".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".md", ".svg"]) {
    assert.ok(!isBinaryAsset(`x${ext}`), `${ext} should NOT be binary`);
  }
});

test("scanFile skips a .woff2 binary even with email-like bytes", () => {
  // Real failing match observed in the gate: byte runs like "qx@V.uh" inside a font file.
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "noto-sans-sc-400.woff2");
  writeFileSync(f, `garbage qx@V.uh bytes real@acme.com 415-555-9876`, "utf8");
  assert.deepEqual(scanFile(f), []);
});

test("scanFile still flags a real email in a text file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nodata-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const contact = "counsel@realfirm.com";\n`, "utf8");
  const hits = scanFile(f);
  assert.ok(hits.some((h) => h.pattern === "email"), "real email in .ts must still be flagged");
});

test("isInScope excludes binary fonts but keeps renderer text files", () => {
  assert.equal(isInScope(path.join(APP_ROOT, "renderer/fonts/noto-sans-sc-400.woff2")), false);
  assert.equal(isInScope(path.join(APP_ROOT, "renderer/fonts/jetbrains-mono-400.woff2")), false);
  assert.equal(isInScope(path.join(APP_ROOT, "renderer/screens/listMatters.ts")), true);
  assert.equal(isInScope(path.join(APP_ROOT, "renderer/index.css")), true);
});

// --- documented detector-pattern exemption (SCAFFOLD: exempt documented detector patterns) ---

test("isDetectorDoc: only dev-memo/**.md prose qualifies (code/fixtures never do)", () => {
  assert.equal(isDetectorDoc(path.join(REPO_ROOT, "dev-memo/plan-casebox-ipc-impl-01.md")), true);
  assert.equal(isDetectorDoc(path.join(REPO_ROOT, "dev-memo/sub/notes.MD")), true);
  // NOT exempt-eligible — the marker can never weaken these:
  assert.equal(isDetectorDoc(path.join(REPO_ROOT, "apps/lawbar-desktop/renderer/screens/listMatters.ts")), false);
  assert.equal(isDetectorDoc(path.join(REPO_ROOT, "apps/lawbar-desktop/tests/x.test.mjs")), false);
  assert.equal(isDetectorDoc(path.join(REPO_ROOT, "apps/lawbar-desktop/fixtures/data.md")), false); // not under dev-memo
  assert.equal(isDetectorDoc(path.join(REPO_ROOT, "services/ocr-worker/src/x.ts")), false);
  assert.equal(isDetectorDoc(path.join(REPO_ROOT, "dev-memo/run/config")), false); // not .md
});

test("scanContent: marker exempts a documented-pattern line in a dev-memo doc", () => {
  const line = `real-court regex: /(supreme court|高级人民法院)/i <!-- ${DOC_EXEMPT_MARKER} -->`;
  assert.deepEqual(scanContent(line, { isDoc: true, file: "dev-memo/x.md" }), []);
});

test("scanContent: court strings in ordinary doc prose still fail (no marker)", () => {
  const hits = scanContent("filed in the Northern District Court of California", { isDoc: true, file: "dev-memo/x.md" });
  assert.ok(hits.some((h) => h.pattern === "real-court-en"));
});

test("scanContent: marker is IGNORED outside dev-memo docs — code/fixtures stay protected", () => {
  const line = `const v = "Northern District Court"; // ${DOC_EXEMPT_MARKER}`;
  const hits = scanContent(line, { isDoc: false, file: "apps/lawbar-desktop/renderer/x.ts" });
  assert.ok(hits.some((h) => h.pattern === "real-court-en"), "marker must NOT exempt non-doc files");
});

test("scanContent: unknown / partial exemption markers do not bypass", () => {
  for (const bogus of ["no-real-data: skip", "no-real-data", "detector-pattern-doc", "exempt please", "no-real-data: detector"]) {
    const line = `District Court <!-- ${bogus} -->`;
    const hits = scanContent(line, { isDoc: true, file: "dev-memo/x.md" });
    assert.ok(hits.some((h) => h.pattern === "real-court-en"), `bogus marker "${bogus}" must not bypass`);
  }
});

test("scanContent: marker exempts only its own line, not the whole block", () => {
  const text = `District Court here\nDistrict Court there <!-- ${DOC_EXEMPT_MARKER} -->`;
  const hits = scanContent(text, { isDoc: true, file: "dev-memo/x.md" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1); // only the unmarked first line is flagged
});

test("scanFile: marker in a non-dev-memo file does not exempt (end-to-end path gating)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lawbar-nrd-"));
  const f = path.join(dir, "x.ts");
  writeFileSync(f, `const v = "District Court"; // ${DOC_EXEMPT_MARKER}\n`, "utf8");
  assert.ok(scanFile(f).some((h) => h.pattern === "real-court-en"));
});

// --- WI-GATE-PROVENANCE: widened scope ------------------------------------------------

test("isInScope: pre-existing scopes are unchanged (this WI may only ADD coverage)", () => {
  assert.equal(isInScope(path.join(APP_ROOT, "renderer/screens/listMatters.ts")), true);
  assert.equal(isInScope(path.join(APP_ROOT, "renderer/index.css")), true);
  assert.equal(isInScope(path.join(REPO_ROOT, "services/case-box-persistence/src/index.ts")), true);
  assert.equal(isInScope(path.join(APP_ROOT, "renderer/fonts/noto-sans-sc-400.woff2")), false);
  // Self-exemptions must survive: the gate's own script + test legitimately carry patterns.
  assert.equal(isInScope(path.join(APP_ROOT, "scripts/check-no-real-data.mjs")), false);
  assert.equal(isInScope(path.join(APP_ROOT, "tests/check-no-real-data.test.mjs")), false);
});

test("isInScope: contract fixtures are now scanned (both contract packages)", () => {
  // Previously missed entirely — no "case-box" substring in the path.
  assert.equal(isInScope(path.join(REPO_ROOT, "docs/contracts/fixtures/valid/submission-inline.json")), true);
  assert.equal(isInScope(path.join(REPO_ROOT, "docs/contracts/fixtures/invalid/retry-violation.json")), true);
  assert.equal(
    isInScope(path.join(REPO_ROOT, "docs/contracts/case-box-contract/fixtures/valid/party.valid.json")),
    true,
  );
});

test("isInScope: the widened fixture scope does not pull in vendored node_modules fixtures", () => {
  assert.equal(
    isInScope(path.join(REPO_ROOT, "docs/contracts/node_modules/json-schema-traverse/spec/fixtures/x.json")),
    false,
  );
  // Pre-existing behaviour, NOT introduced here and NOT narrowed here: the original
  // /casebox|case-box|caseBox/i hint already matched every path containing "case-box",
  // including that package's node_modules. Verified against HEAD before this WI. Narrowing
  // it would weaken the gate, which this WI may not do.
  assert.equal(
    isInScope(path.join(REPO_ROOT, "docs/contracts/case-box-contract/node_modules/fast-uri/test/fixtures/y.json")),
    true,
  );
  // The provenance allowlist, however, must never treat vendored data as our sample data.
  assert.equal(
    isFixtureJson(path.join(REPO_ROOT, "docs/contracts/case-box-contract/node_modules/fast-uri/test/fixtures/y.json")),
    false,
  );
});

test("isInScope: desktop test data (golden fixtures + inline goldens) is now scanned", () => {
  assert.equal(isInScope(path.join(APP_ROOT, "tests/fixtures/a10-golden-canonical-export.json")), true);
  // The five-week leak lived in an inline golden string inside a *.unit.test.mjs, not under
  // tests/fixtures/ — scoping the directory is what actually covers that vector.
  assert.equal(isInScope(path.join(APP_ROOT, "tests/t3-catalog-model.unit.test.mjs")), true);
  assert.equal(isInScope(path.join(APP_ROOT, "tests/renderer-api.test.mjs")), true);
});

// --- WI-GATE-PROVENANCE: fixture party-name provenance --------------------------------

test("PARTY_NAME_FIELDS covers the contract's only party-label field", () => {
  assert.ok(PARTY_NAME_FIELDS.has("display_name"));
  // Guard against over-reach: `name` is a matter title / OCR engine id, not a party label.
  assert.ok(!PARTY_NAME_FIELDS.has("name"));
});

test("isFixtureJson: only JSON under the fixture roots qualifies", () => {
  assert.equal(isFixtureJson(path.join(REPO_ROOT, "docs/contracts/fixtures/valid/submission-inline.json")), true);
  assert.equal(
    isFixtureJson(path.join(REPO_ROOT, "docs/contracts/case-box-contract/fixtures/invalid/party-bad-role.json")),
    true,
  );
  assert.equal(isFixtureJson(path.join(APP_ROOT, "tests/fixtures/a10-golden-canonical-export.json")), true);
  // Not fixtures:
  assert.equal(isFixtureJson(path.join(APP_ROOT, "package.json")), false);
  assert.equal(isFixtureJson(path.join(APP_ROOT, "tests/t3-catalog-model.unit.test.mjs")), false);
  assert.equal(
    isFixtureJson(path.join(REPO_ROOT, "docs/contracts/case-box-contract/schemas/case-box-party.schema.json")),
    false,
  );
  assert.equal(
    isFixtureJson(path.join(REPO_ROOT, "docs/contracts/node_modules/fast-uri/test/fixtures/y.json")),
    false,
  );
});

test("isApprovedFictionalPartyName accepts the seeded allowlist and its prefixed families", () => {
  for (const ok of APPROVED_FICTIONAL_PARTY_NAMES) {
    assert.ok(isApprovedFictionalPartyName(ok), `${ok} should be approved`);
  }
  for (const ok of ["张三", "李四", "ACME Corp", "Acme Demonstration LLC", "Counterparty Ltd", "示例建设有限公司"]) {
    assert.ok(isApprovedFictionalPartyName(ok), `${ok} should be approved`);
  }
});

test("isApprovedFictionalPartyName rejects anything not on the allowlist", () => {
  for (const bad of ["王大锤", "Zhang Wei", "北京某某科技有限公司", "J. Smith", "Corp ACME", "建设示例有限公司"]) {
    assert.equal(isApprovedFictionalPartyName(bad), false, `${bad} must not be approved`);
  }
});

test("scanFixtureProvenance passes an allowlisted party name", () => {
  const text = JSON.stringify({ role: "client", display_name: "张三", party_kind: "individual" }, null, 2);
  assert.deepEqual(scanFixtureProvenance(text, "docs/contracts/x/fixtures/valid/p.json"), []);
});

test("scanFixtureProvenance fails a non-allowlisted party name and names file/field/value/remedy", () => {
  const text = JSON.stringify({ role: "client", display_name: "王大锤", party_kind: "individual" }, null, 2);
  const hits = scanFixtureProvenance(text, "docs/contracts/x/fixtures/valid/p.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-allowlisted");
  assert.equal(hits[0].file, "docs/contracts/x/fixtures/valid/p.json");
  assert.equal(hits[0].field, "display_name");
  assert.equal(hits[0].match, "王大锤");
  assert.ok(hits[0].line >= 1);
  assert.match(hits[0].hint, /APPROVED_FICTIONAL_PARTY_NAMES/);
});

test("scanFixtureProvenance walks nested parties[] arrays, not just the top level", () => {
  const text = JSON.stringify(
    {
      name: "Test Matter — Sample Litigation",
      parties: [
        { role: "client", display_name: "ACME Corp", party_kind: "organization" },
        { role: "opposing", display_name: "某某实业股份有限公司", party_kind: "organization" },
      ],
    },
    null,
    2,
  );
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, "某某实业股份有限公司");
});

test("scanFixtureProvenance fails closed when a fixture cannot be parsed", () => {
  const hits = scanFixtureProvenance("{ not json", "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "fixture-unparseable");
});

test("scanFixtureProvenance: the dev-memo exemption marker cannot bypass a fixture", () => {
  const text = JSON.stringify({ display_name: `王大锤 ${DOC_EXEMPT_MARKER}` }, null, 2);
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-allowlisted");
});

test("scanFile runs the provenance check end-to-end on a real contract fixture", () => {
  const f = path.join(REPO_ROOT, "docs/contracts/case-box-contract/fixtures/valid/matter.valid.json");
  assert.deepEqual(scanFile(f), []);
});

// --- WI-GATE-M1: party-label fields are evaluated by KEY, never by value type -----------
//
// Defect (M1): the collector only evaluated `display_name` when `typeof value === "string"`,
// so a parseable-but-malformed fixture silently bypassed the whole allowlist — the recursive
// walk descended into the wrapper and the key association was lost. A real name in a
// non-string `display_name` passed the gate. The gate documents itself as failing closed on
// UNPARSEABLE JSON; it must equally fail closed on parseable-malformed JSON, because it is a
// privacy control that has to stand on its own, not a schema check.

const NON_ALLOWLISTED = "王大锤";

test("scanFixtureProvenance FAILS an object-wrapped display_name (M1 bypass)", () => {
  const text = JSON.stringify({ role: "client", display_name: { value: NON_ALLOWLISTED } }, null, 2);
  const hits = scanFixtureProvenance(text, "docs/contracts/x/fixtures/valid/p.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-a-string");
  assert.equal(hits[0].field, "display_name");
  assert.equal(hits[0].jsonType, "object");
  assert.equal(hits[0].file, "docs/contracts/x/fixtures/valid/p.json");
  assert.ok(hits[0].line >= 1);
  assert.match(hits[0].hint, /string/i);
});

test("scanFixtureProvenance FAILS an array-wrapped display_name (M1 bypass)", () => {
  const text = JSON.stringify({ role: "client", display_name: [NON_ALLOWLISTED] }, null, 2);
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-a-string");
  assert.equal(hits[0].jsonType, "array");
});

test("scanFixtureProvenance FAILS a numeric display_name (M1 bypass)", () => {
  const text = JSON.stringify({ role: "client", display_name: 12345 }, null, 2);
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-a-string");
  assert.equal(hits[0].jsonType, "number");
});

test("scanFixtureProvenance FAILS a null display_name (M1 bypass)", () => {
  const text = JSON.stringify({ role: "client", display_name: null }, null, 2);
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-a-string");
  assert.equal(hits[0].jsonType, "null");
});

test("scanFixtureProvenance FAILS a boolean display_name (M1 bypass)", () => {
  const text = JSON.stringify({ role: "client", display_name: true }, null, 2);
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-a-string");
  assert.equal(hits[0].jsonType, "boolean");
});

test("scanFixtureProvenance FAILS an object-wrapped name nested in matter.parties[]", () => {
  const text = JSON.stringify(
    {
      name: "Test Matter — Sample Litigation",
      parties: [
        { role: "client", display_name: "ACME Corp", party_kind: "organization" },
        { role: "opposing", display_name: { value: NON_ALLOWLISTED }, party_kind: "organization" },
      ],
    },
    null,
    2,
  );
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "party-name-not-a-string");
  assert.equal(hits[0].field, "display_name");
  assert.equal(hits[0].jsonType, "object");
});

test("the non-string hit reports the JSON type, never a coerced/stringified value", () => {
  const text = JSON.stringify({ display_name: { value: NON_ALLOWLISTED } }, null, 2);
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 1);
  // The offending value must not be coerced into the report — no "[object Object]", and the
  // wrapped name must not be echoed into CI logs by the type failure itself.
  const serialised = JSON.stringify(hits[0]);
  assert.ok(!serialised.includes("[object Object]"), "must not stringify the value");
  assert.ok(!serialised.includes(NON_ALLOWLISTED), "type failure must not echo the wrapped value");
});

test("evaluating by key does NOT lose the existing nested-recursion coverage", () => {
  // An object-wrapped display_name whose wrapper itself carries a nested display_name string
  // must produce BOTH: the type failure on the outer key AND the allowlist failure on the
  // inner string. Recursion is preserved, not traded away for the key check.
  const text = JSON.stringify({ display_name: { display_name: NON_ALLOWLISTED } }, null, 2);
  const hits = scanFixtureProvenance(text, "f.json");
  assert.equal(hits.length, 2);
  assert.ok(hits.some((h) => h.pattern === "party-name-not-a-string" && h.jsonType === "object"));
  assert.ok(hits.some((h) => h.pattern === "party-name-not-allowlisted" && h.match === NON_ALLOWLISTED));
});

test("allowlisted plain-string display_names still pass (no regression from the M1 fix)", () => {
  for (const ok of APPROVED_FICTIONAL_PARTY_NAMES) {
    const text = JSON.stringify({ role: "client", display_name: ok, party_kind: "individual" }, null, 2);
    assert.deepEqual(scanFixtureProvenance(text, "f.json"), [], `${ok} must still pass`);
  }
  const nested = JSON.stringify(
    {
      parties: [
        { role: "client", display_name: "ACME Corp", party_kind: "organization" },
        { role: "opposing", display_name: "Counterparty Ltd", party_kind: "organization" },
      ],
    },
    null,
    2,
  );
  assert.deepEqual(scanFixtureProvenance(nested, "f.json"), []);
});

test("isApprovedFictionalPartyName never approves a non-string (defense in depth)", () => {
  for (const bad of [{ value: "张三" }, ["张三"], 12345, null, true]) {
    assert.equal(isApprovedFictionalPartyName(bad), false, `${JSON.stringify(bad)} must not be approved`);
  }
});

// --- WI-GATE-L1: the 示例 prefix pattern is tightened to the recorded synthetic form ------

test("示例 pattern: the form the repo actually carries still passes", () => {
  // 示例建设有限公司 — dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md §"Intro". This is the ONLY
  // 示例-prefixed party/organisation label present anywhere in the repo.
  assert.equal(isApprovedFictionalPartyName("示例建设有限公司"), true);
});

test("示例 pattern: names the OLD loose /^示例./ admitted are now rejected", () => {
  const OLD_LOOSE = /^示例./; // the pre-fix pattern, reconstructed to prove the tightening bites
  const nowRejected = [
    "示例王大锤", // synthetic prefix glued onto a personal name
    "示例建设有限公司（法定代表人：王大锤）", // real name appended after a synthetic org
    "示例建设有限公司 王大锤",
    "示例民初0001号", // a case number, not a party label
    "示例-证据目录及说明-一审.pdf", // a document filename, not a party label
    "示例科技", // no company-form suffix; unrecorded
  ];
  for (const v of nowRejected) {
    assert.ok(OLD_LOOSE.test(v), `precondition: old regex admitted ${v}`);
    assert.equal(isApprovedFictionalPartyName(v), false, `${v} must no longer be approved`);
  }
});

test("示例 pattern: a bare 示例 is still not a name (pre-existing behaviour kept)", () => {
  assert.equal(isApprovedFictionalPartyName("示例"), false);
  assert.equal(isApprovedFictionalPartyName("建设示例有限公司"), false); // prefix-anchored, not substring
});

test("ACME / Counterparty families are untouched by the 示例 tightening", () => {
  for (const ok of ["ACME Corp", "ACME Corporation", "Acme Demonstration LLC", "Counterparty Ltd", "Counterparty Holdings"]) {
    assert.equal(isApprovedFictionalPartyName(ok), true, `${ok} must stay approved`);
  }
  for (const bad of ["Corp ACME", "The Counterparty"]) {
    assert.equal(isApprovedFictionalPartyName(bad), false, `${bad} must stay rejected`);
  }
});

// --- WI-GATE-FULLSCAN: standing full-scan mode (`--all`) --------------------------------
//
// The gate has always been DIFF-SCOPED: with git changes present it scans only the changed
// files, so a real identifier sitting dormant in a file nobody touches is never re-checked.
// That is not hypothetical — real client identifiers sat in this repo's fixtures and tests for
// five weeks (scrubbed in f86c8e4) precisely because the gate only ever looked at diffs.
// `--all` makes the checks a standing invariant. The diff-scoped path remains the DEFAULT.

const SCRIPT = path.join(APP_ROOT, "scripts/check-no-real-data.mjs");

function runScanner(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function gitLines(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean)
    .map((rel) => path.resolve(REPO_ROOT, rel));
}

test("--all resolves the full corpus, not a diff — non-zero in-scope file count", () => {
  const { mode, files } = resolveScanFiles(["--all"]);
  assert.equal(mode, "full");
  const inScope = files.filter(isInScope);
  // The exact blind spot being fixed: diff mode reports "0 file(s)" when nothing changed.
  // A full scan that resolves nothing has not verified the invariant, it has only failed to look.
  assert.ok(inScope.length > 100, `expected the whole in-scope corpus; got ${inScope.length}`);
});

test("--all is a strict SUPERSET of whatever the default mode would scan", () => {
  const full = new Set(resolveScanFiles(["--all"]).files);
  const dflt = resolveScanFiles([]);
  assert.notEqual(dflt.mode, "full", "the default must never be the full scan");
  for (const f of dflt.files) {
    assert.ok(full.has(f), `default-mode file missing from the full scan: ${f}`);
  }
});

test("--all reaches dormant tracked files the default mode cannot see", () => {
  // Dynamically chosen so the assertion cannot rot: a TRACKED, in-scope file that git reports
  // as unchanged AND that lies outside the roots the no-change sweep walks. Both default
  // branches (diff scan and no-change sweep) miss it; the full scan must not.
  const changed = new Set([
    ...gitLines("git diff --cached --name-only --diff-filter=ACMR"),
    ...gitLines("git diff --name-only --diff-filter=ACMR"),
    ...gitLines("git ls-files --others --exclude-standard"),
  ]);
  // Imported, not duplicated — this line previously hard-coded docs/contracts and went
  // stale the moment production widened to docs.
  const sweepRoots = SWEEP_ROOTS;
  const dormant = gitLines("git ls-files")
    .filter(isInScope)
    .filter((f) => !changed.has(f))
    .filter((f) => !sweepRoots.some((r) => f.startsWith(`${r}${path.sep}`)));
  assert.ok(dormant.length > 0, "expected tracked in-scope files outside the sweep roots (services/case-box-*)");

  const full = new Set(resolveScanFiles(["--all"]).files);
  const dflt = new Set(resolveScanFiles([]).files);
  for (const f of dormant) {
    assert.ok(full.has(f), `full scan must cover dormant tracked file ${f}`);
    assert.ok(!dflt.has(f), `default mode must stay diff-scoped; it should not see ${f}`);
  }
});

test("default (no flag) still diff-scopes: exactly the git-changed set, or the sweep when clean", () => {
  const changed = [
    ...gitLines("git diff --cached --name-only --diff-filter=ACMR"),
    ...gitLines("git diff --name-only --diff-filter=ACMR"),
    ...gitLines("git ls-files --others --exclude-standard"),
  ];
  const { mode, files } = resolveScanFiles([]);
  if (changed.length > 0) {
    assert.equal(mode, "diff");
    assert.deepEqual(new Set(files), new Set(changed));
  } else {
    assert.equal(mode, "sweep");
  }
});

test("explicit path arguments are unchanged by the flag parsing", () => {
  const { mode, files } = resolveScanFiles(["apps/lawbar-desktop/renderer/index.css"]);
  assert.equal(mode, "explicit");
  assert.deepEqual(files, [path.join(REPO_ROOT, "apps/lawbar-desktop/renderer/index.css")]);
});

test("--all CLI exits 0 on the clean corpus and reports a non-zero file count", () => {
  const r = runScanner(["--all"]);
  assert.equal(r.status, 0, `full scan failed:\n${r.stdout}\n${r.stderr}`);
  const m = /OK — (\d+) file\(s\)/.exec(r.stdout);
  assert.ok(m, `expected an OK line with a file count; got: ${JSON.stringify(r.stdout)}`);
  assert.ok(Number(m[1]) > 100, `full scan reported only ${m[1]} file(s)`);
  assert.match(r.stdout, /mode=full/);
});

test("--all CLI FAILS on a violation planted in a real fixture directory", () => {
  // Negative control at a REAL fixture path (not a tmpdir), because the point of the full scan
  // is that it re-checks repo content rather than only what a diff happens to contain.
  const planted = path.join(
    REPO_ROOT,
    "docs/contracts/case-box-contract/fixtures/valid/__fullscan-negative-control.json",
  );
  writeFileSync(
    planted,
    JSON.stringify({ role: "client", display_name: "王大锤", party_kind: "individual" }, null, 2),
    "utf8",
  );
  try {
    const r = runScanner(["--all"]);
    assert.equal(r.status, 1, `planted violation must fail the full scan; stdout=${r.stdout}`);
    assert.match(r.stderr, /__fullscan-negative-control\.json/);
    assert.match(r.stderr, /party-name-not-allowlisted/);
  } finally {
    rmSync(planted, { force: true });
  }
});

test("an unrecognised flag is a usage error, never silently resolved as a path", () => {
  // A typo such as `--all-files` must not resolve to a nonexistent file and then "pass"
  // having scanned nothing.
  assert.equal(resolveScanFiles(["--all-files"]).mode, "usage-error");
  const r = runScanner(["--all-files"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown option/);
});

test("--all combined with explicit paths is a usage error (ambiguous scope)", () => {
  assert.equal(resolveScanFiles(["--all", "apps/lawbar-desktop/renderer/index.css"]).mode, "usage-error");
  const r = runScanner(["--all", "apps/lawbar-desktop/renderer/index.css"]);
  assert.equal(r.status, 1);
});

test("every tracked contract + desktop fixture passes the provenance allowlist", () => {
  const roots = [
    path.join(REPO_ROOT, "docs/contracts/fixtures"),
    path.join(REPO_ROOT, "docs/contracts/case-box-contract/fixtures"),
    path.join(APP_ROOT, "tests/fixtures"),
  ];
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  for (const r of roots) walk(r);
  assert.ok(files.length > 100, "expected the fixture corpus to be non-trivial");
  const hits = files.flatMap((f) => scanFile(f));
  assert.deepEqual(hits, [], `fixture corpus must be clean; got ${JSON.stringify(hits)}`);
});

// ---------------------------------------------------------------------------
// Documentation scope (added 2026-08-22 after an NL audit).
//
// 99 markdown files — every product, ADR, release and UI document — were outside
// this gate in a repository with documented client identifiers in its git history.
// They were clean when checked, but unguarded is not the same as clean.
//
// Closing it needed TWO changes, and the first alone was inert: adding docs/ to
// SWEEP_ROOTS only widens the candidate set, while isInScope() still requires a
// SCOPE_HINTS match on the relative path. The full-scan count staying at exactly
// 533 after the root was widened is what exposed the no-op. These cases pin both
// halves so a future narrowing of either is loud.
// ---------------------------------------------------------------------------

test("docs scope: product, ADR, release and UI documents are all in scope", () => {
  for (const rel of [
    "docs/product/product-plan.md",
    "docs/product/product-definition.md",
    "docs/adr/docket-proposal-edit.md",
    "docs/release/operator-checklist.md",
    "docs/ui/current-ui-map.md",
    "docs/development-workflow.md",
  ]) {
    assert.equal(
      isInScope(path.join(REPO_ROOT, rel)),
      true,
      `${rel} must be scanned for client identifiers`,
    );
  }
});

test("docs scope: the widened root scans MORE files, and none of them are vendored", () => {
  // Asserted against the real swept list, not isInScope(). That distinction cost a
  // wrong test: isInScope() has no node_modules rule and never did — a vendored path
  // containing "case-box" matches the FIRST scope hint regardless. The protection is
  // SKIP_DIRS inside collectRecursive, at traversal time, so traversal is where it
  // has to be asserted.
  const { files } = resolveScanFiles(["--all"]);
  const rel = files.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join("/"));

  const vendored = rel.filter((f) => f.includes("node_modules/"));
  assert.deepEqual(vendored, [], "no vendored file may be swept");

  // The widening is real: product/ADR/release/UI documents are now actually scanned.
  for (const must of [
    "docs/product/product-plan.md",
    "docs/adr/docket-proposal-edit.md",
    "docs/release/operator-checklist.md",
    "docs/ui/current-ui-map.md",
  ]) {
    assert.ok(rel.includes(must), `${must} must be in the swept set`);
  }
  // Guards against a silent narrowing back to the pre-2026-08-22 scope, which covered
  // 533 files. The exact number will drift as docs are added; the floor will not.
  assert.ok(rel.length > 600, `expected >600 swept files, got ${rel.length}`);

  // HONEST LIMIT: --all unions `git ls-files` with the sweep, so this pins SCOPE_HINTS,
  // not SWEEP_ROOTS. A tracked doc appears here even if the root were narrowed again.
  // SWEEP_ROOTS matters only for UNTRACKED docs, and is pinned by membership below.
  assert.ok(
    SWEEP_ROOTS.some((r) => r.endsWith(`${path.sep}docs`)),
    "docs must remain a sweep root, or an uncommitted draft holding real data is invisible",
  );
});

test("docs scope: a file merely NAMED node_modules-* is scanned, not skipped", () => {
  // Regression for a false negative introduced 2026-08-22 and caught by an external audit:
  // the first fix excluded any path CONTAINING the substring `node_modules`, so a genuine
  // document called `node_modules-client-notes.md` silently escaped the real-data guard.
  // The rule is now segment-anchored.
  for (const rel of [
    "docs/product/node_modules-client-notes.md",
    "docs/release/notes-about-node_modules.md",
  ]) {
    assert.equal(isInScope(path.join(REPO_ROOT, rel)), true, `${rel} must be scanned`);
  }
  // Vendored under docs/ and claimed by NO other hint -> out.
  assert.equal(
    isInScope(path.join(REPO_ROOT, "docs/contracts/node_modules/some-pkg/README.md")),
    false,
    "a vendored segment under docs/ is not ours to police",
  );
  // But vendored under a case-box path stays IN, because the casebox hint claims it and
  // the repo has decided narrowing that would weaken the gate. Asserted here so this
  // regression test cannot be read as licence to exclude it.
  assert.equal(
    isInScope(path.join(REPO_ROOT, "docs/contracts/case-box-contract/node_modules/x/README.md")),
    true,
    "deliberate: the casebox hint keeps this in scope",
  );
});

// ---------------------------------------------------------------------------
// Every test file must be reachable by SOME runner.
//
// `scripts.test` is a hand-maintained list of 60+ filenames. Two files sat on disk
// for months in no runner at all — `document-storage.unit.test.mjs` (4 tests) and
// `wrapper.test.mjs` (31 tests) — both passing the whole time. That is the
// "looks like coverage, provides none" hazard named in CLAUDE.md, and nothing
// structural prevented it recurring.
//
// This guard was proposed once before and deferred, precisely because it would
// have failed on those two files. Registering them removed the blocker.
//
// Reachability is COMPUTED wherever possible rather than listed, so the guard
// cannot go stale: a file counts as reachable if it appears anywhere in
// package.json's scripts (which covers the LAWBAR_TEST_FILES-driven suites), or
// if it is an `_`-prefixed fixture consumed by another test. Only genuinely
// special cases need an entry below, and each must carry a reason.
// ---------------------------------------------------------------------------

const RUNNER_EXEMPT = new Map([
  ["tests/smoke.packaged.electron.test.mjs",
   "default test file of scripts/test-packaged-wrapper.mjs (line 58); run by npm run test:packaged. Needs a packaged .app from npm run dist."],
  ["tests/verify-macos-signing.real-bundle.test.mjs",
   "opt-in behind LAWBAR_SIGNING_REAL_BUNDLE=1; bound to the release-signing-real-bundle lane in .claude/tdd-guardian/config.json. spctl/stapler may hit the network, so it must stay out of the push gate."],
]);

test("every test file is reachable by some runner, or exempt with a stated reason", () => {
  const manifest = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
  const allScripts = Object.values(manifest.scripts).join(" ");
  const onDisk = readdirSync(path.join(APP_ROOT, "tests"))
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => `tests/${f}`);

  const unreachable = onDisk.filter((rel) => {
    if (path.basename(rel).startsWith("_")) return false;   // fixture consumed by another test
    if (allScripts.includes(rel)) return false;             // named by some npm script
    return !RUNNER_EXEMPT.has(rel);
  });

  assert.deepEqual(
    unreachable,
    [],
    `these test files are in no runner and have no stated exemption:\n  ${unreachable.join("\n  ")}`,
  );
});

test("every runner exemption names a file that still exists", () => {
  // An exemption for a deleted file is a stale reason that makes the list look
  // considered when it is not.
  for (const [rel, reason] of RUNNER_EXEMPT) {
    assert.ok(existsSync(path.join(APP_ROOT, rel)), `exempt file is gone: ${rel}`);
    assert.ok(reason.length > 40, `exemption for ${rel} needs a real reason, got: ${reason}`);
  }
});
