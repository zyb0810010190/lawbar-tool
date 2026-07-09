// Pure-function formatters for the case-box UI.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.5.

import type { LedgerCategory, MatterType } from "./types.js";

// First 8 chars (Crockford base32 lowercase) of a 26-char ULID.
export function ulidShort(ulid: string): string {
  return ulid.slice(0, 8);
}

// First 8 + "..." + last 8 chars. Per §6.5 hash-truncation rule.
// Hashes shorter than 16 chars are returned unchanged (defensive; should not occur).
export function hashTruncate(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

// "YYYY-MM-DD HH:mm" in local time. Per §6.5 + D5.
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = String(d.getFullYear()).padStart(4, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

// Deadline urgency classification for the matter deadlines view (brief §18
// day-one must-have: "visible overdue-deadline list … banner when overdue or
// due within 7 days"). Pure + clock-injected (caller passes `nowMs`) so the
// classification is deterministic in tests. Only `pending` deadlines are
// flagged; met/missed/withdrawn are settled and never urgent.
export type DeadlineUrgency = "overdue" | "due-soon" | "none";

// 7 calendar days, in milliseconds — the brief's "due within 7 days" window.
export const DEADLINE_DUE_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function classifyDeadlineUrgency(
  dueAtIso: string,
  status: string,
  nowMs: number,
): DeadlineUrgency {
  if (status !== "pending") return "none";
  const dueMs = Date.parse(dueAtIso);
  if (Number.isNaN(dueMs)) return "none";
  if (dueMs < nowMs) return "overdue";
  if (dueMs <= nowMs + DEADLINE_DUE_SOON_WINDOW_MS) return "due-soon";
  return "none";
}

// NOTE: the pre-i18n English label helpers (deadlineUrgencyLabel / matterTypeLabel /
// confidentialityLabel / statusLabel / ledgerCategoryLabel) were removed in
// WI-DESKTOP-I18N-DEAD-LABELS-03 — the live zh-CN labels are the facades in
// renderer/i18n/labels.ts (matterTypeLabel / confidentialityLabel / statusLabel /
// deadlineUrgencyLabel / ledgerCategoryLabel), which every screen imports. These
// were dead (no screen imported them from format.ts) and are gone. `ledgerCategory`
// below is a pure token classifier (no English) and is retained.

// Display-only derived ledger category. Per dev-memo/plan-casebox-ui-design-
// hardening-00.md §3 row 8 + handoff §03 Task 5:
//   litigation, arbitration, criminal_defense → "litigation"
//   advisory                                  → "counsel"
//   due_diligence, other                      → "non_litigation"
//
// This is purely a display-layer semantic mapping. It does NOT change the
// underlying DTO `matter_type` field, the IPC contract, or any persistence
// shape. Callers use it to choose list-screen headers, view-screen tabs, and
// empty-state copy.
export function ledgerCategory(t: MatterType): LedgerCategory {
  switch (t) {
    case "litigation":
    case "arbitration":
    case "criminal_defense":
      return "litigation";
    case "advisory":
      return "counsel";
    case "due_diligence":
    case "other":
      return "non_litigation";
  }
}
