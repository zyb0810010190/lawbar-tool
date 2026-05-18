# ADR: OCR Engine Bakeoff Verdict + Lockfile (Step 11A.1 v0.1)

## Status

Accepted as **v0.1 — provisional verdict**. Decision-only. No code lands
in this step. Final v1.0 amendment requires the binding gates in §9.

Today's session shipped α + β + δ on `services/ocr-worker-bakeoff/`. The
synthetic Chinese verdict corpus (zh-02..zh-06) is the first
measurement-eligible set. This ADR captures the measurements taken
2026-05-18 on a darwin-arm64 host and pins the provisional verdict +
lockfile.

## Context

ADR-11A.0 §"11A.1" assigned this step the role of *engine bakeoff*:
choose a default OCR engine for the v1 real worker, with comparable
measurements across candidates and a lockfile pinning model versions.

`dev-memo/adr-11-series-plan.md` step 3 + Q3 (fixture provenance) +
Q4 (acceptance bars) closed earlier in the session:

- **Q3 (Hybrid fixtures):** ≥5 active synthetic + ≥2 active real
  Chinese-pleading samples in `services/ocr-worker-bakeoff/fixtures/`.
  Today the 5 synthetic side landed; the 2 real side awaits supply
  + PII review (see §9).
- **Q4 (Acceptance bars):**
  - Chinese CER on synthetic ≤ 5 %
  - Per-page latency on M-series ≤ 10 s
  - Peak RSS ≤ 2 GB
  - License Apache-2.0 / MIT / BSD; no GPL family
  - Tie-break order: **accuracy > license > install friction > latency > memory**

The candidate set committed in the prep brainstorm was Tesseract /
PaddleOCR / RapidOCR (and probes for EasyOCR / docTR / Surya / marker).
The session implemented two candidates:

- **β Tesseract 5.5.2** via system CLI (`services/ocr-worker-bakeoff/src/harnesses/tesseract.ts`).
- **δ PaddleOCR-via-ONNX-Node** via `@gutenye/ocr-node@1.4.8` —
  PaddleOCR ONNX models loaded under `onnxruntime-node`. This wrapper
  covers both the γ-PaddleOCR and δ-RapidOCR regions of the brainstorm
  because RapidOCR is itself a PaddleOCR-ONNX repackaging and the
  underlying engine identity is the same. γ via Python venv was
  explicitly skipped per user choice.

## Candidates measured

| Candidate | Version | Code license | Model license | Status |
|---|---|---|---|---|
| β Tesseract | 5.5.2 | Apache-2.0 | Apache-2.0 (tessdata_fast@4.1.0) | **probe_missing_model** on every zh-Hans fixture; chi_sim absent |
| δ PaddleOCR-via-ONNX-Node | 1.4.8 | MIT (`@gutenye/ocr-node`) | MIT (`@gutenye/ocr-models`, derivative of upstream Apache-2.0) | **available**; measured against all 5 fixtures |
| γ PaddleOCR via Python | — | — | — | **skipped** — δ covers the engine identity without a Python venv |

β is gated on `brew install tesseract-lang`. The bakeoff bin's
`collectLanguages` correctly identifies `zh-Hans` as a required
language; the Tesseract harness's probe returns `missing_model` for
`chi_sim.traineddata`. No comparative claim against δ is defensible
until β has Chinese data.

## Measurements — synthetic-only, δ-only

Captured 2026-05-18 on darwin-arm64 (Apple Silicon M-series), Node v24.14,
`@gutenye/ocr-node@1.4.8`. Each `run()` invocation spawns a fresh
subprocess via `/usr/bin/time -l`; cold model load and per-page
inference are timed separately inside the subprocess.

| Fixture | Category | CER | cold_load_ms | per_page_ms | peak_rss (MB) |
|---|---|---:|---:|---:|---:|
| zh-02-court-heading | court heading | 0.00 | 206 | 85 | 307 |
| zh-03-case-number | half-width parens | **0.150** | 134 | 81 | 292 |
| zh-04-judgment-paragraph | paragraph | 0.00 | 133 | 129 | 316 |
| zh-05-party-row | double-space separator | **0.091** | 133 | 78 | 274 |
| zh-06-mixed-cjk-latin | mixed CJK+Latin punct | **0.042** | 135 | 109 | 303 |
| **mean** | — | **0.056** | 148 | 96 | 298 |

The non-zero CER on zh-03 / zh-05 / zh-06 is honest engine signal under
the CER normative spec (`docs/contracts/...` — no punctuation folding,
no separator invention):

- **zh-03**: PaddleOCR emits full-width `（）` where the authored
  source has half-width `(` `)` + a space → three substitutions /
  ≈ 20 reference tokens.
- **zh-05**: PaddleOCR drops the double-space separator between
  parties; CER normalization collapses whitespace runs but does not
  invent missing separators → one deletion / 11 reference tokens.
- **zh-06**: Asymmetric punctuation behavior — opening `(` becomes
  full-width `（`, closing `)` stays half-width.

These are not fixture bugs; they are the exact measurement signal the
bakeoff exists to surface.

## Q4 acceptance-bar evaluation — δ

| Bar | Target | δ measurement | Pass? |
|---|---|---|---|
| Chinese CER on synthetic | ≤ 5 % | mean 5.6 % | **marginal fail** |
| Per-page latency on M-series | ≤ 10 s | 78–129 ms | pass |
| Peak RSS | ≤ 2 GB | ~300 MB | pass |
| License (engine + model) | Apache-2.0 / MIT / BSD, no GPL | MIT / MIT (derivative of Apache-2.0) | pass |
| Tie-break: accuracy > license > install friction > latency > memory | — | first-criterion miss | n/a |

The 5.6 % vs 5 % accuracy gap is small AND mechanically attributable to
half/full-width punctuation drift (zh-03 alone contributes 0.030 of the
mean). A v1.0 amendment may either widen the bar with a documented
mechanism, or relax to "CER excluding documented engine-specific
punctuation drift" once the real-fixture results give a fuller picture.

β has no measurement on Chinese, so its bar evaluation is **deferred**
to v1.0.

## Verdict — provisional

**δ PaddleOCR-via-ONNX-Node** is the **provisional default**. The case
is contingent, not absolute:

- δ is the only candidate that produced Chinese measurements at all.
  β is gated on a missing language pack; comparison is undefined until
  β has data.
- δ marginally fails Q4's accuracy bar (5.6 % vs ≤ 5 %), driven entirely
  by punctuation drift on three of the five fixtures. The remaining two
  fixtures score CER 0.

If v1.0 fails to seat β competitively (e.g. β scores worse on Chinese
once chi_sim is installed, or δ proves stable on the real-fixture
corpus), δ becomes the locked default. If β scores materially better,
the verdict can flip — that's the point of the v1.0 amendment.

## Lockfile (v0.1)

The provisional lockfile pins everything the measurements above depended
on. Replacing any item is a verdict-version change, not a casual bump.

### δ PaddleOCR-via-ONNX-Node

- `@gutenye/ocr-node@1.4.8` — MIT — engine wrapper
- `@gutenye/ocr-models@^1.2.2` (resolved bundle inside the engine) — MIT — detection + recognition + classification ONNX models
- `onnxruntime-node@^1.17.3-rev.1` — MIT — native ONNX runtime
- `sharp@^0.33.3` (transitive, image preprocessing) — Apache-2.0

### β Tesseract

- Tesseract 5.5.2 — Apache-2.0 — system CLI installed via
  `brew install tesseract`
- `tessdata_fast@4.1.0` — Apache-2.0 — eng / osd / snum traineddata bundled
- `tesseract-lang` (Homebrew formula) — Apache-2.0 — **required for v1.0
  but not installed today**; provides chi_sim / chi_tra / etc.

### Fixtures

- 5 synthetic Chinese-pleading PNGs at fixed SHA-256 (pinned in
  `services/ocr-worker-bakeoff/fixtures/manifest.json`)
- Expected `.txt` ground-truth at fixed SHA-256
- 1 English smoke fixture (`01-hello-bakeoff`) — excluded from verdict
  scoring (role=smoke)

### Measurement host

- darwin-arm64 (Apple Silicon M-series), macOS 15.x
- Node v24.14
- `/usr/bin/time -l` for RSS measurement (BSD)

Cross-host RSS comparison is NOT pinned; the v1.0 amendment should
record host metadata per measurement if a Linux baseline lands.

## Known limitations (v1.0 work items)

### M#3 — candidate-ordering bias

Today's bin executes `[tesseract, paddleocr-onnx]` in fixed order, and
the runner is candidate-major (all Tesseract runs, then all PaddleOCR
runs). With one candidate measured this didn't matter; with two real
candidates it will. Filesystem cache and CPU thermal state can bias
comparative latency / RSS readings.

v1.0 amendment SHOULD do one of:

- Randomize candidate order per fixture; record the seed in the report.
- Run counterbalanced passes (engine-A then engine-B, then engine-B then
  engine-A) and average.
- Fixture-major interleaving instead of candidate-major.

Source: audit thread `019e396b` M#3.

### M#4 — report cannot distinguish intentional drift from regression

The bakeoff's `cer_scores` carries `(candidate, fixture_id, cer)`. It
does NOT carry fixture category or expected-drift metadata. A future
reader sees `zh-03 = 0.15` and cannot tell whether that's known
half-width punctuation behavior, an expected-text bug, or an engine
regression. The intent currently lives only in the manifest's
`provenance`/`notes` prose.

v1.0 amendment SHOULD extend the report schema with at least:

- `category` — from the fixture manifest
- `expected_cer_band` or `intent` — author-documented expectation
  (e.g. "punctuation drift expected; CER ∈ [0.1, 0.2]")

Source: audit thread `019e396b` M#4.

### No real fixtures

Q3 sign-off required ≥2 active real Chinese-pleading fixtures. Today
there are 0. The placeholder `01-printed-chinese` is reserved but
inactive; real-document supply + PII redaction is a separate workstream.
Without real-world fixtures, the verdict's external validity is
limited — synthetic PNGs from a single font on a single host don't
exercise seal recognition, low-DPI scans, mixed handwritten + printed
content, or noise that real legal documents carry.

### chi_sim absent

β has no Chinese measurement. Until `brew install tesseract-lang` lands
on the measurement host, β cannot compete on the verdict corpus.
Tesseract's accuracy on Chinese legal text is empirically known to be
weaker than PaddleOCR, but "known" is not "measured"; v1.0 must measure
it.

### Single host

All measurements are darwin-arm64. PaddleOCR-ONNX latency, cold load,
and RSS can vary materially on Linux x86 — particularly cold load,
which is dominated by mmap'ing the ONNX runtime's native binaries.
v1.0 should either add a second host or document the single-host
constraint explicitly in the verdict.

## v1.0 amendment gate

ALL of the following before v1.0 verdict ships:

1. **chi_sim installed** on the measurement host (`brew install tesseract-lang`).
2. **≥2 real Chinese-pleading fixtures** added with `pii_review ∈ {redacted, not_required}` per the `RealActiveBakeoffFixture` contract.
3. **Bakeoff rerun** with both engines against the full corpus (5 synthetic + ≥2 real).
4. **M#3 candidate-ordering bias addressed** (randomized seed OR counterbalanced passes OR fixture-major interleaving — pick one, record in the report).
5. **M#4 intent metadata added** to `cer_scores` (at least `category`; ideally `expected_cer_band` too).

Any verdict change implied by the v1.0 measurements (e.g. β winning on
real-fixture accuracy despite higher synthetic CER) overrides this
provisional ADR. v1.0 lands as an amendment to this file, not a new
ADR.

## What this ADR does NOT decide

- Engine implementation (ADR-11C concern).
- Runtime / transport / `WORKER_REGISTRY` (ADR-11B).
- The fetcher contract (ADR-11A.0).
- The `OcrJobOutcome` mapping (ADR-11A.5).
- Real-fixture acquisition workflow (separate user-supplied data path).
- Multi-language coverage beyond `eng` and `zh-Hans`.
- Production deployment posture (`OCR_WORKER_REQUIRE_REAL`, etc.;
  ADR-11A.0 §10).

## Acceptance — ADR v0.1 itself

| Criterion | Result |
|---|---|
| ADR file at `docs/adr/ocr-engine-bakeoff-step-11a-1.md` | ✅ |
| Zero source-file edits in this commit | ✅ |
| Zero changes to manifest.json or fixture bytes | ✅ |
| Five package suites stay green | ✅ |
| Measurements traceable to a runnable bakeoff invocation (`node services/ocr-worker-bakeoff/bin/bakeoff.mjs --role=verdict`) | ✅ |
| Provisional status surfaced in §1 + §Verdict + §v1.0 gate | ✅ |
| Known limitations enumerated (M#3 / M#4 / no real fixtures / chi_sim absent / single host) | ✅ |

## Consequences

- ADR-11B (runtime / transport) can begin against the provisional
  default (δ PaddleOCR-via-ONNX-Node). If v1.0 flips the verdict, 11B
  rewires the registry.
- ADR-11C (implementation) inherits a measured engine baseline +
  documented lease-metric split (cold_model_load_ms ~135ms,
  per_page_inference_ms ~100ms).
- Case-box (Q5 paused) is unblocked to resume planning, treating δ as
  the engine assumption.
- The bakeoff package itself stays in-repo (Codex Q5 open-question
  resolved): re-run criteria = any candidate version bump, any new
  fixture, any verdict-affecting host change.

## Non-goals (strict)

- Implement γ via Python venv. δ covers the engine identity.
- Adopt cloud OCR (Aliyun / Google Vision / Azure) — ADR-11A.0 §5
  prohibits in v1 (C5 local-only default).
- Pick a runtime backend (sidecar vs in-process). ADR-11B's job.
- Define `partial_failure.is_transient` taxonomy. ADR-11A.5 v1.0's job.

## Open questions resolved by today's work

| Brainstorm Open Q | Resolution |
|---|---|
| Q1 (PageRef.source PDF support) | Resolved in ADR-11A.0 §8 — v1 image-only |
| Q3 (Engine/model redistribution) | δ MIT/MIT pass; β Apache-2.0/Apache-2.0 pass |
| Q4 (v1 quality gates) | Printed Chinese only confirmed; tables/seals/handwriting/vertical text deferred |
| Q5 (All-pages-rejected semantics) | Resolved in ADR-11A.0 §9 |

## Open questions for v1.0

| Question | Why it matters |
|---|---|
| Should ε relax the 5 % CER bar to "CER excluding documented punctuation drift"? | Synthetic punctuation drift is real but mechanical; real-document CER is what production cares about |
| Does Q3 require BOTH ≥5 synthetic AND ≥2 real to be active for the verdict, or is the count cumulative across kinds? | Today's reading: both required |
| Cross-host CER variance — single Apple Silicon measurement vs Linux x86? | Production hosts may differ; v1.0 should add a second host or document the constraint |
