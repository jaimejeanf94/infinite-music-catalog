// find-covers.mjs — hunt down artwork for albums that still have none.
//
//   node scripts/find-covers.mjs --dry-run
//   node scripts/find-covers.mjs [--limit=N]
//
// The albums left without a cover fall into two groups, and they need
// opposite things:
//
//   matched, no image   MusicBrainz knows the record but the Cover Art
//                       Archive holds no picture for it. Deezer or iTunes
//                       usually do. Nothing else about the album is wrong.
//
//   never matched       the name is wrong, so no source can find it. Some
//                       are typos; some have the artist and the title the
//                       wrong way round -- "Gravest Hits - The Cramps" is
//                       the album, not the band. Those are reported, not
//                       applied: renaming is scripts/rename.mjs' job, and a
//                       wrong rename is far worse than a missing cover.
//
// Every candidate is checked against the artist name before it is accepted.
// Taking the first search result unverified is how an album ends up wearing
// another band's sleeve.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { sameArtist, lucene, bestOf, norm, editDistance } from "./lib/match.mjs";

// Checking the artist alone is not enough, and this is exactly how an album
// ends up wearing the wrong sleeve: "Misfits" passes for "8-Bit Misfits",
// and "Various Artists" passes for every compilation ever pressed. The title
// has to agree too.
function titleAgrees(mine, theirs) {
  const a = norm(mine), b = norm(theirs);
  if (!a || !b) return false;
  if (a === b) return true;
  // A subtitle or an edition suffix is fine, as long as the shorter title is
  // substantial: "Ram" inside "Band on the Run" must not count.
  if (a.includes(b) || b.includes(a)) {
    const short = Math.min(a.length, b.length), long = Math.max(a.length, b.length);
    return short >= 6 && short / long >= 0.5;
  }
  // A short title has no room to be wrong in: "MCD" is two edits from "M5",
  // which is the whole word. Below six characters, nothing but an exact match
  // is evidence of anything.
  if (Math.min(a.length, b.length) < 6) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(a.length / 8));
}

// Nothing is credited to "Various Artists" in a way that identifies a record,
// so for those the title is the only evidence there is.
const ANONYMOUS = /^(various|various artists|va|v\.a\.|soundtrack|ost)$/i;

const UA = "InfiniteMusicCatalog/1.0 (https://github.com/jaimejean/infinite-music-catalog)";
const MB = "https://musicbrainz.org/ws/2";
const CAA = "https://coverartarchive.org";
const DATA = new URL("../data/", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);
const ENRICH = new URL("enrichment.json", DATA);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!DRY) {
  try {
    const running = execSync("pgrep -f 'node .*enrich\\.mjs' || true", { encoding: "utf8" }).trim();
    if (running) { console.error("enrich.mjs is running; it would overwrite this."); process.exit(1); }
  } catch { /* no pgrep */ }
}

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

// 503 means "slow down", not "no such album". Swallowing it made rate
// limiting indistinguishable from a miss, so two runs over the same input
// disagreed about which rows were reversed.
const mbFetch = async (path, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MB}${path}`, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 503 && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`MusicBrainz ${res.status}`);
  }
};

// ── artwork, from whoever has it ───────────────────────────────────────────
async function deezerCover(artist, title) {
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const r = await fetch(`https://api.deezer.com/search/album?q=${q}&limit=5`);
    for (const hit of (await r.json())?.data || []) {
      if (!hit.cover_xl) continue;
      const anon = ANONYMOUS.test(artist.trim());
      if (!anon && !sameArtist(artist, hit.artist?.name || "")) continue;
      if (!titleAgrees(title, hit.title)) continue;
      return { url: hit.cover_xl, from: "deezer", as: `${hit.artist.name} — ${hit.title}` };
    }
  } catch { /* fall through */ }
  return null;
}

async function itunesCover(artist, title) {
  try {
    const term = encodeURIComponent(`${artist} ${title}`.slice(0, 180));
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=5`);
    for (const hit of (await r.json()).results || []) {
      if (!hit.artworkUrl100) continue;
      const anon = ANONYMOUS.test(artist.trim());
      if (!anon && !sameArtist(artist, hit.artistName || "")) continue;
      if (!titleAgrees(title, hit.collectionName || "")) continue;
      return {
        url: hit.artworkUrl100.replace("100x100bb", "600x600bb"),
        from: "itunes", as: `${hit.artistName} — ${hit.collectionName}`,
      };
    }
  } catch { /* fall through */ }
  return null;
}

// The Archive stores art against a RELEASE, not a release-group, and the
// group only shows a front image when one of its releases has been flagged as
// representative. Plenty of albums have a perfectly good sleeve on a specific
// pressing that the group-level lookup never sees.
async function archiveByRelease(mbid) {
  let releases;
  try {
    const json = await mbFetch(`/release-group/${mbid}?inc=releases&fmt=json`);
    releases = (json.releases || []).slice(0, 8);
  } catch { return null; }
  await sleep(1100);
  for (const rel of releases) {
    try {
      const url = `${CAA}/release/${rel.id}/front-500`;
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) return { url, from: "coverartarchive", as: `release ${rel.title}` };
    } catch { /* next */ }
    await sleep(200);
  }
  return null;
}

// MusicBrainz links many release-groups to Wikidata, which usually carries the
// sleeve on Commons. It is a curated source, so no extra verification is
// needed: the link says this image belongs to this record.
async function wikidataCover(mbid) {
  try {
    const json = await mbFetch(`/release-group/${mbid}?inc=url-rels&fmt=json`);
    await sleep(1100);
    const rel = (json.relations || []).find((r) => /wikidata/.test(r.url?.resource || ""));
    if (!rel) return null;
    const qid = rel.url.resource.split("/").pop();
    const wd = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)).json();
    const claims = wd.entities?.[qid]?.claims?.P18;          // P18 = image
    const file = claims?.[0]?.mainsnak?.datavalue?.value;
    if (!file) return null;
    return {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`,
      from: "wikimedia", as: file,
    };
  } catch { return null; }
}

// ── is the row simply back to front? ───────────────────────────────────────
async function swapped(artist, title) {
  try {
    const q = encodeURIComponent(`artist:"${lucene(title)}" AND releasegroup:"${lucene(artist)}"`);
    const json = await mbFetch(`/release-group/?query=${q}&fmt=json&limit=10`);
    const hit = bestOf(json["release-groups"], artist, title, null);
    if (!hit) return null;
    return {
      artist: hit["artist-credit"]?.[0]?.name || title,
      title: hit.title,
      year: (hit["first-release-date"] || "").slice(0, 4) || null,
      mbid: hit.id,
    };
  } catch { return null; }
}

// ── main ───────────────────────────────────────────────────────────────────
const [header, ...rows] = parseCsv(readFileSync(ALBUMS, "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const store = existsSync(ENRICH) ? JSON.parse(readFileSync(ENRICH, "utf8")) : {};

const targets = rows.filter((r) => r[0]).map((r) => ({
  artist: r[col.artist], title: r[col.title], year: r[col.year],
  cover: r[col.cover_url],
// albums.csv carries the database's own cover_url, which is the only complete
// picture: the app fills covers client-side as you browse and writes them
// straight to Postgres, so enrichment.json does not know about those. Run
// export.mjs first or this works from a stale list.
})).filter((a) => !a.cover).slice(0, LIMIT);

console.log(`${targets.length} albums with no cover\n`);
if (!targets.length) process.exit(0);

const found = [], reversed = [], stuck = [];

for (const [i, a] of targets.entries()) {
  const key = `${a.artist}::${a.title}`;
  const rec = store[key] || {};

  // Cheapest and most trustworthy first. The two keyed on the mbid need no
  // artist check -- the id already says which record this is.
  let art = null;
  if (rec.mbid) {
    art = await archiveByRelease(rec.mbid);
    if (!art) art = await wikidataCover(rec.mbid);
  }
  if (!art) { art = await deezerCover(a.artist, a.title); await sleep(300); }
  if (!art) { art = await itunesCover(a.artist, a.title); await sleep(300); }

  if (art) {
    found.push({ key, a, art });
  } else if (!rec.mbid) {
    const s = await swapped(a.artist, a.title);
    await sleep(1100);
    if (s) reversed.push({ key, a, s }); else stuck.push(a);
  } else {
    stuck.push(a);
  }

  if ((i + 1) % 10 === 0)
    console.log(`  ${i + 1}/${targets.length} — ${found.length} artwork, ${reversed.length} reversed, ${stuck.length} stuck`);
}

console.log(`\n=== ${found.length} covers found ===`);
for (const f of found.slice(0, 50))
  console.log(`  ${f.a.artist} — ${f.a.title}\n     [${f.art.from}] ${f.art.as}`);

console.log(`\n=== ${reversed.length} rows look back to front ===`);
for (const r of reversed)
  console.log(`  ${r.a.artist} — ${r.a.title}\n     -> ${r.s.artist} — ${r.s.title} (${r.s.year})`);
if (reversed.length)
  console.log(`\n  these are renames, not covers. Write them into a file and use:\n` +
              `    node scripts/rename.mjs --file <that file> --refresh --db`);

console.log(`\n${stuck.length} still with nothing`);

if (DRY) { console.log("\n--dry-run — nothing written"); process.exit(0); }

for (const f of found) {
  const rec = store[f.key] || (store[f.key] = { status: "partial" });
  rec.cover_url = f.art.url;
  rec.cover_from = f.art.from;
}
const tmp = new URL("enrichment.json.tmp", DATA);
writeFileSync(tmp, JSON.stringify(store, null, 1));
renameSync(tmp, ENRICH);
console.log(`\n${found.length} covers written`);
console.log(`now run:  node scripts/cache-covers.mjs && node scripts/import.mjs`);
