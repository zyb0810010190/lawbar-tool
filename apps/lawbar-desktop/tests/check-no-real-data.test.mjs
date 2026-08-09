import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanFile,
  scanContent,
  scanFixtureProvenance,
  isInScope,
  isBinaryAsset,
  isDetectorDoc,
  isFixtureJson,
  isApprovedFictionalPartyName,
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
