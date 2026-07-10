# OCR real-engine inference smoke (CI)

**WI**: `WI-OCR-REAL-ENGINE-SMOKE-20`. Determines whether a minimal **real OCR inference** smoke can safely run in
CI, and — **it can** — adds one to the `ocr-chain` job. Builds on `WI-OCR-CHAIN-CI-READINESS-19` (the OCR chain
gates load/startup but skipped real inference). CI/scaffold only; no product/service/schema change.

## Real-engine test inventory

Two `OCR_WORKER_REAL_ENGINE_TESTS`-gated files under `services/ocr-worker/tests/`:
- `engines.real-paddleocr-engine.test.mjs` — cold-loads the real paddleocr-onnx engine and (opt-in) `detect`s the
  synthetic PNG: asserts **≥1 BMP CJK character** (`/[一-鿿]/`, not exact text) + **deep-equal determinism** across
  two calls.
- `pipeline.real-engine.e2e.test.mjs` — bin → real paddle → persisted `succeeded` result **with CJK text** (uses
  the vendored committed fixture `tests/fixtures/zh-02-court-heading.png`).

The version-drift + `makeRealPaddleEngine cold-loads` tests are **not** gated — they run in the default suite and
already gate engine load/startup.

## Fixture (input)

`services/ocr-worker/tests/fixtures/zh-02-court-heading.png` (also `services/ocr-worker-bakeoff/fixtures/synthetic/`)
— an **8 KB, 800×80 grayscale, SYNTHETIC** simplified-Chinese court heading, rendered with Hiragino Sans GB
(ImageMagick). **Authored ground truth**: `上海市浦东新区人民法院` (`zh-02-court-heading.txt`). **Already committed +
tracked** — nothing new to add. **Not a real client document.**

## Safety / stability assessment (every "add CI only if…" condition)

| Condition | Finding | ✓ |
|---|---|---|
| No real client data | Synthetic authored fixture (`上海市浦东新区人民法院`), committed | ✓ |
| No external network (beyond npm install) | Detect runs on a local file; no network | ✓ |
| No generated model/image artifacts committed | Fixtures already committed; the smoke commits nothing | ✓ |
| Fixture synthetic + small | 8 KB PNG | ✓ |
| Runtime reasonable | **4.7s local** for all real-engine tests (dist reused; engine already installed by the chain) | ✓ |
| Output assertion stable | `/[一-鿿]/` (≥1 CJK char) + `deepEqual` determinism + E2E "succeeded + CJK" — **not** exact-text | ✓ |
| Failure mode useful, not flaky | Fails only if the engine detects **no** CJK char, output is **non-deterministic**, or the E2E result isn't persisted — all real regressions | ✓ |
| No secrets | None | ✓ |
| No product behavior change | CI step + docs only | ✓ |

**Measured:** `OCR_WORKER_REAL_ENGINE_TESTS=1 node --test <both files>` → **10 pass / 0 fail / 0 skipped** in **4.74s**
(detect-CJK 132ms, deterministic 190ms, E2E 475ms).

## Decision — enable the smoke

A dedicated step **"ocr-worker real-engine inference smoke (synthetic fixture)"** was added to the `ocr-chain` job
(`.github/workflows/services-ci-ocr.yml`), after the default ocr-worker suite (so the built dist is reused):

```
working-directory: services/ocr-worker
env: { OCR_WORKER_REAL_ENGINE_TESTS: "1" }
run: node --test tests/engines.real-paddleocr-engine.test.mjs tests/pipeline.real-engine.e2e.test.mjs
```

- **Env / command:** `OCR_WORKER_REAL_ENGINE_TESTS=1` on the two real-engine test files.
- **Expected assertion:** real paddleocr-onnx detects **≥1 CJK char** on the synthetic heading, deterministically,
  and the E2E persists a `succeeded` OCR result with CJK text.
- **Runtime:** ~5s (on top of the existing chain; engine already installed).
- **No test/fixture change** — the tests + synthetic fixtures already exist; only CI enables them.

The default ocr-worker suite still runs with the env **unset** (real inference skips there) — so the gate proves
both the skip-path and, in the dedicated step, the real-inference path. Same by-policy/advisory merge posture as the
rest of `services-ci` (this repo lacks enforceable branch protection).

## Not broadened

This is a **smoke** (does inference work + is it stable), NOT OCR **accuracy benchmarking** — no exact-text or
accuracy-threshold assertions, no accuracy fixtures. Accuracy measurement stays in the dev-only
`services/ocr-worker-bakeoff` package, out of CI.
