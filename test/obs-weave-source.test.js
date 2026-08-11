"use strict";

// Source-level regression: canonical WEAVE observation source contract (#538).
//
// Rules enforced:
//  1. The `dream` command handler must NOT emit a WEAVE observation point.
//     The internal pre-weave inside `dream` is an implementation detail, not
//     a named pipeline step. Recording it there causes duplicate WEAVE rows
//     on every nightly run and corrupts nightly averages.
//  2. The standalone `weave` command handler must contain exactly one
//     recordObservationPoint("WEAVE") call.  This is the sole canonical source.
//  3. The `weave` command must support a `--run-kind` flag so callers can
//     label STEP 9d reconnect observations as non-canonical.  The run_kind
//     field must be forwarded to recordObservationPoint.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../src/dream.js"), "utf8");

// ---------------------------------------------------------------------------
// Locate the dream command block (between its else-if and the next else-if).
// ---------------------------------------------------------------------------
const DREAM_OPEN  = 'else if (cmd === "dream")';
const WEAVE_OPEN  = 'else if (cmd === "weave")';
const AFTER_WEAVE = 'else if (cmd === "report-entities")';

const dreamIdx = src.indexOf(DREAM_OPEN);
const weaveIdx = src.indexOf(WEAVE_OPEN);
const afterIdx = src.indexOf(AFTER_WEAVE);

if (dreamIdx < 0) throw new Error(`FAIL: cannot locate "${DREAM_OPEN}" in dream.js`);
if (weaveIdx < 0) throw new Error(`FAIL: cannot locate "${WEAVE_OPEN}" in dream.js`);
if (afterIdx < 0) throw new Error(`FAIL: cannot locate "${AFTER_WEAVE}" in dream.js`);
if (dreamIdx >= weaveIdx) throw new Error("FAIL: dream block must appear before weave block");
if (weaveIdx >= afterIdx) throw new Error("FAIL: weave block must appear before report-entities block");

const dreamBlock = src.slice(dreamIdx, weaveIdx);
const weaveBlock = src.slice(weaveIdx, afterIdx);

// ---------------------------------------------------------------------------
// Rule 1: dream handler must NOT emit WEAVE.
// ---------------------------------------------------------------------------
if (dreamBlock.includes('recordObservationPoint("WEAVE"')) {
  throw new Error(
    'REGRESSION (#538): dream command emits recordObservationPoint("WEAVE") -- ' +
    "only the standalone weave command is the canonical WEAVE source. " +
    "Remove the observation call from the dream pre-weave block."
  );
}

// ---------------------------------------------------------------------------
// Rule 2: standalone weave handler must have exactly one WEAVE observation.
// ---------------------------------------------------------------------------
const weaveObsMatches = [...weaveBlock.matchAll(/recordObservationPoint\("WEAVE"/g)];
if (weaveObsMatches.length !== 1) {
  throw new Error(
    `REGRESSION (#538): standalone weave command must have exactly one ` +
    `recordObservationPoint("WEAVE") call, found ${weaveObsMatches.length}. ` +
    "The canonical WEAVE observation must live exclusively in the weave command."
  );
}

// ---------------------------------------------------------------------------
// Rule 3: weave command must forward run_kind to recordObservationPoint.
// ---------------------------------------------------------------------------
if (!weaveBlock.includes("run_kind")) {
  throw new Error(
    "REGRESSION (#538): standalone weave command must include run_kind so " +
    "STEP 9d reconnect observations can be labeled non-canonical. " +
    'Add run_kind: flags["run-kind"] || undefined to the recordObservationPoint data.'
  );
}

// ---------------------------------------------------------------------------
// Verify recordObservationPoint forwards --run-kind arg to the Python script.
// ---------------------------------------------------------------------------
const fnMatch = src.match(/function recordObservationPoint[\s\S]*?^\}/m);
if (!fnMatch) throw new Error("FAIL: cannot locate recordObservationPoint function in dream.js");
const fnBody = fnMatch[0];
if (!fnBody.includes("run_kind") || !fnBody.includes('"--run-kind"')) {
  throw new Error(
    'REGRESSION (#538): recordObservationPoint must pass --run-kind to observation_points.py ' +
    "when data.run_kind is set."
  );
}

console.log(
  "PASS \u2713 WEAVE observation is exclusively in the standalone weave command " +
  "(dream pre-weave is silent); run_kind discriminator is wired (#538)"
);
