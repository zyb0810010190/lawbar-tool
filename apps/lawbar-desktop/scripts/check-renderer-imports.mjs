#!/usr/bin/env node
// Renderer-side forbidden-import lint per dev-memo/plan-casebox-ipc-impl-01.md
// rev-0.3 §12.1 + contract `9f9f79b` §9. Walks each renderer-scope .ts file
// via the TypeScript compiler API and rejects any forbidden import in any of
// 5 import forms (static, export-from, side-effect, dynamic-call, non-type).
// Exits 0 on clean; exits 1 with file+line+specifier+form listing on offender.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const FORBIDDEN_PACKAGE_EXACT = new Set([
  "electron",
  "better-sqlite3",
  "better-sqlite3-multiple-ciphers",
  "case-box-persistence",
  "fs",
  "fs/promises",
  "path",
  "os",
  "child_process",
]);

const FORBIDDEN_PACKAGE_PREFIX = [
  "electron/",
  "better-sqlite3/",
  "better-sqlite3-multiple-ciphers/",
  "case-box-persistence/",
  "node:",
  "services/ocr-",
];

const FORBIDDEN_RELATIVE_RESOLVED_PREFIX = [
  path.join(REPO_ROOT, "src", "caseBox"),
  path.join(REPO_ROOT, "electron"),
  path.resolve(REPO_ROOT, "..", "..", "services", "case-box-persistence", "src"),
];

const VALUE_IMPORT_FORBIDDEN_EXACT = new Set(["case-box-contract"]);
const VALUE_IMPORT_FORBIDDEN_PREFIX = ["case-box-contract/"];

function isForbiddenPackageSpecifier(spec) {
  if (FORBIDDEN_PACKAGE_EXACT.has(spec)) return { hit: true, reason: "package" };
  for (const p of FORBIDDEN_PACKAGE_PREFIX) {
    if (spec.startsWith(p)) return { hit: true, reason: "package-prefix" };
  }
  return { hit: false };
}

function isValueImportForbidden(spec) {
  if (VALUE_IMPORT_FORBIDDEN_EXACT.has(spec)) return true;
  for (const p of VALUE_IMPORT_FORBIDDEN_PREFIX) {
    if (spec.startsWith(p)) return true;
  }
  return false;
}

function isForbiddenRelative(spec, filePath) {
  if (!spec.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(filePath), spec);
  for (const root of FORBIDDEN_RELATIVE_RESOLVED_PREFIX) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

function isPositionInRange(pos, range) {
  return pos >= range.start && pos < range.end;
}

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...collectFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function checkFile(filePath, extraRanges = []) {
  const text = readFileSync(filePath, "utf8");
  const src = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const offenders = [];

  function add(node, spec, form, isTypeOnly) {
    const flagged = classify(spec, filePath, isTypeOnly);
    if (flagged === null) return;
    const { line, character } = src.getLineAndCharacterOfPosition(node.getStart(src));
    offenders.push({
      file: path.relative(REPO_ROOT, filePath),
      line: line + 1,
      column: character + 1,
      form,
      specifier: spec,
      reason: flagged,
    });
  }

  ts.forEachChild(src, function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec)) {
        const hasImportClause = node.importClause !== undefined;
        if (!hasImportClause) {
          add(node, spec.text, "side-effect", false);
        } else {
          const isTypeOnly = importIsAllTypeOnly(node.importClause);
          add(node, spec.text, "static", isTypeOnly);
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec)) {
        add(node, spec.text, "export-from", node.isTypeOnly === true);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteral(arg)) {
        add(node, arg.text, "dynamic", false);
      }
    }
    ts.forEachChild(node, visit);
  });

  return offenders.filter((o) => {
    if (extraRanges.length === 0) return true;
    const startPos = src.getPositionOfLineAndCharacter(o.line - 1, o.column - 1);
    return !extraRanges.some((r) => isPositionInRange(startPos, r));
  });
}

function classify(spec, filePath, isTypeOnly) {
  const pkg = isForbiddenPackageSpecifier(spec);
  if (pkg.hit) return pkg.reason;
  if (!isTypeOnly && isValueImportForbidden(spec)) return "value-import-forbidden";
  if (isForbiddenRelative(spec, filePath)) return "relative-internal-forbidden";
  return null;
}

// An import is considered type-only when EITHER the whole-clause `type`
// marker is present (`import type { X } from "..."`) OR every named
// binding carries the inline `type` qualifier (`import { type X, type Y }
// from "..."`). Default-import + namespace-import forms can be type-only
// ONLY via the whole-clause marker. Mixed value+type named imports
// (`import { type X, y } from "..."`) are NOT type-only because `y` is
// emitted at runtime.
function importIsAllTypeOnly(importClause) {
  if (importClause === undefined) return false;
  if (importClause.isTypeOnly === true) return true;
  // Default + namespace imports without whole-clause `type` are runtime imports.
  if (importClause.name !== undefined) return false;
  const named = importClause.namedBindings;
  if (named === undefined) return false;
  // Namespace import: `import * as ns from "..."` — runtime unless whole-clause type.
  if (named.kind === ts.SyntaxKind.NamespaceImport) return false;
  // Named imports: each specifier may have its own `type` qualifier.
  if (named.kind === ts.SyntaxKind.NamedImports) {
    if (named.elements.length === 0) return false;
    return named.elements.every((el) => el.isTypeOnly === true);
  }
  return false;
}

function main() {
  const rendererDir = path.join(REPO_ROOT, "renderer");
  let files;
  try {
    files = collectFiles(rendererDir);
  } catch (err) {
    if (err && typeof err === "object" && /** @type {any} */ (err).code === "ENOENT") {
      console.log("[check-renderer-imports] renderer/ dir absent; nothing to lint");
      return 0;
    }
    throw err;
  }
  const tsFiles = files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const allOffenders = [];
  for (const f of tsFiles) {
    allOffenders.push(...checkFile(f));
  }
  if (allOffenders.length === 0) {
    console.log(`[check-renderer-imports] OK — ${tsFiles.length} renderer file(s) scanned; no offenders`);
    return 0;
  }
  for (const o of allOffenders) {
    console.error(
      `[check-renderer-imports] FAIL ${o.file}:${o.line}:${o.column} ` +
        `form=${o.form} reason=${o.reason} specifier=${JSON.stringify(o.specifier)}`,
    );
  }
  return 1;
}

export { checkFile, classify, isForbiddenPackageSpecifier, isValueImportForbidden };

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
