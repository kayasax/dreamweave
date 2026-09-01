"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-merge-exact-"));
const DREAM = path.join(__dirname, "..", "src", "dream.js");
const env = { ...process.env, AGENT_MEMORY_DIR: dataDir };

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }
function run(...args) {
  return execFileSync(process.execPath, [DREAM, ...args], { env, encoding: "utf8" });
}

run("init");
const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);
const ins = db.prepare("INSERT INTO nodes(signature,kind,class,first_seen,source_day,fact,text,strength,dirty_seq) VALUES (?,?,?,?,?,?,?,?,?)");
const fact = "Alice owns the migration checklist for the January rollout.";
ins.run("fact:a1", "fact", "episodic", "2026-01-01", "2026-01-01", fact, fact, 0.5, 1);
ins.run("fact:a2", "fact", "episodic", "2026-01-02", "2026-01-02", fact, fact, 0.5, 2);
db.prepare("INSERT INTO nodes(signature,kind,class,first_seen,fact,dirty_seq) VALUES ('person:alice','entity','semantic','2026-01-01','',1)").run();
db.prepare("INSERT INTO edges(src,rel,dst,weight) VALUES ('fact:a1','mentions','person:alice',0.8)").run();
db.prepare("INSERT INTO edges(src,rel,dst,weight) VALUES ('fact:a2','mentions','person:alice',0.8)").run();
db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('change_seq','2')").run();
db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('last_reflect_seq','0')").run();
db.close();

run("weave");
const applied = JSON.parse(run("auto-merge-exact", "--sim", "0.1", "--limit", "10"));
if (!applied.complete || applied.clusters_merged !== 1 || applied.decisions !== 1) {
  fail(`auto exact merge did not apply one safe duplicate cluster: ${JSON.stringify(applied)}`);
}
const health = JSON.parse(run("doctor"));
if (!health.healthy) fail(`doctor unhealthy after auto exact merge: ${JSON.stringify(health)}`);

console.log("PASS: auto-merge-exact applies exact duplicate consolidation safely");
