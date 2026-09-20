// genre-report.mjs — tell me when the root list has gone stale.
//
//   node scripts/genre-report.mjs
//
// The genre/style split itself needs no nightly run: app/genres.js computes it
// in the browser from the whole collection, so a new album is classified the
// moment it loads and there is no stored state to drift.
//
// What DOES go stale is the fixed list of roots. If a tag grows large enough
// to deserve standing on its own -- or a root withers to nothing -- only a
// person can decide that, so this reports and never edits. Reads only.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const Genres = createRequire(import.meta.url)("../app/genres.js");
const ROOT_CANDIDATE_SHARE = 0.04;   // 4% of tagged albums and not yet a root
const WITHERED = 20;                 // a root on fewer albums than this

function parseCsv(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false; else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const [header, ...rows] = parseCsv(
  readFileSync(new URL("../data/albums.csv", import.meta.url), "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const albums = rows.filter((r) => r[0])
  .map((r) => ({ genres: (r[col.genres] || "").split(";").map((g) => g.trim()).filter(Boolean) }))
  .filter((a) => a.genres.length);

const index = Genres.buildIndex(albums);
const options = Genres.genreOptions(albums, index);
const n = albums.length;

console.log(`${n} tagged albums, ${index.freq.size} distinct tags, ${options.length} genres in the filter`);

const isRoot = (g) => index.roots.has(g);
const grown = [...index.freq.entries()]
  .filter(([g, c]) => !isRoot(g) && c >= n * ROOT_CANDIDATE_SHARE)
  .sort((a, b) => b[1] - a[1]);

if (grown.length) {
  console.log(`\nTags big enough to be roots but filed as styles (${grown.length}):`);
  for (const [g, c] of grown.slice(0, 12)) {
    const parent = index.parent.get(g);
    console.log(`  ${String(c).padStart(5)}  ${(c / n * 100).toFixed(1)}%  ${g}` +
                (parent ? `   currently under "${parent}"` : "   attached to nothing"));
  }
  console.log(`\n  If one of these deserves its own filter, add it to ROOTS in app/genres.js.`);
} else {
  console.log("\nNo style has outgrown its root.");
}

const withered = [...index.roots]
  .map((r) => [r, index.freq.get(r) || 0])
  .filter(([, c]) => c < WITHERED)
  .sort((a, b) => a[1] - b[1]);
if (withered.length) {
  console.log(`\nRoots on fewer than ${WITHERED} albums:`);
  for (const [g, c] of withered) console.log(`  ${String(c).padStart(5)}  ${g}`);
}

const orphans = [...index.freq.entries()]
  .filter(([g, c]) => !isRoot(g) && c >= 10 && !index.parent.has(g))
  .sort((a, b) => b[1] - a[1]);
if (orphans.length) {
  console.log(`\nStyles under no root (${orphans.length}) — shown on albums, never filterable:`);
  console.log("  " + orphans.slice(0, 14).map(([g, c]) => `${g} ${c}`).join(", "));
}
