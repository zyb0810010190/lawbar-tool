# CCSUITE-PATH1-RCA-01 — Root-cause analysis of cc-suite Path 1 `/review-plan` hang during B6 plan review

**Status**: RCA complete; recommendation issued.
**Date**: 2026-05-22.
**Lane**: CCSUITE-PATH1-RCA-01 (diagnostic-only; no impl, no product code touched).
**Predecessors**: B6 plan committed at `8fe0b04` after Path 1 attempt 1 was killed and the plan went through Path 2 inline review for three iterations to READY.
**HEAD at investigation start**: `8fe0b04`.

## §1 Root cause (single concrete cause)

The original B6 review-plan Path 1 invocation **was wrapped in Claude Code's `Bash` tool with `run_in_background: true`. The harness terminated the wrapping shell process before `codex exec` completed, killing the runner mid-flight**. The runner had already written its `review-plan-mph0kr0m-8icc1c` registration to cc-suite state with `status: "running"` but never reached the success/failure update — the JSON envelope was never produced and the `.json` result file never written.

**This is NOT a cc-suite Path 1 / codex-runner.mjs bug.** Path 1 runner foreground works (76s on retry with the same B6 prompt). Path 1 runner native `--background` works (22s smoke). The failure is in how I, the orchestrating agent, wrapped the runner inside Claude Code's `Bash run_in_background: true` for cc-suite work, which is unsafe for long-running invocations because the harness may reap the backgrounded shell process before codex returns.

## §2 Evidence

### §2.1 Environment

```
pwd:    /Users/zhongyibao/ClaudeProjects/lawbar-tool
HEAD:   8fe0b04
claude: 2.1.148 (Claude Code)
codex:  codex-cli 0.131.0  (0.133.0 available)
node:   v24.14.0
npm:    11.9.0
```

### §2.2 Killed-job evidence

State at `/Users/zhongyibao/.claude/plugins/data/cc-suite-xiaolai/state/lawbar-tool-8153f46e0d61e5fb/jobs/review-plan-mph0kr0m-8icc1c.{json,log}`:

- `.json` result file: **does not exist** (writeJobFile never called).
- `.log` content (5 lines total, latest pre-RCA):
  ```
  [2026-05-22T14:27:41.703Z] Starting review-plan task
  [2026-05-22T14:27:41.704Z] Model: gpt-5.5, Effort: high, Sandbox: read-only
  ```
  No "Completed successfully" or "Failed: ..." line — the runner's foreground exit branch in `codex-runner.mjs` lines 102-137 never ran.
- `state.json` entry frozen at:
  ```json
  {
    "id": "review-plan-mph0kr0m-8icc1c",
    "kind": "review-plan",
    "status": "running",     // before RCA reap; reaped to "failed" in §4
    "pid": 67860,
    "startedAt": "2026-05-22T14:27:41.661Z",
    "sessionId": "7f922027-f83c-4e9e-a0e4-f7cd4fecc11b"
  }
  ```
- PID 67860 was no longer running at investigation start (`ps -p 67860` empty).
- No `codex-runner` or related `codex` processes alive aside from unrelated MCP/app-server daemons.

### §2.3 Codex CLI / runner health

`codex doctor`: all green except `↑ updates 0.133.0 available` (current 0.131.0). Reachability `✓`. Auth `✓ chatgpt`. State databases healthy.

`~/.codex/config.toml` shows the lawbar-tool project as `trust_level = "trusted"`. Default model `gpt-5.4`. The runner passes `--model gpt-5.5` per `.codex-toolkit.md` (the default cc-suite review-plan model). `[tui.model_availability_nux] "gpt-5.5" = 4` suggests gpt-5.5 is a NUX/preview model but it WORKS — verified via direct `codex exec --model gpt-5.5` smoke (~90s with cleanup) and via runner smoke (~23s clean exit).

Runner patch for codex-cli 0.131.0 is in place (lines 65-69 of `codex-runner.mjs`):
```js
// Local patch: codex-cli 0.131.0 dropped both `--approval-policy`
// (now config-only) and `--quiet` (renamed/removed). Re-add the
// appropriate flags here once cc-suite is bumped for the new
// codex-cli surface.
```
The patch already removed the deprecated flags. This is NOT the failure mode.

### §2.4 Smoke tests (this RCA, foreground)

| # | Invocation | Elapsed | Result |
|---|---|---|---|
| S1 | `codex exec --model gpt-5.5 --sandbox read-only "Reply in one word: ack"` | ~90s (cleanup delay) | `ack` returned; codex exited at ~90s with `ERROR codex_models_manager: failed to refresh available models: timeout waiting for child process to exit` warning before clean exit. |
| S2 | Same as S1 with `--model gpt-5.4` | ~90s (cleanup delay) | Same shape. |
| S3 | Same prompt, extended to 180s wait | 180s — clean exit | Codex DOES terminate cleanly; it just takes ~90-180s for the model-refresh child to exit. Not a hang. |
| S4 | `node $RUNNER --kind review-plan --model gpt-5.4 --effort medium --sandbox read-only -- "Reply in one word: ack"` | **27s** | JSON envelope `{status:"completed", rawOutput:"ack\n"}`. Clean. |
| S5 | Same as S4 with `--model gpt-5.5 --effort high` | **23s** | JSON envelope. Clean. |
| S6 | Same runner invocation as the failed B6 attempt — **same 2428-byte prompt from `/tmp/review-plan-b6.prompt.txt`** | **76s** | JSON envelope, NEEDS-FIX verdict + full review-plan output. Clean exit. |

### §2.5 Native cc-suite `--background` smoke (this RCA)

```
node $RUNNER --kind review-plan --model gpt-5.4 --effort medium --sandbox read-only \
  --background --summary "RCA native bg" -- "Reply in one word: bg-ack"
→ {"jobId":"review-plan-mph39ld9-ijd018","status":"queued"} (1s)
→ poll after 30s: .log shows `Completed successfully`; .json file exists.
```

Native cc-suite `--background` mode produces the jobId instantly + the worker completes in the background + state writes land in `${CLAUDE_PLUGIN_DATA}/state/.../jobs/`. **Works correctly.**

### §2.6 What was different about the failed B6 attempt

The failed attempt was invoked by me via the Claude Code Bash tool with the following pattern:

```bash
node $RUNNER ... -- "$(cat /tmp/review-plan-b6.prompt.txt)" 2>&1 | tee /tmp/review-plan-b6.v1.out
```

…with `run_in_background: true` on the Bash tool call. The harness:
1. Returned a task ID for polling.
2. Two TaskOutput polls (each `block: true, timeout: 600s`) returned `running`.
3. Third TaskOutput returned `killed` status.
4. The `/tmp/review-plan-b6.v1.out` file was 0 bytes — `tee` never received stdout from the killed runner.
5. cc-suite state was left with `status: "running"` because the runner was SIGKILL'd before the foreground exit branch could update state.

Elapsed before kill: ~20 minutes (two 600s polls). Codex itself only needs ~76s for this prompt — the harness's `run_in_background` reaper killed the process for reasons unrelated to codex/runner health.

**Two candidate explanations** for the harness kill:
1. The Claude Code Bash tool has an internal wall-clock limit on backgrounded processes that exceeds a single poll window but expires before a long-running process completes.
2. Stdin/stdout buffering through the `tee` pipe blocked the runner's `process.stdout.write` long enough for the harness to consider the process unhealthy and reap it.

I cannot definitively distinguish the two without inspecting the Claude Code harness internals, which are out of this lane's scope. **What is definitive**: the failure mechanism is in the harness-level backgrounding, not in cc-suite Path 1 or codex-cli.

## §3 Failure class (per `.claude/rules/cc-suite.md` §"Timeout / failure classification")

- **NOT** TIMEOUT in the codex/runner sense (spawnSync's internal 30-min limit was not reached; codex returns in 76s for this prompt).
- **NOT** MODEL_API_ERROR (codex doctor green; smoke verifies provider reachable + auth OK).
- **NOT** RUNNER_ERROR (runner exits 0 with valid JSON envelope when invoked foreground or with native `--background`).
- **NEW CLASS — `HARNESS_REAP`**: orchestrating agent's wrapper (Claude Code Bash tool `run_in_background: true`) killed the runner before codex returned. Not currently enumerated in cc-suite.md; this RCA suggests adding it. The job's state-file is left with `status: "running"` (orphan).

## §4 Fix applied

- **Reaped the orphan job**: updated state.json entry for `review-plan-mph0kr0m-8icc1c` from `status: "running"` to `status: "failed"` with `errorMessage` pointing at this RCA. The runner does not have a built-in reaper; manual edit was the only reliable cleanup option. Future improvement: cc-suite runner could add a stale-job sweeper that flips long-running orphans to `failed` after some threshold.

- **No product code changes.** No symlink changes. No plugin reinstall. No Codex re-login.

## §5 Recommendation

**Path 1 broker is safe to use for B6 impl audit and beyond.** Two requirements:

1. **NEVER wrap the runner in Claude Code Bash `run_in_background: true`.** Use one of:
   - Runner **foreground mode** (no `--background`, no Bash backgrounding). The Bash call blocks until the runner returns; tested at ~23-76s for typical review-plan prompts.
   - Runner **native `--background` mode** (`--background` flag). Returns instantly with a jobId; the runner detaches a worker process that writes to cc-suite state. Tested at 22s end-to-end with full state writes.

2. **Prefer native `--background` for long-running cc-suite calls** (large prompts, deep effort, audit + verify chains). It produces a jobId that survives any harness reaper because the worker runs `detached: true` with `stdio: "ignore"` (see `codex-runner.mjs` lines 156-178). Pair with periodic polling via `${CLAUDE_PLUGIN_DATA}/state/.../jobs/<jobId>.json` for completion detection.

3. **B6 impl audit can proceed via Path 1**, ideally using native `--background` to avoid any harness-reaper risk. Do NOT rerun the failed B6 review-plan attempt — the plan is already READY at `8fe0b04` after three Path 2 inline iterations.

## §6 Verification

- Smoke S4-S6 above confirm Path 1 foreground works for trivial AND realistic-size prompts.
- Smoke S5 confirms the gpt-5.5/high combination (used by the failed attempt) works.
- Native-background smoke (§2.5) confirms `--background` works end-to-end with jobId + state lifecycle.
- Orphan reaped (§4).

## §7 Remaining risk

- **Codex CLI 0.131.0 cleanup delay**: direct `codex exec` calls take 90-180s to cleanly exit AFTER producing output, because of the `codex_models_manager: failed to refresh available models: timeout waiting for child process to exit` warning. The runner is unaffected because it uses `spawnSync` with a 30-min timeout. Upgrade to codex-cli 0.133.0 (available per `codex doctor`) is recommended but NOT a B6 blocker; this RCA does NOT propose upgrading inside this lane (out of scope).
- **Bash tool `run_in_background: true` is unsafe for any long-running cc-suite call**. Document this in `.claude/rules/cc-suite.md` (separate WI; out of this lane's scope) so future agents avoid the pattern.
- **Orphan-job reaping**: cc-suite runner doesn't auto-reap `running` orphans. Future cc-suite enhancement could add a startup sweep that flips long-stuck `running` entries to `failed`. Not B6's concern.

## §8 Was Path 1 used for prior B-series WIs?

YES — every prior B-series WI (B1-B5) used Path 1 broker successfully:

| Job | jobId | Outcome |
|---|---|---|
| B1 audit | `audit-mpgp8zvk-lexx9h` | completed |
| B2 audit | `audit-mpgvvpvp-baaz84` | completed |
| B2 verify | `verify-mpgw3lsr-s9c0xm` | completed |
| B3 audit | `audit-mpgxmwgj-pbxgze` | completed |
| B4 audit | `audit-mpgyzp9t-iftt4p` | completed |
| B5 audit | `audit-mpgzx0ka-r4jne5` | completed |

The B6 plan-review path used Path 1 attempt 1 → KILLED via Bash backgrounding → fell back to Path 2 (`mcp__codex-cli__codex`) for the actual review iterations. All B6 plan iterations passed via Path 2. The plan is READY at `8fe0b04`.

## §9 Stop condition

This RCA is complete. Lane closes. **B6 implementation is NOT authorized by this lane**; a separate explicit user authorization is required for B6 impl (per umbrella plan + B6 plan `8fe0b04`).

## §10 References

- B6 plan: `dev-memo/plan-case-box-persistence-B6-facts.md` (READY at `8fe0b04`).
- B5 impl: `fcfc816`.
- Runner: `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs`.
- State: `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/`.
- `.claude/rules/cc-suite.md` §"Invocation paths" + §"Timeout / failure classification" + §"Retry policy".
- `dev-memo/cc-suite-runner-tracking-investigation.md` (prior runner-tracking work; not directly related to this RCA's failure mode).
