// i18n anti-drift guard (WI-i18n-1). Per dev-memo/plan-i18n-impl-00.md S6A.
// Scans renderer/screens/**, renderer/index.ts, renderer/index.html for user-facing string literals
// and fails if any occurrence is NOT in the exact-occurrence allowlist (seeded to today's literals).
// A NEW hardcoded label therefore fails CI. The allowlist is `{file,line,text,kind}` (exact occurrence,
// NOT per-file); it burns down to empty as later screen-migration WIs move literals into the catalog.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanAll, scanSource, classifyLiteral, APP_ROOT } from "./_i18n-ui-scan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = path.join(APP_ROOT, "renderer", "i18n", "ui-strings-allowlist.json");
const ALLOWLIST = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));

const keyOf = (c) => JSON.stringify([c.file, c.line, c.text, c.kind]);

test("allowlist file is a non-empty array of {file,line,text,kind} entries", () => {
  assert.ok(Array.isArray(ALLOWLIST) && ALLOWLIST.length > 0);
  for (const e of ALLOWLIST) {
    for (const f of ["file", "line", "text", "kind"]) {
      assert.ok(f in e, `allowlist entry missing ${f}: ${JSON.stringify(e)}`);
    }
    assert.ok(!e.file.includes("**"), "entries are exact occurrences, not per-file globs");
  }
});

test("no user-facing literal outside the catalog beyond the seeded allowlist (drift guard)", () => {
  const allowed = new Set(ALLOWLIST.map(keyOf));
  const candidates = scanAll();
  const drift = candidates.filter((c) => !allowed.has(keyOf(c)));
  assert.deepEqual(
    drift,
    [],
    `New hardcoded user-facing literal(s) not in the catalog or allowlist -- move them into\n` +
      `renderer/i18n/catalog.ts (and wire via t()), or (during migration) regenerate the allowlist:\n` +
      drift.map((d) => `  ${d.file}:${d.line} [${d.kind}] ${JSON.stringify(d.text)}`).join("\n"),
  );
});

test("allowlist has no stale entries (seed matches current source exactly)", () => {
  // WI-i18n-1 seeds the allowlist to today's literals, so it must equal the current scan. Later
  // migration WIs regenerate it as they burn literals down into the catalog.
  const current = new Set(scanAll().map(keyOf));
  const stale = ALLOWLIST.filter((e) => !current.has(keyOf(e)));
  assert.deepEqual(stale, [], `stale allowlist entries (regenerate the allowlist):\n${stale.map((s) => `  ${s.file}:${s.line} ${JSON.stringify(s.text)}`).join("\n")}`);
});

test("guard BITES: an injected new literal is flagged and is NOT in the allowlist (virtual source)", () => {
  // Negative test on a VIRTUAL source string -- never mutates/writes a real renderer file.
  const virtual = `
    import { el, setText } from "../dom.js";
    export function mountThing(root, doc) {
      const btn = el("button", { type: "button", "aria-label": "Totally New Aria Label" },
        ["Totally New Visible Button Copy"], doc);
      const h1 = el("h1", {}, [], doc);
      h1.textContent = "Brand New TextContent Copy";
      setText(root, "Brand New setText Copy");
      root.appendChild(btn);
    }
  `;
  const found = scanSource("renderer/screens/_virtual.ts", virtual);
  const texts = found.map((c) => c.text);
  assert.ok(texts.includes("Totally New Visible Button Copy"), "scanner must flag el() child text");
  assert.ok(texts.includes("Totally New Aria Label"), "scanner must flag aria-label value");
  assert.ok(texts.includes("Brand New TextContent Copy"), "scanner must flag .textContent = literal (M1)");
  assert.ok(texts.includes("Brand New setText Copy"), "scanner must flag setText literal");
  // None of these virtual occurrences are in the real allowlist -> the drift guard would fail on them.
  const allowed = new Set(ALLOWLIST.map(keyOf));
  for (const c of found) assert.ok(!allowed.has(keyOf(c)), "virtual literal must NOT be pre-allowed");
});

test("guard EXEMPTS non-UI attribute values (class/data-*/href) -- no false positives", () => {
  const virtual = `
    import { el } from "../dom.js";
    const x = el("a", { href: "#/matters", class: "button button--primary list-new-btn",
      "data-test-id": "x", role: "tab" }, [], doc);
  `;
  const found = scanSource("renderer/screens/_virtual2.ts", virtual);
  assert.deepEqual(found, [], `non-UI attribute values must not be flagged; got ${JSON.stringify(found)}`);
});

// --- User-facing-English hard guard (WI-DESKTOP-ZH-CN-I18N-COMPLETE-01) ---
// The flat allowlist proves "no NEW literal", but it would happily absorb a
// user-facing English *phrase* if someone regenerated it. This guard classifies
// every scanned literal and FAILS if any is user-facing English (real words),
// independent of the allowlist. Exempt classes: interpolation-only templates /
// separators, and single code tokens (enum VALUES kept English per contract,
// field identifiers, data-lookup keys, brand glyphs).
test("NO user-facing English literal remains in the renderer scan set (fully-zh-CN guard)", () => {
  const offenders = scanAll().filter((c) => classifyLiteral(c.text) === "user-facing");
  assert.deepEqual(
    offenders,
    [],
    `User-facing English must be moved into renderer/i18n/catalog.ts and resolved via t()/a label helper.\n` +
      `Offending literals (class=user-facing):\n` +
      offenders.map((o) => `  ${o.file}:${o.line} [${o.kind}] ${JSON.stringify(o.text)}`).join("\n"),
  );
});

test("every allowlisted occurrence classifies as exempt (never user-facing)", () => {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const userFacing = allowlist.filter((e) => classifyLiteral(e.text) === "user-facing");
  assert.deepEqual(
    userFacing,
    [],
    `Allowlist must not carry user-facing English. Offending rows:\n` +
      userFacing.map((e) => `  ${e.file}:${e.line} ${JSON.stringify(e.text)}`).join("\n"),
  );
});

test("classifier BITES: a hardcoded English phrase classifies user-facing; tokens/templates do not", () => {
  assert.equal(classifyLiteral("Save changes"), "user-facing");
  assert.equal(classifyLiteral("No documents yet."), "user-facing");
  assert.equal(classifyLiteral("third_party"), "identifier-or-enum");
  assert.equal(classifyLiteral("llm_extraction"), "identifier-or-enum");
  assert.equal(classifyLiteral("${a} · ${b}"), "interpolation-or-separator");
  assert.equal(classifyLiteral("${x} → ${y}"), "interpolation-or-separator");
  // English hidden inside a template interpolation is still caught (audit High #1),
  // while a dotted catalog key inside ${t("a.b.c")} stays exempt.
  assert.equal(classifyLiteral('${cond ? "Save changes" : label}'), "user-facing");
  assert.equal(classifyLiteral('${t("links.row.created")} ${x}'), "interpolation-or-separator");
});
