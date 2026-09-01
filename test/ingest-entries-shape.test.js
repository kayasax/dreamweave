"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-entries-shape-"));
const DREAM = path.join(__dirname, "..", "src", "dream.js");
const env = { ...process.env, AGENT_MEMORY_DIR: dataDir };

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }
function run(...args) {
  return execFileSync(process.execPath, [DREAM, ...args], { env, encoding: "utf8" });
}

run("init");
const snap = path.join(dataDir, "entries.json");
fs.writeFileSync(snap, JSON.stringify({
  entries: [{
    id: "proof-entry",
    fact: "PROOF: Scout entries shape is ingested as memory content.",
    category: "fact",
    createdAt: "2026-09-01T12:00:00Z",
  }],
}));

const ingest = JSON.parse(run("ingest-harness", "--file", snap));
if (ingest.harness_count !== 1 || ingest.created !== 1 || !ingest.complete) {
  fail(`entries shape was not ingested: ${JSON.stringify(ingest)}`);
}
const verify = JSON.parse(run("verify-sync", "--file", snap));
if (verify.harness_count !== 1 || !verify.complete) {
  fail(`entries shape failed verify-sync: ${JSON.stringify(verify)}`);
}
const exported = JSON.parse(run("export-harness", "--as-of", "2026-09-01"));
if (!exported.some((r) => /Scout entries shape/.test(r.display || r.fact || ""))) {
  fail("ingested entries shape did not appear in export-harness");
}

console.log("PASS: ingest-harness and verify-sync accept Scout entries shape");
