---
description: cc-suite is the workflow broker between Claude and Codex. Use it (slash command or codex-runner.mjs), not raw Codex calls. Path 1 default for high-risk WIs; never invoke via the Skill tool; self-review remains forbidden for high-risk WIs.
applies-to: "**"
---

# cc-suite Workflow

## Framing — cc-suite is the workflow broker, not merely Codex as a raw tool

**Use cc-suite as the workflow broker, not merely Codex as a raw tool.**

cc-suite is the orchestration layer between Claude (writer / executor) and Codex (independent reviewer / auditor / verifier). The plugin owns:

- **Delegation discipline** — `/cc-suite:review-plan`, `/cc-suite:audit`, `/cc-suite:verify`, `/cc-suite:audit-fix` encode the persona, the provenance disclosure ("the artifacts you are reviewing were produced by Anthropic's Claude — apply full rigor"), the prompt template, the sandbox, and the approval policy for each kind of cross-model review.
- **Job tracking + memory** — every cc-suite run registers a job in the shared codex-toolkit state directory at `${CLAUDE_PLUGIN_DATA}/state/<workspace-slug>-<hash>/jobs/<jobId>.{json,log}`; `/cc-suite:status` lists in-flight jobs; `/cc-suite:result` retrieves stored output by job id; `/cc-suite:continue <threadId>` resumes a prior Codex thread with cumulative context. (NOTE: this is NOT the workspace's `.cc-suite/` directory — see §"State-store path".)
- **Shared review artifacts** — all reviews land in a consistent location, with a consistent format, retrievable across sessions and across human + agent participants.

Bypassing cc-suite — calling `mcp__plugin_codex-toolkit_codex__codex` directly or shelling out to `codex exec` — loses ALL of the above. The Codex review still happens, but the workspace can no longer:

- list which reviews ran when;
- replay a prior review's findings;
- continue a thread with cumulative context;
- correlate review artifacts to commits.

This rule therefore treats direct Codex calls as **fallback only**, not as a preference for speed or token cost. The broker is the point.

### Role separation (locked)

| Component | Role | Notes |
|---|---|---|
| cc-suite | **Workflow broker** | Owns delegation pattern, job tracking, prompt templates, sandbox policy, status/result retrieval. NEVER bypassed for high-risk WIs. |
| Claude Code | **Writer / executor** | Authors plans, code, tests, docs. Invokes cc-suite to obtain independent Codex review. Applies fixes from review findings. |
| Codex (via MCP) | **Independent reviewer / auditor / verifier** | Reviews Claude's output adversarially per cc-suite's persona + provenance disclosure. NEVER writes code unless the WI explicitly authorizes Codex-writes per `AGENTS.md`. |
| Skill tool | **NOT a cc-suite invocation surface** | `Skill(cc-suite:*)` fails with `Unknown skill`. Hard prohibition. |

## Hard rule

**Never invoke** `Skill(cc-suite:review-plan)` / `Skill(cc-suite:audit)` / `Skill(cc-suite:verify)` (or any `Skill(cc-suite:*)`). The Skill tool returns `Unknown skill: cc-suite:review-plan` and the WI cannot rely on it.

cc-suite commands surface as user-typed slash commands AND as assistant-driven runner invocations. Both drive the same underlying Codex agent **through the broker** — that is what makes them cc-suite invocations rather than raw Codex calls.

## Invocation paths (priority order)

The assistant uses these paths in order. Drop to the next one **only when the current path is unavailable**, not for convenience, latency, or token-cost reasons. Each downgrade loses broker discipline; the lower paths are listed for resilience, not preference.

### Path 0 — User-typed slash command in the Claude Code session

When the user types `/cc-suite:review-plan <scope>` (or any other cc-suite command) directly into the session, that IS the canonical cc-suite invocation. The assistant does NOT replicate it. Paths 1-3 below are for **assistant-driven autonomous execution**, not for user-driven turns.

### Path 1 (default for assistant-driven) — Plugin runner: `codex-runner.mjs`

```
node {runnerPath} --kind {review-plan | audit | verify | audit-fix} \
  --model {model} --effort {effort} --sandbox {sandbox} \
  [--background] [--session-id {id}] [--summary {text}] \
  -- "{prompt}"
```

- `runnerPath` is RESOLVED DYNAMICALLY at every invocation — never hardcoded. See §"Runner path resolution".
- Output: JSON envelope `{ jobId, status, rawOutput, threadId? }` on stdout.
- Side effects: registers a job in the **codex-toolkit shared state directory** at `${CLAUDE_PLUGIN_DATA}/state/<workspace-slug>-<hash>/`. The runner does NOT write to `.cc-suite/` at the workspace root (that subdirectory is legacy WI patches only).
- `/cc-suite:status` and `/cc-suite:result` retrieve from the SAME env-var-indirected path the runner writes to. They are symmetric. A successful runner exit (`status:"completed"`) guarantees `/cc-suite:status` will see the job.
- This path is **equivalent** to the user typing `/cc-suite:{kind}` and is the **default** for assistant-driven high-risk-WI reviews/audits/verifies.

### Path 2 — Direct Codex MCP (`mcp__plugin_codex-toolkit_codex__codex`) — **fallback only**

Only when Path 1 fails (runner script missing, `node` unavailable, plugin cache corrupt, `spawnSync codex ETIMEDOUT`, etc.). Direct MCP bypasses the broker, so the WI **loses** job tracking, `/cc-suite:status` retrievability, and `/cc-suite:result` storage. It does NOT lose Codex's review itself — the prompt template, persona, provenance disclosure, and parameters are replicated. But broker discipline is degraded.

Direct MCP preserves:

- Same prompt template (read from the slash command `.md` file in the runner-resolved plugin cache).
- Same `model`, `config.model_reasoning_effort`, `sandbox`, `approval-policy`, `developer-instructions`.
- `threadId` capture (so `/cc-suite:continue {threadId}` can resume the Codex thread later, restoring partial broker continuity).

The assistant MUST record the `threadId` explicitly in the WI's commit message or plan file. The WI's recording per §"Required recording" MUST mark `/cc-suite:status / /cc-suite:result retrievable?` as **NO** when Path 2 was used.

### Path 3 — `codex exec` CLI — **last resort**

Only when Paths 1 AND 2 both fail. This is the rawest tool — same prompt template, same model/effort/sandbox, but no job tracking and no `threadId` capture (CLI prints stdout and exits; the thread is lost on process exit). The WI loses essentially all broker semantics.

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

## State-store path (env-var-indirected; do NOT hardcode plugin-data subdir name)

The runner persists job state under `${CLAUDE_PLUGIN_DATA}/state/<workspace-slug>-<hash>/`. The env var is set by Claude Code's harness; in this repo it resolves to `~/.claude/plugins/data/codex-toolkit-xiaolai/state/<slug>-<hash>/` because cc-suite and the underlying codex-toolkit plugin share one state store. Two important consequences:

- **Do NOT inspect `~/.claude/plugins/data/cc-suite-xiaolai/state/`** to verify retrievability — that path is a decoy and may legitimately be empty. The runner doesn't write there.
- **Prefer `/cc-suite:status` over manual filesystem inspection.** Both the runner (writer) and the slash commands (reader) call the same `resolveStateDir(cwd)` helper, so a successful runner exit guarantees the job is retrievable. Filesystem checks against the wrong path produce false-negative "broker degraded" recordings, as happened in commit `5de5530` Phase A1 (see `dev-memo/cc-suite-runner-tracking-investigation.md` for the diagnosis).

The workspace's `.cc-suite/` directory at the repo root is NOT the runner's state dir. It contains only legacy WI baseline patches and is gitignored. Treat it as historical artifacts, not as job-tracking state.

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

## High-risk WIs — broker is REQUIRED

For high-risk WIs, cc-suite review/audit/verify is **required**. Self-review fallback is NOT acceptable regardless of recording. The broker — not just Codex — must run. Use Paths 0 / 1 / 2 / 3 / 4 in priority order.

High-risk categories (any one triggers the requirement):

- **Persistence / database** (including new package introduction; SQLite / native-module work).
- **Security** — TLS / DNS / SSRF / auth / sandboxing / crypto.
- **Cloud / sync** — external document exposure / external account / sync bridge.
- **Public API changes** — wire-format / schema / CLI breaking changes.
- **Framework / runtime dependencies** — Electron / Tauri / SQLite / native modules / new top-level deps.
- **Irreversible migrations** — production data operations / non-reversible schema changes.
- **LLM implementation** — any actual LLM-extractor execution (Step 8 future-implementation gate).

The list intentionally overlaps with the [[autonomy]] hard-stop list. Even when the autonomy rule itself does NOT trigger a hard-stop (e.g. a docs-only ADR that DESCRIBES a security boundary), the cc-suite review-plan gate may still apply because the plan governs the eventual high-risk work.

**Why the broker is required, not just Codex**: a Codex review without the broker is a one-shot artifact that disappears at process exit (Path 3) or persists only as a Codex `threadId` (Path 2). High-risk WIs need persistent, retrievable review artifacts in the workspace so subsequent audits, verifies, and human reviews can correlate findings across time and across the audit chain. The codex-toolkit shared state store at `${CLAUDE_PLUGIN_DATA}/state/<slug>-<hash>/jobs/` is the load-bearing artifact; direct calls bypass it.

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
7. **Output / result location** — for Path 1: `${CLAUDE_PLUGIN_DATA}/state/<workspace-slug>-<hash>/jobs/<jobId>.{json,log}` (the assistant SHOULD NOT inspect this path manually for verification — see §"State-store path"). For Path 2/3: inline in the WI report.
8. **`/cc-suite:status` / `/cc-suite:result` retrievable?** — YES iff Path 1 was used AND the runner returned `status:"completed"` or `status:"failed"` (both are retrievable). The assistant determines this from the runner's stdout JSON envelope, NOT from filesystem spot-checks against the wrong directory.
9. **Failure classification** (when the invocation failed or required fallback) — one of TIMEOUT / MODEL_API_ERROR / RUNNER_ERROR / PROMPT_CONTEXT_ERROR per §"Timeout / failure classification". Omitted when the invocation succeeded on the first attempt.
10. **Retry attempts** (review-plan only) — for review-plan invocations that took more than one attempt, list each attempt with its path, packet variant (full / compact), and outcome. Required so the reliability log can see the policy working.
11. **Fallback reason** — when Path 2 or Path 3 was used, one sentence explaining which Path 1 attempt(s) failed and why fallback was justified.

Recording these eleven fields is the contract for "automation that preserves cc-suite memory semantics." Without them, the run is undistinguishable from self-review.


## Audit remediation policy

Every `/cc-suite:audit` (or `/cc-suite:audit-fix`) produces a findings list with severities Critical / High / Medium / Low. Findings do NOT close themselves on commit; the WI MUST explicitly resolve each one.

### Resolution rules

1. **Critical / High / Medium findings**: each MUST be either
   - **FIXED** in the same WI and verified by a subsequent `/cc-suite:verify`, OR
   - **explicitly escalated to the user as a blocker** (stop and ask). Never silently leave a Critical / High / Medium finding open.

2. **Low findings**: deferral is allowed only when at least one of the following holds —
   - the finding is **outside the active WI scope** (e.g. a cleanup in an adjacent file the WI does not touch), OR
   - the finding is **cleanup / refactor-only** (no behavioral correctness, security, or invariant impact), OR
   - the **audit result itself explicitly accepts deferral** (typical wording: "DEFERRED-PER-WI", "acceptable as-is", "out of scope for this audit").

### Required recording per deferred finding

For every deferred finding (regardless of severity, including Lows), record in the WI's commit message OR the dev-memo plan file:

1. **Finding ID** — the auditor's identifier (e.g. `F4.2`, `Dim 3 #1`).
2. **Severity** — Critical / High / Medium / Low. (Mediums and above MUST be escalated, not deferred — recording escalation captures the same fields.)
3. **Reason for deferral** — one sentence citing which clause of §"Resolution rules" item 2 applies (out-of-scope / cleanup-only / explicit-accept) or, for an escalation, why the user should treat it as a blocker.
4. **Target future WI or backlog label** — the place this WI's resolution moves to. May be a planned phase name (e.g. "A4"), a backlog tag, or "no follow-up planned (cleanup accepted)".
5. **Safe-to-proceed?** — YES iff deferral does not weaken the current WI's acceptance criteria; NO iff this WI cannot ship until the finding is addressed (in which case it is NOT a deferral — it is an escalation).

When several Lows share the same deferral category, group them under one row with a comma-separated finding-ID list.

### Verify obligations (extends §"Verify must consume explicit audit artifacts")

`/cc-suite:verify` MUST check that:

- All Critical / High / Medium findings flagged in the prior audit are now CLOSED in source.
- All deferred findings are intentionally deferred per the recorded reasons above — verify the source still matches the deferred state (e.g. a "no fix expected, retained intentionally" item must still be present and unchanged).
- NO Critical / High / Medium finding remains in an undocumented "open" state.

If verify finds an undocumented open Critical / High / Medium, the WI is NOT ready to commit — escalate immediately. Verify's verdict must be `ALL CLOSED` (or `ALL CLOSED + DEFERRED-PER-WI Lows`) before commit.

### Durable backlog file

In addition to per-WI commit-message recording, every deferred finding MUST also be appended to `dev-memo/deferred-audit-findings.md`. That file is the project-wide rollup grouped by WI / commit so future WIs can find prior deferrals without scraping `git log`. The row format and update rules live in the backlog file's own header.

Closing an entry (when a later WI fixes it) MUST update the row's `status` field in-place to `closed` and cite the resolution commit — the row stays visible. Same for `superseded` when the underlying surface is removed.

### Cross-references

- §"Required recording" — the 11-field invocation log lives there; the remediation log here is per-finding and lives in the same commit message / plan file AND in `dev-memo/deferred-audit-findings.md`.
- `dev-memo/deferred-audit-findings.md` — project-wide backlog of deferred findings, grouped by WI.
- `[[../skills/project-autopilot/SKILL]]` and `[[../skills/security-wi-loop/SKILL]]` — both reference this policy in their audit / verify steps.

## Rollback recording (when reverting a cc-suite-recorded high-risk WI)

`dev-memo/rollback-00.md` is the authoritative rollback policy. When a previously-committed HIGH-RISK WI (one whose commit message carries the §"Required recording" 11-field block) is rolled back via `git revert <hash>`, the revert commit message MUST carry a 7-field rollback recording, parallel to the 11-field invocation log:

1. **Original commit hash** — the commit being reverted.
2. **Revert commit hash** — the commit that lands the `git revert` (set after commit; the message author leaves a placeholder and amends in the same commit if needed, OR the placeholder cites the not-yet-known hash).
3. **Original cc-suite job IDs** — every `review-plan` / `audit` / `verify` / `audit-fix` jobId from the original commit's recording block.
4. **Reason** — one-paragraph description of why the commit is being reverted (wrong product direction / weakened security boundary / mixed scopes / etc.). See `dev-memo/rollback-00.md` §5 for the canonical rollback trigger list.
5. **Tests run after revert** — the test commands and their pass/fail outcomes (per-package `npm test`).
6. **Whether the revert itself was audited** — typically NO for revert-only commits; YES if the revert touches multiple unrelated files and the user explicitly requests a sanity audit.
7. **Deferred-audit backlog changes** — if the original commit had rows in `dev-memo/deferred-audit-findings.md`, those rows MUST be updated to `status: reverted` referencing the revert commit hash.

Without this recording, a `git log` reader cannot tell whether the rollback was deliberate, was reviewed, or affected the audit trail. The 7-field block lives in the revert commit's message body, in the same position the 11-field invocation log would occupy on a forward-commit.

**Overnight restriction**: during autopilot / `/loop` / overnight `/goal` runs, Claude MUST NOT auto-revert. Per `dev-memo/rollback-00.md` §4 + [[../skills/project-autopilot/SKILL]] §"Stop conditions", autopilot stops with `STOP-FOR-ROLLBACK` and emits a 7-field stop-and-report. The user authorizes (or declines) the revert; if authorized, the revert lands in interactive mode with the 7-field rollback recording above.

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

## Review packet (HIGH-RISK review-plan invocations)

For HIGH-RISK WIs (per §"High-risk WIs"), the plan author MUST include a **compact review packet** at the top of the plan file under a section labeled `## Review packet (compact)`. The packet contains ONLY the load-bearing pieces a reviewer needs in the first attempt:

1. **Active plan summary** — 3-5 sentences naming the WI, its scope cut, its dependency on prior phases.
2. **Exact target files** — list (NOT "everything in this directory").
3. **Exact acceptance criteria** — list (NOT "the standard acceptance pattern").
4. **Exact out-of-scope list** — list. The reviewer needs this to avoid flagging deferred items.
5. **Essential ADR references** — 2-3 max. The contract docs the WI directly depends on. NOT every ADR in the series.
6. **Review questions** — 3-5 specific questions the reviewer should answer. Targeted.

The full plan body sits BELOW the packet and provides depth on demand. The packet is the prompt budget for the second attempt of the retry policy (see §"Retry policy").

`audit` and `verify` invocations do NOT require a packet — their scope is the diff (audit) or the prior audit report (verify), which is naturally bounded. Only `review-plan` runs the packet discipline.

## Retry policy (`review-plan`)

The recurring failure mode for `review-plan` is `spawnSync codex ETIMEDOUT` (codex-runner.mjs hits its 30-minute internal timeout) when the prompt is too wide. The fix is to retry with a narrower prompt, then fall back if even the narrow prompt times out.

Sequence:

| Attempt | Path | Prompt | If success | If `ETIMEDOUT` |
|---|---|---|---|---|
| 1 | Path 1 runner | FULL packet — full plan + parent + supporting ADRs + contract refs | Record result; done. | Go to attempt 2. |
| 2 | Path 1 runner | COMPACT packet — only the §"Review packet (compact)" section | Record result; note "retry with compact packet succeeded"; done. | Go to attempt 3. |
| 3 | Path 2 direct MCP | COMPACT packet | Record threadId; note "Path 2 fallback after two Path 1 timeouts"; done. | Go to attempt 4. |
| 4 | Path 3 (`codex exec`) | COMPACT packet | Record; note "Path 3 last resort". | Stop and ask user (Path 4 of the §"Invocation paths" decision matrix). |

The retry policy applies ONLY to `review-plan`. For `audit` and `verify`, a Path 1 failure goes straight to Path 2 per §"Failure handling".

## Timeout / failure classification

Every recorded cc-suite invocation MUST classify its outcome into one of these classes (also referenced in `dev-memo/cc-suite-reliability-log.md`):

| Class | Signature | Retry policy |
|---|---|---|
| **TIMEOUT** | `spawnSync codex ETIMEDOUT` from runner stdout | review-plan: retry per §"Retry policy". audit/verify: skip to Path 2. |
| **MODEL_API_ERROR** | Codex MCP returns 5xx / auth / quota / model-not-available | Surface to user; do NOT retry blindly. |
| **RUNNER_ERROR** | codex-runner.mjs itself exits non-zero with its OWN error (not Codex's) | Surface to user; check runner version; Path 2 fallback acceptable for the WI but the runner needs separate repair. |
| **PROMPT_CONTEXT_ERROR** | Runner returns success but Codex's `rawOutput` refuses the task / cannot read files / returns obvious off-target answer | Fix the prompt; re-attempt Path 1. NOT a Path 1 failure. |

The §"Required recording" field set is extended with the class. See §"Required recording" updates below.

## Failure handling

- Path 1 emits `{ status: "failed", error: <msg> }` — classify per §"Timeout / failure classification"; for `review-plan` TIMEOUT, follow §"Retry policy"; otherwise surface to user and attempt Path 2.
- Path 2 returns `[Tool result missing due to internal error]` or empty — do NOT retry; attempt Path 3.
- Path 3 nonzero exit — stop and ask the user (Path 4).
- `/cc-suite:status` returning an unhealthy / un-authenticated bridge state — surface to user; do NOT proceed.

## Cross-references

- `AGENTS.md` §"CC-Suite Integration Policy" — `cc-suite` is the default bridge for Claude ↔ Codex coordination. This rule extends that policy to the path order + recording requirements.
- `AGENTS.md` §"Mutation policy" — Codex-side tools are reviewers by default; Codex MUST NOT write code unless the WI explicitly authorizes implementation. The cc-suite broker's persona + approval-policy on review/audit/verify commands lock Codex into reviewer mode.
- [[autonomy]] — hard-stop list; cc-suite-required categories often overlap with autonomy hard-stops.
- [[security-boundary]] — security-sensitive scope; cc-suite review-plan is required before implementation.
- [[loc-guardian]] — orthogonal gate; LOC + cc-suite both apply.
- [[../skills/security-wi-loop/SKILL]] — security WI loop; review-plan step now uses Path 1 by default.
- [[../skills/project-autopilot/SKILL]] — autopilot loop; same.
- [[../skills/client-architecture-reconcile/SKILL]] — reconciliation skill; low-risk by default, self-review fallback allowed with recording.
- `dev-memo/cc-suite-automation-investigation.md` — the investigation that produced the Path 1/2/3/4 ordering; documents the three invocation paths and the underlying Codex MCP tool name.
- `dev-memo/cc-suite-runner-tracking-investigation.md` (CCSUITE-01) — confirms Path 1 broker tracking works at `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-<hash>/`.
- `dev-memo/cc-suite-reliability-log.md` (CCSUITE-02) — append-only log of every Path 1/2/3 invocation failure and its retry outcome. New entries land here whenever the retry policy fires.
- `dev-memo/rollback-00.md` (ROLLBACK-00) — authoritative rollback policy; §"Rollback recording" above mirrors §6 of this memo and §"Forbidden operations" of the memo mirrors [[autonomy]]'s hard-stop list extensions.
- `dev-memo/night-run-00.md` (NIGHT-RUN-00) — authoritative overnight-lane policy. Every overnight `/loop` / `/project-autopilot` / long `/goal` run is lane-scoped; the lane authorization specifies which cc-suite review/audit/verify steps are required for the lane's WIs. The 11-field cc-suite recording structure (above) is inherited by every commit in the lane.
- [[execution-discipline]] — behavioral floor for implementation WIs (think-before-coding / simplicity / surgical changes / goal-driven execution). cc-suite audit prompts MAY check the diff against this rule's §3 (surgical changes) when scoring drive-by-refactor risk; cc-suite remains the independent quality gate.
