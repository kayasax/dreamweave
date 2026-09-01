"use strict";

// Chronicles are Dreamweave evidence indexes, not user-facing Scout memory facts.
// They must not project to Scout, and a superseded chronicle can never be
// resurrected by the harness.
//
// Found live: after re-summarizing all 49 chronicles, `export-harness` emitted 38 chronicle
// records instead of 19 -- every rewritten period appeared twice, its stale text sitting next
// to its replacement. Two independent defects combined:
//
//  1. `ingestHarness` revives an archived node when the harness re-confirms it ("re-ingestion
//     by the source of truth is a strong reactivation signal"). That is correct for user facts,
//     where the harness IS the source of truth. Chronicles are ENGINE-OWNED and signature-first
//     (chronicle:<res>:<period>:v<n>); the db is their source of truth. A superseded version
//     still sitting in the harness is projection lag, not re-confirmation. Reviving it makes it
//     UNFORGETTABLE: revive -> export re-emits it -> projection keeps it -> next ingest revives
//     it again. The stale summary can never be evicted.
//
//  2. `exportHarness` projected chronicle rows into Scout visible memory. Even when deduped,
//     those rows are pollution: an index over evidence is not a usable remembered fact.
//
// Both are pinned here: no chronicle projection and no stale chronicle resurrection.

const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-chron-head-"));
process.env.AGENT_MEMORY_DIR = dataDir;

const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");
const { exportHarness, ingestHarness } = require("../src/dream");

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);

const DAY = "2026-05-04";
const now = "2026-05-05T00:00:00.000Z";
const OLD_ID = "harness-id-old";

const addChronicle = (version, notes, memoryId, fact) => {
  const sig = `chronicle:day:${DAY}:v${version}`;
  db.prepare(`INSERT INTO nodes(signature,memory_id,kind,class,notes,fact,text,first_seen,last_decayed,last_reactivated,strength)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sig, memoryId, "chronicle", "semantic", notes, fact, fact, `${DAY}T23:59:59Z`, now, now, 1);
  db.prepare(`INSERT INTO chronicles(node_sig,resolution,period_start,period_end,version,compression_level,covered_event_count,coverage_seq,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(sig, "day", DAY, DAY, version, 0, 1, 1, now);
  return sig;
};

// The superseded head still carries the harness id it was projected under -- exactly the live
// shape. The new head is db-native (blank memory_id) and has not reached the harness yet.
addChronicle(1, "archive", OLD_ID, "Day 2026-05-04: 4 tracked items - 2 new open loops.");
addChronicle(2, "chronicle", "", "Monday 4 May 2026 - Jennifer Li submitted the Gateway release.");

const projectedChronicles = (asOf) => {
  const out = exportHarness(db, asOf);
  const recs = out.records || out;
  return recs.filter((r) => /^chronicle:/.test(r.signature || ""));
};

// --- Guard 1: no chronicle projects to Scout memory --------------------------------------
let ch = projectedChronicles("2026-05-06");
if (ch.length !== 0) fail(`chronicle records leaked into Scout projection: ${ch.map((r) => r.signature).join(", ")}`);

// --- Guard 2: the invariant does not depend on archive bookkeeping ------------------------
// Clear the archive mark on the superseded row. Version order alone must still decide, or the
// export is one stray notes-write away from emitting a period twice.
db.prepare("UPDATE nodes SET notes='chronicle' WHERE signature=?").run(`chronicle:day:${DAY}:v1`);
ch = projectedChronicles("2026-05-06");
if (ch.length !== 0) fail(`un-archived chronicle leaked into Scout projection: ${ch.map((r) => r.signature).join(", ")}`);
db.prepare("UPDATE nodes SET notes='archive' WHERE signature=?").run(`chronicle:day:${DAY}:v1`);

// --- Guard 3: the harness cannot resurrect a superseded chronicle -------------------------
// The harness still carries the stale projection (it has not been m_forget'd yet). Ingesting
// that snapshot must NOT pull the superseded version back out of archive.
const snapshot = path.join(dataDir, "snapshot.json");
fs.writeFileSync(snapshot, JSON.stringify([
  { id: OLD_ID, fact: "Day 2026-05-04: 4 tracked items - 2 new open loops.", category: "timeline" },
]));

(async () => {
  await ingestHarness(db, snapshot, false, now, false);

  const notes = db.prepare("SELECT notes FROM nodes WHERE signature=?").get(`chronicle:day:${DAY}:v1`).notes;
  if (notes !== "archive") fail(`ingest revived a superseded chronicle: notes=${JSON.stringify(notes)} (expected "archive") -- the stale summary becomes unforgettable`);

  ch = projectedChronicles("2026-05-06");
  if (ch.length !== 0) fail(`after ingest chronicle records leaked into Scout projection: ${ch.map((r) => r.signature).join(", ")}`);

  // --- Guard 4: ordinary facts DO still revive ---------------------------------------------
  // The revive heuristic is correct for harness-owned facts; the fix must not disable it.
  db.prepare(`INSERT INTO nodes(signature,memory_id,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated,strength)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("fact:cold-one", "harness-id-fact", "fact", "episodic", "archive", "a cold fact", "a cold fact",
      `${DAY}T12:00:00Z`, DAY, now, now, 1);
  const snapshot2 = path.join(dataDir, "snapshot2.json");
  fs.writeFileSync(snapshot2, JSON.stringify([
    { id: "harness-id-fact", fact: "a cold fact", category: "fact" },
  ]));
  await ingestHarness(db, snapshot2, false, now, false);
  const factNotes = db.prepare("SELECT notes FROM nodes WHERE signature=?").get("fact:cold-one").notes;
  if (factNotes === "archive") fail("the chronicle guard also disabled revive for ordinary harness-owned facts");

  console.log("PASS ✓ one chronicle head per period; the harness cannot resurrect a superseded version");
})().catch((e) => fail(e && e.stack || String(e)));
