QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-WORKFLOW-CONTRACT-INTEGRITY-GUARD-00 (WI-CI1 SCAFFOLD, WI-CI2 WORKFLOW)

Security-sensitive scaffold: a new PreToolUse Bash guard `.claude/hooks/block-contract-corruption.sh`
+ standalone `scripts/workflow/check-contract-integrity.sh` defending the commit boundary against
silent corruption of always-loaded contract docs (AGENTS.md, CLAUDE.md, GEMINI.md, .claude/rules/*.md),
wired into `.claude/settings.json` (hooks key only). WI-CI2 adds an AGENTS.md no-autofix note. Broker
review required (touches hooks + settings).

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
Seven completed rounds drove the guard spec to a coherent, honestly-scoped design:
- `review-plan-mq4wrzzj-xi4h6u`: FAIL — H (git add pathspec coverage), H (commit -a). Fixed.
- `review-plan-mq4wvzp0-fdd7ak`: FAIL — H (commit <pathspec>), M (git add -u). Fixed.
- `review-plan-mq4wybwd-kohxge`: FAIL — H (--pathspec-from-file), H (commit -p/--interactive). Fixed
  via enumeration-free invariant + fail-closed catch-all.
- `review-plan-mq4x2xih-yj9jcq`: FAIL — H (over-claimed comprehensiveness; plumbing/aliases). Fixed by
  honestly narrowing scope to the porcelain surface + defense-in-depth framing (complementary standalone
  checker + cc-suite/human review for residual surfaces).
- `review-plan-mq4x74ay-cc0sml`: FAIL — H (--include vs --only semantics). Fixed (--include = staged-index
  PLUS included-pathspec).
- `review-plan-mq4x9wof-hcb0do`: FAIL — M (git add -i missing from catch-all). Fixed (added -i).
- TIMEOUTs `mq4xc3up` / `mq4yfgk5` / `mq4zl1bl` (transient broker overload); Path 2 direct MCP
  unavailable (ChatGPT-account rejects the offered *-codex models — known cc-suite↔codex-cli mismatch);
  escalated to user → user authorized bounded Path-1 retry.
- `review-plan-mq51266b-d6pbo9` (compact, bounded retry): **GOVERNABLE — no Critical/High/Medium/Low.**
  "Coherent invariant, precise per-mode resolution for the important git add/git commit paths,
  fail-closed handling for interactive/stdin pathspec modes incl. git add -i, honest residual-risk
  boundaries, over-deny constraints, and the .claude/settings.json hooks-key carve-out."

## Confirmations
- Queue-lint PASSED (2 WIs; WI-CI2 depends on WI-CI1; no later-dep).
- WI-CI1 allowed = block-contract-corruption.sh (new) + check-contract-integrity.sh (new) +
  .claude/settings.json (hooks key only) + deferred-audit-findings.md. Forbidden = the existing five
  guards, settings.local.json, all contract docs, apps/services/docs/package.json, dev-memo/run/**.
- No forbidden-path intersection with `dev-memo/run/forbidden-paths.txt`.
- Guard scope is honest defense-in-depth (porcelain git only; plumbing/aliases out-of-scope, covered by
  the standalone checker + review); strictly additive; fail-closed; settings carve-out per
  staging-hygiene.
- Governance follows the documented rule: mark-reviewed + govern STANDALONE, content-bind verified,
  THEN commit separately. WI-CI1 (high-risk) requires cc-suite audit/verify at impl; WI-CI2 low-risk.
