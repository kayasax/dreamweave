"use strict";

// The rendered envelope must never become the stored fact.
//
// `export-harness` projects raw gist `fact` text into Scout. Semantic envelopes are
// retained for Dreamweave graph/recall surfaces, not written into Scout memories.
//
// `ingest-harness` then reads the harness back and compares the incoming text to the stored
// fact. The envelope makes them differ, so `updChanged` overwrites the stored fact WITH THE
// ENVELOPE and drops the node's vector. The next export renders an envelope around the
// envelope, the next ingest stores THAT, and the fact grows a new header every night while
// the real text sinks further inside. The vector is re-embedded from the corrupted text, so
// recall degrades with it.
//
// This had not fired yet only because the envelope was added to the export recently -- the
// first projection that carries it is the one that arms the loop.
//
// The rule: an envelope is ENGINE-AUTHORED. The harness is the source of truth for facts the
// user writes, never for text the engine rendered. Ingest must not treat it as an edit.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-envelope-"));
process.env.AGENT_MEMORY_DIR = dataDir;

const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const { ensureSchema } = require("../src/schema");
const { exportHarness, ingestHarness } = require("../src/dream");
const { renderNodeEnvelope } = require("../src/memory-render");

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const db = new Database(path.join(dataDir, "memory.db"));
sqliteVec.load(db);
ensureSchema(db);

const now = "2026-05-05T00:00:00.000Z";
const GIST_ID = "harness-gist-1";
const GIST_FACT = "Peter owns the on-premises data gateway release approvals.";

db.prepare(`INSERT INTO nodes(signature,memory_id,kind,class,notes,salience,fact,text,first_seen,source_day,last_decayed,last_reactivated,strength,temporal_form)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run("fact:gateway-owner", GIST_ID, "fact", "semantic", "gist", "fact", GIST_FACT, GIST_FACT,
    "2026-05-04T12:00:00Z", "2026-05-04", now, now, 1, "atemporal");

const recordFor = (sig) => {
  const out = exportHarness(db, "2026-05-06");
  const recs = out.records || out;
  const r = recs.find((x) => x.signature === sig);
  if (!r) fail(`export did not emit ${sig}`);
  return r;
};

const storedFact = () => db.prepare("SELECT fact FROM nodes WHERE signature=?").get("fact:gateway-owner").fact;

// The projection must be the raw fact. Envelopes are useful for internal recall,
// but they are not useful Scout memory content and must not consume the 420-char budget.
const projected = recordFor("fact:gateway-owner").display;
if (projected !== GIST_FACT) fail(`expected raw gist fact projection, got: ${projected.slice(0, 120)}`);
const envelope = renderNodeEnvelope(db, db.prepare("SELECT * FROM nodes WHERE signature=?").get("fact:gateway-owner"));
if (!/^\[SEMANTIC MEMORY/.test(envelope)) fail("test setup did not render a semantic envelope");

(async () => {
  // Round 1: the harness now holds what we projected. Ingest it back.
  const snap1 = path.join(dataDir, "snap1.json");
  fs.writeFileSync(snap1, JSON.stringify([{ id: GIST_ID, fact: envelope, category: "fact" }]));
  await ingestHarness(db, snap1, false, now, false);

  if (storedFact() !== GIST_FACT) {
    fail(`ingest overwrote the stored fact with the rendered envelope.\n  stored now: ${JSON.stringify(storedFact().slice(0, 120))}\n  expected:   ${JSON.stringify(GIST_FACT)}`);
  }

  // Round 2: the fact must not accumulate a second header.
  const projected2 = recordFor("fact:gateway-owner").display;
  const headers = (projected2.match(/\[SEMANTIC MEMORY/g) || []).length;
  if (headers !== 0) fail(`semantic envelope leaked into Scout projection: ${headers} headers in the projected text`);
  if (projected2 !== projected) fail("projection is not stable across an ingest round trip");

  const snap2 = path.join(dataDir, "snap2.json");
  fs.writeFileSync(snap2, JSON.stringify([{ id: GIST_ID, fact: projected2, category: "fact" }]));
  await ingestHarness(db, snap2, false, now, false);
  if (storedFact() !== GIST_FACT) fail(`stored fact drifted on the second round trip: ${JSON.stringify(storedFact().slice(0, 120))}`);

  // A genuine user edit in the harness MUST still win -- the guard keys on the envelope, not
  // on the node being a gist, so plain text the user typed continues to update the fact.
  const edited = "Peter owns gateway release approvals; Theja is the backup approver.";
  const snap3 = path.join(dataDir, "snap3.json");
  fs.writeFileSync(snap3, JSON.stringify([{ id: GIST_ID, fact: edited, category: "fact" }]));
  await ingestHarness(db, snap3, false, now, false);
  if (storedFact() !== edited) fail(`the guard swallowed a real user edit: stored ${JSON.stringify(storedFact())}`);

  // An envelope arriving under an UNKNOWN id must not become a new node. That happens when a
  // chronicle was m_remember'd but record-projection has not bound its id yet; creating a
  // `fact:` node out of engine-rendered text pollutes the graph with a duplicate of a
  // chronicle that already exists.
  const before = db.prepare("SELECT count(*) c FROM nodes").get().c;
  const snap4 = path.join(dataDir, "snap4.json");
  fs.writeFileSync(snap4, JSON.stringify([
    { id: "harness-unbound-1", fact: envelope, category: "fact" },
  ]));
  await ingestHarness(db, snap4, false, now, false);
  const after = db.prepare("SELECT count(*) c FROM nodes").get().c;
  if (after !== before) fail(`ingest created ${after - before} node(s) from engine-rendered envelope text`);

  const verify = JSON.parse(execFileSync(
    process.execPath,
    [path.join(__dirname, "..", "src", "dream.js"), "verify-sync", "--file", snap4],
    { encoding: "utf8", env: { ...process.env, AGENT_MEMORY_DIR: dataDir } },
  ));
  if (!verify.complete || verify.missing.length) {
    fail("verify-sync rejected an intentionally skipped rendered envelope");
  }

  console.log("PASS ✓ rendered envelopes never become stored facts; real user edits still land");
})().catch((e) => fail(e && e.stack || String(e)));
