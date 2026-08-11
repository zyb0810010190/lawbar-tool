VERDICT: FAIL

**High**

- [block-contract-corruption.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/.claude/hooks/block-contract-corruption.sh:220): `git -C` is parsed and discarded, but pathspec resolution still runs from the hook’s original cwd via plain `git ls-files` and `open()` at [line 114](/Users/zhongyibao/ClaudeProjects/lawbar-tool/.claude/hooks/block-contract-corruption.sh:114). This creates a real porcelain bypass for `.claude/rules/*.md`.

  Example: from repo root, `git -C .claude commit --only rules/security-boundary.md -m x` would commit `.claude/rules/security-boundary.md`, but the guard resolves `rules/security-boundary.md` from repo root, finds no contract doc, and allows. Same issue applies to `git -C .claude add rules/foo.md && git commit -m x` in a single Bash call, because the later commit check observes the pre-add index.

  Fix direction: preserve effective cwd from `-C` options and run `git -C <effective>` for pathspec resolution, then normalize returned paths back to repo-root-relative names before `is_contract` and worktree reads. Alternatively fail closed on any `git -C` add/commit until cwd-aware resolution exists.

**Medium**

- [block-contract-corruption.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/.claude/hooks/block-contract-corruption.sh:196): Bash control structures are tokenized successfully but skipped because the first token is not `git`. A command like `if git commit -m x; then :; fi` with an already staged corrupted contract doc is allowed by this guard. This is not the same as the documented tokenize-failure escape hatch; it is parse-success but detection-failure. If control structures are out of scope, document that explicitly. If not, deny git-shaped tokens inside unsupported shell grammar or fail closed when a statement contains `git add` / `git commit` but the command position is ambiguous.

**Low**

- [block-contract-corruption.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/.claude/hooks/block-contract-corruption.sh:18): header says unparseable git add/commit fails closed, but the implemented Python tokenizer path exits allow on `ValueError` at [line 162](/Users/zhongyibao/ClaudeProjects/lawbar-tool/.claude/hooks/block-contract-corruption.sh:162). The user-stated design says allow is intentional, so this is a documentation mismatch, not a standalone blocker.

- [check-contract-integrity.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-contract-integrity.sh:69): mixed marker + IO cases exit `1`, not `2`, because IO is only returned when no marker was found. If callers rely on `2` for infrastructure/read failures, this loses signal. It remains fail-closed as nonzero.

**Validated**

- `git diff -- .claude/settings.json` is confined to appending the new PreToolUse Bash hook after `batch-commit-guard.sh`.
- `emit_deny` JSON escaping mirrors the existing guard pattern and looks valid.
- Inspection errors on checked docs fail closed.
- Standalone checker is read-only in structure and returned `PASS` on the current 13 contract docs.
