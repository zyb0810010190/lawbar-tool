# Outstanding work — the single executable plan

**Written 2026-09-08 after reviewing all 49 files in `dev-memo/plan-*.md`.**

This file exists to be run by `/execute-plan`. Everything below the ledger is either a work
item that has not shipped, or an explicitly-marked non-item. Nothing here is already done.

## Why this file has no numbered section headings

`/execute-plan` treats three things as work-item boundaries: checkboxes, `WI-<n>` labels, and
**numbered headings**. Measured against this repo's existing plans, that third rule is the
dangerous one: `plan-pta-claimtrack-vertical-slice-00.md` alone would parse into nine "work
items" named `Problem statement`, `Decision`, `Governance / sequencing (hard requirements)`,
`Acceptance criteria` and `Stop condition`. Across `dev-memo/plan-*.md` the rule manufactures
**251 spurious items** from prose section headings.

So every heading in this file is unnumbered, and the only `WI-` labels are real work items.
The parser therefore finds exactly the items intended and nothing else.

**Do not add a numbered heading to this file.** It would become a task.

## What the review found

All 49 legacy plans are delivered. That was established from evidence, not from the plans'
own words:

- **Their deliverables exist.** Fourteen were checked directly against the tree — persistence,
  IPC handlers, router, i18n catalog, matter schema, packaged smoke, electron-builder config,
  the ABI probe, link handlers, page geometry, T3 export, the edit screen, claim tracks, and
  the FileVault probe. Every one is present.
- **They are old and untouched.** Median last-touch is early June 2026, with 600–1,280 commits
  landed since. A plan untouched across 1,200 commits, whose deliverable is in the tree, is
  delivered.

**The status words inside the plans are not trustworthy and were not used.** Only one of the 49
carries a `**Status:**` line at all, and a first-match scan for status keywords reports
`plan-pta-claimtrack-vertical-slice-00.md` and `plan-matter-details-edit-00.md` as `DRAFT` while
`viewMatterClaimTracks.ts` and `editMatter.ts` both sit in the tree. Those are stale headers from
before the work started. Existence of the deliverable was used instead.

## Ledger

| Plan family | Files | Disposition | Evidence |
|---|---|---|---|
| `case-box-step-1` … `-6`, `case-box-persistence-B1/B11` | 8 | delivered | `SqliteCaseBoxPersistence.ts` |
| `casebox-ipc-impl-01`, `casebox-ui-plan-00`, `first-ui-shell-00`, `ui-substrate-decision-00`, `casebox-ui-design-hardening-00` | 5 | delivered | `caseBoxHandlers.ts`, `router.ts` |
| `batch-casebox-evidence-a3-*` (link, unlink, anchor, cascade, resolver, schema, geometry, export) | 10 | delivered | `linkHandlers.ts`, `schema.ts` |
| `batch-casebox-evidence-*` (workflow-port, product-definition, a07-feasibility) | 3 | delivered as scoped | see A0.7 note below |
| `brief-matter-type*`, `brief-doc-*`, `client-00` | 5 | delivered | matter schema, document handlers |
| `i18n-00`, `i18n-impl-00` | 2 | delivered | `renderer/i18n/catalog.ts` |
| `packaging-smoke-00`, `desktop-package-architecture-00`, `desktop-pkg-arch-tarball-poc-01`, `pkg-verify-detection-redesign-00`, `packaged-probe-verification-00`, `abi-00-better-sqlite3` | 6 | delivered | packaged smoke suite, signed builder config |
| `encryption-at-rest-00` | 1 | delivered | `src/security/fileVaultProbe.ts`; FileVault on since 2026-08-29 |
| `forms-t3-evidence-catalog-00` | 1 | T3 delivered; T4 deferred post-v1 by owner decision | `t3-docx-export.unit.test.mjs` |
| `matter-details-edit-*` | 3 | delivered | `renderer/screens/editMatter.ts` |
| `pta-claimtrack-vertical-slice-00`, `pta-vs0-party-identity-00` | 2 | delivered | `viewMatterClaimTracks.ts` |
| `go-live-readiness-00`, `go-live-plan-reconcile-00` | 2 | agent-owned gates cleared; owner-owned gates open | see owner decisions below |
| **Total** | **49** | **no outstanding agent work in any of them** | |

## Work items

Each item below is unshipped, doable, and independently verifiable. Verification for every item
is the repo gate — `npm --prefix apps/lawbar-desktop test`, `check:no-real-data:all`, and
`node scripts/docs/check-doc-references.mjs` — not merely "a test ran".

### WI-1 — Serialize opens, and stop returning a path nobody needs

**Done:** 2026-09-08
**Changed:** apps/lawbar-desktop/src/caseBox/documentOpen.ts, apps/lawbar-desktop/tests/document-open.test.mjs
**Verified:** gate commit — 9 lanes pass (contract 564, case-box-persistence 706+1 todo, ocr-ingestion 30, ocr-review 38, evidence-core-js 38, ocr-persistence 232, ocr-worker-bakeoff 92, ocr-worker 479, workflow-scripts 214) · gate desktop — 1307 pass, 0 fail, 579.6s · no-real-data OK (693 files) · doc-references 172/172 · mutants: M1 remove-serialization killed (1 failure, the WI-1 test), M2 restore-openedPath killed (1 failure, shape test); M3 queue-poison unkillable by construction — `runOpen` never rejects, so the `.catch` is unreachable defence-in-depth, stated in the source rather than claimed
**Note:** this item's first Done-when clause — "neither observing a vanished copy" — was found untestable: the audit's ordering fix already prevents an in-flight reveal's directory from being disposed, so a test asserting that hazard passed WITHOUT serialization. The property serialization actually guarantees, and the test now pins, is ordering: the LAST-REQUESTED open is the copy that survives even when an earlier, slower open finishes later.

Two defects that are one design decision. `previousCopyDir` is a module-global: call A creates
its copy, call B disposes it while A is still inside `reveal`, and A reports success pointing at a
path that no longer exists. And the success payload returns `openedPath` — a filesystem path,
across a boundary whose stated invariant is that paths never cross it — to a caller that has no
use for it, because `reveal` already handed the file to the OS inside the function.

"One renderer, one request at a time" is an unenforced UI convention, defeated by a double-click.
Fix it at the engine: a main-process FIFO over the complete dispose → verify → copy → handoff
sequence, where a failure inside one operation cannot poison the queue for the next. Return
status, not a path.

**Done when:** two opens issued concurrently both complete without either observing a vanished
copy; the success type carries no `openedPath` and a shape test pins that; removing the
serialization turns the concurrency test red, and re-adding the path turns the shape test red.

### WI-2 — Stream the copy with incremental hashing

**Done:** 2026-09-08
**Changed:** apps/lawbar-desktop/src/caseBox/documentOpen.ts, apps/lawbar-desktop/tests/document-open.test.mjs
**Verified:** gate commit — 9 lanes pass (contract 564, case-box-persistence 1267+1 todo, ocr-ingestion 30, ocr-review 38, evidence-core-js 38, ocr-persistence 232, ocr-worker-bakeoff 92, ocr-worker 479, workflow-scripts 214) · gate desktop — 1314 pass, 0 fail, 581.5s · no-real-data OK (693 files) · doc-references 172/172 · mutants: A restore-synchronous-read killed (1 failure — the window test, reporting 48 -> 48 ticks: 48 during verification, zero during the copy), B drop-digest-check killed (1 failure, the mismatch test)
**Note:** three things went wrong on the way and are recorded so the Verified line is not read as smoother than it was. (1) The first responsiveness test counted ticks across the WHOLE open and stayed green with the synchronous read restored — the verifier's own async work fired the timer before the copy began; it measured the wrong window and was rewritten to isolate the copy between verify-return and reveal-arrival. (2) The 64 MB fixture's fill constant, written in decimal, matched the repo's `phone-us` privacy pattern; the desktop lane's pretest scan refused to start (runner-error at 2.6s). Rewritten as hex, same value; the pattern was not weakened. (3) The gate driver's TAP parsing under-reported multi-suite lanes (first-match 707, last-match 288 for a lane whose true total is 1268); it now sums every summary block, and the persistence figure above is the summed one.

`readFileSync` buffers the entire document on Electron's main process, then the write buffers it
again. The owner's store already holds an 86.8 MB original. Every IPC response and window
operation stalls for the duration of that read — the app does not freeze visually, it stops
answering.

Copy from the already-open descriptor through a stream, hashing as the bytes pass, writing the
temp copy as they arrive, and only revealing once the digest matches. Bounded memory regardless of
document size.

**Done when:** a 64 MB synthetic original copies and verifies; a timer started before the copy
fires at least once DURING it (with the synchronous read it fires zero times — measured earlier
in this repo, and the inverse of the flaky-timer lesson); the digest is still checked before
reveal; and a mutant that restores the synchronous read turns the responsiveness test red.

### WI-3 — Classify a post-open read failure as unverifiable, not as open_failed

**Done:** 2026-09-08
**Changed:** apps/lawbar-desktop/src/caseBox/documentOpen.ts, apps/lawbar-desktop/tests/document-open.test.mjs
**Verified:** gate commit — 9 lanes pass (contract 564, case-box-persistence 1267+1 todo, ocr-ingestion 30, ocr-review 38, evidence-core-js 38, ocr-persistence 232, ocr-worker-bakeoff 92, ocr-worker 479, workflow-scripts 214) · gate desktop — 1316 pass, 0 fail, 582.7s · no-real-data OK (693 files) · doc-references 172/172 · mutants: A read-side-reported-as-open_failed killed (1 failure), B every-failure-reported-as-unverifiable killed (1 failure, the mid-stream ENOSPC test)
**Note:** the classification uses event ORDER — the originating stream emits `error` before pipeline destroys the others with the same object — because neither identity nor `stream.errored` can tell the sides apart. The read side is injectable (a read error cannot be induced on a real regular file); the write side is NOT — it is exercised for real, by pointing TMPDIR at a 2 MB volume and copying a 16 MB original until ENOSPC. That test replaced a first version that pointed TMPDIR at an unwritable directory: mkdtemp threw BEFORE the pipeline, the outer catch answered, and the pipeline's write-side branch was never reached — mutant B stayed green against it, which is how the hollow test was found. A read failure BEFORE the pipeline (openSync itself failing) was already `document_unverifiable` from the audit fix and is unchanged.

A source that cannot be opened is now `document_unverifiable`. A read that fails AFTER a
successful open still falls through to the outer catch as `open_failed`, whose documented meaning
is "the copy could not be produced or handed to the OS". Those are different facts: one is about
the evidence, the other about this machine.

**Done when:** a read failure after open yields `document_unverifiable` with reason `unreadable`;
`open_failed` is reachable only from the copy and hand-off steps; a mutant collapsing the two
codes turns a test red.

### WI-4 — A compensating identity check, and a containment claim that is true

**Done:** 2026-09-08
**Changed:** apps/lawbar-desktop/src/caseBox/documentOpen.ts, apps/lawbar-desktop/tests/document-open.test.mjs
**Verified:** gate commit — 9 lanes pass (contract 564, case-box-persistence 1267+1 todo, ocr-ingestion 30, ocr-review 38, evidence-core-js 38, ocr-persistence 232, ocr-worker-bakeoff 92, ocr-worker 479, workflow-scripts 214) · gate desktop — 1318 pass, 0 fail, 577.9s · no-real-data OK (693 files) · doc-references 172/172 · mutants: A remove-containment-check killed (1 failure — the identical-bytes swap test, which without the check OPENS a file outside custody); B remove-(dev,ino)-identity-check SURVIVED
**Note:** mutant B's survival is the measurement, not a gap left open. The identity comparison guards an inode replaced in place AFTER the open, a window no test can reach from outside the function, so it cannot be killed and is recorded as defence in depth. The header now states the residual outright: containment is re-established by re-resolving the path under the resolved store root and by matching (dev, ino) against the descriptor, which refuses a leaf swapped for a symlink after verification and a leaf replaced after open; a swap landing between the final resolve and the open cannot be excluded without openat-style traversal, which Node does not expose. The swap test uses IDENTICAL bytes elsewhere on purpose — every content check passes, so only custody can refuse it. Also fixed on the way: WI-3 had named the read stream `source`, shadowing the path variable; WI-4's re-resolve hit that shadow in its temporal dead zone, tsc emitted anyway, and 14 tests went red until the stream was renamed `readStream`.

The verifier establishes containment on a PATH. The descriptor opened afterwards re-asserts
`isFile()` and `nlink === 1`, which carries file-type and exclusive-custody forward — but not
containment. Node has no `openat`-style API to close that fully.

Do the two things that are honest: after opening, re-resolve the source with `realpath`, `stat`
it, and compare `(dev, ino)` against `fstat` on the descriptor — an ordinary swap of the leaf is
caught. Then narrow the comment to state exactly what is and is not proved, and record the
residual in the module header. Do not call repeated path checks closure.

**Done when:** a verifier stub that swaps the leaf for a symlink after verifying is refused as
`document_unverifiable` / `outside_store`; the header names the residual race as unproved; a
mutant removing the identity comparison turns the swap test red.

### WI-5 — Wire controlled document opening into main and preload

**Done:** 2026-09-08
**Changed:** apps/lawbar-desktop/src/caseBox/documentOpenHandlers.ts (new), apps/lawbar-desktop/src/caseBox/documentOpen.ts (lookup made awaitable), apps/lawbar-desktop/electron/main.ts, apps/lawbar-desktop/electron/preload.mts, apps/lawbar-desktop/tests/document-open-handlers.test.mjs (new), apps/lawbar-desktop/tests/document-open.electron.test.mjs (new), apps/lawbar-desktop/package.json (scripts.test)
**Verified:** gate commit — 9 lanes pass (contract 564, case-box-persistence 1267+1 todo, ocr-ingestion 30, ocr-review 38, evidence-core-js 38, ocr-persistence 232, ocr-worker-bakeoff 92, ocr-worker 479, workflow-scripts 214) · gate desktop — 1331 pass, 0 fail, 574.4s (up 13: the 10 handler and 3 Electron tests) · no-real-data OK (696 files) · doc-references 172/172 · real Electron process, isolated profile: bridge exposes exactly `open`, the channel answers from main, an extra `path` field is refused as invalid_request before any lookup, an unknown identity is unknown_document · mutants: A drop-tenant-check-on-matter killed (1 failure), B drop-matter-check-on-document killed (1 failure), D accept-extra-keys killed (1 failure), C forward-outcome-unchanged SURVIVED
**Note:** three things worth recording. (1) Mutant A survived at first: the other-tenant test seeds matter and document in the same foreign tenant, so the document's tenant check catches it and the matter's is redundant there. The invariant the matter check actually guards — a document row claiming the active tenant while its matter_id points at another tenant's matter — had no test; it does now, and A dies on it. (2) Mutant C survives by construction: the engine's outcome carries no field beyond ok/code/reason today, so rebuilding the IPC result is indistinguishable from forwarding it. It stays as the whitelist that stops a future engine field from crossing by default, and is named here rather than claimed. (3) Two test defects found while wiring: the bridge test asserted `open.length === 1`, but contextBridge proxies every function with length 0 regardless of signature (measured: actual 0 while the calls worked), so arity is untestable at the bridge and the assertion was replaced by the behaviour it stood for; and a handler test used an object-literal `__proto__` as an "extra field", which sets the prototype and adds no key — the handler rightly accepted it, and the case is now built with JSON.parse so the own key exists. OUTSTANDING, outside this item: the backup Electron test's `run.length === 0` assertion is vacuous for the same contextBridge reason and should be replaced by a behavioural check.

The engine exists on branch `feat/document-open-controlled` (`src/caseBox/documentOpen.ts`,
10 tests, 5 of 6 mutants killed) and is reachable from nothing. Add the `document:open` channel,
register it in `startProduct()` where the storage root already resolves, and expose it through
the preload bridge.

The bridge takes `{matterId, documentId}` and **no path** — main resolves and authorizes, exactly
as `chooseDocumentFile`, the T3 export and `backup:run` already do. Failures cross as codes, never
messages: a refusal detail can carry a filename, and a filename can carry a client's name.

**Done when:** the channel answers in a real Electron process with an isolated profile, the
bridge exposes no path parameter, and the arity is asserted so one cannot be added later.

### WI-6 — Renderer surface for opening an original

**Done:** 2026-09-08
**Changed:** apps/lawbar-desktop/renderer/screens/viewMatterDocuments.ts, apps/lawbar-desktop/renderer/i18n/catalog.ts, apps/lawbar-desktop/renderer/i18n/ui-strings-allowlist.json (reseeded: same 109 entries, line numbers only), apps/lawbar-desktop/tests/renderer-document-open.test.mjs (new), apps/lawbar-desktop/package.json (scripts.test)
**Verified:** gate commit — 9 lanes pass (contract 564, case-box-persistence 1267+1 todo, ocr-ingestion 30, ocr-review 38, evidence-core-js 38, ocr-persistence 232, ocr-worker-bakeoff 92, ocr-worker 479, workflow-scripts 214) · gate desktop — 1340 pass, 0 fail, 573.7s (up 9: this item's tests) · i18n drift guard green · no-real-data OK (697 files) · doc-references 172/172 · mutants, 4 of 4 killed: altered-collapsed-into-retry (1 failure), control-rendered-with-no-bridge (1 failure), filename-sent-as-third-argument (1 failure), button-never-re-enabled (2 failures)
**Note:** the control is an optional LAST parameter on `renderDocumentsDisclosure`, defaulting to the preload bridge behind a `typeof window` guard, so `viewMatter.ts` and every existing caller are untouched and tests inject a stub; with no bridge, no control renders. It appears inside a row's detail body once the detail has loaded, in the row's existing lazy pattern. Copy: one string per code; `document_altered` is written as a FINDING and carries no 请重试 (a test pins it), and "done" says only what was proved — verified, read-only copy, original untouched. The allowlist is line-indexed and this screen carries 25 pinned entries; adding lines shifted them, so it was reseeded ONLY after a scan proved the (file, text, kind) multiset identical — 109 before and after, 0 added, 0 removed. A new bare literal would have been refused there and fixed in the source, not admitted to the list.

A control on the document row, and one catalog string per refusal code: `unknown_document`,
`document_missing`, `document_altered`, `document_unverifiable`, `open_failed`.

`document_altered` must not read as a transport failure. It is a finding about the evidence —
the bytes are no longer what was filed — and it must not invite a bare retry, which would repeat
the same result. Follow the backup screen's precedent: the failure copy names what to change.

**Done when:** every code maps to its own sentence, no filesystem text reaches the screen, and
the i18n drift guard stays green.

### WI-7 — Packaged acceptance for document opening

**Done:** 2026-09-08
**Changed:** apps/lawbar-desktop/tests/document-open.packaged.electron.test.mjs (new), apps/lawbar-desktop/src/caseBox/testSeed/documentOpenSeed.ts (new, env-gated, no arguments), apps/lawbar-desktop/electron/main.ts (`LAWBAR_DOCUMENT_OPEN_TEST_HOOK` — reveal-to-log substitute for `shell.openPath` and the seed hook, both inert unless the variable is exactly "true"), apps/lawbar-desktop/package.json (`test:document-open-packaged`)
**Verified:** packaged test against a fresh `npm run dist` — 1 pass (5.8 s + 30 s settle, wrapper exit 0) · MUTANT: `deps.reveal(source)` in place of `deps.reveal(copy)`, rebuilt with `npm run dist`, packaged test fails with "THE ORIGINAL WAS HANDED OVER"; engine restored (sha256 e6818103…), rebuilt, packaged test passes again · gate commit — 9 lanes pass (contract 564, case-box-persistence 1267+1 todo, ocr-ingestion 30, ocr-review 38, evidence-core-js 38, ocr-persistence 232, ocr-worker-bakeoff 92, ocr-worker 479, workflow-scripts 214) · gate desktop — 1350 pass, 0 fail, 565.5 s (shared with WI-9; the +10 are WI-9's guard, this item's test runs under the packaged wrapper, not in `scripts.test`) · no-real-data OK (700 files) · doc-references 172/172
**Note:** the mutant found a vacuous assertion before it found the defect. `tmpdir()` answers `/var/folders/…` while the app resolves the same directory to `/private/var/folders/…`, so `notEqual(path.resolve(copy), path.resolve(original))` could never be equal and the original-handed-over assertion could never fire; the mutant was first caught by the `lawbar-open-*` directory check, one line later, by accident. Both sides now go through `realpathSync`, and the mutant was re-run to confirm the NAMED assertion is the one that trips. The test drives the real UI (matter view → documents disclosure → row → 打开原件 → status line) across two launches of the packaged binary on one temp profile; the one `evaluate` is the seed. **Not done:** no CI step invokes `test:document-open-packaged` — `.github/workflows/desktop-release-gates.yml` carries the owner's uncommitted redesign and was not edited; the step is one line beside `test:acceptance-relaunch` when that lands. The CLAUDE.md "smoke matrix" phrase: this is a separate wrapper-driven test, not a new M-row in `casebox-ui.electron.test.mjs`, for the same reason the acceptance-relaunch drill is separate — it needs two process lifetimes.

The delivery plan requires restart and packaged-app acceptance for this item, and neither is
claimed by WI-5 or WI-6. Prove in the packaged app that a registered original opens, that the
copy handed to the OS is read-only, and that an altered original is refused after a restart.

**Done when:** the packaged smoke matrix covers it and the assertion fails if the original is
handed over instead of the copy.

### WI-8 — Stop paying for superseded CI runs

**Blocked:** half of this item was already true and the other half lives in a file the owner is mid-way through redesigning. (1) The concurrency group with `cancel-in-progress: true` has been in `desktop-release-gates.yml` since its first commit (bd8ce9e, lines 33–35 today), and it works: `gh run list` on 2026-09-08 shows the "four runs on one branch" was `feat/backup-ui-and-ipc` on 2026-09-02 — failure, **cancelled**, **cancelled**, success. The plan's sentence "each force-push left the previous run to finish" is wrong; cancelled runs still bill the minutes they ran, so the cost was real, but the fix exists and nothing was added. The other multi-run branch (`feature/pta-claimtrack-vertical-slice`, five runs on 2026-08-23) was sequential pushes after each run had finished, which no concurrency setting can save. (2) The draft-PR skip is genuinely absent, but `desktop-release-gates.yml` carries the owner's uncommitted `workflow_call` + `branches-ignore: [main]` edits, and the uncommitted `main-merge-gate.yml` already listens for `ready_for_review` and decides applicability in its own job — where a draft decision belongs, because that file's own rule is that a skipped required lane fails the gate. Editing the lane file underneath that design was not mine to do. When wired, the condition must be `github.event_name != 'pull_request' || github.event.pull_request.draft == false`; a bare `draft == false` also skips the job under `workflow_dispatch`, where the event carries no pull request.

Measured: the macOS gate is 28 runs in 30 days at ~16 minutes and a 10x multiplier, which is
about 4,480 billable minutes against a 2,000-minute allowance. One branch ran four times because
each force-push left the previous run to finish.

Add a concurrency group keyed on workflow and ref with `cancel-in-progress: true`, and skip the
gate for draft pull requests. Neither weakens CI as the enforcement boundary: the final push
still runs the full gate.

**Done when:** a second push to an open PR cancels the first run, and a draft PR runs no macOS
gate.

### WI-9 — Split the release-script tests out of the per-PR gate

**Blocked:** the workflow half. The lanes now exist and are proved, but wiring them into `desktop-release-gates.yml` (fast lane replaces `npm test` in the per-PR step; release-scripts lane under a paths condition) means editing the file that carries the owner's uncommitted `workflow_call` redesign, and the uncommitted `main-merge-gate.yml` decides every lane in one `applicability` job from a path table in `scripts/workflow/main-merge-gate.mjs` — the natural home for "run the four when `apps/lawbar-desktop/scripts/**` moved" is a NEW row there (its existing `scripts` output is `scripts/workflow/**`, a different lane), not a `paths:` filter bolted onto the lane file. Not edited. What IS done and verified below is everything the wiring will call.
**Done (package half):** 2026-09-08
**Changed:** apps/lawbar-desktop/scripts/test-lane.mjs (new), apps/lawbar-desktop/tests/test-lane.test.mjs (new, 10 tests), apps/lawbar-desktop/package.json (`test:fast`, `test:release-scripts`; `scripts.test` +1 file, now 82)
**Verified:** gate commit — 9 lanes pass (same run as WI-7) · gate desktop — 1350 pass, 0 fail (1340 → 1350, this item's guard) · mutants, 5 of 5 killed: drop one release file from the constant (2 failures), fast lane = everything (2), delete the missing-file refusal (2), swallow the child's exit status (1), stop stripping NODE_TEST_CONTEXT (1) · no-real-data OK · doc-references 172/172
**Superseded in part, 2026-09-10:** the 21-of-27-minute premise was TRUE when measured (584 s for the four suites vs 25 s for the other 78) and then dissolved: PR #294 fixed a lock in the release-script harness that spun 5,001 iterations per logged call, and the CI test step fell from 895 s to 56 s on the first run that carried it. The four suites are no longer the lane. The splitter and its guard stay (a dropped test is still refused; one list is still one list), but wiring `test:fast` into CI now saves about a minute a run and is not worth a follow-up. Second premise in this plan to dissolve under a fix that was already sitting in a pull request; the lesson is to merge before measuring.
**Note:** there is still exactly ONE hand-maintained list, `scripts.test`. The splitter parses it (refusing any shape other than `node --test tests/*.test.mjs …`, duplicates, or an empty list) and partitions it: `release-scripts` = the four named suites, `fast` = the rest. A release suite missing from `scripts.test` makes BOTH lanes refuse to run — a dropped test is not a faster lane. `--list <lane>` is the CLI seam CI can read. Two traps found while proving the runner: a nested `node --test` inheriting `NODE_TEST_CONTEXT` from the enclosing runner exits 0 whatever its files did (the child now has the variable stripped, and a test proves a red file reddens the lane); and the synthetic child's TAP leaked `ℹ fail 1` into the parent stream, which a summing parser would count — the test runs it with `stdio: "ignore"`. The `pretest` chain does not fire for `npm run test:<lane>`, so both scripts prepend it explicitly. The 22 on-disk test files not in `scripts.test` (wrapper seeders, packaged/electron suites run via the wrapper, the real-bundle signing test) are unchanged and out of scope; an on-disk-vs-list guard would need an allowlist and is not this item.

Measured: 17.7 of the gate's 20 minutes is the test step, and four files inside it —
`release-script-harness`, `release-preflight`, `release-preflight-failclosed`,
`verify-macos-signing` — exceed 21 minutes on their own against a 27-minute full lane. They
spawn `bash` and `codesign` repeatedly and cannot change when renderer copy changes.

Run those four only when `apps/lawbar-desktop/scripts/**` or the workflow changes, plus on
demand. Keep everything else on macOS: the product is macOS-only, and the umask defect proved
platform-specific failures are real here.

**Done when:** a renderer-only PR runs the fast lane, a scripts-touching PR runs both, and no
test is silently dropped from `scripts.test`.

### WI-10 — R2 evidence entry: the write path the catalogue has been waiting for

**Why this item exists, and why now.** R1 is on `main` (2026-09-10). R2's exit evidence is "a new
two-client matter with both-side material reaches a correct T3 after restart and isolated restore;
unadopted evidence is absent." Three subsystems for that already exist and are inert: the three
evidence schemas (`case-box-evidence-item` carries `status: proposed | accepted | rejected | superseded`,
`party_side`, `evidence_title`, `proof_statement`, `display_order`, `exhibit_page_range`), the
persistence write API (`appendEvidenceItem`, `transitionEvidenceItem`, `getEvidenceItem`,
`listEvidenceItems`), and the T3 catalogue read channel, preview and DOCX export (S0–S3, shipped).
**No production code calls `appendEvidenceItem`, and no `casebox:evidence:*` write channel exists**,
so the catalogue can only ever be empty on a real matter. This item is the smallest change that turns
three shipped subsystems into a workflow.

**What was checked before writing this, so the item is not built on a misreading.**
- *Is the T3 table filing-shaped?* A premortem argued, from 《民事诉讼证据的若干规定》第十九条, that the
  export lacks required columns (来源, 副本份数, 提交日期) and that fields must come before a screen.
  That reading was wrong for this repo. DR-00 (`dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §A,
  §H, 2026-07-02, an owner decision grounded on a filed 证据目录及说明 read in place) records the real
  form: exactly four columns — 序号 / 证据名称 / 证明内容 / 页码 — which is exactly what
  `t3DocxExport.ts` emits. 来源 is not a column; 提交时间, signature and 复印件/原件 are a FOOTER block
  and a footer note. DR-00 further decides the form is an internal trial-review tool this phase, so
  the footer is not required yet. Adding the footer when the form becomes a filing artifact is an
  export-level change with no schema impact. **Not this item.**
- *Does A0.7 block this?* No, and the plan should say so. A0.7 gates PDF-rendered geometry (page/region
  citations, anchors, previews — R5). An evidence-item record consumes none of it; `exhibit_page_range`
  is lawyer-typed and the schema declines to constrain it. `docs/product/product-plan.md` lines 94 and
  153 say "No Evidence UI ships until it is genuinely green" unqualified; that sentence contradicts the
  plan's own R2 row. **Owner action, not mine:** amend both to "A0.7 gates only Evidence UI that consumes
  PDF-rendered geometry (R5); it does not gate R2 evidence-item records; any R2 screen that adds a
  preview, a jump-to-page, or a machine-derived page reference re-enters the gate." That file carries
  the owner's uncommitted edits and was not touched here.

**Scope.** Exactly the document-open shape (WI-5/6/7), applied to evidence items:
1. `casebox:evidence:create` / `casebox:evidence:transition` IPC handlers in `src/caseBox/`, validating
   the payload against the contract, tenant- and matter-scoped like every other case-box handler; codes
   not messages; no path or filesystem text crosses the boundary. `list` already exists for T3.
2. Preload entries; a renderer section on the matter view (sibling module, lazy, the documents-disclosure
   pattern): list per matter; create from a registered document ("promote this document to evidence" —
   `source_document_id` set, title prefilled from the document, NOT a standalone form, so an exhibit is
   described once); review; adopt / exclude (`accepted` / `rejected`); submitter side.
3. zh-CN catalog strings; allowlist reseeded only after a scan proves the multiset unchanged.
4. Tests: handler (real SQLite persistence, tenant/matter scoping, `__proto__` payloads), renderer
   (identity-only across the bridge, every code mapped to a sentence), Electron bridge, and a PACKAGED
   acceptance test that must read CELL TEXT out of the exported DOCX against an expected 证据目录 row —
   a round-trip-only assertion proves persistence and is mistaken for proof of usefulness.
5. Mutation pass on the handler's scoping and the screen's refusal copy.

**Done when:** in the packaged app, on one temp profile across two launches and one isolated restore,
a two-client synthetic matter with both-side material yields a T3 DOCX whose rows match the adopted
items in `display_order`, whose 页码 cells are the typed ranges, and in which every excluded item is
absent; `appendEvidenceItem` has a production caller; and the A0.7 amendment above is in the plan.

**Deliberately not in this item:** the footer block (DR-00: not this phase); any page preview, page
jump or OCR-derived reference (re-enters A0.7); T4/T5 (gated by their own plan); a standalone
evidence form unlinked to a document.

## Not work items — owner decisions

These are recorded so the review is complete. They are **not** for an executor and must not be
implemented.

- **Gate 11 — 律师法 confidentiality.** Reserved to the owner and their counsel. No engineering
  step clears it, and none should be attempted.
- **Gate 4 — signing, notarization, distribution.** Needs the owner's Apple credentials and a
  channel decision.
- **Gate 21 — final public go-live.** Blocked on 4, 11 and 17 for external release.
- **A0.7 renderer-conformance.** `product-plan.md` states D5 remains open ("nothing can prove the
  gate ran"), while PR #281 recorded an owner decision on D5. Those two readings disagree and the
  disagreement is the owner's to settle. Do not treat either as settled, and do not start Evidence
  UI or geometry work until it is.
- **Merging `#293` and `#294`, and pushing `feat/document-open-controlled`.** Remote movement is a
  per-instance owner authorization in this repo.

## Stop condition

If a work item above turns out to be already implemented, stop and report it rather than editing
around it — that means this review was wrong and the ledger needs correcting, not the code.
