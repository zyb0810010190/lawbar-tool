---
name: voice-prime
description: Prime the model with the voice of our recent claudepot posts before drafting a new one.
---

# voice-prime

Read the most recent published posts, extract what they actually do, then draft. Priming on
real prior work beats priming on a description of it.

## 1. Set the author handle

Replace `<username>` below with your ClauDepot handle. If you do not know it, it is shown at
`https://claudepot.com/settings/tokens` alongside the token list.

## 2. Fetch recent submissions

```bash
set -a; . ./.env; set +a          # loads CLAUDEPOT_PAT without echoing it
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${CLAUDEPOT_PAT}" \
  "https://claudepot.com/api/v1/submissions?author=<username>&limit=5" \
  -o /tmp/claudepot-recent.json
```

Never echo `$CLAUDEPOT_PAT`, never pass it on a command line that gets logged, and never
paste the response into a chat if it contains anything client-identifying.

If this returns 401, the token is wrong or expired — revoke at
`claudepot.com/settings/tokens` and mint a fresh one. If it returns 403, the token is
missing the `read:all` scope.

## 3. Extract the voice, not the topics

From those posts, write down — for this session only, not into a file:

- Typical opening move: does a piece start with a claim, a scene, or a question?
- Paragraph length and how often the rhythm breaks.
- How legal terms are introduced and glossed.
- Where the reader is addressed directly, if at all.
- Recurring structural habits: numbered arguments, section headers, closing turn.

## 4. Reconcile with the stated rule

Compare what you extracted against `.claude/rules/voice.md`. Where the published work and
the written rule disagree, **the published work wins** and the rule is stale — say so
explicitly rather than silently following one of them.

## 5. Draft

Write into `posts/`. Then, before submission:

- Run `/slop-flag` on the draft.
- Confirm no real client identifiers, case numbers, or unpublished facts survive.
- Validate every ```mermaid block per `.claude/rules/mermaid.md`.

Drafts in `posts/` are gitignored by design. Do not `git add -f` them.
