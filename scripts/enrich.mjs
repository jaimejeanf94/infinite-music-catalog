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
// Drop records whose album is no longer in albums.csv (see below).
const PRUNE = args.includes("--prune");
// A permanent failure should not be re-attempted every single night: 250
// albums MusicBrainz has never heard of would burn half an hour a run forever.
// Anything looked at within this window is left alone, so a retry pass costs
// nothing most nights and picks things up as the database gets tagged.
const RETRY_AFTER_DAYS = Number(args.find((a) => a.startsWith("--retry-after="))?.split("=")[1] || 14);

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
// Measured against the real collection: every album MusicBrainz "could not
// find" was actually a malformed query, not a gap in the database. Typos
// ("Freddie Gibs"), missing punctuation ("Godspeed You Black Emperor"), your
// own disc splits ("1967-1970 Disc 1"), bracketed editions ("[2018 Mix]") and
// 90-character subtitles all defeated an exact search. Progressively relaxing
// the query recovered 11 of 14.
function queryShapes(artist, title) {
  const out = [];
  const push = (a, t) => {
    if (!a || !t) return;
    const k = `${a}|${t}`;
    if (!out.some((o) => `${o[0]}|${o[1]}` === k)) out.push([a, t]);
  };

  const a0 = artist.trim();
  const a1 = a0.replace(/\[.*?\]/g, "").replace(/[!?.]/g, "").trim();

  push(a0, title.trim());

  const t1 = title
    .replace(/\b(disc|disk|cd)\s*\d+\b/gi, "")      // "1967-1970 Disc 1"
    .replace(/\[.*?\]/g, "")                         // "[2018 Mix]"
    .replace(/\((?:first|second)\s+half\)/gi, "")    // your own halves
    .replace(/\b(ep|lp)\b\s*$/i, "")                 // "Blood Bank EP"
    .trim().replace(/[:;,\-–]\s*$/, "").trim();
  push(a1, t1);

  // A parenthetical that just repeats the artist: "Third (Portishead)"
  const t2 = t1.replace(/\(([^)]*)\)/g, (m, inner) => (sameArtist(artist, inner) ? "" : m)).trim();
  push(a1, t2);

  const t3 = t2.replace(/\(.*?\)/g, "").trim();
  push(a1, t3);

  // Drop a long subtitle: "PetroDragonic Apocalypse; or, Dawn of the..."
  const t4 = t3.split(/\s*[;:]\s*/)[0].trim();
  push(a1, t4);

  return out.slice(0, 5);
}

// Edit distance, capped -- only used to forgive a typo or two in the sheet.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i-1] === b[j-1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// "Freddie Gibs" should match "Freddie Gibbs"; "Gorilaz" should match
// "Gorillaz". Tolerance scales with length so short names stay strict.
function sameArtist(mine, theirs) {
  const a = norm(mine), b = norm(theirs);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const allowed = Math.min(2, Math.max(1, Math.floor(Math.min(a.length, b.length) / 8)));
  return editDistance(a, b) <= allowed;
}

const artistAgrees = sameArtist;

// Relaxing the query recovers awkward titles, but on its own it also lets the
// wrong record win: "PetroDragonic Apocalypse" matched a live album recorded
// two years after the one in the collection. So candidates are ranked rather
// than taken first-come, and live/remix/compilation editions are pushed down
// unless the title you wrote actually asks for one.
function candidateScore(rg, wantTitle, wantArtist) {
  const credited = rg["artist-credit"]?.map((c) => c.name).join(" ") || "";
  if (!sameArtist(wantArtist, credited)) return -1;

  const a = norm(wantTitle), b = norm(rg.title || "");
  if (!a || !b) return -1;

  let score = 0;
  if (a === b) score += 100;
  else if (b.includes(a) || a.includes(b)) score += 70 - Math.abs(a.length - b.length) / 4;
  else {
    const d = editDistance(a, b);
    if (d > Math.max(3, a.length / 6)) return -1;   // a different album
    score += 60 - d * 8;
  }

  const secondary = (rg["secondary-types"] || []).map((x) => x.toLowerCase());
  const asked = /\b(live|remix|demo|compilation|best of|deluxe)\b/i.test(wantTitle);
  if (secondary.length && !asked) score -= 45;
  if (rg["primary-type"] === "Album" && !secondary.length) score += 10;
  score += (rg.score || 0) / 20;
  return score;
}

function bestOf(groups, title, artist) {
  let best = null, bestScore = 0;
  for (const rg of groups || []) {
    const sc = candidateScore(rg, title, artist);
    if (sc > bestScore) { best = rg; bestScore = sc; }
  }
  return bestScore >= 40 ? best : null;
}

async function findReleaseGroup(artist, title) {
  for (const [a, t] of queryShapes(artist, title)) {
    const q = encodeURIComponent(`artist:"${a.replace(/"/g, "")}" AND releasegroup:"${t.replace(/"/g, "")}"`);
    const json = await mbFetch(`/release-group/?query=${q}&fmt=json&limit=8`);
    const hit = bestOf(json["release-groups"], title, artist);
    if (hit) return hit;
    await sleep(MB_GAP);
  }

  // Last resort: an unquoted search, still ranked and still verified on both
  // artist and title -- otherwise this is exactly how wrong covers get in.
  const [a, t] = queryShapes(artist, title).at(-1);
  const json = await mbFetch(`/release-group/?query=${encodeURIComponent(`${a} ${t}`)}&fmt=json&limit=10`);
  const hit = bestOf(json["release-groups"], t, artist);
  await sleep(MB_GAP);
  if (hit) return hit;

  // Everything keyed on the title has failed; try keying on the artist.
  try {
    return await viaArtist(artist, title);
  } catch {
    return null;
  }
}

// Last resort when every query shape has failed. Anchoring on the artist is
// what rescues a typo: MusicBrainz's artist search is fuzzy, so "Gorilaz" still
// lands on Gorillaz, and the title is then matched against that one band's
// discography rather than the whole database -- a far smaller haystack, so a
// loose title match is safe here in a way it would not be globally.
//
// Recovered "Freddie Gibs", "Gorilaz" and "Mr. Morales" in testing. Only runs
// on albums that have already failed, so it costs nothing on the 88% that do
// not need it.
async function viaArtist(artist, title) {
  const found = await mbFetch(`/artist/?query=${encodeURIComponent(artist)}&fmt=json&limit=3`);
  for (const a of (found.artists || []).slice(0, 2)) {
    if (!sameArtist(artist, a.name)) continue;
    await sleep(MB_GAP);
    const rgs = await mbFetch(
      `/release-group?artist=${a.id}&inc=tags+artist-credits&fmt=json&limit=100`);

    let best = null, bestDist = 99;
    for (const rg of rgs["release-groups"] || []) {
      const d = editDistance(norm(title), norm(rg.title));
      if (d < bestDist) { bestDist = d; best = rg; }
    }
    // Tolerance scales with title length: a long title can absorb a word
    // being different, a three-letter one cannot.
    if (best && bestDist <= Math.max(3, norm(title).length / 5)) return best;
  }
  return null;
}

// About 5% of albums match on MusicBrainz but carry no genre tags at all --
// nobody got round to tagging that release. The artist almost always is
// tagged, and the release-group response already carries the artist's id, so
// this is a direct lookup rather than another search.
//
// Artist tags describe a career, not a record: the Beatles come back "rock,
// pop, pop rock, merseybeat", which is true of the band and only roughly true
// of any one album. So the source is recorded, and the app can treat them as
// broad genres rather than styles.
async function artistGenres(rg, genreList) {
  const id = rg["artist-credit"]?.[0]?.artist?.id;
  if (!id) return [];
  try {
    const json = await mbFetch(`/artist/${id}?inc=tags&fmt=json`);
    return (json.tags || [])
      .filter((t) => genreList.has(t.name.toLowerCase()))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((t) => t.name);
  } catch { return []; }
}

// Deezer needs no key and is far more forgiving of a misspelled artist, so it
// picks up the handful MusicBrainz still cannot place. It gives artwork but no
// genres, which is why it is a fallback and not the primary source.
async function deezerCover(artist, title) {
  try {
    const res = await fetch(
      `https://api.deezer.com/search/album?q=${encodeURIComponent(`${artist} ${title}`)}&limit=1`);
    if (!res.ok) return null;
    const hit = (await res.json()).data?.[0];
    if (!hit?.cover_xl || !sameArtist(artist, hit.artist?.name)) return null;
    return { url: hit.cover_xl, from: "deezer" };
  } catch { return null; }
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
    if (!sameArtist(artist, hit.artistName)) return null;   // the check that was missing
    return { url: hit.artworkUrl100.replace("100x100bb", "600x600bb"), from: "itunes" };
  } catch { return await deezerCover(artist, title); }
}

// ── main ────────────────────────────────────────────────────────────────────
const [, ...rows] = parseCsv(readFileSync(ALBUMS, "utf8"));
const albums = rows.filter((r) => r[0]).map((r) => ({ artist: r[0], title: r[1], year: r[2] }));

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const key = (a) => `${a.artist}::${a.title}`;

// Renaming an album in the app cannot touch this file -- the browser has no
// access to it -- so the record under the old name is left behind, and nothing
// ever collects it. One per rename, forever, in a file committed nightly.
//
// Safe because it is self-healing in the other direction too: an album whose
// record is dropped by mistake simply has no record, and the next run enriches
// it again. That also covers restoring a deleted album, since albums.csv only
// carries the live ones.
if (PRUNE) {
  const live = new Set(albums.map(key));
  const dead = Object.keys(store).filter((k) => !live.has(k));
  for (const k of dead) delete store[k];
  if (dead.length) {
    writeFileSync(OUT, JSON.stringify(store, null, 1));
    console.log(`pruned ${dead.length} record${dead.length > 1 ? "s" : ""} for albums that no longer exist:`);
    for (const k of dead.slice(0, 5)) console.log(`  ${k.replace("::", " — ")}`);
    if (dead.length > 5) console.log(`  … and ${dead.length - 5} more`);
    console.log("");
  }
}

const pending = albums.filter((a) => {
  const rec = store[key(a)];
  if (!rec) return true;
  // A matched album with no genres is worth another try too -- either the
  // artist fallback did not exist when it ran, or someone has tagged it since.
  if (RETRY && (rec.status !== "ok" || !rec.genres?.length)) {
    const last = rec.checked || rec.tried;
    if (!last) return true;
    const age = (Date.now() - Date.parse(last)) / 86400000;
    return age >= RETRY_AFTER_DAYS;
  }
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
      // No identity, but Deezer may still have the sleeve.
      const rescue = await deezerCover(album.artist, album.title);
      store[key(album)] = {
        status: rescue ? "partial" : "nomatch",
        cover_url: rescue?.url || null,
        cover_from: rescue?.from || null,
        genres: [],
        tried: new Date().toISOString().slice(0, 10),
      };
      if (rescue) covered++;
      noMatch++;
    } else {
      // Every tag that is a real genre, not just the top three. Which of them
      // to show is a presentation choice the app makes at render time, and
      // storing only three would freeze that decision into the data -- undoing
      // it later means re-running the whole six-hour pass. Ten is well past
      // what any album actually carries, and costs a few dozen bytes.
      const genres = (rg.tags || [])
        .filter((t) => GENRES.has(t.name.toLowerCase()))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((t) => t.name);

      // Fall back to the artist's own tags when the release has none.
      let genreSource = "release";
      let genreList = genres;
      if (!genreList.length) {
        await sleep(MB_GAP);
        genreList = await artistGenres(rg, GENRES);
        if (genreList.length) genreSource = "artist";
      }

      const cover = await coverFor(rg.id, album.artist, album.title);
      const mbYear = rg["first-release-date"]?.slice(0, 4) || null;

      store[key(album)] = {
        status: "ok",
        mbid: rg.id,
        genres: genreList,
        genre_source: genreSource,
        cover_url: cover?.url || null,
        cover_from: cover?.from || null,
        mb_year: mbYear,
        checked: new Date().toISOString().slice(0, 10),
      };
      ok++;
      if (cover) covered++;
      if (genreList.length) withGenres++;
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
