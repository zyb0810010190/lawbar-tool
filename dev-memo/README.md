# dev-memo

Working notes that the product still depends on. Pruned 2026-08-11 from 557 files to 117, then to 87 on 2026-08-12 when forward-looking plans and design artifacts moved to `docs/product/`. What
remained is what product code cites, what specifies shipped behaviour, or what records a product decision.

## What is here

| Path | What it is |
|---|---|
| `design/` (6 stubs) | The 25 design artifacts moved into `docs/product/product-definition.md` Part III on 2026-08-12; six are cited by renderer source and remain here as pointer stubs. Formerly: **Design artifacts** — one per shipped UI screen: intent, states, copy, edge cases. Six are cited directly from `apps/lawbar-desktop/renderer/**`. These are the UI specification. |
| `design-source/` (12) | Design provenance: the CSS token and component sources the app's `renderer/index.css` was ported from, plus the Plan-C symbol and `PROVENANCE.md`. |
| `plan-*.md` | Implementation plans that surviving source code cites by name for its own behaviour, e.g. `plan-casebox-ui-plan-00.md`, referenced by nine renderer modules. |
| `adr-*.md`, `forms-spec-*.md`, `*-spec-*.md` | Schema and forms specifications the contract package and tests depend on. |
| `ocr-*.md` | OCR security, confidentiality, retention, and failure-mode boundaries — product posture, not process. |
| `plan-ui-substrate-decision-00.md` | The ratified Electron substrate decision. A settled decision, so it stays here rather than moving to the plan. |
| `superseded/` | Gitignored, untracked, retained on disk only because `docs/product/product-definition.md` Part I cites `case-box-plan.md` as historical context. |

**Moved out on 2026-08-12.** Eleven forward-looking lane documents — signing/notarization,
production-launch readiness, release checklist, smoke matrix, RC1 handoff, migration
compatibility, CI release gates, forms T4, night mode, and the WeChat companion plan and its
decision memo — are now `docs/product/product-plan.md`. None was cited by source code, which
is why they could move. Work already shipped stays here as a record.

## Dead links are expected

Removed in the same pass: 287 batch-audit study notes, 100 per-work-item plans and closeouts for finished
work, 49 archived audit reports, and the `dev-memo/run/` run-control tree.

**About 339 markdown links in 62 surviving files point at those removed files.** They were left as written
on purpose — they are historical citations, and rewriting prose to erase the trail of how a decision was
reached would falsify the record. Every target is recoverable:

```bash
git show pre-config-reset:dev-memo/<file>          # the pre-reset save point
git log --diff-filter=D --name-only -- dev-memo/   # find where a file was removed
```

Links beginning `dev-memo/run/` refer to the retired governance apparatus, which no longer exists in any
form; treat those as closed rather than lookup-able.

## What does not belong here

Product description and plan live in `docs/product/`. Technical decisions live in `docs/adr/`, which the
product brief declares outrank it. Contracts and schemas live in `docs/contracts/`. Nothing about agent
workflow, harness, or governance belongs in this repository any more.
