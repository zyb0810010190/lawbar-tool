# Plan — WI-OCR-CHAIN-CI-READINESS-19

**Type**: WORKFLOW/CI (workflow + docs). **No product/schema change.** Revisits the `WI-SERVICES-CI-GATES-SIBLINGS-18`
deferral with a clean-room proof. `main` @ `27cbd86`.

## First step (done)

Due Layer-B closeout for window `f7cdbd9..27cbd86` → `audit-mre9ynm0-gzn9ge` **BATCH-PASS C0 H0 M0 L1** (one
undescribed Low; docs-only window) → closeout `6d55786`, marker → `27cbd86`.

## Goal

Make a concrete readiness call on gating the OCR chain in CI, and add CI **only if** a clean-room proof succeeds.

## Method — clean-room

Created a fresh `git worktree` (detached at `27cbd86`, no `node_modules`/`dist`) and ran the full OCR chain
install/build/test from a genuine clean checkout. Full results + blocker matrix in `dev-memo/ocr-chain-ci-readiness.md`.

## Findings (proof succeeded)

- Build order: `docs/contracts` → `ocr-worker` (=`ocr-worker-adapter`, OCR engine) → `ocr-persistence` →
  `ocr-ingestion` → `ocr-review`.
- Clean `npm ci` + `npm test` **pass for all four** from a fresh checkout: ocr-worker 472/3-skipped (6.8s),
  ocr-persistence 231 (1.9s), ocr-ingestion 30 (3.8s), ocr-review 38 (3.4s).
- Engine install: **43s / 332 MB, all npm-sourced** (models bundled in `@gutenye/ocr-models`; onnxruntime + sharp
  binaries bundled per-platform in the npm packages — **no external CDN**) → deterministic + npm-cacheable.
- Real-engine tests are `OCR_WORKER_REAL_ENGINE_TESTS`-gated → **skipped** (engine installed, not run).
- Fetcher SSRF/TLS/DNS tests use **in-process loopback** transport → no external network, deterministic.
- The `@gutenye` omission in ocr-ingestion/ocr-review locks is **benign** (they don't install the engine directly).
- Every "add CI only if…" condition holds → the WI-18 deferral was over-cautious.

## What was added

- `.github/workflows/services-ci-ocr.yml` — a **separate** workflow with the **`ocr-chain`** job (ubuntu-latest,
  Node 22, `contents: read`, `persist-credentials: false`, concurrency-cancel, npm cache on all five OCR lockfiles):
  `npm ci` each package, then the four suites in dependency order. Path-filtered to the OCR services + `docs/contracts/**`
  + the workflow file. **Kept separate from `services-ci.yml`** (per the WI-19 audit L1) so an OCR-only PR doesn't
  pull the 332 MB engine into the case-box job, and vice-versa.
- `.github/workflows/services-ci.yml` — header comment only: points at the new OCR workflow; the `case-box-persistence`
  job + its (narrow) paths are unchanged.
- `dev-memo/ocr-chain-ci-readiness.md` (readiness + blocker matrix) + this plan.
- `dev-memo/services-ci-gates.md` — sibling section updated: OCR chain is now gated (not deferred).

**Real-engine scope (per the WI-19 audit M):** real OCR *inference* stays `OCR_WORKER_REAL_ENGINE_TESTS`-gated
(skipped); the default suite *does* exercise native engine **load/startup** (onnxruntime binding + a bin spawn on an
empty queue) — intentional, so the gate confirms the binding loads on the runner. Docs/comments say this precisely.

## No package/lockfile changes

The lockfiles are correct as-is (the `@gutenye` omission in ingestion/review is benign — verified by clean-room
`npm ci`). No lockfile regeneration needed.

## Acceptance

Clean-room full-chain install/build/test green (above). Regressions: `case-box-persistence` ci + test; desktop
test + dist + smoke. Live: the `ocr-chain` job runs on this PR (it touches the OCR paths + the workflow).

## Requirements honored

No product UI / desktop-release-gates / `check-ui-design-artifact` touched; existing `case-box-persistence` job
unchanged; no secrets; no signing; no real client data; `dev-memo/run/intake/` untouched; **no committed
`node_modules` / OCR models / `dist` / OCR outputs / release artifacts / credentials** (the clean-room worktree is
outside the repo and removed after).

## Out of scope

Running the real OCR engine in CI (stays `OCR_WORKER_REAL_ENGINE_TESTS`-opt-in); any product/schema change;
per-service job splitting (only if npm caching of the engine proves problematic).
