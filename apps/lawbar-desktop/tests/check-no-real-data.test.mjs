import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { scanFile, PATTERNS } from "../scripts/check-no-real-data.mjs";

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
