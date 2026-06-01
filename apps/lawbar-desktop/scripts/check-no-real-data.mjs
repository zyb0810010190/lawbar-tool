#!/usr/bin/env node
// Diff scan for real-looking legal markers per dev-memo/plan-casebox-ipc-impl-01.md
// rev-0.3 §15.3. Scans staged + working-tree changes (or a user-supplied
// path list) for high-recall legal markers. Exits 0 on clean; exits 1 with
// per-match listing on hit. Heuristic — not a formal guarantee.
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const PATTERNS = [
  { name: "real-court-en", re: /\b(supreme court|district court|court of appeals?|circuit court)\b/i },
  { name: "real-court-zh", re: /(高级人民法院|中级人民法院|最高人民法院|基层人民法院)/ },
  { name: "us-state-bar", re: /\b[A-Z]{2}\s?Bar\s?(No\.|#)\s?\d{4,}/i },
  { name: "phone-us", re: /\b\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/ },
  { name: "phone-cn", re: /\b1[3-9]\d{9}\b/ },
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@(?!example\.|invalid\.|test\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { name: "ssn-us", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "id-cn", re: /\b\d{17}[\dXx]\b/ },
];

const SCOPE_HINTS = [
  /casebox|case-box|caseBox/i,
  // Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 M2 reconciliation: the
  // first regex above misses renderer paths like `renderer/screens/listMatters.ts`
  // that do not contain the `casebox` substring. Second regex extends scope to
  // every file under the desktop app's renderer/.
  /apps\/lawbar-desktop\/renderer\//,
];

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "release", ".git", "dist-tarballs", "staging"]);

// Binary asset extensions: these are NOT text fixtures, so reading them as UTF-8 produces
// byte sequences that spuriously match text patterns (e.g. a .woff2 font's bytes matching the
// email regex). A general extension skip-list — not specific filenames — keeps the scanner
// focused on real text data. NOTE: .svg is intentionally excluded (it is XML text).
const BINARY_EXTS = new Set([
  ".woff2", ".woff", ".ttf", ".otf", ".eot",                            // fonts
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".icns",   // images
  ".pdf", ".zip", ".gz", ".tgz", ".tar", ".7z", ".rar",                // archives / binary docs
  ".wasm", ".node", ".bin", ".exe", ".dll", ".dylib", ".so", ".a", ".o", // binaries
  ".mp4", ".mov", ".webm", ".avi", ".mp3", ".wav", ".ogg", ".flac",    // media
  ".sqlite", ".sqlite3", ".db",                                        // databases
]);

function isBinaryAsset(filePath) {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

const EXEMPT_PATHS = new Set([
  path.join(REPO_ROOT, "apps/lawbar-desktop/scripts/check-no-real-data.mjs"),
  path.join(REPO_ROOT, "apps/lawbar-desktop/tests/check-no-real-data.test.mjs"),
]);

function gitChangedFiles() {
  try {
    const staged = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).split("\n").filter(Boolean);
    const unstaged = execSync("git diff --name-only --diff-filter=ACMR", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).split("\n").filter(Boolean);
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).split("\n").filter(Boolean);
    return Array.from(new Set([...staged, ...unstaged, ...untracked]));
  } catch {
    return [];
  }
}

function collectRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isInScope(filePath) {
  const rel = path.relative(REPO_ROOT, filePath);
  if (EXEMPT_PATHS.has(filePath)) return false;
  if (isBinaryAsset(filePath)) return false; // binary assets (fonts/images/etc.) are never text fixtures
  if (SCOPE_HINTS.some((re) => re.test(rel))) return true;
  return false;
}

function scanFile(filePath) {
  if (!existsSync(filePath)) return [];
  if (isBinaryAsset(filePath)) return []; // defense-in-depth: never scan a binary asset as text
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (m !== null) {
        hits.push({
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
          pattern: p.name,
          match: m[0],
        });
      }
    }
  }
  return hits;
}

function main(argv) {
  let files;
  if (argv.length > 0) {
    files = argv.map((a) => path.resolve(REPO_ROOT, a));
  } else {
    const changed = gitChangedFiles();
    if (changed.length > 0) {
      files = changed.map((rel) => path.resolve(REPO_ROOT, rel));
    } else {
      // No git changes — sweep case-box-related files in the desktop app.
      const root = path.join(REPO_ROOT, "apps/lawbar-desktop");
      files = collectRecursive(root);
    }
  }
  const inScope = files.filter(isInScope);
  const allHits = [];
  for (const f of inScope) {
    allHits.push(...scanFile(f));
  }
  if (allHits.length === 0) {
    console.log(`[check-no-real-data] OK — ${inScope.length} file(s) in case-box scope; no markers`);
    return 0;
  }
  for (const h of allHits) {
    console.error(
      `[check-no-real-data] FAIL ${h.file}:${h.line} pattern=${h.pattern} match=${JSON.stringify(h.match)}`,
    );
  }
  return 1;
}

export { scanFile, isInScope, isBinaryAsset, PATTERNS };

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
