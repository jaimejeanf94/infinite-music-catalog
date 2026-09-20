// suggest-renames.mjs — work out what a misspelt album is actually called.
//
// Only looks at albums enrichment could not match at all (no MusicBrainz id),
// since an album that matched already has the right name by definition.
//
//   node scripts/suggest-renames.mjs [--limit=N] [--out=renames.json]
//
// Writes a batch for scripts/rename.mjs. Nothing is applied here.
//
// Why not just fuzzy-search the whole database: because "Zen" is one edit from
// "Xen" and also one edit from a thousand other things, and an open search
// happily returns Arcane. Edit distance is only trustworthy against a small
// set of known-correct strings, so both passes below close the set first.
//
//   Pass A  find the ARTIST, pull their discography, match the title inside it.
//           Arca has ~8 release-groups; "Zen" can only land on "Xen".
//   Pass B  if the artist cannot be found (their name is the typo), search the
//           TITLE, then match the artist among whoever released it.
//
// Distance alone still cannot tell a typo from a different record -- "pt. 2"
// is one edit from "Pt. 1" -- so any suggestion that changes a DIGIT is held
// back for review. Numbers in album titles are load-bearing: Vol. 2, Pt. 1,
// 1991, 99.9%.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "InfiniteMusicCatalog/1.0 (https://github.com/jaimejean/infinite-music-catalog)";
const MB = "https://musicbrainz.org/ws/2";
const DATA = new URL("../data/", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);
const ENRICH = new URL("enrichment.json", DATA);

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const OUT = args.find((a) => a.startsWith("--out="))?.split("=")[1] || "renames.json";

const MB_GAP = 1100;                       // MusicBrainz allows one call a second
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const digits = (s) => (String(s).match(/\d/g) || []).join("");

// Deliberately without enrich.mjs's `if (Math.abs(m - n) > 3) return 99` bail.
// That guard is a speed optimisation there, but it means a title missing a
// whole word can never match -- which is exactly the case this script exists
// for ("Three Cheers for Revenge" is 5 characters short of "...Sweet Revenge").
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// A fixed edit budget punishes long titles and lets short ones through on
// nonsense, so score as a fraction of the longer string instead.
const ratio = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 1;
  if (x === y) return 0;
  if (x.includes(y) || y.includes(x)) return 0.05;   // a subtitle, not a typo
  return editDistance(x, y) / Math.max(x.length, y.length);
};

const TITLE_MAX = 0.28;     // "threecheersforrevenge" -> "...sweetrevenge" is 0.19
const ARTIST_MAX = 0.22;

async function mbFetch(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MB}${path}`, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 503 && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`MusicBrainz ${res.status}`);
  }
}

// A live album or a compilation with a near-identical name is a worse answer
// than the studio record, even when it scores a hair closer.
const typePenalty = (rg) => {
  const secondary = (rg["secondary-types"] || []).map((t) => t.toLowerCase());
  if (secondary.includes("live")) return 0.12;
  if (secondary.includes("compilation")) return 0.08;
  if (secondary.includes("remix") || secondary.includes("demo")) return 0.10;
  if ((rg["primary-type"] || "").toLowerCase() === "single") return 0.10;
  return 0;
};

// ── pass A: find the artist, then search only their own records ─────────────
async function viaArtist(artist, title) {
  let found;
  try { found = await mbFetch(`/artist/?query=${encodeURIComponent(artist)}&fmt=json&limit=5`); }
  catch { return null; }

  for (const a of (found.artists || []).slice(0, 3)) {
    const aRatio = ratio(artist, a.name);
    if (aRatio > ARTIST_MAX) continue;
    await sleep(MB_GAP);

    let rgs;
    try { rgs = await mbFetch(`/release-group?artist=${a.id}&fmt=json&limit=100`); }
    catch { continue; }

    let best = null, bestScore = 9;
    for (const rg of rgs["release-groups"] || []) {
      const s = ratio(title, rg.title) + typePenalty(rg);
      if (s < bestScore) { bestScore = s; best = rg; }
    }
    if (best && bestScore <= TITLE_MAX) {
      return {
        artist: a.name, title: best.title, mbid: best.id,
        pass: "artist", titleRatio: Number(bestScore.toFixed(3)),
        artistRatio: Number(aRatio.toFixed(3)),
        pool: (rgs["release-groups"] || []).length,
      };
    }
  }
  return null;
}

// ── pass B: the artist's name is the typo, so anchor on the title ───────────
async function viaTitle(artist, title) {
  let found;
  try {
    found = await mbFetch(
      `/release-group/?query=${encodeURIComponent(`"${title}"`)}&fmt=json&limit=25`);
  } catch { return null; }

  let best = null, bestScore = 9;
  for (const rg of found["release-groups"] || []) {
    const credited = rg["artist-credit"]?.[0]?.name || "";
    const aR = ratio(artist, credited);
    const tR = ratio(title, rg.title);
    if (aR > ARTIST_MAX || tR > TITLE_MAX) continue;
    const s = aR + tR + typePenalty(rg);
    if (s < bestScore) {
      bestScore = s;
      best = { artist: credited, title: rg.title, mbid: rg.id, pass: "title",
               artistRatio: Number(aR.toFixed(3)), titleRatio: Number(tR.toFixed(3)) };
    }
  }
  return best;
}

// ── main ────────────────────────────────────────────────────────────────────
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
const store = existsSync(ENRICH) ? JSON.parse(readFileSync(ENRICH, "utf8")) : {};

// Only albums nothing could be found for. One that matched already has a name
// MusicBrainz agreed with.
const targets = rows
  .filter((r) => r[0])
  .map((r) => ({ artist: r[0], title: r[1] }))
  .filter((a) => !store[`${a.artist}::${a.title}`]?.mbid)
  .slice(0, LIMIT);

console.log(`${targets.length} albums with no MusicBrainz match\n`);

const safe = [], review = [], nothing = [];

for (const [i, a] of targets.entries()) {
  let hit = await viaArtist(a.artist, a.title);
  await sleep(MB_GAP);
  if (!hit) { hit = await viaTitle(a.artist, a.title); await sleep(MB_GAP); }

  if (!hit) { nothing.push(a); }
  else if (norm(hit.artist) === norm(a.artist) && norm(hit.title) === norm(a.title)) {
    nothing.push(a);          // same name, just untagged -- not a rename
  } else {
    const entry = {
      from: `${a.artist}::${a.title}`,
      to: `${hit.artist}::${hit.title}`,
      _pass: hit.pass, _titleRatio: hit.titleRatio, _artistRatio: hit.artistRatio,
      _mbid: hit.mbid,
    };
    // A changed digit is the one thing distance is blind to.
    const digitShift = digits(a.title) !== digits(hit.title);
    if (digitShift) { entry._why = "digits changed — check this is the same record"; review.push(entry); }
    else safe.push(entry);
  }

  if ((i + 1) % 10 === 0 || i === targets.length - 1)
    console.log(`  ${i + 1}/${targets.length}  —  ${safe.length} confident, ${review.length} to review, ${nothing.length} no answer`);
}

writeFileSync(OUT, JSON.stringify(safe, null, 1));
writeFileSync(OUT.replace(/\.json$/, "-review.json"), JSON.stringify(review, null, 1));

console.log(`\n=== confident (${safe.length}) -> ${OUT} ===`);
for (const e of safe) console.log(`  ${e.from.replace("::", " — ")}\n    -> ${e.to.replace("::", " — ")}   [${e._pass} pass]`);
console.log(`\n=== needs your eyes (${review.length}) -> ${OUT.replace(/\.json$/, "-review.json")} ===`);
for (const e of review) console.log(`  ${e.from.replace("::", " — ")}\n    -> ${e.to.replace("::", " — ")}   [${e._why}]`);
console.log(`\n${nothing.length} genuinely not in MusicBrainz\n`);
console.log(`review the file, then:  node scripts/rename.mjs --file ${OUT} --refresh --dry-run`);
