---
description: Handling real client/case material supplied from outside the repo — read-only, never into git, never to an external service, never to a sub-agent, and no case identifiers in committed artifacts.
---

# Real Client Data

**Treat any real client or case material as read-only, and never let it — or anything identifying it —
enter git, an external service, a sub-agent, or a committed artifact.** This repo is a court-facing tool
for a practising lawyer; a leaked party name is a confidentiality failure, not a tidiness problem.

This rule exists because it already happened: real identifiers (a party name, the counterparty
organization, a court code, two docket numbers, and real source filenames) were used as sample data and
sat committed across 11 files for five weeks (scrubbed forward-only in `f86c8e4`). Nothing here is
hypothetical.

## Scope

Applies to any real client material, wherever it lives — a `~/Documents` case folder, an email
attachment, `dev-memo/run/intake/**`, or a path the user pastes into a prompt.

## The five obligations

1. **Read-only, in place.** Never copy, move, rename, symlink, archive, or export such material into the
   repo — including into scratch/tmp paths that later get staged. Do not hash it, and do not print its
   filenames.
2. **Never into git.** Not tracked, not staged, not stashed, not committed, and not left as untracked
   residue. The only mechanical enforcement today is a single `.gitignore` line for
   `/dev-memo/run/intake/` (commit `bbf8419`) — it covers ONE path and generalizes to nothing else. That
   is why this obligation is a rule and not merely a config.
3. **Never to an external service.** Do not transmit its content, filenames, or paths via cc-suite /
   Codex / MCP / network / any cloud model. **This includes an inlined `git diff`**: the standing
   Layer-B batch-audit pattern inlines a diff into the broker prompt, and a scrub commit's `-` lines
   contain every identifier it removes. Redact before sending and verify the outgoing prompt file is
   identifier-free — but redact **NARROWLY** (see §"Redaction discipline").
4. **Never hand such a path to a sub-agent.** A background agent's transcript is a separate record
   outside the orchestrator's control. Batch work over client material stays in the main thread.
5. **No case identifiers in committed artifacts.** No case number, docket number, court code, party or
   counterparty name, case-directory name, source filename, or absolute path under it — in any commit
   message, report, log, dev-memo, study packet, or code comment. Derived results use anonymous ids
   (`DOC-01`, `DOC-02`…); the id ↔ real-file mapping stays in the chat session only, never on disk.
   Precedent: `dev-memo/ocr-confidentiality-retention.md` §"Config-path redaction" (WI-22, `524fbad`)
   already replaced logged paths with `fp:<8-hex>` because *"a directory's own basename can itself be a
   client/matter folder name."* Same threat model; cite it rather than re-arguing it.

## Two sanctioned exceptions (narrow, and neither is self-service)

- **`dev-memo/run/intake/**` is the ONE sanctioned in-repo location** for raw client input. It is
  gitignored, and obligations 1 and 3-5 still apply in full: do not read, copy, list, or print its
  contents, and never stage it. Per the user's WI-13 instruction (2026-07-09) this material is to be
  moved OUTSIDE the repo; until that happens, treat the directory as sealed.
- **Redacted real material MAY become a fixture — only by explicit per-instance user authorization.**
  `docs/release/go-live-plan.md` WI-11a defines the mechanism (fixtures land under
  `services/ocr-worker-bakeoff/fixtures/` with manifest entries carrying source/provenance and PII review
  state); `dev-memo/plan-forms-t3-evidence-catalog-00.md:146` states the default: *"raw samples … MUST NOT
  become test fixtures. Fixtures are synthetic, or separately redacted AND explicitly authorized first."*
  The agent never makes that call.

## Derived artifacts default to NOT committable

An artifact derived from real material may still carry client information — e.g. an A0.7 geometry oracle
embeds page dimensions from a real filing. **Whether such an artifact may be committed is a USER
decision; the default is NO.** Prefer a design that produces no artifact at all: the A0.7 stability mode
(`--stability`, commit `c587dbc`) needs no oracle precisely so it can run on confidential files without
persisting anything.

## Redaction discipline — narrow, not broad

When a diff or report must go to an external reviewer, redact **only true identifiers** (names, orgs,
docket numbers, court codes, filenames, paths). Do NOT redact generic legal vocabulary — a cause of
action, a document-type name, a court level in ordinary prose. Over-redaction is not extra safety: on
2026-08-09 it produced a false HIGH finding, because a masked token on an added line reads to a reviewer
as an identifier that survived a scrub. Verify the outgoing file is identifier-free before sending, and
state the redaction scope in the prompt so the reviewer does not mis-read a mask.

## When something has already leaked

1. **Do not rewrite pushed history reflexively.** If the identifiers are already on a remote, a rewrite
   means force-pushing every affected ref — a hard stop — and still does not guarantee server-side
   erasure. Scrub forward, and record the residue as an accepted divergence with the reason.
2. **Check the actual facts before choosing.** Whether `main` is clean and whether anything was pushed
   are one `git grep` and one `git remote -v` away. On 2026-08-09 both were asserted from context, both
   were wrong, and an external consult produced a confident recommendation for the wrong situation.
3. **Repository visibility is load-bearing.** Forward-only is defensible for a PRIVATE repo; revisit the
   decision if visibility or sharing posture ever changes.

## References
- [[security-boundary]], [[client-local-first]], [[staging-hygiene]], [[autonomy]] (hard stops).
- `apps/lawbar-desktop/scripts/check-no-real-data.mjs` — the automated gate: pattern scan + an
  APPROVED-FICTIONAL party-name allowlist over contract fixtures, with an `--all` full-corpus mode wired
  into `pretest`. It is a floor, not a substitute for this rule: it cannot detect a person's name by
  pattern (a 3-character Chinese name is indistinguishable from ordinary text), which is why the control
  is provenance + allowlist rather than name detection.
- `dev-memo/ocr-confidentiality-retention.md` §"Config-path redaction" (WI-22, `524fbad`).
- `docs/release/go-live-plan.md` WI-11a; `dev-memo/plan-forms-t3-evidence-catalog-00.md:146`.
