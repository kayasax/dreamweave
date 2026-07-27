"use strict";

// REGRESSION: supersede/sequence lineage must keep running on a MATURE database.
//
// isToWeave() gates incremental work on n.dirty_seq. Any row set fed to it must SELECT
// that column -- otherwise the predicate reads `undefined`, coerces to 0, and returns
// false for every row, silently emptying the scan set. That is not a loud failure: weave
// still reports success, entity/co-mention edges still form, and every existing lineage
// test still passes, because they all run on a fresh db where `last_weave_seq` is absent
// and isToWeave short-circuits to a full scan. The bug only appears once a real
// deployment has completed one weave and persisted the cursor.
//
// Part A pins the behaviour on a mature db; Part B pins the invariant at the source.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-incremental-lineage-"));
process.env.AGENT_MEMORY_DIR = dataDir;

const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

// ---- Part A: behaviour on a mature (already-woven) database -----------------
const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);

const ins = db.prepare(
  "INSERT INTO nodes(signature,kind,class,strength,first_seen,notes,fact,text,dirty_seq) VALUES (?,'fact','episodic',0.4,?,NULL,?,'',?)"
);
// Already-woven history: dirty_seq at or below the persisted cursor.
ins.run("fact:condor-alert", "2026-01-02",
  "Project Condor SLA alert said the Germany region had 69.7 percent successful refreshes and might indicate a train regression.", 2);
// Newly arrived correction: dirty_seq ABOVE the cursor, so it is the only row to scan.
ins.run("fact:condor-correction", "2026-01-03",
  "Project Condor SLA alert was corrected: the Germany region result was an incomplete hourly bucket, not a train regression.", 3);

db.prepare("INSERT INTO nodes(signature,kind,class,strength,first_seen,notes,fact,text) VALUES ('project:condor','entity','semantic',0.5,'2026-01-01','weave-extract','','project condor|condor')").run();
const mention = db.prepare("INSERT INTO edges(src,rel,dst,weight) VALUES (?,'mentions','project:condor',1)");
mention.run("fact:condor-alert");
mention.run("fact:condor-correction");

// THE POINT OF THIS TEST: a mature db has already recorded a weave cursor.
db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('last_weave_seq','2')").run();
db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('change_seq','3')").run();
db.close();

execFileSync(process.execPath, [
  path.join(__dirname, "..", "src", "dream.js"),
  "weave", "--as-of", "2026-01-03T12:00:00.000Z",
], { env: { ...process.env, AGENT_MEMORY_DIR: dataDir }, encoding: "utf8" });

const db2 = new Database(path.join(dataDir, "memory.db"), { readonly: true });
const edge = db2.prepare(
  "SELECT count(*) c FROM edges WHERE src='fact:condor-correction' AND rel='supersedes' AND dst='fact:condor-alert'"
).get().c;
const cls = (db2.prepare("SELECT class FROM nodes WHERE signature='fact:condor-correction'").get() || {}).class;
db2.close();

if (edge !== 1) fail("incremental weave on a mature db did not create the supersede edge (subjSource was empty)");
// Supersede detection is the only in-place promoter that preserves source_day; if the scan
// set is empty, dated facts can never earn semantic durability again.
if (cls !== "semantic") fail(`correction was not promoted to semantic (class=${cls})`);

// ---- Part B: every isToWeave scan set must SELECT dirty_seq -----------------
const src = fs.readFileSync(path.join(__dirname, "..", "src", "dream.js"), "utf8");

const gate = src.match(/const isToWeave\s*=\s*\(n\)\s*=>[\s\S]*?;/);
if (!gate) fail("could not locate the isToWeave definition");
const gated = [...new Set((gate[0].match(/\bn\.([a-z_]+)/g) || []).map((s) => s.slice(2)))];
if (!gated.includes("dirty_seq")) fail(`isToWeave no longer reads dirty_seq (reads: ${gated.join(", ")})`);

// Resolve every `.filter(isToWeave)` back to the query that produced its rows. Two shapes
// exist: a named const, and an inline db.prepare(...).all() chain.
const marker = ".filter(isToWeave)";
const scanSets = [];
for (let i = src.indexOf(marker); i !== -1; i = src.indexOf(marker, i + 1)) {
  const before = src.slice(Math.max(0, i - 500), i);
  const inline = before.match(/db\.prepare\("(SELECT[^"]+)"\)\.all\(\)\s*$/);
  if (inline) { scanSets.push({ name: "(inline)", query: inline[1] }); continue; }
  const named = before.match(/([A-Za-z_$][\w$]*)\s*$/);
  if (!named) fail("could not resolve an isToWeave scan set");
  const decl = src.match(new RegExp(`const\\s+${named[1]}\\s*=\\s*db\\.prepare\\("(SELECT[^"]+)"\\)`));
  if (!decl) fail(`could not resolve the query behind ${named[1]}.filter(isToWeave)`);
  scanSets.push({ name: named[1], query: decl[1] });
}
if (scanSets.length < 3) fail(`expected at least 3 isToWeave scan sets, found ${scanSets.length}`);

for (const { name, query } of scanSets) {
  const selectList = query.slice(0, query.search(/\bFROM\b/i));
  for (const col of gated) {
    if (!new RegExp(`\\b${col}\\b`).test(selectList)) {
      fail(`${name}.filter(isToWeave) reads n.${col}, but its SELECT list omits it -> filters out every row`);
    }
  }
}

console.log(`PASS \u2713 incremental lineage survives a persisted weave cursor (${scanSets.length} scan sets checked)`);
fs.rmSync(dataDir, { recursive: true, force: true });
