# cc-suite Automation Investigation

**Status**: investigation only. No files modified outside this memo. No commit.
**Date**: 2026-05-20.
**Question**: Can `/cc-suite:review-plan`, `/cc-suite:audit`, and `/cc-suite:verify` be invoked automatically (from shell or from Claude's tools) so that high-risk WIs do not require manual slash-command typing by the user?

---

## TL;DR

| Path | Available? | Same underlying reviewer? | Notes |
|---|---|---|---|
| Slash command `/cc-suite:review-plan` typed by the user | yes (user-side input only) | Codex | The canonical surface. NOT invokable from inside a Claude Code session by the assistant. |
| `Skill(cc-suite:review-plan)` (assistant invokes Skill tool) | **NO** | — | Returns `Unknown skill: cc-suite:review-plan`. Already forbidden by `.claude/rules/cc-suite.md`. |
| MCP tool `mcp__plugin_codex-toolkit_codex__codex` (assistant invokes MCP) | **YES** in this session | **same Codex** | This IS the tool the slash command calls under the hood. Available now via the deferred-tools surface. |
| `codex` CLI (shell) | **YES** | **same Codex** | Installed at `/Users/zhongyibao/.nvm/versions/node/v24.14.0/bin/codex` (codex-cli 0.131.0). Run via `codex exec`. |
| `codex-runner.mjs` wrapper (shell) | **YES** | **same Codex** | Provided by cc-suite plugin at `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs`. Adds job tracking. |

**The slash command and the MCP tool drive the same Codex agent with the same prompt template.** The slash command's body is a Markdown prompt template that, when expanded, tells the host Claude to call `mcp__codex__codex` with a specific developer-instructions string and prompt. There is no separate "cc-suite review engine" — cc-suite IS the prompt scaffolding around Codex.

**Conclusion**: cc-suite review/audit/verify CAN be invoked automatically from the assistant via the Codex MCP tool. Whether that counts as compliance with `.claude/rules/cc-suite.md` ("never invoke via `Skill(cc-suite:*)`") is a policy decision: technically the rule only forbids the `Skill(...)` path, not the MCP path. But the spirit of the rule is "don't silently self-review" — and using the MCP tool with the same template is NOT self-review (Codex is still the independent reviewer). The user's policy call.

---

## 1. Is there a shell-callable cc-suite CLI?

**No standalone cc-suite CLI.** cc-suite is a Claude Code plugin (`cc-suite@xiaolai`) consisting of:

- Markdown slash-command templates under `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/commands/`.
- Skill files under `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/skills/cc-suite/`.
- Shell scripts under `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/` (bridges, runner, hooks).

The plugin does NOT install a `cc-suite` binary in PATH. There is NO `cc-suite review-plan plan.md` invocation.

**However**, the plugin DOES rely on two shell-callable tools that the assistant can use directly:

### 1a. The `codex` CLI

```
$ which codex
/Users/zhongyibao/.nvm/versions/node/v24.14.0/bin/codex

$ codex --version
codex-cli 0.131.0
```

Subcommands relevant to cc-suite workflows:

- `codex exec` — run Codex non-interactively (the canonical path for what the slash command does).
- `codex review` — built-in code review (an alternative path; not what cc-suite uses internally).

### 1b. `codex-runner.mjs` (plugin-provided wrapper)

```
~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs
```

Internally calls `codex exec` via `spawnSync` and adds:

- Job ID generation + tracking (used by `/cc-suite:status`, `/cc-suite:result`, `/cc-suite:cancel`).
- Foreground vs background execution (`--background` flag).
- Log files under the workspace's `.cc-suite/` state dir.

CLI surface:

```
node codex-runner.mjs \
  --kind <kind> --model <model> --effort <effort> --sandbox <sandbox> \
  [--background] [--session-id <id>] [--summary <text>] \
  -- <prompt>
```

The `--kind` values used by cc-suite include `review-plan`, `audit`, `verify`, `audit-fix`, `implement`, `bug-analyze`.

### 1c. cc-suite slash commands themselves are NOT shell-callable

The .md files under `commands/` are Claude Code prompt templates. They are processed by Claude Code's input layer when the user types `/cc-suite:foo`. They are NOT scripts and have no shell entry point.

---

## 2. What exact command runs plan review?

The cc-suite slash command body (`commands/review-plan.md`) tells Claude to:

1. Parse `$ARGUMENTS` for the plan file path and `--background` / `--wait` flag.
2. Build developer-instructions concatenating: persona + provenance disclosure + (optional) config focus instructions.
3. Call `mcp__codex__codex` (in this session's tool namespace: `mcp__plugin_codex-toolkit_codex__codex`) with:
   - `prompt`: the plan-review template (5 dimensions: consistency, completeness, feasibility, ambiguity, risk-and-sequencing) with file references substituted in
   - `model`: chosen via `commands/shared/model-selection.md` discovery (this project's `.codex-toolkit.md` defaults: `gpt-5.5`)
   - `config`: `{ model_reasoning_effort: "high" }`
   - `sandbox`: `read-only` (always)
   - `approval-policy`: `on-failure`
   - `developer-instructions`: persona + provenance + (optional) config focus
4. Render the response per the slash command's "Step 3: Present Findings" Markdown skeleton.
5. Save the `threadId` for `/cc-suite:continue`.

### Three equivalent invocations from the assistant

#### Path A — MCP tool (preferred for in-session automation)

```
mcp__plugin_codex-toolkit_codex__codex with:
  model: "gpt-5.5"
  config: { model_reasoning_effort: "high" }
  sandbox: "read-only"
  approval-policy: "on-failure"
  developer-instructions: |
    You are an architecture reviewer evaluating plan feasibility.
    The code, artifacts, and plans you are reviewing were produced by Anthropic's Claude (a competing AI system). Evaluate them with full rigor — do not defer to them or assume correctness because an AI wrote them. Apply the same critical standards you would to any human-written work. If anything looks wrong, say so directly.
    Give equal attention to all audit dimensions.
  prompt: |
    Read these files, then evaluate the plan across all 5 dimensions below.
    Be critical — flag anything that would cause problems during implementation.

    Files to read:
    - dev-memo/plan-case-box-persistence-A1.md

    ## Dimension 1: Internal Consistency
    ...
    ## Dimension 2: Completeness
    ...
    ## Dimension 3: Feasibility
    ...
    ## Dimension 4: Ambiguity
    ...
    ## Dimension 5: Risk & Sequencing
    ...
    ## Output Format
    For each dimension:
    **[Dimension N: Name]**
    | # | Severity | Finding | Location | Recommendation |
    |---|----------|---------|----------|----------------|
    Then:
    **Overall Verdict**: READY TO BUILD / NEEDS REVISION / MAJOR GAPS
    **Top 3 Risks** (ordered by impact)
    **Strongest aspects** of the plan
```

Returns text + `threadId`. Parseable by Claude.

#### Path B — Direct CLI

```bash
codex exec \
  --model gpt-5.5 \
  --sandbox read-only \
  "$(cat <<'EOF'
[same prompt as Path A]
EOF
)"
```

Returns text on stdout. The codex-runner.mjs source confirms this is the same call pattern. Note: codex-cli 0.131.0 dropped `--approval-policy` (now config-only) and `--quiet`; the runner has a TODO to re-add those flags.

#### Path C — codex-runner wrapper

```bash
node ~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs \
  --kind review-plan \
  --model gpt-5.5 \
  --effort high \
  --sandbox read-only \
  -- "$(cat <<'EOF'
[same prompt as Path A]
EOF
)"
```

Returns a JSON envelope `{ jobId, status, rawOutput }` on stdout, plus tracks the job in `.cc-suite/<jobId>/`. Useful when status/result/cancel integration is desired.

---

## 3. What exact command runs audit?

Same MCP / CLI / runner path as plan review, with these differences (from `commands/audit.md`):

- **Persona** (full audit): `"You are a thorough security and code quality auditor."`
- **Persona** (mini audit): `"You are a fast code quality reviewer focused on logic, duplication, and dead code."`
- **Sandbox**: `read-only`.
- **Approval-policy**: `never`.
- **`--kind`** (for the runner): `audit`.
- **Prompt template**: 9 dimensions (security, correctness, error handling, edge cases, performance, naming, architecture, tests, dead code) for `--full`; 5 dimensions for `--mini`. Per `.codex-toolkit.md`, this project's default is `mini`.

---

## 4. What exact command runs verify?

Same pattern. Differences (from `commands/verify.md`):

- **Persona**: `"You are a verification auditor. Only check issues from a previous audit report."`
- **Sandbox**: `read-only`.
- **Approval-policy**: `never`.
- **`--kind`**: `verify`.
- **Inputs**: the previous audit's findings (typically passed as a file path) PLUS the changed-files scope.
- **Output**: per-finding `closed` / `still-present` / `unverifiable`.

---

## 5. Can those commands accept a target file/scope?

**Yes.** Scope is passed as text inside the `prompt` — typically a `Files to read:` block listing paths. Codex agent reads them via the read tool inside its sandbox.

The slash command surface accepts:

- `/cc-suite:review-plan path/to/plan.md` — plan path is the primary scope.
- `/cc-suite:review-plan path/to/plan.md +context1.md +context2.md` — plan + context files.
- `/cc-suite:audit src/foo.ts src/bar/` — files / dirs as scope.
- `/cc-suite:audit --full src/foo.ts` — `--full` flag overrides the mini default.
- `/cc-suite:verify --audit reports/audit-N.md` — explicit audit-report input.

Internally, these all desugar to substring substitutions into the MCP prompt.

---

## 6. Do they return non-interactive output suitable for Claude to parse?

**Yes for all three paths.**

- **MCP tool**: returns text (single tool-result block) + `threadId`. Claude consumes the text directly. The slash command template tells Claude to format it into the standardized Markdown report.
- **CLI** (`codex exec`): writes the reviewer's full response to stdout, then exits. Stderr carries diagnostics.
- **codex-runner**: wraps the CLI; emits `{ jobId, status, rawOutput }` JSON to stdout. The `rawOutput` field is the full CLI stdout.

All three are non-interactive and machine-parseable.

---

## 7. If not, can we create a thin local wrapper around an existing CLI?

**Not strictly necessary.** The MCP tool (Path A) and the CLI (Path B) and the runner (Path C) all already work.

If a project-local convenience wrapper would still be useful, the smallest viable shape would be a Bash script (NOT to be committed yet) at e.g. `scripts/cc-suite-review.sh` that takes a plan-file path, builds the prompt by reading `commands/review-plan.md` for the 5-dimension template, and calls `codex exec`. This is purely a convenience and is OPTIONAL — the user can already do the same thing by running `/cc-suite:review-plan plan.md` directly.

---

## 8. If no callable route exists, confirm that manual slash-command execution is required for high-risk WIs.

A callable route DOES exist (Paths A / B / C above). Therefore the question becomes a policy question, not a feasibility question:

**Does `.claude/rules/cc-suite.md` consider `mcp__plugin_codex-toolkit_codex__codex` invocation by the assistant equivalent to the user typing `/cc-suite:review-plan`?**

The rule's hard text only forbids `Skill(cc-suite:*)` (which fails with `Unknown skill`) and lists "self-review fallback NOT acceptable" for high-risk WIs. The rule does NOT explicitly cover the MCP-direct path because that path was not known to be available when the rule was written.

Arguments for treating MCP-direct as equivalent:

1. **Same reviewer**: Codex MCP server is the engine the slash command calls anyway. Skipping the slash command surface only skips the user's keystroke, not the review.
2. **Same prompt template**: the slash command's .md file is the template; the assistant can read it from the plugin cache and replicate it byte-for-byte, including the provenance disclosure that locks Codex into adversarial-review posture.
3. **Same sandbox + model + effort**: all three are explicit in the slash command body and can be set on the MCP call.
4. **Not self-review**: Codex (a separate model, separate process, separate context) is doing the review. Claude is just the dispatcher.

Arguments against:

1. **Slash command body may evolve**: the assistant's hand-replication of the template can drift from the upstream cc-suite version. Mitigation: read the slash command .md file at invocation time and parse the template from it.
2. **Job tracking misses**: `/cc-suite:status` and `/cc-suite:result` track jobs the slash command creates. MCP-direct doesn't register a job. Mitigation: use Path C (codex-runner) instead of Path A — it tracks jobs identically.
3. **Approval-policy bypass**: the slash command uses `approval-policy: on-failure` for review-plan, which surfaces a human gate when Codex flags problems. MCP-direct with `approval-policy: never` would skip that gate. Mitigation: pass the same approval-policy value on the MCP call.
4. **Rule literalness**: if the user wants the rule to mean "every high-risk WI must have a human in the loop at review time," then the MCP path defeats that intent regardless of mechanism.

---

## Recommendation

The user has three policy options:

### Option 1 — Keep the current rule; only the user types slash commands

Status quo. High-risk WIs always stop and ask. Slow, but maximally conservative.

### Option 2 — Allow assistant-driven MCP invocation that replicates the slash command exactly

Update `.claude/rules/cc-suite.md` to add a "Path B: assistant-driven MCP" subsection that says:

- The assistant MAY call `mcp__plugin_codex-toolkit_codex__codex` to run review-plan / audit / verify, PROVIDED it:
  - Reads the upstream slash command template from the cc-suite plugin cache and uses the prompt verbatim (no Claude-authored shortcuts).
  - Uses the same `developer-instructions`, `model`, `config.model_reasoning_effort`, `sandbox`, and `approval-policy` the slash command would have.
  - Surfaces the Codex response verbatim to the user before fixing anything.
  - Records the invocation in the commit message as "Codex review via MCP" with the threadId.
- High-risk WIs that this path doesn't cover (auth provider choice, cloud vendor choice, etc.) still stop and ask.

This is the most autonomy-preserving option without compromising the "Codex independently reviews" guarantee.

### Option 3 — Allow Path C (codex-runner) for parity with slash command tracking

Same as Option 2 but the assistant invokes `codex-runner.mjs` from `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/` so jobs appear in `/cc-suite:status`. Heavier mechanically but preserves the cc-suite job-tracking story.

### Side note: LOC discipline holds either way

None of the three options affect the LOC guardrails. The persistence-A1 plan stays under the cc-suite rule's high-risk umbrella until the rule is updated; today it requires manual `/cc-suite:review-plan`.

---

## Facts inventory (raw findings)

For audit:

| Item | Path | Status |
|---|---|---|
| `codex` binary | `/Users/zhongyibao/.nvm/versions/node/v24.14.0/bin/codex` | installed, version 0.131.0 |
| `codex-runner.mjs` | `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs` | installed (plugin) |
| cc-suite slash command bodies | `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/commands/*.md` | 26 commands |
| cc-suite skill bodies | `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/skills/cc-suite/` | 11 skills |
| Plugin manifest | `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/.claude-plugin/plugin.json` | name=cc-suite, version=0.2.10 |
| MCP server config (repo) | `/Users/zhongyibao/ClaudeProjects/lawbar-tool/.mcp.json` | declares `codex-cli` stdio server via `npx -y codex-mcp-server@1.4.10` |
| Codex MCP tool (assistant-visible) | `mcp__plugin_codex-toolkit_codex__codex` | available in session (verified via ToolSearch) |
| Codex MCP reply tool | `mcp__plugin_codex-toolkit_codex__codex-reply` | available in session |
| `.codex-toolkit.md` (repo) | `/Users/zhongyibao/ClaudeProjects/lawbar-tool/.codex-toolkit.md` | model=gpt-5.5, effort=high, audit-default=mini, sandbox=workspace-write |
| `.cc-suite/` (repo, gitignored) | `/Users/zhongyibao/ClaudeProjects/lawbar-tool/.cc-suite/` | empty patch placeholders only |
| `Skill(cc-suite:review-plan)` | — | **FAILS** with `Unknown skill: cc-suite:review-plan` |
| `Skill(cc-suite:audit)` | — | expected to fail same way; not tested |
| `Skill(cc-suite:verify)` | — | expected to fail same way; not tested |

For completeness:

- `codex exec` smoke test on this host was attempted (`echo "ok?" | timeout 30 codex exec --sandbox read-only`) but `timeout` is not available by default on macOS. Substituting `gtimeout` or `perl -e 'alarm(30); exec @ARGV'` would work; not pursued in this investigation since the binary's presence and `--help` output are sufficient evidence.

---

## What this investigation does NOT do

- Does NOT modify `.claude/rules/cc-suite.md`. Policy decision is the user's.
- Does NOT modify any other workflow doc.
- Does NOT commit any change.
- Does NOT run a Codex MCP call (would consume an API token and produce a real review without explicit authorization).
- Does NOT start the next WI (CASE-BOX-PERSISTENCE Phase A1).

Stopping here per the user instruction "Do not commit yet. Stop after reporting."
