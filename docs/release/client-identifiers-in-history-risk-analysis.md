# Client identifiers in git history — risk analysis

**Status: the documented basis for an interim acceptance. Dated 2026-08-23.**

Real client identifiers exist in already-pushed history, on `main` and across the remote
branches. They were scrubbed FORWARD — the working tree is clean and a privacy gate scans 664
files on every desktop test run — but history was never rewritten. The prior posture was
recorded as "private repo, accepted".

That is a conclusion, not an analysis. An acceptance with no stated reasoning cannot be
checked, cannot be reviewed, and cannot tell anyone when it has stopped being true. This
document supplies the reasoning, and — more importantly — the conditions that would void it.

The maintainer is a practising lawyer and the material is information relating to
representation, so the standard is professional, not merely technical.

## What was measured, 2026-08-23

| Condition | Status |
|---|---|
| Repository private | yes |
| Forks in existence | 0 |
| Watchers | 0 |
| Collaborators | 1 — the owner's own account |
| Outside collaborators | 0 |
| Pending invitations | 0 |
| Deploy keys | 0 |
| GitHub Pages | disabled |
| CI uploads artifacts | no workflow uses upload-artifact |
| CI prints file contents | no workflow cats or tails files into logs |
| Forward gate active | yes — 664 files, clean |

**On forking.** GitHub refuses to change `allow_forking` on a personal-account repository:
"Allow forks setting can only be changed on org-owned private repositories". The setting reads
`true` and cannot be set to `false`. That is acceptable here for a structural reason rather
than a hopeful one: forking requires read access, read access to a private repository requires
collaborator status, and the only account with any access is the owner's. There is no second
reader who could fork. The toggle exists for org-owned repositories because that is where a
second reader exists.

## Why immediate history rewrite was not chosen

A rewrite would touch every ref, invalidate every existing clone, and break the commit trail.
For a court-facing tool that trail has evidentiary value: it is the record of how the audit
chain came to make the claims it makes. Destroying it to remediate an exposure that currently
has an audience of one is the more damaging of the two options *while the conditions above
hold*.

This is a judgement about relative harm at a moment in time. It is not a conclusion that the
identifiers are acceptable in history.

## Triggers that void this acceptance

Any one of these, and the interim posture ends and remediation is required:

1. A collaborator is added, or any invitation is issued — that creates the second reader the
   fork analysis above depends on not existing.
2. A fork appears, by any route.
3. Repository visibility changes to public.
4. A deploy key, GitHub App, or Action gains read access.
5. Any workflow begins uploading artifacts or printing file contents into logs.
6. Any suspicion of unauthorised access.
7. A client, jurisdiction, or engagement term imposes stricter handling than the above.
8. A rewrite plan exists, has been tested, and the only remaining reason not to run it is
   convenience.

## The remediation, if a trigger fires

Least-destructive order, so the trail survives under controlled custody rather than being
lost:

1. Freeze pushes.
2. Create an encrypted bare mirror of all refs, with a hash manifest and date. Treat it as
   privileged material under custody, not as a development remote.
3. Rewrite history with targeted replacement across all refs, preserving topology rather than
   orphaning or squashing.
4. Force-push the cleaned history; retire stale branches; reclone every working copy.
5. Contact GitHub Support for cached views, pull-request refs, and server-side garbage
   collection, which a force-push alone does not reach.
6. Retain the sealed archive only as long as evidentiary provenance requires.

## What this document does not claim

It does not claim the identifiers are harmless, or that the exposure is closed. It claims the
exposure is currently bounded to a single account, that the boundary was measured rather than
assumed, and that the conditions under which the acceptance expires are written down where the
next person to look will find them.
