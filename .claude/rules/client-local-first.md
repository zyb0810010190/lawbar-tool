---
description: v1 client = Mac desktop, local-first by default; mini-program companion deferred; gateway is not a website
applies-to:
  - "docs/ui/**"
  - "docs/adr/*client*"
  - "docs/adr/*gateway*"
  - "docs/adr/*sync*"
  - "docs/adr/ocr-ui-gateway-architecture.md"
  - "dev-memo/plan-client-*.md"
  - "dev-memo/case-box-plan.md"
---

# Client / Local-First Posture

The v1 lawyer-client product direction is locked by `dev-memo/plan-client-00.md` D2 answers. Any plan, ADR, or doc under the paths above must respect this posture or explicitly justify why it diverges.

## Locked direction

- **v1 primary client** = **Mac desktop application**, single lawyer at a time.
- **Data default** = **local-first**. Lawyer's documents do not leave the Mac unless the user takes a deliberate action.
- **Cloud / sync** = **opt-in per document, per matter, or per explicit sync action**. Never per-account global default-on.
- **WeChat mini-program** = **companion channel only**, deferred. Read-mostly + minimal write. Sees only what is intentionally exposed.
- **Browser / web UI** = **deferred**. Not v1 primary.
- **Windows / iPad / native mobile** = deferred.
- **Multi-firm SaaS** = NOT v1. `tenant_id` is retained in schemas for forward compatibility only.
- **Auth provider choice** = Stop-and-Ask. v1 ships with no real auth provider; data shape stays multi-user-ready.

## HTTP gateway is not a website

If the GW-00 ADR (`docs/adr/ocr-ui-gateway-architecture.md`) or any successor describes an HTTP API gateway, it is an **in-process or local-loopback transport layer** for the Mac client and the (deferred) companion mini-program. It is not a public website, not a SaaS endpoint, not a multi-tenant cloud service.

## Reconciliation duty

Two pre-existing docs conflict with each other and partially with the locked direction:

- `docs/adr/ocr-ui-gateway-architecture.md` (GW-00) — HTTP gateway primary framing.
- `dev-memo/case-box-plan.md` — local-only, no HTTP, single-user MVP framing.

`dev-memo/plan-client-00.md` is the reconciliation source. Any new plan/ADR under the path scope above must cite `plan-client-00.md` when its framing differs from either source.

## Forbidden v1 framings

- "Multi-tenant SaaS lawyer portal."
- "Browser-first client."
- "Default-on cloud sync of lawyer documents."
- "WeChat-primary client."
- "Public HTTP API."

If a plan implies any of the above, reject the plan and force reconciliation through the [[../skills/client-architecture-reconcile]] flow.

Related: [[autonomy]], [[security-boundary]].
