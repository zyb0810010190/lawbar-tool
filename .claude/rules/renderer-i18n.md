---
path: apps/lawbar-desktop/renderer/**
---

# The i18n allowlist is keyed by line number

`tests/renderer-i18n-guard.test.mjs` scans the renderer for hardcoded user-facing strings and
fails on any occurrence absent from `renderer/i18n/ui-strings-allowlist.json`. The allowlist
key is:

```js
const keyOf = (c) => JSON.stringify([c.file, c.line, c.text, c.kind]);
```

**`line` is part of the key.** So any edit that shifts line numbers in a renderer file
invalidates every allowlist entry below it — including a pure comment change, a reformat, or
an added import. The strings did not change; their line numbers did, and the guard cannot tell
the difference.

Consequence: re-run the gate after *any* renderer edit, not only after touching copy.

```sh
npm --prefix apps/lawbar-desktop run test:ui-i18n
```

Skipping this on the assumption that a comment is harmless has already cost two rounds of
manual intervention.

The product is Chinese-first: a new hardcoded user-facing label is meant to fail. When the
guard fires on a genuinely new string, route it through i18n rather than widening the
allowlist.

*Trust: CI. The guard runs in the desktop suite, which `desktop-release-gates.yml` executes.*
