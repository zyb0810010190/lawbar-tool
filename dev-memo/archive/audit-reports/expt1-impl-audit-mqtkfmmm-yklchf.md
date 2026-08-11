**Findings**

Low: [exportCitationQueries.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/src/sqlite/exportCitationQueries.ts:146) contains literal NUL bytes as map-key separators. `tsc --noEmit` accepts it, but normal tooling now treats the file as binary (`file` reports `data`; byte scan found 5 NULs). Fix by replacing the literal NUL with an escaped separator constant, e.g. `const KEY_SEP = "\u0000";`, and use `${a}${KEY_SEP}${b}`.

No Critical/High/Medium findings. The implementation runs `resolveLinkStatuses` before reading links, scopes reads by tenant/matter, uses parameter binding, preloads maps rather than per-link queries, reads citation identity only from `payload_json`, degrades malformed/non-citable/ambiguous cases, emits no `REPLACED`/audit events, and keeps schema/resolver/dependencies untouched. Tests cover the required rungs and package wiring is test-only.

Verification note: `npm exec tsc -- --noEmit -p tsconfig.json` passed. Direct `node --test tests/hardening-export-citation.test.mjs` could not execute behavior because the local `better-sqlite3` native binding is built for NODE_MODULE_VERSION 137 while the current Node requires 141.

AUDIT-VERDICT: PASS C0 H0 M0 L1
