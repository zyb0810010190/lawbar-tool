// Step 10E — parseOcrWorkerConfig tests.
//
// Pure parser: env + argv → typed config or thrown OcrWorkerConfigError.
// Argv flags override env. No process side-effects.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseOcrWorkerConfig,
  OcrWorkerConfigError,
} from "../dist/index.js";

test("defaults: empty env + empty argv yields safe defaults", () => {
  const cfg = parseOcrWorkerConfig({ env: {}, argv: [] });
  assert.equal(cfg.persistence, "memory");
  assert.equal(cfg.sqlite_path, undefined);
  assert.equal(cfg.idle_delay_ms, 250);
  assert.equal(cfg.max_iterations, undefined);
  assert.equal(cfg.include_empty_outcomes, false);
  assert.equal(typeof cfg.worker_id, "string");
  assert.ok(cfg.worker_id.length > 0);
});

test("env overrides defaults", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER_ID: "w-env",
      OCR_WORKER_PERSISTENCE: "sqlite",
      OCR_WORKER_SQLITE_PATH: "/tmp/ocr.db",
      OCR_WORKER_IDLE_DELAY_MS: "75",
      OCR_WORKER_MAX_ITERATIONS: "5",
      OCR_WORKER_INCLUDE_EMPTY_OUTCOMES: "true",
    },
    argv: [],
  });
  assert.equal(cfg.worker_id, "w-env");
  assert.equal(cfg.persistence, "sqlite");
  assert.equal(cfg.sqlite_path, "/tmp/ocr.db");
  assert.equal(cfg.idle_delay_ms, 75);
  assert.equal(cfg.max_iterations, 5);
  assert.equal(cfg.include_empty_outcomes, true);
});

test("argv overrides env", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER_ID: "w-env",
      OCR_WORKER_IDLE_DELAY_MS: "75",
    },
    argv: ["--worker-id=w-cli", "--idle-delay-ms=10"],
  });
  assert.equal(cfg.worker_id, "w-cli");
  assert.equal(cfg.idle_delay_ms, 10);
});

test("argv accepts space-separated form (--flag value)", () => {
  const cfg = parseOcrWorkerConfig({
    env: {},
    argv: ["--worker-id", "w-cli", "--max-iterations", "3"],
  });
  assert.equal(cfg.worker_id, "w-cli");
  assert.equal(cfg.max_iterations, 3);
});

test("include_empty_outcomes parses truthy/falsy strings", () => {
  for (const truthy of ["true", "1", "TRUE", "yes"]) {
    const cfg = parseOcrWorkerConfig({
      env: { OCR_WORKER_INCLUDE_EMPTY_OUTCOMES: truthy },
      argv: [],
    });
    assert.equal(cfg.include_empty_outcomes, true, `truthy: ${truthy}`);
  }
  for (const falsy of ["false", "0", "no", ""]) {
    const cfg = parseOcrWorkerConfig({
      env: { OCR_WORKER_INCLUDE_EMPTY_OUTCOMES: falsy },
      argv: [],
    });
    assert.equal(cfg.include_empty_outcomes, false, `falsy: ${falsy}`);
  }
});

test("invalid persistence value throws OcrWorkerConfigError", () => {
  assert.throws(
    () => parseOcrWorkerConfig({ env: { OCR_WORKER_PERSISTENCE: "redis" }, argv: [] }),
    (err) => err instanceof OcrWorkerConfigError && /persistence/.test(err.message),
  );
});

test("persistence=sqlite without sqlite_path throws", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_PERSISTENCE: "sqlite" },
        argv: [],
      }),
    (err) => err instanceof OcrWorkerConfigError && /sqlite_path/.test(err.message),
  );
});

test("invalid numeric value throws", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_IDLE_DELAY_MS: "not-a-number" },
        argv: [],
      }),
    (err) => err instanceof OcrWorkerConfigError && /idle_delay_ms/.test(err.message),
  );
});

test("negative idle delay throws", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_IDLE_DELAY_MS: "-1" },
        argv: [],
      }),
    OcrWorkerConfigError,
  );
});

test("unknown flag throws", () => {
  assert.throws(
    () => parseOcrWorkerConfig({ env: {}, argv: ["--bogus"] }),
    (err) => err instanceof OcrWorkerConfigError && /unknown/.test(err.message),
  );
});

test("--persistence=sqlite --sqlite-path=...", () => {
  const cfg = parseOcrWorkerConfig({
    env: {},
    argv: ["--persistence=sqlite", "--sqlite-path=/tmp/x.db"],
  });
  assert.equal(cfg.persistence, "sqlite");
  assert.equal(cfg.sqlite_path, "/tmp/x.db");
});

test("--include-empty-outcomes as bare flag means true", () => {
  const cfg = parseOcrWorkerConfig({
    env: {},
    argv: ["--include-empty-outcomes"],
  });
  assert.equal(cfg.include_empty_outcomes, true);
});

test("--help is recognized and surfaces a help-marker config field", () => {
  const cfg = parseOcrWorkerConfig({ env: {}, argv: ["--help"] });
  assert.equal(cfg.help_requested, true);
});
