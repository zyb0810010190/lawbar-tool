# Desktop production-launch readiness

**WI**: `WI-DESKTOP-PRODUCTION-LAUNCH-READINESS-09`. **`main` @** `7d96a7b`. **Docs/verification only — no product change.**
Verifies the **production** launch path (no `LAWBAR_MODE=dev`): FileVault enforcement, first-run, local data
location, and Chinese UI. The app is an **unsigned** RC (see `dev-memo/desktop-macos-signing-notarization.md`).

## TL;DR

- Without `LAWBAR_MODE=dev` the app launches in **production** mode (fail-closed: any value other than `dev`
  → production; unit-tested `resolveMode`).
- Production mode **requires FileVault ON**. FileVault OFF (or unknown) → the app shows a **"FileVault
  required"** error dialog and **quits before opening any window or creating any data** (Tier-1 enforcement).
- This build machine has **FileVault OFF**, so the production block was verified directly; the **FileVault-ON**
  proceed-path is covered by the unit-tested `decideAction` matrix + the manual checklist in §7.
- Data lives only under `~/Library/Application Support/lawbar/`; nothing is written into the repo tree.

## 1. Verified on this machine (2026-07-09, main 7d96a7b)

| Check | Result |
|---|---|
| `npm --prefix apps/lawbar-desktop test` | **819 pass / 0 fail** |
| `npm --prefix apps/lawbar-desktop run test:smoke-matrix` | **1 pass** (M1–M9, dev mode) |
| `npm --prefix apps/lawbar-desktop run dist` | **success** (arm64 + x64) |
| `fdesetup status` (this machine) | **FileVault is Off** |
| Production launch (no `LAWBAR_MODE=dev`) | **BLOCKED** — process stayed at the "FileVault required" dialog, **never reached the app UI** |
| Data in the launch's temp userData after the block | **none** — no `case-box.sqlite` / `case-box-documents/` (block quits before DB creation) |
| Repo-tree data | **none** created |
| Chinese UI | verified via the smoke matrix (dev mode; M1 `案件台账`, etc.); production UI not reachable on this FileVault-OFF machine — see §7 |
| Product behavior changed | **no** |

## 2. Production launch / open commands

**Open (normal user, Finder — production mode):**
```
open apps/lawbar-desktop/release/mac-arm64/lawbar.app     # Apple Silicon
open apps/lawbar-desktop/release/mac/lawbar.app           # Intel
```
Unsigned build → first open needs **right-click → Open → Open** (or System Settings → Privacy & Security →
Open Anyway). No `LAWBAR_MODE` = production = FileVault-enforced.

**Direct executable (production, e.g. to see terminal output):**
```
apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar   # arm64, NO LAWBAR_MODE=dev
apps/lawbar-desktop/release/mac/lawbar.app/Contents/MacOS/lawbar         # x86_64
```

**Dev mode (FileVault bypass — separate, for development only):**
```
LAWBAR_MODE=dev apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar
```

## 3. FileVault enforcement (Tier-1)

At `app.whenReady()` the app resolves the launch mode and probes FileVault, then `decideAction(state, mode)`:

| FileVault state | production mode | dev mode |
|---|---|---|
| `on` | **proceed** | proceed |
| `off` | **block** (dialog + quit, before window/DB) | warn (stderr) + proceed |
| `unknown` | **block** | warn + proceed |
| `non-macos` | proceed | proceed |

The block: `dialog.showErrorBox("FileVault required", …)` then `app.quit()` — it returns **before**
`registerCaseBoxIpcHandlers` / `getCaseBoxRuntime`, so **no database or document storage is created** on a
blocked launch. All of this is unit-tested (`main.test.mjs`: `decideAction: full matrix`, `resolveMode`
fail-closed default, `parseFdesetupStatus`).

## 4. First-run behavior

- **FileVault ON:** window opens to the zh-CN matter list (`案件台账`); on first use, the local DB +
  document storage are created lazily under the data dir (§5). Local-first: nothing leaves the Mac.
- **FileVault OFF/unknown (production):** the "FileVault required" dialog appears — *"lawbar requires
  FileVault to be enabled before launch in production mode. Detected state: off … Enable FileVault in System
  Settings → Privacy & Security → FileVault, or set LAWBAR_MODE=dev for development builds."* — then the app
  quits. No window, no data.

## 5. Local data location

`app.getPath("userData")` for productName `lawbar` →
```
~/Library/Application Support/lawbar/
    case-box.sqlite           # the local case-box SQLite database
    case-box-documents/       # app-managed document storage (path.join(userData, "case-box-documents"))
```
Nothing is written into the repo working tree (verified — the packaged smoke's post-run scan also asserts
this, and the production-block launch created no files at all).

## 6. Confirm the UI is Chinese

On a successful (FileVault-ON) launch: sidebar **案件 / 新建案件 / 设置**; list title **案件台账**; New-matter
form **名称 / 案件类型 / 管辖 / 当事人** (role & kind dropdowns 委托人 / 个人 …) / **保密级别**; Settings **版本 /
数据位置 / 本地优先 / FileVault / 不收集遥测数据**. Automatically asserted by the smoke matrix (M1/M2/M3/M5/M8/M9)
in dev mode; identical renderer runs in production.

## 7. Manual verification checklist — FileVault ON (this machine is OFF, so untested here)

On a Mac with **FileVault ON** (System Settings → Privacy & Security → FileVault → On), run the same build:
- [ ] `fdesetup status` → `FileVault is On.`
- [ ] Open the `.app` for your arch (production mode, no `LAWBAR_MODE`). It should **launch to the zh-CN list**,
      NOT show the FileVault dialog.
- [ ] The UI is Chinese per §6.
- [ ] `~/Library/Application Support/lawbar/case-box.sqlite` is created after first use; `case-box-documents/`
      appears when a document is added.
- [ ] No files are written into the repo tree.
- [ ] Quit and relaunch → data persists (local-first).

## 8. Caveats / blockers

1. **Unsigned build** — Gatekeeper friction off the build machine (right-click → Open, or `xattr -dr
   com.apple.quarantine …`). Signing/notarization is READY-only (separate WI).
2. **Production requires FileVault ON** — deliberate encryption-at-rest enforcement; the block is a **feature**,
   not a bug. Dev machines use `LAWBAR_MODE=dev`.
3. **This machine has FileVault OFF** — the ON proceed-path (and production Chinese-UI) could not be exercised
   here; it is covered by the unit-tested `decideAction` matrix + the §7 checklist. Honest limitation.
4. **Version 0.1.0** placeholder; no auto-update.

## References
- `dev-memo/desktop-rc1-artifact-handoff.md`, `dev-memo/desktop-macos-signing-notarization.md`,
  `dev-memo/desktop-release-smoke-matrix.md`, `dev-memo/release-checklist.md`.
- `apps/lawbar-desktop/electron/main.ts` (whenReady block), `src/security/fileVaultProbe.ts`
  (`probeFileVault` / `resolveMode` / `decideAction`), `tests/main.test.mjs` (enforcement unit tests).
