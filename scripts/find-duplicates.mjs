// find-duplicates.mjs — flag albums that look like the same record entered twice.
//
//   node scripts/find-duplicates.mjs
//
// The unique index in the database only catches exact collisions, case aside.
// "Slowdiive" and "Slowdive" are different keys everywhere, so a typo becomes
// a second album rather than an error -- and since the enrichment now matches
// artists fuzzily, the typo gets the right cover and genres and looks entirely
// legitimate. Nothing else would ever notice.
//
// Three decisions, in order of how much they matter:
//
// 1. BLOCKING. Comparing every album with every other is 10 million pairs.
//    Comparing only those sharing a short artist or title prefix is 17,000 --
//    0.17% of the work. Two prefixes rather than one, because a typo rarely
//    lands in both fields.
//
// 2. DELIBERATE SETS. 4% of this collection is multi-part: "Disc 1"/"Disc 2",
//    "Stage 3"/"Stage 6", "First Half"/"Second Half". Those are near-identical
//    on purpose, and a report full of them is a report nobody reads. If two
//    titles match once digits and part words are stripped, they are a set.
//
// 3. THE METRIC, which is the easy part. Damerau-Levenshtein counts a
//    transposition ("Slowdvie") as one edit rather than two, and that is the
//    commonest way a name gets mistyped. Phonetic algorithms are no use here:
//    they assume English, and this collection is not.

import { readFileSync } from "node:fs";

const MAX_DISTANCE = 2;

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

// What is left once every sequence marker is removed is the "work" both titles
// name. Roman numerals matter as much as digits here: half this collection's
// near-matches are Led Zeppelin II/III/IV, Saturation II/III, Disintegration
// Loops I through IV. Superscripts count too -- Coil's "Musick to Play in the
// Dark²" is the sequel to "Musick to Play in the Dark".
const PART_WORDS = /\b(pt|part|disc|disk|cd|vol|volume|stage|side|half|chapter|no)\b/gi;
const ROMAN = /\b(?=[ivx]+\b)(x{0,3})(ix|iv|v?i{0,3})\b/gi;
const SUPERSCRIPT = /[\u00b2\u00b3\u00b9\u2070-\u209f]/g;

const workOf = (title) =>
  norm(
    title
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(SUPERSCRIPT, " ")
      .replace(PART_WORDS, " ")
      .replace(ROMAN, " ")
      .replace(/\d+/g, " ")
  );

function damerau(a, b) {
  if (Math.abs(a.length - b.length) > MAX_DISTANCE) return 99;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      // the transposition case: "ab" -> "ba" is one edit, not two
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Exported so the health report can use the same detection rather than
// growing a second copy of it that drifts.
export function loadAlbums() {
  const [header, ...lines] = parseCsv(
    readFileSync(new URL("../data/albums.csv", import.meta.url), "utf8"));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  return lines.filter((r) => r[col.artist]).map((r) => {
    const artist = r[col.artist], title = r[col.title];
    return {
      artist, title,
      year: r[col.year],
      score: r[col.score],
      key: norm(artist) + "|" + norm(title),
      work: norm(artist) + "|" + workOf(title),
    };
  });
}

export function findDuplicates(albums) {

// ── 1. blocking ────────────────────────────────────────────────────────────
const blocks = new Map();
const addTo = (k, a) => { if (!blocks.has(k)) blocks.set(k, []); blocks.get(k).push(a); };
for (const a of albums) {
  addTo("a:" + norm(a.artist).slice(0, 4), a);
  addTo("t:" + norm(a.title).slice(0, 5), a);
}

const seen = new Set();
const flagged = [];
let compared = 0;

for (const bucket of blocks.values()) {
  if (bucket.length > 400) continue;   // a bucket that big is a prefix, not a clue
  for (let i = 0; i < bucket.length; i++) {
    for (let j = i + 1; j < bucket.length; j++) {
      const [x, y] = [bucket[i], bucket[j]];
      const pair = x.key < y.key ? x.key + "≠" + y.key : y.key + "≠" + x.key;
      if (seen.has(pair)) continue;
      seen.add(pair);
      compared++;

      if (x.key === y.key) continue;          // identical: the database blocks these
      if (x.work === y.work) continue;        // 2. a deliberate multi-part set

      // Tolerance scales with length: two characters is a typo in a long
      // name and a different album entirely in a short one ("qp" vs "0").
      const shortest = Math.min(norm(x.title).length, norm(y.title).length);
      const allowed = shortest <= 6 ? 1 : MAX_DISTANCE;

      const d = damerau(x.key, y.key);
      if (d <= allowed) flagged.push({ d, x, y });
    }
  }
}
  return { flagged, compared, albums };
}

// Only print when run directly. Importing this for its detection should not
// dump a report into the middle of somebody else's output.
const RUN_DIRECTLY = process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/^.*[/\\]/, ""));
if (RUN_DIRECTLY) report();

function report() {
const { flagged, compared, albums } = findDuplicates(loadAlbums());

flagged.sort((a, b) => a.d - b.d);
console.log(`${albums.length} albums, ${compared.toLocaleString()} pairs compared`);
console.log(`${flagged.length} possible duplicates (differing by ${MAX_DISTANCE} characters or fewer)\n`);
for (const { d, x, y } of flagged) {
  console.log(`  ${d} char${d === 1 ? "" : "s"} apart`);
  console.log(`     ${x.artist} — ${x.title}${x.year ? ` (${x.year})` : ""}${x.score ? `  [${x.score}]` : ""}`);
  console.log(`     ${y.artist} — ${y.title}${y.year ? ` (${y.year})` : ""}${y.score ? `  [${y.score}]` : ""}\n`);
}
if (!flagged.length) console.log("  nothing suspicious — every near-match is a deliberate multi-part set");
}
