// Shared SQL-backed Set wrapper used by SQLite shadow-state shims for
// append paths whose in-memory helpers only call `.has(id)` + `.add(id)`
// on the state's id Set. Avoids the global-id-scan pattern flagged by
// B5 D4#2 by performing an indexed PK existence check per `.has()`
// call instead of pre-loading the full id set.
//
// Constructor takes the table name; the table MUST have a PRIMARY KEY
// column named `id` (every case_box_* lifted-column table does).
//
// If a future in-memory helper begins reading `.size` / iterating /
// calling other Set methods, the shadow shim caller MUST switch to a
// real matter-scoped Set + re-flag B5 D4#2 with a new occurrence. The
// missing methods are deliberately absent here so a regression surfaces
// as a runtime error rather than silently producing wrong results.

import type { Database } from "better-sqlite3";

export class SqliteBackedIdSet {
  readonly #db: Database;
  readonly #sql: string;
  readonly #local: Set<string> = new Set();

  constructor(db: Database, table: string) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
      throw new Error(`SqliteBackedIdSet: unsafe table name ${JSON.stringify(table)}`);
    }
    this.#db = db;
    // SQL injection-safe: table name validated above against
    // [a-z_][a-z0-9_]*; no user input reaches this template.
    this.#sql = `SELECT 1 FROM ${table} WHERE id = ?`;
  }

  has(id: string): boolean {
    if (this.#local.has(id)) return true;
    const row = this.#db.prepare(this.#sql).get(id);
    return row !== undefined;
  }

  add(id: string): this {
    this.#local.add(id);
    return this;
  }
}
