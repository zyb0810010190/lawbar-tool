// Audit chain-head + audit-event-log disclosure for the matter view.
// Extracted from viewMatter.ts (mechanical move, no behavior change) so the
// screen stays comfortably below the loc-guardian 800-LOC fail threshold as
// more entity sections are added. Read-only; loads lazily on first <details>
// click. The renderer never imports the service; only the human-rendered
// fields are read, and main is the authoritative validator.

import type { CaseBoxApi } from "../api.js";
import { el, setText } from "../dom.js";
import { formatLocalDateTime, hashTruncate, ulidShort } from "../format.js";
import { t } from "../i18n/t.js";
import { errorMessage } from "../i18n/errorMessage.js";
import {
  auditEntityTypeLabel,
  chainVerifyReasonLabel,
  eventKindLabel,
  isKnownAuditEventKind,
} from "../i18n/labels.js";
import type { RendererChainVerifyResult } from "../types.js";

// Humanized zh-CN label for an audit row. A known event_kind resolves via the shared eventKindLabel
// facade (catalog eventKind.* keys); a null / missing / unknown kind falls back to the raw `action`
// (the row's entity detail supplies the "· entity_type" half). isKnownAuditEventKind is the membership
// guard over the audit event-kind set (renderer/i18n/labels.ts) — it also narrows `kind` to
// CaseBoxAuditEventKind so eventKindLabel is called safely. Never infers a transition kind.
function auditEventLabel(ev: { readonly action: string; readonly event_kind?: string }): string {
  const kind = ev.event_kind;
  if (kind !== undefined && kind !== null && isKnownAuditEventKind(kind)) {
    return eventKindLabel(kind);
  }
  return ev.action;
}

interface AuditChainHead {
  readonly headHash: string | null;
  readonly lastEventId: string | null;
  readonly count: number;
}

interface AuditEventRow {
  readonly timestamp: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly reason?: string;
  // v2 (WI-U1 projection): the normalized kind the panel humanizes; absent on legacy v1 rows.
  readonly event_kind?: string;
}

interface ListAuditEventsPage {
  readonly rows: ReadonlyArray<AuditEventRow>;
  readonly next_cursor: string | null;
}

function clipboardAvailable(): boolean {
  if (typeof navigator === "undefined" || navigator === null) return false;
  const nav = navigator as { clipboard?: { writeText?: unknown } };
  return (
    nav.clipboard !== undefined &&
    typeof nav.clipboard.writeText === "function"
  );
}

export function renderChainHeadDisclosure(
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): HTMLElement {
  const body = el(
    "div",
    { class: "view-chain-body", "data-test-id": "view-chain-body" },
    [],
    doc,
  );
  const summary = el(
    "summary",
    { "data-test-id": "view-chain-summary", "aria-label": t("audit.chainHead.summaryAria") },
    [t("audit.chainHead.summary")],
    doc,
  );
  const details = el(
    "details",
    { class: "view-chain-details", "data-test-id": "view-chain-details" },
    [summary, body],
    doc,
  );

  let loaded = false;
  summary.addEventListener("click", () => {
    if (loaded) return;
    loaded = true;
    void loadChainHead(body, doc, api, matterId);
  });
  return details;
}

async function loadChainHead(
  body: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  setText(body, t("audit.chainHead.loading"));
  // A TRANSPORT THROW, not a returned {ok:false}. The envelope path below already worked; an
  // outright rejection did not, and because this is invoked as `void loadChainHead(...)` the
  // rejection was swallowed and the loading placeholder stayed on screen forever. On the
  // audit-chain viewer that is a verification surface silently failing to show its own state.
  let env: Awaited<ReturnType<typeof api.chainHead>>;
  try {
    env = await api.chainHead({ matterId });
  } catch {
    setText(body, "");
    body.appendChild(
      el("p", { role: "alert", "data-test-id": "view-chain-error" }, [t("audit.chainHead.failed")], doc),
    );
    return;
  }
  setText(body, "");
  if (!env.ok) {
    body.appendChild(
      el(
        "p",
        { role: "alert", "data-test-id": "view-chain-error" },
        [errorMessage(env.error)],
        doc,
      ),
    );
    return;
  }
  const head = env.value as AuditChainHead | null;
  if (
    head === null ||
    head.count === 0 ||
    head.headHash === null
  ) {
    body.appendChild(
      el(
        "p",
        { "data-test-id": "view-chain-empty" },
        [t("audit.chainHead.empty")],
        doc,
      ),
    );
    return;
  }

  const truncated = hashTruncate(head.headHash);
  const copyAvail = clipboardAvailable();
  const copyBtn = el(
    "button",
    {
      type: "button",
      class: "button button--ghost button--sm view-chain-copy",
      "data-test-id": "view-chain-copy",
      "aria-label": t("audit.copyHash.aria"),
      ...(copyAvail
        ? {}
        : {
            disabled: true,
            title: t("audit.copyHash.unavailable"),
          }),
    },
    [t("audit.copyHash.button")],
    doc,
  );
  if (copyAvail) {
    copyBtn.addEventListener("click", () => {
      const nav = navigator as { clipboard: { writeText: (s: string) => Promise<void> } };
      void nav.clipboard.writeText(head.headHash as string);
    });
  }

  const headHashLine = el(
    "div",
    { class: "view-chain-headhash", "data-test-id": "view-chain-headhash" },
    [
      el("span", { class: "view-chain-label" }, [t("audit.chainHead.headHashLabel")], doc),
      " ",
      el(
        "code",
        { "data-test-id": "view-chain-headhash-truncated" },
        [truncated],
        doc,
      ),
      " ",
      copyBtn,
      el(
        "details",
        {},
        [
          el("summary", {}, [t("audit.chainHead.showFullHash")], doc),
          el(
            "code",
            { "data-test-id": "view-chain-headhash-full" },
            [head.headHash],
            doc,
          ),
        ],
        doc,
      ),
    ],
    doc,
  );

  const lastEventLine =
    head.lastEventId !== null
      ? el(
          "div",
          { class: "view-chain-lastevent" },
          [
            el(
              "span",
              { class: "view-chain-label" },
              [t("audit.chainHead.lastEventLabel")],
              doc,
            ),
            " ",
            el(
              "code",
              { "data-test-id": "view-chain-lastevent-short" },
              [ulidShort(head.lastEventId)],
              doc,
            ),
            el(
              "details",
              {},
              [
                el("summary", {}, [t("audit.chainHead.showFullEventId")], doc),
                el(
                  "code",
                  { "data-test-id": "view-chain-lastevent-full" },
                  [head.lastEventId],
                  doc,
                ),
              ],
              doc,
            ),
          ],
          doc,
        )
      : null;

  const countLine = el(
    "div",
    { class: "view-chain-count" },
    [
      el("span", { class: "view-chain-label" }, [t("audit.chainHead.countLabel")], doc),
      " ",
      el(
        "code",
        { "data-test-id": "view-chain-count" },
        [String(head.count)],
        doc,
      ),
    ],
    doc,
  );

  body.appendChild(headHashLine);
  if (lastEventLine !== null) body.appendChild(lastEventLine);
  body.appendChild(countLine);

  // The full ordered audit-event log loads in the same disclosure (read-only).
  await loadAuditEvents(body, doc, api, matterId);

  // GAP-2: the verification action sits BELOW the log, because it is a claim about everything
  // above it. It is user-initiated rather than automatic on open — a full chain walk should be a
  // deliberate act the litigator can point to, not a background check whose timing nobody can state.
  body.appendChild(renderVerifyAction(doc, api, matterId));
}

// Verification section: one button, one result line. Deliberately has no "re-verify to clear"
// affordance — a failed result stays on screen until the disclosure is closed, so a tamper finding
// cannot be dismissed by a stray second click.
function renderVerifyAction(doc: Document, api: CaseBoxApi, matterId: string): HTMLElement {
  const result = el(
    "div",
    {
      class: "view-audit-verify-result",
      "data-test-id": "view-audit-verify-result",
      // Announced to assistive tech when it changes; `polite` because the user asked for this
      // result and is waiting on it, so it never interrupts mid-sentence.
      "aria-live": "polite",
      "aria-label": t("audit.verify.resultAria"),
    },
    [],
    doc,
  );

  const button = el(
    "button",
    {
      type: "button",
      class: "button button--secondary view-audit-verify-btn",
      "data-test-id": "view-audit-verify-btn",
      "aria-label": t("audit.verify.buttonAria"),
    },
    [t("audit.verify.button")],
    doc,
  );

  button.addEventListener("click", () => {
    void runVerify(button, result, doc, api, matterId);
  });

  return el(
    "div",
    { class: "view-audit-verify", "data-test-id": "view-audit-verify" },
    [button, result],
    doc,
  );
}

async function runVerify(
  button: HTMLElement,
  result: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  button.setAttribute("disabled", "true");
  setText(result, t("audit.verify.running"));
  try {
    let env: Awaited<ReturnType<typeof api.verifyChain>>;
    try {
      env = await api.verifyChain({ matterId });
    } catch {
      // A TRANSPORT failure is not a chain finding, and the two must never share copy.
      // `audit.verify.failed` renders "链不一致：第 N 条事件" — a substantive claim that the chain is
      // BROKEN. Reusing it here would tell the lawyer their audit chain failed when the app merely
      // could not run the check: a false statement about tamper-evidence, which is worse than the
      // silence it replaces. `audit.verify.unavailable` says the check did not complete and
      // explicitly adds that this is not a finding about the chain.
      //
      // Silence is still not an option — it is indistinguishable from "still working", which is the
      // one thing a verification control must never be.
      setText(result, t("audit.verify.unavailable"));
      return;
    }
    setText(result, "");
    if (!env.ok) {
      // Transport / boundary failure: verification did NOT run. Distinct from a chain that ran and
      // failed — saying "not verified" here rather than anything about the chain's condition.
      result.appendChild(
        el(
          "p",
          { role: "alert", "data-test-id": "view-audit-verify-error" },
          [errorMessage(env.error)],
          doc,
        ),
      );
      return;
    }
    const v = env.value as RendererChainVerifyResult;
    if (v.ok) {
      result.appendChild(
        el(
          "p",
          { class: "view-audit-verify-ok", "data-test-id": "view-audit-verify-ok" },
          [t("audit.verify.ok", { count: v.verifiedCount })],
          doc,
        ),
      );
    } else {
      result.appendChild(
        el(
          "p",
          {
            class: "view-audit-verify-failed",
            "data-test-id": "view-audit-verify-failed",
            role: "alert",
          },
          [
            // errorIndex is the verifier's 0-based array position; shown 1-based so it lines up
            // with the human-counted position in the event log rendered directly above.
            t("audit.verify.failed", {
              index: v.errorIndex + 1,
              reason: chainVerifyReasonLabel(v.errorReason),
            }),
          ],
          doc,
        ),
      );
    }
    // Present on BOTH outcomes. An intact result is the one most likely to be over-read, and this
    // is the product's own statement of what its verification does and does not establish.
    result.appendChild(
      el(
        "p",
        { class: "view-audit-verify-scope", "data-test-id": "view-audit-verify-scope" },
        [t("audit.verify.scopeNote")],
        doc,
      ),
    );
  } finally {
    button.removeAttribute("disabled");
  }
}

function renderAuditEventRow(doc: Document, ev: AuditEventRow): HTMLElement {
  const meta = el(
    "div",
    { class: "view-audit-event-meta" },
    [
      el(
        "span",
        { class: "view-audit-time", "data-test-id": "view-audit-time" },
        [formatLocalDateTime(ev.timestamp)],
        doc,
      ),
      " ",
      el(
        "span",
        { class: "view-audit-action", "data-test-id": "view-audit-action" },
        // Humanized label for a known event_kind; raw action (with the entity detail's "· entity_type")
        // for legacy / null / unknown kinds. Plain text → part of the accessible row name; the audit
        // list's aria-live="polite" announces it.
        [auditEventLabel(ev)],
        doc,
      ),
    ],
    doc,
  );
  const detailChildren: Array<HTMLElement | string> = [
    el(
      "span",
      { class: "view-audit-entity" },
      [`${auditEntityTypeLabel(ev.entity_type)} · ${ulidShort(ev.entity_id)}`],
      doc,
    ),
  ];
  if (ev.reason !== undefined && ev.reason.length > 0) {
    detailChildren.push(
      " ",
      el(
        "span",
        { class: "view-audit-reason", "data-test-id": "view-audit-reason" },
        [t("audit.events.reason", { reason: ev.reason })],
        doc,
      ),
    );
  }
  const detail = el("div", { class: "view-audit-event-detail" }, detailChildren, doc);
  return el(
    "li",
    { class: "view-audit-event", "data-test-id": "view-audit-event" },
    [meta, detail],
    doc,
  );
}

async function loadAuditEvents(
  parent: HTMLElement,
  doc: Document,
  api: CaseBoxApi,
  matterId: string,
): Promise<void> {
  parent.appendChild(
    el("div", { class: "view-audit-heading" }, [t("audit.events.heading")], doc),
  );
  const list = el(
    "ol",
    { class: "view-audit-list", "data-test-id": "view-audit-list", "aria-live": "polite" },
    [],
    doc,
  );
  parent.appendChild(list);
  const loading = el(
    "p",
    { "data-test-id": "view-audit-loading" },
    [t("audit.events.loading")],
    doc,
  );
  parent.appendChild(loading);

  let cursor: string | null = null;
  let moreBtn: HTMLElement | null = null;
  let pageLoading = false; // re-entrancy guard: a fast double-click on "Show more" must not fetch/append a page twice

  async function loadPage(): Promise<void> {
    if (pageLoading) return; // a page fetch is already in flight — drop the concurrent call
    pageLoading = true;
    // Visibly suppress the in-flight Show-more (the guard already drops the concurrent call).
    if (moreBtn !== null) moreBtn.setAttribute("disabled", "");
    let env: Awaited<ReturnType<typeof api.listAuditEvents>>;
    try {
      env = await api.listAuditEvents({
        matterId,
        ...(cursor !== null ? { cursor } : {}),
      });
    } catch {
      // The pre-existing try/finally below re-enabled the Show-more button on a throw and its
      // comment said it "guards the throw path" — but it only guarded the BUTTON. The rejection
      // still propagated out of loadPage, out of loadAuditEvents, and into a `void`ed caller that
      // swallowed it, leaving the list stuck on its loading placeholder. Guarding the control while
      // leaving the screen hung is the more misleading half-fix, because the comment reads as done.
      loading.remove();
      parent.appendChild(
        el("p", { role: "alert", "data-test-id": "view-audit-error" }, [t("audit.events.failed")], doc),
      );
      return;
    } finally {
      pageLoading = false;
      // Re-enable the in-flight Show-more even if the fetch rejected out-of-contract,
      // so a transport-level throw cannot leave pagination permanently wedged (a normal
      // failure returns { ok: false } and is handled below; this guards the throw path).
      if (moreBtn !== null) moreBtn.removeAttribute("disabled");
    }
    loading.remove();
    if (moreBtn !== null) {
      moreBtn.remove();
      moreBtn = null;
    }
    if (!env.ok) {
      parent.appendChild(
        el(
          "p",
          { role: "alert", "data-test-id": "view-audit-error" },
          [errorMessage(env.error)],
          doc,
        ),
      );
      return;
    }
    const page = env.value as ListAuditEventsPage;
    for (const ev of page.rows) {
      list.appendChild(renderAuditEventRow(doc, ev));
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "button button--secondary button--sm view-audit-more",
          "data-test-id": "view-audit-more",
          "aria-label": t("audit.events.showMoreAria"),
        },
        [t("common.loadMore")],
        doc,
      );
      btn.addEventListener("click", () => {
        void loadPage();
      });
      moreBtn = btn;
      parent.appendChild(btn);
    }
  }

  await loadPage();
}
