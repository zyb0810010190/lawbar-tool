// WI-07 — a refused database open must reach the litigator.
//
// WI-03 classifies four distinct refusals and writes a truthful message for each. Until
// this module existed, `electron/main.ts` called `getCaseBoxRuntime` outside any try, so
// every one of them threw unhandled inside `whenReady`: no window, no dialog, no
// explanation. The refusal, the preserved copy and the `.verified` marker were all produced
// correctly and then discarded.
//
// Shape follows `src/security/fileVaultProbe.ts`, the other startup gate that can block
// launch: a pure decision function plus an injected host, so the behaviour is unit-testable
// with no Electron runtime.
//
// ON DETAIL. These strings deliberately carry the raw diagnostic, which is the OPPOSITE of
// the renderer's SAFE_MESSAGES allowlist. That allowlist exists because the renderer must
// never see paths or identifiers. A native dialog on the owner's own machine is the inverse
// case: the message names the `.repair-` directory holding the preserved copy, and
// withholding it would put WI-03's forensic output out of reach of the one person entitled
// to it.
//
// ON LANGUAGE. zh-CN, matching `renderer/i18n/catalog.ts`, because the reader is the
// litigator. The older FileVault dialog in `main.ts` is still English — a pre-existing
// inconsistency this work item neither widens nor fixes.

export interface StartupFailure {
  readonly title: string;
  readonly detail: string;
}

/** The Electron surfaces this needs, injected so the decision can be tested without them. */
export interface StartupHost {
  showErrorBox(title: string, content: string): void;
  quit(): void;
}

// Maps, not object literals: a plain record answers `TITLES["constructor"]` with a function,
// so a crafted `err.code` could pass a `code in TITLES` test and reach the dialog. This repo
// has already had one prototype-pollution hardening pass; do not reintroduce the shape.
const TITLES = new Map<string, string>([
  ["database_corrupt", "案件数据库未通过完整性校验"],
  ["database_locked", "案件数据库正被占用"],
  ["database_not_case_box", "该文件不是 lawbar 案件数据库"],
  ["database_unavailable", "无法打开案件数据库"],
]);

const GUIDANCE = new Map<string, string>([
  ["database_corrupt",
   "已停止打开，以免向不可信的数据库写入。请从备份恢复；若上方信息中列出了 .repair- 目录，" +
   "其中保存着原始文件的副本，请勿删除。"],
  ["database_locked",
   "请关闭另一个 lawbar 窗口后重试。数据库本身并未被检查，也没有迹象表明它有问题。"],
  ["database_not_case_box",
   "已停止打开，以免把案件表写进他人的数据库。请选择正确的案件文件。"],
  ["database_unavailable",
   "请检查文件路径与访问权限后重试。数据库本身并未被检查，也没有迹象表明它有问题。"],
]);

/**
 * Read a property off a value that may be anything at all. This runs inside a catch block
 * during startup, so a throwing getter must not replace a readable refusal with a fresh
 * unhandled exception — which is the very failure this module exists to remove.
 */
function readString(value: unknown, key: "code" | "message"): string | null {
  try {
    const raw = (value as Record<string, unknown> | null | undefined)?.[key];
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

/** Returns null for anything that is not one of WI-03's refusals — including our own bugs. */
export function describeStartupFailure(err: unknown): StartupFailure | null {
  const code = readString(err, "code");
  if (code === null) return null;
  const title = TITLES.get(code);
  const guidance = GUIDANCE.get(code);
  if (title === undefined || guidance === undefined) return null;
  const message = readString(err, "message");
  return {
    title,
    detail: message === null ? guidance : `${message}\n\n${guidance}`,
  };
}

/**
 * True when the error was a startup refusal and has been presented to the user. False means
 * the caller must rethrow: an unrecognised error is a bug in our own startup path and has to
 * keep its stack trace rather than be tidied away behind a dialog.
 */
export function handleStartupFailure(err: unknown, host: StartupHost): boolean {
  const failure = describeStartupFailure(err);
  if (failure === null) return false;
  host.showErrorBox(failure.title, failure.detail);
  host.quit();
  return true;
}

/**
 * Acquire a startup resource, or present the refusal and signal the caller to stop.
 *
 * The control flow lives HERE rather than inline in `electron/main.ts` for a reason found
 * by mutation testing: while main owned it, changing `if (handled) return;` to an
 * unconditional `return;` kept every test green. That mutation makes an UNKNOWN startup
 * error quit the app silently with no dialog — the exact defect WI-07 exists to remove,
 * reintroduced. A guard that only greps the built main for a function name cannot see it.
 *
 * Returns null when the failure was presented and the caller must stop. Rethrows anything
 * we do not own, so a bug in our own startup path keeps its stack trace.
 */
export function acquireOrExit<T>(acquire: () => T, host: StartupHost): T | null {
  try {
    return acquire();
  } catch (err) {
    if (handleStartupFailure(err, host)) return null;
    throw err;
  }
}
