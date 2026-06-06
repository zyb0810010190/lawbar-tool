QUEUE_REVIEW_VERDICT=PASS

# Queue review — WI-806 (Type UI, comment/header-only: fix the stale "NO review" comment in viewMatterFacts.ts; closes CBW-UI-804-HEADER)

- Fresh governed queue (the closed WI-805 queue replaced). WI-806 is a bounded Type:UI maintenance WI to close the CBW-UI-804-HEADER deferred Low: the file-top doc comment in `apps/lawbar-desktop/renderer/screens/viewMatterFacts.ts` still reads "NO edit / delete / review / evidence linking", which became stale when WI-804 (`fef623a`) added per-fact Review/Accept/Reject controls (consuming `casebox:fact:transition`) in the same file.
- COMMENT/HEADER-ONLY: only `//`-prefixed doc-comment lines change; NO executable code, import, selector, data-attribute, user-visible text, styling, test, or package-script change. Allowed files limited to the one renderer file + the deferred-findings ledger.
- Type UI **only because the touched path lives under `renderer/**`** — the PR-time design-artifact gate (`check-ui-design-artifact.sh`) keys on file PATH, not diff content, so even a comment-only renderer change trips it. Satisfied by the EXISTING WI-803 artifact `dev-memo/design/2026-06-05-casebox-fact-review.md` (committed `b105863`), which governs the very WI-804 review controls this comment documents. **No new design artifact is created and the design gate itself is NOT modified** (user-authorized Option A).
- cc-suite review-plan job: review-plan-mq1xycju-xvzos1 (Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only).
- Codex verdict: READY TO GOVERN — **no Critical / High / Medium**. All 5 dimensions PASS:
  - Internal consistency: comment-only is consistent across Scope/Allowed/Acceptance.
  - Completeness: existing concrete design artifact declared; CBW-UI-804-HEADER not yet a formal ledger row, so "recorded+closed" is valid acceptance work.
  - Feasibility: `viewMatterFacts.ts` really has per-fact Review/Accept/Reject calling `api.transitionFact`; `casebox:fact:transition` + `transitionFactHandler` (server-injected reviewer/timestamp) exist; the WI-803 artifact legitimately governs WI-804's controls.
  - Ambiguity: tightly scoped to `//` lines only. (Reviewer's lone preference — that the new wording explicitly mention "server-injected reviewer/timestamps" — is non-blocking and already within scope/acceptance.)
  - Risk & sequencing: governance → commits-since-marker 2; implementation → branch count 3 (canary breaker limit, no headroom afterward). No secrets/migrations/deps/contracts/behavior change.

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (1 WI: WI-806), including the Type-UI `Design artifact:` requirement.
- Allowed files do not intersect `dev-memo/run/forbidden-paths.txt` (secrets/infra/migrations only).
- No migrations / infra-prod / secrets / new runtime dependency / contract-schema / persistence / behavior change.
