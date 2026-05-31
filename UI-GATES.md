# UI gates (autonomous-grade)

The base UI lane (`ui-tokenize` enforcement + `ui-responsive` advisory) covers design-token
drift and responsive layout only. For an autonomous study-after-ship loop — where you won't
eyeball each UI change before it commits — add three regression gates.

> **Honest limitation (sourced, verified 2025–2026):** automated a11y gates are partial
> regression catchers, not accessibility certification. axe-core's own figure is ~57% of
> WCAG *issues by volume* detected automatically (Deque's study; the older "30–40%" figures
> measure WCAG *success criteria* instead — both are real, measuring different things), and
> axe marks uncertain cases "incomplete" for manual review. Playwright's own docs recommend
> combining automated checks with manual assessment and inclusive user testing. The specific
> risk for an autonomous loop: an AI fix that turns a check green may satisfy the scanner
> without fixing the underlying problem — and you won't catch that by eye. Treat these gates
> as a floor that stops *re-introducing* known-detectable defects, not as proof of access.

## Versions (verified Jan–Apr 2026)

```jsonc
// package.json — Lighthouse 13 dropped CommonJS; needs ESM + Node 22+
{
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "@axe-core/playwright": "latest",
    "lighthouse": "^13.0.0"
  }
}
```

## Gates

**A. Visual regression — Playwright `toHaveScreenshot()`**
Lock viewport, wait for fonts, `animations: 'disabled'`, mask dynamic regions to reduce
flake. First run writes baselines; later runs diff against them.
```bash
npm run test:visual
```

**B. Accessibility — `@axe-core/playwright`**
Scan each page in the suite; assert zero violations. Catches silently-introduced regressions
(removed aria-label, broken focus order, dropped landmark) that visual tests miss.
```bash
npm run test:a11y
```

**C. Performance — Lighthouse 13 via CDP**
Launch Chromium with `--remote-debugging-port`, run Lighthouse, assert budgets. Read INP via
`lhr.audits['interaction-to-next-paint']` (Lighthouse 13 first-class), fall back to TBT on
older versions.
```bash
npm run test:lighthouse
```

## Full UI lane

```
Claude Design (direction)
→ frontend-design (implement)
→ ui-tokenize (token enforcement, PreToolUse)
→ ui-responsive (responsive advisory, PostToolUse)
→ Playwright visual snapshots        (gate A)
→ axe-core accessibility             (gate B — partial; see limitation above)
→ Lighthouse budgets                 (gate C)
→ Codex audit
→ per-WI commit → batch audit
```

A failure in any gate is a Layer-C risk trigger: stop the batch, do not auto-advance.
