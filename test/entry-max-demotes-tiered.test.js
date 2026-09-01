"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-max-demotes-tiered-"));
const DREAM = path.join(__dirname, "..", "src", "dream.js");
const env = {
  ...process.env,
  AGENT_MEMORY_DIR: dataDir,
  MEMORY_ENTRY_TARGET: "3",
  MEMORY_ENTRY_MAX: "5",
  MEMORY_TIER2_MAX: "20",
};

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }
function run(...args) {
  return execFileSync(process.execPath, [DREAM, ...args], { env, encoding: "utf8" });
}

run("init");
const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);
const ins = db.prepare("INSERT INTO nodes(signature,memory_id,kind,class,notes,fact,strength,last_decayed,dirty_seq) VALUES (?,?,?,?,?,?,?,?,?)");
for (let i = 0; i < 7; i += 1) {
  ins.run(`fact:old-${i}`, `m-old-${i}`, "fact", "episodic", "harness-ingest", `Old fact ${i}.`, 0.1 + i * 0.01, "2026-01-01T00:00:00.000Z", i + 1);
}
db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('last_dream_seq','7')").run();
db.close();

const beforeBudget = JSON.parse(run("budget"));
if (beforeBudget.forecast.demote_to_archive_for_active_max !== 2) fail(`budget did not forecast active demotion: ${JSON.stringify(beforeBudget)}`);
if (beforeBudget.forecast.evaporate_episodic !== 0 || beforeBudget.forecast.evaporate_semantic !== 0) fail(`tiered budget should not promise deletion-style evaporation: ${JSON.stringify(beforeBudget)}`);

const result = JSON.parse(run("dream", "--run-id", "entry-max-demotes-tiered"));
const budget = JSON.parse(run("budget"));
if (result.facts > 5) fail(`dream did not enforce active max: ${JSON.stringify(result)}`);
if (result.demoted_for_entry_max !== 2) fail(`expected 2 entry-max demotions: ${JSON.stringify(result)}`);
if (budget.facts > 5) fail(`budget still over active max after dream: ${JSON.stringify(budget)}`);

const verify = new Database(path.join(dataDir, "memory.db"));
const archived = verify.prepare("SELECT count(*) c FROM nodes WHERE kind='fact' AND notes='archive'").get().c;
verify.close();
if (archived !== 2) fail(`expected archive to preserve demoted facts, found ${archived}`);

console.log("PASS: tiered dream demotes overflow beyond active entry max");
