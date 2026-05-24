export interface ThemeTokens {
  readonly background: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  readonly accent: string;
  readonly textOnAccent: string;
  readonly danger: string;
  readonly warning: string;
  readonly success: string;
  readonly focusRing: string;
}

// Per dev-memo/plan-night-mode-foundation-00.md §2.1 (Light palette).
export const LIGHT_TOKENS: ThemeTokens = {
  background: "#F8F9FA",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  text: "#1A1D21",
  mutedText: "#6B7280",
  border: "#E1E4E8",
  accent: "#1E5EBA",
  textOnAccent: "#FFFFFF",
  danger: "#B42318",
  warning: "#B54708",
  success: "#1B7A3B",
  focusRing: "#2B7FFF",
};

// Per dev-memo/plan-night-mode-foundation-00.md §2.2 (Dark palette).
export const DARK_TOKENS: ThemeTokens = {
  background: "#0F1216",
  surface: "#171B21",
  surfaceElevated: "#1F242C",
  text: "#EDEEF0",
  mutedText: "#9CA3AF",
  border: "#2A3038",
  accent: "#5594E8",
  textOnAccent: "#0F1216",
  danger: "#F87171",
  warning: "#FBBF24",
  success: "#34D399",
  focusRing: "#7AAFFF",
};
