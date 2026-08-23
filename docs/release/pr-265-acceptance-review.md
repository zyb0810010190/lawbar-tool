# PR #265 — acceptance review

**Purpose.** This branch deletes 670 files and no second human will ever review it. "Green CI
and recoverable from git history" is not an acceptable justification for a court-facing repo's
main branch absorbing a deletion wave, so the deletions are classified here and accepted
deliberately. Written before merge, on the reasoning that a maintainer-authored review is the
only kind available in a one-maintainer repo — and is still worth more than none.

## Scale

888 files changed, +28,007 / −53,739. 670 files deleted outright. All four CI checks green:
persistence (1268 tests), desktop (1105, macOS, including packaging and the packaged smoke
matrix), workflow scripts (75), swift.

## The 670 deletions, classified

| Count | Group | Accepted because |
|---:|---|---|
| 504 | dev-memo/ run logs, notes, intake (deleted) | Working notes from completed work items. Never product or contract documentation. |
| 73 | dev-memo/plan-* (deleted) | Per-WI planning documents whose outcomes are recorded in the work items themselves and in `docs/adr/`. |
| 22 | .claude/ agents, commands, config (deleted) | The agent-governance layer. Deleted deliberately after audits found it bypassable — it ran in the same uid as the thing it gated. |
| 20 | scripts/workflow/ batch machinery (deleted) | The same layer's scripts (batch-closeout, a07 markers). Removed with it. |
| 18 | root / misc (`.agents`, `.codex-toolkit.md`, …) | Tooling scaffolding for the same layer. |
| 16 | .claude/hooks/ (deleted) | The bypassable hook layer specifically. Its removal is why this repo's posture is now "hooks are advisory; CI is the only enforcement boundary". |
| 11 | .claude/rules/ (deleted) | Same layer. |
| 6 | docs/product/ (six files, consolidated) | **The only product documentation deleted.** Itemised below. |

## The six product documents, individually

All six were removed by two commits with the intent stated in their messages —
`88c8c46 docs(product): consolidate into two files — product-plan.md and product-definition.md`
and `49dd7ad chore(config): delete the workflow/scaffolding/harness layer; consolidate product docs`.

| File | Lines | Disposition |
|---|---:|---|
| `evidence-m0-acceptance-scenarios.md` | 126 | consolidated into `product-definition.md` |
| `evidence-m0-content-inventory.md` | 94 | consolidated |
| `evidence-m0-prd.md` | 96 | consolidated |
| `evidence-m0-user-flows.md` | 132 | consolidated |
| `product-target-architecture.md` | 181 | consolidated |
| `project-requirements-brief.md` | 560 | consolidated into `product-plan.md` |

Each is still cited by one surviving document. Those citations are the dead-reference residue
D-4 accounts for: 139 of the 173 tracked dead references are residue of exactly these two
deliberate deletions, and they are banner-explained rather than silently broken. The ratchet
holds the count so new dead references cannot be added.

## What this review does not claim

It does not claim the 106 commits were read line by line. It claims the deletions were
classified, attributed to named commits with stated intent, and accepted knowingly — and that
the one group carrying product meaning was itemised rather than counted. A second reviewer
would still be worth more; there isn't one.

## A note on the backticks in this file

Paths that no longer exist are written WITHOUT backticks. In this repo a backticked path under
a known root is a live reference the doc-reference ratchet resolves, and a document about
deletions would otherwise manufacture the very dead links it is explaining. The surviving
files it points to — product-plan.md, product-definition.md — keep theirs.
