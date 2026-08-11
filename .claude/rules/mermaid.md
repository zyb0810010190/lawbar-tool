---
path: posts/**/*.md
---

# Mermaid validation

Every fenced ```mermaid block in a draft is validated before the draft is posted.

A diagram that does not parse is a defect in the draft, not a rendering problem to fix
later. Validate it where it is written.

- Check that the block declares a diagram type on its first line (`flowchart`, `sequenceDiagram`,
  `stateDiagram-v2`, `erDiagram`, …). A bare ```mermaid with no type is the most common failure.
- Node labels containing `(`, `)`, `:`, `,` or `#` must be quoted: `A["Rule 30(b)(6) notice"]`.
- Every node referenced by an edge must be declared, and every subgraph closed with `end`.
- Keep it readable at a glance: if a diagram needs more than about a dozen nodes, it is
  carrying more than one idea and should be split.

Scope note: this rule is path-scoped to `posts/**/*.md` and applies to nothing else in this
repository.
