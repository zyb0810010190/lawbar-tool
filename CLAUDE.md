# lawbar-tool — working rules

Repo-specific. Facts here are load-bearing and each was verified; where a claim can go
stale, the way to re-check it is given. Nothing in this file is enforced by a hook.

## What this is

A macOS-only, local-first, offline-first Electron desktop case-management app for a
single practising litigator. **Court-facing**: the audit chain is tamper-evidence a
court may be asked to rely on, so "the tests pass" is not the standard — "the claim the
tool makes about itself is true" is.

## Prerequisites

- **macOS.** The product is macOS-only; the release scripts assume it, and system `bash`
  is 3.2 — no bash 4+ syntax (no `BASH_XTRACEFD`, no associative arrays).
- **Node 22–25** (`engines` in `apps/lawbar-desktop/package.json`). Node 26+ is refused.
- Tests are `node:test` + `node:assert/strict`, ESM `.mjs`. No jest/vitest, no mocking
  library, no coverage tooling — do not add one without asking.
- Xcode Command Line Tools for anything touching signing (`codesign`, `spctl`, `xcrun`).

## Build and run

```bash
npm --prefix apps/lawbar-desktop run build      # tsc + copy renderer assets
npm --prefix apps/lawbar-desktop run dev        # build, then launch Electron
npm --prefix apps/lawbar-desktop run dist       # unsigned local .app
npm --prefix apps/lawbar-desktop run dist:release   # signed + notarized (gated by preflight)
npm --prefix apps/lawbar-desktop run verify:signing         # gate: 0 only if release-ready
npm --prefix apps/lawbar-desktop run verify:signing:report  # diagnostic: always exits 0
npm --prefix apps/lawbar-desktop run bootstrap  # rebuild internal packages + repack tarballs
```

Run one lane with `npm --prefix <package> test`; run the gated set with
`/tdd-guardian:gate commit`.

## What lives where

| Path | Holds |
|---|---|
| `apps/lawbar-desktop/` | Electron main + preload + renderer, release scripts, the desktop test lane |
| `apps/lawbar-desktop/renderer/` | UI: `router.ts`, `screens/`, `i18n/`, `theme/` |
| `services/case-box-persistence/` | better-sqlite3 store, the audit chain, in-memory twin for parity |
| `docs/contracts/case-box-contract/` | Shared DTOs, validators, state machine, audit-log contract |
| `services/ocr-*` | OCR ingestion, review, worker and persistence |
| `docs/product/` | `product-plan.md` (forward work) and `product-definition.md` (what it is) |
| `docs/adr/`, `docs/release/` | Decision records and gate reports — historical, banner-marked |
| `scripts/docs/`, `scripts/workflow/` | Repo-wide guards: reference ratchet, tarball drift |

## Hard stops — require explicit, per-instance authorization

These are not defaults to be inferred from context. Approval for one instance never
carries to the next.

- **`git push`, PR creation, merge, branch deletion.** Ask every time.
- **`git add .` / `git add -A`.** Explicit paths only.
- **`git reset --hard`.** Use `git revert`.
- **Real client material.** Never enters the repo, never leaves the machine, never goes
  to a subagent or an external service. Real documents are read in place and referred to
  in anything committed by anonymous `DOC-nn` identifiers.
- **`~/.lawbar-a07-key` and any `.env`.** Never read, print, echo, or commit.
- **The audit-chain mechanism.** Never remove it. It is the product's court-facing claim.

## Routing consequential decisions to Codex

When a decision is genuinely consequential — architecture, approach, a trade-off with
lasting cost — include an option to route it to Codex: *"Let Codex weigh in — deliberate,
then recommend."*

- **Not at every branch point.** Skip it for questions of fact, trivial preferences, and
  choices with an obvious default. Offering deliberation on an observation is noise, and
  it trains the reader to ignore the offer when it matters.
- **On selection**: consult Codex via cc-suite, deliberate — *do not defer blindly, Codex
  can be wrong* — then proceed with the synthesized best option, or return a sharper
  recommendation if it is still close.
- **Skip when no real Codex integration is reachable.** Say so plainly instead of
  offering a dead option.

**Current reachability — REACHABLE, corrected 2026-08-22 after proving it.** An earlier
draft of this file said the route was dead because cc-suite is not initialised here. That
was wrong. The runner works invoked by absolute path, with no initialisation:

```bash
bash ~/.claude/plugins/cache/xiaolai/cc-suite/2.0.0/scripts/codex-preflight.sh   # model list first
node ~/.claude/plugins/cache/xiaolai/cc-suite/2.0.0/scripts/codex-runner.mjs \
  --kind audit --model gpt-5.5 --effort high --sandbox read-only --timeout-ms 600000 -- '<prompt>'
```

Verified end to end on 2026-08-22: a 9-dimension audit returned two genuine High findings.
Three constraints that are easy to get wrong:

- **Never guess a model slug.** `gpt-5.1-codex-max` and `gpt-5.2-codex` are both rejected on
  a ChatGPT account. Run the preflight; on 2026-08-22 the usable set was `gpt-5.5` (default),
  `gpt-5.4`, `gpt-5.4-mini`, `codex-auto-review`.
- **Inline the diff.** Pointing Codex at the tree times out in this repo; paste the unified
  diff plus the relevant whole functions so it never walks the filesystem.
- **Gate what you transmit.** Run the candidate text through `check-no-real-data`'s PATTERNS
  before sending. The MCP bridge is a separate matter and is currently disconnected;
  `/cc-suite:init` is still a structural change needing its own authorization.

When the route is unreachable but the decision is still consequential, substitute a
different independent head — a fresh subagent with no conversation context, or an
adversarial pass — and say which was used.

## Enforcement posture

**Hooks are advisory, not a boundary.** They were deleted twice after an audit found them
bypassable string-matchers running in the same uid as the thing they gate. Never cite a
hook result, marker, or token as proof of anything. **CI is the only enforcement
boundary.** Local gates are visibility.

## Traps specific to this repo

- **Committed tarballs.** `case-box-contract` and `case-box-persistence` reach the desktop
  app as *committed tarballs*, not as live source. Editing their source and passing their
  lanes proves nothing about the shipped app. After any change to either, run
  `npm --prefix apps/lawbar-desktop run check:internal-tarballs`; on drift,
  `pack:internal && refresh:internal-tarballs && npm install`, then confirm the change is
  actually present under `node_modules/`. This has fired more than once.
- **The `desktop` lane is GREEN as of 2026-08-23** — 1106 tests, 0 failures. It was described
  here for a long time as KNOWN RED with "one deliberate permanent failure" in
  `apps/lawbar-desktop/tests/smoke.electron.test.mjs`, called environmental, a selector timeout.
  **That was wrong, and the label is why nobody looked.** The Electron tests launched with no
  `--user-data-dir`, so the app resolved the REAL profile at
  `~/Library/Application Support/lawbar` — the litigator's live case store. The first test waits
  for the matter-list EMPTY-state marker; a real profile has matters; the marker never appeared.
  CI passed because a fresh runner has no profile.
  So every local `npm test` was opening, and — via applySchema and `journal_mode = WAL` —
  WRITING the privileged case database, including the audit-chain tables. The chain was checked
  on a forensic copy when this was found and verified intact.
  All four Electron tests now go through `launchIsolated()`, which gives each run a temp profile
  and **refuses to proceed if the resolved path is the real one**. The lesson worth keeping:
  a red that gets a name stops being investigated. "Known" is not the same as "understood".
- **`scripts.test` is a hand-maintained file list.** A new `tests/*.test.mjs` not appended
  there never runs — it looks like coverage and provides none. Three files are already in
  that state.
- **No coverage tooling exists** in any manifest, and none can measure a shell script.
  All thresholds are 0 deliberately; a number that is unmeasurable rather than merely
  unmet trains people to ignore the gate.

## Verification discipline

The recurring failure mode in this repo is not wrong code — the lanes catch that. It is
**a claim that is true at the headline and wrong in its scope**, and **a test that cannot
fail**. Both survive a green suite.

- **Two-sided verification.** Before editing, preserve the current source outside the repo
  and record its `sha256`. Afterwards, run the suite against that baseline: every test
  claiming to be a regression test **must fail there**. One that passes both ways is not
  testing the change. Where no such seam exists yet, building it is part of the work.
- **Coverage is not adequacy.** Measured here: 100% line coverage still missed 2 of 18
  mutants, both real gaps.
- **Agent output is evidence, not verdict.** Spot-verify every claim that drives an edit,
  a severity rating, or a decision.
- **Separate what you verified from what you asserted.** When reporting, say which is
  which. Most errors here live in the second category.

## Before saying a task is done

`/tdd-guardian:gate commit` · `npm --prefix apps/lawbar-desktop run check:no-real-data:all`
· `node scripts/docs/check-doc-references.mjs` · `check:internal-tarballs` if either
internal package changed. Then state what changed, what was deliberately **not** changed,
and what needs a decision — writing "none" rather than inventing one.
