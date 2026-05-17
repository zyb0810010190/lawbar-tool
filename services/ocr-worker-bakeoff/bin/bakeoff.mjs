#!/usr/bin/env node
// Bakeoff CLI. Default: score smoke fixtures with the Tesseract candidate.
// Verdict role (ε) flips `--role=verdict` explicitly.
//
// Usage:
//   node bin/bakeoff.mjs [--role=smoke|verdict] [--lang=eng] [--fixture-id=<id>]
//
// Exit codes:
//   0 — at least one successful observation
//   2 — every observation failed or probe unavailable
//   3 — bad CLI args

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeTesseractCandidate } from "../dist/harnesses/tesseract.js";
import { runBakeoff } from "../dist/runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");

function parseArgs(argv) {
  const out = { role: "smoke", lang: undefined, fixtureId: undefined };
  for (const tok of argv) {
    if (tok.startsWith("--role=")) out.role = tok.slice("--role=".length);
    else if (tok.startsWith("--lang=")) out.lang = tok.slice("--lang=".length);
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

const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.json"), "utf8"));
const fixtures = args.fixtureId
  ? manifest.fixtures.filter((f) => f.id === args.fixtureId)
  : manifest.fixtures;

const candidate = makeTesseractCandidate(fixturesRoot);

const report = await runBakeoff({
  candidates: [candidate],
  fixtures,
  roleFilter: args.role,
  fixturesRoot,
});

process.stdout.write(JSON.stringify(report, null, 2) + "\n");

const anySuccess = report.observations.some((o) => o.outcome === "success");
process.exit(anySuccess ? 0 : 2);
