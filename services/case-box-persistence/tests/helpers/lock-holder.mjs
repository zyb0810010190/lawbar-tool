// Holds a real EXCLUSIVE lock on a SQLite file in a SEPARATE process. It must be a
// separate process: better-sqlite3 is synchronous, so a same-process lock holder would
// deadlock the test rather than exercise busy_timeout.
import Database from "better-sqlite3";
const db = new Database(process.argv[2]);
db.exec("BEGIN EXCLUSIVE");
db.prepare("INSERT INTO probe(b) VALUES ('lock')").run();
process.send("locked");
process.on("message", (m) => {
  if (m === "release") { db.exec("COMMIT"); db.close(); process.exit(0); }
});
