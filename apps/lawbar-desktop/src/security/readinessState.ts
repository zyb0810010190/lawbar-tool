// Pure state for the first-run readiness window.
//
// Lives under src/ and imports NO Electron, matching fileVaultProbe.ts beside it: `src/` is the
// layer plain `node --test` can load, `electron/` is the layer it cannot. Putting this in
// electron/readiness.ts made the whole test file unloadable, which is how the split earned its
// keep on the first run.

import { decideAction, fileVaultBlockMessage, type FileVaultState } from "./fileVaultProbe.js";

export const READINESS_CHANNEL = Object.freeze({
  state: "readiness:state",
  openSettings: "readiness:openSettings",
  recheck: "readiness:recheck",
  quit: "readiness:quit",
});

// Verified accepted by LaunchServices on macOS 15.6. Deep-linking straight to the pane matters:
// "System Settings → Privacy & Security → FileVault" is four steps and a wrong turn for anyone who
// does not already know where it lives.
export const FILEVAULT_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.settings.PrivacyAndSecurity?FileVault";

export interface ReadinessState {
  readonly fileVaultState: FileVaultState;
  readonly blocked: boolean;
  readonly title: string;
  readonly detail: string;
}

/**
 * What the readiness window renders.
 *
 * `blocked` is DERIVED from `decideAction`, never recomputed. A second implementation of "is
 * FileVault acceptable" is exactly how a gate drifts open, and a test asserts the two agree across
 * the whole state × mode matrix.
 */
export function readinessState(
  state: FileVaultState,
  mode: "production" | "dev",
  probeError?: string,
): ReadinessState {
  const blocked = decideAction(state, mode) === "block";
  const { title, detail } = fileVaultBlockMessage(state, probeError);
  return { fileVaultState: state, blocked, title, detail };
}

/**
 * Only the FileVault pane may be opened. This window runs BEFORE the storage precondition is met,
 * so an unrestricted external opener reachable from it would be a hole.
 */
export function isAllowedSettingsUrl(url: string): boolean {
  return url === FILEVAULT_SETTINGS_URL;
}
