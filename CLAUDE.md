# CLAUDE.md — ClauDepot writing workspace

Covers the writing workspace only (`posts/`, `notes/`, and ClauDepot submission). It says
nothing about the lawbar-tool application, its contracts, its services, or its evidence
harness — those are governed by `docs/product/`, `docs/adr/`, and the code itself.

**This file is advisory prose. It enforces nothing.** This repo has no hooks, no commit
gates, no agent rule layer, and no governance scripts — that layer was deliberately removed
on 2026-08-10. Nothing here is checked mechanically at any point.

## Client confidentiality

`posts/` and `notes/` are gitignored, contents and all. **That is the only real protection
in this workspace**, so the rules below are about not defeating it:

- **Never `git add -f`** anything under `posts/` or `notes/`. The ignore rule is the
  mechanism; forcing past it removes the mechanism.
- **The privacy scanner does not cover this workspace.**
  `apps/lawbar-desktop/scripts/check-no-real-data.mjs` is scoped by `SCOPE_HINTS` to
  case-box paths, `apps/lawbar-desktop/renderer/`, and test/contract fixtures. A file at
  `posts/anything.md` matches none of them. It also matches regex classes — court names,
  phone numbers, email addresses, ID numbers — and cannot recognize case facts written as
  ordinary prose. Do not treat a passing test run as a privacy check.
- **Anonymize before submitting, not before committing.** Nothing here is committed, so
  submission to ClauDepot is the only moment where exposure actually happens.
- **Real client material lives outside this repo and stays there.** Do not copy it in, not
  as a file, not as a quotation, not as an example.
- Why the caution is specific rather than generic: this repository's history already
  contains real client identifiers. They were scrubbed forward-only and remain in the
  pushed history and in remote branches, because rewriting was rejected. A client fact that
  reaches a commit here is effectively permanent.

## Layout

| Path | Tracked | What it is |
|---|---|---|
| `posts/` | No | Drafts in progress. |
| `notes/` | No | Working scratch, not for publish. |
| `.env` | No | Holds `CLAUDEPOT_PAT`. Never read, print, echo, or commit it. |
| `.env.example` | Yes | The shape. Its value stays empty. |

Only `.gitkeep` is tracked inside `posts/` and `notes/`, so the directories exist while
their contents never enter git.

## Token handling

`CLAUDEPOT_PAT` carries `read:all`, `submission:write`, and `comment:write` — it can publish
and comment as the account owner. It is written to `.env` by hand, in a terminal. It must
never be pasted into a chat session, printed to stdout, or included in a commit.
