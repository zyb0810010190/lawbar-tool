#!/usr/bin/env node
// build-ocr-helper.mjs — build the system-framework OCR helper and stage it for packaging (R3, WI-12 step 2).
//
// `lawbar-ocr` lives in native/evidence-core-swift (PDFKit + Vision, zero third-party deps). This
// script builds it as a UNIVERSAL release binary (arm64 + x86_64 — electron-builder packages both
// arches from one tree), copies it to apps/lawbar-desktop/build/helpers/, and writes its sha256
// beside it. electron-builder's `extraResources` then places it at
// <app>.app/Contents/Resources/helpers/lawbar-ocr — outside the asar, mode preserved.
//
// Two digests leave here. The sidecar `lawbar-ocr.sha256` beside the binary is for humans and the
// release notes. The PIN `dist/src/ocr/helper-pin.json` is for the app: it is packaged INSIDE the
// asar with the main-process code, so the app build carries the digest of the helper it was built
// with. At run time main requires three things to agree — the pin, the bytes of the executable it
// resolved, and the digest the helper reports about itself (src/ocr/helper.ts). A stale helper
// left in build/helpers, or a bundle whose Resources were swapped, is refused by the pin; the
// self-report proves the process that answered is that file.
//
// Fail-closed: any step that does not produce a runnable universal binary exits non-zero, so a
// `dist` that reaches electron-builder has a helper in place. Exit codes: 0 ok; 1 build/copy failed;
// 2 swift toolchain missing.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..");
const REPO = path.resolve(APP, "..", "..");
const PKG = path.join(REPO, "native", "evidence-core-swift");
const OUT_DIR = path.join(APP, "build", "helpers");
const OUT = path.join(OUT_DIR, "lawbar-ocr");
const PIN = path.join(APP, "dist", "src", "ocr", "helper-pin.json");

function log(msg) { process.stderr.write(`[build-ocr-helper] ${msg}\n`); }

const which = spawnSync("swift", ["--version"], { encoding: "utf8" });
if (which.error || which.status !== 0) {
  log("swift toolchain not found — install Xcode Command Line Tools");
  process.exit(2);
}

log("swift build -c release --product lawbar-ocr --arch arm64 --arch x86_64");
const build = spawnSync("swift", ["build", "-c", "release", "--product", "lawbar-ocr", "--arch", "arm64", "--arch", "x86_64"], {
  cwd: PKG,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (build.status !== 0) {
  log(`swift build failed (exit ${build.status})\n${(build.stderr || "").split("\n").slice(-20).join("\n")}`);
  process.exit(1);
}

const built = path.join(PKG, ".build", "apple", "Products", "Release", "lawbar-ocr");
if (!existsSync(built)) {
  log(`expected universal product missing: ${built}`);
  process.exit(1);
}

// Prove it is universal and runs before staging it — a single-arch binary would package fine and
// fail on the other architecture's machine.
const lipo = spawnSync("lipo", ["-archs", built], { encoding: "utf8" });
const archs = (lipo.stdout || "").trim().split(/\s+/).sort();
if (lipo.status !== 0 || archs.join(",") !== "arm64,x86_64") {
  log(`not a universal binary: lipo -archs → ${JSON.stringify(archs)}`);
  process.exit(1);
}
// A deadline, so a wedged probe fails the build instead of hanging it; and a real parse of the one
// JSON line, so "answers probe" means a complete record whose self-digest is the bytes just built.
const builtDigest = createHash("sha256").update(readFileSync(built)).digest("hex");
const probe = spawnSync(built, ["probe"], { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", env: { PATH: "" } });
const lines = (probe.stdout || "").split("\n").filter((l) => l.trim() !== "");
let record = null;
try { record = lines.length === 1 ? JSON.parse(lines[0]) : null; } catch { record = null; }
if (probe.status !== 0 || record === null || record.kind !== "probe"
  || record.helper_build_digest !== builtDigest
  || !Array.isArray(record.vision_languages) || typeof record.helper_version !== "string") {
  log(`built helper does not answer probe correctly (exit ${probe.status}, signal ${probe.signal}, ${lines.length} line(s))`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(built, OUT);
chmodSync(OUT, 0o755);
const digest = createHash("sha256").update(readFileSync(OUT)).digest("hex");
if (digest !== builtDigest) {
  log("staged bytes differ from the built product");
  process.exit(1);
}
writeFileSync(`${OUT}.sha256`, `${digest}  lawbar-ocr\n`);
// The pin goes into dist/, which `npm run build` produces first (pretest and dist run build, then
// build:helper). Without dist/ there is nothing for the pin to ship with: fail, do not create it.
if (!existsSync(path.dirname(PIN))) {
  log(`dist/src/ocr missing — run npm run build before build:helper`);
  process.exit(1);
}
writeFileSync(PIN, `${JSON.stringify({ sha256: digest, size: statSync(OUT).size, archs, helper_version: record.helper_version }, null, 2)}\n`);
log(`staged ${path.relative(APP, OUT)} (${statSync(OUT).size} bytes, ${archs.join("+")}) sha256 ${digest.slice(0, 16)}…; pinned in ${path.relative(APP, PIN)}`);
