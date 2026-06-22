# Queue review 039 — WI-EVW2 (BATCH-CASEBOX-EVIDENCE-WORKFLOW-PORT-00)

**Date**: 2026-06-22.
**WI**: WI-EVW2 — record the Evidence-Genie M0 × xiaolai workflow composition (three-layer model) in a new
AGENTS.md section, citing ADR EVW-00. Documentation-only; authorizes no Evidence behavior. NOT high-risk.
**Queue**: `dev-memo/run/queue.md` (now a single WI; merged WI-PKG1 removed as completed —
`5f1a36f` / merge `2c57f7f`).
**Reviewed queue.md sha256**: `beae36d93297717c68de44a170009d149f6b81b672a858a953e63ba8b4faeb75`
(govern at this sha).

## cc-suite invocation (required recording)

- **Kind**: review-plan.
- **Target scope**: `dev-memo/run/queue.md` WI-EVW2 block + EVW-00 ADR + port plan + AGENTS.md (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (foreground).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Retry attempts**: 2.
  - **Attempt 1** — Path 1, full prompt, job `review-plan-mqouazbm-dpz8s9`: **NEEDS-FIX**, but the sole
    High was procedural/circular — "queue.md is not currently governed (live hash `beae36d…` vs recorded
    `0b1b901…`)". That is the expected precondition AT the review-plan step (lint/mark-reviewed/govern run
    immediately after), not a WI-EVW2 content defect. Content review was clean (no Critical, no content
    High/Medium; all confirmations positive). The prompt wrongly invited governance-marker evaluation.
  - **Attempt 2** — Path 1, content-scoped prompt (explicitly excluding governance-marker state, which the
    very next govern steps refresh), job `review-plan-mqoudwqn-js6voy`: **READY, Findings: None.**
- **Job ID (authoritative)**: `review-plan-mqoudwqn-js6voy`.
- **threadId**: none emitted.
- **Result location**: `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/review-plan-mqoudwqn-js6voy.json`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, completed with rawOutput).
- **Failure classification**: none (both attempts completed; attempt-1 verdict was a scoping false-positive, not a TIMEOUT/MODEL_API/RUNNER/PROMPT_CONTEXT error).

## Verdict

**REVIEW VERDICT: READY.** Critical: none. High: none. Medium: none. No content findings.

Codex confirmed:
- WI-EVW2 is internally coherent and bounded; allowed files limited to `AGENTS.md`; forbidden files
  explicitly include `CLAUDE.md` / `GEMINI.md` (both currently equal `@AGENTS.md`); gates/acceptance observable.
- Source-of-truth chain real: EVW-00 exists at `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md`;
  the port plan names the same AGENTS.md-section strategy; dependency commit `c8dc19d` exists.
- Removing merged WI-PKG1 is correct; the live queue now contains only WI-EVW2.
- The WI is genuinely doc-only: authorizes no Evidence UI/anchors/export/snapshot/compression/OCR/AI/
  cloud/auth/network behavior, no product/native code, no hooks/rules/agents/commands.
- `AGENTS.md` is 15184 bytes — ample room under the 32768-byte ceiling for one concise section.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`beae36d93297717c68de44a170009d149f6b81b672a858a953e63ba8b4faeb75`). This review authorizes neither
implementation nor any Evidence behavior; EVW2 execution begins only on explicit user instruction
(already given for this lane) and remains AGENTS.md-only.

QUEUE_REVIEW_VERDICT=PASS
