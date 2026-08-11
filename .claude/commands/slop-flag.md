---
name: slop-flag
description: Flag every LLM-slop pattern in the current draft without rewriting.
---

# slop-flag

Read the draft and report its slop. **Do not rewrite it.** The point is that the author sees
the pattern and decides — a silent rewrite teaches nothing and often flattens the voice
that made the piece worth writing.

Output a list. Each entry: the quoted phrase, its line, the pattern it matches, and why it
weakens the sentence. No summary paragraph, no score, no praise.

## Patterns to flag

**Throat-clearing.** Sentences that announce rather than assert — "It is important to note
that", "It's worth mentioning", "In today's fast-paced world", "When it comes to X". The
sentence almost always survives their deletion intact.

**The not-X-but-Y frame**, when the contrast is manufactured: "This isn't just about
evidence — it's about trust." Flag it whenever X and Y are not genuinely opposed.

**Tricolon on autopilot.** Three-item lists where the third item adds nothing and exists for
rhythm: "clear, concise, and compelling."

**Hollow intensifiers.** "very", "truly", "incredibly", "profoundly", "fundamentally",
"critically" — where deleting the word changes nothing.

**Abstraction where a fact belongs.** "significant improvements", "a range of challenges",
"various stakeholders". In legal writing especially: if a number, date, or party role is
known, the abstraction is a loss.

**Hedge stacking.** "may potentially", "could possibly suggest", "it seems likely that
perhaps". One hedge is honest calibration; three is evasion.

**Symmetry tics.** Every paragraph opening the same way; every section the same length; a
closing sentence that inverts the opening for effect rather than for meaning.

**Borrowed authority.** "Studies show", "Experts agree", "It is widely accepted" with no
citation. In a legal post this is worse than filler — it reads as an assertion of fact.

**The wrap-up that restates.** A final paragraph that re-lists what was just argued without
advancing it.

**Em-dash overuse** — more than roughly one per paragraph, where a comma or full stop would
carry the load.

## Also flag, and rank first

Anything that looks like a **real client identifier**: party names, case numbers, court
names tied to a live matter, dates specific enough to identify a proceeding, or an
unpublished fact. These outrank every stylistic finding and are reported at the top,
regardless of how the draft otherwise reads.

## Report format

```
L12  "It is important to note that the court declined"
     throat-clearing — the sentence starts at "the court declined"

L31  "various procedural challenges"
     abstraction — name them, or cut the clause
```

End with a count by pattern. Nothing else.
