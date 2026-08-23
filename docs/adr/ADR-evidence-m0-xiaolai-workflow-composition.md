# ADR: Evidence-Genie M0 × xiaolai Workflow Composition (EVW-00)

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

**Proposed** — 2026-06-22. Doc-only. Records a composition model and decisions.
**Does NOT authorize implementation.** Every downstream Work Item (WI) in
`dev-memo/plan-batch-casebox-evidence-workflow-port-00.md` enters the governed queue
(`dev-memo/run/queue.md`) and passes Codex `/cc-suite:review-plan` + queue-lint before it runs.

**Path note:** the intake brief requested this ADR at `dev-memo/adr/`; it is filed under `docs/adr/`
to match the repo's single ADR home (all sibling ADRs live there). Divergence from the brief
resolved in favor of repo convention per `AGENTS.md` §"Source hierarchy".

## Context

Two intake documents drive this ADR (both currently at repo root; the brief referenced them under
`dev-memo/intake/`, which does not exist — divergence recorded, files read at their actual paths):

- `Evidence-Genie-M0-Developer-Handover.md` — the legal/PDF/domain invariants for Evidence-Genie
  M0: a local-first, fully-offline macOS case-prep + courtroom tool. Four hard invariants
  (citation identity A1, anchor resolution A3, snapshot integrity A8, court-fileable export A10),
  plus the A0.7 geometry-source classification gate and A1-T9 readable-compression rule.
- `xiaolai-dev-workflow-study.md` — a source-verified study of the xiaolai workflow substrate:
  reusable plugins (`init-workspace`, `cc-suite`, `tdd-guardian`, `docs-guardian`, `loc-guardian`,
  `grill`, `echo-sleuth`) composed by a thin project-local `.claude/` orchestration.

**Current repo state (verified 2026-06-22, not assumed):**

- `AGENTS.md` is the single source of truth; `CLAUDE.md` and `GEMINI.md` are exactly `@AGENTS.md`.
  Config is public/committed. → The study's "single-source `AGENTS.md` + import" pattern is
  **already satisfied**; no migration WI needed.
- xiaolai plugins are installed via the marketplace. `.claude/settings.json` `enabledPlugins`:
  `cc-suite@xiaolai` **on**, `echo-sleuth@xiaolai` **on**; `tdd-guardian`, `loc-guardian`,
  `grill`, `docs-guardian` **off**. `.mcp.json` registers `codex-cli`; `.codex/config.toml` exists.
- Lawbar already owns a substantial `.claude/` orchestration: `rules/*.md` (autonomy, cc-suite,
  loc-guardian, staging-hygiene, echo-sleuth, security-boundary, client-local-first,
  execution-discipline, spark, project-brief), hard hooks (`block-git-add-all.sh`,
  `block-commit-stage-all.sh`, `batch-commit-guard.sh`, `block-contract-corruption.sh`,
  `protect-run-control.sh`, `block-run-control-bash-write.sh`), commands (cc-suite codex bridges,
  branch-clean, commit-gate, continue-project, spark, project-brief), skills (workflow,
  project-autopilot, security-wi-loop, cc-suite, etc.), and a **governed queue** mechanism
  (`dev-memo/run/queue.md` + `.governed`/`.linted`/`.reviewed` markers + `check-queue.sh`).
- `.claude/agents/` is **empty** — the least-privilege agent layer the study calls out (separation
  of duties enforced by per-agent `allowed_tools`) does not yet exist.
- Verification gate is `scripts/workflow/check-gates.sh` (runs `npm --prefix apps/lawbar-desktop
  test`). The intake brief named `./dev-memo/run/check-gates.sh`, which **does not exist** —
  divergence recorded; the real path is used.

**The two key facts that shape every decision below:**

1. The xiaolai substrate is *already ported* (plugins installed, bridge built, governance live).
   The remaining work is **composition**, not porting. We do not re-scaffold what exists.
2. Lawbar's `.claude/` is more enforcement-hardened than vanilla xiaolai (real `exit-2`/`deny`
   hooks vs the study's "advisory-by-default" finding). Evidence's court-facing invariants demand
   that *stop-grade* posture, not the cooperative-grade default.

## Decision

**Adopt a three-layer composition model, lower layers reusable and stable, upper layers
project- and domain-specific. Higher layers may constrain lower ones; no layer may weaken the
Evidence-Genie M0 invariants.**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 3 — Evidence-Genie M0 DOMAIN GATES   (most specific; never weakened) │
│   A0.7 geometry classification · A1 citation identity ·               │
│   A3 anchor resolution · A8 snapshot integrity/seal ·                 │
│   A10 export reproducibility · A1-T9 readable compression             │
│   Surfaced as: Evidence hard hooks + rules/evidence-genie.md +        │
│                deterministic-JSON harness command surface             │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 2 — LAWBAR .claude ORCHESTRATION   (project-specific; composes 1 into 3) │
│   rules/*.md · hard hooks · governed queue · autonomy/cc-suite policy  │
│   least-privilege agents · /feature-workflow /fix-issue               │
│   /evidence-workflow /evidence-geometry-gate                          │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 1 — xiaolai WORKFLOW SUBSTRATE   (reusable machinery; reused as-is) │
│   init-workspace · cc-suite (Claude↔Codex broker + stop-review gate) · │
│   tdd-guardian · docs-guardian · loc-guardian · grill · echo-sleuth   │
└─────────────────────────────────────────────────────────────────────┘
```

**Composition direction is downward-constraining, upward-delegating.** Layer 2 delegates generic
verbs (plan review, test-design pipeline, deep review, memory, LOC ceilings) to Layer 1 rather than
hand-rolling them. Layer 3 specializes Layer 2's commands and adds *stop-grade* enforcement that
Layer 1 deliberately leaves advisory. The Evidence invariants are the apex: any conflict between a
generic guardian and an Evidence invariant resolves in favor of the invariant.

### Decisions recorded

- **D1 — Reuse, do not hand-roll.** xiaolai provides the workflow machinery (cross-model
  delegation, TDD pipeline, docs/LOC guardians, deep review, memory). Lawbar MUST NOT reimplement
  any of it. Lawbar writes only the thin orchestration (Layer 2) and the domain gates (Layer 3).
  *Mechanism it beats:* re-building a plan/implement/review/audit pipeline in-repo would duplicate
  cc-suite's broker (job tracking, provenance disclosure, stop gate) and drift from upstream.

- **D2 — AGENTS.md is the single source of truth (already true; locked).** `CLAUDE.md`/`GEMINI.md`
  stay exactly `@AGENTS.md`. Public/committed config stays the default. The Evidence composition is
  recorded as a new AGENTS.md section (a WORKFLOW WI), never as prose in `CLAUDE.md`/`GEMINI.md`.

- **D3 — Guardian enablement is decided per-gate by teeth, not turned all on.** The study's central
  finding: xiaolai guardians are advisory-by-default and *look* enforcing without being so. Lawbar
  decides each guardian's role explicitly:
  - `cc-suite` (on) — **required** broker for high-risk WIs; unchanged.
  - `echo-sleuth` (on) — memory/continuity; unchanged.
  - `loc-guardian` — Lawbar already runs its **own** rule + local config + `/loc-guardian:scan`
    (`.claude/rules/loc-guardian.md`). Keep Lawbar's version; the plugin stays off to avoid two
    competing LOC authorities. (Recorded so a future reader does not "fix" the disabled plugin.)
  - `tdd-guardian` — **enable with teeth for Evidence WIs only.** The handover's WI workflow (§6/§7:
    test-design reviewed before code, four-point gate) maps onto tdd-guardian's `tdd-test-designer`
    + commit gate, but only if `blockCommitWithoutFreshGate: true`. Enablement is itself a future
    SCAFFOLD WI; coverage thresholds calibrated to what Evidence-core will actually maintain, not
    the shipped 100% theater.
  - `docs-guardian` — off for now; Lawbar's contract-doc integrity is already covered by
    `block-contract-corruption.sh`. Revisit only if doc-lag becomes a real failure mode.
  - `grill` — off; on-demand deep review is covered by cc-suite audit + (future) the Evidence
    invariant reviewer agent. Add later if a specific failure mode bites.

- **D4 — Evidence invariants get STOP-grade enforcement (hard hooks), not soft rules.** Five
  domain hard-hooks are planned (Layer 3). They protect court-facing correctness and therefore earn
  `exit 2` / `permissionDecision: "deny"`, matching the study's "hard" taxonomy and Lawbar's
  existing hook posture — not the cooperative-grade `allow`+warn default. The five:
  1. **No Evidence UI before A0.7 green** — deny edits under the (future) Evidence UI path until the
     A0.7 `renderer-conformance` gate passes (`Handover §12`, §5).
  2. **Citation single-source** — citation strings come only from the A10-T1 contract / `DocumentPage`
     (`Handover §3 A1`, §8, §12). Deny code that formats citations elsewhere (static-lint style).
  3. **Optimized rendition never canonical** — an `OptimizedDocumentRendition` is never a citation or
     anchor basis (`Handover §2`, §12).
  4. **Snapshot manifest/seal anti-circularity** — the manifest hashes a deterministic *logical*
     payload, not the encrypted DB holding the seal; the seal is separate (`Handover §10` anti-
     circularity rule, A8).
  5. **Offline entitlement check** — no network entitlement / no outbound network behavior in the
     Evidence app surface (`Handover §2`: sandbox-enforced offline).
  These hooks are **planned in this PR, not implemented** (no Evidence code exists to guard yet).
  They land as a future SCAFFOLD/WORKFLOW WI once the Evidence-core paths exist to scope them.

- **D5 — Evidence harness: deterministic-JSON command surface, scaffolded later, never falsely
  green.** The handover's permanent CI gates (`renderer-conformance`, `geometry-roundtrip`,
  `citation-stability-gate`, `coordinate-roundtrip`, `a3-regression`, `snapshot-verify`,
  `golden-export`, `compress-readability-fixtures`) are reified as a `native/evidence-core` command
  surface emitting deterministic JSON. In this composition PR they are **named and sequenced only**.
  When scaffolded, every harness that is not yet implemented MUST exit non-zero / report
  `not_implemented` as a **failure** — a `not_implemented` harness is NEVER treated as passing
  (intake hard constraint; `Handover §12` "do not treat not_implemented as passing").

- **D6 — Stop-review gate enabled iff Codex CLI login is available.** `.mcp.json` registers
  `codex-cli` and `.codex/config.toml` exists, so the cross-model adversarial Stop gate (the
  study's Stage G — the single highest-value mechanism) is *available* in principle. Its actual
  arming (the `stop-review-gate-hook.mjs`) is gated on a live Codex login verified via
  `/cc-suite:preflight` / `/codex:setup`. If login is absent, the gate is documented as
  unavailable and the WI proceeds with cc-suite audit/verify only — never treating an absent gate
  as a pass.

- **D7 — A0.7 is the first real Evidence architecture gate; this PR stops before it.** No Evidence
  product UI, anchors, export, snapshot, compression, OCR, AI/VLM, cloud, auth, or network behavior
  is implemented here. A0.7 (`renderer-conformance` with class-1/class-2 failure classification)
  remains the first downstream architecture gate and is built by a separate, governed WI after this
  composition lands.

## Consequences

**Positive.**
- One coherent map from reusable machinery → project orchestration → domain invariants, so future
  WIs know which layer owns a given concern (and do not duplicate Layer 1 in Layer 2).
- Evidence court-facing invariants are enforced at stop-grade, matching their legal stakes, while
  generic developer-ergonomics guardians stay advisory where appropriate.
- Nothing in this PR can ship Evidence behavior: it is composition + planning only, so it cannot
  violate the "no Evidence UI before A0.7" and "no network/crypto/snapshot yet" constraints.

**Negative / costs.**
- The full benefit (cross-model Stop gate, tdd-guardian teeth) depends on a live Codex login and on
  later enablement WIs; until then the composition is partly aspirational (D6/D3).
- Two LOC authorities exist conceptually (Lawbar rule vs disabled plugin); D3 resolves it by keeping
  the plugin off, but a reader must not re-enable it without reconciliation.
- (Resolved) ADR is filed under `docs/adr/`, matching the single ADR home; no relocation WI needed.

**Invariants this ADR must never be read to weaken** (`AGENTS.md` §"Critical invariants",
`Handover §3`/§12): citation identity, anchor resolution, snapshot integrity/anti-circularity,
export reproducibility, readable-compression, A0.7 classification, sandbox-enforced offline. A
generic guardian's convenience never overrides any of these.

## References

- `Evidence-Genie-M0-Developer-Handover.md` — domain invariants (Layer 3 source of truth).
- `xiaolai-dev-workflow-study.md` — substrate study (Layer 1 source of truth).
- `dev-memo/plan-batch-casebox-evidence-workflow-port-00.md` — the port plan + proposed WI sequence.
- `AGENTS.md` — project contract; single source of truth; queue governance; cc-suite policy.
- `.claude/rules/cc-suite.md`, `.claude/rules/autonomy.md`, `.claude/rules/loc-guardian.md`,
  `.claude/rules/echo-sleuth.md`, `.claude/rules/staging-hygiene.md` — Layer 2 policy this ADR composes.
- `docs/adr/client-application-surface.md` (CLIENT-00) — Mac desktop, local-first posture this ADR inherits.
