// apple-music-links.mjs — find each album's own page on Apple Music.
//
//   node scripts/apple-music-links.mjs [--limit=N] [--dry-run] [--after=DAYS]
//
// The listen button opens a search unless it knows the album's link, and on a
// phone a search lands in the web player where an album link opens the app
// (see app/listen.js). This finds the links and writes them into
// data/enrichment.json beside each album's other findings; import.mjs pushes
// the confident ones to the database.
//
// Identity first, search second. MusicBrainz records Apple Music links for
// most releases, and enrichment already knows each album's release-group, so
// most albums are linked by id -- nothing guessed. Search is the fallback, and
// it is only a fallback because Apple's free search covers the iTunes STORE,
// what is for sale, not the streaming catalogue: albums that stream but are
// not sold never appear in it at all, in any country.
//
// Every link is confirmed against Apple's Mexican store before it is trusted,
// because an album id from another country's store can be missing from this
// one, and the button would open a page that says so. Apple's lookups need no
// account and ask for about twenty calls a minute; MusicBrainz asks for one a
// second. Hence the gaps, and a nightly batch like enrich.mjs.
//
// Every album gets one of three answers, and only the first is ever written
// to the database without you:
//
//   ok       linked by identity and confirmed in the store, or found by search
//            under the same name. Written to the album.
//   review   probably this record, but not certainly -- the title differs, it
//            is a live or compilation edition the shelf did not ask for, or
//            MusicBrainz links it but the store here will not confirm it.
//            Waits on the Fix screen, with the link to try, for a yes or a no.
//   nomatch  nothing under this name. Listed on the Fix screen, where you can
//            paste a link on the album's page or say it is not on Apple Music.
//
// An album is only ever looked up again once its answer is older than the
// cooldown -- Apple's catalogue grows -- and never once it has a link, or once
// you have locked it by setting or clearing a link by hand.

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { sameArtist, titleTier, ASKS_FOR_REPACKAGING } from "./lib/match.mjs";

const Listen = createRequire(import.meta.url)("../app/listen.js");
const DATA = new URL("../data/", import.meta.url);
const ENRICH = new URL("enrichment.json", DATA);

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || 150);
const AFTER_DAYS = Number(args.find((a) => a.startsWith("--after="))?.split("=")[1] || 30);
const DRY = args.includes("--dry-run");

// The storefront the links point into. It decides which catalogue is searched,
// and a record Apple sells in one country can be missing from another.
const COUNTRY = "mx";
const GAP = 3100;                     // ~19 calls a minute, under Apple's ~20
const MB_GAP = 1100;                  // MusicBrainz: one a second, enforced
const UA = "InfiniteMusicCatalog/1.0 (https://github.com/jaimejean/infinite-music-catalog)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

// enrich.mjs holds the whole store in memory and rewrites it wholesale, so it
// would undo everything written here on its next save.
if (!DRY) {
  try {
    const running = execSync("pgrep -f 'node .*enrich\\.mjs' || true", { encoding: "utf8" }).trim();
    if (running) {
      console.error(`enrich.mjs is running (pid ${running.split("\n").join(", ")}). Wait for it to finish.`);
      process.exit(1);
    }
  } catch { /* no pgrep: carry on without the guard */ }
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

// ── what a candidate is called, once Apple's labelling is set aside ─────────
// Apple names editions in the title: "Wasting Light (Deluxe Edition)",
// "Blood Bank - EP", "Ninety (2020 Remaster)". None of that makes it a
// different record to listen to, so it is stripped before the names are
// compared. What is NOT stripped is anything that changes what you would
// hear: "Live", a subtitle, a volume number.
const EDITION = /\s*[([][^)\]]*\b(deluxe|remaster(ed)?|expanded|edition|anniversary|version|bonus|reissue|mono|stereo)\b[^)\]]*[)\]]/gi;
const bare = (name) => (name || "")
  .replace(/\s+-\s+(EP|Single)$/i, "")
  .replace(EDITION, "")
  .trim();
const isLive = (name) => /\blive\b/i.test(name || "");
const isCompilation = (name) => /\b(greatest hits|best of|collection|anthology|essentials)\b/i.test(name || "");

// Everything by this artist that could be this album, best first. Ranking in
// tiers rather than scoring, the same rule lib/match.mjs uses for
// MusicBrainz: an exact name never loses to a longer one that contains it.
function rank(results, artist, title) {
  const asksForRepackaging = ASKS_FOR_REPACKAGING.test(title);
  return (results || [])
    .filter((c) => c.wrapperType === "collection" && c.collectionViewUrl && sameArtist(artist, c.artistName))
    .map((c) => {
      const t = titleTier({ title: bare(c.collectionName) }, title);
      if (!t) return null;
      const repackaged = !asksForRepackaging && (isLive(c.collectionName) || isCompilation(c.collectionName));
      return {
        c, tier: t.tier, slack: t.slack, repackaged,
        // Apple lists a censored copy beside the original; never prefer it.
        cleaned: c.collectionExplicitness === "cleaned" ? 1 : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.tier - b.tier || a.repackaged - b.repackaged || a.cleaned - b.cleaned ||
                    a.slack - b.slack || a.c.collectionName.length - b.c.collectionName.length);
}

async function apple(path) {
  const url = `https://itunes.apple.com/${path}&country=${COUNTRY}`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()).results || [];
    // 403 and 429 both mean "slow down" here; back off and try again.
    if ((res.status === 403 || res.status === 429) && i < 2) { await sleep(20000 * (i + 1)); continue; }
    throw new Error(`Apple ${res.status}`);
  }
}

const search = (term, limit) =>
  apple(`search?term=${encodeURIComponent(term.slice(0, 180))}&entity=album&limit=${limit}`);

async function mbFetch(path) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`https://musicbrainz.org/ws/2${path}`, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 503 && i < 2) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`MusicBrainz ${res.status}`);
  }
}

// Every Apple album id MusicBrainz records for any release of this album --
// the original, a remaster, a deluxe edition, a regional pressing. Links come
// in several shapes over the years (itunes.apple.com/album/id123,
// music.apple.com/gb/album/123, music.apple.com/de/album/name/123); only the
// id matters, since one id is one album in every store that carries it.
async function idsFromMusicBrainz(mbid) {
  const json = await mbFetch(`/release?release-group=${mbid}&inc=url-rels&fmt=json&limit=50`);
  const ids = [];
  for (const release of json.releases || []) {
    for (const r of release.relations || []) {
      const m = /(?:music|itunes)\.apple\.com\/.*album\/(?:[^/?]+\/)?(?:id)?(\d+)/.exec(r.url?.resource || "");
      if (m && !ids.includes(m[1])) ids.push(m[1]);
    }
  }
  return ids;
}

const tidy = (url) => url.replace(/\?.*$/, "");

async function lookup(artist, title, mbid) {
  // ── by identity ──
  const ids = mbid ? await idsFromMusicBrainz(mbid) : [];
  if (mbid) await sleep(MB_GAP);
  for (const id of ids.slice(0, 3)) {
    const hit = (await apple(`lookup?id=${id}`))[0];
    await sleep(GAP);
    if (hit?.collectionViewUrl && Listen.isAppleAlbumUrl(tidy(hit.collectionViewUrl))) {
      return { apple_status: "ok", apple_url: tidy(hit.collectionViewUrl),
               apple_title: hit.collectionName, apple_via: "musicbrainz" };
    }
  }

  // ── by search ──
  // The artist and title together first. When that finds nothing -- the
  // search ranks popularity above precision, so a common word in a title can
  // push the record off the first page -- the title alone, with the artist
  // checked here rather than trusted to the search.
  let ranked = rank(await search(`${artist} ${title}`, 10), artist, title);
  if (!ranked.length) {
    await sleep(GAP);
    ranked = rank(await search(title, 25), artist, title);
  }
  const best = ranked[0];

  // MusicBrainz knows a link, but Mexico's store would not confirm it, and
  // the search found no Mexican edition either. The album may well stream
  // here -- the store only covers what is for sale -- so it is neither
  // written nor thrown away: it goes to you, with the link to try.
  if (!best && ids.length) {
    return { apple_status: "review", apple_url: `https://music.apple.com/${COUNTRY}/album/${ids[0]}`,
             apple_title: null, apple_via: "musicbrainz",
             apple_why: "MusicBrainz links it, but Apple's store here could not confirm it" };
  }
  if (!best) return { apple_status: "nomatch" };

  const url = tidy(best.c.collectionViewUrl);
  if (!Listen.isAppleAlbumUrl(url)) return { apple_status: "nomatch" };

  const why = [];
  if (best.tier === 1) why.push("the title is longer or shorter than yours");
  if (best.tier === 2) why.push("the title is spelled differently");
  if (best.repackaged) why.push(isLive(best.c.collectionName) ? "it is a live album" : "it is a compilation");
  return {
    apple_status: why.length ? "review" : "ok",
    apple_url: url,
    apple_title: best.c.collectionName,
    apple_via: "search",
    ...(why.length ? { apple_why: why.join(", and ") } : {}),
  };
}

// ── which albums are due ────────────────────────────────────────────────────
const [header, ...rows] = parseCsv(readFileSync(new URL("albums.csv", DATA), "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const cell = (r, name) => (col[name] === undefined ? "" : r[col[name]] || "");
const store = existsSync(ENRICH) ? JSON.parse(readFileSync(ENRICH, "utf8")) : {};

const age = (date) => (Date.parse(today) - Date.parse(date)) / 86400000;
const albums = rows.filter((r) => cell(r, "artist")).map((r) => ({
  artist: cell(r, "artist"),
  title: cell(r, "title"),
  mbid: cell(r, "mbid"),
  linked: !!cell(r, "apple_music_url"),
  locked: cell(r, "apple_music_locked") === "true",
}));

// Records only: a missing one is never invented, because enrich.mjs reads
// "has a record" as "already done" and would never look the album up. The
// nightly run enriches new albums before this step, so they have one by now.
const due = albums.filter((a) => {
  const rec = store[`${a.artist}::${a.title}`];
  if (!rec || a.linked || a.locked) return false;
  if (!rec.apple_status) return true;
  return rec.apple_status !== "ok" && age(rec.apple_checked || "1970-01-01") >= AFTER_DAYS;
});
const batch = due.slice(0, LIMIT);

console.log(`${albums.length} albums, ${due.length} due for an Apple Music lookup, ${batch.length} in this run` +
            (DRY ? "   — --dry-run, nothing written" : ""));
if (!batch.length) { console.log("nothing to do"); process.exit(0); }

const save = () => {
  const tmp = new URL("enrichment.json.tmp", DATA);
  writeFileSync(tmp, JSON.stringify(store, null, 1));
  renameSync(tmp, ENRICH);
};

const tally = { ok: 0, review: 0, nomatch: 0, error: 0 };
for (const [i, a] of batch.entries()) {
  const rec = store[`${a.artist}::${a.title}`];
  try {
    const found = await lookup(a.artist, a.title, a.mbid || rec.mbid);
    tally[found.apple_status]++;
    if (DRY) {
      console.log(`  ${found.apple_status.padEnd(7)} ${(found.apple_via || "").padEnd(11)} ${a.artist} — ${a.title}` +
                  (found.apple_url ? `  ->  ${found.apple_title || found.apple_url}` : "") +
                  (found.apple_why ? `  (${found.apple_why})` : ""));
    } else {
      // A new answer replaces the old one whole, so a record never carries a
      // stale title or reason from a previous lookup.
      for (const k of ["apple_status", "apple_url", "apple_title", "apple_why", "apple_via"]) delete rec[k];
      Object.assign(rec, found, { apple_checked: today });
    }
  } catch (e) {
    tally.error++;
    console.log(`  error   ${a.artist} — ${a.title}: ${e.message}`);
  }
  if (!DRY && ((i + 1) % 20 === 0 || i === batch.length - 1)) save();
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${batch.length}`);
  await sleep(GAP);
}

console.log(`\nlinked:       ${tally.ok}`);
console.log(`to review:    ${tally.review}`);
console.log(`not found:    ${tally.nomatch}`);
if (tally.error) console.log(`errors:       ${tally.error} (looked at again next run)`);
if (!DRY && tally.ok) console.log(`\nnow run:  node scripts/import.mjs   # push the confident links to the database`);
