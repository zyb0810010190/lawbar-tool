// i18n anti-drift scanner (WI-i18n-1). Test-support helper (NOT a node:test file; not run directly).
// Per dev-memo/plan-i18n-impl-00.md S2/S6A. Lexical (NOT a full TS/HTML parser): it flags user-facing
// string literals so a NEW hardcoded label fails the guard. Used by both the guard test and the
// allowlist generator so the seed and the check come from one source.
//
// Scan set: renderer/screens/**.ts, renderer/index.ts, renderer/index.html. (renderer/i18n/** is the
// catalog and is intentionally NOT scanned; format.ts/types.ts/dom.ts/etc. are out of the guard scope.)
//
// A "user-facing literal" candidate is, by construction of the renderer idiom:
//   - kind "cjk"     : any string/template literal containing a CJK char (strongest drift signal)
//   - kind "text"    : a string/template literal that is an ARRAY element (el(tag, attrs, [children]))
//   - kind "setText" : the 2nd argument string of a setText(node, "...") call
//   - kind "attr"    : the value of an aria-label / title / placeholder key
//   - kind "html-text": a non-empty visible text node in index.html
// Object values for class/role/href/id/scope/type/for/data-*/aria-* (except aria-label) are NOT array
// elements and NOT the flagged attrs, so they are inherently exempt.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(__dirname, "..");
const RENDERER = path.join(APP_ROOT, "renderer");

// CJK range as ASCII \u escapes so this scanner file stays pure-ASCII / text-reviewable (L1).
const CJK_RE = /[\u4e00-\u9fff]/;
const HAS_LETTER_RE = /[A-Za-z\u4e00-\u9fff]/;

// Replace /* */ and // comments with spaces, preserving newlines (so line numbers are stable).
function stripTsComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (let j = i; j < stop; j++) out += text[j] === "\n" ? "\n" : " ";
      i = stop;
    } else if (two === "//") {
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

function lineAt(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

// Tokenize comment-stripped TS: emit string/template tokens with their text, line, and the bracket
// that immediately contains them ("[" / "(" / "{" / null). Brackets are tracked only OUTSIDE strings.
function scanTsTokens(stripped) {
  const tokens = [];
  const stack = [];
  let i = 0;
  const n = stripped.length;
  while (i < n) {
    const c = stripped[i];
    if (c === "[" || c === "(" || c === "{") {
      stack.push(c);
      i++;
    } else if (c === "]" || c === ")" || c === "}") {
      stack.pop();
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      i++;
      let body = "";
      while (i < n) {
        if (stripped[i] === "\\") {
          body += stripped[i] + (stripped[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (stripped[i] === quote) {
          i++;
          break;
        }
        body += stripped[i];
        i++;
      }
      tokens.push({ text: body, line: lineAt(stripped, start), container: stack[stack.length - 1] ?? null });
    } else {
      i++;
    }
  }
  return tokens;
}

function pushUnique(map, cand) {
  // dedupe by file+line+text; keep highest-priority kind.
  const prio = { cjk: 4, setText: 3, textContent: 3, attr: 2, text: 1, "html-text": 1 };
  const key = JSON.stringify([cand.file, cand.line, cand.text]);
  const prev = map.get(key);
  if (prev === undefined || (prio[cand.kind] ?? 0) > (prio[prev.kind] ?? 0)) map.set(key, cand);
}

function scanTsFile(rel, raw) {
  const stripped = stripTsComments(raw);
  const map = new Map();
  // array-element + CJK from the tokenizer
  for (const tok of scanTsTokens(stripped)) {
    if (CJK_RE.test(tok.text)) pushUnique(map, { file: rel, line: tok.line, text: tok.text, kind: "cjk" });
    else if (tok.container === "[") pushUnique(map, { file: rel, line: tok.line, text: tok.text, kind: "text" });
  }
  // setText(node, "...") second-arg string
  const setTextRe = /\bsetText\s*\([^,]*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  let m;
  while ((m = setTextRe.exec(stripped)) !== null) {
    const lit = m[1].slice(1, -1);
    if (HAS_LETTER_RE.test(lit)) pushUnique(map, { file: rel, line: lineAt(stripped, m.index), text: lit, kind: "setText" });
  }
  // aria-label / title / placeholder values
  const attrRe = /(?:"aria-label"|"title"|aria-label|title|placeholder)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  while ((m = attrRe.exec(stripped)) !== null) {
    const lit = m[1].slice(1, -1);
    if (HAS_LETTER_RE.test(lit)) pushUnique(map, { file: rel, line: lineAt(stripped, m.index), text: lit, kind: "attr" });
  }
  // node.textContent = "..." visible-copy assignment (e.g. renderer/index.ts not-found branch)
  const textContentRe = /\.textContent\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  while ((m = textContentRe.exec(stripped)) !== null) {
    const lit = m[1].slice(1, -1);
    if (HAS_LETTER_RE.test(lit)) pushUnique(map, { file: rel, line: lineAt(stripped, m.index), text: lit, kind: "textContent" });
  }
  return [...map.values()];
}

function scanHtmlFile(rel, raw) {
  // drop comments + script/style bodies
  const cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, " "))
    .replace(/<script[\s\S]*?<\/script>/gi, (s) => s.replace(/[^\n]/g, " "))
    .replace(/<style[\s\S]*?<\/style>/gi, (s) => s.replace(/[^\n]/g, " "));
  const map = new Map();
  // visible text nodes between tags
  const textRe = />([^<]+)</g;
  let m;
  while ((m = textRe.exec(cleaned)) !== null) {
    const txt = m[1].trim();
    if (txt !== "" && HAS_LETTER_RE.test(txt)) {
      pushUnique(map, { file: rel, line: lineAt(cleaned, m.index), text: txt, kind: CJK_RE.test(txt) ? "cjk" : "html-text" });
    }
  }
  // aria-label / title / placeholder attributes
  const attrRe = /(?:aria-label|title|placeholder)\s*=\s*"([^"]*)"/g;
  while ((m = attrRe.exec(cleaned)) !== null) {
    const v = m[1].trim();
    if (v !== "" && HAS_LETTER_RE.test(v)) {
      pushUnique(map, { file: rel, line: lineAt(cleaned, m.index), text: v, kind: CJK_RE.test(v) ? "cjk" : "attr" });
    }
  }
  return [...map.values()];
}

// Public: scan ONE file's content (used by the negative test with a virtual source string).
export function scanSource(rel, content) {
  return rel.endsWith(".html") ? scanHtmlFile(rel, content) : scanTsFile(rel, content);
}

function listScreenTs() {
  const dir = path.join(RENDERER, "screens");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `renderer/screens/${f}`);
}

// Public: scan the whole guard scan set; returns candidates sorted deterministically.
export function scanAll() {
  const rels = [...listScreenTs(), "renderer/index.ts", "renderer/index.html"];
  const out = [];
  for (const rel of rels) {
    const abs = path.join(APP_ROOT, rel);
    if (!statSync(abs).isFile()) continue;
    out.push(...scanSource(rel, readFileSync(abs, "utf8")));
  }
  out.sort((a, b) => (a.file !== b.file ? a.file.localeCompare(b.file) : a.line - b.line || a.text.localeCompare(b.text)));
  return out;
}

// Classify a scanned literal as user-facing English vs an exempt token
// (WI-DESKTOP-ZH-CN-I18N-COMPLETE-01). The anti-drift guard uses this to FAIL a
// regression the flat allowlist would otherwise absorb: any NEW hardcoded
// English *phrase* (prose with spaces/words) must be moved into the catalog.
//
// Classes:
//   "interpolation-or-separator" — after removing ${...} interpolations, nothing
//        but separators/punctuation/digits remains (e.g. "${a} · ${b}", " *", "§",
//        "${label}: "). Exempt: the visible text comes from t()/label helpers.
//   "identifier-or-enum" — a single code token, no spaces (enum VALUE kept English
//        per the contract, a field identifier, a data-lookup key, or a brand glyph:
//        "client", "third_party", "reminder_offsets", "AMBIGUOUS", "lawbar", "L").
//   "user-facing" — anything else: real English words/phrases. The guard FAILS on
//        these. This is the class that must stay empty.
//
// Residual set: separators/punctuation/digits that are never user copy. A single
// code token (identifier / enum VALUE / dotted catalog-key / data-lookup key /
// brand glyph) is exempt; catalog keys carry dots, so dots are allowed here.
function classifyAtom(t) {
  const s = String(t).trim();
  const residual = s.replace(/[\s§·•⟨⟩—–\-*|/()>:.,{}#…→←↔]|[0-9]/g, "");
  if (residual === "") return "interpolation-or-separator";
  // Single code token / enum VALUE / dotted catalog key / brand glyph: no hyphen so
  // ALL-CAPS enum consts ("MATTER_REGISTERED") and glyphs ("L") are allowed...
  if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(s)) return "identifier-or-enum";
  // ...OR an all-lowercase kebab token (route/enum: "not-found", "due-soon",
  // "non_litigation"). Hyphens are allowed ONLY when lowercase, so a hyphenated
  // English label with a capital ("Non-litigation", "Due-diligence") still flags.
  if (/^[a-z][a-z0-9_.-]*$/.test(s)) return "identifier-or-enum";
  return "user-facing";
}

// Classify a scanned literal as user-facing English vs an exempt token
// (WI-DESKTOP-ZH-CN-I18N-COMPLETE-01). The anti-drift guard uses this to FAIL a
// regression the flat allowlist would otherwise absorb: any NEW hardcoded
// English *phrase* (prose with spaces/words) must be moved into the catalog.
//
// Two passes:
//   1. Inner quoted literals inside ${...} interpolations are classified too —
//      so English hidden in a template expression (e.g. `${cond ? "Save changes"
//      : label}`) is still caught (audit finding, WI-01). Dotted catalog keys
//      inside `${t("a.b.c")}` stay `identifier-or-enum` and are NOT flagged.
//   2. The literal with interpolations stripped is classified as an atom.
//
// Classes: "interpolation-or-separator" (visible text comes from t()/labels),
// "identifier-or-enum" (single code token / enum VALUE kept English / catalog
// key / brand glyph), "user-facing" (real English words — the guard FAILS here).
//
// KNOWN RESIDUAL LIMITS (documented in dev-memo/i18n-allowlist-classification-00.md,
// backstopped by the scan==allowlist exactness test which forces a visible,
// reviewable allowlist regen for any NEW literal):
//   - A lone single English WORD (no space) is indistinguishable from an enum
//     value and classifies `identifier-or-enum`.
//   - UI copy returned by a helper OUTSIDE the scanned idioms (el children /
//     setText / textContent / aria-label/title/placeholder) is not scanned.
export function classifyLiteral(text) {
  const s = String(text);
  for (const interp of s.match(/\$\{[^}]*\}/g) ?? []) {
    for (const q of interp.match(/"[^"]*"|'[^']*'/g) ?? []) {
      const inner = q.slice(1, -1);
      if (inner !== "" && classifyAtom(inner) === "user-facing") return "user-facing";
    }
  }
  return classifyAtom(s.replace(/\$\{[^}]*\}/g, ""));
}

// --- Helper-return-literal pass (WI-DESKTOP-I18N-SCANNER-SCOPE-02) ---
// Closes the I18N-GUARD-H2 gap: the idiom scan above only sees literals in
// el() children / setText / textContent / aria positions, so user-visible copy
// produced by a HELPER that `return`s a string/template literal (then rendered
// at a call site as `[helper(x)]`) was invisible to the guard. This pass finds
// `return <string|template literal>` occurrences in the same DOM-constructing
// scan set (renderer/screens/**.ts + renderer/index.ts) and hands them to the
// user-facing-English classifier. It does NOT feed the flat allowlist (which
// stays scoped to idiom-position occurrences); it is a second input to the
// "no user-facing English" guard only.
//
// Scope note: pure utility modules that do not build DOM (renderer/format.ts,
// dom.ts, nav.ts, router.ts, api.ts, i18n/**) are outside this pass by the SAME
// rule the idiom scan uses — the scan set is the screens + the router bootstrap.
// renderer/format.ts retains pre-i18n English label helpers that no screen
// imports (verified: screens resolve labels via renderer/i18n/labels.ts); they
// are dead + unit-tested, tracked for deletion separately, and never rendered.
export function scanReturnLiterals(rel, content) {
  const stripped = stripTsComments(content);
  const out = new Map();
  const re = /\breturn\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const lit = m[1].slice(1, -1);
    if (lit !== "" && HAS_LETTER_RE.test(lit)) {
      pushUnique(out, { file: rel, line: lineAt(stripped, m.index), text: lit, kind: "return" });
    }
  }
  return [...out.values()];
}

// Public: the return-literal pass over the whole DOM-constructing scan set.
export function scanReturnAll() {
  const rels = [...listScreenTs(), "renderer/index.ts"];
  const out = [];
  for (const rel of rels) {
    const abs = path.join(APP_ROOT, rel);
    if (!statSync(abs).isFile()) continue;
    out.push(...scanReturnLiterals(rel, readFileSync(abs, "utf8")));
  }
  out.sort((a, b) => (a.file !== b.file ? a.file.localeCompare(b.file) : a.line - b.line || a.text.localeCompare(b.text)));
  return out;
}
