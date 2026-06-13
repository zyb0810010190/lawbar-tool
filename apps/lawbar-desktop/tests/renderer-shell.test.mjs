// Renderer desktop-shell structure test.
// Per the renderer UI revision work order, PR1 (CSS integration + desktop
// shell). Guards the static shell scaffold in renderer/index.html and the
// shell layer in renderer/index.css against regression:
//
//   - the shell landmarks exist (titlebar / sidebar / main / statusbar);
//   - <main id="app"> remains the router mount INSIDE .app-main (the
//     screens render flat into it — smoke.electron.test.mjs depends on it);
//   - the static chrome contains NO <h1> (smoke picks h1().first() and
//     asserts the *screen* title, so a chrome h1 would shadow it);
//   - the sidebar nav points only at real routes (#/matters, #/matters/new);
//   - the macOS traffic-light dots are tokenised (no raw hex), and index.css
//     still carries exactly two canonical :root blocks (mirrors the
//     no-hardcoded-color lint's invariant so a shell edit can't silently add
//     a third :root block).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RENDERER = path.resolve(__dirname, "..", "renderer");
// Strip HTML comments so the structural assertions match real markup only —
// the file's explanatory comment legitimately mentions `<main id="app">`/`<h1>`.
const HTML = readFileSync(path.join(RENDERER, "index.html"), "utf8").replace(
  /<!--[\s\S]*?-->/g,
  "",
);
const CSS = readFileSync(path.join(RENDERER, "index.css"), "utf8");

test("index.html carries the desktop-shell landmarks", () => {
  for (const cls of [
    "app-window",
    "app-titlebar",
    "app-shell",
    "app-sidebar",
    "app-main",
    "main-scroll",
    "app-statusbar",
  ]) {
    assert.ok(
      new RegExp(`class="[^"]*\\b${cls}\\b`).test(HTML),
      `index.html missing shell landmark .${cls}`,
    );
  }
});

test("<main id=\"app\"> is the router mount, nested inside .app-main", () => {
  assert.match(HTML, /<main id="app"/, "missing <main id=\"app\">");
  const mainIdx = HTML.indexOf('<main id="app"');
  const appMainIdx = HTML.indexOf('class="app-main"');
  const shellCloseIdx = HTML.indexOf('class="app-statusbar"');
  assert.ok(appMainIdx >= 0 && appMainIdx < mainIdx, "#app must come after .app-main opens");
  assert.ok(mainIdx < shellCloseIdx, "#app must sit before the statusbar");
});

test("static chrome contains no <h1> (protects smoke's h1().first())", () => {
  assert.ok(!/<h1[\s>]/i.test(HTML), "static shell must not contain an <h1>");
});

test("sidebar nav links target only real routes", () => {
  assert.match(HTML, /href="#\/matters"/, "missing Matters link");
  assert.match(HTML, /href="#\/matters\/new"/, "missing New matter link");
  // No links to surfaces with no product backing (dashboard/calendar/tasks/auth).
  for (const dead of ["#/dashboard", "#/calendar", "#/tasks", "#/login", "#/auth"]) {
    assert.ok(!HTML.includes(`href="${dead}"`), `unexpected dead-route link ${dead}`);
  }
});

test("traffic-light dots are tokenised, not raw hex", () => {
  assert.match(CSS, /\.traffic-light--close\s*\{\s*background:\s*var\(--traffic-close\)/);
  assert.match(CSS, /\.traffic-light--min\s*\{\s*background:\s*var\(--traffic-min\)/);
  assert.match(CSS, /\.traffic-light--max\s*\{\s*background:\s*var\(--traffic-max\)/);
});

test("index.css still has exactly two canonical :root blocks", () => {
  const rootBlocks = CSS.match(/:root\s*\{/g) || [];
  const darkBlocks = CSS.match(/:root\[data-theme="dark"\]\s*\{/g) || [];
  // `:root {` matches both bare and is overcounted by the dark selector's
  // leading `:root` only if it were `:root {`; dark uses `:root[` so the bare
  // regex does not match it. Expect exactly 1 bare + 1 dark = 2 canonical.
  assert.equal(rootBlocks.length, 1, "expected exactly one bare :root block");
  assert.equal(darkBlocks.length, 1, "expected exactly one :root[data-theme=dark] block");
});

test("index.css carries the ported shell + editorial selectors", () => {
  for (const sel of [".app-sidebar", ".app-statusbar", ".sidebar-link", ".main-header", ".view-card", ".matter-table"]) {
    assert.ok(CSS.includes(sel), `index.css missing ported selector ${sel}`);
  }
});
