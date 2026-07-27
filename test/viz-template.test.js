"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "viz", "graph-store-visualization.html"), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

for (const script of scripts) new Function(script);

for (const id of ["edgeAlways", "edgeClick", "edgeHover"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`missing ${id} edge control`);
}
if (!html.includes("edgeMode=rawLinks.length>1000?'hover':'always'")) {
  throw new Error("dense graphs must default to hover edges and small graphs to always-on edges");
}
if (!html.includes("elGraph.addEventListener('wheel',pointerDolly,{passive:false,capture:true})")) {
  throw new Error("pointer-centered wheel zoom is not installed");
}
// Leaving temporal mode must re-anchor to the nebula. The anchors live on the graph-data node
// (o._px/_py/_pz); reading them off the raw node leaves every node stuck on the timeline axis.
if (!html.includes("if(o._px!=null){ o.ax=o._px*LAYOUT.xs;")) {
  throw new Error("temporal->semantic switch must restore nebula anchors from the graph-data node");
}

// Temporal mode shows every chronicle's supporting-fact ring by default; a fact is on the
// timeline whenever it has a ring slot (_thas), not only while a chronicle is bloomed open.
if (!html.includes("if(n.kind==='fact') return !!n._thas ||")) {
  throw new Error("temporal mode must render all supporting-fact rings by default");
}

// Chronicles are to the temporal view what entities are to the semantic one, so both wear the
// neutral backbone color. A per-resolution hue ramp put chronicles in the same pink family as
// semantic facts, which made the spine disappear into the rings it summarizes; resolution is
// carried by RES_SIZE instead.
if (!html.includes("const baseColor=n=> (n.kind==='chronicle'||n.kind==='entity')?PAL.entity:")) {
  throw new Error("chronicle nodes must share the entity backbone color");
}
if (/RES_COLOR/.test(html)) {
  throw new Error("RES_COLOR reintroduces a chronicle hue ramp that competes with the fact classes");
}
if (!html.includes("const RES_SIZE=")) {
  throw new Error("resolution must stay legible through RES_SIZE once the hue ramp is gone");
}
// The chronicle->chronicle spine follows the nodes it joins, so it must not fall back to a
// fact-class color; evidence stays the faintest of the three temporal link families.
if (!html.includes("l.rel==='next_period'?PAL.entity:")) {
  throw new Error("the next_period spine must use the backbone color");
}

console.log("PASS \u2713 visualization template compiles with adaptive edge modes");
