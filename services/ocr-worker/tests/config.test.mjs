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

// ---------------------------------------------------------------------------
// Step 10E audit hardening — integer parsing edge cases
// ---------------------------------------------------------------------------

test("unsafe-integer overflow rejected (env)", () => {
  // 2^53 + 1 — first integer Number.parseInt cannot represent precisely.
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_MAX_ITERATIONS: "9007199254740993" },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /max_iterations/.test(err.message) &&
      /safe integer|<=/.test(err.message),
  );
});

test("absurd-magnitude env value rejected (does not silently clamp to Infinity)", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_MAX_ITERATIONS: "99999999999999999999" },
        argv: [],
      }),
    OcrWorkerConfigError,
  );
});

test("max_iterations above explicit cap (1_000_000) rejected", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_MAX_ITERATIONS: "1000001" },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /max_iterations/.test(err.message) &&
      /<=\s*1000000/.test(err.message),
  );
});

test("max_iterations below explicit floor (1) rejected", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_MAX_ITERATIONS: "0" },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /max_iterations/.test(err.message) &&
      />=\s*1/.test(err.message),
  );
});

test("idle_delay_ms above explicit cap (60_000) rejected", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_IDLE_DELAY_MS: "60001" },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /idle_delay_ms/.test(err.message) &&
      /<=\s*60000/.test(err.message),
  );
});

test("idle_delay_ms accepts the boundary value (60_000)", () => {
  const cfg = parseOcrWorkerConfig({
    env: { OCR_WORKER_IDLE_DELAY_MS: "60000" },
    argv: [],
  });
  assert.equal(cfg.idle_delay_ms, 60_000);
});

test("partial numeric value rejected (e.g. '123abc')", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_IDLE_DELAY_MS: "123abc" },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError && /not an integer/.test(err.message),
  );
});

test("decimal value rejected (e.g. '1.5')", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_IDLE_DELAY_MS: "1.5" },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError && /not an integer/.test(err.message),
  );
});

test("scientific-notation value rejected (e.g. '1e3')", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_IDLE_DELAY_MS: "1e3" },
        argv: [],
      }),
    OcrWorkerConfigError,
  );
});

test("empty integer value rejected (argv form)", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: {},
        argv: ["--idle-delay-ms="],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /idle_delay_ms/.test(err.message) &&
      /empty/.test(err.message),
  );
});

test("whitespace-only integer value rejected (env form)", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_IDLE_DELAY_MS: "   " },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /idle_delay_ms/.test(err.message) &&
      /whitespace/.test(err.message),
  );
});

test("repeated argv flag rejected (--idle-delay-ms twice)", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: {},
        argv: ["--idle-delay-ms=10", "--idle-delay-ms=20"],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /repeated/.test(err.message) &&
      /idle-delay-ms/.test(err.message),
  );
});

test("repeated argv flag rejected even across forms (=value vs space-separated)", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: {},
        argv: ["--worker-id=a", "--worker-id", "b"],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError && /repeated/.test(err.message),
  );
});

test("repeated --include-empty-outcomes rejected (bare twice)", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: {},
        argv: ["--include-empty-outcomes", "--include-empty-outcomes"],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError && /repeated/.test(err.message),
  );
});

test("argv > env precedence still holds after stricter parsing", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER_IDLE_DELAY_MS: "100",
      OCR_WORKER_MAX_ITERATIONS: "50",
    },
    argv: ["--idle-delay-ms=7", "--max-iterations=3"],
  });
  assert.equal(cfg.idle_delay_ms, 7);
  assert.equal(cfg.max_iterations, 3);
});

test("env-only path still parses valid integers after stricter parsing", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER_IDLE_DELAY_MS: "0",
      OCR_WORKER_MAX_ITERATIONS: "1",
    },
    argv: [],
  });
  assert.equal(cfg.idle_delay_ms, 0);
  assert.equal(cfg.max_iterations, 1);
});

// ----------------------------------------------------------------------
// Step 10J — queue backend selection
// ----------------------------------------------------------------------

test("queue defaults to memory when neither env nor argv sets it", () => {
  const cfg = parseOcrWorkerConfig({ env: {}, argv: [] });
  assert.equal(cfg.queue, "memory");
});

test("OCR_WORKER_QUEUE=memory is accepted explicitly", () => {
  const cfg = parseOcrWorkerConfig({
    env: { OCR_WORKER_QUEUE: "memory" },
    argv: [],
  });
  assert.equal(cfg.queue, "memory");
});

test("--queue sqlite + --persistence sqlite + --sqlite-path parses cleanly", () => {
  const cfg = parseOcrWorkerConfig({
    env: {},
    argv: [
      "--queue",
      "sqlite",
      "--persistence",
      "sqlite",
      "--sqlite-path",
      "/tmp/ocr.db",
    ],
  });
  assert.equal(cfg.queue, "sqlite");
  assert.equal(cfg.persistence, "sqlite");
  assert.equal(cfg.sqlite_path, "/tmp/ocr.db");
});

test("OCR_WORKER_QUEUE=sqlite without persistence=sqlite throws", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_QUEUE: "sqlite" },
        argv: [],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /queue=sqlite requires persistence=sqlite/.test(err.message),
  );
});

test("--queue=sqlite with persistence=memory in env still throws", () => {
  // argv > env, but cross-validation must use the resolved values.
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_PERSISTENCE: "memory" },
        argv: ["--queue=sqlite"],
      }),
    OcrWorkerConfigError,
  );
});

test("argv --queue overrides env OCR_WORKER_QUEUE", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER_QUEUE: "sqlite",
      OCR_WORKER_PERSISTENCE: "sqlite",
      OCR_WORKER_SQLITE_PATH: "/tmp/ocr.db",
    },
    argv: ["--queue=memory"],
  });
  assert.equal(cfg.queue, "memory");
  assert.equal(cfg.persistence, "sqlite");
});

test("invalid --queue value rejects", () => {
  assert.throws(
    () => parseOcrWorkerConfig({ env: {}, argv: ["--queue", "redis"] }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /invalid queue/.test(err.message),
  );
});

test("repeated --queue flag rejects", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: {},
        argv: ["--queue", "memory", "--queue", "sqlite"],
      }),
    (err) =>
      err instanceof OcrWorkerConfigError &&
      /flag --queue repeated/.test(err.message),
  );
});

test("--help short-circuit returns queue=memory regardless of env", () => {
  const cfg = parseOcrWorkerConfig({
    env: { OCR_WORKER_QUEUE: "sqlite" },
    argv: ["--help"],
  });
  assert.equal(cfg.help_requested, true);
  assert.equal(cfg.queue, "memory");
});

// ---------------------------------------------------------------------------
// ADR-11C.3c — worker_kind + fetcher_file_root
// ---------------------------------------------------------------------------

test("worker_kind defaults to fake when OCR_WORKER unset", () => {
  const cfg = parseOcrWorkerConfig({ env: {}, argv: [] });
  assert.equal(cfg.worker_kind, "fake");
  assert.equal(cfg.fetcher_file_root, undefined);
});

test("OCR_WORKER=fake explicitly opts into the fake worker", () => {
  const cfg = parseOcrWorkerConfig({ env: { OCR_WORKER: "fake" }, argv: [] });
  assert.equal(cfg.worker_kind, "fake");
  assert.equal(cfg.fetcher_file_root, undefined);
});

test("OCR_WORKER=paddleocr-onnx with absolute OCR_FETCHER_FILE_ROOT parses cleanly", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER: "paddleocr-onnx",
      OCR_FETCHER_FILE_ROOT: "/var/ocr/incoming",
    },
    argv: [],
  });
  assert.equal(cfg.worker_kind, "paddleocr-onnx");
  assert.equal(cfg.fetcher_file_root, "/var/ocr/incoming");
});

test("OCR_WORKER=paddleocr-onnx without OCR_FETCHER_FILE_ROOT throws", () => {
  assert.throws(
    () => parseOcrWorkerConfig({ env: { OCR_WORKER: "paddleocr-onnx" }, argv: [] }),
    (err) => /paddleocr-onnx requires fetcher_file_root/.test(err.message),
  );
});

test("OCR_WORKER=paddleocr-onnx with relative OCR_FETCHER_FILE_ROOT throws", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: {
          OCR_WORKER: "paddleocr-onnx",
          OCR_FETCHER_FILE_ROOT: "relative/path",
        },
        argv: [],
      }),
    (err) => /must be an absolute path/.test(err.message),
  );
});

test("OCR_WORKER=paddleocr-onnx with empty OCR_FETCHER_FILE_ROOT throws (audit 019e3a8f D3 H)", () => {
  // Empty is rejected explicitly per ADR-11A.0 §10 (omitted-vs-empty
  // distinction). The message now says "must not be empty" rather
  // than the missing-required form.
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER: "paddleocr-onnx", OCR_FETCHER_FILE_ROOT: "" },
        argv: [],
      }),
    (err) => /must not be empty/.test(err.message),
  );
});

test("--worker paddleocr-onnx --fetcher-file-root /abs/path parses", () => {
  const cfg = parseOcrWorkerConfig({
    env: {},
    argv: ["--worker", "paddleocr-onnx", "--fetcher-file-root", "/var/ocr/in"],
  });
  assert.equal(cfg.worker_kind, "paddleocr-onnx");
  assert.equal(cfg.fetcher_file_root, "/var/ocr/in");
});

test("argv --worker overrides env OCR_WORKER", () => {
  const cfg = parseOcrWorkerConfig({
    env: { OCR_WORKER: "paddleocr-onnx", OCR_FETCHER_FILE_ROOT: "/var/ocr" },
    argv: ["--worker", "fake"],
  });
  assert.equal(cfg.worker_kind, "fake");
  // fake doesn't require root, but the env value still propagates
  // (harmless — the fake worker ignores it).
  assert.equal(cfg.fetcher_file_root, "/var/ocr");
});

test("argv --fetcher-file-root overrides env OCR_FETCHER_FILE_ROOT", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER: "paddleocr-onnx",
      OCR_FETCHER_FILE_ROOT: "/env/path",
    },
    argv: ["--fetcher-file-root", "/argv/path"],
  });
  assert.equal(cfg.worker_kind, "paddleocr-onnx");
  assert.equal(cfg.fetcher_file_root, "/argv/path");
});

test("invalid --worker value rejects with actionable error", () => {
  assert.throws(
    () => parseOcrWorkerConfig({ env: {}, argv: ["--worker", "tesseract"] }),
    (err) =>
      /unknown worker kind.*tesseract/.test(err.message) &&
      /"fake".*"paddleocr-onnx"/.test(err.message),
  );
});

test("repeated --worker flag rejects", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: {},
        argv: ["--worker", "fake", "--worker", "paddleocr-onnx"],
      }),
    (err) => /flag --worker repeated/.test(err.message),
  );
});

test("--help short-circuit returns worker_kind=fake regardless of env", () => {
  const cfg = parseOcrWorkerConfig({
    env: { OCR_WORKER: "paddleocr-onnx", OCR_FETCHER_FILE_ROOT: "/x" },
    argv: ["--help"],
  });
  assert.equal(cfg.help_requested, true);
  assert.equal(cfg.worker_kind, "fake");
  assert.equal(cfg.fetcher_file_root, undefined);
});

// --- audit 019e3a8f D3 H — explicit empty selector vs genuine omit ---------

test("OCR_WORKER='' (explicit empty) is rejected with actionable error", () => {
  // Per ADR-11A.0 §10: empty selector is a config error, NOT a silent
  // collapse to fake. Operators who want fake must omit OCR_WORKER
  // entirely, not set it to the empty string.
  assert.throws(
    () => parseOcrWorkerConfig({ env: { OCR_WORKER: "" }, argv: [] }),
    (err) =>
      /must not be empty/.test(err.message) &&
      /omit entirely to default to "fake"/.test(err.message),
  );
});

test("--worker= (explicit empty argv value) is rejected", () => {
  assert.throws(
    () => parseOcrWorkerConfig({ env: {}, argv: ["--worker="] }),
    (err) => /must not be empty/.test(err.message),
  );
});

test("OCR_FETCHER_FILE_ROOT='' under worker=fake is also rejected", () => {
  // Even though fake doesn't use the fetcher root, an explicit empty
  // string is still a malformed config signal per the same
  // omitted-vs-empty rule.
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_FETCHER_FILE_ROOT: "" },
        argv: [],
      }),
    (err) => /must not be empty/.test(err.message),
  );
});

// --- audit 019e3a8f D2 H — production fail-closed (ADR-11A.0 §10) ----------

test("OCR_WORKER_REQUIRE_REAL=1 with worker=fake is rejected (exit 2 maps here)", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { OCR_WORKER_REQUIRE_REAL: "1" },
        argv: [],
      }),
    (err) => /OCR_WORKER_REQUIRE_REAL=1 forbids worker=fake/.test(err.message),
  );
});

test("OCR_WORKER_REQUIRE_REAL=1 with worker=paddleocr-onnx parses cleanly", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      OCR_WORKER_REQUIRE_REAL: "1",
      OCR_WORKER: "paddleocr-onnx",
      OCR_FETCHER_FILE_ROOT: "/var/ocr",
    },
    argv: [],
  });
  assert.equal(cfg.worker_kind, "paddleocr-onnx");
});

test("NODE_ENV=production without OCR_WORKER_REQUIRE_REAL is rejected", () => {
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { NODE_ENV: "production" },
        argv: [],
      }),
    (err) => /NODE_ENV=production requires OCR_WORKER_REQUIRE_REAL=1/.test(err.message),
  );
});

test("NODE_ENV=production + OCR_WORKER_REQUIRE_REAL=1 + worker=fake is rejected", () => {
  // The OCR_WORKER_REQUIRE_REAL=1 guard fires first (default
  // worker_kind=fake).
  assert.throws(
    () =>
      parseOcrWorkerConfig({
        env: { NODE_ENV: "production", OCR_WORKER_REQUIRE_REAL: "1" },
        argv: [],
      }),
    (err) => /forbids worker=fake/.test(err.message),
  );
});

test("NODE_ENV=production + OCR_WORKER_REQUIRE_REAL=1 + worker=paddleocr-onnx parses", () => {
  const cfg = parseOcrWorkerConfig({
    env: {
      NODE_ENV: "production",
      OCR_WORKER_REQUIRE_REAL: "1",
      OCR_WORKER: "paddleocr-onnx",
      OCR_FETCHER_FILE_ROOT: "/var/ocr",
    },
    argv: [],
  });
  assert.equal(cfg.worker_kind, "paddleocr-onnx");
});

test("NODE_ENV=development + OCR_WORKER_REQUIRE_REAL unset + worker=fake passes (dev path)", () => {
  const cfg = parseOcrWorkerConfig({
    env: { NODE_ENV: "development" },
    argv: [],
  });
  assert.equal(cfg.worker_kind, "fake");
});
