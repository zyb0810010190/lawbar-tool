#!/usr/bin/env node
// evaluate.mjs — run lawbar against a SEALED synthetic profile, for trialling the workflow.
//
// WHY THIS EXISTS. The production launch gate requires FileVault, because the app holds privileged
// client material at rest. That gate is correct and is not weakened here. But it also means the
// tool cannot be tried at all until FileVault is enabled — a decision with a recovery-key
// obligation that a person may reasonably want to make AFTER seeing whether the tool is worth it.
//
// This resolves that ordering problem without touching the gate. The FileVault precondition exists
// to protect PRIVILEGED MATERIAL. With no privileged material present, it is not engaged. So this
// runs dev mode against a profile that is structurally incapable of reaching the real case store.
//
// THE SEAL IS STRUCTURAL, NOT ADVISORY. That distinction is the whole point:
//   - a SEPARATE profile directory, so the app cannot see or write real matters at all;
//   - a refusal, checked against the resolved real path, if the two ever coincide;
//   - a non-dismissable in-app banner (renderer/devModeBanner.ts) naming the mode and the
//     directory, so an evaluation window can never be mistaken for the real one.
//
// What it CANNOT do is stop someone typing a real client's name into the synthetic profile. No code
// can. What it does guarantee is that real use cannot happen silently in the real store while the
// FileVault gate is bypassed.
//
// This is deliberately NOT "run lawbar with a flag". A documented bypass would normalise dev mode;
// a separate, named, guarded entry point with its own profile does not.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const EXIT_OK = 0;
export const EXIT_REFUSED = 2;

const APP_SUPPORT = path.join(os.homedir(), "Library", "Application Support");

/** The live case store. Never a launch target here — named only so it can be refused. */
export function realProfileDir() {
  return path.join(APP_SUPPORT, "lawbar");
}

/**
 * The evaluation profile. PERSISTENT on purpose: a workflow trial spans days — create a matter,
 * add a deadline tomorrow, see how the audit chain reads next week. A throwaway directory would
 * make the one thing being evaluated impossible to evaluate. `--reset` empties it on demand.
 */
export function evaluationProfileDir() {
  return path.join(APP_SUPPORT, "lawbar-evaluation");
}

/**
 * Refuse when the evaluation profile is, or resolves to, the real one. Compared through
 * `realpathSync` because a symlink at either end would otherwise defeat a plain string check —
 * the same reason the Electron test guards resolve before comparing.
 */
export function assertNotRealProfile(evalDir, realDir) {
  const resolve = (p) => (existsSync(p) ? realpathSync(p) : path.resolve(p));
  if (resolve(evalDir) === resolve(realDir)) {
    throw new Error(
      "REFUSING: the evaluation profile resolves to the real case store.\n" +
      `  evaluation: ${evalDir}\n  real:       ${realDir}\n` +
      "Dev mode skips the FileVault gate, so it must never point at privileged material.",
    );
  }
}

/** The packaged .app if one was built, else null — in which case we run from source. */
export function findPackagedBinary(projectRoot) {
  for (const dir of ["release/mac-arm64", "release/mac", "dist/mac-arm64", "dist/mac"]) {
    const bin = path.join(projectRoot, dir, "lawbar.app", "Contents", "MacOS", "lawbar");
    if (existsSync(bin)) return bin;
  }
  return null;
}

export function parseArgs(argv) {
  const out = { reset: false };
  for (const a of argv) {
    if (a === "--reset") out.reset = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function banner(profile, binary) {
  return [
    "",
    "  lawbar — SYNTHETIC EVALUATION",
    "",
    "  Mode:     dev (the FileVault gate is SKIPPED)",
    "  Profile:  " + profile,
    "  Binary:   " + (binary ?? "from source (electron .)"),
    "",
    "  This profile is separate from your real case store, which this run cannot",
    "  see or write. Use synthetic matters only — do not enter real client material",
    "  while the FileVault gate is bypassed.",
    "",
    "  To use lawbar for real work: enable FileVault, then launch it normally.",
    "  To empty this profile:       npm run evaluate -- --reset",
    "",
  ].join("\n");
}

export function main(argv, projectRoot) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\nusage: evaluate.mjs [--reset]\n`);
    return EXIT_REFUSED;
  }

  const profile = evaluationProfileDir();
  try {
    assertNotRealProfile(profile, realProfileDir());
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return EXIT_REFUSED;
  }

  if (args.reset && existsSync(profile)) {
    rmSync(profile, { recursive: true, force: true });
    process.stdout.write(`  emptied ${profile}\n`);
  }
  mkdirSync(profile, { recursive: true });

  const binary = findPackagedBinary(projectRoot);
  process.stdout.write(banner(profile, binary));

  const [cmd, cmdArgs] = binary !== null
    ? [binary, [`--user-data-dir=${profile}`]]
    : ["npx", ["electron", ".", `--user-data-dir=${profile}`]];

  const child = spawn(cmd, cmdArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, LAWBAR_MODE: "dev" },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return EXIT_OK;
}

/** How many entries the evaluation profile holds — used by tests and by --reset reporting. */
export function profileEntryCount(dir) {
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = path.dirname(new URL(import.meta.url).pathname);
  main(process.argv.slice(2), path.resolve(here, ".."));
}
