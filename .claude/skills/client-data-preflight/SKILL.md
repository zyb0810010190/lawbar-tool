---
name: client-data-preflight
description: Before committing, or before sending any diff or file outside this machine, check it for real client identifiers — including the places the automated scanner does not reach.
---

# client-data-preflight

Invoke-only. This is a checklist for a judgment call, not a gate — nothing here blocks
anything, and a clean result is not clearance.

The repo already has both failure directions on record: real identifiers reached a commit
and survived five weeks undetected, and a later over-redaction of ordinary legal vocabulary
caused an external reviewer to report a false high-severity finding. Both cost real time.

## 1. Run what is automated

```sh
npm --prefix apps/lawbar-desktop run check:no-real-data       # staged/changed paths
npm --prefix apps/lawbar-desktop run check:no-real-data:all   # full in-scope corpus
```

Both already run inside the desktop `pretest`, so a desktop test run covers them. Neither
runs anywhere else.

## 2. Know what the scanner does not see

`apps/lawbar-desktop/scripts/check-no-real-data.mjs` sweeps only `apps/lawbar-desktop` and
`docs/contracts`, then filters through `SCOPE_HINTS`: paths matching `casebox`/`case-box`,
`apps/lawbar-desktop/renderer/`, contract and desktop test fixtures, and
`apps/lawbar-desktop/tests/`.

Consequences worth holding in mind:

- **No `services/**` package runs it.** Not in any `pretest`, not in any `test`.
- **New top-level directories are outside it entirely** — `posts/`, `notes/`, and anything
  added later match no scope hint.
- It matches **regex classes** — court names, phone numbers, email addresses, ID numbers.
  A case fact in ordinary prose ("the client conceded at mediation") matches nothing.

So: a green scanner means the known patterns are absent from the scanned subset. It does not
mean the change is safe to publish. Inspect anything outside that subset by reading it.

## 3. Redact narrowly when sending anything outside this machine

This applies to a diff pasted into an external review tool, an issue report, or a shared
artifact.

- Redact **identifiers**: party names, case numbers, court names tied to a live matter,
  addresses, dates precise enough to identify a proceeding.
- Do **not** redact generic legal vocabulary — a cause of action, a procedural term, a form
  name. Over-redaction is not the safe direction: a reviewer seeing a redacted token on an
  added line reasonably infers a real value survives there, and reports a finding that does
  not exist. That happened here.
- Never inline a diff whose removed lines contain the identifiers being scrubbed. A
  remediation commit's `-` side is the most dangerous text in the repo.

## 4. Standing facts

- Real client material lives outside this repo and is read in place. It is never copied in,
  never committed, never transmitted to an external service, and never handed to a subagent.
- When a real document must be referred to in a committed artifact, use an anonymous
  `DOC-nn` identifier; the mapping stays out of the repo.
- The repo's history still contains identifiers from the earlier leak. They were scrubbed
  forward-only and remain in pushed history and remote branches, because rewriting was
  rejected. Treat anything that reaches a commit as permanent.
