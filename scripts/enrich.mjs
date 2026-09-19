// enrich.mjs — attach a stable identity, real genres and reliable artwork to
// every album, writing the result to data/enrichment.json.
//
//   node scripts/enrich.mjs            # work through everything not done yet
//   node scripts/enrich.mjs --limit=50 # just a batch (what CI runs)
//   node scripts/enrich.mjs --retry    # also re-attempt previous failures
//
// Needs no accounts and no packages: it reads data/albums.csv and writes a
// JSON file beside it. Import and the app both merge that file in.
//
// ── why it works this way ───────────────────────────────────────────────────
// The first version searched iTunes by text and took result #1. iTunes always
// returns something, so an album it has never heard of quietly got another
// band's cover. Nothing checked the artist even matched.
//
// Here an album is identified ONCE against MusicBrainz, which returns no
// result rather than a wrong one, and which scores its matches. Everything
// afterwards keys off that release-group id: artwork comes from the Cover Art
// Archive by id, not by text, so it cannot drift. iTunes is kept only as a
// fallback for albums the Archive has no image for, and its answer is checked
// against the artist name before being accepted.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "InfiniteMusicCatalog/1.0 (https://github.com/jaimejean/infinite-music-catalog)";
const MB = "https://musicbrainz.org/ws/2";
const CAA = "https://coverartarchive.org";

const DATA = new URL("../data/", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);
const OUT = new URL("enrichment.json", DATA);
const GENRE_CACHE = new URL("mb-genres.json", DATA);

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const RETRY = args.includes("--retry");

// MusicBrainz asks for no more than one request a second, and enforces it.
// Going faster gets you 503s, not speed.
const MB_GAP = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

async function mbFetch(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MB}${path}`, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    // 503 means "slow down" rather than "broken" -- wait longer and retry.
    if (res.status === 503 && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`MusicBrainz ${res.status}`);
  }
}

// ── csv ─────────────────────────────────────────────────────────────────────
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

// ── the canonical genre list ────────────────────────────────────────────────
// MusicBrainz tags are free text, so an album can be tagged "artist on cover"
// or "_add stems". Only tags that appear in the official genre list survive.
async function loadGenreList() {
  if (existsSync(GENRE_CACHE)) {
    const cached = JSON.parse(readFileSync(GENRE_CACHE, "utf8"));
    if (cached.length > 1000) return new Set(cached);
  }
  process.stdout.write("fetching the MusicBrainz genre list (once)… ");
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const page = await mbFetch(`/genre/all?fmt=json&limit=100&offset=${offset}`);
    all.push(...page.genres.map((g) => g.name.toLowerCase()));
    if (all.length >= page["genre-count"]) break;
    await sleep(MB_GAP);
  }
  writeFileSync(GENRE_CACHE, JSON.stringify(all, null, 0));
  console.log(`${all.length} genres`);
  return new Set(all);
}

// ── matching ────────────────────────────────────────────────────────────────
// Bracketed transliterations and "(CD 2)" style suffixes hurt the search more
// than they help, so try the cleaned form first and the raw form second.
function queryShapes(artist, title) {
  const cleanArtist = artist.replace(/\[.*?\]/g, "").trim();
  const cleanTitle = title.replace(/\((?:cd|disc|disk)\s*\d+\)/gi, "").trim();
  const shapes = [[cleanArtist, cleanTitle]];
  if (cleanTitle !== title || cleanArtist !== artist) shapes.push([artist, title]);
  return shapes;
}

function artistAgrees(mine, theirs) {
  const a = norm(mine), b = norm(theirs);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function findReleaseGroup(artist, title) {
  for (const [a, t] of queryShapes(artist, title)) {
    const q = encodeURIComponent(`artist:"${a.replace(/"/g, "")}" AND releasegroup:"${t.replace(/"/g, "")}"`);
    const json = await mbFetch(`/release-group/?query=${q}&fmt=json&limit=3`);
    const groups = json["release-groups"] || [];

    for (const rg of groups) {
      const credited = rg["artist-credit"]?.map((c) => c.name).join(" ") || "";
      // A high score alone is not enough -- MusicBrainz scores the text, not
      // whether it is the right band. Both must agree.
      if (rg.score >= 85 && artistAgrees(artist, credited)) return rg;
    }
    await sleep(MB_GAP);
  }
  return null;
}

async function coverFor(mbid, artist, title) {
  // By id: exact, and it stays correct forever.
  const res = await fetch(`${CAA}/release-group/${mbid}/front-500`, { method: "HEAD", redirect: "follow" });
  if (res.ok) return { url: `${CAA}/release-group/${mbid}/front-500`, from: "coverartarchive" };

  // Only now fall back to text search -- and verify what comes back.
  try {
    const term = encodeURIComponent(`${artist} ${title}`.slice(0, 180));
    const it = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=1`);
    if (!it.ok) return null;
    const hit = (await it.json()).results?.[0];
    if (!hit?.artworkUrl100) return null;
    if (!artistAgrees(artist, hit.artistName)) return null;   // the check that was missing
    return { url: hit.artworkUrl100.replace("100x100bb", "600x600bb"), from: "itunes" };
  } catch { return null; }
}

// ── main ────────────────────────────────────────────────────────────────────
const [, ...rows] = parseCsv(readFileSync(ALBUMS, "utf8"));
const albums = rows.filter((r) => r[0]).map((r) => ({ artist: r[0], title: r[1], year: r[2] }));

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const key = (a) => `${a.artist}::${a.title}`;

const pending = albums.filter((a) => {
  const rec = store[key(a)];
  if (!rec) return true;
  if (RETRY && rec.status !== "ok") return true;
  return false;
}).slice(0, LIMIT);

console.log(`${albums.length} albums, ${Object.keys(store).length} already processed, ${pending.length} in this run\n`);
if (!pending.length) { console.log("nothing to do"); process.exit(0); }

const GENRES = await loadGenreList();
const save = () => writeFileSync(OUT, JSON.stringify(store, null, 1));

let ok = 0, noMatch = 0, covered = 0, withGenres = 0, yearFixes = [];

for (const [i, album] of pending.entries()) {
  try {
    const rg = await findReleaseGroup(album.artist, album.title);

    if (!rg) {
      store[key(album)] = { status: "nomatch", tried: new Date().toISOString().slice(0, 10) };
      noMatch++;
    } else {
      const genres = (rg.tags || [])
        .filter((t) => GENRES.has(t.name.toLowerCase()))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((t) => t.name);

      const cover = await coverFor(rg.id, album.artist, album.title);
      const mbYear = rg["first-release-date"]?.slice(0, 4) || null;

      store[key(album)] = {
        status: "ok",
        mbid: rg.id,
        genres,
        cover_url: cover?.url || null,
        cover_from: cover?.from || null,
        mb_year: mbYear,
        checked: new Date().toISOString().slice(0, 10),
      };
      ok++;
      if (cover) covered++;
      if (genres.length) withGenres++;
      // Disagreements are reported, never applied -- the sheet's year might be
      // the pressing you own rather than the first release.
      if (mbYear && album.year && mbYear !== album.year) {
        yearFixes.push(`${album.artist} — ${album.title}: sheet ${album.year}, MusicBrainz ${mbYear}`);
      }
    }
  } catch (e) {
    store[key(album)] = { status: "error", error: String(e.message || e) };
  }

  if ((i + 1) % 20 === 0 || i === pending.length - 1) {
    save();
    console.log(`${i + 1}/${pending.length} — ${ok} matched, ${noMatch} unknown to MusicBrainz, ${covered} with artwork`);
  }
  await sleep(MB_GAP);
}

save();
console.log(`\nmatched:      ${ok}`);
console.log(`no match:     ${noMatch}`);
console.log(`with artwork: ${covered}`);
console.log(`with genres:  ${withGenres}`);
if (yearFixes.length) {
  console.log(`\nyear disagreements (not applied, ${yearFixes.length}):`);
  yearFixes.slice(0, 15).forEach((y) => console.log("  " + y));
}
