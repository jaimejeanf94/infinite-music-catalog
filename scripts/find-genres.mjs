// find-genres.mjs — fill in genres for albums that have none.
//
//   node scripts/find-genres.mjs --dry-run
//   node scripts/find-genres.mjs [--limit=N]
//
// Needs DISCOGS_TOKEN and LASTFM_KEY in .env for the third and fourth passes;
// the first two work with no account at all.
//
// Sources are tried cheapest and most trustworthy first:
//
//   1. the release-group itself, asked for directly. enrich.mjs takes whatever
//      tags the SEARCH response happens to carry, which is not the same thing
//      -- a direct lookup with inc=genres+tags returns more.
//   2. the artist's own tags. Broad, and true of a career rather than a
//      record, so it is recorded as genre_source "artist" and the app can
//      treat it as less specific.
//   3. Discogs, which catalogues the bootlegs, DJ mixes and small-label
//      pressings MusicBrainz has never heard of. Its `genre` is coarse and its
//      `style` is specific, so both are taken.
//   4. Last.fm, whose tags are user-submitted and unmoderated.
//
// Everything is filtered through data/mb-genres.json, MusicBrainz's canonical
// list of 2,202 genre names. That is what stops "radiohead", "seen live" and
// "albums i own" -- all real Last.fm tags -- from becoming genres.
//
// Discogs and Last.fm are matched by name, so both are verified against the
// artist and the title before they are believed.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { sameArtist, norm, editDistance } from "./lib/match.mjs";

const UA = "InfiniteMusicCatalog/1.0 (+https://github.com/jaimejeanf94/infinite-music-catalog)";
const MB = "https://musicbrainz.org/ws/2";
const DATA = new URL("../data/", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);
const ENRICH = new URL("enrichment.json", DATA);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const { DISCOGS_TOKEN, LASTFM_KEY } = process.env;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB_GAP = 1100, DISCOGS_GAP = 1100, LASTFM_GAP = 260;

if (!DRY) {
  try {
    const running = execSync("pgrep -f 'node .*enrich\\.mjs' || true", { encoding: "utf8" }).trim();
    if (running) { console.error("enrich.mjs is running; it would overwrite this."); process.exit(1); }
  } catch { /* no pgrep */ }
}

const raw = JSON.parse(readFileSync(new URL("mb-genres.json", DATA), "utf8"));
const GENRES = new Set((Array.isArray(raw) ? raw : Object.keys(raw)).map((g) => g.toLowerCase()));
const keep = (names) => {
  const out = [];
  for (const n of names) {
    const g = String(n).toLowerCase().trim();
    if (GENRES.has(g) && !out.includes(g)) out.push(g);
  }
  return out.slice(0, 8);
};

async function mbFetch(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MB}${path}`, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 503 && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
    return null;
  }
}

// Same rule as find-covers: a name-matched source has to agree on the title,
// not just the artist, or "Misfits" collects sleeves from "8-Bit Misfits".
function titleAgrees(mine, theirs) {
  const a = norm(mine), b = norm(theirs);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) {
    const s = Math.min(a.length, b.length), l = Math.max(a.length, b.length);
    return s >= 6 && s / l >= 0.5;
  }
  if (Math.min(a.length, b.length) < 6) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(a.length / 8));
}

// ── MusicBrainz, asked directly rather than via a search response ─────────
// Split in two so every album-level source is tried before any artist-level
// one. Tags on a record describe the record; tags on an artist describe a
// career, and "Radiohead is alternative rock" says little about Kid A.
async function mbRelease(mbid) {
  const rg = await mbFetch(`/release-group/${mbid}?inc=genres+tags+artist-credits&fmt=json`);
  await sleep(MB_GAP);
  if (!rg) return { genres: null, artistId: null };
  const g = keep([...(rg.genres || []), ...(rg.tags || [])]
    .sort((a, b) => (b.count || 0) - (a.count || 0)).map((t) => t.name));
  return {
    genres: g.length ? { genres: g, source: "release" } : null,
    artistId: rg["artist-credit"]?.[0]?.artist?.id || null,
  };
}

async function mbArtist(artistId) {
  if (!artistId) return null;
  const ar = await mbFetch(`/artist/${artistId}?inc=genres+tags&fmt=json`);
  await sleep(MB_GAP);
  if (!ar) return null;
  const g = keep([...(ar.genres || []), ...(ar.tags || [])]
    .sort((a, b) => (b.count || 0) - (a.count || 0)).map((t) => t.name));
  return g.length ? { genres: g, source: "artist" } : null;
}

// ── 3: Discogs — the one that has the bootlegs and the DJ mixes ────────────
async function fromDiscogs(artist, title) {
  if (!DISCOGS_TOKEN) return null;
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const res = await fetch(
      `https://api.discogs.com/database/search?q=${q}&type=release&per_page=5&token=${DISCOGS_TOKEN}`,
      { headers: { "User-Agent": UA } });
    await sleep(DISCOGS_GAP);
    if (!res.ok) return null;
    for (const hit of (await res.json()).results || []) {
      // Discogs titles are "Artist - Title"; split and check both halves.
      const [dArtist, ...rest] = String(hit.title || "").split(" - ");
      const dTitle = rest.join(" - ");
      if (!dTitle) continue;
      if (!sameArtist(artist, dArtist) || !titleAgrees(title, dTitle)) continue;
      const g = keep([...(hit.style || []), ...(hit.genre || [])]);
      if (g.length) return { genres: g, source: "discogs", as: hit.title };
    }
  } catch { /* fall through */ }
  return null;
}

// ── Last.fm — unmoderated, so the canonical filter does the work ─────────
async function lastfmCall(params) {
  if (!LASTFM_KEY) return null;
  try {
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}&api_key=${LASTFM_KEY}&format=json`);
    await sleep(LASTFM_GAP);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function lastfmAlbum(artist, title) {
  const j = await lastfmCall(`method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(title)}&autocorrect=1`);
  if (!j?.album) return null;
  if (!sameArtist(artist, j.album.artist || "") || !titleAgrees(title, j.album.name || "")) return null;
  const g = keep((j.album.tags?.tag || []).map((t) => t.name));
  return g.length ? { genres: g, source: "lastfm" } : null;
}

async function lastfmArtist(artist) {
  const j = await lastfmCall(`method=artist.gettoptags&artist=${encodeURIComponent(artist)}&autocorrect=1`);
  const g = keep((j?.toptags?.tag || []).map((t) => t.name));
  return g.length ? { genres: g, source: "lastfm-artist" } : null;
}

// ── main ───────────────────────────────────────────────────────────────────
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

const [header, ...rows] = parseCsv(readFileSync(ALBUMS, "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const store = existsSync(ENRICH) ? JSON.parse(readFileSync(ENRICH, "utf8")) : {};

const targets = rows.filter((r) => r[0])
  .map((r) => ({ artist: r[col.artist], title: r[col.title], genres: r[col.genres] }))
  .filter((a) => !a.genres || !a.genres.trim())
  .slice(0, LIMIT);

console.log(`${targets.length} albums with no genres`);
console.log(`discogs: ${DISCOGS_TOKEN ? "yes" : "NO TOKEN"}   lastfm: ${LASTFM_KEY ? "yes" : "NO KEY"}\n`);
if (!targets.length) process.exit(0);

const found = [], stuck = [];
const bySource = {};

for (const [i, a] of targets.entries()) {
  const key = `${a.artist}::${a.title}`;
  const rec = store[key] || {};
  let hit = null;

  // Album-level first, in descending order of how curated the source is.
  let artistId = null;
  if (rec.mbid) {
    const r = await mbRelease(rec.mbid);
    hit = r.genres; artistId = r.artistId;
  }
  if (!hit) hit = await fromDiscogs(a.artist, a.title);
  if (!hit) hit = await lastfmAlbum(a.artist, a.title);
  // Only now settle for what is true of the artist rather than the record.
  if (!hit) hit = await mbArtist(artistId);
  if (!hit) hit = await lastfmArtist(a.artist);

  if (hit) {
    found.push({ key, a, hit });
    bySource[hit.source] = (bySource[hit.source] || 0) + 1;
  } else stuck.push(a);

  if ((i + 1) % 10 === 0)
    console.log(`  ${i + 1}/${targets.length} — ${found.length} found, ${stuck.length} stuck`);
}

console.log(`\n=== ${found.length} albums given genres ===`);
for (const f of found.slice(0, 60))
  console.log(`  [${f.hit.source}] ${f.a.artist} — ${f.a.title}\n      ${f.hit.genres.join(", ")}`);
console.log(`\nby source: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}`);
console.log(`${stuck.length} still with nothing`);
for (const s of stuck.slice(0, 30)) console.log(`  ${s.artist} — ${s.title}`);

if (DRY) { console.log("\n--dry-run — nothing written"); process.exit(0); }

for (const f of found) {
  const rec = store[f.key] || (store[f.key] = { status: "partial" });
  rec.genres = f.hit.genres;
  rec.genre_source = f.hit.source;
}
const tmp = new URL("enrichment.json.tmp", DATA);
writeFileSync(tmp, JSON.stringify(store, null, 1));
renameSync(tmp, ENRICH);
console.log(`\n${found.length} records updated`);
console.log(`now run:  node scripts/import.mjs`);
