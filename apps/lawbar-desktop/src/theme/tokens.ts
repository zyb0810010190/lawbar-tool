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

// S2 (design-hardening): revalued to the editorial palette from
// dev-memo/design-source/editorial-tokens.css. Names preserved (no rename);
// kept byte-equal to renderer/index.css :root blocks via the palette-sync
// test. The additional editorial tokens are additive and land in S3/S4.
// (Light palette — ivory canvas + honey-orange accent.)
export const LIGHT_TOKENS: ThemeTokens = {
  background: "#F7F4EE",
  surface: "#FBF8F3",
  surfaceElevated: "#FFFFFF",
  text: "#1F1A17",
  mutedText: "#6E655D",
  border: "#E7DED2",
  accent: "#D88B57",
  textOnAccent: "#FBF8F3",
  danger: "#B85E4A",
  warning: "#B07A2C",
  success: "#6E8B74",
  focusRing: "#D88B57",
};

// S2 (design-hardening): editorial dark palette (warm deep). focus-ring
// mirrors accent per editorial-tokens.css.
export const DARK_TOKENS: ThemeTokens = {
  background: "#16130F",
  surface: "#1C1814",
  surfaceElevated: "#221D18",
  text: "#EFE6D8",
  mutedText: "#968A78",
  border: "#2D2620",
  accent: "#E59E6B",
  textOnAccent: "#16130F",
  danger: "#D87E6A",
  warning: "#D29E50",
  success: "#8DAB94",
  focusRing: "#E59E6B",
};

// ============================================================
// S2.5 — full editorial token system (kebab-keyed by CSS custom-property
// name). The 12-camel LIGHT_TOKENS/DARK_TOKENS above remain the compat subset
// consumed by electron/main.ts; these Records are the expanded set the
// renderer index.css token blocks are kept byte-equal to via the palette-sync
// test. Theme tokens differ light/dark; SCALE_TOKENS are invariant (no theme
// variance, no hex). --shadow-pop (multi-line, rgba) is DEFERRED to S4 — it is
// referenced by neither editorial-styles, desktop-shell, cn-overlay, nor
// v12-typography. Source: dev-memo/design-source/editorial-tokens.css.
// --color-text-on-danger dark value = light value (source dark inherits it).
// --traffic-* are an S2.5 addition tokenizing desktop-shell's macOS window-
// control dots (invariant; declared in both theme blocks for hex-exemption +
// key parity).
// ============================================================

export const LIGHT_THEME_TOKENS: Record<string, string> = {
  "--color-background": "#F7F4EE",
  "--color-surface": "#FBF8F3",
  "--color-surface-elevated": "#FFFFFF",
  "--color-surface-sunken": "#EFEAE0",
  "--color-rule": "#E7DED2",
  "--color-text": "#1F1A17",
  "--color-text-strong": "#14100E",
  "--color-muted-text": "#6E655D",
  "--color-subtle-text": "#9A9086",
  "--color-border": "#E7DED2",
  "--color-border-strong": "#D4C5B3",
  "--color-divider": "#EEE6D9",
  "--color-accent": "#D88B57",
  "--color-accent-hover": "#BA6F3C",
  "--color-accent-pressed": "#9D5A2B",
  "--color-accent-subtle": "#F3E0D1",
  "--color-accent-border": "#E5C2A1",
  "--color-accent-deep": "#7C3F1B",
  "--color-text-on-accent": "#FBF8F3",
  "--color-success": "#6E8B74",
  "--color-success-subtle": "#E7EEE8",
  "--color-success-border": "#BFCDC1",
  "--color-warning": "#B07A2C",
  "--color-warning-subtle": "#F5E6CB",
  "--color-warning-border": "#DEBB7B",
  "--color-danger": "#B85E4A",
  "--color-danger-hover": "#9A4937",
  "--color-danger-subtle": "#F4DDD6",
  "--color-danger-border": "#DDA89A",
  "--color-text-on-danger": "#FBF8F3",
  "--color-info": "#7B8FA6",
  "--conf-normal-fg": "var(--color-muted-text)",
  "--conf-normal-bg": "transparent",
  "--conf-normal-border": "var(--color-border-strong)",
  "--conf-heightened-fg": "#A06A2C",
  "--conf-heightened-bg": "#F5E6CB",
  "--conf-heightened-border": "#DEBB7B",
  "--conf-sealed-fg": "#FBF8F3",
  "--conf-sealed-bg": "#1F1A17",
  "--conf-sealed-border": "#1F1A17",
  "--status-active-fg": "var(--color-accent-pressed)",
  "--status-active-bg": "var(--color-accent-subtle)",
  "--status-active-border": "var(--color-accent-border)",
  "--status-archived-fg": "var(--color-muted-text)",
  "--status-archived-bg": "transparent",
  "--status-archived-border": "var(--color-border-strong)",
  "--color-focus-ring": "var(--color-accent)",
  "--shadow-sm": "0 0 0 1px var(--color-border)",
  "--traffic-close": "#E1685C",
  "--traffic-min": "#E2B23E",
  "--traffic-max": "#62B65B",
};

export const DARK_THEME_TOKENS: Record<string, string> = {
  "--color-background": "#16130F",
  "--color-surface": "#1C1814",
  "--color-surface-elevated": "#221D18",
  "--color-surface-sunken": "#100E0B",
  "--color-rule": "#2D2620",
  "--color-text": "#EFE6D8",
  "--color-text-strong": "#F8F1E4",
  "--color-muted-text": "#968A78",
  "--color-subtle-text": "#6C6356",
  "--color-border": "#2D2620",
  "--color-border-strong": "#43392F",
  "--color-divider": "#25201B",
  "--color-accent": "#E59E6B",
  "--color-accent-hover": "#EFB286",
  "--color-accent-pressed": "#C7864F",
  "--color-accent-subtle": "#2A1F15",
  "--color-accent-border": "#5A3A22",
  "--color-accent-deep": "#F5C49C",
  "--color-text-on-accent": "#16130F",
  "--color-success": "#8DAB94",
  "--color-success-subtle": "#1A2620",
  "--color-success-border": "#2F4538",
  "--color-warning": "#D29E50",
  "--color-warning-subtle": "#271C0E",
  "--color-warning-border": "#4A371A",
  "--color-danger": "#D87E6A",
  "--color-danger-hover": "#E2937F",
  "--color-danger-subtle": "#2A1612",
  "--color-danger-border": "#5B2C24",
  "--color-text-on-danger": "#FBF8F3",
  "--color-info": "#98A8BD",
  "--conf-normal-fg": "var(--color-muted-text)",
  "--conf-normal-bg": "transparent",
  "--conf-normal-border": "var(--color-border-strong)",
  "--conf-heightened-fg": "#E0B271",
  "--conf-heightened-bg": "#2C2010",
  "--conf-heightened-border": "#5B4220",
  "--conf-sealed-fg": "#F8F1E4",
  "--conf-sealed-bg": "#0A0907",
  "--conf-sealed-border": "#2D2620",
  "--status-active-fg": "var(--color-accent)",
  "--status-active-bg": "var(--color-accent-subtle)",
  "--status-active-border": "var(--color-accent-border)",
  "--status-archived-fg": "var(--color-muted-text)",
  "--status-archived-bg": "transparent",
  "--status-archived-border": "var(--color-border-strong)",
  "--color-focus-ring": "var(--color-accent)",
  "--shadow-sm": "0 0 0 1px var(--color-border)",
  "--traffic-close": "#E1685C",
  "--traffic-min": "#E2B23E",
  "--traffic-max": "#62B65B",
};

export const SCALE_TOKENS: Record<string, string> = {
  "--focus-ring-width": "2px",
  "--focus-ring-offset": "2px",
  "--font-size-2xs": "11px",
  "--font-size-xs": "12px",
  "--font-size-sm": "13px",
  "--font-size-base": "14px",
  "--font-size-md": "15px",
  "--font-size-lg": "17px",
  "--font-serif-xl": "22px",
  "--font-serif-2xl": "32px",
  "--font-serif-3xl": "52px",
  "--font-serif-4xl": "76px",
  "--line-tight": "1.05",
  "--line-snug": "1.25",
  "--line-normal": "1.55",
  "--line-reading": "1.7",
  "--weight-regular": "400",
  "--weight-medium": "500",
  "--weight-semibold": "600",
  "--tracking-mono": "0.02em",
  "--tracking-label": "0.16em",
  "--tracking-tight": "-0.02em",
  "--tracking-snug": "-0.01em",
  "--space-1": "4px",
  "--space-2": "8px",
  "--space-3": "12px",
  "--space-4": "16px",
  "--space-5": "20px",
  "--space-6": "24px",
  "--space-7": "32px",
  "--space-8": "40px",
  "--space-9": "56px",
  "--space-10": "72px",
  "--space-11": "96px",
  "--space-12": "128px",
  "--radius-sm": "6px",
  "--radius-md": "8px",
  "--radius-lg": "12px",
  "--radius-pill": "999px",
  "--shadow-xs": "none",
  "--duration-fast": "120ms",
  "--duration-base": "180ms",
  "--ease-standard": "cubic-bezier(0.2, 0, 0.1, 1)",
  "--max-content-width": "1240px",
  "--side-pad-narrow": "24px",
  "--side-pad-wide": "64px",
  "--rule-thin": "1px",
};
