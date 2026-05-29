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
