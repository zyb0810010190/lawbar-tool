**Findings**

Low: [README.md](/Users/zhongyibao/ClaudeProjects/lawbar-tool/native/evidence-core-swift/README.md:54) says macOS CI is “now including the PDFKit probe test.” For WI-ENA4, the new coverage is the page-box probe test, so this line is stale/ambiguous. It should say `page-box probe test` or `all smoke probe tests`.

No Critical/High/Medium findings.

Scope checks passed: the probe only loads the existing fixture via `PDFDocument`, reads `page.bounds(for: .mediaBox)`, and returns only `loaded` plus `mediaBoxes` containing `width`/`height`. No cropBox, origin/CGRect leakage, transforms, conversion, normalization, anchor/citation/page-identity logic, rendering, thumbnails, A0.7 marker, provenance/HMAC, EVW5 hooks, UI behavior, dependency changes, new fixture, `Package.swift` change, or JS-shim touch found. Symbol names do not contain the forbidden roots; forbidden terms appear only in negative prose/comments.

I did not run `swift test`; the current session is read-only and SwiftPM would need build artifacts.

Verdict: **PASS with one Low README wording fix recommended before commit.**
