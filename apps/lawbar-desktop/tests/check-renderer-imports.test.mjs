import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkFile, classify, isForbiddenPackageSpecifier, isValueImportForbidden } from "../scripts/check-renderer-imports.mjs";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "lawbar-lint-"));
}

function withFile(content, fname = "renderer.ts") {
  const dir = tempDir();
  const full = path.join(dir, fname);
  writeFileSync(full, content, "utf8");
  return { dir, full };
}

test("isForbiddenPackageSpecifier flags contract §9 packages", () => {
  for (const spec of ["electron", "fs", "fs/promises", "path", "os", "child_process", "better-sqlite3", "better-sqlite3-multiple-ciphers", "case-box-persistence"]) {
    assert.equal(isForbiddenPackageSpecifier(spec).hit, true, spec);
  }
  for (const spec of ["node:fs", "node:path", "electron/main", "case-box-persistence/sqlite", "services/ocr-worker"]) {
    assert.equal(isForbiddenPackageSpecifier(spec).hit, true, spec);
  }
  for (const spec of ["case-box-contract", "react", "../theme/tokens.js"]) {
    assert.equal(isForbiddenPackageSpecifier(spec).hit, false, spec);
  }
});

test("isValueImportForbidden flags case-box-contract value imports", () => {
  assert.equal(isValueImportForbidden("case-box-contract"), true);
  assert.equal(isValueImportForbidden("case-box-contract/validateMatter"), true);
  assert.equal(isValueImportForbidden("react"), false);
});

test("type-only import from case-box-contract is allowed", () => {
  const { full } = withFile(`import type { CaseBoxMatter } from "case-box-contract";\nexport const x = 1;\n`);
  assert.deepEqual(checkFile(full), []);
});

test("inline type import `import { type X }` is allowed", () => {
  const { full } = withFile(`import { type CaseBoxMatter } from "case-box-contract";\nexport const x = 1;\n`);
  assert.deepEqual(checkFile(full), []);
});

test("all-type inline imports `import { type A, type B }` is allowed", () => {
  const { full } = withFile(`import { type CaseBoxMatter, type CaseBoxParty } from "case-box-contract";\nexport const x = 1;\n`);
  assert.deepEqual(checkFile(full), []);
});

test("mixed inline type + value import `import { type X, y }` is REJECTED", () => {
  const { full } = withFile(`import { type CaseBoxMatter, validateMatter } from "case-box-contract";\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, "value-import-forbidden");
});

test("value import from case-box-contract is rejected", () => {
  const { full } = withFile(`import { validateMatter } from "case-box-contract";\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].form, "static");
  assert.equal(hits[0].reason, "value-import-forbidden");
});

test("static import of electron is rejected", () => {
  const { full } = withFile(`import { app } from "electron";\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, "package");
});

test("side-effect import is rejected", () => {
  const { full } = withFile(`import "better-sqlite3";\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].form, "side-effect");
});

test("export-from is rejected", () => {
  const { full } = withFile(`export * from "case-box-persistence";\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].form, "export-from");
});

test("dynamic import() is rejected", () => {
  const { full } = withFile(`async function f() { await import("node:fs"); }\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].form, "dynamic");
});

test("bare Node builtins (fs, path, os, child_process) are rejected", () => {
  for (const spec of ["fs", "path", "os", "child_process"]) {
    const { full } = withFile(`import x from ${JSON.stringify(spec)};\n`);
    const hits = checkFile(full);
    assert.equal(hits.length, 1, spec);
    assert.equal(hits[0].reason, "package", spec);
  }
});

test("better-sqlite3-multiple-ciphers is rejected", () => {
  const { full } = withFile(`import x from "better-sqlite3-multiple-ciphers";\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
});

test("services/ocr-* paths are rejected", () => {
  const { full } = withFile(`import x from "services/ocr-worker";\n`);
  const hits = checkFile(full);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, "package-prefix");
});

test("relative-internal path into electron/ is rejected", () => {
  const fakeRenderer = path.resolve(process.cwd(), "renderer/page.ts");
  const cls = classify("../electron/main.ts", fakeRenderer, false);
  assert.equal(cls, "relative-internal-forbidden");
});

test("relative-internal path into src/caseBox/ is rejected", () => {
  const fakeRenderer = path.resolve(process.cwd(), "renderer/x.ts");
  const cls = classify("../src/caseBox/dto.ts", fakeRenderer, true);
  assert.equal(cls, "relative-internal-forbidden");
});
