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
// END-ANCHORED ($, no m flag) so the WHOLE trimmed string must be exactly the documented output:
// an unexpected trailing suffix or extra line (e.g. "FileVault is On: weird", "FileVault is On.\n…")
// classifies as "unknown" rather than being prefix-matched to on/off — a fail-OPEN this probe must
// avoid (decideAction("unknown","production") === "block"; AT1-L1).
export function parseFdesetupStatus(raw: string): "on" | "off" | "unknown" {
  const normalized = raw.trim();
  if (/^FileVault is On\.?$/i.test(normalized)) return "on";
  if (/^FileVault is Off\.?$/i.test(normalized)) return "off";
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

// ---- the blocking dialog's text ----------------------------------------------------------
//
// Pure, so the wording is testable rather than buried in an Electron callback.
//
// Rewritten 2026-08-24, for two defects in the message this replaces.
//
// FIRST: it was in ENGLISH, alone among the main-process dialogs. Every refusal in
// startupFailure.ts is zh-CN, matching a UI whose locale is fixed at zh-CN (plan-i18n-impl-00 D1).
// The one dialog a litigator most needs to understand was the one they could not read.
//
// SECOND, and worse: its second sentence offered `LAWBAR_MODE=dev` as an apparently co-equal
// remedy — "Enable FileVault …, or set LAWBAR_MODE=dev". That hands someone under time pressure a
// one-line bypass of the control protecting client confidentiality, presented as an alternative
// rather than as a development-only escape. The safe path now leads, and the bypass is named for
// what it is.
//
// The explanation of WHY is load-bearing. On Apple Silicon and T2 Macs `diskutil` reports the
// volume as "encrypted at rest" even with FileVault off, so a reader who knows that will
// reasonably conclude the block is pedantic and reach for dev mode. It is not pedantic: without
// FileVault the volume key is not wrapped by a user secret, so the disk unlocks at boot with no
// password. The control is not "is anything encrypted" but "is privileged material behind a
// user-authenticated boundary".
//
// The hardware claim is phrased CONDITIONALLY on purpose. This app also ships an x64 build, and an
// older Intel Mac without a T2 has no such at-rest encryption — asserting it unconditionally would
// be a false claim in exactly the class this repo exists to avoid.
export function fileVaultBlockMessage(
  state: FileVaultState,
  probeError?: string,
): { readonly title: string; readonly detail: string } {
  const confirmedOff = state === "off";
  const title = confirmedOff ? "需要开启 FileVault 全盘加密" : "无法确认 FileVault 状态";

  const opening = confirmedOff
    ? "lawbar 已停止启动：本机未开启 FileVault 全盘加密。"
    : "lawbar 已停止启动：无法确认本机的 FileVault 状态，按未开启处理。";

  const why =
    "案件数据含当事人保密信息，必须在您的登录密码保护下静态加密。\n\n" +
    "若本机为 Apple 芯片或带 T2 芯片的机型，磁盘本身已由硬件加密——但未开启 FileVault 时，" +
    "卷密钥并未与您的登录密码绑定：开机即自动解锁，设备一旦遗失或被他人取走，案件数据不受密码保护。" +
    "FileVault 的作用正是把密钥绑定到密码。";

  const how =
    "开启方式：系统设置 → 隐私与安全性 → FileVault → 打开。\n" +
    "Apple 芯片机型几乎瞬间完成（磁盘本已加密，只是改用密码重新封装密钥），无需长时间转换。\n" +
    "请务必妥善保存恢复密钥——丢失后数据无法找回。";

  const dev =
    "（LAWBAR_MODE=dev 仅供开发调试时绕过本检查，切勿在处理真实当事人材料时使用。）";

  const detail = [
    opening,
    why,
    how,
    `检测到的状态：${state}`,
    ...(probeError !== undefined ? [`检测错误：${probeError}`] : []),
    dev,
  ].join("\n\n");

  return { title, detail };
}
