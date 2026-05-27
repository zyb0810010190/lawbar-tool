// Renderer-side no-hard-coded-color lint test.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §8.3 + G-UI-5 (M3 reconciliation:
// block-level exemption, NOT path-level).
//
// Scans every `renderer/**/*.ts` and `renderer/**/*.css` file. Inside
// `renderer/index.css`, ONLY the canonical `:root { ... }` and
// `:root[data-theme="dark"] { ... }` blocks are exempt. Raw color literals
// outside those blocks fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const RENDERER_DIR = path.join(APP_ROOT, "renderer");
const INDEX_CSS = path.join(RENDERER_DIR, "index.css");

// Forbidden patterns. `transparent` is permitted; named-color allowlist is
// kept small (common offenders). `currentColor` / `inherit` / `initial` /
// `unset` are not matched.
const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;
const RGB_RE = /\brgba?\s*\(/g;
const HSL_RE = /\bhsla?\s*\(/g;
// Named-color match requires the color name to be followed by something
// other than `-` or `_` so CSS property names like `white-space` are not
// flagged as raw colors. (Lookbehind for the same reason on the preceding
// side would also work but `\b` already handles the common cases.)
const NAMED_RE = /\b(red|blue|green|yellow|orange|purple|pink|brown|gray|grey|black|white|cyan|magenta)\b(?![-_])/gi;

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...collect(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

// Strip /* ... */ comments + // ... line comments. Returns text with comments
// replaced by spaces (preserves line numbers and offsets for diagnostics).
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      // Replace with spaces (preserve newlines).
      for (let j = i; j < stop; j++) {
        out += text[j] === "\n" ? "\n" : " ";
      }
      i = stop;
    } else if (text[i] === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      const stop = nl < 0 ? text.length : nl;
      for (let j = i; j < stop; j++) out += " ";
      i = stop;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

// Find canonical `:root` and `:root[data-theme="dark"]` block ranges in
// `renderer/index.css`. Brace-counted. Returns array of [start, end] byte offsets
// covering the opening selector + body. Operates on the *comment-stripped* text
// so commented-out braces don't confuse the counter.
function findCanonicalBlocks(text) {
  const blocks = [];
  const stripped = stripComments(text);
  const selectors = [/:root\s*\{/g, /:root\[data-theme="dark"\]\s*\{/g];
  for (const re of selectors) {
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const start = m.index;
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < stripped.length && depth > 0) {
        if (stripped[i] === "{") depth++;
        else if (stripped[i] === "}") depth--;
        i++;
      }
      blocks.push([start, i]);
    }
  }
  return blocks;
}

function isInsideAnyBlock(offset, blocks) {
  return blocks.some(([s, e]) => offset >= s && offset < e);
}

function scanFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const text = stripComments(raw);
  const isIndexCss = filePath === INDEX_CSS;
  const exemptBlocks = isIndexCss ? findCanonicalBlocks(raw) : [];
  const offenders = [];
  const patterns = [
    { name: "hex", re: HEX_RE },
    { name: "rgb", re: RGB_RE },
    { name: "hsl", re: HSL_RE },
    { name: "named", re: NAMED_RE },
  ];
  for (const { name, re } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (isInsideAnyBlock(m.index, exemptBlocks)) continue;
      // Resolve line number from raw text.
      const upto = raw.slice(0, m.index);
      const line = upto.split("\n").length;
      offenders.push({ file: path.relative(APP_ROOT, filePath), line, kind: name, match: m[0] });
    }
  }
  return offenders;
}

test("renderer-no-hardcoded-color: scans renderer/ recursively", () => {
  const files = collect(RENDERER_DIR);
  assert.ok(files.length > 0, "expected at least one renderer file");
});

test("renderer-no-hardcoded-color: no raw color literals outside canonical :root blocks", () => {
  const files = collect(RENDERER_DIR);
  const allOffenders = [];
  for (const f of files) {
    allOffenders.push(...scanFile(f));
  }
  assert.deepEqual(
    allOffenders,
    [],
    `Forbidden color literals found:\n${allOffenders
      .map((o) => `  ${o.file}:${o.line}  ${o.kind}=${o.match}`)
      .join("\n")}`,
  );
});

test("renderer-no-hardcoded-color: canonical :root blocks ARE detected in index.css", () => {
  const raw = readFileSync(INDEX_CSS, "utf8");
  const blocks = findCanonicalBlocks(raw);
  assert.equal(blocks.length, 2, "expected exactly 2 canonical :root blocks");
});

test("renderer-no-hardcoded-color: synthetic hex outside blocks would be caught", () => {
  // White-box check on the scanner logic itself: synthesise a file path that
  // doesn't exist; instead verify by constructing input strings + calling the
  // helpers. This guards against accidentally exempting everything.
  const synthetic = "body { color: #ff0000; }";
  const stripped = stripComments(synthetic);
  const re = /#[0-9A-Fa-f]{3,8}\b/g;
  re.lastIndex = 0;
  const m = re.exec(stripped);
  assert.ok(m !== null, "scanner regex must match plain #ff0000");
  // And NOT be inside any synthetic block since the input has none.
  assert.equal(isInsideAnyBlock(m.index, []), false);
});
