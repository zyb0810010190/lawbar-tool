// A last-resort notice for a renderer promise rejection that nothing caught.
//
// WHY THIS EXISTS. The main process has had `uncaughtException` and `unhandledRejection` handlers
// since the crash-dialog work. The RENDERER has had neither. There are 42 fire-and-forget call sites
// across the screens — `void (async () => { ... })()` and friends — and a rejection from any of them
// vanishes with no console entry the owner would see, no dialog, and no change on screen. The
// guard sweep closed every `await api.*` that could reject; this catches the ones it did not find
// and the ones added later.
//
// WHAT IT DELIBERATELY DOES NOT DO: show the reason.
//
// That is the opposite of the main-process crash dialog, which prints `${err.name}: ${err.message}`
// so the owner can hand it to someone. The difference is where the error comes from. A renderer
// rejection reason is assembled from whatever the failing code was holding — a matter name, a party
// name, a document title, a validation message quoting a field the lawyer typed. This app now holds
// real client matters, and a banner is a surface that gets photographed, screen-shared, and pasted
// into bug reports. So the reason is never rendered. The technical detail already reaches the main
// process log path; the banner's job is to tell a human that something failed, not to carry evidence.
//
// ONE NOTICE, NOT ONE PER REJECTION. A failing poll or a retry loop can reject repeatedly. The
// notice is idempotent: the first rejection creates it, subsequent ones leave it alone. A wall of
// identical banners would obscure the app and tell the owner nothing extra.
//
// IT MUST NOT THROW. It runs when something has already gone wrong. Every DOM access is guarded, and
// a failure inside the handler is swallowed rather than allowed to become a second unhandled
// rejection — which would recurse.

import { el } from "./dom.js";
import { t } from "./i18n/t.js";

/** data-test-id of the notice, so a test can assert presence without matching copy. */
export const REJECTION_NOTICE_TEST_ID = "unhandled-rejection-notice";

/**
 * Render the notice once. Safe to call repeatedly — the second and later calls are no-ops.
 *
 * Exported for tests; `installUnhandledRejectionNotice` is what production wires up.
 */
export function showRejectionNotice(doc: Document): void {
  try {
    const host = doc.body;
    if (host === null || host === undefined) return;
    if (doc.querySelector(`[data-test-id="${REJECTION_NOTICE_TEST_ID}"]`) !== null) return;

    const notice = el(
      "div",
      {
        class: "unhandled-rejection-notice",
        "data-test-id": REJECTION_NOTICE_TEST_ID,
        // `alert` rather than `status`: this is not progress information, and a screen-reader user
        // should not have to discover it by chance.
        role: "alert",
      },
      [t("rejection.notice")],
      doc,
    );
    host.appendChild(notice);
  } catch {
    // A throw here would be reported as another unhandled rejection and re-enter this handler.
    // Losing the notice is bad; an infinite loop during a failure is worse.
  }
}

/**
 * Install the global listener. Idempotent: calling twice does not double-register.
 *
 * Returns true when a listener was installed, false when one already was or the environment has no
 * `addEventListener` (a unit-test document, for instance).
 */
export function installUnhandledRejectionNotice(win: Window, doc: Document): boolean {
  const w = win as Window & { __lawbarRejectionNoticeInstalled?: boolean };
  if (w.__lawbarRejectionNoticeInstalled === true) return false;
  if (typeof win.addEventListener !== "function") return false;

  win.addEventListener("unhandledrejection", (event: Event) => {
    // preventDefault suppresses the default console reporting of the rejection. The reason may carry
    // client text, and the console is copied into bug reports wholesale.
    try {
      (event as Event & { preventDefault?: () => void }).preventDefault?.();
    } catch {
      // Not fatal — the notice matters more than suppressing the log line.
    }
    showRejectionNotice(doc);
  });

  w.__lawbarRejectionNoticeInstalled = true;
  return true;
}
