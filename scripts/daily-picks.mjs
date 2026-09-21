// daily-picks.mjs — choose the five albums the homepage shows today.
//
//   node scripts/daily-picks.mjs [--date=YYYY-MM-DD] [--force]
//
// Writes app/daily.json, which ships with the app: Vercel's root directory is
// app/, so the nightly commit redeploys it. No table, no API call at page
// load, and the page works the moment it opens.
//
// The choice is DERIVED FROM THE DATE, not random: running it twice on the
// same day gives the same five. That matters because the nightly job can be
// re-run, and a homepage that reshuffled every time it was rebuilt would make
// "today's five" meaningless.
//
// What it aims for, in order:
//   - nothing picked in the last 30 days
//   - three unrated and two rated, each drawn at random from its own pool:
//     this collection exists to get through the unrated ones, but a day with
//     nothing familiar in it is joyless
//
// It used to also force five different primary genres. That rule is gone. It
// keyed on genres[0], which is the order MusicBrainz returned its tags in
// rather than a real primary, so it caught exact first-tag collisions and
// missed most of what it was aimed at -- two rock records tagged "rock" and
// "indie rock" both passed. And the spread it produced was a lie about the
// shelf: rock is 18.8% of this collection, so five that never repeat a genre
// claim a variety the collection does not have. Measured over 200,000 draws,
// pure random puts two albums of one genre in the five about 41% of days,
// which is simply what the shelf looks like.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA = new URL("../data/", import.meta.url);
const OUT = new URL("../app/daily.json", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);

const args = process.argv.slice(2);
const DATE = args.find((a) => a.startsWith("--date="))?.split("=")[1]
  || new Date().toISOString().slice(0, 10);
const FORCE = args.includes("--force");

const COUNT = 5;
const COOLDOWN_DAYS = 30;
const UNRATED_TARGET = 3;          // of five

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

// A small deterministic generator seeded from the date. Not for anything that
// needs real entropy -- the roller uses crypto.getRandomValues for that -- but
// exactly right here, where the same day must give the same answer.
function seeded(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;  h >>>= 0;
    return h / 4294967296;
  };
}

const [header, ...rows] = parseCsv(readFileSync(ALBUMS, "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

const albums = rows.filter((r) => r[col.artist] && r[col.cover_url]).map((r) => ({
  artist: r[col.artist],
  title: r[col.title],
  year: r[col.year] ? Number(r[col.year]) : null,
  score: r[col.score] ? Number(r[col.score]) : null,
  cover_url: r[col.cover_url],
  genres: (r[col.genres] || "").split(";").map((g) => g.trim()).filter(Boolean),
}));

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
if (previous.date === DATE && !FORCE) {
  console.log(`already picked for ${DATE} — pass --force to re-pick`);
  process.exit(0);
}

// Anything shown in the last month is off the table.
const cutoff = new Date(Date.parse(DATE) - COOLDOWN_DAYS * 86400000)
  .toISOString().slice(0, 10);
const recent = new Set(
  (previous.history || []).filter((h) => h.date > cutoff)
    .flatMap((h) => h.keys || []));

const key = (a) => `${a.artist}::${a.title}`;
const rand = seeded(DATE);
const shuffled = albums
  .map((a) => ({ a, r: rand() }))
  .sort((x, y) => x.r - y.r)
  .map((x) => x.a)
  .filter((a) => !recent.has(key(a)));

const picks = [];
const take = (want) => {
  for (const a of shuffled) {
    if (picks.length >= COUNT) return;
    if (picks.includes(a)) continue;
    if (want === "unrated" && a.score != null) continue;
    if (want === "rated" && a.score == null) continue;
    picks.push(a);
  }
};

take("unrated");
while (picks.length > UNRATED_TARGET) picks.pop();
take("rated");
// Short only if the collection itself is -- fewer than three unrated left, or
// fewer than two rated. Fill the remainder from whatever is still on the table.
if (picks.length < COUNT) take(null);

const out = {
  date: DATE,
  picks: picks.map((a) => ({
    artist: a.artist, title: a.title, year: a.year,
    score: a.score, cover_url: a.cover_url, genres: a.genres.slice(0, 3),
  })),
  history: [
    { date: DATE, keys: picks.map(key) },
    ...(previous.history || []).filter((h) => h.date !== DATE),
  ].slice(0, 60),
};

writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`app/daily.json — ${picks.length} picks for ${DATE}\n`);
for (const p of picks)
  console.log(`  ${p.score ?? "  ·"}  ${p.artist} — ${p.title}  [${p.genres[0] || "—"}]`);
