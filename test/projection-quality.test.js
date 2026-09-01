"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");
const { exportHarness } = require("../src/dream");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "projection-quality-"));
process.env.AGENT_MEMORY_DIR = dataDir;

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }

const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);

const insert = db.prepare(`INSERT INTO nodes(signature,memory_id,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated,strength)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
insert.run("fact:clipped", "", "fact", "semantic", "gist",
  "This is a high strength but clipped memory ...", "This is a high strength but clipped memory ...",
  "2026-09-01T00:00:00Z", "2026-09-01", "2026-09-01", "2026-09-01", 1);
insert.run("fact:complete", "", "fact", "semantic", "gist",
  "This is a complete memory with enough detail to use directly.", "This is a complete memory with enough detail to use directly.",
  "2026-09-01T00:00:00Z", "2026-09-01", "2026-09-01", "2026-09-01", 0.1);

const projected = exportHarness(db, "2026-09-01");
const clippedIndex = projected.findIndex((r) => r.signature === "fact:clipped");
const completeIndex = projected.findIndex((r) => r.signature === "fact:complete");
if (completeIndex < 0 || clippedIndex < 0) fail("test records were not projected");
if (completeIndex > clippedIndex) {
  fail(`clipped projection outranked complete projection: complete=${completeIndex} clipped=${clippedIndex}`);
}
if (/SEMANTIC MEMORY/.test(projected[completeIndex].display)) fail("semantic envelope leaked into complete projection");

console.log("PASS: complete Scout projection facts outrank clipped gist summaries");
