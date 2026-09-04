// Backup screen (#/backup).
//
// The one thing this screen must never do is imply safety it cannot prove.
//
// The realistic failure here is not a crash. It is an external drive that is absent, full, or
// unplugged partway through, leaving a half-written archive — and an owner who saw a cheerful
// message and believes their case box is protected. So this screen states only what was VERIFIED,
// and the words "已备份" appear nowhere: a copy is not a backup until it has been checked.
//
// WHEN THERE HAS NEVER BEEN A VERIFIED BACKUP, that is the loudest thing on the screen. It is
// not styled as a neutral empty state, because it is not neutral: it is the single condition in
// this product where losing the machine loses the client's file outright.
//
// FAILURES ARRIVE AS CODES, NOT MESSAGES. Main sends `{ok:false, code}` and this screen maps the
// code to a catalog string. Nothing derived from the filesystem reaches the screen, because a
// destination path can carry a client's name — people label external drives after the matter
// they are working on — and a banner gets photographed into a bug report. Same reasoning as
// `unhandledRejectionNotice`.

import { el, focusEl, setText } from "../dom.js";
import { t } from "../i18n/t.js";
import type { CatalogId } from "../i18n/catalog.js";

export interface BackupStatusView {
  readonly lastVerifiedAt: string | null;
  readonly daysSinceLastVerified: number | null;
  readonly hasEverBackedUp: boolean;
}

export type BackupRunView =
  | { readonly ok: true; readonly verifiedAt: string }
  | { readonly ok: false; readonly code: string };

export interface BackupDeps {
  readonly doc?: Document;
  readonly getStatus?: () => Promise<BackupStatusView>;
  readonly runBackup?: () => Promise<BackupRunView>;
}

/**
 * The preload bridge, or null when there isn't one.
 *
 * The `typeof window` guard is not test scaffolding: this module is also loaded where no window
 * exists, and an unguarded reference throws a ReferenceError during mount — which, on this screen,
 * means the owner gets a blank page in place of the one telling them whether their case box is
 * backed up. Same guard, and the same reason, as the readiness module's bootstrap.
 */
function bridge(): { status: () => Promise<BackupStatusView>; run: () => Promise<BackupRunView> } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    lawbar?: { backup?: { status: () => Promise<BackupStatusView>; run: () => Promise<BackupRunView> } };
  };
  return w.lawbar?.backup ?? null;
}

/**
 * Every failure code main can send, mapped to copy. `cancelled` is deliberately NOT an error —
 * the owner closing a file dialog has done nothing wrong and must not be told something failed.
 */
function failureKey(code: string): CatalogId | null {
  switch (code) {
    case "cancelled":
      return null;
    case "destination_inside_data_dir":
      return "backup.failed.insideDataDir";
    case "destination_read_only":
      return "backup.failed.readOnly";
    case "destination_unusable":
      return "backup.failed.destinationUnusable";
    case "verification_failed":
      return "backup.failed.verification";
    default:
      // snapshot_failed, documents_copy_failed, and anything a later version adds.
      return "backup.failed.generic";
  }
}

function statusLine(status: BackupStatusView, doc: Document): HTMLElement {
  if (!status.hasEverBackedUp) {
    return el(
      "p",
      { role: "alert", class: "backup-never", "data-test-id": "backup-never" },
      [t("backup.status.never")],
      doc,
    );
  }
  const days = status.daysSinceLastVerified;
  // `t` does named interpolation itself and THROWS on a missing param. A hand-rolled
  // `.replace("{days}", ...)` compiles, looks right, and silently bypasses that check — it did,
  // in the first draft, and the throw was then swallowed by the catch below and shown to the
  // owner as "cannot read backup status". Use the real API.
  const text =
    days === null || days <= 0
      ? t("backup.status.today")
      : t("backup.status.daysAgo", { days });
  return el("p", { class: "backup-status", "data-test-id": "backup-status" }, [text], doc);
}

export async function mountBackup(root: HTMLElement, deps: BackupDeps = {}): Promise<void> {
  const doc = deps.doc ?? document;
  const api = bridge();
  const getStatus = deps.getStatus ?? (api === null ? null : api.status);
  const run = deps.runBackup ?? (api === null ? null : api.run);

  setText(root, "");
  const title = el("h1", { "data-test-id": "backup-title" }, [t("backup.title")], doc);
  const explain = el("p", { class: "backup-explain" }, [t("backup.explain")], doc);
  const statusHost = el("div", { "data-test-id": "backup-status-host" }, [], doc);
  const resultHost = el("div", { "data-test-id": "backup-result-host" }, [], doc);
  const button = el(
    "button",
    { type: "button", "data-test-id": "backup-run" },
    [t("backup.run")],
    doc,
  ) as HTMLButtonElement;

  root.appendChild(title);
  root.appendChild(explain);
  root.appendChild(statusHost);
  root.appendChild(button);
  root.appendChild(resultHost);
  focusEl(title);

  // The custody caveat is part of the screen, not a footnote someone can skip: an archive this
  // machine can still reach is not a witness. Saying so here is the difference between a tool
  // that helps and a tool that misleads about what it guarantees.
  root.appendChild(
    el("p", { class: "backup-custody", "data-test-id": "backup-custody" }, [t("backup.custody")], doc),
  );

  async function paintStatus(): Promise<void> {
    setText(statusHost, "");
    if (getStatus === null) {
      statusHost.appendChild(
        el("p", { role: "alert", "data-test-id": "backup-status-error" },
          [t("backup.status.unavailable")], doc),
      );
      return;
    }
    // Only the BRIDGE CALL is guarded. Rendering happens outside the try on purpose: a catch
    // wide enough to cover both would turn any bug in our own copy or markup into "the bridge is
    // down", which is a false statement to make to someone asking whether their case box is safe.
    let status: BackupStatusView;
    try {
      status = await getStatus();
    } catch {
      statusHost.appendChild(
        el("p", { role: "alert", "data-test-id": "backup-status-error" },
          [t("backup.status.unavailable")], doc),
      );
      return;
    }
    statusHost.appendChild(statusLine(status, doc));
  }

  // The button is registered BEFORE the first awaited status read, so a bridge that rejects
  // cannot leave a live-looking button wired to nothing — the readiness-window defect (#283).
  button.addEventListener("click", () => {
    if (run === null) {
      setText(resultHost, "");
      resultHost.appendChild(
        el("p", { role: "alert", "data-test-id": "backup-result" }, [t("backup.failed.generic")], doc),
      );
      return;
    }
    button.disabled = true;
    setText(resultHost, "");
    resultHost.appendChild(
      el("p", { "data-test-id": "backup-running" }, [t("backup.running")], doc),
    );
    void (async () => {
      try {
        const r = await run();
        setText(resultHost, "");
        if (r.ok) {
          resultHost.appendChild(
            el("p", { role: "status", "data-test-id": "backup-result" }, [t("backup.verified")], doc),
          );
          await paintStatus();
          return;
        }
        const key = failureKey(r.code);
        if (key !== null) {
          resultHost.appendChild(
            el("p", { role: "alert", "data-test-id": "backup-result" }, [t(key)], doc),
          );
        }
      } catch {
        setText(resultHost, "");
        resultHost.appendChild(
          el("p", { role: "alert", "data-test-id": "backup-result" }, [t("backup.failed.generic")], doc),
        );
      } finally {
        button.disabled = false;
      }
    })();
  });

  await paintStatus();
}
