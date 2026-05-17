// C3 regression guard for the type-layer slice closed by ADR-11A.5 follow-up.
//
// Rule: production source under services/ocr-worker/src/ MUST NOT import any
// TYPE from "ocr-worker-contract/testing". Value imports (specifically
// `processFakeOcrJob`) remain allowed for now — the fake worker is still
// the default in cli.ts pending the production-default replacement in
// ADR-11C.
//
// Why this exists: ADR-11A.0 §11 records the broader C3 invariant
// (production source should not depend on /testing). The type-layer slice
// closes when the OcrWorker interface returns OcrJobOutcome, not
// FakeJobOutcome. Without this guard, a future edit could silently
// re-introduce a type-only import line and re-open the slice.
//
// Classification rules (operate on parsed TypeScript AST, NOT text):
//
//   FORBIDDEN (any of these → fail):
//     import type { X } from "...";              // top-level type-only
//     import { type X } from "...";              // type-only specifier
//     import { Y, type X } from "...";           // mixed value+type
//     import * as T from "...";                  // namespace (conservative —
//                                                //   AST cannot prove T is
//                                                //   never used as a type)
//     import T from "...";                       // default import
//     export ... from "...";                     // any re-export from the
//                                                //   /testing subpath
//
//   ALLOWED:
//     import { processFakeOcrJob } from "ocr-worker-contract/testing";
//
//   ALLOWED (no contact with /testing at all): anything else.
//
// To extend the allowlist in 11C, add to ALLOWED_VALUE_SPECIFIERS below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");
const repoRoot = join(here, "..", "..", "..");

const TESTING_SPECIFIER = "ocr-worker-contract/testing";

// Named value-imports that are allowed today. Semantic check, NOT text match —
// formatting changes (quotes, whitespace, semicolons) cannot trigger spurious
// failures.
const ALLOWED_VALUE_SPECIFIERS = new Set([
  "processFakeOcrJob",
]);

function* walkTsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      yield* walkTsFiles(path);
    } else if (name.endsWith(".ts")) {
      yield path;
    }
  }
}

/**
 * Classify a parsed ImportDeclaration or ExportDeclaration whose module
 * specifier is the testing subpath. Returns null if allowed, or a
 * `{ reason, snippet }` object if forbidden.
 */
function classifyStatement(node, source) {
  const printer = (n) => source.slice(n.getStart(), n.getEnd()).replace(/\s+/g, " ").trim();
  const snippet = printer(node);

  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) {
      // `import "..."` — side-effect-only. No symbols leak; treat as allowed
      // for now (we have no reason to forbid bare imports of /testing, and
      // the testing entry has no top-level side effects to begin with).
      return null;
    }
    if (clause.isTypeOnly) {
      return { reason: "`import type` from /testing forbidden", snippet };
    }
    if (clause.name) {
      return { reason: "default import from /testing forbidden", snippet };
    }
    const bindings = clause.namedBindings;
    if (!bindings) {
      return { reason: "unrecognized import shape from /testing", snippet };
    }
    if (ts.isNamespaceImport(bindings)) {
      return {
        reason: "namespace import from /testing forbidden (cannot prove type-free use)",
        snippet,
      };
    }
    // NamedImports — two-pass classification. First reject any type-only
    // specifier (covers `import { type X }` and `import { Y, type X }`).
    // Then check value imports against the allowlist.
    const specifiers = bindings.elements;
    for (const spec of specifiers) {
      if (spec.isTypeOnly) {
        return { reason: "mixed value+type import (type specifier) from /testing forbidden", snippet };
      }
    }
    for (const spec of specifiers) {
      const importedName = (spec.propertyName ?? spec.name).text;
      if (!ALLOWED_VALUE_SPECIFIERS.has(importedName)) {
        return {
          reason: `value import "${importedName}" from /testing not on the allowlist (add to ALLOWED_VALUE_SPECIFIERS if intentional)`,
          snippet,
        };
      }
    }
    return null;
  }

  if (ts.isExportDeclaration(node)) {
    // Any `export ... from "..."` against /testing is forbidden — production
    // source must not re-expose the testing seam.
    return { reason: "re-export from /testing forbidden", snippet };
  }

  return null;
}

function* importExportsFromTesting(sourceFile) {
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec) && spec.text === TESTING_SPECIFIER) {
        yield stmt;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test 1: the actual tree must not violate the boundary.
// ---------------------------------------------------------------------------

test("c3 boundary: no production source under services/ocr-worker/src imports a TYPE from ocr-worker-contract/testing", () => {
  const violations = [];

  for (const file of walkTsFiles(srcRoot)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes(TESTING_SPECIFIER)) continue;

    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const stmt of importExportsFromTesting(sf)) {
      const verdict = classifyStatement(stmt, source);
      if (verdict) {
        const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart());
        violations.push({ file, line: line + 1, ...verdict });
      }
    }
  }

  if (violations.length > 0) {
    const msg = violations
      .map((v) => `  ${relative(repoRoot, v.file)}:${v.line}: ${v.reason}\n      ${v.snippet}`)
      .join("\n");
    assert.fail(
      `c3 boundary violation(s) found:\n${msg}\n\n` +
        `Production source under services/ocr-worker/src/ must not import a TYPE ` +
        `from "${TESTING_SPECIFIER}". Allowed value-only imports are listed in ` +
        `tests/c3-boundary.test.mjs (ALLOWED_VALUE_SPECIFIERS).`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test 2: the classifier itself behaves as advertised.
//
// Table-driven self-tests so the guard's rule set is verified independently
// of whatever the current source tree happens to contain.
// ---------------------------------------------------------------------------

function classifySnippet(source) {
  const sf = ts.createSourceFile("synthetic.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const stmt of importExportsFromTesting(sf)) {
    const verdict = classifyStatement(stmt, source);
    if (verdict) return verdict;
  }
  return null; // allowed
}

const FORBIDDEN_CASES = [
  ["import type { X } from \"ocr-worker-contract/testing\";", /import type/],
  ["import { type X } from \"ocr-worker-contract/testing\";", /type specifier/],
  ["import { Y, type X } from \"ocr-worker-contract/testing\";", /type specifier/],
  ["import * as T from \"ocr-worker-contract/testing\";", /namespace import/],
  ["import T from \"ocr-worker-contract/testing\";", /default import/],
  ["import { someOtherValue } from \"ocr-worker-contract/testing\";", /not on the allowlist/],
  ["export { X } from \"ocr-worker-contract/testing\";", /re-export/],
  ["export type { X } from \"ocr-worker-contract/testing\";", /re-export/],
  ["export { type X } from \"ocr-worker-contract/testing\";", /re-export/],
  ["export * from \"ocr-worker-contract/testing\";", /re-export/],
];

for (const [source, reasonRegex] of FORBIDDEN_CASES) {
  test(`c3 boundary classifier rejects: ${source.replace(/"/g, "'")}`, () => {
    const verdict = classifySnippet(source);
    assert.ok(verdict, `expected rejection, but classifier returned allowed`);
    assert.match(
      verdict.reason,
      reasonRegex,
      `unexpected rejection reason: ${verdict.reason}`,
    );
  });
}

const ALLOWED_CASES = [
  // The single allowlisted value import.
  "import { processFakeOcrJob } from \"ocr-worker-contract/testing\";",
  // Other imports that don't touch /testing — classifier should ignore.
  "import { foo } from \"some-other-package\";",
  "import { x } from \"./local-module.js\";",
];

for (const source of ALLOWED_CASES) {
  test(`c3 boundary classifier allows: ${source.replace(/"/g, "'")}`, () => {
    const verdict = classifySnippet(source);
    assert.equal(verdict, null, `unexpected rejection: ${verdict?.reason}`);
  });
}

test("c3 boundary classifier handles multi-line imports correctly", () => {
  const source = `
import {
  processFakeOcrJob,
} from "ocr-worker-contract/testing";
`;
  assert.equal(classifySnippet(source), null);
});

test("c3 boundary classifier handles multi-line type imports correctly", () => {
  const source = `
import type {
  X,
  Y,
} from "ocr-worker-contract/testing";
`;
  const verdict = classifySnippet(source);
  assert.ok(verdict);
  assert.match(verdict.reason, /import type/);
});

test("c3 boundary classifier ignores comments containing the specifier", () => {
  const source = `
// This comment mentions "ocr-worker-contract/testing" but is not an import.
const x = 1;
`;
  assert.equal(classifySnippet(source), null);
});

test("c3 boundary classifier ignores string literals containing the specifier", () => {
  const source = `
const msg = "loaded from ocr-worker-contract/testing"; // not an import
`;
  assert.equal(classifySnippet(source), null);
});
