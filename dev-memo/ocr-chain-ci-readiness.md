# OCR service-chain CI readiness

**WI**: `WI-OCR-CHAIN-CI-READINESS-19`. Clean-room investigation of whether the OCR service chain can be gated in
PR CI. **Outcome: YES — an `ocr-chain` job was added** in `.github/workflows/services-ci-ocr.yml` (a separate
workflow from the case-box `services-ci.yml`, per the WI-19 audit). Revisits the
`WI-SERVICES-CI-GATES-SIBLINGS-18` deferral, which was **over-cautious** (it assumed local passes were unreliable
and the engine prohibitive; a clean-room fresh checkout shows the chain is fast, deterministic, and npm-cacheable).

## Dependency / build order

`docs/contracts` (`ocr-worker-contract`) → `services/ocr-worker` (**package `ocr-worker-adapter`**, owns the OCR
engine) → `services/ocr-persistence` → `services/ocr-ingestion` → `services/ocr-review`. All inter-package deps are
`file:` links; `dist/` is gitignored, so a clean checkout must build in this order.

## Clean-room results (fresh `git worktree`, no prior `node_modules`/`dist`)

| Package | pkg name | lock | clean `npm ci` | clean `npm test` | needs |
|---|---|---|---|---|---|
| `services/ocr-worker` | ocr-worker-adapter | ✓ | **43s, 332 MB** | **472 pass / 3 skipped**, 6.8s | OCR engine (installed, **not run** — real-engine tests `OCR_WORKER_REAL_ENGINE_TESTS`-gated → skipped); SSRF/TLS/DNS tests use **in-process loopback** transport (no external network) |
| `services/ocr-persistence` | ocr-persistence | ✓ | 7s | **231 pass**, 1.9s | `better-sqlite3` node-ABI + `abi-smoke` pretest |
| `services/ocr-ingestion` | ocr-ingestion | ✓ | 7s | **30 pass**, 3.8s | uses `ocr-persistence` + `ocr-worker-adapter` dist (built by earlier steps) |
| `services/ocr-review` | ocr-review | ✓ | 7s | **38 pass**, 3.4s | E2E is **in-memory** (`InMemoryOcrQueue` + `InMemoryOcrPersistence` + injected fake worker); its `test` builds the whole chain |

**Total:** ~78s install (cacheable) + ~16s test. All from a genuine fresh checkout.

## Blocker matrix — every WI-18 concern resolved

| Concern (WI-18) | Clean-room finding | Verdict |
|---|---|---|
| Native OCR engine (~326 MB) | 332 MB, installs in 43s | **acceptable + npm-cacheable** |
| Model source | Bundled in the npm package `@gutenye/ocr-models` (`.onnx` assets) — **not** external URLs | **deterministic** |
| onnxruntime-node / sharp native binaries | Bundled per-platform inside the npm packages — **no external CDN download** | **deterministic** |
| Network in tests (SSRF/TLS/DNS) | Fetcher e2e tests use **in-process loopback** transport; no `ECONNREFUSED`/`ENOTFOUND`/`getaddrinfo` | **deterministic, CI-safe** |
| Real OCR **inference** | Gated by `OCR_WORKER_REAL_ENGINE_TESTS` → **skipped** by default (3 skipped) | **not run in CI** |
| Native engine **load/startup** | The default suite *does* load the onnxruntime binding + spawn the bin against an empty queue (passed in clean-room) | **run — intentional** (gates that the binding loads on the runner) |
| Tests rely on stale local `dist/` | Clean-room (no `dist/`) passes when run in dependency order | **works from source** |
| `@gutenye` omitted in ocr-ingestion/ocr-review locks | **Benign** — those services don't install the engine directly (only `ocr-worker` does); their clean `npm ci` works | **not a blocker** |
| Reasonable runtime | ~78s install (cached faster) + ~16s test | **reasonable** |
| Secrets / real data | None required | **safe** |

## Decision — add the `ocr-chain` job (in a SEPARATE workflow)

Every "add CI only if…" condition holds, so an `ocr-chain` job was added in its **own** workflow
`.github/workflows/services-ci-ocr.yml` — separate from `services-ci.yml` (the case-box job) so an OCR-only PR does
not pull the 332 MB OCR engine into the case-box job, and a case-box PR does not run the OCR chain (each workflow is
single-purpose + path-isolated). It is ubuntu-latest, Node 22, `contents: read`, `persist-credentials: false`,
concurrency-cancel, npm cache on all five lockfiles; it `npm ci`s each package then runs the four suites in
dependency order (`ocr-worker` → `ocr-persistence` → `ocr-ingestion` → `ocr-review`) so each service's `file:` deps
are built first. Same by-policy/advisory merge posture as `services-ci` (this repo lacks enforceable branch
protection — see `dev-memo/services-ci-gates.md` §Guardrails).

## Residual notes / future
- **Real OCR inference** stays **opt-in** (`OCR_WORKER_REAL_ENGINE_TESTS=1`) — running it in CI would OCR real
  fixtures (slower), out of scope. But the default suite **does** exercise native engine **load/startup** (the
  onnxruntime binding + a bin spawn against an empty queue), which is intentional: it gates that the binding loads
  on the runner. The gate proves the chain builds + its deterministic tests (incl. engine load) pass.
- If npm caching of the 332 MB engine proves flaky/slow in practice, add an explicit cache key or split per service
  — a follow-up only if a real problem appears.
