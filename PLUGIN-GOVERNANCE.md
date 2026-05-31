# Plugin governance — three control planes

The mistake this avoids: enabling every useful-sounding plugin up front. claudepot §9 calls
that "unused configuration." Three *separate* decisions govern every tool — conflating them
is what produced the over-built earlier version.

## The three planes

1. **Promotion — who: the human, on evidence.** "Has this failure mode happened enough to
   deserve automation?" A dormant plugin moves to enabled only after you've *seen* the
   problem it solves (Claude shipped an oversized file → promote loc-guardian). Neither
   Claude nor Codex decides this: Claude would be auditing itself, Codex would be scoping
   its own review, and two agents agreeing recreates the correlated-error trap the
   Codex-FAIL hard stop exists to prevent.

2. **Invocation — who: the Work Item type, deterministically.** Given a tool is enabled, the
   WI type decides if it runs this task. IMPL/TEST → tdd + loc; REVIEW → grill + docs;
   UI WI → ui-responsive + ui-tokenize; MEMORY/resume → echo-sleuth. No in-the-moment
   discretion — the declared type triggers the tool, and a skip shows in the pre-commit
   report rather than happening silently.

3. **Enforcement — who: a lifecycle event, only when mechanical.** A hook fires on a
   concrete event or it shouldn't exist. `PreToolUse` can *block* (runs before the call);
   `PostToolUse` can only *advise* (runs after the call succeeded — it cannot un-write a
   file). A hook bound to a fuzzy trigger ("architecturally significant") becomes noise or
   theater; that work stays in plane 2.

## Per-plugin posture

| Plugin | Startup state | Control plane | Notes |
|---|---|---|---|
| cc-suite | **enabled** | infrastructure | Backbone: Claude↔Codex delegation chain. Startup may do a light readiness check only. |
| echo-sleuth | **enabled** | invocation (resume/MEMORY) | This project is about multi-session workflow; recovery is core. Enabled ≠ auto-run — invoke on resume, never at SessionStart. |
| ui-tokenize | dormant → promote for UI repos | enforcement (PreToolUse) | Ships as a real blocking hook on UI writes. |
| ui-responsive | dormant → promote for UI repos | enforcement (PostToolUse, advisory) | Warns after UI writes; cannot block. |
| nlpm | dormant → promote for artifact-heavy repos | enforcement (PostToolUse, advisory) + manual | Ships an advisory hook; hard-blocking only with a strict, low-false-positive threshold. |
| loc-guardian | dormant → promote after repeated oversized files | enforcement | Advisory via PostToolUse; **hard block requires PreToolUse on `Write.content`** (PostToolUse is too late). Edit/MultiEdit hard-enforcement is fragile — reconstruct-before-write. |
| tdd-guardian | dormant → WI-invoked (IMPL/TEST) | invocation + commit gate | "Tests pass before commit" is hookable; "test first" is workflow discipline, not an event. |
| grill | dormant → WI-invoked (REVIEW/ARCH) | invocation | Semantic judgment; never a per-write hook. |
| docs-guardian | dormant → WI-invoked (API/docs WIs) | invocation | Staleness isn't knowable from one write event. |
| mermaid-preview | dormant → promote for diagram-heavy repos | event (Write/Edit of mermaid) | Preview convenience, not a gate. |

## Promotion mechanism

Project default (`.claude/settings.json`) keeps only cc-suite + echo-sleuth enabled.
Promote per repo via `.claude/settings.local.json` (see `settings.local.example.json`) —
local settings override project settings, so promotion is a per-checkout act that doesn't
change the shared default. Record *why* you promoted in `dev-memo/decisions/`.

## SessionStart

No broad SessionStart hook. Startup context is paid every session before you know the task.
The only defensible startup use is a tiny cc-suite readiness check (is Codex reachable?) —
returning a short status line, never a checklist dump or a "which guardians to use" decision.
Startup prepares the environment; it does not choose the workflow.
