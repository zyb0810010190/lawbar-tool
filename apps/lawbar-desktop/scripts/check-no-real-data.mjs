#!/usr/bin/env node
// Scan for real-looking legal markers per dev-memo/plan-casebox-ipc-impl-01.md
// rev-0.3 §15.3. Default: staged + working-tree changes (or a user-supplied
// path list). `--all`: the whole in-scope corpus regardless of git status, so the
// checks are a standing invariant rather than a diff-only tripwire (WI-GATE-FULLSCAN).
// Exits 0 on clean; exits 1 with per-match listing on hit. Heuristic — not a formal guarantee.
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

// Fixture roots holding hand-authored sample data. Used BOTH as scan scope and as the
// gate for the party-name provenance check below (see isFixtureJson).
// The node_modules lookahead keeps vendored fixture dirs (json-schema-traverse, fast-uri)
// out — those are dependency test data, never this project's sample data.
const FIXTURE_ROOTS = [
  // docs/contracts/fixtures/** and docs/contracts/<package>/fixtures/**.
  /^docs\/contracts\/(?!.*node_modules)(?:[^/]+\/)*fixtures\//,
  // Desktop golden / expected-output fixture files.
  /^apps\/lawbar-desktop\/tests\/fixtures\//,
];

const SCOPE_HINTS = [
  /casebox|case-box|caseBox/i,
  // Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 M2 reconciliation: the
  // first regex above misses renderer paths like `renderer/screens/listMatters.ts`
  // that do not contain the `casebox` substring. Second regex extends scope to
  // every file under the desktop app's renderer/.
  /apps\/lawbar-desktop\/renderer\//,
  // WI-GATE-PROVENANCE (ADDITIVE — nothing above was changed or narrowed). The two hints
  // above never reached contract fixtures outside the case-box package (no `case-box`
  // substring in `docs/contracts/fixtures/**`) nor the desktop tests tree. Real client
  // identifiers sat in exactly those places for five weeks (remediated in commit f86c8e4)
  // without this gate ever firing.
  ...FIXTURE_ROOTS,
  // Desktop test data is not confined to tests/fixtures/: goldens are also held inline in
  // test files (e.g. the T3 catalog golden serialization + its locked sha256 in
  // tests/t3-catalog-model.unit.test.mjs, which is where the leaked identifier actually
  // lived). Scoping the whole directory is what covers the observed vector. The gate's own
  // test file, which legitimately carries every forbidden pattern, stays out via
  // EXEMPT_PATHS below.
  /^apps\/lawbar-desktop\/tests\//,
  // Every product, ADR, release and UI document (2026-08-22). 99 of them were outside
  // this gate in a repository with client identifiers in its git history.
  // Segment-anchored, deliberately narrow. A substring test (the first attempt) excluded
  // any path merely CONTAINING the text, so a genuine `node_modules-client-notes.md`
  // escaped the guard — a false negative, found by external audit. A BLANKET exclusion
  // in isInScope() was the second wrong answer: it also dropped vendored files under
  // case-box paths, which the hint above deliberately keeps IN scope (see the
  // "does not pull in vendored node_modules fixtures" test, which forbids narrowing).
  // This form excludes a vendored SEGMENT only, and only for paths no other hint claims.
  /^docs\/(?!(?:.*\/)?node_modules(?:\/|$))/,
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

// Detector-pattern documentation exemption. Provenance/planning docs under dev-memo/ sometimes
// quote the scanner's OWN forbidden-pattern regexes (e.g. a line documenting
// `/(supreme court|高级人民法院)/i`). That is rule documentation, not real client data, but the
// scanner cannot tell them apart. A line carrying the EXACT marker below is skipped — but ONLY
// in `dev-memo/**.md` prose (see isDetectorDoc). The marker is IGNORED in app/renderer/test/
// fixture/code files, so real-data detection in product code and fixtures is never weakened.
// Narrow by design: per-line, exact token, doc-path-only. An unknown/partial marker does nothing.
const DOC_EXEMPT_MARKER = "no-real-data: detector-pattern-doc";

function isDetectorDoc(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
  return rel.startsWith("dev-memo/") && rel.toLowerCase().endsWith(".md");
}

// --- Fixture party-name provenance (WI-GATE-PROVENANCE) --------------------------------
//
// Why an allowlist rather than a name detector: general person-name detection is not
// tractable here. A three-character Chinese personal name is orthographically identical to
// ordinary text, so any regex broad enough to catch one is simultaneously leaky (misses the
// next real name) and noisy (fires on prose). The tractable control is PROVENANCE — a
// fixture party label may only be a name this project has approved as fictional. Anything
// else fails, and the remedy is either to use an approved placeholder or to add one here
// deliberately, with its source recorded.
//
// This check applies ONLY to JSON under FIXTURE_ROOTS (see isFixtureJson). Product source,
// tests, and docs keep the PATTERNS scan only — those legitimately hold free prose.

// Party-label fields, derived by inspecting the fixtures and the schemas rather than guessed:
//   - `display_name` is the only party-label field the contract defines. It is required in
//     docs/contracts/case-box-contract/schemas/case-box-party.schema.json (["role",
//     "display_name", "party_kind"]) and in the `parties[]` items of
//     case-box-matter.schema.json, described there as "Lawyer-authored display name for the
//     party." All 12 party labels in the current fixture corpus use it.
// Deliberately NOT included, each checked against real fixture values:
//   `name` (a matter title — "Test Matter — Sample Litigation" — and, on OCR results, the
//   engine id "paddleocr"), `claimant_party_id` / `respondent_party_id` (ULIDs, not labels),
//   `extractor_name` (tool ids such as "clio-import-v1"), `filename` (document filenames),
//   `notes` (free prose). Add a field here if the contract grows another party label.
const PARTY_NAME_FIELDS = new Set(["display_name"]);

// APPROVED-FICTIONAL party names. Every entry is a placeholder this repo already uses;
// nothing here was invented for the allowlist. Keep this list short and sourced — it is the
// whole strength of the control.
const APPROVED_FICTIONAL_PARTY_NAMES = [
  // The standard Chinese placeholder pair — the direct analogue of John Doe / Richard Roe.
  // Sources: dev-memo/design/2026-08-03-claimtrack-screen.md (claimant/respondent examples)
  // and services/ocr-worker-bakeoff/fixtures/synthetic/zh-05-party-row.txt
  // ("原告：张三  被告：李四"). Adopted as the replacement set by WI-PII-SCRUB (commit f86c8e4).
  "张三",
  "李四",
  // Synthetic English organisations already carried by the case-box contract fixtures.
  "ACME Corp", // client org, docs/contracts/case-box-contract/fixtures/**
  "Counterparty Ltd", // opposing org, docs/contracts/case-box-contract/fixtures/**
  // Synthetic bench name in the party role-validation fixture.
  "Honorable J. Smith", // docs/contracts/case-box-contract/fixtures/invalid/party-bad-role.json
];

// Prefixed synthetic families. Deliberately narrow: anchored prefixes, never substrings, so
// a real name cannot qualify by merely containing an approved token. These generalise (and
// therefore overlap) the exact entries above; the exact list is kept as the record of what
// the fixture corpus actually contains today.
const APPROVED_FICTIONAL_PARTY_PATTERNS = [
  // 示例 = "sample/example" — this repo's convention for a fictional Chinese organisation.
  //
  // TIGHTENED (WI-GATE-L1). The previous pattern was `/^示例./`: prefix-only and unanchored at
  // the end, so it admitted an unbounded family — 示例 followed by ANYTHING. A real name glued
  // to a synthetic prefix passed unrecorded (示例王大锤, 示例建设有限公司（法定代表人：王大锤）),
  // which is provenance by family rather than by record.
  //
  // Grounded in what the repo actually carries, not in what a 示例 name could look like: the
  // ONLY 示例-prefixed party/organisation label anywhere in the corpus is 示例建设有限公司
  // (dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md, the T5 intro line). Every other 示例
  // occurrence is a document filename (示例-证据目录及说明-一审.pdf), a case number
  // (示例民初0001号), or OCR body text — none of them party labels. That single recorded form is
  // 示例 + a Chinese-character body + the company-form suffix 有限公司, so the pattern is
  // anchored at BOTH ends to exactly that shape. Anything else — including another 示例
  // organisation form — must be added to APPROVED_FICTIONAL_PARTY_NAMES deliberately, with its
  // source recorded. That is the allowlist working as designed, not a gap.
  /^示例[一-鿿]{1,12}有限公司$/,
  // "ACME Corp", "ACME Corporation", "Acme Demonstration LLC", …
  /^ACME\b/i,
  // "Counterparty Ltd", "Counterparty Holdings", …
  /^Counterparty\b/i,
];

const APPROVED_FICTIONAL_PARTY_SET = new Set(
  APPROVED_FICTIONAL_PARTY_NAMES.map((n) => n.normalize("NFC")),
);

function isApprovedFictionalPartyName(value) {
  // Defense in depth (WI-GATE-M1): never coerce. A non-string party label has no verifiable
  // provenance, so it can never be "approved" — callers must fail it, not stringify it.
  if (typeof value !== "string") return false;
  const v = value.normalize("NFC").trim();
  // An empty label is a schema violation (minLength 1), not a provenance failure — leave it
  // to the contract tests rather than reporting it as a privacy hit.
  if (v.length === 0) return true;
  if (APPROVED_FICTIONAL_PARTY_SET.has(v)) return true;
  return APPROVED_FICTIONAL_PARTY_PATTERNS.some((re) => re.test(v));
}

// The JSON type of a parsed value, for reporting. JSON.parse can only yield object / array /
// string / number / boolean / null, so this is total over its output.
function jsonTypeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "object" | "string" | "number" | "boolean"
}

// Recursive walk so nested labels are covered (CaseBoxMatter.parties[]), not only the
// top-level standalone party fixtures.
//
// WI-GATE-M1 — a party-label field is collected BY KEY, regardless of its value's type. The
// previous version guarded on `typeof value === "string"`, which meant a parseable-but-
// malformed fixture bypassed the allowlist entirely: for `{"display_name": {"value": "<real
// name>"}}` the walk descended into the wrapper, the `display_name` key association was lost,
// and no hit was ever emitted. The gate fails closed on UNPARSEABLE JSON, so failing OPEN on
// parseable-malformed JSON was incoherent — this is a privacy control and must stand on its
// own, not lean on schema validation to reject the shape first.
//
// The recursion is deliberately still unconditional, so nested labels inside a malformed
// wrapper keep their existing coverage: the key check ADDS a failure, it never replaces one.
function collectPartyNameValues(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectPartyNameValues(item, out);
    return out;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (PARTY_NAME_FIELDS.has(key)) out.push({ field: key, value, jsonType: jsonTypeOf(value) });
      collectPartyNameValues(value, out);
    }
  }
  return out;
}

function isFixtureJson(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
  if (!rel.toLowerCase().endsWith(".json")) return false;
  return FIXTURE_ROOTS.some((re) => re.test(rel));
}

const PARTY_NAME_HINT =
  "not an APPROVED-FICTIONAL party name. Use an approved placeholder (张三 / 李四 / \"ACME Corp\" / " +
  "\"Counterparty Ltd\" / a 示例-prefixed organisation), or — only if this value is genuinely fictional — " +
  "add it to APPROVED_FICTIONAL_PARTY_NAMES in apps/lawbar-desktop/scripts/check-no-real-data.mjs with a " +
  "comment naming where it comes from. Never add a real party name.";

const PARTY_NAME_TYPE_HINT =
  "a party-label field must be a plain JSON string so its provenance can be checked against the " +
  "APPROVED-FICTIONAL allowlist. A wrapped, nested, or non-string value (object / array / number / " +
  "boolean / null) is invalid provenance in itself and is never coerced or skipped. Replace it with " +
  "an approved placeholder string (张三 / 李四 / \"ACME Corp\" / \"Counterparty Ltd\").";

// Structural (parse-based, not regex-based) provenance check, so reformatting a fixture
// cannot evade it. `text` is the raw file body; `file` is the rel path used in hit records.
function scanFixtureProvenance(text, file = "") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Fail closed: an unparseable fixture cannot have its party provenance verified.
    return [
      {
        file,
        line: 1,
        pattern: "fixture-unparseable",
        match: String(err.message),
        hint: "fixture JSON must parse so its party names can be provenance-checked",
      },
    ];
  }
  const lines = text.split("\n");
  const hits = [];
  for (const { field, value, jsonType } of collectPartyNameValues(parsed)) {
    // A party label that is not a plain string is invalid provenance in itself — it cannot be
    // allowlist-checked, so it fails with its own distinct reason. Deliberately NOT coerced,
    // stringified, or skipped, and the offending value is NOT echoed: reporting the JSON type
    // is enough to locate and fix the fixture without spilling a possibly-real name into logs.
    if (jsonType !== "string") {
      const keyIdx = lines.findIndex((l) => l.includes(`"${field}"`));
      hits.push({
        file,
        line: keyIdx >= 0 ? keyIdx + 1 : 1,
        pattern: "party-name-not-a-string",
        field,
        jsonType,
        match: jsonType,
        hint: PARTY_NAME_TYPE_HINT,
      });
      continue;
    }
    if (isApprovedFictionalPartyName(value)) continue;
    const idx = lines.findIndex((l) => l.includes(value));
    hits.push({
      file,
      line: idx >= 0 ? idx + 1 : 1,
      pattern: "party-name-not-allowlisted",
      field,
      match: value,
      hint: PARTY_NAME_HINT,
    });
  }
  return hits;
}

const EXEMPT_PATHS = new Set([
  path.join(REPO_ROOT, "apps/lawbar-desktop/scripts/check-no-real-data.mjs"),
  path.join(REPO_ROOT, "apps/lawbar-desktop/tests/check-no-real-data.test.mjs"),
]);

// Repo-relative paths from a git listing command. Returns [] when git is unavailable or the
// command fails — callers must not treat an empty listing as "nothing to scan" (see main()).
function gitList(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function gitChangedFiles() {
  return Array.from(new Set([
    ...gitList("diff --cached --name-only --diff-filter=ACMR"),
    ...gitList("diff --name-only --diff-filter=ACMR"),
    ...gitList("ls-files --others --exclude-standard"),
  ]));
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
  // Normalise to forward slashes so the anchored path hints match on any separator.
  const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
  if (EXEMPT_PATHS.has(filePath)) return false;
  if (isBinaryAsset(filePath)) return false; // binary assets (fonts/images/etc.) are never text fixtures
  if (SCOPE_HINTS.some((re) => re.test(rel))) return true;
  return false;
}

// Pure line scanner. `isDoc` enables the detector-pattern-doc marker exemption (dev-memo prose
// only); `file` is the rel path used in hit records.
function scanContent(text, { isDoc = false, file = "" } = {}) {
  const lines = text.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Exempt a single line ONLY when it carries the exact marker AND the file is a dev-memo doc.
    if (isDoc && line.includes(DOC_EXEMPT_MARKER)) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (m !== null) {
        hits.push({ file, line: i + 1, pattern: p.name, match: m[0] });
      }
    }
  }
  return hits;
}

function scanFile(filePath) {
  if (!existsSync(filePath)) return [];
  if (isBinaryAsset(filePath)) return []; // defense-in-depth: never scan a binary asset as text
  const text = readFileSync(filePath, "utf8");
  const rel = path.relative(REPO_ROOT, filePath);
  const hits = scanContent(text, { isDoc: isDetectorDoc(filePath), file: rel });
  // Fixture party names additionally require approved-fictional provenance. Note this runs
  // on top of — never instead of — the PATTERNS scan, and the dev-memo exemption marker
  // cannot reach it (isDetectorDoc is dev-memo/**.md only, and this is fixture JSON).
  if (isFixtureJson(filePath)) hits.push(...scanFixtureProvenance(text, rel));
  return hits;
}

// No-git-changes sweep roots. WI-GATE-PROVENANCE added docs/contracts: previously the sweep
// could not reach any fixture outside apps/lawbar-desktop, so the widened scope would have been
// unreachable in this branch. isInScope still filters.
const SWEEP_ROOTS = [
  path.join(REPO_ROOT, "apps/lawbar-desktop"),
  // The whole docs tree (2026-08-22). Full-scan mode unions git ls-files with this sweep,
  // so for TRACKED docs the binding constraint was SCOPE_HINTS, not this root. The root
  // still matters for UNTRACKED docs — a draft quoting a real matter that has not been
  // committed yet, which is the more dangerous case, not the less.
  path.join(REPO_ROOT, "docs"),
];

function sweepFiles() {
  return SWEEP_ROOTS.filter((r) => existsSync(r)).flatMap((r) => collectRecursive(r));
}

// --- Full-scan mode (WI-GATE-FULLSCAN) ---------------------------------------------------
//
// The default mode is DIFF-SCOPED: when git reports changes, only those files are scanned. That
// catches every NEW introduction but never re-checks a file nobody touched, so a real identifier
// sitting dormant in an untouched fixture stays invisible indefinitely. That is not hypothetical
// — real client identifiers sat in this repo's fixtures and tests for five weeks (scrubbed in
// f86c8e4) for exactly this reason.
//
// `--all` turns the same checks into a standing invariant: same PATTERNS, same isInScope, same
// provenance allowlist, same exit codes — only the file set differs. The set is deliberately the
// UNION of every source the default mode can draw on (tracked files, untracked-but-not-ignored
// files, and the no-change tree sweep), so the full scan can never see LESS than the default
// scan would. Nothing here narrows or softens the diff-scoped path, which remains the default.
function fullScanFiles() {
  return Array.from(new Set([
    ...gitList("ls-files").map((rel) => path.resolve(REPO_ROOT, rel)),
    ...gitList("ls-files --others --exclude-standard").map((rel) => path.resolve(REPO_ROOT, rel)),
    ...sweepFiles(),
  ]));
}

const USAGE = "usage: check-no-real-data.mjs [--all] [<path>...]";

function parseArgs(argv) {
  let all = false;
  const paths = [];
  for (const a of argv) {
    if (a === "--all") {
      all = true;
      continue;
    }
    // An unrecognised flag is a usage ERROR, never a path. Resolving `--all-files` as a
    // relative path would yield a nonexistent file, scanFile would return no hits, and the
    // gate would report a pass having scanned nothing. Fail closed on the typo instead.
    if (a.startsWith("-")) return { error: `unknown option ${JSON.stringify(a)}`, all, paths };
    paths.push(a);
  }
  if (all && paths.length > 0) {
    return { error: "--all cannot be combined with explicit paths", all, paths };
  }
  return { error: null, all, paths };
}

// Resolves WHICH files a given invocation scans. Everything downstream (isInScope, PATTERNS,
// the fixture provenance allowlist, the exit codes) is identical across modes by construction.
function resolveScanFiles(argv = []) {
  const { error, all, paths } = parseArgs(argv);
  if (error !== null) return { mode: "usage-error", error, files: [] };
  if (all) return { mode: "full", error: null, files: fullScanFiles() };
  if (paths.length > 0) {
    return { mode: "explicit", error: null, files: paths.map((a) => path.resolve(REPO_ROOT, a)) };
  }
  const changed = gitChangedFiles();
  if (changed.length > 0) {
    return { mode: "diff", error: null, files: changed.map((rel) => path.resolve(REPO_ROOT, rel)) };
  }
  return { mode: "sweep", error: null, files: sweepFiles() };
}

function main(argv) {
  const { mode, error, files } = resolveScanFiles(argv);
  if (mode === "usage-error") {
    console.error(`[check-no-real-data] FAIL ${error}`);
    console.error(`[check-no-real-data]        -> ${USAGE}`);
    return 1;
  }
  const inScope = files.filter(isInScope);
  // Fail closed in full-scan mode. A full scan that resolved nothing has not verified the
  // invariant, it has only failed to look (broken git, wrong cwd, a future scope regression).
  // Diff mode legitimately reports 0 when no in-scope file changed, so the guard is full-only.
  if (mode === "full" && inScope.length === 0) {
    console.error(
      "[check-no-real-data] FAIL full scan resolved 0 in-scope files — refusing to report a pass",
    );
    console.error(
      "[check-no-real-data]        -> run from inside the repository with git available; " +
        "an empty full scan is a gate failure, not a clean result",
    );
    return 1;
  }
  const allHits = [];
  for (const f of inScope) {
    allHits.push(...scanFile(f));
  }
  if (allHits.length === 0) {
    console.log(
      `[check-no-real-data] OK — ${inScope.length} file(s) in case-box scope (mode=${mode}); no markers`,
    );
    return 0;
  }
  for (const h of allHits) {
    // `field` is present only on provenance hits; pattern hits keep their original format.
    // `jsonType` marks the non-string party-label failure, which reports the offending JSON
    // type rather than the value (never coerced — see scanFixtureProvenance).
    let detail;
    if (h.jsonType) detail = `field=${h.field} jsonType=${h.jsonType}`;
    else if (h.field) detail = `field=${h.field} value=${JSON.stringify(h.match)}`;
    else detail = `match=${JSON.stringify(h.match)}`;
    console.error(`[check-no-real-data] FAIL ${h.file}:${h.line} pattern=${h.pattern} ${detail}`);
    if (h.hint) console.error(`[check-no-real-data]        -> ${h.hint}`);
  }
  return 1;
}

export {
  main,
  resolveScanFiles,
  scanFile,
  scanContent,
  scanFixtureProvenance,
  isInScope,
  isBinaryAsset,
  isDetectorDoc,
  isFixtureJson,
  isApprovedFictionalPartyName,
  DOC_EXEMPT_MARKER,
  PATTERNS,
  PARTY_NAME_FIELDS,
  APPROVED_FICTIONAL_PARTY_NAMES,
  FIXTURE_ROOTS,
  // Exported so tests assert against the REAL roots. A test keeping its own copy
  // silently drifted when docs/contracts widened to docs (found 2026-08-22).
  SWEEP_ROOTS,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
