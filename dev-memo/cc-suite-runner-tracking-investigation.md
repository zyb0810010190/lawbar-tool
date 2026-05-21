# CCSUITE-01 — cc-suite Runner Job-Tracking Investigation

**Status**: investigation complete. Docs-only WI.
**Date**: 2026-05-21.
**Conclusion**: **The runner job tracking WORKS.** The Phase A1 commit message's "broker degraded" recording was a false negative caused by checking the wrong path.

---

## TL;DR

- Phase A1 (commit `5de5530`) recorded all four cc-suite invocations as `/cc-suite:status / /cc-suite:result retrievable? NO` based on an empty `state.json` at `~/.claude/plugins/data/cc-suite-xiaolai/state/lawbar-tool-*/`.
- That path is a **decoy**. The runner reads `process.env.CLAUDE_PLUGIN_DATA` and writes state under `${CLAUDE_PLUGIN_DATA}/state/<workspace-slug>-<hash>/`. In this session `CLAUDE_PLUGIN_DATA = /Users/zhongyibao/.claude/plugins/data/codex-toolkit-xiaolai`, so jobs actually persist under `~/.claude/plugins/data/codex-toolkit-xiaolai/state/lawbar-tool-8153f46e0d61e5fb/`.
- Walking that real path shows **all 9 jobs from this session are persisted** (5 review-plan rounds + 1 audit + 2 verifies + 1 smoke test), each with a `<jobId>.log` and `<jobId>.json` result file.
- `/cc-suite:status` and `/cc-suite:result` resolve through the same `resolveStateDir(cwd)` helper used by the runner, so they read the same env-var-indirected path. The slash commands DO retrieve the workspace's jobs.
- **Phase A2 may proceed under full broker discipline.** No degradation policy needed.

---

## 1. Where the runner actually writes state

`~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/lib/state.mjs` resolves the state directory as:

```js
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "codex-toolkit");

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd); // git rev-parse --show-toplevel
  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir
    ? path.join(pluginDataDir, "state")
    : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}
```

So the runner picks the state dir in this priority order:

1. `${CLAUDE_PLUGIN_DATA}/state/<slug>-<hash>/` if env var is set.
2. `${TMPDIR}/codex-toolkit/<slug>-<hash>/` (fallback).

In this Claude Code session the env var is set:

```
$ echo "[$CLAUDE_PLUGIN_DATA]"
[/Users/zhongyibao/.claude/plugins/data/codex-toolkit-xiaolai]
```

So the resolved path is `/Users/zhongyibao/.claude/plugins/data/codex-toolkit-xiaolai/state/lawbar-tool-8153f46e0d61e5fb/`. The `lawbar-tool` slug comes from `git rev-parse --show-toplevel` (the workspace root); the hash is sha256 of the resolved canonical path.

### Why the env var points at `codex-toolkit-xiaolai` (not `cc-suite-xiaolai`)

`~/.claude/plugins/data/` contains entries for every plugin Claude Code knows about:

```
caveman-caveman
cc-suite-xiaolai
claude-english-buddy-xiaolai
codex-openai-codex
codex-toolkit-xiaolai
docs-guardian-xiaolai
superpowers-superpowers-marketplace
tdd-guardian-xiaolai
```

The cc-suite plugin's runner is *shared with* the codex-toolkit plugin's job system — that's the "single bridge" claim in the cc-suite manifest (cc-suite version 0.2.10 description: "One plugin to bridge and delegate across Claude Code, Codex CLI, and Gemini CLI"). When Claude Code invokes the runner, it sets `CLAUDE_PLUGIN_DATA` to the *codex-toolkit* plugin's data dir, which is the canonical state store for Codex-job tracking across both plugins.

The mistake in Phase A1's recording was assuming `CLAUDE_PLUGIN_DATA = ~/.claude/plugins/data/<plugin-name>-<author>/` where plugin-name matches the invoking command's namespace. It doesn't — the env var is set by the harness, not by command-name string-matching.

## 2. What's actually persisted

`~/.claude/plugins/data/codex-toolkit-xiaolai/state/lawbar-tool-8153f46e0d61e5fb/state.json`:

```
{
  "version": 1,
  "config": { "stopReviewGate": false },
  "jobs": [ ...9 jobs from this session... ]
}
```

The nine jobs (chronological):

| Job ID | Kind | Status | Summary |
|---|---|---|---|
| `review-plan-mpewd0z1-0t1kj7` | review-plan | completed | round 1 of A1 plan review |
| `review-plan-mpewm5fj-4jmkhd` | review-plan | completed | round 2 |
| `review-plan-mpewted7-s74am9` | review-plan | completed | round 3 |
| `review-plan-mpewyzzp-9tp90y` | review-plan | completed | round 4 |
| `review-plan-mpex4pe8-gr8c50` | review-plan | failed | round 5 attempt 1 (`spawnSync codex ETIMEDOUT`) |
| `audit-mpf8prhx-qenxkd` | audit | completed | A1 audit |
| `verify-mpf92zew-yy0uyp` | verify | completed | A1 verify round 1 |
| `verify-mpf974sx-sn3hum` | verify | completed | A1 verify round 2 (ALL CLOSED) |
| `review-plan-mpf9wtdt-zpwfsi` | review-plan | completed | this WI's smoke test |

Each has both a `.log` file (logged from runner) and a `.json` file (Codex's full rawOutput) under `jobs/`. So `/cc-suite:result <jobId>` can retrieve any of them.

The Phase A1 commit message's "Recommended follow-up: investigate the cc-suite v0.2.10 runner's job-tracking failure" was **chasing a non-existent failure**. The runner has always worked correctly.

## 3. What `/cc-suite:status` actually reads

`~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/commands/status.md` runs:

```bash
node -e "
  const { buildStatusSnapshot } = await import('${CLAUDE_PLUGIN_ROOT}/scripts/lib/job-control.mjs');
  const snapshot = buildStatusSnapshot(process.cwd(), { all: ... });
  console.log(JSON.stringify(snapshot, null, 2));
"
```

`buildStatusSnapshot` in `job-control.mjs` calls the same `resolveStateDir(cwd)`. Therefore the slash command reads from the same env-var-indirected path the runner writes to. Symmetric. They use the same physical state directory.

Same goes for `/cc-suite:result <jobId>` (per `commands/result.md`).

## 4. Smoke-test confirmation

Ran a tiny review-plan invocation:

```
Before: 8 jobs
$ node ~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs \
    --kind review-plan --model gpt-5.5 --effort medium --sandbox read-only \
    --summary "CCSUITE-01 smoke test" \
    -- "<short prompt that reads dev-memo/cc-suite-automation-investigation.md>"

{"jobId":"review-plan-mpf9wtdt-zpwfsi","status":"completed","rawOutput":"OK # cc-suite Automation Investigation\n"}

After: 9 jobs (the new job-id is recorded; .log + .json exist under jobs/)
```

The state.json gained the new entry atomically. `/cc-suite:status` would list it; `/cc-suite:result review-plan-mpf9wtdt-zpwfsi` would return the rawOutput.

## 5. Permissions

```
$ ls -la ~/.claude/plugins/data/codex-toolkit-xiaolai/state/lawbar-tool-8153f46e0d61e5fb/
drwxr-xr-x  zhongyibao  staff  jobs
-rw-r--r--  zhongyibao  staff  state.json
```

Writeable. No permission issue.

## 6. Runner CLI surface (canonical)

For the autonomy rule's runner-path resolution + recording:

```
node {runnerPath} \
  --kind {review-plan | audit | verify | audit-fix} \
  --model {model} \
  --effort {effort} \
  --sandbox {read-only | workspace-write | danger-full-access} \
  [--background] \
  [--session-id {id}] \
  [--summary {text}] \
  -- "{prompt}"
```

Environment variables (set automatically by Claude Code's plugin harness):

- `CLAUDE_PLUGIN_DATA` — base directory for cc-suite/codex-toolkit shared state. The runner appends `state/<slug>-<hash>/` under this.
- `CLAUDE_PLUGIN_ROOT` — path to the plugin's installed root (used by the slash command bodies to `import`).
- `CODEX_TOOLKIT_SESSION_ID` — propagated as the `--session-id` default when present.

If the runner is invoked from a shell where these env vars are unset, it falls back to `/tmp/codex-toolkit/` for state. That's a separate-store fallback the assistant SHOULD NOT rely on (would break `/cc-suite:status` retrievability when the env var was later present).

## 7. Bug? Misconfiguration? Documentation gap?

No bug. No misconfiguration. **Documentation gap** in this repo's `.claude/rules/cc-suite.md`:

- The rule's §"Required recording" item 7 says `Output / result location — for Path 1: .cc-suite/<jobId>/`. That path is wrong — `.cc-suite/` in the workspace root is gitignored and has been treated as a workspace state dir, but it actually contains only legacy WI baseline patches (`.cc-suite/wi-01-baseline.patch` etc.). The active runner state is NOT there. It's under `${CLAUDE_PLUGIN_DATA}/state/<slug>-<hash>/`.
- The rule should instruct the assistant to inspect `process.env.CLAUDE_PLUGIN_DATA` (or just trust `/cc-suite:status` retrievability) instead of hardcoding a workspace-relative path.

Both adjustments are minor doc clarifications; the rule's overall posture (broker as workflow broker; Path 1 default; etc.) does not change.

## 8. Concrete updates needed

| Change | File | Where |
|---|---|---|
| Correct the state path | `.claude/rules/cc-suite.md` §"Path 1" + §"Required recording" item 7 | replace `.cc-suite/<jobId>/` with `${CLAUDE_PLUGIN_DATA}/state/<workspace-slug>-<hash>/` (or the equivalent: "the path `/cc-suite:status` reads") |
| Add the runner path-resolution caveat | `.claude/rules/cc-suite.md` new sub-section under "Runner path resolution" | note the env-var indirection and the `~/.claude/plugins/data/<plugin>-<author>/` ambiguity |
| Note Phase A1 records are retrievable | `dev-memo/cc-suite-runner-tracking-investigation.md` (this file) | done above |

The Phase A1 commit message itself is now outdated on the "retrievable? NO" claim. A future docs-cleanup could append a note; no functional consequence (the jobs ARE retrievable; just the recording said otherwise).

## 9. Implication for the autonomy policy

`.claude/rules/cc-suite.md` §"High-risk WIs — broker is REQUIRED" stays unchanged. Path 1 invocations DO satisfy broker discipline; the only required clarification is **how** to check retrievability.

Phase A2 (case-box-persistence confidentiality classification) and any other high-risk WI may proceed under the current broker policy, with these explicit operational notes:

1. Resolve the runner path dynamically (already in the rule).
2. After the runner returns, the job IS retrievable via `/cc-suite:status` and `/cc-suite:result <jobId>` — the assistant should not log a "degraded broker" fallback unless those commands actually fail.
3. The state path for spot-checking is `${CLAUDE_PLUGIN_DATA}/state/<slug>-<hash>/`, not `.cc-suite/<jobId>/`.

## 10. No upstream issue needed

cc-suite v0.2.10 behaves as designed. The codex-toolkit-xiaolai data dir is the canonical store; the cc-suite plugin reuses it. No bug report.

## 11. Allowed-commit scope for CCSUITE-01

Per the WI authorization:

- `dev-memo/cc-suite-runner-tracking-investigation.md` (this file).
- `.claude/rules/cc-suite.md` — minor clarification per §8.

NOT modified:

- Any product code.
- `services/case-box-persistence/`.
- Other rule or skill files.
- Plugin source.

After commit, Phase A2 may proceed under the current broker policy.
