# Gate 15 — Rollback Procedure Dry-Run (committed-rollback, disposable target)

**Status:** rollback dry-run **PASS**. **Gate 15 stays `PARTIAL`** (enriched with the dry-run evidence marker — a rollback dry-run is not a go-live sign-off, and dependent gates remain unresolved). This is **NOT** a clearance of gates 12/14/18, does **NOT** imply gate 7 cleared, and is **NOT** a go-live decision. **Date:** 2026-07-07. **Author:** Claude Code (WI-RELEASE-G15-ROLLBACK-DRY-RUN-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `be8bf50f…`, PR #200 merge `5fbde63`), review `dev-memo/run/reviews/queue-review-150.md`.

Mechanism under test: the committed-rollback policy `dev-memo/rollback-00.md` §3 — **`git revert`, NEVER `git reset`**. Environment of record: git version 2.53.0 · Darwin 24.6.0 (macOS 15.6.1) · 2026-07-07 · `CURRENT_SCHEMA_VERSION = 12`. Disposable/fixture only — no real user data.

---

## 1. Rollback target
A **disposable, non-critical scratch commit** created solely for this dry-run: a docs-shaped file `dev-memo/g15-dry-run-scratch.md` committed on the temporary branch only. It is NOT a persistence/schema/contract/security artifact and NOT real user data. The full committed-rollback path (`rollback-00.md` §3) is exercised against it.

## 2. Temp branch name
`dry-run/g15-rollback-scratch` — cut from `main`, used only for the dry-run, **deleted afterward** (never pushed, never merged).

## 3. Before/after `main` HEAD proof
- `main` HEAD **BEFORE**: `99d793599ac918abc83725b82c58791663fb28af`
- `main` HEAD **AFTER**: `99d793599ac918abc83725b82c58791663fb28af`
- **Identical** → `main` was not mutated by the dry-run. `main` was never checked out for mutation; all work happened on the temp branch.

## 4. Scratch-commit isolation proof (target existed ONLY on the temp branch)
- Scratch commit: `4b74c913344e42bf8862e14ca2f7851d950ae22f`
- `git log main..dry-run/g15-rollback-scratch --oneline` → shows only `4b74c91 test(g15-dry-run): disposable scratch target (temp branch only)`.
- `git branch --contains 4b74c91…` → lists only `dry-run/g15-rollback-scratch`.
- After cleanup: `git branch --contains 4b74c91…` → **empty** (**not contained by any branch**; the scratch + revert commits are no longer referenced by any branch — deleted-branch reflog objects may linger until garbage collection, but they are unreachable from every branch). Confirms the target never reached `main`.

## 5. Exact commands run
```
BEFORE=$(git rev-parse main)                       # 99d7935…
git checkout -b dry-run/g15-rollback-scratch main
#  … write dev-memo/g15-dry-run-scratch.md (disposable) …
git add dev-memo/g15-dry-run-scratch.md
git commit -m "test(g15-dry-run): disposable scratch target (temp branch only)"   # -> 4b74c91
git log main..dry-run/g15-rollback-scratch --oneline
git branch --contains 4b74c91
git revert --no-edit 4b74c91                        # committed rollback (§3) -> 3936645
git diff main dry-run/g15-rollback-scratch --stat   # EMPTY (tree restored)
git status --short
git checkout release-g15-rollback-dry-run-exec
AFTER=$(git rev-parse main)                          # 99d7935… (== BEFORE)
git branch -D dry-run/g15-rollback-scratch           # cleanup (was 3936645)
git branch --contains 4b74c91                         # empty -> unreachable
```
No `git reset` (any mode), no `git push`, no `git merge`, no `git clean`, no real-data operation was used.

## 6. `git revert` result
`git revert --no-edit 4b74c91` produced a **new revert commit** `3936645402dfb0d9b798283eec444142202c8268` on the temp branch: **`1 file changed, 5 deletions(-)` — `delete mode 100644 dev-memo/g15-dry-run-scratch.md`**. Applied **cleanly, no conflict**. History preserved (the scratch commit + its revert both remain visible in the temp branch's log until the branch is deleted), exactly as `rollback-00.md` §3 requires (`git revert` produces a new commit; `git reset` would have silently rewritten history — forbidden).

## 7. Checks run after revert
- Revert applied with **no conflict**.
- Scratch file **absent** after revert (`[ -f dev-memo/g15-dry-run-scratch.md ]` → NO).
- `git diff main dry-run/g15-rollback-scratch --stat` → **EMPTY**: the temp branch **tracked tree** (scratch commit + its revert) is **byte-identical to `main`'s tracked tree** — the revert restored the exact pre-target state.
- `git status --short` on the temp branch → **no tracked changes** (only pre-existing untracked residue present).

## 8. Working-tree proof after cleanup
- Temp branch `dry-run/g15-rollback-scratch` **deleted** (`Deleted branch … (was 3936645)`).
- `git branch --list 'dry-run/g15-rollback-scratch'` → empty (branch gone).
- Scratch file `dev-memo/g15-dry-run-scratch.md` **not present** on the exec branch / `main`.
- Exec-branch working tree: no tracked changes from the dry-run (only pre-existing untracked residue remains).

## 9. PASS / FAIL conclusion
**PASS.** All criteria hold: (a) `git revert` applied cleanly with no conflict; (b) the reverted tree matches the pre-target state (`git diff main..temp` empty; scratch file gone); (c) `main` HEAD unchanged before/after (`99d7935…` == `99d7935…`); (d) the temp branch was deleted and never pushed/merged; (e) no `git reset` (or any forbidden command) was used. The committed-rollback mechanism (`rollback-00.md` §3) is demonstrated to work end-to-end on a disposable target without touching `main`.

## 10. Residual risks / follow-up WIs
- **Merge-commit / range reverts**: reverting a *merge* commit needs `git revert -m <parent>`, and reverting a multi-commit range needs range handling; this dry-run exercised a single non-merge commit. Documented as a known variant, out of scope here (a real merge-revert would follow the same §3 discipline with `-m`).
- **Dependent-commit conflicts**: reverting a commit that a *later* commit depends on can conflict; the disposable-scratch target deliberately avoids this. A real rollback of a depended-upon commit would resolve conflicts via fix-forward or a follow-up revert (never `git reset`).
- **High-risk revert recording**: reverting a real cc-suite-recorded high-risk WI additionally requires the `rollback-00.md` §6 7-field rollback recording in the revert commit message — noted, not exercised here (the scratch target is not a recorded high-risk WI).
- No source/product follow-up WI is required; these are documentary notes.

## 11. How the result feeds gate 15 without clearing unrelated gates
A PASS supplies the "dry-run rollback of a non-critical artifact" evidence the gate-15 row asks for. Per the governed WI (requirement 9), the gate-15 status uses the readiness report's **existing** vocabulary and is **kept `PARTIAL`**, enriched with a `[Δ] rollback dry-run PASS` marker (roll-up bucket unchanged) — a `PARTIAL → CLEARED` move is NOT made here (it belongs to a holistic readiness-refresh lane). This certification:
- does **NOT** clear **gate 12** (audit-chain operational recovery — separately governed);
- does **NOT** clear **gate 14** (backup+recovery — related recovery surface, CITED as supporting context) or **gate 18** (export/backup-format — CITED as supporting context);
- does **NOT** imply **gate 7** cleared (robustness stays user-decision-dependent, D-G7-1/D-G7-2);
- defers **gate 6** (full-project audit) to later;
- keeps **go-live independence**: a rollback dry-run is not a go-live sign-off. The final GO/NO-GO and the STOP-AND-ASK hard-stops (gate 4 signing/distribution, gate 11 律师法, gate 17 license/business, gate 21 final sign-off) remain the user's.
