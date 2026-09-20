// recheck-matches.mjs — re-examine albums that were matched to the wrong
// MusicBrainz release-group.
//
//   node scripts/recheck-matches.mjs --dry-run
//   node scripts/recheck-matches.mjs [--limit=N] [--gap=15]
//
// The old ranking summed its signals, so a longer title that merely contained
// the album's name could beat an exact match: "A Hard Day's Night" was matched
// to "The Alternate A Hard Day's Night" because the alternate scored +10 for
// being a plain Album while the real one lost 45 for being a Soundtrack. Those
// albums carry the wrong cover and genres as well as the wrong year.
//
// The detector is the year: enrich.mjs records mb_year, and a large gap
// between that and the shelf's year means the wrong record, not a wrong year.
// --gap sets how large; 15 years is the default, 0 rechecks every disagreement.
//
// Nothing is written without a run that omits --dry-run, and the shelf's own
// artist, title, score and notes are never touched -- only mbid, genres,
// cover_url and mb_year, which are all derived.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { bestOf, lucene, norm } from "./lib/match.mjs";

const UA = "InfiniteMusicCatalog/1.0 (https://github.com/jaimejean/infinite-music-catalog)";
const MB = "https://musicbrainz.org/ws/2";
const CAA = "https://coverartarchive.org";
const DATA = new URL("../data/", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);
const ENRICH = new URL("enrichment.json", DATA);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const GAP = Number(args.find((a) => a.startsWith("--gap="))?.split("=")[1] || 15);
// --skip takes a file of "artist::title" lines, one per line, blank lines and
// # comments ignored. A year gap is a good detector but not a verdict: an
// archival release like Neil Young's Hitchhiker was recorded in 1976 and
// released in 2017, so the shelf's year pulls the match away from the right
// answer. Those need a person, not a rule.
const SKIP = new Set();
const skipFile = args.find((a) => a.startsWith("--skip="))?.split("=")[1];
if (skipFile) {
  for (const line of readFileSync(skipFile, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) SKIP.add(t);
  }
}

const MB_GAP = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!DRY) {
  try {
    const running = execSync("pgrep -f 'node .*enrich\\.mjs' || true", { encoding: "utf8" }).trim();
    if (running) {
      console.error(`enrich.mjs is running (pid ${running.split("\n").join(", ")}). It would overwrite this.`);
      process.exit(1);
    }
  } catch { /* no pgrep; carry on */ }
}

async function mbFetch(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MB}${path}`, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 503 && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`MusicBrainz ${res.status}`);
  }
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

const [, ...rows] = parseCsv(readFileSync(ALBUMS, "utf8"));
const store = JSON.parse(readFileSync(ENRICH, "utf8"));

const suspects = rows
  .filter((r) => r[0])
  .map((r) => ({ artist: r[0], title: r[1], year: r[2] }))
  .filter((a) => {
    const rec = store[`${a.artist}::${a.title}`];
    if (!rec?.mbid || !rec.mb_year || !a.year) return false;
    if (SKIP.has(`${a.artist}::${a.title}`)) return false;
    return Math.abs(Number(rec.mb_year) - Number(a.year)) >= GAP;
  })
  .slice(0, LIMIT);

console.log(`${suspects.length} albums whose year is ${GAP}+ off — the sign of a wrong match\n`);
if (!suspects.length) process.exit(0);

async function coverFor(mbid) {
  try {
    const head = await fetch(`${CAA}/release-group/${mbid}/front-500`, { method: "HEAD" });
    return head.ok ? `${CAA}/release-group/${mbid}/front-500` : null;
  } catch { return null; }
}

const changed = [], kept = [], lost = [];

for (const [i, a] of suspects.entries()) {
  const key = `${a.artist}::${a.title}`;
  const old = store[key];
  try {
    const q = encodeURIComponent(`artist:"${lucene(a.artist)}" AND releasegroup:"${lucene(a.title)}"`);
    const json = await mbFetch(`/release-group/?query=${q}&fmt=json&limit=25&inc=tags`);
    await sleep(MB_GAP);
    const hit = bestOf(json["release-groups"], a.title, a.artist, a.year);

    if (!hit) { lost.push(a); }
    else if (hit.id === old.mbid) { kept.push(a); }
    else {
      changed.push({
        key, a,
        from: { mbid: old.mbid, year: old.mb_year },
        to: { mbid: hit.id, year: (hit["first-release-date"] || "").slice(0, 4) || null,
              title: hit.title,
              secondary: (hit["secondary-types"] || []).join(",") || "-" },
      });
    }
  } catch (e) {
    lost.push({ ...a, error: e.message });
  }

  if ((i + 1) % 20 === 0)
    console.log(`  ${i + 1}/${suspects.length} — ${changed.length} would change, ${kept.length} confirmed`);
}

console.log(`\n=== ${changed.length} would move to a different release-group ===`);
for (const c of changed.slice(0, 40)) {
  console.log(`  ${c.a.artist} — ${c.a.title}  (shelf says ${c.a.year})`);
  console.log(`     ${c.from.year} -> ${c.to.year}   "${c.to.title}"  [${c.to.secondary}]`);
}
if (changed.length > 40) console.log(`  … and ${changed.length - 40} more`);
console.log(`\n${kept.length} confirmed as already correct`);
console.log(`${lost.length} found nothing this time (left exactly as they were)`);

if (DRY) {
  console.log(`\n--dry-run — nothing written`);
  process.exit(0);
}

// Only derived fields move. A cover you set yourself is never replaced.
let wrote = 0;
for (const c of changed) {
  const rec = store[c.key];
  if (rec.cover_locked) continue;
  const cover = await coverFor(c.to.mbid);
  await sleep(250);
  rec.mbid = c.to.mbid;
  rec.mb_year = c.to.year;
  if (cover) { rec.cover_url = cover; rec.cover_from = "coverartarchive"; }
  // The genres belong to the record we just moved away from. Clearing them
  // both removes the wrong data and makes the album eligible for the retry
  // pass, which refetches tags for whatever mbid is now stored.
  rec.genres = [];
  delete rec.genre_source;
  rec.rechecked = new Date().toISOString().slice(0, 10);
  wrote++;
}
const tmp = new URL("enrichment.json.tmp", DATA);
writeFileSync(tmp, JSON.stringify(store, null, 1));
renameSync(tmp, ENRICH);
console.log(`\n${wrote} records updated`);
console.log(`now run:  node scripts/enrich.mjs --retry --retry-after=0 --limit=${wrote}   # refresh their genres`);
console.log(`then:     node scripts/import.mjs`);
