// launchPackaged — Playwright `electron.launch` wrapped to record the
// resulting main-process pid into LAWBAR_TEST_PID_LOG for post-suite
// attribution by scripts/test-packaged-wrapper.mjs. Per
// dev-memo/plan-pkg-verify-detection-redesign-00.md §4 (rev-0.2.1; committed
// at 7f16c5d).
//
// Helper-side isCi check is supplementary diagnostic; the LOAD-BEARING
// CI-bypass detection is the top-of-file sentinel block in the test file
// itself (per §6 Guard #3 rev-0.1).

import fs from "node:fs";
import { _electron as electron } from "playwright";

const env = process.env;
const isCi = env.LAWBAR_CI === "true" || env.CI === "true";

/**
 * Launch a packaged Electron app via Playwright + record the resulting main
 * process pid into LAWBAR_TEST_PID_LOG.
 *
 * @param {object} options - Playwright `electron.launch` options.
 * @param {object} ctx - `{ testName: string, iteration?: number }`.
 * @returns {Promise<import("playwright").ElectronApplication>}
 */
export async function launchPackaged(options, ctx) {
  const pidLogPath = env.LAWBAR_TEST_PID_LOG;
  if (pidLogPath === undefined || pidLogPath === "") {
    if (isCi) {
      throw new Error(
        "[launchPackaged] LAWBAR_TEST_PID_LOG missing in CI — must run through "
        + "scripts/test-packaged-wrapper.mjs. See dev-memo/plan-pkg-verify-detection-redesign-00.md §6 Guard #3.",
      );
    }
    if (env.LAWBAR_ALLOW_UNWRAPPED_TEST !== "true") {
      console.warn(
        "[launchPackaged] LAWBAR_TEST_PID_LOG missing in dev; proceeding without pid-logging. "
        + "Set LAWBAR_ALLOW_UNWRAPPED_TEST=true to suppress this warning.",
      );
    }
  }

  const app = await electron.launch(options);
  const pid = app.process().pid;

  if (pidLogPath !== undefined && pidLogPath !== "") {
    const entry = {
      pid,
      launchedAt: new Date().toISOString(),
      testName: ctx?.testName ?? "<unnamed>",
      iteration: ctx?.iteration ?? null,
      bundleRoot: options?.executablePath
        ? options.executablePath.replace(/\/Contents\/MacOS\/.*$/, "")
        : null,
    };
    try {
      fs.appendFileSync(pidLogPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch (e) {
      console.warn(`[launchPackaged] could not append to pid-log ${pidLogPath}: ${e.message}`);
    }
  }

  return app;
}
