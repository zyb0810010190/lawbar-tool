// C3 regression guard for the type-layer slice closed by ADR-11A.5 follow-up.
//
// Rule: production source under services/ocr-worker/src/ MUST NOT import any
// TYPE from "ocr-worker-contract/testing". Value imports (specifically
// `processFakeOcrJob`) remain allowed for now — the fake worker is still the
// default in cli.ts pending the production-default replacement in ADR-11C.
//
// Why this exists: ADR-11A.0 §11 records the broader C3 invariant
// (production source should not depend on /testing). The type-layer slice
// closes when the OcrWorker interface returns OcrJobOutcome, not
// FakeJobOutcome. Without this guard, a future edit could silently
// re-introduce a `import type { ... } from "ocr-worker-contract/testing"`
// line and re-open the slice.
//
// Detection rules:
//
//   FORBIDDEN (the rule rejects all of these):
//     import type { X } from "ocr-worker-contract/testing";
//     import { value, type X } from "ocr-worker-contract/testing";
//     export type { X } from "ocr-worker-contract/testing";
//     export { type X } from "ocr-worker-contract/testing";
//     import * as T from "ocr-worker-contract/testing";    // namespace
//                                                          //   — rejected
//                                                          //   conservatively
//                                                          //   because we
//                                                          //   cannot tell
//                                                          //   without AST
//                                                          //   whether T.X
//                                                          //   is used as a
//                                                          //   type.
//
//   ALLOWED (value-only imports — single explicit allowlist):
//     import { processFakeOcrJob } from "ocr-worker-contract/testing";
//
//   ALLOWED (no contact with /testing at all): all other lines.
//
// To extend the allowlist in 11C, add to ALLOWED_VALUE_IMPORT_PATTERNS below
// and document the rationale in the comment block above.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");
const repoRoot = join(here, "..", "..", "..");

const TESTING_SPECIFIER = "ocr-worker-contract/testing";

// Exact source lines that are allowed to import from the testing subpath.
// Each allowed line must be a value-only import (no `type` keyword anywhere
// in the binding list). Normalize whitespace before comparing.
const ALLOWED_VALUE_IMPORT_LINES = new Set([
  `import { processFakeOcrJob } from "${TESTING_SPECIFIER}";`,
]);

const norm = (s) => s.replace(/\s+/g, " ").trim();

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

test("c3 boundary: no production source under services/ocr-worker/src imports a TYPE from ocr-worker-contract/testing", () => {
  const violations = [];

  for (const file of walkTsFiles(srcRoot)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes(TESTING_SPECIFIER)) continue;

    // Process import/export statements line by line. TS imports may span
    // multiple physical lines; collapse continuations by joining until the
    // next `;`.
    const lines = source.split(/\r?\n/);
    let buffer = "";
    let bufferStart = 0;
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (
        buffer === "" &&
        !trimmed.startsWith("import") &&
        !trimmed.startsWith("export")
      ) {
        return;
      }
      if (buffer === "") bufferStart = idx + 1;
      buffer += " " + line;
      if (trimmed.endsWith(";")) {
        if (buffer.includes(TESTING_SPECIFIER)) {
          checkStatement(file, bufferStart, buffer, violations);
        }
        buffer = "";
      }
    });
  }

  if (violations.length > 0) {
    const msg = violations
      .map((v) => `  ${relative(repoRoot, v.file)}:${v.line}: ${v.reason}\n      ${v.snippet}`)
      .join("\n");
    assert.fail(
      `c3 boundary violation(s) found:\n${msg}\n\n` +
        `Production source under services/ocr-worker/src/ must not import a TYPE ` +
        `from "${TESTING_SPECIFIER}". Allowed value-only imports are listed in ` +
        `tests/c3-boundary.test.mjs (ALLOWED_VALUE_IMPORT_LINES).`,
    );
  }
});

function checkStatement(file, line, statement, violations) {
  const normalized = norm(statement);
  const snippet = normalized.length > 200 ? normalized.slice(0, 200) + "…" : normalized;

  // 1. import-type / export-type — flat reject.
  if (/\bimport\s+type\b/.test(normalized)) {
    violations.push({ file, line, snippet, reason: "import type from /testing forbidden" });
    return;
  }
  if (/\bexport\s+type\b/.test(normalized)) {
    violations.push({ file, line, snippet, reason: "export type from /testing forbidden" });
    return;
  }

  // 2. Mixed bindings containing `type X` inside the brace list.
  // Match `{ ... type X ... }` where `type` is a binding keyword.
  if (/\{[^}]*\btype\s+[A-Za-z_$]/.test(normalized)) {
    violations.push({ file, line, snippet, reason: "mixed value+type import from /testing forbidden" });
    return;
  }

  // 3. Namespace import (`import * as T`). Rejected conservatively because
  //    a regex check cannot prove T is never used as a type without an AST.
  if (/\bimport\s+\*\s+as\s+/.test(normalized)) {
    violations.push({ file, line, snippet, reason: "namespace import from /testing forbidden (cannot prove type-free use)" });
    return;
  }

  // 4. Re-export of values (e.g. `export { foo } from "/testing";`).
  //    Treat any export-from-/testing as forbidden — production source
  //    should not be re-exposing the testing seam.
  if (/^export\s*\{/.test(normalized)) {
    violations.push({ file, line, snippet, reason: "re-export from /testing forbidden" });
    return;
  }

  // 5. Pure value import — must be on the explicit allowlist.
  if (!ALLOWED_VALUE_IMPORT_LINES.has(normalized)) {
    violations.push({
      file,
      line,
      snippet,
      reason: `value import from /testing not on the allowlist (add to ALLOWED_VALUE_IMPORT_LINES if intentional)`,
    });
  }
}
