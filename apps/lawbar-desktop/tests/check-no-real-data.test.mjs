import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanFile, isInScope, isBinaryAsset, PATTERNS } from "../scripts/check-no-real-data.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // apps/lawbar-desktop

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
