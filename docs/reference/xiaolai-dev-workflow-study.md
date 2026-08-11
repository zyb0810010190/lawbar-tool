# The xiaolai Software-Development Workflow — A Study for Replication

*Reconstructed from open-source materials: `xiaolai/vmark/.claude/` (the project instance) and the six marketplace plugins (`cc-suite`, `tdd-guardian`, `docs-guardian`, `loc-guardian`, `grill`, `echo-sleuth`) plus `init-workspace`. Verified by reading plugin source, not from memory.*

---

## 0. Orientation — where everything lives

| Layer | Repo / path | Role in the process |
|---|---|---|
| **Marketplace** | `xiaolai/claude-plugin-marketplace` | Index of all plugins; `claude plugin marketplace add xiaolai/...` |
| **Engine / bridge** | `xiaolai/cc-suite` | Multi-tool bridge (Claude↔Codex↔Gemini), cross-model delegation + audit, advisor agents, stop-time review gate |
| **TDD enforcement** | `xiaolai/tdd-guardian-for-claude` | 6-agent test-first pipeline + commit-time gate |
| **Docs enforcement** | `xiaolai/docs-guardian-for-claude` | Blocks commits when docs lag source; 5 doc agents |
| **Size enforcement** | `xiaolai/loc-guardian-for-claude` | Per-file LOC ceilings + extraction plans (advisory) |
| **Deep review** | `xiaolai/grill-for-claude` | 6 parallel review agents, 5 styles incl. "Paranoid Mode" |
| **Memory** | `xiaolai/echo-sleuth-for-claude` (+ `cccmemory`) | Mines past sessions for decisions/mistakes/values |
| **Scaffolding** | `xiaolai/init-workspace` | Creates the shared `AGENTS.md` + `.claude/.codex/.gemini` tree |
| **Project instance** | `xiaolai/vmark/.claude/` | Where the above are *composed* into one project: rules, the 9-agent `/feature-workflow`, the autonomous `/fix-issue`, and config that turns each guardian on/off |

**Key structural fact:** the *methodology* is split across two places. The reusable machinery is in the plugins; the project-specific orchestration (`/feature-workflow`, `/fix-issue`, the `rules/*.md`, which guardians are enabled and at what strictness) lives in `vmark/.claude/`. To replicate, you take the plugins as-is and write your own thin `.claude/` instance on top.

---

## 1. The single source of truth: `AGENTS.md`

The foundation is the cross-tool instruction file. `init-workspace` and `cc-suite` both build the same pattern:

- `AGENTS.md` holds all project instructions (it is Codex's native format).
- `CLAUDE.md` and `GEMINI.md` become one-line `@AGENTS.md` imports.
- Skills are symlinked (`.agents/skills/ → .claude/skills/`) so all three tools see the same capabilities.
- Hooks and MCP servers are mirrored from `.claude/settings.json` into `.codex/`.

**Mechanism it beats:** the default is three drifting instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) maintained by hand. Single-source + import collapses three maintenance points to one. This is the cheapest, highest-leverage thing to copy first, even if you adopt nothing else.

---

## 2. The end-to-end lifecycle

Reconstructed by tracing the commands and skills. Each stage names the concrete artifact that drives it.

### Stage A — Scaffold
`init-workspace` (or `/cc-suite:init`) creates the directory tree, the `AGENTS.md` bridge, the MCP registrations, and per-guardian config. Idempotent — safe to re-run. **One question it forces you to answer:** keep AI config private (gitignored) or public (committed, team-shared). The recommended default is public, so the workflow itself is version-controlled.

### Stage B — Plan
`cc-suite`'s `claude-plan` skill (or vmark's `planner` agent) produces a numbered plan: each step lists *what to do*, *exact file paths*, *interfaces/data structures*, *dependencies on prior steps*, and ends with **risk areas, open questions, and recommended test scenarios**. Planning is explicitly *read-only* — no code is written. vmark's `planning` skill splits this into `quick-plan` (3–8 work items) vs `full-plan` (migrations / API / multi-phase).

### Stage C — Design tests (before implementation)
`tdd-guardian`'s `tdd-test-designer` writes the test cases from the plan *first*. There is a quality gate here: the design step rejects "wiring-only" tests (tests that assert nothing real) with up to 2 retries. This is the test-first discipline made mechanical.

### Stage D — Implement, per work item
`tdd-guardian-workflow` extracts work items (`### WI-N:`) and implements them one at a time. Each returns `DONE` / `FAILED-VERIFICATION` (one retry) / `BLOCKED` (stop immediately, do not attempt later items). Only the `implementer` agent has write access. The workflow **never runs `git commit` itself** — "getting the gates green is the workflow's job; committing is the human's decision."

### Stage E — Coverage + mutation gates
`/tdd-guardian:audit-coverage` then (optionally) `/tdd-guardian:audit-mutation`. The pipeline **halts at the first gate failure** and does not cascade. Config ships with 100% line/function/branch/statement thresholds and an `absolute` coverage mode.

### Stage F — Deep review (`grill`)
`/grill:roast` launches 5–6 specialist agents in parallel — recon, architecture, error-handling, security, testing, edge-cases — in one of five styles (Architecture Review, Hard-Nosed Critique, Multi-Perspective Panel, ADR Style, **Paranoid Mode**), with optional pressure tests (scale stress, hidden costs, assumptions audit, etc.). Every finding *must* carry file:line, severity, and an effort estimate; output is a phased fix plan with a dependency graph.

### Stage G — Cross-model adversarial review (the real differentiator)
`cc-suite` registers Codex as an MCP server and Claude as one (via `claude-octopus`), enabling **bidirectional delegation**. The load-bearing piece is the **Stop hook** (`stop-review-gate-hook.mjs`): when Claude tries to end a session, the hook spawns *Codex* as an adversarial reviewer. Its prompt is explicit: *"The code was produced by a competing AI system — do not defer to it."* Codex must answer `ALLOW: <reason>` or `BLOCK: <reason>` on the first line; a `BLOCK` keeps Claude from stopping until the issues are addressed. Every delegation also carries a **provenance note** so the reviewing model applies full rigor instead of rubber-stamping a peer AI.

### Stage H — Docs + size guardians (at commit time)
`docs-guardian`'s `commit-guard.js` fires on `git commit/push` and checks that documentation was updated alongside source. `loc-guardian` flags files over their LOC ceiling and proposes extraction plans.

### Stage I — Memory
`echo-sleuth` / `cccmemory` index past sessions, extracting decisions, mistakes, and recurring patterns, and audit them for staleness. This is the institutional-memory loop — the project learns across sessions instead of re-deciding.

---

## 3. The advisor agents — "values over rules"

`cc-suite` ships persona agents that are consulted for *judgment*, not execution. They are read-only (`allowed_tools: [Read, Grep, Glob]`), budget-capped, and refuse to write code:

- **`north_star_advisor`** (Opus) — guards three principles verbatim: **Independence** (don't defer to consensus when the code disagrees), **Calibration** (match recommendations to *this* project's constraints, not industry medians — "with AI execution, what used to be expensive is now cheap"), **First principles** (name the mechanism by which a non-standard solution beats the standard). Consulted before architectural decisions or when scope drifts.
- **`deletion_advocate`** — finds code that can stop existing: dead code, stale abstractions, speculative features, duplicated logic, lying comments. Cites exact lines and import counts.
- Plus `simplicity_advocate`, `security_skeptic`, `clarity_reviewer`, `documentation_critic`.

> Note for you specifically: the `north_star_advisor` encodes the *same* three principles as your stated working preferences. The methodology and your operating style share a source — useful to know, because adopting this workflow will feel native, but also means its blind spots are *your* blind spots.

---

## 4. The honest assessment — what actually enforces vs. what merely advises

This is the single most important thing to understand before you copy anything, and it contradicts the marketing.

**The recurring pattern across every guardian: advisory-by-default, blocking opt-in.**

- `tdd-guardian/config.json` ships with `blockCommitWithoutFreshGate: false` and `enforceOnTaskCompleted: false`. The `pretool_guard.js` code path for a stale gate returns `permissionDecision: "allow"` with a ⚠ warning — it does **not** deny. To make it actually block a commit, you must set `blockCommitWithoutFreshGate: true`. The "strict / 100% coverage" framing is aspirational relative to the shipped switches.
- `docs-guardian/commit-guard.js` likewise emits `permissionDecision: "allow"` — it warns that docs are stale but lets the commit through.
- `loc-guardian` has **no hook at all** — it's a `/scan` command. Pure advisory.
- vmark's *local* TDD hooks (`gha-tdd-guard.mjs`, `multi-format-tdd-guard.mjs`) are the exception: they `exit 2` to genuinely block — but only a *structural* check (a sibling test file must *exist*; it needn't pass), scoped by regex to two feature areas, and fail-open on any script error.

**So the enforcement taxonomy is:**

| Strength | Mechanism | Examples |
|---|---|---|
| **Hard (cannot be ignored)** | `exit 2` PreToolUse hook; `permissionDecision: "deny"`; per-agent tool omission; Codex `BLOCK` on the Stop gate | vmark's 2 structural hooks; tdd-guardian *only if* you flip the config; the stop-review gate; read-only advisor agents |
| **Soft (model can ignore)** | `rules/*.md` text; agent role prompts; skill descriptions; any guardian left at its `allow`/warn default | most of vmark's surface; tdd/docs guardians as shipped |

The lesson: **this is a workflow optimized to guide a cooperative model and a present human, not to withstand an adversarial or careless one.** That's a legitimate, deliberate choice (it keeps the human un-obstructed), but if you replicate it naively you'll inherit guardrails that *look* enforcing and aren't. Decide per gate whether you need it to *advise* or to *stop* — and only the "stop" ones earn `exit 2` / `deny: true`.

---

## 5. Replication blueprint

A concrete order of operations to stand this up on your own project, with calibration notes.

1. **Scaffold.** `claude plugin marketplace add xiaolai/claude-plugin-marketplace`, then install `init-workspace` and run it. Choose **public** config so the workflow is version-controlled. You now have the `AGENTS.md` bridge + tree.
2. **Write `AGENTS.md` once.** Put your real constraints and conventions here. This is the highest-leverage file; everything else reads from it.
3. **Install `cc-suite` and run `/cc-suite:init`.** This gives you the bridge, Codex/Claude delegation, and the stop-review gate. *If you have a Codex CLI login*, enable the Stop gate — the cross-model adversarial review is the part of this system with the most genuine value, because a second model with a different training distribution catches what the first rationalizes.
4. **Install the guardians you actually want — then decide their teeth.** Install `tdd-guardian`; if you want real test discipline, set `blockCommitWithoutFreshGate: true` and pick honest coverage thresholds (100% is the shipped default but is often theater on a young codebase — calibrate to what you'll actually maintain). Install `docs-guardian` / `loc-guardian` only if those failure modes are real for you.
5. **Write your own thin orchestration in `.claude/`.** Copy vmark's pattern: a `/feature-workflow`-style command chaining least-privilege agents (planner read-only → implementer write → reviewer read-only → release-steward commit-only-on-explicit-ask). The separation of duties is real *because* of the per-agent `allowed_tools`, not because the prompts say so — so get the tool lists right.
6. **Add `grill` for periodic deep review** and `echo-sleuth` if you want cross-session memory. Both are additive, not on the critical path.
7. **Numbered rules** (`rules/00-...` through `60-...`) as auto-loaded soft constraints, with one explicit precedence rule. Treat these as documentation that the model usually follows — never as a security boundary.

**Calibration callouts (where I'd diverge from the defaults):**
- The 100% coverage default plus `block...: false` is the worst of both worlds — it sets an unmeetable bar *and* doesn't enforce it. Either lower the bar and enforce it, or keep it aspirational and label it as such. Don't ship the contradiction.
- Three guardians + two review layers + a stop gate is a lot of process for a solo project. The *minimum* viable version of this workflow is: single-source `AGENTS.md` + the cross-model stop gate + one real `exit 2` test-existence hook. Add the rest only when a specific failure mode bites you.
- The whole stack assumes you have *both* a Claude and a Codex (OpenAI) subscription. Without Codex, the single most valuable mechanism (Stage G) is unavailable, and you're left with mostly-advisory guardrails. Factor that cost in before committing to the architecture.

---

## 6. Limits of this study (what I have and haven't verified)

- **Read at source level:** the marketplace manifest; `cc-suite` README, `hooks.json`, the stop-review gate, the plan/implement/review skills, and the advisor agents; `tdd-guardian`'s `hooks.json`, `config.json`, `pretool_guard.js`, and the workflow command; `docs-guardian`'s hook + gate output; `loc-guardian` and `grill` and `init-workspace` structure + READMEs.
- **Not exhaustively read:** the full bodies of the 26 reference docs, `echo-sleuth`'s indexing internals, the Codex-side skill layouts, and `taskcompleted_gate.js` line-by-line.
- **Cannot verify from static source:** runtime behavior — whether vmark actually runs these guardians in its current commit, and whether the stop gate fires in practice (depends on a live Codex login). vmark's committed `tdd-guardian/state.json` was stale by ~3 months at last read, which is consistent with the guardian running in report-only mode.
- **Version caveat:** plugin versions read here are `cc-suite` 0.7.3, `tdd-guardian` 0.7.2, `grill` 1.3.0, `loc-guardian` 0.1.5. Claude Code's hook/skill/subagent surface ships weekly; confirm against the official docs before relying on any exit-code or event detail.

---

### Source repos
- Marketplace: https://github.com/xiaolai/claude-plugin-marketplace
- cc-suite: https://github.com/xiaolai/cc-suite
- tdd-guardian: https://github.com/xiaolai/tdd-guardian-for-claude
- docs-guardian: https://github.com/xiaolai/docs-guardian-for-claude
- loc-guardian: https://github.com/xiaolai/loc-guardian-for-claude
- grill: https://github.com/xiaolai/grill-for-claude
- echo-sleuth: https://github.com/xiaolai/echo-sleuth-for-claude
- init-workspace: https://github.com/xiaolai/init-workspace
- cccmemory: https://github.com/xiaolai/cccmemory
