"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "record-projection-rebind-test-"));
const DREAM = path.join(__dirname, "..", "src", "dream.js");
const env = { ...process.env, AGENT_MEMORY_DIR: dataDir };

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }
function run(...args) {
  return execFileSync(process.execPath, [DREAM, ...args], { env, encoding: "utf8" });
}

run("init");
const dbPath = path.join(dataDir, "memory.db");
const db = new Database(dbPath);
db.prepare("INSERT INTO nodes(signature,memory_id,kind,class,fact) VALUES ('fact:old','shared-id','fact','episodic','old')").run();
db.prepare("INSERT INTO nodes(signature,memory_id,kind,class,fact) VALUES ('fact:new','','fact','episodic','new')").run();
db.close();

const pairs = path.join(dataDir, "projection-ids.json");
fs.writeFileSync(pairs, JSON.stringify([{ signature: "fact:new", memory_id: "shared-id" }]));
const result = JSON.parse(run("record-projection", "--file", pairs));
if (result.recorded !== 1) fail("expected one recorded projection");

const verify = new Database(dbPath, { readonly: true });
const oldRow = verify.prepare("SELECT memory_id FROM nodes WHERE signature='fact:old'").get();
const newRow = verify.prepare("SELECT memory_id FROM nodes WHERE signature='fact:new'").get();
verify.close();

if (oldRow.memory_id !== "") fail("old signature kept duplicate memory_id");
if (newRow.memory_id !== "shared-id") fail("new signature did not receive memory_id");
console.log("ok: record-projection rebinds an existing harness id to the selected signature");
