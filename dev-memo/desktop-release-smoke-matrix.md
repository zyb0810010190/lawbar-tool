# Desktop release smoke matrix — WI-DESKTOP-RELEASE-SMOKE-MATRIX-05

A small, durable **packaged-app** smoke that proves the core lawyer workflows still work after
i18n / settings / error-surface changes. It runs against the real `release/mac-*/lawbar.app`
(electron-builder output) via Playwright-Electron — the same path a lawyer runs — so it exercises the
real preload/IPC boundary, the packaged asar, and the zh-CN renderer end to end.

**One test, one launch** (`tests/casebox-ui.electron.test.mjs`), ~3s: `release smoke matrix: launch → nav
→ create → list → detail → sub-screen → archive → settings → localized-error (M1-M9)`.

## Run

```
npm --prefix apps/lawbar-desktop run dist            # build the packaged app first (if stale)
npm --prefix apps/lawbar-desktop run test:smoke-matrix   # alias of test:ui-packaged
```

The wrapper (`scripts/test-packaged-wrapper.mjs`) launches the packaged bundle with a temp
`--user-data-dir` and `LAWBAR_MODE=dev` (FileVault bypass in dev), and post-scans for stray DB files
in the repo tree (local-first / no-leak guard).

## Matrix

| # | Workflow | How it's proven | Key hooks |
|---|---|---|---|
| M1 | App launches in **zh-CN** | `h1` == `案件台账`; empty-state contains `仅保存在本机` | `h1`, `[data-test-id=list-empty]` |
| M2 | Sidebar nav: **案件 / 新建案件 / 设置** | click `新建案件` → create form; click `案件` → list; click `设置` → settings | `button.list-new-btn`, `a.sidebar-link[data-nav=list|settings]` |
| M3 | **Create matter** via enum dropdowns | fill name/jurisdiction, `selectOption` role=`client` + party_kind=`individual`, submit | `#cm-name`, `#cm-party-0-role`, `#cm-party-0-party-kind`, `[data-test-id=create-submit]` |
| M4 | Created matter **appears in list** | after create, nav to `案件`; `a.matter-name` text set includes `matter-fixture-A` | `a.matter-name` |
| M5 | **Matter detail opens** (zh-CN) | `view-title` == name; fields show `诉讼` / `test-jx` / `普通`; active status pill | `[data-test-id=view-title]`, `[data-test-id=view-fields]`, `.status-pill--active` |
| M6 | At least one **sub-screen renders** | deadlines disclosure present on the detail view (+ audit chain head expands, count ≥ 1) | `[data-test-id=view-deadlines-details]`, `[data-test-id=view-chain-*]` |
| M7 | **Archive flow** | archive form (`归档案件 — …`), fill reason, submit → `.status-pill--archived`, reason recorded, archive button gone | `[data-test-id=archive-*]`, `.status-pill--archived` |
| M8 | **Settings** via real preload/IPC | `设置` screen renders `app:info` — version `0.1.0`, privacy `不收集遥测数据`, `FileVault` | `[data-test-id=settings-title|settings-section-app|settings-body]` |
| M9 | A **localized error path** without English/raw leak | submit New Matter EMPTY → validation banner is visible, Chinese, and contains no `required/invalid/persistence/schema/Error` | `[data-test-id=create-form-error]` |

Plus the **local-first invariant**: post-run scan asserts the SQLite DB lives only under the temp
`--user-data-dir`, and no DB file appeared in the repo tree.

## Design choices

- **Reachable, deterministic error surface (M9)** = the client-side New-Matter validation banner (zh-CN),
  not an injected IPC failure — an IPC error would need a failure-injection seam the packaged app does not
  expose. The IPC error → zh-CN mapping itself is covered by unit tests (`renderer-error-message.test.mjs`
  + the per-screen envelope-error tests).
- **One launch** keeps runtime ~3s; each electron launch is the expensive part, so the matrix threads all
  workflows through a single window rather than many tests.
- **Assert on visible Chinese text + stable `data-test-id` hooks**, not implementation details — resilient
  to refactors.

## Intentionally deferred

- Deep sub-screen CRUD (add document / deadline / fact / link) — covered by the pure-Node renderer unit
  tests; adding them to the packaged smoke would lengthen it without new release-risk signal.
- Multiple-matter / pagination / cursor flows — unit-tested; not a launch-smoke concern.
- Windows/Linux packaged runs — v1 is macOS-only (`.claude/rules/client-local-first.md`).
- IPC-failure error banners in the packaged app — no failure-injection seam; unit-tested instead.
