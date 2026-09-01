"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-partial-cursor-"));
process.env.AGENT_MEMORY_DIR = dataDir;

(async () => {
  const Database = require("better-sqlite3");
  const sqliteVec = require("sqlite-vec");
  const { ensureSchema } = require("../src/schema");
  const { applyMerges, reportMerges } = require("../src/dream");

  const db = new Database(path.join(dataDir, "memory.db"));
  sqliteVec.load(db);
  ensureSchema(db);
  const ins = db.prepare("INSERT INTO nodes(signature,kind,class,first_seen,source_day,fact,text,strength,dirty_seq) VALUES (?,?,?,?,?,?,?,?,?)");
  const rows = [
    ["fact:a1", "Alice owns the migration checklist."],
    ["fact:a2", "Alice owns the migration checklist."],
    ["fact:b1", "Bob owns the rollback checklist."],
    ["fact:b2", "Bob owns the rollback checklist."],
  ];
  rows.forEach(([sig, fact], i) => ins.run(sig, "fact", "episodic", "2026-01-01", "2026-01-01", fact, fact, 0.5, i + 1));
  db.prepare("INSERT INTO nodes(signature,kind,class,first_seen,fact,dirty_seq) VALUES ('person:alice','entity','semantic','2026-01-01','',1)").run();
  db.prepare("INSERT INTO nodes(signature,kind,class,first_seen,fact,dirty_seq) VALUES ('person:bob','entity','semantic','2026-01-01','',1)").run();
  const mention = db.prepare("INSERT INTO edges(src,rel,dst,weight) VALUES (?,'mentions',?,0.8)");
  mention.run("fact:a1", "person:alice");
  mention.run("fact:a2", "person:alice");
  mention.run("fact:b1", "person:bob");
  mention.run("fact:b2", "person:bob");
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('change_seq','4')").run();
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('last_reflect_seq','0')").run();
  db.close();
  const dream = path.join(__dirname, "..", "src", "dream.js");
  require("child_process").execFileSync(process.execPath, [dream, "weave"], {
    env: process.env,
    encoding: "utf8",
  });

  const db2 = new Database(path.join(dataDir, "memory.db"));
  sqliteVec.load(db2);

  const report = await reportMerges(db2, { sim: 0.1 });
  if (report.clusters.length < 2) throw new Error("fixture did not produce at least two clusters");
  const first = report.clusters[0];
  const decision = {
    fact: first[0].fact.replace(/^\[[^\]]+\]\s+/, ""),
    survivorSig: first[0].sig,
    memberSigs: first.map((m) => m.sig),
  };
  const applied = await applyMerges(db2, { report_id: report.report_id, decisions: [decision] }, { sim: 0.1 });
  if (!applied.complete || applied.clusters_merged !== 1) throw new Error(`partial apply failed: ${JSON.stringify(applied)}`);
  const cursor = db2.prepare("SELECT value FROM meta WHERE key='last_reflect_seq'").get().value;
  if (cursor !== String(report.cursor_seq)) throw new Error(`partial apply advanced cursor: ${cursor} vs ${report.cursor_seq}`);
  const next = await reportMerges(db2, { sim: 0.1 });
  if (!next.clusters.length) throw new Error("partial apply hid remaining merge clusters");

  console.log("PASS: partial merge apply keeps remaining clusters visible");
  db2.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
