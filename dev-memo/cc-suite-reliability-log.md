# cc-suite Reliability Log

**Status**: living document. Tracks every Path 1 / Path 2 / Path 3 cc-suite invocation that experienced a failure mode, along with the error class, the retry path, and the eventual outcome. Started 2026-05-21 (CCSUITE-02).

Purpose: keep an honest, append-only record of cc-suite review/audit/verify failures so the workflow rule can evolve from real data, not anecdotes. Every entry below references a concrete job-id or thread-id retrievable from the codex-toolkit shared state store at `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-<hash>/`.

---

## Error class taxonomy

For consistent triage across entries:

| Class | Signature | Likely cause | Recommended response |
|---|---|---|---|
| **TIMEOUT** | `spawnSync codex ETIMEDOUT` (codex-runner.mjs hits its 30-minute internal timeout) | Prompt too large / context too wide / model effort too high for the time budget. Codex reads many files and runs out of clock. | Per the retry policy in `.claude/rules/cc-suite.md`: Path 1 attempt 2 with a COMPACT REVIEW PACKET; then Path 2 if still failing. |
| **MODEL_API_ERROR** | Codex MCP returns a Codex/OpenAI API error (5xx, auth, quota, model-not-available) | Vendor-side fault, auth lapse, rate limit. | Surface to user; do NOT retry blindly. Confirm `/cc-suite:status` shows the bridge healthy; then retry as a fresh Path 1. |
| **RUNNER_ERROR** | `codex-runner.mjs` exits non-zero with a stack trace from the runner itself (NOT from inside Codex) | Runner version mismatch, missing dependency, broken hook. | Surface to user; check runner version. Path 2 fallback acceptable for the current WI but the runner needs separate repair. |
| **PROMPT_CONTEXT_ERROR** | Runner returns success but Codex's `rawOutput` says "I cannot read X" / refuses the task / returns an obvious off-target answer | Developer-instructions malformed; file paths wrong; prompt template missing a section. | Fix the prompt and re-attempt Path 1. Do NOT count as a Path 1 failure if the runner mechanically succeeded. |

---

## Review packet (compact form) — what goes in it

When a Path 1 attempt times out, the second attempt uses a "compact review packet" — typically a top-of-plan section the plan author keeps fresh. The packet contains ONLY:

1. **Active plan summary** — 3-5 sentences naming the WI, its scope cut, its dependency on prior phases.
2. **Exact target files** — list. NOT "everything in this directory."
3. **Exact acceptance criteria** — list. NOT "the standard acceptance pattern."
4. **Exact out-of-scope list** — list. The reviewer needs this to avoid flagging deferred items.
5. **Essential ADR references** — 2-3 max. The contract docs the WI directly depends on. NOT every ADR in the case-box series.
6. **Review questions** — 3-5 specific questions the reviewer should answer. Targeted.

Plans SHOULD carry this packet as a top section labeled `## Review packet (compact)` so it can be excerpted verbatim when the retry triggers.

---

## Retrospective entries (pre-CCSUITE-02 failures)

### 2026-05-20 — A1 review-plan round 5

| Field | Value |
|---|---|
| WI | CASE-BOX-PERSISTENCE Phase A1 plan review |
| Kind | review-plan |
| Path 1 attempt | FAILED |
| Path 1 job ID | `review-plan-mpex4pe8-gr8c50` |
| Path 1 error class | TIMEOUT (`spawnSync codex ETIMEDOUT`) |
| Path 1 retrievable | YES (the failed job is recorded in cc-suite state.json) |
| Retry attempt | none (CCSUITE-02 retry policy did not yet exist) |
| Fallback path | Path 2 direct MCP |
| Path 2 threadId | `019e48a6-2980-7fb2-a64a-c4c321ff0eab` |
| Path 2 retrievable via `/cc-suite:status` | NO (Path 2 doesn't register a job) |
| Final verdict | READY TO BUILD |
| Resolution commit | `3a9e06c` (A1 reviewed plan) |
| Root cause | Large multi-round prompt: full plan + parent plan + 8 ADRs + multiple contract source files at `effort: high`. Codex ran out of budget. |

### 2026-05-21 — A2 review-plan round 1

| Field | Value |
|---|---|
| WI | CASE-BOX-PERSISTENCE Phase A2 plan review |
| Kind | review-plan |
| Path 1 attempt | FAILED |
| Path 1 job ID | `review-plan-mpfb4bti-jca7a2` |
| Path 1 error class | TIMEOUT (`spawnSync codex ETIMEDOUT`) |
| Path 1 retrievable | YES |
| Retry attempt | none (CCSUITE-02 retry policy did not yet exist) |
| Fallback path | Path 2 direct MCP |
| Path 2 threadId (round 1) | `019e4a0b-1d22-78a0-92ee-f0e900c1c1ea` |
| Path 2 threadId (round 2) | `019e4a11-dda3-7612-af21-49856e8b3f44` |
| Path 2 retrievable via `/cc-suite:status` | NO |
| Final verdict | READY TO BUILD (after one revision round) |
| Resolution commit | `afaceea` (A2 reviewed plan) |
| Root cause | Same as A1: too-wide prompt with multiple ADRs + contract sources + sibling implementation files. Path 1 always failed at the FIRST attempt for this WI. |

### Pattern observed

Both retrospective failures share:

- Same WI kind: `review-plan` (NOT `audit` or `verify`).
- Same prompt shape: substantive plan file + parent plan file + 5-10 supporting ADRs + contract source files + sibling implementation files.
- Same effort: `high`.
- Same error: `spawnSync codex ETIMEDOUT` at the runner's 30-minute boundary.

`audit` and `verify` runs in the same period did NOT time out. Hypothesis: audits work because the scope is the CHANGES (a small diff) and the prompt is bounded; review-plan ranges over the plan + history + supporting docs, which inflates the context budget unpredictably.

Action implemented in CCSUITE-02: split the review-plan prompt into a compact packet so the second attempt fits in budget. See `.claude/rules/cc-suite.md` §"Review packet" + §"Retry policy".

---

## Live entries (post-CCSUITE-02)

Add new entries below as failures occur. Each entry MUST include the 11 fields from the retrospective tables (WI, kind, Path 1 outcome, job ID, error class, retrievability, retry attempts, fallback path used + threadId if Path 2, final verdict, resolution commit, root cause analysis).

When the retry policy succeeds on the second attempt (compact packet), record both attempts in one row so the table shows the policy working.

When a new error class is observed (anything not in the §"Error class taxonomy" table above), append the class definition there first, then log the entry.

(no entries yet)
