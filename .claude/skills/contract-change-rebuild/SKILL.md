---
name: contract-change-rebuild
description: After editing case-box-contract, rebuild in the right order so the desktop is not tested against a stale tarball — the failure is green tests, not an error.
---

# contract-change-rebuild

Invoke-only, when `docs/contracts/case-box-contract/**` or
`services/case-box-persistence/**` has changed and desktop behaviour matters.

## Why this needs saying

`case-box-contract` is consumed **two different ways**:

| Consumer | How | Sees a source edit? |
|---|---|---|
| `services/case-box-persistence` | `file:../../docs/contracts/case-box-contract`, plus a `prebuild` that builds it | Yes, immediately |
| `apps/lawbar-desktop` | `file:dist-tarballs/case-box-contract-0.1.0.tgz` — a **committed** tarball | **No.** Only after repacking |

The desktop's tarballs are committed to git, not generated on demand. So a schema edit shows
up on the services side immediately and on the desktop side not at all.

**The failure mode is silence.** The desktop `pretest` runs build, renderer-import lint, both
no-real-data checks, and a colour test — it does **not** run `check:internal-tarballs` or
`check:internal-lock`. `.github/workflows/desktop-release-gates.yml` runs `npm ci` and
`npm test`, also without the drift check, and installs the committed tarballs as-is. So the
desktop suite passes green while testing the old contract, locally and in CI alike.

## The sequence

```sh
cd apps/lawbar-desktop
npm run bootstrap
```

`bootstrap` is a fail-fast `&&` chain of five steps, in this order:

1. build `case-box-contract`
2. build `case-box-persistence`
3. `pack:internal` — repack both into `dist-tarballs/`
4. `refresh:internal-tarballs` — rewrite the lockfile integrity records
5. `npm install`

Steps 3 and 4 are the ones that make the edit visible to the desktop. Running only
`npm install`, or only rebuilding the contract, leaves stale tarball bytes in place.

## Confirming it took

```sh
npm --prefix apps/lawbar-desktop run check:internal-tarballs   # tarballs match sources
npm --prefix apps/lawbar-desktop run check:internal-lock       # lock integrity current
```

Run these deliberately — nothing invokes them for you. If either reports drift after a
contract edit, the rebuild did not complete and any desktop test result since then was
measured against the old contract.

The repacked `.tgz` files and `manifest.json` under `dist-tarballs/` are tracked, so a real
contract change produces a diff there. **A contract edit with no `dist-tarballs/` change in
the same commit is the signature of this bug.**
