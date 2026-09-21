// fix-spaces.mjs — replace non-ordinary spaces in artist and album names.
//
//   node scripts/fix-spaces.mjs [--dry-run]
//
// A ONE-OFF, not part of the nightly run. 51 names carried a non-breaking
// space (U+00A0) where an ordinary one belonged -- almost always either side
// of the ampersand in a collaboration, "Brian Eno & Harold Budd", and
// sometimes between a romanised name and its native spelling, "Nobuo
// Uematsu 植松伸夫". Carried in from the original spreadsheet.
//
// It made those artists unfindable: typing the name with an ordinary space
// matched nothing, because nothing in the app compared the two as equal. The
// app now folds whitespace when it matches, so search works either way -- this
// fixes the data underneath it, so the names are simply right.
//
// Three files have to move together, which is why this is a script and not an
// UPDATE:
//
//   the database   the source of truth, patched by id
//   enrichment.json  keyed by "artist::title", so every key must be re-cut
//   albums.csv     regenerated from the database afterwards by export.mjs
//
// import.mjs deliberately will not carry a rename to the database -- it
// refuses to insert a row whose mbid is already there and prints a warning --
// so the database has to be patched directly.
import { readFileSync, writeFileSync } from "node:fs";
import { requireEnv, signIn, rest } from "./supabase-rest.mjs";

const DRY = process.argv.includes("--dry-run");
const ENRICH = new URL("../data/enrichment.json", import.meta.url);

// Every Unicode space that is not U+0020, plus runs of ordinary spaces.
const ODD = /[   -   　]/g;
const clean = (s) => (s || "").replace(ODD, " ").replace(/ {2,}/g, " ").trim();

requireEnv();
const api = rest(await signIn());

const albums = await api.selectAll(
  "albums?select=id,artist,title&deleted_at=is.null&order=id.asc");

const jobs = [];
for (const a of albums) {
  const artist = clean(a.artist), title = clean(a.title);
  if (artist === a.artist && title === a.title) continue;
  jobs.push({ id: a.id, from: `${a.artist}::${a.title}`, to: `${artist}::${title}`,
              patch: { ...(artist !== a.artist && { artist }),
                       ...(title !== a.title && { title }) } });
}

// The unique index is on (lower(artist), lower(title)). Cleaning two names
// onto the same spelling, or onto one that already exists untouched, would
// fail mid-batch and leave the job half done -- so check before writing any.
const live = new Map(albums.map((a) => [`${a.artist.toLowerCase()}::${a.title.toLowerCase()}`, a.id]));
const clash = [];
const claimed = new Map();
for (const j of jobs) {
  const k = j.to.toLowerCase();
  const holder = live.get(k);
  if (holder !== undefined && holder !== j.id) clash.push(`${j.to} — already album ${holder}`);
  if (claimed.has(k)) clash.push(`${j.to} — two rows collapse onto it`);
  claimed.set(k, j.id);
}
if (clash.length) {
  console.error(`Refusing to write: ${clash.length} name collision(s).`);
  for (const c of clash) console.error("   " + c);
  process.exit(1);
}

const show = (s) => s.replace(ODD, "␣").replace("::", "  —  ");
console.log(`${jobs.length} name(s) to correct${DRY ? "   (dry run)" : ""}\n`);
for (const j of jobs) console.log("  " + show(j.from));

if (DRY) { console.log("\nNothing written."); process.exit(0); }

// ── the database ───────────────────────────────────────────────────────────
let done = 0;
for (const j of jobs) {
  await api.update("albums", `id=eq.${j.id}`, j.patch);
  if (++done % 10 === 0 || done === jobs.length) console.log(`  patched ${done}/${jobs.length}`);
}

// ── enrichment.json ────────────────────────────────────────────────────────
// Its keys are the old names. Left alone, every one of these albums would look
// unenriched and the next run would re-fetch artwork and genres it already has.
const enrich = JSON.parse(readFileSync(ENRICH, "utf8"));
let moved = 0, absent = 0;
for (const j of jobs) {
  if (!(j.from in enrich)) { absent++; continue; }
  if (j.to in enrich && j.to !== j.from) { delete enrich[j.from]; moved++; continue; }
  enrich[j.to] = enrich[j.from];
  delete enrich[j.from];
  moved++;
}
writeFileSync(ENRICH, JSON.stringify(enrich, null, 1));

console.log(`\ndatabase:        ${jobs.length} name(s) corrected`);
console.log(`enrichment.json: ${moved} key(s) moved${absent ? `, ${absent} had no record` : ""}`);
console.log(`\nnow run:  node scripts/export.mjs   # refresh data/albums.csv`);
