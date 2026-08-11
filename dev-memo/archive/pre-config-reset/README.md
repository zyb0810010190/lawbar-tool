# Configuration reset — 2026-08-10

The workflow / scaffolding / harness configuration was deleted wholesale so it could be rebuilt from
scratch. This file records what went, what deliberately stayed, and what a rebuild should know.

**Save point:** tag `pre-config-reset` + branch `backup/pre-config-reset` (both at the pre-deletion HEAD).
Everything below is recoverable with `git checkout pre-config-reset -- <path>`.

## Deleted

| Layer | What | Count |
|---|---|---|
| Contract docs | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `BATCH-AUDIT.md`, `UI-GATES.md`, `PLUGIN-GOVERNANCE.md` | 6 |
| Rules | `.claude/rules/**` — autonomy, cc-suite, staging-hygiene, evidence-genie, loc-guardian, client-data, plan-execution, execution-discipline, security-boundary, client-local-first, spark, project-brief, echo-sleuth | 13 |
| Commands / agents / skills | `.claude/commands/**`, `.claude/agents/**`, `.claude/skills/**` | 9 / 6 / 7 |
| Hooks | `.claude/hooks/**` + wiring in `.claude/settings.json` | 8 + 9 tests |
| Governance scripts | `scripts/workflow/**` — queue lint/govern/review, batch closeout, A0.7 marker provenance, gate + staging checks | 21 |
| Run control | `dev-memo/run/**` — governed queue, batch state, breaker, human tokens | — |
| Bridges | `.codex/`, `.gemini/`, `.agents/` | 7 |
| CI | `.github/workflows/ui-design-artifact.yml` (governance gate; its script went with it) | 1 |

## Deliberately kept

- **`native/evidence-core-swift/`** — the A0.7 renderer-conformance gate. Product-critical, not scaffolding.
- **`apps/lawbar-desktop/scripts/check-no-real-data.mjs`** — blocks real client names entering the repo.
- **`scripts/workflow/{check-internal-tarballs,refresh-internal-lock-integrity}.mjs`** (+ its test) —
  product build integrity, invoked by `apps/lawbar-desktop/package.json`. That directory was mixed; only the
  governance half was removed.
- **4 product CI workflows** — `services-ci`, `services-ci-ocr`, `desktop-release-gates`,
  `evidence-core-swift-smoke`.
- **The audit-chain implementation** in `services/case-box-persistence` — court-facing tamper evidence.
- **`.claude/settings.json`** `permissions.deny` (secret-file reads) and plugin enablement.

## Rescued into this archive

- `a07-marker-m1-hardening.patch` — 285 lines of uncommitted A0.7 marker hardening (re-executes the harness
  binary with pre/post digest bracketing, 120s timeout, `killpg`). Its test suite was at 95/95. It applied to
  `scripts/workflow/a07_marker.py`, which is now deleted; recover the base from the tag before applying.
- `run-log-tail.patch` — the uncommitted tail of the run log.
- `../audit-reports/` — **45 Codex audit reports that were never tracked in git.** Deleting them would have
  destroyed them permanently. The 179 `reviews/` files were tracked, so git and the tag hold those.
- `../wi-commit-log.md` — the per-work-item commit trail (223 lines).

## What a rebuild should know

1. **The enforcement layer was substantially advisory.** Hooks matched on command *strings*, which is an
   unbounded parsing problem — the last audit fixed three trust-critical holes and the guard still
   false-positived on a read-only command during this very deletion. Hooks are cooperative friction, not an
   enforcement boundary. Real enforcement has to live where the agent's uid cannot reach it: CI, or
   producer-bound attestation.
2. **Two knobs must not be equal.** `AUTO_ADVANCE_MAX == BATCH_AUDIT_EVERY` made the remediation lane
   structurally unreachable — audit-due and the breaker always tripped together, so the escape hatch could
   never fire. It needed a human override to get unstuck.
3. **Hooks and their wiring are one unit.** Six hooks ran on *every* tool call. Deleting the files while
   `settings.json` still referenced them risks breaking the session. Clear the wiring first, then the files.
4. **Never embed volatile environment state in an always-loaded doc.** Three contract docs asserted a plugin
   "is not installed"; installing it made all three false, silently.
5. **A rule file is the wrong home for a product invariant.** The 12 Evidence invariants lived in
   `.claude/rules/evidence-genie.md` and would have died with the scaffolding. Eleven were court-facing
   product invariants and now live in `docs/product/evidence-m0-prd.md` §5, which owns them. The twelfth was
   workflow-only and was retired.
6. **A0.7 is PROVISIONAL, not green.** All five oracles carry zero `samplePoints`, so the normalization
   check never actually ran. Four harness defects remain open: NaN bypass, oracle completeness, class-1
   misclassification, zero samplePoints. The existing marker is schema 1.0.0 and invalid under 2.0.0.

## Product doc consolidation (same date)

- `docs/product/`: **6 files → 2.** The four `evidence-m0-*` files merged into `evidence-m0-prd.md`
  (448 → 336 lines, plus the 11 rescued invariants); `product-target-architecture.md` was absorbed into
  `project-requirements-brief.md` as **Appendix A**.
- 8 live docs (7 ADRs + the case-box contract README) were repointed to Appendix A. Historical `dev-memo/`
  references were left as written.
