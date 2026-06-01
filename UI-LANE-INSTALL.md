# UI lane — install notes

All-xiaolai now: no third-party plugins, no unreviewed external scripts.

## Verified (xiaolai marketplace — same trust as your other plugins)

```bash
claude plugin marketplace update xiaolai
claude plugin install ui-tokenize@xiaolai     --scope project   # token enforcement (PreToolUse hook)
claude plugin install ui-responsive@xiaolai   --scope project   # responsive coach (PostToolUse advisory)
claude plugin install mermaid-preview@xiaolai --scope project   # diagram auto-preview
```
> Confirm exact slugs with `claude plugin list` after install — the marketplace's
> `.claude-plugin/marketplace.json` is authoritative.

- **ui-tokenize**: rewrite-first PreToolUse hook; corrects hardcoded UI literals to
  design-token references on the way to disk; `strict` or `advisory` mode; `/tokenize:review`
  dispatches a semantic mis-pick review. Enforcement, not advice.
- **ui-responsive**: advisory PostToolUse coach; flags off-catalog breakpoints, bare
  `100vh`, and fixed widths without `max-width`. Adds context, does not block.
- **mermaid-preview**: auto-previews Mermaid on Write/Edit; offline-safe, dark-mode aware.

## Built-in (ships with Claude Code — no install)

- **frontend-design** skill: Claude auto-uses it for frontend work; produces production-ready
  UI code. The implementation step after design.

## Anthropic Labs (separate product, not a plugin)

- **Claude Design** (claude.ai/design): text-to-prototype design tool. Produce the visual
  direction, then hand the result to `frontend-design` in Claude Code. The handoff is a
  manual export/paste boundary — no verified automatic integration.

## Coverage gap to be aware of

`ui-responsive` covers responsive layout only. It does NOT check accessibility, color
contrast, focus states, touch targets, or palettes — coverage that the removed third-party
`ui-ux-pro-max` provided. If you need a11y/contrast auditing, add a dedicated tool for it
(none currently in the xiaolai set); otherwise that dimension is unguarded.

## Lane order

Queue-entry gate (enforced now): a `Type: UI` WI needs a concrete `Design artifact:` field
before it can enter a governed queue (`check-queue.sh`; see `UI-GATES.md`). Then:

Claude Design (direction) → frontend-design (implement) → ui-responsive (responsive advice)
+ ui-tokenize (token enforcement) → delegation chain (Codex review/audit) → commit.
