"use strict";

// Re-summarizing already-covered periods.
//
// A period is normally reported once: `chronicleCandidates` skips it forever after, because
// the stored coverage_seq already covers every member. That is right when only the evidence
// can go stale -- but when the JUDGING CONTRACT changes, every existing summary is stale in a
// way no member edit will ever signal, and there is no way to ask for them again.
//
// `--resummarize <resolution>` reopens them, scoped to one resolution so a caller can work
// fine->coarse (a week's members are the day chronicles as they stand at report time, so days
// must be rewritten and applied before the week is reported). `--resummarize-before <iso>` is
// the watermark that makes it batchable: without it every covered period reopens on every
// report, so a caller working through them `--max-candidates` at a time is handed the same
// earliest periods forever.
//
// The subtle one: `apply-chronicles` recomputes the report internally to bind the decision to
// a report_id. Different flags => different report_id => every period rejects as stale. This
// pins that the flags must be plumbed to BOTH commands.

const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-chron-resum-"));
process.env.AGENT_MEMORY_DIR = dataDir;

const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");
const { reportChronicles } = require("../src/dream");

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);

const DAY = "2026-05-04";
const CREATED = "2026-05-05T00:00:00.000Z";
const now = "2026-06-01T00:00:00.000Z";

db.prepare(`INSERT INTO nodes(signature,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated,dirty_seq)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run(`fact:evidence-${DAY}`, "fact", "episodic", null, "a dated fact", "a dated fact",
    `${DAY}T12:00:00Z`, DAY, now, now, 7);
db.prepare(`INSERT INTO nodes(signature,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated)
  VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(`chronicle:day:${DAY}:v1`, "chronicle", "semantic", "chronicle", "an old summary", "an old summary",
    `${DAY}T23:59:59Z`, null, now, now);
// coverage_seq already at/above the member's dirty_seq: the period is fully covered.
db.prepare(`INSERT INTO chronicles(node_sig,resolution,period_start,period_end,version,compression_level,covered_event_count,coverage_seq,created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(`chronicle:day:${DAY}:v1`, "day", DAY, DAY, 1, 0, 1, 7, CREATED);

const dayPeriods = (opts) => reportChronicles(db, { asOf: "2026-06-01", ...opts })
  .candidates.filter((c) => c.resolution === "day").length;

// 1. A covered period stays closed by default -- the existing, correct behaviour.
if (dayPeriods({}) !== 0) fail("a fully covered day period re-reported without being asked to");

// 2. --resummarize day reopens it.
if (dayPeriods({ resummarize: "day" }) !== 1) {
  fail("--resummarize day did not reopen the covered period; a contract change cannot be applied "
    + "to existing chronicles at all");
}

// 3. It is scoped to ONE resolution, so days can be rewritten before weeks roll them up.
if (dayPeriods({ resummarize: "week" }) !== 0) {
  fail("--resummarize week reopened a DAY period; resolution scoping is what allows fine->coarse ordering");
}

// 4. The watermark retires periods already rewritten in this campaign.
if (dayPeriods({ resummarize: "day", resummarizeBefore: "2026-05-04T00:00:00.000Z" }) !== 0) {
  fail("a chronicle written AFTER the watermark still reopened; batched re-summarization would "
    + "hand back the same earliest periods forever and never terminate");
}
if (dayPeriods({ resummarize: "day", resummarizeBefore: "2026-06-01T00:00:00.000Z" }) !== 1) {
  fail("a chronicle written BEFORE the watermark failed to reopen");
}

// 5. Uncovered periods are unaffected by the watermark -- it must never suppress normal work.
db.prepare("UPDATE nodes SET dirty_seq=99 WHERE signature=?").run(`fact:evidence-${DAY}`);
if (dayPeriods({ resummarizeBefore: "2026-05-04T00:00:00.000Z" }) !== 1) {
  fail("the watermark suppressed a period whose evidence had genuinely moved past its coverage_seq");
}
db.prepare("UPDATE nodes SET dirty_seq=7 WHERE signature=?").run(`fact:evidence-${DAY}`);

// 6. A typo must fail loudly, not silently report nothing and look like "already up to date".
let threw = false;
try { reportChronicles(db, { asOf: "2026-06-01", resummarize: "daily" }); } catch { threw = true; }
if (!threw) fail("an unknown resolution was accepted; a typo would silently no-op");

// 7. apply-chronicles recomputes the report to bind report_id, so the flags change it. If they
//    were not plumbed to apply as well, every decision would reject as stale.
const plain = reportChronicles(db, { asOf: "2026-06-01" }).report_id;
const reopened = reportChronicles(db, { asOf: "2026-06-01", resummarize: "day" }).report_id;
if (plain === reopened) {
  fail("report_id is identical with and without --resummarize, so the report no longer identifies "
    + "its own candidate set");
}
const { chronicleOpts } = require("../src/dream");
if (typeof chronicleOpts === "function") {
  const o = chronicleOpts({ "as-of": "x", resummarize: "day", "resummarize-before": "t", "max-candidates": "5" });
  for (const k of ["asOf", "resummarize", "resummarizeBefore", "maxCandidates"]) {
    if (o[k] === undefined) fail(`chronicleOpts drops ${k}; report and apply would disagree`);
  }
}

// 8. A chronicle whose complete evidence set decayed to archive is stale even
// when coverage_seq did not change. Reopen it with active replacement evidence.
db.prepare(`INSERT INTO nodes(signature,kind,class,notes,fact,text,first_seen,source_day,last_decayed,last_reactivated,dirty_seq)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run(`fact:replacement-${DAY}`, "fact", "semantic", "gist-child",
    "active replacement evidence", "active replacement evidence",
    `${DAY}T13:00:00Z`, DAY, now, now, 7);
db.prepare(`INSERT INTO chronicle_entries(chronicle_sig,ordinal,slot_label,summary,change_kind)
  VALUES (?,?,?,?,?)`)
  .run(`chronicle:day:${DAY}:v1`, 0, DAY, "an old summary", "continuity");
db.prepare(`INSERT INTO chronicle_evidence(chronicle_sig,entry_ordinal,evidence_sig)
  VALUES (?,?,?)`).run(`chronicle:day:${DAY}:v1`, 0, `fact:evidence-${DAY}`);
db.prepare("UPDATE nodes SET notes='archive' WHERE signature=?").run(`fact:evidence-${DAY}`);

const decayed = reportChronicles(db, { asOf: "2026-06-01" }).candidates
  .find((c) => c.resolution === "day" && c.periodStart === DAY);
if (!decayed) fail("a chronicle with only archived evidence did not reopen");
if (decayed.members.some((m) => m.sig === `fact:evidence-${DAY}`)
  || !decayed.members.some((m) => m.sig === `fact:replacement-${DAY}`)) {
  fail("the reopened chronicle did not replace archived evidence with active members");
}
db.prepare("UPDATE chronicle_evidence SET evidence_sig=? WHERE chronicle_sig=?")
  .run(`fact:replacement-${DAY}`, `chronicle:day:${DAY}:v1`);
if (dayPeriods({}) !== 0) fail("a chronicle with visible evidence reopened unnecessarily");

db.close();
console.log("PASS \u2713 chronicle re-summarization is scoped, batchable and repairs invisible evidence");
fs.rmSync(dataDir, { recursive: true, force: true });
