import { saveThemePreference } from "../persistence/themePreference.js";
import {
  resolveSystemMode,
  type ResolvedTheme,
  type ThemePreference,
} from "./resolveSystemMode.js";

// MAIN-PROCESS-ONLY helper. The renderer does NOT import this file (per
// dev-memo/plan-first-ui-shell-00.md §1 rev-2 — renderer/index.ts has
// ZERO imports).

export interface ResolveAndPersistDeps {
  readonly userDataDir: string;
}

export interface ResolveAndPersistResult {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
}

export function resolveAndPersist(
  preference: ThemePreference,
  systemDark: boolean,
  deps: ResolveAndPersistDeps,
): ResolveAndPersistResult {
  saveThemePreference(deps.userDataDir, preference);
  return { preference, resolved: resolveSystemMode(preference, systemDark) };
}
