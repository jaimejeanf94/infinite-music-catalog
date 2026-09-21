// health-report.mjs — everything in the collection that wants a human.
//
//   node scripts/health-report.mjs
//
// Writes app/health.json for the admin screen. Reads only; it never fixes
// anything, because every item in it is a judgement someone has to make. The
// nightly job already applies what can be applied automatically -- what lands
// here is the residue that could not be.
//
// It ships with the app like daily.json does: Vercel serves app/ as the root,
// so the nightly commit redeploys it and the screen needs no query at load.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadAlbums, findDuplicates } from "./find-duplicates.mjs";

const Genres = createRequire(import.meta.url)("../app/genres.js");
const DATA = new URL("../data/", import.meta.url);
const OUT = new URL("../app/health.json", import.meta.url);
const CAP = 250;                 // never ship an unbounded list to the browser

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

const [header, ...rows] = parseCsv(readFileSync(new URL("albums.csv", DATA), "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const albums = rows.filter((r) => r[col.artist]).map((r) => ({
  artist: r[col.artist],
  title: r[col.title],
  year: r[col.year] || null,
  score: r[col.score] ? Number(r[col.score]) : null,
  cover_url: r[col.cover_url] || null,
  cover_locked: r[col.cover_locked] === "true",
  genres: (r[col.genres] || "").split(";").map((g) => g.trim()).filter(Boolean),
}));

const enrich = existsSync(new URL("enrichment.json", DATA))
  ? JSON.parse(readFileSync(new URL("enrichment.json", DATA), "utf8")) : {};
const rec = (a) => enrich[`${a.artist}::${a.title}`] || {};
const ref = (a) => ({ artist: a.artist, title: a.title });

const index = Genres.buildIndex(albums.filter((a) => a.genres.length));
const sections = [];
const add = (id, title, why, items, action) => sections.push({
  id, title, why, action, count: items.length, items: items.slice(0, CAP),
});

// ── the two that should always be zero ─────────────────────────────────────
add("no-cover", "No cover",
  "Nothing to show on the shelf. Upload one from the album's own sheet.",
  albums.filter((a) => !a.cover_url).map(ref), "upload");

add("no-genres", "No genres",
  "Invisible to every genre filter.",
  albums.filter((a) => !a.genres.length).map(ref), "research");

// "Not in MusicBrainz" used to be a section here, over a hundred rows long. It was
// retired: the typo passes already took the misspellings, so what remained was
// genuinely absent from MusicBrainz -- 2 Many DJ's mixtapes, bootleg nightcore,
// Japanese indie -- and with covers and genres both at 100% none of it is
// broken anywhere you can see. The count still shows as `matched` in the
// totals, and db/queries.sql has the query for when you want the list.

// Three different faults wear the same signature and cannot be told apart
// mechanically: the shelf year is wrong; the shelf year is right and
// MusicBrainz matched a REISSUE; or MusicBrainz matched something else
// entirely, which is the only one of the three that also poisons the cover and
// the genres. The direction of the gap does not separate them -- both
// "Moanin' 1958 vs 2001" (reissue, shelf correct) and "Aethiopes 1998 vs 2022"
// (shelf wrong) have the shelf year older. So the row states the two years and
// leaves the call to a person, which is what dismissing is for.
add("year-gap", "Year is far off MusicBrainz",
  "15 years or more apart. Could be your year, could be MusicBrainz matching "
  + "a reissue. Check the two and dismiss it if the shelf is right.",
  albums.filter((a) => {
    const y = Number(a.year), m = Number(rec(a).mb_year);
    return y && m && Math.abs(y - m) >= 15;
  }).map((a) => ({
    ...ref(a),
    note: `shelf ${a.year} vs MusicBrainz ${rec(a).mb_year}`,
    // Two of the three faults are fixed by taking MusicBrainz's year, and the
    // third is fixed by dismissing. So the row can offer the fix outright and
    // name the value it will write -- "Use 2001" is a decision you can make
    // from the list; "Apply" would not be.
    //
    // `was` is what the fix overwrites. The screen's Undo puts it back, and
    // because it travels with the row rather than living in the page, an
    // Undo still rewinds the album after a reload.
    suggest: { year: Number(rec(a).mb_year) },
    was: { year: Number(a.year) },
    apply: `Use ${rec(a).mb_year}`,
  })),
  "recheck");

// "Same cover on several albums" used to be a section here, a few dozen rows long. It
// was retired because no row in it could be diagnosed from the row: the note
// listed the titles sharing one sleeve, but nothing on the page told you which
// record the sleeve actually belonged to, and the honest answer for a double
// album and for a mis-filed sleeve looks identical. Every one of them was
// either correct or unanswerable without opening both records and looking --
// at which point the list had done none of the work. The query is in
// db/queries.sql for when a specific sleeve is in doubt.

// ── names ──────────────────────────────────────────────────────────────────
const { flagged } = findDuplicates(loadAlbums());
add("near-duplicate", "Possible duplicates",
  "Two rows a couple of characters apart. Deliberate multi-part sets are "
  + "already excluded, so what is left is usually one album typed twice.",
  flagged.map(({ d, x, y }) => ({
    artist: x.artist, title: x.title,
    note: d === 0
      ? `the same name as "${y.artist} — ${y.title}" once accents and punctuation are set aside`
      : `${d} char${d === 1 ? "" : "s"} from "${y.artist} — ${y.title}"`,
  })), "merge");

const reviewPath = new URL("rename-suggestions-review.json", DATA);
const reviewRaw = existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, "utf8")) : [];

// Only suggestions whose subject is still on the shelf under the name they
// were raised against. The file persists across runs, so once a rename has
// been applied -- by you, by hand, or by a later pass -- its suggestion sits
// in here forever describing an album that no longer goes by that name. Four
// of six rows were in that state: two already renamed to exactly what was
// suggested, two renamed to something else. A maintenance list that offers to
// do work already done is worse than one that is empty.
const live = new Set(albums.map((a) => `${a.artist.trim().toLowerCase()}::${a.title.trim().toLowerCase()}`));
const stillOpen = (r) => {
  const [artist, ...rest] = r.from.split("::");
  return live.has(`${artist.trim().toLowerCase()}::${rest.join("::").trim().toLowerCase()}`);
};
const review = reviewRaw.filter(stillOpen);
const stale = reviewRaw.length - review.length;
if (stale) console.log(`  (${stale} rename suggestion${stale === 1 ? "" : "s"} already applied — not listed)`);

add("rename-review", "Name corrections held back",
  "The nightly scan found these but would not apply them: a changed sequence "
  + "number, a gained or lost word, or a dropped collaborator.",
  review.map((r) => ({
    artist: r.from.split("::")[0], title: r.from.split("::").slice(1).join("::"),
    note: `${r.to.replace("::", " — ")}   (${r._why || "uncertain"})`,
    // Carried through so the screen can hand the suggestion straight to the
    // rename form rather than making you retype it.
    suggest: { artist: r.to.split("::")[0], title: r.to.split("::").slice(1).join("::") },
    // Keyed on the suggestion, not the album: rejecting "Mulholland Dr. ->
    // Mulholland Drive" must stay rejected, and applying it renames the row
    // out from under any album-keyed flag.
    subject: `rename:${r.from}`,
    was: { artist: r.from.split("::")[0], title: r.from.split("::").slice(1).join("::") },
    apply: "Rename",
  })), "rename");

// ── genre shape ────────────────────────────────────────────────────────────
const split = (a) => Genres.splitGenres(a.genres, index);
add("no-root", "Tagged, but under no genre",
  "Has styles but none of them point at a root, so no filter finds it.",
  albums.filter((a) => a.genres.length && !split(a).genre.length).map(ref), "research");

// "Five or more genres" used to be a section, and was the largest on the page,
// hundreds of rows. Nothing could act on it -- there was no genre editor then -- and
// the rows were not wrong: Check Your Head really is funk, psych, punk, hip hop
// and alternative rock. A list that is accurate and unactionable is not a
// maintenance item.

// "Styles big enough to be genres" was a section too. Every row was an edit to
// the ROOTS array in app/genres.js, which is a conversation and a commit, not
// something you can settle from a screen. `node scripts/genre-report.mjs`
// prints it when you want to have that conversation.

// ── the README's figures ───────────────────────────────────────────────────
// Every number in the README's opening table was wrong within days of being
// typed, because the collection grows and the backlog drains while the prose
// stays where it was. A stale figure in a document is the same failure as an
// alert with no action behind it: it teaches you not to trust the page. This
// run already counts all of it for the totals above, so it writes the block
// too, between markers, and the nightly commit carries it.
function updateReadme() {
  const README = new URL("../README.md", import.meta.url);
  if (!existsSync(README)) return;
  const n = (x) => x.toLocaleString("en-US");
  const years = albums.map((a) => Number(a.year)).filter(Boolean);
  const genreCount = Genres.genreOptions(albums, index).length;
  const rated = albums.filter((a) => a.score != null).length;

  const block = [
    "| | |",
    "|---|---|",
    `| Albums | ${n(albums.length)} — ${n(new Set(albums.map((a) => a.artist)).size)} artists, ${Math.min(...years)}–${Math.max(...years)} |`,
    `| Rated | ${n(rated)}. The other ${Math.round((1 - rated / albums.length) * 100)}% is the point of the app |`,
    `| Covers | ${n(albums.filter((a) => a.cover_url).length)} — ${n(albums.filter((a) => /\/storage\/v1\/object\/public\//.test(a.cover_url || "")).length)} of them cached and CDN-served |`,
    `| Genres | ${n(albums.filter((a) => a.genres.length).length)} tagged, ${genreCount} of them browsable |`,
    `| Matched to MusicBrainz | ${n(albums.filter((a) => rec(a).mbid).length)} |`,
    "| Cost to run | nothing — every service is on a free tier |",
  ].join("\n");

  const text = readFileSync(README, "utf8");
  const re = /(<!-- stats:start -->\n)[\s\S]*?(\n<!-- stats:end -->)/;
  if (!re.test(text)) return console.log("  (README has no stats markers — left alone)");
  const next = text.replace(re, `$1${block}$2`);
  if (next === text) return;
  writeFileSync(README, next);
  console.log("README.md — opening figures refreshed");
}
updateReadme();

const out = {
  generated: new Date().toISOString(),
  totals: {
    albums: albums.length,
    rated: albums.filter((a) => a.score != null).length,
    withCover: albums.filter((a) => a.cover_url).length,
    withGenres: albums.filter((a) => a.genres.length).length,
    matched: albums.filter((a) => rec(a).mbid).length,
  },
  sections,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));

const open = sections.filter((s) => s.count);
console.log(`app/health.json — ${open.reduce((n, s) => n + s.count, 0)} items across ${open.length} sections`);
for (const s of sections) console.log(`  ${String(s.count).padStart(5)}  ${s.title}`);
