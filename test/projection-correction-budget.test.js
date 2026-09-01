"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");
const { exportHarness } = require("../src/dream");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "projection-correction-budget-"));
process.env.AGENT_MEMORY_DIR = dataDir;

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }

const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);

const insert = db.prepare(`INSERT INTO nodes(signature,memory_id,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated,strength)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
for (let i = 0; i < 200; i += 1) {
  const fact = `CORRECTION: Recent self-repair correction ${i}.`;
  insert.run(`fact:correction-${i}`, "", "fact", "episodic", null, fact, fact,
    "2026-09-01T00:00:00Z", "2026-09-01", "2026-09-01", "2026-09-01", 1);
}
for (let i = 0; i < 400; i += 1) {
  const fact = `Operational memory ${i} with concrete reusable detail.`;
  insert.run(`fact:operational-${i}`, "", "fact", "episodic", null, fact, fact,
    "2026-09-01T00:00:00Z", "2026-09-01", "2026-09-01", "2026-09-01", 0.5);
}

const projected = exportHarness(db, "2026-09-01");
const corrections = projected.filter((r) => /^CORRECTION/.test(r.display || r.fact || "")).length;
const operational = projected.filter((r) => /^(?:\[[^\]]+\]\s+)?Operational memory/.test(r.display || r.fact || "")).length;
if (corrections > 8) fail(`correction memories dominated projection: ${corrections}`);
if (operational < 300) fail(`operational memories were displaced: ${operational}`);
console.log("PASS: Scout projection caps correction memories so operational context remains visible");
