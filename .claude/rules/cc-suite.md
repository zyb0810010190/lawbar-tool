---
description: cc-suite is a set of slash commands, NOT skills. Never invoke via the Skill tool. For high-risk WIs, stop and ask if slash commands cannot be invoked autonomously.
applies-to: "**"
---

# cc-suite Slash Command Workflow

The cc-suite plugin (`cc-suite@xiaolai`) provides **Claude Code slash commands** — NOT Skills. Earlier autonomy text in this repo conflated the two; this rule corrects that.

## Hard rule

**Never invoke** `Skill(cc-suite:review-plan)` / `Skill(cc-suite:audit)` / `Skill(cc-suite:verify)` (or any `Skill(cc-suite:*)`). The Skill tool returns `Unknown skill: cc-suite:review-plan` and the WI cannot rely on it.

cc-suite commands surface as user-typed slash commands:

- `/cc-suite:review-plan`
- `/cc-suite:audit`
- `/cc-suite:audit-fix`
- `/cc-suite:verify`
- `/cc-suite:status`
- `/cc-suite:result`
- `/cc-suite:continue`
- `/cc-suite:cancel`

Whether Claude can autonomously trigger slash commands depends on the current Claude Code session. Treat the capability as **not assumed** unless the session explicitly enables it.

## Decision matrix

When a WI needs `/cc-suite:review-plan` (or any other cc-suite gate):

```
high-risk WI? → YES → can Claude autonomously invoke slash commands?
                          ↓ NO
                       STOP and ASK the user to run the slash command manually.
                       Do NOT substitute self-review.

                ↓ YES (low-risk)
              self-review fallback IS allowed; record the four fields
              listed in §"Self-review fallback recording".
```

## High-risk WIs (cc-suite review IS required; do NOT silently self-review)

If the WI touches any of the following, a self-review fallback is NOT acceptable. Stop and ask the user to run the slash command manually:

- Persistence / database (including new package introduction).
- Security / TLS / DNS / SSRF / auth / sandboxing / crypto.
- Cloud / sync / external document exposure / external account.
- Public API / wire-format / schema / CLI breaking changes.
- Framework / runtime dependency choices (Electron / Tauri / SQLite / native modules).
- Irreversible migrations or production data operations.
- LLM extractor implementation (Step 8 future-implementation gate).
- Sync bridge implementation (`docs/adr/sync-bridge-architecture.md` SYNC-01+).

The list intentionally overlaps with the [[autonomy]] hard-stop list. Even when the autonomy rule itself does NOT trigger a hard-stop (e.g. a docs-only ADR that DESCRIBES a security boundary), the cc-suite review-plan gate may still apply because the plan governs the eventual high-risk work.

## Low-risk WIs (self-review fallback IS allowed)

Self-review is acceptable for:

- Docs-only low-risk ADRs (e.g. multi-user-readiness policy where the contract already encodes the invariants, or a forward-reference doc that adds no implementation surface).
- Formatting / documentation cleanup.
- LOC / reporting work (counter output, optimizer suggestions, scan reports).
- Cases where cc-suite is verifiably unavailable AND the fallback is explicitly recorded per §"Self-review fallback recording".

## Self-review fallback recording

If self-review is used INSTEAD OF `/cc-suite:review-plan`, the WI MUST record all four of the following — either in the commit message or in the dev-memo plan file:

1. **Why cc-suite could not be invoked** — e.g. "Skill tool returned Unknown skill error; slash command not autonomously invokable in this session".
2. **Scope reviewed** — the doc, plan, or change set that was self-reviewed.
3. **Findings** — what the self-review surfaced (issues + fixes applied, OR a positive statement "no findings").
4. **Why the fallback is acceptable for this WI** — cite the category from §"Low-risk WIs". If the WI is in the high-risk category, the fallback is NOT acceptable — go to §"Decision matrix" instead and stop-and-ask.

## When asking the user to run cc-suite manually

Phrase the request precisely so the user can copy-paste:

> Run `/cc-suite:review-plan <path-to-plan>` (or the appropriate command) and paste the findings back to me. I will fix and re-stage.

After the user provides the findings, treat them as a normal review-output pass: apply fixes, optionally re-request review, then commit.

## Failure handling

- `/cc-suite:status` returning an unhealthy / un-authenticated bridge state — surface to user; do NOT proceed.
- Slash command attempted but unavailable in the session — fall back to the §"Decision matrix": low-risk = self-review with recording; high-risk = stop and ask.

## Cross-references

- [[autonomy]] — hard-stop list; cc-suite-required categories often (but not always) overlap.
- [[security-boundary]] — security-sensitive scope; cc-suite review-plan is required before implementation.
- [[../skills/security-wi-loop/SKILL]] — security WI loop; the review-plan step in that skill IS a `/cc-suite:review-plan` invocation, never a Skill call.
- [[../skills/project-autopilot/SKILL]] — autopilot loop; same.
- [[../skills/client-architecture-reconcile/SKILL]] — reconciliation skill; the review-plan step there is also a slash command, not a Skill.
