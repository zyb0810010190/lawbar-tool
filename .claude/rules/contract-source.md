---
path: docs/contracts/case-box-contract/**
---

# Editing this package does not reach the desktop until you repack

`case-box-contract` has two consumers that behave differently:

- `services/case-box-persistence` uses `file:../../docs/contracts/case-box-contract` and a
  `prebuild` that builds it — **sees your edit immediately**.
- `apps/lawbar-desktop` uses `file:dist-tarballs/case-box-contract-0.1.0.tgz`, a **committed
  tarball** — **does not see your edit at all** until the tarball is rebuilt.

The failure is silence, not an error. The desktop `pretest` runs build, renderer-import lint,
both no-real-data checks and a colour test; it does **not** run `check:internal-tarballs`. So
the desktop suite passes green against the old contract.

After editing here:

```sh
npm --prefix apps/lawbar-desktop run bootstrap
```

Five fail-fast steps: build contract → build persistence → `pack:internal` →
`refresh:internal-tarballs` → `npm install`. Steps 3–4 are what make the edit visible.

`dist-tarballs/*.tgz` and `manifest.json` are tracked, so a real contract change produces a
diff there. **A contract edit with no `dist-tarballs/` change in the same commit is the
signature of this bug.** It happened: the tarballs sat 14 files behind source for six days.

Procedure and diagnostics: `.claude/skills/contract-change-rebuild/`.

*Trust: CI. `desktop-release-gates.yml` now runs `check:internal-tarballs` +
`check:internal-lock` between `npm ci` and `npm test`, so drift fails the build.*
