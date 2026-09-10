#!/usr/bin/env node
// verdict.mjs — run the bake-off on a role and write the COMMITTABLE result (R3, WI-12 item 6).
//
//   node bin/verdict.mjs --role=holdout --out=results/2026-09-10-holdout.json
//   node bin/verdict.mjs --role=holdout --fixtures-root=/abs/private/pages --out=results/…-real.json
//
// The result carries aggregates and identity only — never a transcript, a fixture id, or a path —
// and the writer refuses anything else. The spec (fixtures/verdict-spec.json) is read, hashed,
// and applied as written; the git sha of the harness is recorded so the result can be reproduced.
//
// Exit codes: 0 result written; 2 no candidate produced a success (nothing to judge) or the spec
// refused; 3 bad arguments.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest, collectLanguages, ManifestValidationError } from "../dist/manifest.js";
import { runBakeoff } from "../dist/runner.js";
import { assertCommittable, buildVerdict, readSpecFile, sha256Hex, VerdictSpecError } from "../dist/verdict.js";
import { makeTesseractCandidate } from "../dist/harnesses/tesseract.js";
import { makePaddleOcrOnnxCandidate } from "../dist/harnesses/paddleocr-onnx.js";
import { makeLawbarOcrVisionCandidate } from "../dist/harnesses/lawbar-ocr-vision.js";
import { makeLawbarOcrPdfkitLayerCandidate } from "../dist/harnesses/lawbar-ocr-pdfkit-layer.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const defaultFixturesRoot = join(pkgRoot, "fixtures");

function parseArgs(argv) {
  const out = { role: "holdout", fixturesRoot: undefined, out: undefined, spec: join(defaultFixturesRoot, "verdict-spec.json") };
  for (const tok of argv) {
    if (tok.startsWith("--role=")) out.role = tok.slice("--role=".length);
    else if (tok.startsWith("--fixtures-root=")) out.fixturesRoot = tok.slice("--fixtures-root=".length);
    else if (tok.startsWith("--out=")) out.out = tok.slice("--out=".length);
    else if (tok.startsWith("--spec=")) out.spec = tok.slice("--spec=".length);
    else { process.stderr.write(`unknown arg: ${tok}\n`); process.exit(3); }
  }
  if (!["verdict", "holdout"].includes(out.role)) { process.stderr.write(`--role must be verdict|holdout (got ${out.role})\n`); process.exit(3); }
  if (out.out === undefined || out.out === "") { process.stderr.write("--out=<file> is required\n"); process.exit(3); }
  if (out.fixturesRoot !== undefined && !isAbsolute(out.fixturesRoot)) { process.stderr.write("--fixtures-root must be absolute\n"); process.exit(3); }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const fixturesRoot = args.fixturesRoot ?? defaultFixturesRoot;
const root = args.fixturesRoot === undefined ? "repo" : "external";

let manifest;
try {
  manifest = loadManifest(fixturesRoot);
} catch (err) {
  if (err instanceof ManifestValidationError) { process.stderr.write(`manifest validation failed: ${err.message}\n`); process.exit(2); }
  throw err;
}
let specFile;
try {
  specFile = readSpecFile(args.spec);
} catch (err) {
  if (err instanceof VerdictSpecError) { process.stderr.write(`spec refused: ${err.message}\n`); process.exit(2); }
  throw err;
}
if (specFile.spec.evaluate_on_role !== args.role) {
  process.stderr.write(`the spec evaluates role ${specFile.spec.evaluate_on_role}; --role=${args.role} was asked\n`);
  process.exit(3);
}

const languages = collectLanguages(manifest.fixtures, { role: args.role });
const probeLanguages = languages.length > 0 ? languages : ["eng"];
const candidates = [
  makeTesseractCandidate(fixturesRoot, { required_languages: probeLanguages }),
  makePaddleOcrOnnxCandidate(fixturesRoot, { required_languages: probeLanguages }),
  makeLawbarOcrVisionCandidate(fixturesRoot, { required_languages: probeLanguages }),
  makeLawbarOcrPdfkitLayerCandidate(fixturesRoot, { required_languages: probeLanguages }),
];

const report = await runBakeoff({ candidates, fixtures: manifest.fixtures, roleFilter: args.role, fixturesRoot, timeout_ms: 60_000 });
if (!report.observations.some((o) => o.outcome === "success")) {
  process.stderr.write("no candidate produced a success observation; nothing to judge\n");
  process.exit(2);
}

const git = spawnSync("git", ["-C", pkgRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
const gitSha = git.status === 0 ? git.stdout.trim() : null;
const manifestSha256 = sha256Hex(readFileSync(join(fixturesRoot, "manifest.json")));

let result;
try {
  result = buildVerdict({
    report,
    fixtures: manifest.fixtures,
    expectedText: (f) => readFileSync(join(fixturesRoot, f.expected_text_path), "utf8"),
    spec: specFile.spec,
    specSha256: specFile.sha256,
    manifestSha256,
    root,
    gitSha,
  });
  assertCommittable(result);
} catch (err) {
  if (err instanceof VerdictSpecError) { process.stderr.write(`verdict refused: ${err.message}\n`); process.exit(2); }
  throw err;
}

const outPath = resolve(args.out);
mkdirSync(dirname(outPath), { recursive: true });
if (existsSync(outPath)) { process.stderr.write(`refusing to overwrite ${outPath}; results are append-only, choose a new name\n`); process.exit(3); }
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

for (const s of result.slots) {
  process.stderr.write(`slot ${s.slot}: ${s.awarded_to ?? "UNFILLED"}${s.tie ? ` (tie: ${s.tie.join(", ")})` : ""}; ranking ${s.ranking.join(" > ") || "-"}\n`);
}
process.stderr.write(`control: ${result.control ?? "none"}\nwritten ${outPath}\n`);
process.exit(0);
