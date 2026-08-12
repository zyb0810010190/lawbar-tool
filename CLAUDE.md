# CLAUDE.md

lawbar-tool — a macOS-only, local-first, court-facing legal desktop app for a single
practising litigator. Electron desktop (`apps/lawbar-desktop`), Node services (`services/*`),
a Swift/PDFKit evidence harness (`native/evidence-core-swift`), and a contract package
(`docs/contracts/case-box-contract`) consumed by services from source and by the desktop as a
committed tarball.

**Advisory. Nothing in `.claude/` enforces anything.** The hooks and governance scripts that
claimed to were removed on 2026-08-10, after an audit found their enforcement bypassable.
Real gates live in `.github/workflows/` — outside this process — and that is deliberate.

## Where authority lives

| Question | Answer |
|---|---|
| What the product is; how each screen behaves | `docs/product/product-definition.md` — Part I brief + architecture, Part II Evidence M0, Part III the 25 UI design artifacts |
| Work not yet built | `docs/product/product-plan.md` — release lane, night mode, forms T4, WeChat companion |
| Why a technical decision was made | `docs/adr/**` — **outranks** the definition on the decision it documents |
| Schemas and contracts | `docs/contracts/case-box-contract` — a real npm package, not documentation |
| Plans and closeouts for work already shipped | `dev-memo/` — records, not plans; cited by source 77 times. See its README |

## Config layout

Always loaded: this file, plus any `.claude/rules/*.md` whose `path:` glob matches a file in
play. Loaded only when invoked: `.claude/skills/*`. Secrets, if any are ever added, live in
`.env` (gitignored) and never in this file — it enters context every turn and gets screenshotted.

| Path-scoped rule | Fires when you touch | Guards against |
|---|---|---|
| `rules/services-privacy-scope.md` | `services/**` | The privacy scanner does not run there |
| `rules/contract-source.md` | `docs/contracts/case-box-contract/**` | Desktop testing green against a stale tarball |
| `rules/renderer-i18n.md` | `apps/lawbar-desktop/renderer/**` | Line-keyed i18n allowlist broken by any edit |
| `rules/evidence-harness.md` | `native/evidence-core-swift/**` | Calling A0.7 green when it is PROVISIONAL |

Skills — invoke-only, multi-step: `client-data-preflight`, `contract-change-rebuild`.

**Keep this layer small.** It grew once into something that had to be deleted wholesale. Add a
rule only when it is path-scoped, justified by a failure this repo has actually had, and
expected to last; add a command only after the same one-shot prompt has been typed three
times; promote a command to a skill only once it genuinely has steps. Unused config is not
free — it is loaded, believed, and eventually wrong.

## Working agreements

- Stage explicit paths. Never `git add -A` or `git add .`.
- Push, PR, merge, and branch deletion need per-instance authorization from the author.
- Never `git reset --hard`; prefer `git revert`.
- No real client data in this repo, ever. Real material is read in place, outside the repo,
  and is never copied in, sent to an external service, or given to a subagent. Refer to
  documents by anonymous `DOC-nn` identifiers in anything committed.
- Every claim written into this layer must be checkable against the current tree. A confident
  sentence about a file that no longer exists is worse than no sentence.
