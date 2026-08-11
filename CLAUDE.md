# CLAUDE.md

lawbar-tool — a macOS-only, local-first, court-facing legal desktop app for a single
practising litigator. Electron desktop (`apps/lawbar-desktop`), Node services (`services/*`),
a Swift/PDFKit evidence harness (`native/evidence-core-swift`), and a contract package
(`docs/contracts/case-box-contract`).

**Advisory only. Nothing here is enforced.** This repo has no hooks, no commit gates, and no
governance scripts — that layer was deliberately removed on 2026-08-10 after an audit found
its enforcement was substantially bypassable. What follows is knowledge, not a gate.

## Where authority lives

| Question | Answer lives in |
|---|---|
| What the product is, and the roadmap | `docs/product/project-requirements-brief.md` (Appendix A = target architecture) |
| Evidence-Genie M0 definition + invariants | `docs/product/evidence-m0-prd.md` |
| Why a technical decision was made | `docs/adr/**` — these **outrank** the brief on the decision each documents |
| Schemas and contracts | `docs/contracts/case-box-contract` (a real npm package, not documentation) |
| Working notes code still cites | `dev-memo/` — see its README for what survived the 2026-08-11 prune |

## Two things that are easy to get wrong here

**1. Real client data must never enter this repo.** The scanner
(`apps/lawbar-desktop/scripts/check-no-real-data.mjs`) runs in the desktop `pretest`, but it
is scoped — no `services/**` package runs it, new top-level directories are outside it, and
it matches regex classes rather than case facts in prose. A green scanner is not clearance.
The repo's history already contains identifiers from an earlier leak, scrubbed forward-only
and still present in pushed history. Anything reaching a commit is permanent.
→ `.claude/skills/client-data-preflight/`

**2. The desktop consumes `case-box-contract` as a committed tarball, not from source.** Edit
the contract without repacking and the desktop suite passes **green against stale code** —
locally and in CI. This is not hypothetical: the tarballs drifted 14 files behind source
between 2026-08-05 and 2026-08-11 before anyone noticed. Run `npm --prefix apps/lawbar-desktop
run bootstrap` after touching contract or persistence source.
→ `.claude/skills/contract-change-rebuild/`

Both are invoke-only skills. They run when called, never on commit, and block nothing.

## Working agreements

- Stage explicit paths. Never `git add -A` or `git add .`.
- Push, PR, merge, and branch deletion need the author's per-instance authorization.
- Never `git reset --hard`; prefer `git revert`.
- Real client material lives outside this repo, is read in place, and is never copied in,
  transmitted to an external service, or handed to a subagent. Refer to documents by
  anonymous `DOC-nn` identifiers in anything committed.
- A0.7 (renderer-conformance evidence gate) is **PROVISIONAL**, not green — four harness
  defects remain open and its marker tooling was removed with the governance layer. Do not
  describe it as passing.
