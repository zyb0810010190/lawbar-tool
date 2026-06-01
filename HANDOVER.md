# Handover & implementation plan

This is the operator's guide to the multi-agent autonomous-batch scaffold. It explains what
exists, how to stand it up, how to run it, and what is deliberately left to build later.

---

## 1. What this system is

A Claude Code configuration that lets Claude + Codex (+ Gemini) work a pre-authorized queue
of Work Items autonomously: Claude plans/implements, Codex reviews/audits, each WI commits,
and the agent advances to the next queued WI. You study the results after via echo-sleuth,
rather than approving each commit beforehand. Safety comes from a governed queue, mechanical
commit guards, and a revertable per-WI audit trail.

Authority model (three planes):
- **Promotion** — the human enables tools/raises autonomy, on observed need.
- **Invocation** — the Work Item type decides which tools run.
- **Enforcement** — a hook fires only where a concrete tool-call event makes it mechanical.

---

## 2. File map (canonical artifacts)

```
AGENTS.md                     project contract — invariants, source hierarchy, gates,
                              commit policy, autonomy policy, queue governance
.claude/skills/workflow/SKILL.md   executable WI lifecycle + delegation chain + UI lane
.claude/settings.json         plugin enablement + hook wiring
.claude/hooks/
  block-git-add-all.sh        deny broad staging (PreToolUse Bash)
  block-commit-stage-all.sh   deny commit -a family (PreToolUse Bash)
  batch-commit-guard.sh       enforce breaker/audit-due/risk/queue (PreToolUse Bash)
  protect-run-control.sh      block direct edits to authority files (PreToolUse Write/Edit)
scripts/workflow/
  check-queue.sh              queue lint → writes queue.linted (full 10-field contract)
  mark-queue-reviewed.sh      records Codex PASS → writes queue.reviewed (strict verdict)
  govern-queue.sh             writes queue.governed (requires linted + reviewed)
dev-memo/run/
  config                      AUTO_ADVANCE_MAX, BATCH_AUDIT_EVERY
  queue.md / queue.example.md the task list / template
  forbidden-paths.txt         denylist for queue lint
  README.md                   operator guide + authority map
  log.md                      append-only audit trail
BATCH-AUDIT.md                batch-audit checklist + echo-sleuth study packet
UI-GATES.md                   UI gate specs + honest a11y coverage caveat
UI-LANE-INSTALL.md            UI plugin install + trust notes
PLUGIN-GOVERNANCE.md          per-plugin posture; three control planes
settings.local.example.json   per-repo promotion overlay
```

---

## 3. One-time provisioning (run once per machine/repo)

1. Install plugins: `claude plugin marketplace add xiaolai/claude-plugin-marketplace`,
   then `claude plugin install cc-suite@xiaolai --scope project` (+ echo-sleuth). Confirm
   with `claude plugin list`.
2. `chmod +x .claude/hooks/*.sh scripts/workflow/*.sh`.
3. `/cc-suite:init`, then `/cc-suite:status` until green. For Codex delegation: mark the
   project trusted and set `[features] plugin_hooks = true` in `~/.codex/config.toml`.
4. Confirm hooks registered: `/hooks`. Confirm skill resolves: `/workflow`.
5. For UI repos only: enable UI plugins via `.claude/settings.local.json` (see example) and
   wire `npm run test:visual / test:a11y / test:lighthouse` into `check-gates.sh`.

If any step's tool/command differs from this doc, trust the tool — `claude plugin list`,
`/help`, and `/cc-suite:status` are authoritative over this file.

---

## 3a. Maintenance / refresh between batches

Plugin marketplace updates and plugin installs are provisioning/maintenance actions, NOT part
of the autonomous WI workflow. Do not run `claude plugin marketplace update`, install plugins,
or change enabled-plugin state during an active batch — that mutates the toolchain while the
run is executing (new hooks could appear, a plugin version could shift), so the run you
authorized is no longer the run that's executing. This is the same class of risk as
self-authorizing the next task: the agent must not alter its own enforcement surface mid-run.

If a refresh is needed, do it deliberately **between batches** (never scheduled, never
automated — a deliberate human act):
```bash
claude plugin marketplace update
claude plugin list
/cc-suite:status
/hooks
```
Then review what changed before governing the next queue. Promote dormant plugins only on
observed need — e.g. enable the UI plugins when a UI WI is about to be queued AND the Design
artifact gate exists; enable `loc-guardian` only after oversized-file drift actually appears.
Keep `cc-suite` + `echo-sleuth` as the only always-on core.

---

## 4. Running a batch

1. Write the WIs you authorize into `dev-memo/run/queue.md` (copy blocks from
   `queue.example.md`; full 10-field contract required, or lint rejects them).
2. Lint: `scripts/workflow/check-queue.sh` → writes `queue.linted` on pass.
3. Codex review: `/review-plan`; save the result to a file containing the exact line
   `QUEUE_REVIEW_VERDICT=PASS`; then `mark-queue-reviewed.sh <that-file>` → `queue.reviewed`.
4. Govern: `govern-queue.sh` → writes `queue.governed` (requires both).
5. Record the batch start: `git rev-parse HEAD > dev-memo/run/batch-start`.
6. Set mode in `config`: `AUTO_ADVANCE_MAX=1` gated · `3` canary · `10` full.
7. Start the run. Each WI: gates → Codex review/audit/verify → exact-path commit → log entry
   → advance. Stops on empty queue, Codex FAIL, gate failure, risk flag, breaker, or audit-due.
8. After the batch: run the batch audit (`BATCH-AUDIT.md`) + echo-sleuth study packet; record
   new HEAD in `last-batch-audit` to reset the count.

---

## 5. The Claude Design UI gate (your "design first" requirement)

Claude Design cannot be a hook (it is a separate Anthropic Labs product; no Claude Code event
marks "UI work started"). Enforce "design first" as a **WI-level precondition** instead:

- A WI whose `Type: UI` must include a non-empty `Design artifact:` field referencing the
  Claude Design output (a link or a saved export path).
- `check-queue.sh` should reject a `UI` WI that lacks `Design artifact:`, so a UI task cannot
  enter the governed queue until the design exists.
- The UI lane in SKILL.md then runs: Claude Design → frontend-design → ui-responsive +
  ui-tokenize → UI gates → Codex audit → commit.

Status: NOT yet built. This is the first recommended build (see §7).

---

## 6. Enforcement reality (honest scope)

- The four PreToolUse hooks are real mechanical enforcement for a cooperative agent, plus the
  write-guard blocks the obvious tamper path. It is NOT a tamper-proof sandbox — an agent
  running arbitrary bash could still write these files. For a firmer boundary, run with
  OS-level write protection on `dev-memo/run/` outside the agent's reach.
- The queue/breaker/audit limits are git-derived and hook-checked at commit time; the
  workflow lifecycle steps (baseline, scope, study packet) are agent-followed, not enforced.
- UI a11y gates catch a partial fraction of WCAG issues (see UI-GATES.md) — a regression
  floor, not certification.

---

## 7. Build backlog (deferred by design — promote on observed need)

In priority order, but none required before a first canary:
1. **Claude Design UI gate** (§5) — small; do this if you start UI work.
2. **Mechanical risk-flag detector** — auto-create `risk.flag` from diff size / new deps /
   file count, so Layer-C triggers don't depend on the agent noticing.
3. **batch-active edit lock** — block `queue.md` edits mid-run except by queue scripts.
4. **run-batch-audit.sh** — generate a persisted audit artifact; have the guard require it
   before clearing `last-batch-audit`.
5. **UI npm gate wiring** — make UI-GATES.md real gates, not just a spec.
6. **SKILL.md split** — if it keeps growing past ~50 lines and adherence slips.

The rule: build each only when running the system shows you actually need it. This list is
the menu, not the order of operations — observed friction decides.

### Sequencing (when you start building a real project)

Not "all UI first" or "all UI last." Design early, build vertical slices, polish late:
1. Skeleton first — repo scaffold, test runner, gate script, cc-suite status, app shell.
2. Design direction early — for any UI, a Claude Design artifact before the UI WI is queued.
3. Vertical slices — each feature WI carries UI + backend + tests together, not layer-by-layer.
4. Polish late — responsive, a11y, visual-regression, Lighthouse as a final hardening pass.

### Scope of autonomy (important)

This system automates **bounded governed batches**, not open-ended project completion. It may
work a 3-WI batch, then a 10-WI batch, then a large project as many governed batches. It must
NOT invent the remaining project plan, self-authorize its own newly-invented queue, run
indefinitely until it "thinks" the project is done, or push without explicit authorization.
The safe "until done" loop is: PLAN WI proposes a backlog → lint → Codex PASS artifact →
govern → run batch → batch audit + study packet → govern next batch → repeat until the
human's completion criteria are met.

### Open decisions for you (recorded so they aren't lost)

- **Forbidden paths policy:** `forbidden-paths.txt` currently rejects migrations/infra-prod/
  secrets outright in queue lint. Decide: "never in autonomous batches" (current) vs "allowed
  only with a special risk flag + human approval" (needs a lint change). Left as-is until you
  decide.
- **UI WI type:** `UI` is intentionally NOT an allowed `Type` yet — UI WIs are refused until
  the Design gate (§5) exists. Safe default, not a bug. Adding `UI` + the `Design artifact:`
  requirement is one combined build, done when you start UI work.

---

## 8. What next

Run a canary batch of 3 low-stakes WIs. That produces information no further paper review can:
where the real friction is, which deferred item above matters first. Stop auditing on paper;
let observed failure drive the next change.
