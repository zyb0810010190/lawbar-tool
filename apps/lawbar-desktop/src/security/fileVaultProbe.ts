// Tier 1 FileVault enforcement (per dev-memo/plan-encryption-at-rest-00.md §4.1).
// macOS-only. Uses `fdesetup status` to detect FileVault state at app launch.
// Production mode: BLOCK launch when FileVault is not enabled.
// Dev mode: WARN only, do not block.
// Non-macOS: skip (returns "non-macos"; safe default = proceed).
//
// Zero new runtime dependencies. Pure parse + pure decide functions are
// exported for unit testing. The async probeFileVault wraps macOS
// `fdesetup status` via child_process.execFile with a hard timeout and
// an injectable executor (testing seam).

import { execFile as nodeExecFile } from "node:child_process";

export type FileVaultState = "on" | "off" | "unknown" | "non-macos";
export type LaunchMode = "production" | "dev";
export type LaunchAction = "proceed" | "warn" | "block";

export interface FileVaultProbeResult {
  readonly state: FileVaultState;
  readonly raw?: string;
  readonly error?: string;
}

// Pure: parse `fdesetup status` stdout. Normal macOS output is either
//   "FileVault is On."
//   "FileVault is Off."
// Anything else (e.g. "Decryption in Progress.", empty, garbage) → "unknown".
export function parseFdesetupStatus(raw: string): "on" | "off" | "unknown" {
  const normalized = raw.trim();
  if (/^FileVault is On\.?/i.test(normalized)) return "on";
  if (/^FileVault is Off\.?/i.test(normalized)) return "off";
  return "unknown";
}

// Pure: resolve LaunchMode from env. LAWBAR_MODE=dev → dev; anything else
// (unset, "production", empty, malformed) → production. Defaults to the
// stricter posture per plan §4.1 — production fails closed.
export function resolveMode(env: { LAWBAR_MODE?: string | undefined }): LaunchMode {
  return env.LAWBAR_MODE === "dev" ? "dev" : "production";
}

// Pure: decide launch action from state + mode. Action matrix:
//
//   state \ mode    production    dev
//   on              proceed       proceed
//   off             block         warn
//   unknown         block         warn
//   non-macos       proceed       proceed
//
// "unknown" maps to "off" semantics in production (fail-closed): if
// fdesetup is missing, denied, or returns unrecognized text, we cannot
// prove FileVault is on, so we treat it as off.
export function decideAction(state: FileVaultState, mode: LaunchMode): LaunchAction {
  if (state === "non-macos") return "proceed";
  if (state === "on") return "proceed";
  return mode === "production" ? "block" : "warn";
}

interface ExecFileLike {
  (
    cmd: string,
    args: readonly string[],
    options: { timeout?: number },
    callback: (
      err: (Error & { code?: number | string }) | null,
      stdout: string,
      stderr: string,
    ) => void,
  ): unknown;
}

export interface ProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly execFile?: ExecFileLike;
  readonly timeoutMs?: number;
}

// Async: run macOS `fdesetup status`. Skips immediately on non-darwin.
// 3s default timeout — fdesetup is local + synchronous; 3s tolerates
// slow disk without hanging the launch path.
export async function probeFileVault(
  options: ProbeOptions = {},
): Promise<FileVaultProbeResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return { state: "non-macos" };
  }
  const execFile = options.execFile ?? (nodeExecFile as unknown as ExecFileLike);
  const timeoutMs = options.timeoutMs ?? 3_000;
  return await new Promise<FileVaultProbeResult>((resolve) => {
    try {
      execFile(
        "/usr/bin/fdesetup",
        ["status"],
        { timeout: timeoutMs },
        (err, stdout, stderr) => {
          if (err !== null) {
            resolve({
              state: "unknown",
              raw: stdout ?? "",
              error: `fdesetup failed: ${err.message}${stderr !== "" ? ` | stderr=${stderr.trim()}` : ""}`,
            });
            return;
          }
          resolve({ state: parseFdesetupStatus(stdout), raw: stdout });
        },
      );
    } catch (e) {
      resolve({
        state: "unknown",
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
  });
}
