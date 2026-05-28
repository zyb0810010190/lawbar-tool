// Pure-function formatters for the case-box UI.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.5.

import type {
  ConfidentialityClass,
  LedgerCategory,
  MatterStatus,
  MatterType,
} from "./types.js";

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

// Per brief §7 vocabulary alignment + §6.5.
export function matterTypeLabel(t: MatterType): string {
  switch (t) {
    case "litigation":
      return "Litigation matter";
    case "advisory":
      return "Counsel matter";
    case "arbitration":
      return "Arbitration matter";
    case "due_diligence":
      return "Due-diligence matter";
    case "criminal_defense":
      return "Criminal-defense matter";
    case "other":
      return "Other matter";
  }
}

export function confidentialityLabel(c: ConfidentialityClass): string {
  switch (c) {
    case "normal":
      return "Normal";
    case "heightened":
      return "Heightened";
    case "sealed":
      return "Sealed";
  }
}

export function statusLabel(s: MatterStatus): string {
  switch (s) {
    case "active":
      return "Active";
    case "archived":
      return "Archived";
  }
}

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

// English label for the derived ledger category. Per plan §3 row 8 "ADD
// `ledgerCategoryLabel(c: LedgerCategory): string` for display." The label is
// English-only at S5 — Chinese localization is S6's scope and will refactor
// every `*Label` helper (including this one) in a single pass.
export function ledgerCategoryLabel(c: LedgerCategory): string {
  switch (c) {
    case "litigation":
      return "Litigation";
    case "counsel":
      return "Counsel";
    case "non_litigation":
      return "Non-litigation";
  }
}
