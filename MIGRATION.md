# MIGRATION — retrofit the scaffold into an existing repo (e.g. lawbar-tool)

A staged retrofit, not a greenfield replacement. The repo already has UI; the rule is:
**baseline the existing UI, do not let the new workflow treat it as invalid, and enforce the
UI Design gate only for FUTURE UI work.** Run these top to bottom.

## Phase 0 — branch
```bash
cd <your-repo> && git status --short          # start clean
git checkout -b workflow-scaffold-migration   # scaffold work is its own branch, not main
```

## Phase 1 — copy the core (this bundle)
Unpack `workflow-scaffold.tar.gz` at the repo root. It places AGENTS.md, .claude/, scripts/,
dev-memo/run/, and the docs. Then:
```bash
chmod +x .claude/hooks/*.sh scripts/workflow/*.sh
```
Note: `.claude/skills/workflow/SKILL.md` is shipped here as `workflow-skill/SKILL.md` —
move it to `.claude/skills/workflow/SKILL.md` in your repo.

## Phase 2 — merge instructions, don't overwrite
If the repo already has AGENTS.md / CLAUDE.md / GEMINI.md / .claude/settings.json:
- Project-specific product rules (legal disclaimers, data-privacy constraints, jurisdiction
  assumptions, deploy rules, test commands, package manager, framework conventions) →
  PRESERVE by folding them into AGENTS.md.
- Generic workflow/autonomy rules → import from the scaffold AGENTS.md.
- Conflicts → resolve explicitly; never stack both copies (one will go stale).
- CLAUDE.md / GEMINI.md must remain bare `@AGENTS.md` imports (cc-suite manages the bridge).

## Phase 3 — make the gates real
The shipped gate scripts are honest stubs. Before running `/workflow`:
- `check-baseline.sh` works as-is (clean-tree check). Add a branch check if you want.
- `check-staged-files.sh` works as-is (forbidden-path + non-empty staging check).
- `check-gates.sh` is a STUB that FAILS until configured — by design, so it can't fake a
  pass. Edit in your real commands (e.g. `npm test && npm run lint && npm run typecheck &&
  npm run build`), then `touch .workflow-gates-configured`.

## Phase 4 — core plugins only
```bash
claude plugin marketplace add xiaolai/claude-plugin-marketplace
claude plugin install cc-suite@xiaolai --scope project
claude plugin install echo-sleuth@xiaolai --scope project
claude plugin list
/cc-suite:init        # then /cc-suite:status until green
/hooks                # confirm the 4 hooks registered
/workflow             # confirm the skill resolves
```
Do NOT enable ui-tokenize / ui-responsive / mermaid-preview yet.

## Phase 5 — baseline the existing UI (one WI)
Create `dev-memo/ui-baseline.md` capturing: main screens/routes, UI framework, completed vs
unfinished UI areas, existing screenshots, current design tokens/theme, known responsive/a11y
gaps. This is the "design artifact" for legacy UI until you intentionally build the Design
gate. Existing UI = baselined, not gated. Future UI = needs the Design gate first.

## Phase 6 — verify governance with a throwaway queue
Copy a block from `queue.example.md` into `dev-memo/run/queue.md` (one harmless non-UI WI,
full 10-field contract). Then:
```bash
scripts/workflow/check-queue.sh                       # → queue.linted
# Codex review via cc-suite; save output to a file containing exactly:
#   QUEUE_REVIEW_VERDICT=PASS
scripts/workflow/mark-queue-reviewed.sh <artifact>    # → queue.reviewed
scripts/workflow/govern-queue.sh                      # → queue.governed
git rev-parse HEAD > dev-memo/run/batch-start
```

## Phase 7 — non-UI canary (config: AUTO_ADVANCE_MAX=3, BATCH_AUDIT_EVERY=3)
Three tiny, reversible, non-UI WIs. AVOID: UI, migrations, infra/prod, auth, payments,
security, new dependencies, large refactors. Good canary WIs: a dev-memo note, a tiny test
around existing behavior, a one-line script/help/readme clarification.
Start the run via `/workflow`. After it stops:
```bash
git log --oneline -5 ; git status --short ; cat dev-memo/run/log.md
```
Then run the batch audit + echo-sleuth study packet per BATCH-AUDIT.md.

## Phase 8 — only then decide on UI
After a clean non-UI canary, and only when your first real UI WI is ready, build the UI
Design gate (see HANDOVER.md §5): add `UI` as an allowed Type, require a `Design artifact:`
field, make check-queue.sh reject UI WIs without it, enable UI plugins locally, and wire
test:visual / test:a11y / test:lighthouse into check-gates.sh.

## Do not
- Do not raise AUTO_ADVANCE_MAX to 10 until a 3-WI canary runs clean.
- Do not enable auto-push; local commits are revertable, pushed commits are shared state.
- Do not build the UI gate or open-ended self-completion before the non-UI canary proves out.
