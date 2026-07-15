# WI-INTERNAL-PACKAGE-LOCK-REFRESH — Scope docket (prerequisite tooling)

**Status:** UNTRACKED pre-implementation scope docket. **NOT authorized for implementation** — requires its own
cc-suite `review-plan` approval and separate authorization to implement/commit. **Type:** SCAFFOLD / WORKFLOW
(packaging tooling), affects the checked-in internal-tarball + lockfile reconciliation path. **Branch context:**
`feature/pretrial-trial-addon-01` @ `a518609` (but this WI is repo-infrastructure, not the pre-trial feature).

**Purpose.** Establish and test a **sanctioned, deterministic** mechanism for reconciling the checked-in internal
`.tgz` tarballs (`apps/lawbar-desktop/dist-tarballs/{case-box-contract,case-box-persistence}-0.1.0.tgz`) with the
matching npm `package-lock.json` integrity records — so that after `pack:internal` regenerates a tarball, the two
internal-package lock-integrity entries can be refreshed **without** hand-editing the lockfile and **without** a
full-lock regeneration. This WI is a **prerequisite** for the deferred WI-PTA-03b desktop delivery (which cannot make
`check-internal-tarballs` green without it).

## Root-cause evidence (from a controlled reproduction, 2026-07-15)

Environment: node v24.14.0, npm 11.9.0. Reproduced in a `git worktree` clean checkout at `a518609` with an
**isolated npm cache**:

- After `pack:internal` regenerates the internal tarballs (new SHA due to content change + non-deterministic gzip),
  the documented `npm install` **does not refresh** the two `file:`-tarball integrity records in `package-lock.json`
  — the lock stays pinned to the pre-repack integrity (`Impz…`/`Yiz…`), a 0-line lock diff.
- `npm install --package-lock-only` → **no-op** (0 lock changes).
- `npm install ./dist-tarballs/<pkg>.tgz` (explicit) → **resolution error** (the packed persistence tarball's
  `pack:internal`-rewritten `case-box-contract@0.1.0` dep cannot resolve standalone).
- Removing `node_modules/case-box-*` then `npm install`: **`EINTEGRITY`** in a *polluted* cache (a stale cached
  artifact under the old integrity conflicts with the new on-disk tarball); in an *isolated* cache it "adds" the
  packages but **still does not refresh** the lock integrity.
- Net: **no plain sanctioned npm command refreshes the two internal-tarball integrity records after a repack**, in
  either a polluted or a clean isolated-cache environment. `check-internal-tarballs`'s own fix hint ("refresh the
  lock integrity, then `npm ci`") names a step with no corresponding automated command in the repo.

## Review packet (compact)

**Summary.** Diagnose npm's `file:`-tarball integrity behavior and provide a repository-owned, npm-supported,
deterministic command (wired into `bootstrap` + documented by `check-internal-tarballs`) that refreshes ONLY the two
internal-package lock-integrity records after `pack:internal`, with tests that prove no unrelated dependency
resolution can change silently.

**Essential references.** `apps/lawbar-desktop/scripts/pack-internal-packages.mjs`; `scripts/workflow/check-internal-tarballs.mjs`;
`apps/lawbar-desktop/package.json` (`bootstrap`/`pack:internal`/`postinstall`); `apps/lawbar-desktop/package-lock.json`;
`apps/lawbar-desktop/dist-tarballs/{*.tgz,manifest.json}`.

**Review questions.** (1) Is there an npm-supported mechanism (flag, `npm pkg`, `--install-links`, `overrides`,
targeted reinstall) that refreshes only the two `file:`-tarball integrity records deterministically? (2) If not, is a
repository-owned script that recomputes ONLY those two `integrity` fields from the on-disk tarballs (using npm's own
SRI algorithm) acceptable as "npm-supported behavior," or does that count as forbidden lockfile surgery? (3) Should
the internal `file:` deps even carry an `integrity` in the lock, or is there a supported config to omit it? (4) Are
the exclusions + test requirements sufficient to prevent silent dependency drift?

## Scope

* **Root-cause analysis** of npm's `EINTEGRITY` / no-refresh behavior for the local `.tgz` dependencies (build on
  the evidence above; identify the exact npm resolution path and why the lock is not updated).
* **A repository-owned refresh command.** RCA must first confirm whether any **documented npm CLI/config** path
  recomputes integrity for already-packed `file:` `.tgz` specs (note: `--install-links` applies to *directory*
  `file:` deps, not `.tgz`; `--package-lock-only` was proven a no-op here). **If — as the evidence strongly suggests
  — no npm-native command exists**, the sanctioned path is a **repository-owned script that recomputes SRI from the
  two on-disk tarballs using npm's own algorithm (the `ssri` library) and updates only their known lockfile records
  under a strict diff guard.** This is NOT ad-hoc textual surgery: it is a reviewed, tested, deliberately-adopted
  mechanism using the same SRI library npm uses. Do not label it "npm-supported" unless it is a documented CLI
  behavior; label the `ssri`-recompute path honestly as a repository-owned tool.
* **Isolated-cache behavior**: the command must work with a clean/isolated npm cache and must not depend on a
  polluted cache state.
* **Idempotence**: running the refresh twice yields no further change.
* **Cross-platform**: works on supported developer (macOS) and CI (Linux) environments.
* **Integration (exact placement).** `bootstrap` runs the explicit sequence `pack:internal` →
  `refresh-internal-lock-integrity` → `check:internal-tarballs`. The refresh MUST NOT run in `postinstall`, `npm ci`,
  or the `check-internal-tarballs` gate itself — those must continue to **fail** on a genuine tarball/lock mismatch,
  never auto-repair (auto-repair would hide broken drift from CI). Document the command in the `check-internal-tarballs`
  fix hint.
* **Tests (structural allowlist, not a text-diff count).** The refresh's lock diff MUST be constrained by a
  structural allowlist naming the exact JSON paths, package names, expected `resolved` file paths, and expected
  versions — covering BOTH `packages[...]` and any legacy `dependencies[...]` records for the two internal packages
  (lockfile shape can carry both). The ONLY permitted changed values are those packages' `integrity` fields; any
  other JSON path change (version, resolved, an unrelated dependency) fails the test. Also test the failure behavior
  when a tarball and its lock integrity disagree (clear, actionable error, not silent).
* **Migration (mechanically enforced separation)**: refresh the currently-stale `case-box-contract` and
  `case-box-persistence` lock/tarball records **only after** the tooling itself is reviewed + adopted. The migration
  is a **separate exact-path commit** *after* the tool + tests pass; an acceptance check MUST confirm the tooling
  implementation commit contains **no** unrelated package-payload changes and **no** WI-PTA-03b renderer/persistence
  changes.

## Explicit exclusions

* No renderer changes. * No audit-vocabulary changes. * No persistence source changes. * No dependency upgrades.
* No general npm modernization. * No weakening or bypassing of `EINTEGRITY`/SRI. * No implementing the remaining
WI-PTA-03b desktop work (renderer mappings, tarball payload refresh) — that resumes only after this tooling lands.
* **Deterministic packing is OUT of scope here** (gzip nondeterminism means every repack changes the tarball hash
  even when payload semantics are unchanged; making packing reproducible is a separate follow-up). Because of this,
  the refresh tool MUST validate tarball filename, package name, and version so nondeterministic bytes cannot become
  silent dependency drift — the refresh only ever updates `integrity` for a name/version-matched internal package.

## Acceptance criteria
A single documented, deterministic, npm-supported command (or reviewed repository-owned script) that, after
`pack:internal`, refreshes ONLY the two internal-package lock-integrity records; is idempotent + cross-platform +
isolated-cache-safe; makes `check-internal-tarballs` pass; and is covered by tests proving no unrelated
dependency-resolution change. The stale contract/persistence records are migrated only under a follow-up once the
tooling is adopted.

## Verification commands (for the eventual implementation)
`npm --prefix apps/lawbar-desktop run pack:internal` · the new refresh command ·
`npm --prefix apps/lawbar-desktop run check:internal-tarballs` · `git diff apps/lawbar-desktop/package-lock.json`
(scope check) · `bash scripts/workflow/check-gates.sh`.

## Relationship to WI-PTA-03b
WI-PTA-03b (deferred desktop delivery of the WI-PTA-03 audit vocabulary) is **blocked** on this WI: its class-A
contract-tarball refresh + class-B persistence-tarball reconciliation both require a working lock-integrity refresh.
WI-PTA-03b resumes only after this tooling is reviewed, adopted, and green.

## Review record (cc-suite review-plan)
- Job `review-plan-mrlryenf-a9cymo` (Path 1, gpt-5.5/high/read-only) — **verdict: PASS with revisions.** Findings +
  dispositions (all applied):
  - **High** — "npm-supported" underspecified (`--install-links` is directory-only; no npm-native `.tgz` integrity
    refresh) → **fixed**: docket now sanctions a repository-owned `ssri`-based SRI recompute (under a strict diff
    guard) as the expected path, labeled honestly as a repository-owned tool.
  - **Medium** — bootstrap integration could auto-normalize drift → **fixed**: exact placement (`pack:internal` →
    `refresh` → `check`); no auto-repair in `postinstall`/`npm ci`/the gate.
  - **Medium** — no-drift test must name every mutable field (packages[] + legacy dependencies[]) → **fixed**:
    structural allowlist required, not a text-diff count.
  - **Low** — tarball nondeterminism → **fixed**: added as an explicit non-goal; the refresh must validate
    name/version so nondeterminism ≠ drift.
  - **Low** — migration sequencing mechanically enforced → **fixed**: migration is a separate exact-path commit with
    an acceptance check for no unrelated payload/renderer/persistence changes.
- This docket remains a **pre-implementation plan**; the tooling is not built. Implementation + commit require
  separate authorization.
