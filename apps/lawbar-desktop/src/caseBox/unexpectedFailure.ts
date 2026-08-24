// Last-resort handler copy for an unexpected throw in the main process.
//
// WHY THIS EXISTS. The app had NO uncaughtException or unhandledRejection handling at all, so any
// throw produced Electron's default dialog with a raw stack. The owner saw exactly that:
//
//     Uncaught Exception:
//     ReferenceError: require is not defined
//     at BrowserWindow.<anonymous> (…/dist/electron/readiness.js:88:28)
//
// For a litigator who is not a developer, that says nothing about the only question that matters:
// is my case data safe, and what do I do now. `startupFailure.ts` already turns case-database
// refusals into readable zh-CN messages, but it covers only that path; an arbitrary throw was
// unhandled.
//
// HONEST, NOT REASSURING. The obvious copy — "an unexpected error occurred; your data was not
// modified" — would be a lie this code cannot support. A crash handler does not know what the throw
// interrupted. So the message states precisely what IS known and refuses to claim the rest:
//
//   - the case database was never opened this run  -> it cannot have been changed by this run
//   - the case database WAS opened                 -> say so, and say that whether a write was in
//                                                     flight is NOT determinable here
//
// In the second case it points at the one thing that can actually answer the question: the audit
// chain is append-only and hash-linked, and the in-app verification walks it. That is a real check
// the owner can run, not a reassurance.
//
// The technical detail is SHOWN, not hidden. A court-facing tool that swallows the cause of its own
// failure is worse than one that prints a stack: the owner may need to hand it to someone.

export interface UnexpectedFailure {
  readonly title: string;
  readonly detail: string;
}

/** First line of an error, without the stack — enough to identify it, short enough to read. */
function summarize(err: unknown): string {
  if (err instanceof Error) {
    const where = typeof err.stack === "string" ? err.stack.split("\n")[1]?.trim() ?? "" : "";
    return where === "" ? `${err.name}: ${err.message}` : `${err.name}: ${err.message}\n${where}`;
  }
  try {
    return String(err);
  } catch {
    // A thrown object with a hostile toString must not replace the report with a second crash.
    return "(an error that could not be converted to text)";
  }
}

/**
 * Build the dialog copy.
 *
 * `caseBoxOpened` is the single fact that changes what can honestly be said. The caller must pass
 * what actually happened, not what it hopes happened.
 */
export function describeUnexpectedFailure(
  err: unknown,
  opts: { readonly caseBoxOpened: boolean },
): UnexpectedFailure {
  const dataLine = opts.caseBoxOpened
    ? "本次运行已打开案件数据库。错误发生时是否有未完成的写入，此处无法确定——不做保证。\n" +
      "审计链是仅追加、带哈希链的：重新启动后，可在案件详情的「审计链」中点击「验证审计链」自行检查完整性。"
    : "本次运行尚未打开案件数据库，因此本次运行不可能改动其中的数据。";

  const detail = [
    "lawbar 遇到未预期的错误，已停止运行，以免在状态不明的情况下继续写入。",
    dataLine,
    "建议：重新启动 lawbar。若反复出现，请保留下面的技术信息。",
    "技术信息：",
    summarize(err),
  ].join("\n\n");

  return { title: "lawbar 发生未预期的错误", detail };
}
