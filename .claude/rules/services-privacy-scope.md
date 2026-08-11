---
path: services/**
---

# The privacy scanner does not run here

`apps/lawbar-desktop/scripts/check-no-real-data.mjs` runs inside the **desktop** `pretest`.
No package under `services/` invokes it — not in any `pretest`, not in any `test`. Verified by
grepping every `services/*/package.json`.

Its scope would not help even if invoked: `SCOPE_HINTS` matches paths containing
`casebox`/`case-box`, `apps/lawbar-desktop/renderer/`, contract and desktop test fixtures, and
`apps/lawbar-desktop/tests/`. Most `services/` paths match none of those.

So when adding fixtures, seed data, test expectations, or log samples anywhere under
`services/`, the automated check is not watching. Read what you are adding.

Real identifiers once sat in this repo for five weeks without the gate firing, and the
remediation could only scrub forward — they remain in pushed history and remote branches
because rewriting was rejected. Anything that reaches a commit here is permanent.

Use synthetic parties, and refer to real documents only by anonymous `DOC-nn` identifiers.
Full checklist: `.claude/skills/client-data-preflight/`.

*Trust: advisory. Nothing enforces this at commit time.*
