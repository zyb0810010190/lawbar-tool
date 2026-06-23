# Queue review 071 — WI-A3-T1 (anchor/link schema + persistence contract design; design-only, NOT A0.7-gated)

**Date**: 2026-06-23.
**WI**: WI-A3-T1 — author the A3 anchor/link SCHEMA + PERSISTENCE contract (ADR + dev-memo plan) before any
migration/persistence code: anchor storage model, geometry-version binding, link model + LinkStatus,
replacement/quarantine effects, deletion/cascade (unresolved), migration boundaries, A0.7-dependence for the
future impl WIs, and the test strategy. **Design/ADR only**: no schema/migration/persistence code, no
dependency, no UI/product, no resolver/export impl, no marker/key/gate change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `812673cd415f4a1581e52b6c31c5691b5135d8e1779c7e7b33544106a1fd9538`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; the contract governs eventual HIGH-RISK persistence/migration work).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-T1 block (compact packet inlined) + the 8 decision groups.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqr8wq1u-btt8w2`.
- **threadId**: none emitted.
- **rawOutput sha256**: `d453f124ed2331c9e21286143c857721a74f5ed83a374ba4f8e2e4bebff1d1f6`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — Codex confirmed: a docs-only persistence-contract
ADR that adds no schema/migration/storage-dependency/marker behavior does not need the A0.7 gate, while the
future implementation/migration WI does (it creates durable persistence later Evidence layers rely on). Also
confirmed: (3) the migration boundary order (schema-only → resolver/status → export) is right and keeps
business transitions out of the first schema WI; (5) no scope creep.

## Findings to fold into the ADR
- **Medium — choose fixed 12-dp string storage.** The ADR MUST pick the canonical `page_ratio` storage type,
  not leave it open: store the **fixed 12-dp decimal STRING** (the A3-T2 canonical form) — stronger than a
  numeric/decimal type because it avoids driver/runtime formatting drift, binary-float issues, locale/
  serialization differences, and later re-rounding ambiguity. A numeric/decimal type is acceptable ONLY if
  the storage engine guarantees exact decimal lexical round-trip — a storage-engine-specific constraint, so
  that option is explicitly DEFERRED to the future storage-engine/dependency WI. RESOLVED in the ADR
  (decision 1 picks the 12-dp string; numeric deferred); verified by `/cc-suite:verify`.
- **Low — tighten "valid".** No implicit `valid` default (status must be explicitly derived); persisted
  anchors/links MUST carry enough status/provenance fields that geometry mismatch / document replacement /
  absent provenance / missing target cannot default to `valid`; `geometryCapturedAt` is immutable for a
  stored anchor unless superseded by a future immutable geometry key; deletion/cascade stays unresolved and
  delegated to the future A3-T6-equivalent stop-and-ask. RESOLVED in the ADR.

## Disposition
READY → eligible to govern. The Medium + Low are design-content items authored into the ADR/plan in this same
lane and confirmed by the post-authoring broker audit + verify; none is a scope change into
implementation/migration/dependency/UI/marker/gate (no stop-and-ask trigger fired). Proceeding to
mark-reviewed + govern (standalone, content-bound to sha `812673cd…`). After authoring, broker
`/cc-suite:audit` + `/cc-suite:verify` run on the design packet before the design commit.

QUEUE_REVIEW_VERDICT=PASS
