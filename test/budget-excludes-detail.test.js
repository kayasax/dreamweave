"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-excludes-detail-"));
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
const ins = db.prepare("INSERT INTO nodes(signature,memory_id,kind,class,notes,fact,strength) VALUES (?,?,?,?,?,?,?)");
ins.run("fact:active", "m-active", "fact", "episodic", "harness-ingest", "Active projected fact.", 0.5);
ins.run("fact:detail", "", "fact", "episodic", "detail", "Verbatim detail evidence.", 0.5);
ins.run("fact:archive", "", "fact", "episodic", "archive", "Cold archive evidence.", 0.5);
db.close();

const budget = JSON.parse(run("budget"));
const doctorRun = spawnSync(process.execPath, [DREAM, "doctor"], { env, encoding: "utf8" });
const doctor = JSON.parse(doctorRun.stdout);
if (budget.facts !== 1) fail(`budget counted detail/archive evidence as active: ${JSON.stringify(budget)}`);
if (doctor.facts !== 1) fail(`doctor counted detail/archive evidence as active: ${JSON.stringify(doctor)}`);

console.log("PASS: detail and archive rows do not count as active memory pressure");
