"use strict";

// Tier-3 archive must never reach the 3D explorer.
//
// Chronicles are versioned: re-summarizing a period writes v2, v3, ... and archives the
// older versions. `attachChronicles` filters archived rows out of its metadata query, so
// when the node export does NOT apply the same predicate, every superseded version
// survives in the graph as a chronicle node with no period window — invisible on the time
// axis (no `_thas`), but fully present in the semantic view, dragging a duplicate set of
// chronicle_evidence links into the force layout.
//
// The invariant asserted here: nothing archived is exported, and every exported chronicle
// carries the period metadata the timeline needs.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-viz-archive-"));
process.env.AGENT_MEMORY_DIR = dataDir;

const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");

const dbPath = path.join(dataDir, "memory.db");
const db = new Database(dbPath);
sqliteVec.load(db);
ensureSchema(db);

const now = new Date().toISOString();
const insNode = db.prepare("INSERT INTO nodes(signature,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated) VALUES (?,?,?,?,?,?,?,?,?,?)");
const insChron = db.prepare("INSERT INTO chronicles(node_sig,resolution,period_start,period_end,version,covered_event_count,created_at) VALUES (?,?,?,?,?,?,?)");
const insEvidence = db.prepare("INSERT INTO chronicle_evidence(chronicle_sig,entry_ordinal,evidence_sig) VALUES (?,?,?)");
const insEntry = db.prepare("INSERT INTO chronicle_entries(chronicle_sig,ordinal,slot_label,summary,change_kind) VALUES (?,?,?,?,?)");

// Two dated facts the chronicle summarizes.
for (const d of ["2026-05-01", "2026-05-02"]) {
  insNode.run(`fact:evidence-${d}`, "fact", "episodic", null, `something happened on ${d}`, `something happened on ${d}`, `${d}T12:00:00Z`, d, now, now);
}
// An archived (Tier-3) fact.
insNode.run("fact:archived-detail", "fact", "episodic", "archive", "a demoted fact", "a demoted fact", "2026-05-01T12:00:00Z", "2026-05-01", now, now);

// A day chronicle that was re-summarized: v1 archived, v2 live. Both keep evidence rows.
insNode.run("chronicle:day:2026-05-01:v1", "chronicle", "semantic", "archive", "may 1 (stale)", "may 1 (stale)", "2026-05-01T23:59:59Z", "2026-05-01", now, now);
insNode.run("chronicle:day:2026-05-01:v2", "chronicle", "semantic", "chronicle", "may 1", "may 1", "2026-05-01T23:59:59Z", "2026-05-01", now, now);
insChron.run("chronicle:day:2026-05-01:v1", "day", "2026-05-01", "2026-05-01", 1, 1, now);
insChron.run("chronicle:day:2026-05-01:v2", "day", "2026-05-01", "2026-05-01", 2, 2, now);
for (const v of ["v1", "v2"]) {
  insEntry.run(`chronicle:day:2026-05-01:${v}`, 1, "what happened", "a day of things", "new");
  insEvidence.run(`chronicle:day:2026-05-01:${v}`, 1, "fact:evidence-2026-05-01");
  insEvidence.run(`chronicle:day:2026-05-01:${v}`, 1, "fact:evidence-2026-05-02");
}
db.close();

const out = execFileSync(process.execPath, [path.join(__dirname, "..", "src", "dream.js"), "export-viz"], {
  encoding: "utf8",
  env: { ...process.env, AGENT_MEMORY_DIR: dataDir },
});
const vizPath = JSON.parse(out).output;
const html = fs.readFileSync(vizPath, "utf8");

// Pull the embedded graph out of the rendered page by balanced-brace scan.
const start = html.indexOf('{"nodes"');
if (start < 0) throw new Error("rendered viz carries no embedded graph data");
let depth = 0, end = -1, inStr = false, esc = false;
for (let i = start; i < html.length; i += 1) {
  const c = html[i];
  if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
  if (c === '"') { inStr = true; continue; }
  if (c === "{") depth += 1;
  else if (c === "}") { depth -= 1; if (depth === 0) { end = i + 1; break; } }
}
const data = JSON.parse(html.slice(start, end));

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

// 1. No archived node of any kind is exported.
const archived = data.nodes.filter((n) => n.notes && /archive/.test(n.notes));
if (archived.length) fail(`archived nodes reached the explorer: ${archived.map((n) => n.id).join(", ")}`);

// 2. The stale chronicle version is gone; the live one is present.
const ids = new Set(data.nodes.map((n) => n.id));
if (ids.has("chronicle:day:2026-05-01:v1")) fail("superseded chronicle version v1 was exported");
if (!ids.has("chronicle:day:2026-05-01:v2")) fail("live chronicle version v2 is missing from the export");
if (ids.has("fact:archived-detail")) fail("archived Tier-3 fact was exported");

// 3. Every exported chronicle carries the period window the timeline positions it by.
// A chronicle without `res`/`ps` gets no `_thas`, so it silently vanishes from temporal
// mode while still perturbing the semantic layout — exactly the phantom-node symptom.
const chronicles = data.nodes.filter((n) => n.kind === "chronicle");
if (!chronicles.length) fail("expected at least one chronicle in the export");
const phantom = chronicles.filter((n) => !n.res || !n.ps);
if (phantom.length) fail(`chronicle nodes exported without period metadata: ${phantom.map((n) => n.id).join(", ")}`);

// 4. Evidence links must not be duplicated by a superseded version.
const evidence = data.links.filter((l) => l.rel === "chronicle_evidence");
const dangling = evidence.filter((l) => !ids.has(l.source) || !ids.has(l.target));
if (dangling.length) fail(`${dangling.length} chronicle_evidence links point at non-exported nodes`);
if (evidence.length !== 2) fail(`expected 2 chronicle_evidence links (live version only), got ${evidence.length}`);

console.log(`PASS \u2713 archive stays out of the explorer (${data.nodes.length} nodes, ${evidence.length} evidence links, no phantom chronicles)`);
fs.rmSync(dataDir, { recursive: true, force: true });
