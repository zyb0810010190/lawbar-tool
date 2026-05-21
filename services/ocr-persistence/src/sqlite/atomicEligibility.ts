// Atomic-ingest path eligibility predicate. Extracted from
// SqliteOcrPersistence (LOC-01). Pure; no driver coupling.
//
// Atomic ingest is only safe on a SHARED on-disk file. Reject any path-shape
// that does not resolve to a real, separately-addressable file on disk: bare
// `:memory:`, empty/transient strings, and SQLite URI variants whose semantics
// put the database in memory (whether `file::memory:` or named `mode=memory`
// URIs like `file:foo?mode=memory&cache=shared`). Two distinct in-memory DBs
// both report identical `dbFilePath`, which would defeat the
// persistence ↔ queue same-store probe.

export function isAtomicEligiblePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path === ":memory:") return false;
  if (path.startsWith("file::memory:")) return false;
  // Named URI memory: `file:foo?mode=memory[&...]` — better-sqlite3 treats
  // this as a file path by default, but a future caller passing `{ uri: true }`
  // would make it an in-memory DB.
  if (path.startsWith("file:") && /[?&]mode=memory(\b|&|$)/.test(path)) {
    return false;
  }
  return true;
}
