#!/usr/bin/env node
// Bakeoff CLI. Default: score smoke fixtures with the Tesseract candidate.
// Verdict role (ε) flips `--role=verdict` explicitly.
//
// Usage:
//   node bin/bakeoff.mjs [--role=smoke|verdict] [--fixture-id=<id>]
//
// Each fixture declares its own language as a BCP-47 tag in
// fixtures/manifest.json (e.g. `zh-Hans`); the harness resolves the tag
// to its engine-specific model name (e.g. `chi_sim` for Tesseract) via
// the per-engine mapping. There is intentionally NO --lang CLI override
// — the fixture is the source of truth.
//
// Exit codes:
//   0 — at least one successful observation
//   2 — every observation failed or probe unavailable
//   3 — bad CLI args

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeTesseractCandidate } from "../dist/harnesses/tesseract.js";
import { makePaddleOcrOnnxCandidate } from "../dist/harnesses/paddleocr-onnx.js";
import { runBakeoff } from "../dist/runner.js";
import { loadManifest, ManifestValidationError, collectLanguages } from "../dist/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");

function parseArgs(argv) {
  const out = { role: "smoke", fixtureId: undefined };
  for (const tok of argv) {
    if (tok.startsWith("--role=")) out.role = tok.slice("--role=".length);
    else if (tok.startsWith("--fixture-id=")) out.fixtureId = tok.slice("--fixture-id=".length);
    else {
      process.stderr.write(`unknown arg: ${tok}\n`);
      process.exit(3);
    }
  }
  if (!["smoke", "verdict"].includes(out.role)) {
    process.stderr.write(`--role must be smoke|verdict (got ${out.role})\n`);
    process.exit(3);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

let manifest;
try {
  manifest = loadManifest(fixturesRoot);
} catch (err) {
  if (err instanceof ManifestValidationError) {
    process.stderr.write(`manifest validation failed: ${err.message}\n`);
    process.exit(2);
  }
  throw err;
}
const fixtures = args.fixtureId
  ? manifest.fixtures.filter((f) => f.id === args.fixtureId)
  : manifest.fixtures;

// Audit 019e3854 F1: derive the required BCP-47 language tags from the
// active fixtures the runner will actually process, so the candidate's
// preflight (probe) checks every model it will be asked to load. Without
// this wiring, a missing chi_sim model would surface as a generic
// runtime exit instead of a structured `missing_model` ProbeResult.
const requiredLanguages = collectLanguages(fixtures, { role: args.role });
// Fall back to `["eng"]` if no active fixtures match the role filter,
// so the harness still has a sensible probe target.
const probeLanguages = requiredLanguages.length > 0 ? requiredLanguages : ["eng"];

const tesseract = makeTesseractCandidate(fixturesRoot, {
  required_languages: probeLanguages,
});
const paddleocrOnnx = makePaddleOcrOnnxCandidate(fixturesRoot, {
  required_languages: probeLanguages,
});

const report = await runBakeoff({
  candidates: [tesseract, paddleocrOnnx],
  fixtures,
  roleFilter: args.role,
  fixturesRoot,
  timeout_ms: 60_000,
});

process.stdout.write(JSON.stringify(report, null, 2) + "\n");

const anySuccess = report.observations.some((o) => o.outcome === "success");
process.exit(anySuccess ? 0 : 2);
