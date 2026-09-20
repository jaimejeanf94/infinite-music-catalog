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

// ── matching ───────────────────────────────────────────────────────────────
add("no-match", "Not in MusicBrainz",
  "No release-group matched, so nothing refreshes them. Usually a misspelt "
  + "name rather than an obscure record.",
  albums.filter((a) => !rec(a).mbid).map(ref), "rename");

// A large gap is the signature of the WRONG release-group, not a wrong year --
// and a wrong release-group means the cover and genres are wrong too.
add("year-gap", "Year is far off MusicBrainz",
  "15 years or more apart. That is usually the wrong release-group matched, "
  + "which means the cover and genres came from the wrong record too.",
  albums.filter((a) => {
    const y = Number(a.year), m = Number(rec(a).mb_year);
    return y && m && Math.abs(y - m) >= 15;
  }).map((a) => ({ ...ref(a), note: `shelf ${a.year} vs MusicBrainz ${rec(a).mb_year}` })),
  "recheck");

// ── artwork shared between albums ──────────────────────────────────────────
const byCover = new Map();
for (const a of albums) {
  if (!a.cover_url) continue;
  if (!byCover.has(a.cover_url)) byCover.set(a.cover_url, []);
  byCover.get(a.cover_url).push(a);
}
add("shared-cover", "Same cover on several albums",
  "Sometimes right -- a double album, two halves of one set -- and sometimes "
  + "one album wearing another's sleeve.",
  [...byCover.values()].filter((g) => g.length > 1)
    .map((g) => ({ ...ref(g[0]), note: g.map((a) => a.title).join("  /  ") })),
  "review");

// ── names ──────────────────────────────────────────────────────────────────
const { flagged } = findDuplicates(loadAlbums());
add("near-duplicate", "Possible duplicates",
  "Two rows a couple of characters apart. Deliberate multi-part sets are "
  + "already excluded, so what is left is usually one album typed twice.",
  flagged.map(({ d, x, y }) => ({
    artist: x.artist, title: x.title,
    note: `${d} char${d === 1 ? "" : "s"} from "${y.artist} — ${y.title}"`,
  })), "merge");

const reviewPath = new URL("rename-suggestions-review.json", DATA);
const review = existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, "utf8")) : [];
add("rename-review", "Name corrections held back",
  "The nightly scan found these but would not apply them: a changed sequence "
  + "number, a gained or lost word, or a dropped collaborator.",
  review.map((r) => ({
    artist: r.from.split("::")[0], title: r.from.split("::").slice(1).join("::"),
    note: `${r.to.replace("::", " — ")}   (${r._why || "uncertain"})`,
  })), "rename");

// ── genre shape ────────────────────────────────────────────────────────────
const split = (a) => Genres.splitGenres(a.genres, index);
add("no-root", "Tagged, but under no genre",
  "Has styles but none of them point at a root, so no filter finds it.",
  albums.filter((a) => a.genres.length && !split(a).genre.length).map(ref), "research");

add("over-tagged", "Five or more genres",
  "Carrying this many roots says nothing. Usually over-tagging at the source.",
  albums.filter((a) => split(a).genre.length >= 5)
    .map((a) => ({ ...ref(a), note: split(a).genre.join(", ") })), "review");

const n = albums.filter((a) => a.genres.length).length;
const rootCandidates = [...index.freq.entries()]
  .filter(([g, c]) => !index.roots.has(g) && c >= n * 0.04)
  .sort((a, b) => b[1] - a[1])
  .map(([g, c]) => ({
    artist: g, title: "",
    note: `${c} albums (${(c / n * 100).toFixed(1)}%) — under "${index.parent.get(g) || "nothing"}"`,
  }));
add("root-candidate", "Styles big enough to be genres",
  "Above 4% of the shelf. Promoting one is a judgement: add it to ROOTS in "
  + "app/genres.js.", rootCandidates, "decide");

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
