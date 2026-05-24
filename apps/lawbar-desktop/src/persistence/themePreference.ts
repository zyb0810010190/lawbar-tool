import fs from "node:fs";
import path from "node:path";

import type { ThemePreference } from "../theme/resolveSystemMode.js";

const FILENAME = "theme-preference.json";
const SCHEMA_VERSION = 1;
const ALLOWED: ReadonlySet<ThemePreference> = new Set(["system", "light", "dark"]);

export interface ThemePreferenceFile {
  readonly version: 1;
  readonly mode: ThemePreference;
}

export function loadThemePreference(userDataDir: string): ThemePreferenceFile {
  const file = path.join(userDataDir, FILENAME);
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      (parsed as { version: unknown }).version === SCHEMA_VERSION &&
      "mode" in parsed &&
      typeof (parsed as { mode: unknown }).mode === "string" &&
      ALLOWED.has((parsed as { mode: ThemePreference }).mode)
    ) {
      return { version: SCHEMA_VERSION, mode: (parsed as { mode: ThemePreference }).mode };
    }
  } catch {
    // File missing OR JSON parse failed OR schema validation failed → defaults.
  }
  return { version: SCHEMA_VERSION, mode: "system" };
}

export function saveThemePreference(userDataDir: string, mode: ThemePreference): void {
  if (!ALLOWED.has(mode)) {
    throw new Error(`invalid theme mode: ${String(mode)}`);
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = path.join(userDataDir, FILENAME);
  const payload: ThemePreferenceFile = { version: SCHEMA_VERSION, mode };
  fs.writeFileSync(file, JSON.stringify(payload), "utf-8");
}
