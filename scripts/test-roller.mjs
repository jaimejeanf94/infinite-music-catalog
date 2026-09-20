// Sanity-check the roller against the odds the sheet intended.
// Run: node scripts/test-roller.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { roll, secureRandom, BUCKET_SHARE } = require("../app/roller.js");

// Load the real cleaned collection, so this tests the actual shape of the data.
const csv = readFileSync(new URL("../data/albums.csv", import.meta.url), "utf8");
const [head, ...lines] = csv.trim().split(/\r?\n/);
// Minimal RFC4180 line parser -- titles contain commas and quotes.
function parseLine(line) {
  const cells = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cells.push(cur); cur = ""; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

const albums = lines.map((line, i) => {
  const c = parseLine(line);
  return {
    id: i + 1,
    artist: c[0], title: c[1],
    year: c[2] ? +c[2] : null,
    score: c[3] ? +c[3] : null,
  };
});

const N = 200_000;
const byId = new Map(albums.map((a) => [a.id, a]));
const fail = [];

function distribution(opts) {
  const hits = new Map();
  for (let i = 0; i < N; i++) {
    const a = roll(albums, opts);
    const k = a.score == null ? "unscored" : a.score;
    hits.set(k, (hits.get(k) || 0) + 1);
  }
  return hits;
}

console.log(`collection: ${albums.length} albums\n`);

// ── weighted ────────────────────────────────────────────────────────────────
console.log("MODE: weighted (unscoredShare = 25%)");
const hits = distribution({ unscoredShare: 25 });
const scoredMass = 75; // the other 25 goes to unscored
for (const score of [...Object.keys(BUCKET_SHARE).map(Number), "unscored"]) {
  const got = ((hits.get(score) || 0) / N) * 100;
  const want = score === "unscored" ? 25 : (BUCKET_SHARE[score] / 100) * scoredMass;
  const members = albums.filter((a) =>
    score === "unscored" ? a.score == null : a.score === score).length;
  const ok = Math.abs(got - want) < 0.6;
  if (!ok) fail.push(`weighted ${score}: got ${got.toFixed(2)}% want ${want.toFixed(2)}%`);
  console.log(
    `  ${String(score).padStart(8)}  n=${String(members).padStart(4)}  ` +
    `got ${got.toFixed(2).padStart(5)}%  want ${want.toFixed(2).padStart(5)}%  ${ok ? "ok" : "FAIL"}`
  );
}

// A real 100 must now beat an unscored album, which was the sheet's bug.
const per = (k) => {
  const n = albums.filter((a) => (k === "unscored" ? a.score == null : a.score === k)).length;
  return (hits.get(k) || 0) / N / n;
};
const edge = per(100) / per("unscored");
console.log(`\n  a real 100 is ${edge.toFixed(0)}x likelier than any one unscored album`);
if (edge < 10) fail.push(`100s not favoured enough over unscored (${edge.toFixed(1)}x)`);

// ── other modes ─────────────────────────────────────────────────────────────
console.log("\nMODE: unscored — should never return a scored album");
const leaked = [...distribution({ mode: "unscored" }).keys()].filter((k) => k !== "unscored");
console.log(leaked.length ? `  FAIL leaked: ${leaked}` : "  ok, unscored only");
if (leaked.length) fail.push("unscored mode leaked scored albums");

console.log("\nMODE: uniform — every album equally likely");
const u = distribution({ mode: "uniform" });
const uUnscored = ((u.get("unscored") || 0) / N) * 100;
const uWant = (albums.filter((a) => a.score == null).length / albums.length) * 100;
const uOk = Math.abs(uUnscored - uWant) < 1;
console.log(`  unscored share: got ${uUnscored.toFixed(1)}%  want ${uWant.toFixed(1)}%  ${uOk ? "ok" : "FAIL"}`);
if (!uOk) fail.push("uniform mode is not uniform");

// ── pool + repeat rules ─────────────────────────────────────────────────────

let repeats = 0, prev = null;
for (let i = 0; i < 20_000; i++) {
  const a = roll(albums, { avoidIds: prev ? [prev] : [] });
  if (prev && a.id === prev) repeats++;
  prev = a.id;
}
console.log(`immediate repeats: ${repeats} ${repeats ? "FAIL" : "ok"}`);
if (repeats) fail.push("roller repeated the previous album");

// ── randomness source ───────────────────────────────────────────────────────
// Two runs of the same code must not produce the same sequence. A seeded or
// deterministic generator would repeat itself here.
const seqA = Array.from({ length: 12 }, () => roll(albums, {}).id).join(",");
const seqB = Array.from({ length: 12 }, () => roll(albums, {}).id).join(",");
const distinct = seqA !== seqB;
console.log(`\nrandom source: ${
  typeof globalThis.crypto?.getRandomValues === "function"
    ? "crypto.getRandomValues (operating system entropy)"
    : "Math.random fallback"
}`);
console.log(`two sequences differ: ${distinct ? "ok" : "FAIL"}`);
if (!distinct) fail.push("roller produced an identical sequence twice");

// Sanity-check the raw generator: 100k draws should land evenly across ten
// buckets, at roughly 10% each.
const buckets = new Array(10).fill(0);
for (let i = 0; i < 100_000; i++) buckets[Math.floor(secureRandom() * 10)]++;
const spread = buckets.map((b) => ((b / 100_000) * 100).toFixed(1) + "%").join(" ");
const evenly = buckets.every((b) => Math.abs(b / 100_000 - 0.1) < 0.005);
console.log(`draw spread over 10 buckets: ${spread}`);
console.log(`evenly distributed: ${evenly ? "ok" : "FAIL"}`);
if (!evenly) fail.push("raw random draws are not evenly distributed");

console.log(fail.length ? `\n${fail.length} FAILURE(S):\n - ${fail.join("\n - ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
