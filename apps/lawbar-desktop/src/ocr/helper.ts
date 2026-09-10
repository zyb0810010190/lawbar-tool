// The OCR helper boundary (product plan R3, WI-12 step 2).
//
// `lawbar-ocr` is a system-framework Swift executable (PDFKit + Vision) that the app ships inside
// its own bundle and runs as a subprocess. This module is the ONLY place that decides which
// executable that is, how long it may run, and whether its output is believed. Three rules,
// each from the plan's adversarial review:
//
// 1. WHERE. Packaged, the helper is resolved from `<app>/Contents/Resources/helpers/lawbar-ocr` and
//    nowhere else — never from PATH, never from the development tree, never from a stray unpacked
//    copy. In development it is `apps/lawbar-desktop/build/helpers/lawbar-ocr`, which
//    `npm run build:helper` stages.
// 2. HOW LONG. A wall-clock deadline, enforced by killing the helper's PROCESS GROUP (detached
//    spawn, SIGTERM then SIGKILL after a grace), so a hang, a SIGTERM-ignoring helper, or a child it
//    spawned cannot survive. Ported from the bake-off harness, including the audit fix that cancels
//    the SIGKILL timer on close so it can never fire against a recycled process group.
// 3. WHETHER TO BELIEVE IT. Three digests must agree before a record is used. The PIN is the
//    digest of the helper this app build was made with, written by scripts/build-ocr-helper.mjs
//    into dist/src/ocr/helper-pin.json and packaged inside the asar with this code. The EXECUTABLE
//    digest is the sha256 of the file this module resolved. The SELF-REPORT is what the helper says
//    about itself in every record. pin ≠ executable is `helper_stale` (the helper on disk is not the
//    one this build shipped — a stale staging, a swapped resource); self-report ≠ executable is
//    `helper_identity_mismatch` (whatever answered was not the file on disk). A self-report alone
//    would prove nothing — any replacement can hash itself — which is why the pin exists.
//    That three-way equality is the assertion the packaged acceptance makes from a relocated copy
//    of the app with PATH empty.
//
// Codes cross the IPC boundary; nothing here forwards a path or a raw message to the renderer.

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export type HelperFailureCode =
  | "helper_missing"
  | "helper_not_executable"
  | "helper_timeout"
  | "helper_exit"
  | "helper_bad_output"
  | "helper_unreadable"
  | "helper_unpinned"
  | "helper_stale"
  | "helper_identity_mismatch";

export interface HelperProbe {
  readonly helper_build_digest: string;
  readonly helper_version: string;
  readonly os_version: string;
  readonly os_build: string;
  readonly arch: string;
  readonly vision_languages: ReadonlyArray<string>;
  readonly roundtrip_ms: number | null;
  readonly roundtrip_text: string | null;
}

export type ProbeResult =
  | { readonly ok: true; readonly probe: HelperProbe; readonly executable_digest: string; readonly elapsed_ms: number }
  | { readonly ok: false; readonly code: HelperFailureCode; readonly elapsed_ms: number };

export type SpawnLike = (command: string, args: ReadonlyArray<string>, options: SpawnOptions) => ChildProcess;

export interface HelperDeps {
  /** Absolute path of the executable this app is allowed to run. */
  readonly helperPath: string;
  /** sha256 of the helper this app build was made with (the pin); null when the pin is unreadable. */
  readonly pinnedDigest: string | null;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to node:child_process.spawn. */
  readonly spawn?: SpawnLike;
  /** Grace between SIGTERM and SIGKILL. */
  readonly killGraceMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_KILL_GRACE_MS = 1_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024; // a page's lines; anything larger is not a helper record

/**
 * Where the helper lives. Packaged: inside the bundle's Resources, and ONLY there. Development:
 * the staged build under apps/lawbar-desktop/build/helpers. Both are absolute; neither consults PATH.
 */
export function resolveHelperPath(input: { readonly isPackaged: boolean; readonly resourcesPath: string; readonly appPath: string }): string {
  return input.isPackaged
    ? path.join(input.resourcesPath, "helpers", "lawbar-ocr")
    : path.join(input.appPath, "build", "helpers", "lawbar-ocr");
}

export function sha256OfFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Read the pin written by build-ocr-helper.mjs. Anything but a well-formed 64-hex digest is null. */
export function readPinnedDigest(pinFile: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(pinFile, "utf8"));
    const d = (parsed as { sha256?: unknown } | null)?.sha256;
    return typeof d === "string" && /^[0-9a-f]{64}$/.test(d) ? d : null;
  } catch {
    return null;
  }
}

interface RunOutcome {
  readonly stdout: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
  /** The helper exceeded the output cap and was killed; nothing it wrote is kept. */
  readonly overflow: boolean;
}

/** Run the helper under the deadline. Never throws; every failure is a field. */
export async function runHelper(deps: HelperDeps, args: ReadonlyArray<string>): Promise<RunOutcome> {
  const spawn = deps.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const graceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  let proc: ChildProcess;
  try {
    // detached: its own process group, so `kill(-pgid)` reaches the whole tree. PATH is emptied on
    // purpose: the helper needs no tool, and a helper that did would have to say so, not find one.
    proc = spawn(deps.helperPath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "" } });
  } catch {
    return { stdout: "", exitCode: null, signal: null, timedOut: false, spawnFailed: true, overflow: false };
  }
  // The error listener goes on FIRST. A failed exec reports asynchronously as an `error` event with
  // no pid; returning before listening would leave that event unhandled and take main down with it.
  let spawnFailed = false;
  const failed = new Promise<void>((resolve) => { proc.once("error", () => { spawnFailed = true; resolve(); }); });
  if (proc.pid === undefined) {
    await failed;
    return { stdout: "", exitCode: null, signal: null, timedOut: false, spawnFailed: true, overflow: false };
  }
  const pgid = proc.pid;
  const chunks: Buffer[] = [];
  let received = 0;
  let overflow = false;
  const killGroup = (sig: NodeJS.Signals): void => { try { process.kill(-pgid, sig); } catch { /* ESRCH: already gone */ } };
  proc.stdout?.on("data", (b: Buffer) => {
    if (overflow) return;
    if (received + b.length > MAX_OUTPUT_BYTES) {
      // A helper that floods is not producing a record. Stop it now rather than reading until the
      // deadline; nothing it said is kept.
      overflow = true;
      chunks.length = 0;
      killGroup("SIGKILL");
      return;
    }
    chunks.push(b);
    received += b.length;
  });
  proc.stderr?.on("data", () => { /* diagnostics stay in the helper; nothing crosses */ });

  let timedOut = false;
  let sigkillHandle: NodeJS.Timeout | undefined;
  let forceResolve: (() => void) | undefined;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    killGroup("SIGTERM");
    sigkillHandle = setTimeout(() => {
      killGroup("SIGKILL");
      // If something escaped the group (a descendant that made its own session) and still holds our
      // pipe, `close` would never fire. The deadline is the deadline: drop the pipes and return.
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      forceResolve?.();
    }, graceMs);
  }, timeoutMs);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    forceResolve = () => resolve({ code: proc.exitCode, signal: proc.signalCode });
    proc.once("close", (code, signal) => resolve({ code, signal }));
    void failed.then(() => resolve({ code: null, signal: null }));
  });
  clearTimeout(timeoutHandle);
  if (sigkillHandle !== undefined) clearTimeout(sigkillHandle); // never fire against a recycled pgid
  if (timedOut) {
    // Belt and braces: whatever is left of the group dies now, not after a grace we will not wait for.
    killGroup("SIGKILL");
  }
  // Decode ONCE: a multi-byte character split across chunks must not become replacement characters.
  const stdout = overflow ? "" : Buffer.concat(chunks).toString("utf8");
  return { stdout, exitCode: exit.code, signal: exit.signal, timedOut, spawnFailed, overflow };
}

function checkExecutable(file: string): HelperFailureCode | null {
  // lstat, not stat: a symlink at the bundle path is NOT the file inside the bundle, wherever it
  // points. Only a regular file in place is a helper.
  try {
    const st = lstatSync(file);
    if (!st.isFile()) return "helper_missing";
  } catch {
    return "helper_missing";
  }
  try { accessSync(file, constants.X_OK); } catch { return "helper_not_executable"; }
  return null;
}

function isProbeRecord(v: unknown): v is HelperProbe & { kind: string } {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.kind === "probe" && typeof r.helper_build_digest === "string" && /^[0-9a-f]{64}$/.test(r.helper_build_digest)
    && typeof r.helper_version === "string" && typeof r.os_version === "string" && typeof r.os_build === "string"
    && typeof r.arch === "string" && Array.isArray(r.vision_languages) && r.vision_languages.every((l) => typeof l === "string");
}

/**
 * Probe the helper and PROVE its identity: pin == bytes of the executable at `helperPath` == the
 * helper's self-reported digest. Only then is the probe returned. The pin is checked BEFORE the
 * helper runs: a helper this build did not ship is never executed.
 */
export async function probeHelper(deps: HelperDeps, options: { readonly roundtrip?: boolean } = {}): Promise<ProbeResult> {
  const t0 = Date.now();
  if (deps.pinnedDigest === null) return { ok: false, code: "helper_unpinned", elapsed_ms: Date.now() - t0 };
  const pre = checkExecutable(deps.helperPath);
  if (pre !== null) return { ok: false, code: pre, elapsed_ms: Date.now() - t0 };
  let executableDigest: string;
  try {
    executableDigest = sha256OfFile(deps.helperPath);
  } catch {
    // Execute-only, or gone between the check and the read: a code, never the filesystem's words.
    return { ok: false, code: "helper_unreadable", elapsed_ms: Date.now() - t0 };
  }
  if (executableDigest !== deps.pinnedDigest) return { ok: false, code: "helper_stale", elapsed_ms: Date.now() - t0 };
  const out = await runHelper(deps, options.roundtrip ? ["probe", "--roundtrip"] : ["probe"]);
  const elapsed = Date.now() - t0;
  if (out.spawnFailed) return { ok: false, code: "helper_not_executable", elapsed_ms: elapsed };
  if (out.timedOut) return { ok: false, code: "helper_timeout", elapsed_ms: elapsed };
  // Overflow before exit code: the kill that stops a flood is ours, and the finding is "not a record".
  if (out.overflow) return { ok: false, code: "helper_bad_output", elapsed_ms: elapsed };
  if (out.exitCode !== 0) return { ok: false, code: "helper_exit", elapsed_ms: elapsed };
  // The protocol is ONE record on ONE line. Extra lines — a second record, a chatty prefix — are
  // not tolerated into acceptance; they are refused.
  const lines = out.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  let parsed: unknown;
  try { parsed = lines.length === 1 ? JSON.parse(lines[0]) : undefined; } catch { parsed = undefined; }
  if (!isProbeRecord(parsed)) return { ok: false, code: "helper_bad_output", elapsed_ms: elapsed };
  if (parsed.helper_build_digest !== executableDigest) return { ok: false, code: "helper_identity_mismatch", elapsed_ms: elapsed };
  const probe: HelperProbe = {
    helper_build_digest: parsed.helper_build_digest,
    helper_version: parsed.helper_version,
    os_version: parsed.os_version,
    os_build: parsed.os_build,
    arch: parsed.arch,
    vision_languages: [...parsed.vision_languages],
    roundtrip_ms: typeof (parsed as { roundtrip_ms?: unknown }).roundtrip_ms === "number" ? (parsed as { roundtrip_ms: number }).roundtrip_ms : null,
    roundtrip_text: typeof (parsed as { roundtrip_text?: unknown }).roundtrip_text === "string" ? (parsed as { roundtrip_text: string }).roundtrip_text : null,
  };
  return { ok: true, probe, executable_digest: executableDigest, elapsed_ms: elapsed };
}
