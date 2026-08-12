# ADR: Native Evidence Core / A0.7 feasibility (ENA-00)

> ### ⚠️ SUPERSEDED IN FACT — 2026-08-10
>
> **The enforcement machinery this ADR describes in the present tense no longer exists.** It was
> deleted in the configuration reset of 2026-08-10 (commit `49dd7ad`) and the follow-up reset of
> 2026-08-12 (`e67b047`). Verified 2026-08-12:
>
> - `scripts/workflow/` contains only `check-internal-tarballs.mjs`,
>   `refresh-internal-lock-integrity.mjs` and its test. **`check-a07-gate.sh`,
>   `a07-marker-write.sh`, `a07_marker.py`, `check-marker-guard.sh` and `check-gates.sh` are gone.**
> - `.claude/` holds only `settings.json` and `docs-guardian/`. No `rules/`, `commands/`,
>   `agents/`, `skills/`, or hooks.
> - `dev-memo/run/` — the governed queue, its markers and its review archive — does not exist.
>
> **Consequences for anything read below.** There is no A0.7 gate, so nothing "fails closed": an
> A0.7-dependent action proceeds unchecked. There is no marker writer or validator, so a file that
> merely looks like a marker cannot be distinguished from a real one. There is no run-control
> guard, so any marker-forgery hole this ADR describes as closed is **open**.
>
> A0.7 is **PROVISIONAL, not green**. This ADR now records intent and reasoning only. Read every
> "is built / is enforced / fails closed / is wired" claim in it as past tense.


## Status

**Proposed** — 2026-06-22. Doc-only. **Does NOT authorize implementation.** It records the proposed
architecture for the real Evidence Core + the A0.7 gate. Introducing Swift/SwiftPM/PDFKit, macOS CI, a real
A0.7 harness, or an A0.7 marker are **autonomy hard-stops requiring separate explicit user authorization**.
Feasibility analysis: `dev-memo/plan-batch-casebox-evidence-native-a07-feasibility-00.md` (WI-ENA0).

## Context

The Evidence-Genie M0 workflow scaffold (EVW lane, on `main` `6dc2526`) and the product-definition docs (EPD
lane, `02ce88d`) are merged. The harness today is a **dependency-free JS contract shim** at
`native/evidence-core/` whose `renderer-conformance` (A0.7) returns `not_implemented` (a failure). **A0.7 —
PDFKit coordinate fidelity + page-identity stability on real messy 卷宗 — is the first real Evidence
architecture gate**, and it cannot be validated in JS. The EVW5 hard-hook lane was deferred precisely because
the protected surfaces (native core, A0.7 marker provenance) do not exist yet. This ADR proposes the
architecture to build them.

## Decision (proposed)

1. **Toolchain: Swift + SwiftPM + PDFKit** for the real native Evidence Core; PDFKit is macOS-only and is
   required for controlled-renderer coordinate fidelity. The JS shim remains the contract bridge until the
   Swift core is authorized and passing.
2. **CI split: `ubuntu-latest`** keeps the Node/Electron/contract tests; a new **`macos-latest`** job runs
   the Swift build + the A0.7 `renderer-conformance` gate against synthetic fixtures.
3. **Boundary**: Swift/PDFKit owns render + geometry + coordinate transforms + A0.7 conformance; Node/Electron
   owns persistence + IPC + UI + existing services. The Swift core exposes the **same** deterministic-JSON
   CLI contract as the shim (same command names, envelope, exit codes), so callers are unchanged.
4. **A0.7 semantics**: deterministic JSON; `not_implemented`→failed until real; **per-failure classification
   Class-1 (normalization, fixable inline) vs Class-2 (geometry-source instability, architectural STOP).**
5. **A0.7 marker provenance**: the pass marker
   (`dev-memo/run/evidence/a07.renderer-conformance.passed.json`) is created **only** by the real harness on
   a genuine pass and carries a harness-computed `provenanceHmac` over `(harnessVersion, fixtureSetSha256,
   resultSha256)`. **Schema-valid ≠ provenance-valid**; consumers verify the HMAC, so a hand-authored/edited
   marker is rejected. Agent fabrication is additionally blocked by extending the run-control guards to
   `dev-memo/run/evidence/**` (Write/Edit **and** Bash) — two independent layers. This closes the
   marker-forgery hole the EVW5 review found.
6. **Security boundary**: local-only; no cloud/network; **synthetic/public CI fixtures only** (no
   confidential client 卷宗 in git or CI).

## Consequences

**Positive**: a sound, controlled-renderer path to a real A0.7 gate; a marker that is tamper-evident
(provenance-protected), unblocking the EVW5 hard hooks against real surfaces; a CLI contract that lets the
Swift core drop in behind the existing shim without changing callers.

**Negative / costs**: introduces a **macOS toolchain + macOS CI** (cost ~10× Linux minutes; lower
concurrency) — both hard-stops; the Swift core is a new build surface to maintain; counsel-supplied real
fixtures need a separate, access-controlled handling decision (out of scope here).

**Hard-stops carried forward (require explicit authorization before implementation)**: Swift/SwiftPM/PDFKit;
macOS CI; the real A0.7 harness; the A0.7 marker; the EVW5a/EVW5b hard hooks; Evidence UI (only after A0.7
green). This ADR authorizes none of them.

## References
- `dev-memo/plan-batch-casebox-evidence-native-a07-feasibility-00.md` (ENA0 feasibility plan).
- `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00), `.claude/rules/evidence-genie.md`,
  `dev-memo/evidence-product-definition-closeout-00.md`, `native/evidence-core/` (JS shim),
  `.claude/rules/autonomy.md`, `.claude/rules/client-local-first.md`.
