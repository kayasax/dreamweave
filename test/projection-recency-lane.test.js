"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");
const { exportHarness } = require("../src/dream");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "projection-recency-"));
process.env.AGENT_MEMORY_DIR = dataDir;

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }

const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);

const insert = db.prepare(`INSERT INTO nodes(signature,memory_id,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated,strength)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
for (let i = 0; i < 600; i += 1) {
  insert.run(`fact:old-gist-${i}`, "", "fact", "semantic", "gist",
    `Old stable policy ${i}.`, `Old stable policy ${i}.`,
    "2026-06-01T00:00:00Z", "2026-06-01", "2026-09-01", "2026-09-01", 1);
}
for (let i = 0; i < 5; i += 1) {
  insert.run(`fact:recent-${i}`, "", "fact", "episodic", null,
    `Recent operational memory ${i}.`, `Recent operational memory ${i}.`,
    "2026-09-01T00:00:00Z", "2026-09-01", "2026-09-01", "2026-09-01", 0.1);
}

const projected = exportHarness(db, "2026-09-01");
const sigs = new Set(projected.map((r) => r.signature));
for (let i = 0; i < 5; i += 1) {
  if (!sigs.has(`fact:recent-${i}`)) fail(`recent memory ${i} was displaced by old gists`);
}
const firstRecent = projected.findIndex((r) => r.signature === "fact:recent-0");
if (firstRecent < 0 || firstRecent > 100) fail(`recent lane too deep in projection: index ${firstRecent}`);
console.log("PASS: Scout projection reserves a recency lane for new operational memories");
