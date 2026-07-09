# Design artifact — Chinese-first desktop UI + Settings entry

**WI**: `WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00` · **Date**: 2026-07-09 · **Status**: design (non-authoritative until cc-suite review-plan).
**Author**: Claude Code. **Type: UI** (satisfies the `Design artifact:` gate for `apps/*/renderer/*` changes).

## Intent

Make the Electron renderer **Chinese-first** (zh-CN is already the locked v1 locale, `renderer/i18n/t.ts` `LOCALE="zh-CN"`) and add a visible **设置 (Settings)** entry to the app shell with a basic Settings screen. This closes the remaining English drift the anti-drift allowlist still tracks and gives the lawyer an in-app place to see local-first / offline / privacy posture.

Nothing here changes product direction: local-first, offline-first, single-lawyer, no telemetry — it surfaces that posture, it does not alter it (`.claude/rules/client-local-first.md`).

## Shell layout (sidebar)

```
┌───────────────┐
│  Lawbar · 案件盒 │
├───────────────┤
│ §  案件          │  #/matters      (data-nav="list")
│ +  新建案件       │  #/matters/new  (data-nav="new")
│ ⚙  设置          │  #/settings     (data-nav="settings")   ← NEW
└───────────────┘
```

`⚙ 设置` is a static sidebar `<a>` mirroring the existing two links (same `data-nav` / `data-i18n` idiom, `applySidebarCurrent` marks `aria-current="page"` when the route is `settings`). Reachable without DevTools.

## Settings screen (`#/settings`) — read-only, static + a few dynamic facts

```
设置

应用
  版本            0.1.0
  运行模式         开发 (dev) | 生产 (production)

数据与隐私
  数据位置         ~/Library/Application Support/lawbar
  本地优先         文档仅保存在本机，除非您主动导出。
  离线优先         应用在离线状态下可正常使用。
  FileVault        已开启 | 未开启 | 未知    (+ 生产环境要求全盘加密的说明)
  隐私             不收集遥测数据；崩溃上报已关闭。

  [打开数据文件夹]   ← optional, only if trivially safe
```

Dynamic facts (`版本`, `运行模式`, `FileVault`) come from ONE new read-only preload namespace `window.lawbar.appInfo.get()` → `{ version, mode, dataDir, fileVaultState, offline:true, telemetry:false }`, backed by a single `ipcMain.handle("app:info", …)`. The data-dir path string is displayed as documented text; `打开数据文件夹` is deferred unless it can reuse an existing safe shell-open path.

## i18n approach

Every remaining user-facing English literal in `renderer/index.ts` + `renderer/screens/*.ts` moves into `renderer/i18n/catalog.ts` (zh-CN) and is wired via `t()`. `t()` throws on a missing key, so a missed wiring fails loudly in build/tests. The anti-drift allowlist is regenerated and must burn down to only genuinely-exempt occurrences (bare separators/symbols, and any developer-only text). New namespaces: `matterCreate.*`, `matterArchive.*`, `notFound.*`, `settings.*`, plus per-sub-screen namespaces for the expandable view panels.

## Out of scope

Signing/notarization/release; legal/compliance conclusions; schema/persistence-contract changes; archive/document upload; unrelated restyle. New preload channel is **additive + read-only** (no existing surface renamed/removed).
