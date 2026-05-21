---
description: cc-suite workflow — assistant-driven automation via the cc-suite plugin's codex-runner.mjs is the default for high-risk WIs; never invoke via the Skill tool; self-review remains forbidden for high-risk WIs.
applies-to: "**"
---

# cc-suite Workflow

The cc-suite plugin (`cc-suite@xiaolai`) provides **Claude Code slash commands**, NOT Skills. Earlier autonomy text in this repo conflated the two; this rule corrects that. The rule was updated again on 2026-05-20 (after `dev-memo/cc-suite-automation-investigation.md`) to make assistant-driven automation via `codex-runner.mjs` the default for high-risk WIs, preserving cc-suite job/result memory semantics.

## Hard rule (unchanged)

**Never invoke** `Skill(cc-suite:review-plan)` / `Skill(cc-suite:audit)` / `Skill(cc-suite:verify)` (or any `Skill(cc-suite:*)`). The Skill tool returns `Unknown skill: cc-suite:review-plan` and the WI cannot rely on it.

cc-suite commands surface as user-typed slash commands AND as assistant-driven runner invocations. Both drive the same underlying Codex agent.

## Invocation paths (priority order)

The assistant uses these paths in order. Drop to the next one only when the current path is unavailable.

### Path 1 (default) — Plugin runner: `codex-runner.mjs`

```
node {runnerPath} --kind {review-plan | audit | verify | audit-fix} \
  --model {model} --effort {effort} --sandbox {sandbox} \
  [--background] [--session-id {id}] [--summary {text}] \
  -- "{prompt}"
```

- `runnerPath` is RESOLVED DYNAMICALLY at every invocation — never hardcoded. See §"Runner path resolution".
- Output: JSON envelope `{ jobId, status, rawOutput, threadId? }` on stdout.
- Side effects: registers a job in the workspace's `.cc-suite/` state dir; `/cc-suite:status` and `/cc-suite:result` can retrieve it.
- This path is **equivalent** to the user typing `/cc-suite:{kind}` and is the **default** for assistant-driven high-risk-WI reviews/audits/verifies.

### Path 2 — Direct Codex MCP (`mcp__plugin_codex-toolkit_codex__codex`)

Only when Path 1 fails (runner script missing, `node` unavailable, plugin cache corrupt, etc.). Direct MCP preserves:

- Same prompt template (read from the slash command `.md` file in the runner-resolved plugin cache).
- Same `model`, `config.model_reasoning_effort`, `sandbox`, `approval-policy`, `developer-instructions`.
- `threadId` capture.

Direct MCP does NOT register a `/cc-suite:status` job. The assistant MUST record the `threadId` explicitly in the WI's commit message or plan file so the user can later run `/cc-suite:continue {threadId}`.

### Path 3 — `codex exec` CLI

Only when Paths 1 and 2 both fail. Same prompt template; same model/effort/sandbox. No job tracking. No `threadId` capture. Use only as a last resort.

### Path 4 — Stop and ask the user

If Paths 1, 2, and 3 all fail or are unavailable in the session, **stop and ask** the user to run the slash command manually:

> Run `/cc-suite:{kind} {scope}` and paste the findings back to me. I will fix and re-stage.

Self-review remains forbidden for high-risk WIs unless the user explicitly authorizes the fallback in the same turn.

## Runner path resolution (Path 1)

The runner lives in the cc-suite plugin cache, NOT at a fixed path. Versions update. Resolve dynamically:

```bash
# Pick the lexically-greatest plugin version's runner. Sort numerically by
# splitting "X.Y.Z" so 0.2.10 sorts after 0.2.9.
ls -1 ~/.claude/plugins/cache/xiaolai/cc-suite/*/scripts/codex-runner.mjs \
  | sort -V \
  | tail -n 1
```

The assistant MUST capture the resolved path in the WI's commit message or plan file (§"Required recording").

If the glob returns nothing, Path 1 is unavailable — fall through to Path 2.

## Decision matrix (updated)

```
high-risk WI? ─→ YES ─→ Path 1 (runner) available?
                          ↓ YES ─→ run it; record per §"Required recording".
                          ↓ NO  ─→ Path 2 (direct MCP) available?
                                    ↓ YES ─→ run it; record threadId per §"Required recording".
                                    ↓ NO  ─→ Path 3 (codex exec) available?
                                              ↓ YES ─→ run it; record per §"Required recording".
                                              ↓ NO  ─→ Path 4: STOP and ASK.

              ↓ NO (low-risk WI)
            self-review fallback IS allowed; record the four fields
            listed in §"Self-review fallback recording".
```

## High-risk WIs (Path 1+ required; self-review NOT acceptable)

If the WI touches any of the following, self-review fallback is NOT acceptable. Use Paths 1 / 2 / 3 / 4 in order:

- Persistence / database (including new package introduction).
- Security / TLS / DNS / SSRF / auth / sandboxing / crypto.
- Cloud / sync / external document exposure / external account.
- Public API / wire-format / schema / CLI breaking changes.
- Framework / runtime dependency choices (Electron / Tauri / SQLite / native modules).
- Irreversible migrations or production data operations.
- LLM extractor implementation (Step 8 future-implementation gate).
- Sync bridge implementation (`docs/adr/sync-bridge-architecture.md` SYNC-01+).

The list intentionally overlaps with the [[autonomy]] hard-stop list. Even when the autonomy rule itself does NOT trigger a hard-stop (e.g. a docs-only ADR that DESCRIBES a security boundary), the cc-suite review-plan gate may still apply because the plan governs the eventual high-risk work.

## Low-risk WIs (self-review fallback IS allowed)

Unchanged from prior revision:

- Docs-only low-risk ADRs.
- Formatting / documentation cleanup.
- LOC / reporting work.
- Cases where ALL of Paths 1, 2, 3 are verifiably unavailable AND the fallback is explicitly recorded per §"Self-review fallback recording".

## Required recording (every automated cc-suite invocation)

EVERY automated cc-suite run via Path 1, 2, or 3 MUST record the following — in the WI's commit message OR in the dev-memo plan file OR in a per-WI review report file:

1. **Kind** — `review-plan` / `audit` / `audit-fix` / `verify`.
2. **Target scope** — the file path(s) or directory passed to the runner / MCP.
3. **Resolved runner path** (Path 1) — the absolute path the resolution step returned. For Path 2/3, record "MCP direct" or "codex exec direct".
4. **Model / effort / sandbox / approval-policy** — the values actually used. Defaults come from `.codex-toolkit.md` (`gpt-5.5` / `high` / per-command default).
5. **Job ID** (Path 1, if emitted) — from the runner's JSON envelope.
6. **Codex `threadId`** (Path 1 or 2, if emitted) — needed for `/cc-suite:continue`.
7. **Output / result location** — for Path 1: `.cc-suite/<jobId>/`. For Path 2/3: inline in the WI report.
8. **`/cc-suite:status` / `/cc-suite:result` retrievable?** — YES iff Path 1 was used.

Recording these eight fields is the contract for "automation that preserves cc-suite memory semantics." Without them, the run is undistinguishable from self-review.

## Verify must consume explicit audit artifacts

`/cc-suite:verify` MUST be invoked with the prior audit's report file as an explicit input (e.g. `--audit reports/audit-N.md` or the equivalent prompt-embedded path). The runner / MCP call MUST NOT rely on:

- Codex memory of the prior thread (lost on MCP restart).
- The assistant's own recall of audit findings.
- Implicit "the previous audit you just ran" semantics.

If the prior audit report is not on disk in a readable form, surface that to the user — do NOT invoke verify with a hand-reconstructed list of findings.

## Self-review fallback recording (low-risk only)

When self-review is used for a LOW-RISK WI (per §"Low-risk WIs"), record all four fields:

1. **Why cc-suite could not be invoked** — e.g. "Path 1 runner not present; Path 2 MCP tool not surfaced in this session; Path 3 codex CLI failed with X".
2. **Scope reviewed** — the doc, plan, or change set.
3. **Findings** — issues + fixes, OR a positive statement.
4. **Why the fallback is acceptable for this WI** — cite the §"Low-risk WIs" category.

For HIGH-RISK WIs, self-review is forbidden regardless of recording. Go to §"Decision matrix" Path 4 (stop and ask).

## When the assistant runs cc-suite via Path 1 — copy-paste prompt template

The slash command `.md` bodies under `~/.claude/plugins/cache/xiaolai/cc-suite/*/commands/{review-plan,audit,verify,audit-fix}.md` carry the canonical prompt template + persona + provenance disclosure. The assistant SHOULD read those .md files at invocation time rather than hand-replicating the template — this prevents drift when cc-suite ships an update.

For `/cc-suite:review-plan`, the prompt has 5 dimensions: (1) internal consistency, (2) completeness, (3) feasibility, (4) ambiguity, (5) risk & sequencing. The persona is "You are an architecture reviewer evaluating plan feasibility." The provenance disclosure ("The code, artifacts, and plans you are reviewing were produced by Anthropic's Claude…") is ALWAYS included in `developer-instructions`.

For `/cc-suite:audit` the persona is "You are a thorough security and code quality auditor." (full) or "You are a fast code quality reviewer focused on logic, duplication, and dead code." (mini). Project default per `.codex-toolkit.md` is `mini`.

For `/cc-suite:verify` the persona is "You are a verification auditor. Only check issues from a previous audit report."

## When the user runs cc-suite manually (Path 4)

Phrase the request precisely so the user can copy-paste:

> Run `/cc-suite:review-plan <path-to-plan>` (or the appropriate command) and paste the findings back to me. I will fix and re-stage.

After the user provides the findings, treat them as a normal review-output pass: apply fixes, optionally re-request review, then commit.

## Failure handling

- Path 1 emits `{ status: "failed", error: <msg> }` — surface the error to the user, then attempt Path 2.
- Path 2 returns `[Tool result missing due to internal error]` or empty — do NOT retry; attempt Path 3.
- Path 3 nonzero exit — stop and ask the user (Path 4).
- `/cc-suite:status` returning an unhealthy / un-authenticated bridge state — surface to user; do NOT proceed.

## Cross-references

- [[autonomy]] — hard-stop list; cc-suite-required categories often overlap with autonomy hard-stops.
- [[security-boundary]] — security-sensitive scope; cc-suite review-plan is required before implementation.
- [[loc-guardian]] — orthogonal gate; LOC + cc-suite both apply.
- [[../skills/security-wi-loop/SKILL]] — security WI loop; review-plan step now uses Path 1 by default.
- [[../skills/project-autopilot/SKILL]] — autopilot loop; same.
- [[../skills/client-architecture-reconcile/SKILL]] — reconciliation skill; low-risk by default, self-review fallback allowed with recording.
- `dev-memo/cc-suite-automation-investigation.md` — the investigation that produced this revision; documents the three invocation paths and the underlying Codex MCP tool name.
